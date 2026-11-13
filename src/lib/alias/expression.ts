/*
 * Safe formulas with `val` (conversion of a link, alias.read/write).
 *
 * The formulas are NOT executed as JavaScript (no eval / new Function): they are parsed into a small
 * syntax tree that only knows an allow list, and evaluated by this interpreter. Everything else is
 * rejected while parsing:
 *   literals (number, 'text', "text", true, false, null, undefined), val, parameters of arrow functions,
 *   + - * / % ! unary - + typeof, === !== == != < > <= >= && || ?? ? :,
 *   (a, b) => expression, calls of Number String Boolean parseFloat parseInt isNaN isFinite Math.<fn>,
 *   methods of texts/numbers/lists from an allow list, [..] only on object/list literals (value tables).
 * Identifiers are ASCII only (no unicode escapes), there are no statements, assignments, loops,
 * `this`, `new` or access to prototypes. The allowed subset has the same meaning in JavaScript, so a
 * checked formula can also be stored as alias.read/write for js-controller.
 */

type Node =
    | { t: 'lit'; v: unknown }
    | { t: 'id'; name: string }
    | { t: 'un'; op: string; a: Node }
    | { t: 'bin'; op: string; a: Node; b: Node }
    | { t: 'cond'; c: Node; a: Node; b: Node }
    | { t: 'member'; obj: Node; name: string }
    | { t: 'index'; obj: Node; key: Node }
    | { t: 'call'; callee: Node; args: Node[] }
    | { t: 'arrow'; params: string[]; body: Node }
    | { t: 'obj'; entries: [string, Node][] }
    | { t: 'arr'; items: Node[] };

type Token = { k: 'num' | 'str' | 'id' | 'op'; v: string; pos: number };

/** Functions that may be called by name */
const GLOBALS: Record<string, (...args: any[]) => unknown> = {
    Number: (v: unknown) => Number(v),
    String: (v: unknown) => String(v),
    Boolean: (v: unknown) => Boolean(v),
    parseFloat: (v: unknown) => parseFloat(v as string),
    parseInt: (v: unknown, radix?: number) => parseInt(v as string, radix),
    isNaN: (v: unknown) => isNaN(v as number),
    isFinite: (v: unknown) => isFinite(v as number),
};

/** Math functions (Math.<name>) */
const MATH: Record<string, (...args: number[]) => number> = {
    round: Math.round,
    floor: Math.floor,
    ceil: Math.ceil,
    trunc: Math.trunc,
    abs: Math.abs,
    sign: Math.sign,
    sqrt: Math.sqrt,
    min: Math.min,
    max: Math.max,
    pow: Math.pow,
};

const STRING_METHODS = new Set([
    'replace',
    'toLowerCase',
    'toUpperCase',
    'trim',
    'includes',
    'startsWith',
    'endsWith',
    'slice',
    'substring',
    'indexOf',
    'padStart',
    'padEnd',
]);
const NUMBER_METHODS = new Set(['toFixed', 'toPrecision']);
const ARRAY_METHODS = new Set(['includes', 'indexOf', 'join', 'slice']);
/** All member names that may appear after a dot */
const MEMBER_NAMES = new Set([...STRING_METHODS, ...NUMBER_METHODS, ...ARRAY_METHODS, 'length']);

const KEYWORDS: Record<string, unknown> = { true: true, false: false, null: null, undefined: undefined };
const MAX_LENGTH = 2000;
const MAX_DEPTH = 50;
/** Calls of arrow functions per evaluation - a formula can not loop endlessly */
const MAX_CALLS = 10_000;
let calls = 0;
/** Nesting of arrow function calls - stops before the JavaScript stack overflows */
const MAX_NESTING = 64;
let nesting = 0;

// ------------------------------------------------------------------ tokenizer

function tokenize(src: string): Token[] {
    const tokens: Token[] = [];
    const ops = [
        '===',
        '!==',
        '==',
        '!=',
        '<=',
        '>=',
        '&&',
        '||',
        '??',
        '=>',
        '+',
        '-',
        '*',
        '/',
        '%',
        '!',
        '<',
        '>',
        '?',
        ':',
        '(',
        ')',
        '[',
        ']',
        '{',
        '}',
        ',',
        '.',
    ];
    let i = 0;
    while (i < src.length) {
        const c = src[i];
        if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
            i++;
            continue;
        }
        if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
            const m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i))!;
            tokens.push({ k: 'num', v: m[0], pos: i });
            i += m[0].length;
            continue;
        }
        if (c === '"' || c === "'") {
            let out = '';
            let j = i + 1;
            for (; j < src.length && src[j] !== c; j++) {
                if (src[j] === '\n') {
                    throw new Error('line break in text');
                }
                if (src[j] === '\\') {
                    const e = src[++j];
                    const simple: Record<string, string> = {
                        n: '\n',
                        t: '\t',
                        r: '\r',
                        b: '\b',
                        f: '\f',
                        '"': '"',
                        "'": "'",
                        '\\': '\\',
                        '/': '/',
                    };
                    if (e in simple) {
                        out += simple[e];
                    } else if (e === 'u' && /^[0-9a-fA-F]{4}$/.test(src.slice(j + 1, j + 5))) {
                        out += String.fromCharCode(parseInt(src.slice(j + 1, j + 5), 16));
                        j += 4;
                    } else {
                        throw new Error('invalid escape in text');
                    }
                } else {
                    out += src[j];
                }
            }
            if (j >= src.length) {
                throw new Error('text without end');
            }
            tokens.push({ k: 'str', v: out, pos: i });
            i = j + 1;
            continue;
        }
        if (/[A-Za-z_$]/.test(c)) {
            const m = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(src.slice(i))!;
            tokens.push({ k: 'id', v: m[0], pos: i });
            i += m[0].length;
            continue;
        }
        const op = ops.find(o => src.startsWith(o, i));
        if (!op) {
            throw new Error(`character "${c}" is not allowed`);
        }
        tokens.push({ k: 'op', v: op, pos: i });
        i += op.length;
    }
    return tokens;
}

// ------------------------------------------------------------------ parser

class Parser {
    private i = 0;
    private readonly scopes: Set<string>[] = [new Set(['val'])];

    public constructor(private readonly tokens: Token[]) {}

    private peek(offset = 0): Token | undefined {
        return this.tokens[this.i + offset];
    }
    private isOp(v: string, offset = 0): boolean {
        const t = this.peek(offset);
        return t?.k === 'op' && t.v === v;
    }
    private expectOp(v: string): void {
        if (!this.isOp(v)) {
            throw new Error(`"${v}" expected`);
        }
        this.i++;
    }
    private known(name: string): boolean {
        return this.scopes.some(s => s.has(name));
    }

    public parse(): Node {
        const node = this.expression();
        if (this.i < this.tokens.length) {
            throw new Error(`unexpected "${this.peek()!.v}"`);
        }
        return node;
    }

    private expression(): Node {
        return this.conditional();
    }

    private conditional(): Node {
        const c = this.binary(0);
        if (this.isOp('?')) {
            this.i++;
            const a = this.expression();
            this.expectOp(':');
            const b = this.expression();
            return { t: 'cond', c, a, b };
        }
        return c;
    }

    private static readonly LEVELS: string[][] = [
        ['??'],
        ['||'],
        ['&&'],
        ['===', '!==', '==', '!='],
        ['<', '>', '<=', '>='],
        ['+', '-'],
        ['*', '/', '%'],
    ];

    private binary(level: number): Node {
        if (level >= Parser.LEVELS.length) {
            return this.unary();
        }
        let a = this.binary(level + 1);
        for (;;) {
            const t = this.peek();
            if (t?.k !== 'op' || !Parser.LEVELS[level].includes(t.v)) {
                return a;
            }
            this.i++;
            const b = this.binary(level + 1);
            a = { t: 'bin', op: t.v, a, b };
        }
    }

    private unary(): Node {
        const t = this.peek();
        if (t?.k === 'op' && (t.v === '!' || t.v === '-' || t.v === '+')) {
            this.i++;
            return { t: 'un', op: t.v, a: this.unary() };
        }
        if (t?.k === 'id' && t.v === 'typeof') {
            this.i++;
            return { t: 'un', op: 'typeof', a: this.unary() };
        }
        return this.postfix();
    }

    private postfix(): Node {
        let node = this.primary();
        for (;;) {
            if (this.isOp('.')) {
                this.i++;
                const name = this.peek();
                if (name?.k !== 'id') {
                    throw new Error('name expected after "."');
                }
                this.i++;
                if (node.t === 'id' && node.name === 'Math') {
                    if (!Object.hasOwn(MATH, name.v)) {
                        throw new Error(`Math.${name.v} is not allowed`);
                    }
                } else if (!MEMBER_NAMES.has(name.v)) {
                    throw new Error(`".${name.v}" is not allowed`);
                }
                node = { t: 'member', obj: node, name: name.v };
            } else if (this.isOp('[')) {
                // only value tables / lists written in the formula itself
                if (node.t !== 'obj' && node.t !== 'arr') {
                    throw new Error('[...] is only allowed on a table {...} or list [...] in the formula');
                }
                this.i++;
                const key = this.expression();
                this.expectOp(']');
                node = { t: 'index', obj: node, key };
            } else if (this.isOp('(')) {
                if (
                    !(node.t === 'id' && (Object.hasOwn(GLOBALS, node.name) || this.known(node.name))) &&
                    node.t !== 'member' &&
                    node.t !== 'arrow'
                ) {
                    throw new Error('only allowed functions can be called');
                }
                if (node.t === 'member' && node.obj.t === 'id' && node.obj.name === 'Math') {
                    // Math.round(…)
                } else if (node.t === 'member' && node.name === 'length') {
                    throw new Error('length is not a function');
                }
                this.i++;
                const args: Node[] = [];
                if (!this.isOp(')')) {
                    do {
                        args.push(this.expression());
                    } while (this.isOp(',') && ++this.i);
                }
                this.expectOp(')');
                node = { t: 'call', callee: node, args };
            } else {
                return node;
            }
        }
    }

    /** `(a, b) =>` or `a =>` at the current position */
    private arrowParams(): string[] | undefined {
        const t = this.peek();
        if (t?.k === 'id' && this.isOp('=>', 1)) {
            this.i += 2;
            return [t.v];
        }
        if (!this.isOp('(')) {
            return undefined;
        }
        const params: string[] = [];
        let j = 1;
        if (!this.isOp(')', j)) {
            for (;;) {
                const p = this.peek(j);
                if (p?.k !== 'id') {
                    return undefined;
                }
                params.push(p.v);
                j++;
                if (this.isOp(',', j)) {
                    j++;
                    continue;
                }
                break;
            }
        }
        if (!this.isOp(')', j) || !this.isOp('=>', j + 1)) {
            return undefined;
        }
        this.i += j + 2;
        return params;
    }

    private primary(): Node {
        const params = this.arrowParams();
        if (params) {
            for (const p of params) {
                if (Object.hasOwn(GLOBALS, p) || p === 'Math' || p in KEYWORDS || p === 'typeof') {
                    throw new Error(`"${p}" can not be a parameter`);
                }
            }
            this.scopes.push(new Set(params));
            const body = this.expression();
            this.scopes.pop();
            return { t: 'arrow', params, body };
        }
        const t = this.peek();
        if (!t) {
            throw new Error('unexpected end');
        }
        this.i++;
        if (t.k === 'num') {
            return { t: 'lit', v: Number(t.v) };
        }
        if (t.k === 'str') {
            return { t: 'lit', v: t.v };
        }
        if (t.k === 'id') {
            if (Object.hasOwn(KEYWORDS, t.v)) {
                return { t: 'lit', v: KEYWORDS[t.v] };
            }
            if (t.v === 'NaN' || t.v === 'Infinity') {
                return { t: 'lit', v: t.v === 'NaN' ? NaN : Infinity };
            }
            if (this.known(t.v) || Object.hasOwn(GLOBALS, t.v) || t.v === 'Math') {
                return { t: 'id', name: t.v };
            }
            throw new Error(`"${t.v}" is not allowed`);
        }
        if (t.v === '(') {
            const node = this.expression();
            this.expectOp(')');
            return node;
        }
        if (t.v === '[') {
            const items: Node[] = [];
            if (!this.isOp(']')) {
                do {
                    items.push(this.expression());
                } while (this.isOp(',') && ++this.i);
            }
            this.expectOp(']');
            return { t: 'arr', items };
        }
        if (t.v === '{') {
            const entries: [string, Node][] = [];
            if (!this.isOp('}')) {
                do {
                    const key = this.peek();
                    if (!key || (key.k !== 'str' && key.k !== 'id' && key.k !== 'num')) {
                        throw new Error('key expected');
                    }
                    this.i++;
                    this.expectOp(':');
                    entries.push([key.k === 'num' ? String(Number(key.v)) : key.v, this.expression()]);
                } while (this.isOp(',') && ++this.i && !this.isOp('}'));
            }
            this.expectOp('}');
            return { t: 'obj', entries };
        }
        throw new Error(`unexpected "${t.v}"`);
    }
}

// ------------------------------------------------------------------ interpreter

/** A table {...} of a formula: no prototype, so [key] finds only its own entries */
type Table = Record<string, unknown>;
const tables = new WeakSet<object>();
/** Functions created by arrow expressions of a formula */
const closures = new WeakSet<object>();

function isPrimitive(v: unknown): boolean {
    return v === null || (typeof v !== 'object' && typeof v !== 'function');
}

function evaluate(node: Node, env: Map<string, unknown>, depth: number): unknown {
    if (depth > MAX_DEPTH) {
        throw new Error('formula too deep');
    }
    const ev = (n: Node, e = env): unknown => evaluate(n, e, depth + 1);
    switch (node.t) {
        case 'lit':
            return node.v;
        case 'id':
            if (env.has(node.name)) {
                return env.get(node.name);
            }
            if (Object.hasOwn(GLOBALS, node.name)) {
                return GLOBALS[node.name];
            }
            throw new Error(`unknown "${node.name}"`);
        case 'un': {
            const a = ev(node.a);
            switch (node.op) {
                case '!':
                    return !a;
                case '-':
                    return -(a as number);
                case '+':
                    return +(a as number);
                default:
                    return typeof a;
            }
        }
        case 'bin': {
            if (node.op === '&&') {
                return ev(node.a) && ev(node.b);
            }
            if (node.op === '||') {
                return ev(node.a) || ev(node.b);
            }
            if (node.op === '??') {
                return ev(node.a) ?? ev(node.b);
            }
            const a = ev(node.a) as any;
            const b = ev(node.b) as any;
            if (!isPrimitive(a) || !isPrimitive(b)) {
                if (node.op !== '===' && node.op !== '!==') {
                    throw new Error(`"${node.op}" only works with values`);
                }
            }
            switch (node.op) {
                case '+':
                    return a + b;
                case '-':
                    return a - b;
                case '*':
                    return a * b;
                case '/':
                    return a / b;
                case '%':
                    return a % b;
                case '===':
                    return a === b;
                case '!==':
                    return a !== b;
                case '==':
                    return a == b;
                case '!=':
                    return a != b;
                case '<':
                    return a < b;
                case '>':
                    return a > b;
                case '<=':
                    return a <= b;
                default:
                    return a >= b;
            }
        }
        case 'cond':
            return ev(node.c) ? ev(node.a) : ev(node.b);
        case 'obj': {
            const table: Table = Object.create(null) as Table;
            for (const [k, v] of node.entries) {
                table[k] = ev(v);
            }
            tables.add(table);
            return table;
        }
        case 'arr':
            return node.items.map(i => ev(i));
        case 'index': {
            const obj = ev(node.obj);
            const key = ev(node.key);
            if (Array.isArray(obj)) {
                const i = Number(key);
                return Number.isInteger(i) && i >= 0 && i < obj.length ? obj[i] : undefined;
            }
            if (obj && typeof obj === 'object' && tables.has(obj)) {
                const k = String(key);
                return Object.hasOwn(obj, k) ? (obj as Table)[k] : undefined;
            }
            throw new Error('[...] only works on tables and lists');
        }
        case 'member': {
            const obj = ev(node.obj);
            if (node.name === 'length' && (typeof obj === 'string' || Array.isArray(obj))) {
                return obj.length;
            }
            throw new Error(`".${node.name}" can only be called`);
        }
        case 'arrow': {
            const fn = (...args: unknown[]): unknown => {
                if (++calls > MAX_CALLS) {
                    throw new Error('too many function calls');
                }
                if (++nesting > MAX_NESTING) {
                    nesting--;
                    throw new Error('too many nested function calls');
                }
                try {
                    const inner = new Map(env);
                    node.params.forEach((p, i) => inner.set(p, args[i]));
                    return evaluate(node.body, inner, depth + 1);
                } finally {
                    nesting--;
                }
            };
            closures.add(fn);
            return fn;
        }
        case 'call': {
            const args = node.args.map(a => ev(a));
            const callee = node.callee;
            if (callee.t === 'member') {
                if (callee.obj.t === 'id' && callee.obj.name === 'Math') {
                    if (!args.every(a => isPrimitive(a))) {
                        throw new Error('Math functions only take values');
                    }
                    return MATH[callee.name](...(args as number[]));
                }
                const obj = ev(callee.obj);
                // native methods get values only - never a function of the formula
                if (!args.every(a => isPrimitive(a))) {
                    throw new Error('methods only take values');
                }
                if (typeof obj === 'string' && STRING_METHODS.has(callee.name)) {
                    return (String.prototype as any)[callee.name].apply(obj, args);
                }
                if (typeof obj === 'number' && NUMBER_METHODS.has(callee.name)) {
                    return (Number.prototype as any)[callee.name].apply(obj, args);
                }
                if (Array.isArray(obj) && ARRAY_METHODS.has(callee.name)) {
                    return (Array.prototype as any)[callee.name].apply(obj, args);
                }
                throw new Error(`".${callee.name}" is not allowed on ${typeof obj}`);
            }
            const fn = ev(callee);
            if (typeof fn !== 'function' || !(closures.has(fn) || Object.values(GLOBALS).includes(fn as never))) {
                throw new Error('only allowed functions can be called');
            }
            if (Object.values(GLOBALS).includes(fn as never) && !args.every(a => isPrimitive(a))) {
                throw new Error('functions only take values');
            }
            return (fn as (...a: unknown[]) => unknown)(...args);
        }
    }
}

/** A checked formula: evaluate it with a value */
export type Formula = (val: unknown) => unknown;

/**
 * Parses a formula. Throws with the reason if it uses anything that is not allowed.
 *
 * @param source - formula with `val`
 */
export function parseFormula(source: string): Formula {
    if (typeof source !== 'string') {
        throw new Error('not a text');
    }
    if (source.length > MAX_LENGTH) {
        throw new Error('too long');
    }
    const ast = new Parser(tokenize(source)).parse();
    return (val: unknown) => {
        calls = 0;
        nesting = 0;
        const result = evaluate(ast, new Map([['val', val]]), 0);
        if (typeof result === 'function') {
            throw new Error('the result is a function');
        }
        return result;
    };
}
