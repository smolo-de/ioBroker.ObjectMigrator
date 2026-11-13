"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var expression_exports = {};
__export(expression_exports, {
  parseFormula: () => parseFormula
});
module.exports = __toCommonJS(expression_exports);
const GLOBALS = {
  Number: (v) => Number(v),
  String: (v) => String(v),
  Boolean: (v) => Boolean(v),
  parseFloat: (v) => parseFloat(v),
  parseInt: (v, radix) => parseInt(v, radix),
  isNaN: (v) => isNaN(v),
  isFinite: (v) => isFinite(v)
};
const MATH = {
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
  trunc: Math.trunc,
  abs: Math.abs,
  sign: Math.sign,
  sqrt: Math.sqrt,
  min: Math.min,
  max: Math.max,
  pow: Math.pow
};
const STRING_METHODS = /* @__PURE__ */ new Set([
  "replace",
  "toLowerCase",
  "toUpperCase",
  "trim",
  "includes",
  "startsWith",
  "endsWith",
  "slice",
  "substring",
  "indexOf",
  "padStart",
  "padEnd"
]);
const NUMBER_METHODS = /* @__PURE__ */ new Set(["toFixed", "toPrecision"]);
const ARRAY_METHODS = /* @__PURE__ */ new Set(["includes", "indexOf", "join", "slice"]);
const MEMBER_NAMES = /* @__PURE__ */ new Set([...STRING_METHODS, ...NUMBER_METHODS, ...ARRAY_METHODS, "length"]);
const KEYWORDS = { true: true, false: false, null: null, undefined: void 0 };
const MAX_LENGTH = 2e3;
const MAX_DEPTH = 50;
const MAX_CALLS = 1e4;
let calls = 0;
const MAX_NESTING = 64;
let nesting = 0;
function tokenize(src) {
  var _a;
  const tokens = [];
  const ops = [
    "===",
    "!==",
    "==",
    "!=",
    "<=",
    ">=",
    "&&",
    "||",
    "??",
    "=>",
    "+",
    "-",
    "*",
    "/",
    "%",
    "!",
    "<",
    ">",
    "?",
    ":",
    "(",
    ")",
    "[",
    "]",
    "{",
    "}",
    ",",
    "."
  ];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === " " || c === "	" || c === "\n" || c === "\r") {
      i++;
      continue;
    }
    if (/[0-9]/.test(c) || c === "." && /[0-9]/.test((_a = src[i + 1]) != null ? _a : "")) {
      const m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i));
      tokens.push({ k: "num", v: m[0], pos: i });
      i += m[0].length;
      continue;
    }
    if (c === '"' || c === "'") {
      let out = "";
      let j = i + 1;
      for (; j < src.length && src[j] !== c; j++) {
        if (src[j] === "\n") {
          throw new Error("line break in text");
        }
        if (src[j] === "\\") {
          const e = src[++j];
          const simple = {
            n: "\n",
            t: "	",
            r: "\r",
            b: "\b",
            f: "\f",
            '"': '"',
            "'": "'",
            "\\": "\\",
            "/": "/"
          };
          if (e in simple) {
            out += simple[e];
          } else if (e === "u" && /^[0-9a-fA-F]{4}$/.test(src.slice(j + 1, j + 5))) {
            out += String.fromCharCode(parseInt(src.slice(j + 1, j + 5), 16));
            j += 4;
          } else {
            throw new Error("invalid escape in text");
          }
        } else {
          out += src[j];
        }
      }
      if (j >= src.length) {
        throw new Error("text without end");
      }
      tokens.push({ k: "str", v: out, pos: i });
      i = j + 1;
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      const m = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(src.slice(i));
      tokens.push({ k: "id", v: m[0], pos: i });
      i += m[0].length;
      continue;
    }
    const op = ops.find((o) => src.startsWith(o, i));
    if (!op) {
      throw new Error(`character "${c}" is not allowed`);
    }
    tokens.push({ k: "op", v: op, pos: i });
    i += op.length;
  }
  return tokens;
}
class Parser {
  constructor(tokens) {
    this.tokens = tokens;
  }
  i = 0;
  scopes = [/* @__PURE__ */ new Set(["val"])];
  peek(offset = 0) {
    return this.tokens[this.i + offset];
  }
  isOp(v, offset = 0) {
    const t = this.peek(offset);
    return (t == null ? void 0 : t.k) === "op" && t.v === v;
  }
  expectOp(v) {
    if (!this.isOp(v)) {
      throw new Error(`"${v}" expected`);
    }
    this.i++;
  }
  known(name) {
    return this.scopes.some((s) => s.has(name));
  }
  parse() {
    const node = this.expression();
    if (this.i < this.tokens.length) {
      throw new Error(`unexpected "${this.peek().v}"`);
    }
    return node;
  }
  expression() {
    return this.conditional();
  }
  conditional() {
    const c = this.binary(0);
    if (this.isOp("?")) {
      this.i++;
      const a = this.expression();
      this.expectOp(":");
      const b = this.expression();
      return { t: "cond", c, a, b };
    }
    return c;
  }
  static LEVELS = [
    ["??"],
    ["||"],
    ["&&"],
    ["===", "!==", "==", "!="],
    ["<", ">", "<=", ">="],
    ["+", "-"],
    ["*", "/", "%"]
  ];
  binary(level) {
    if (level >= Parser.LEVELS.length) {
      return this.unary();
    }
    let a = this.binary(level + 1);
    for (; ; ) {
      const t = this.peek();
      if ((t == null ? void 0 : t.k) !== "op" || !Parser.LEVELS[level].includes(t.v)) {
        return a;
      }
      this.i++;
      const b = this.binary(level + 1);
      a = { t: "bin", op: t.v, a, b };
    }
  }
  unary() {
    const t = this.peek();
    if ((t == null ? void 0 : t.k) === "op" && (t.v === "!" || t.v === "-" || t.v === "+")) {
      this.i++;
      return { t: "un", op: t.v, a: this.unary() };
    }
    if ((t == null ? void 0 : t.k) === "id" && t.v === "typeof") {
      this.i++;
      return { t: "un", op: "typeof", a: this.unary() };
    }
    return this.postfix();
  }
  postfix() {
    let node = this.primary();
    for (; ; ) {
      if (this.isOp(".")) {
        this.i++;
        const name = this.peek();
        if ((name == null ? void 0 : name.k) !== "id") {
          throw new Error('name expected after "."');
        }
        this.i++;
        if (node.t === "id" && node.name === "Math") {
          if (!Object.hasOwn(MATH, name.v)) {
            throw new Error(`Math.${name.v} is not allowed`);
          }
        } else if (!MEMBER_NAMES.has(name.v)) {
          throw new Error(`".${name.v}" is not allowed`);
        }
        node = { t: "member", obj: node, name: name.v };
      } else if (this.isOp("[")) {
        if (node.t !== "obj" && node.t !== "arr") {
          throw new Error("[...] is only allowed on a table {...} or list [...] in the formula");
        }
        this.i++;
        const key = this.expression();
        this.expectOp("]");
        node = { t: "index", obj: node, key };
      } else if (this.isOp("(")) {
        if (!(node.t === "id" && (Object.hasOwn(GLOBALS, node.name) || this.known(node.name))) && node.t !== "member" && node.t !== "arrow") {
          throw new Error("only allowed functions can be called");
        }
        if (node.t === "member" && node.obj.t === "id" && node.obj.name === "Math") {
        } else if (node.t === "member" && node.name === "length") {
          throw new Error("length is not a function");
        }
        this.i++;
        const args = [];
        if (!this.isOp(")")) {
          do {
            args.push(this.expression());
          } while (this.isOp(",") && ++this.i);
        }
        this.expectOp(")");
        node = { t: "call", callee: node, args };
      } else {
        return node;
      }
    }
  }
  /** `(a, b) =>` or `a =>` at the current position */
  arrowParams() {
    const t = this.peek();
    if ((t == null ? void 0 : t.k) === "id" && this.isOp("=>", 1)) {
      this.i += 2;
      return [t.v];
    }
    if (!this.isOp("(")) {
      return void 0;
    }
    const params = [];
    let j = 1;
    if (!this.isOp(")", j)) {
      for (; ; ) {
        const p = this.peek(j);
        if ((p == null ? void 0 : p.k) !== "id") {
          return void 0;
        }
        params.push(p.v);
        j++;
        if (this.isOp(",", j)) {
          j++;
          continue;
        }
        break;
      }
    }
    if (!this.isOp(")", j) || !this.isOp("=>", j + 1)) {
      return void 0;
    }
    this.i += j + 2;
    return params;
  }
  primary() {
    const params = this.arrowParams();
    if (params) {
      for (const p of params) {
        if (Object.hasOwn(GLOBALS, p) || p === "Math" || p in KEYWORDS || p === "typeof") {
          throw new Error(`"${p}" can not be a parameter`);
        }
      }
      this.scopes.push(new Set(params));
      const body = this.expression();
      this.scopes.pop();
      return { t: "arrow", params, body };
    }
    const t = this.peek();
    if (!t) {
      throw new Error("unexpected end");
    }
    this.i++;
    if (t.k === "num") {
      return { t: "lit", v: Number(t.v) };
    }
    if (t.k === "str") {
      return { t: "lit", v: t.v };
    }
    if (t.k === "id") {
      if (Object.hasOwn(KEYWORDS, t.v)) {
        return { t: "lit", v: KEYWORDS[t.v] };
      }
      if (t.v === "NaN" || t.v === "Infinity") {
        return { t: "lit", v: t.v === "NaN" ? NaN : Infinity };
      }
      if (this.known(t.v) || Object.hasOwn(GLOBALS, t.v) || t.v === "Math") {
        return { t: "id", name: t.v };
      }
      throw new Error(`"${t.v}" is not allowed`);
    }
    if (t.v === "(") {
      const node = this.expression();
      this.expectOp(")");
      return node;
    }
    if (t.v === "[") {
      const items = [];
      if (!this.isOp("]")) {
        do {
          items.push(this.expression());
        } while (this.isOp(",") && ++this.i);
      }
      this.expectOp("]");
      return { t: "arr", items };
    }
    if (t.v === "{") {
      const entries = [];
      if (!this.isOp("}")) {
        do {
          const key = this.peek();
          if (!key || key.k !== "str" && key.k !== "id" && key.k !== "num") {
            throw new Error("key expected");
          }
          this.i++;
          this.expectOp(":");
          entries.push([key.k === "num" ? String(Number(key.v)) : key.v, this.expression()]);
        } while (this.isOp(",") && ++this.i && !this.isOp("}"));
      }
      this.expectOp("}");
      return { t: "obj", entries };
    }
    throw new Error(`unexpected "${t.v}"`);
  }
}
const tables = /* @__PURE__ */ new WeakSet();
const closures = /* @__PURE__ */ new WeakSet();
function isPrimitive(v) {
  return v === null || typeof v !== "object" && typeof v !== "function";
}
function evaluate(node, env, depth) {
  var _a;
  if (depth > MAX_DEPTH) {
    throw new Error("formula too deep");
  }
  const ev = (n, e = env) => evaluate(n, e, depth + 1);
  switch (node.t) {
    case "lit":
      return node.v;
    case "id":
      if (env.has(node.name)) {
        return env.get(node.name);
      }
      if (Object.hasOwn(GLOBALS, node.name)) {
        return GLOBALS[node.name];
      }
      throw new Error(`unknown "${node.name}"`);
    case "un": {
      const a = ev(node.a);
      switch (node.op) {
        case "!":
          return !a;
        case "-":
          return -a;
        case "+":
          return +a;
        default:
          return typeof a;
      }
    }
    case "bin": {
      if (node.op === "&&") {
        return ev(node.a) && ev(node.b);
      }
      if (node.op === "||") {
        return ev(node.a) || ev(node.b);
      }
      if (node.op === "??") {
        return (_a = ev(node.a)) != null ? _a : ev(node.b);
      }
      const a = ev(node.a);
      const b = ev(node.b);
      if (!isPrimitive(a) || !isPrimitive(b)) {
        if (node.op !== "===" && node.op !== "!==") {
          throw new Error(`"${node.op}" only works with values`);
        }
      }
      switch (node.op) {
        case "+":
          return a + b;
        case "-":
          return a - b;
        case "*":
          return a * b;
        case "/":
          return a / b;
        case "%":
          return a % b;
        case "===":
          return a === b;
        case "!==":
          return a !== b;
        case "==":
          return a == b;
        case "!=":
          return a != b;
        case "<":
          return a < b;
        case ">":
          return a > b;
        case "<=":
          return a <= b;
        default:
          return a >= b;
      }
    }
    case "cond":
      return ev(node.c) ? ev(node.a) : ev(node.b);
    case "obj": {
      const table = /* @__PURE__ */ Object.create(null);
      for (const [k, v] of node.entries) {
        table[k] = ev(v);
      }
      tables.add(table);
      return table;
    }
    case "arr":
      return node.items.map((i) => ev(i));
    case "index": {
      const obj = ev(node.obj);
      const key = ev(node.key);
      if (Array.isArray(obj)) {
        const i = Number(key);
        return Number.isInteger(i) && i >= 0 && i < obj.length ? obj[i] : void 0;
      }
      if (obj && typeof obj === "object" && tables.has(obj)) {
        const k = String(key);
        return Object.hasOwn(obj, k) ? obj[k] : void 0;
      }
      throw new Error("[...] only works on tables and lists");
    }
    case "member": {
      const obj = ev(node.obj);
      if (node.name === "length" && (typeof obj === "string" || Array.isArray(obj))) {
        return obj.length;
      }
      throw new Error(`".${node.name}" can only be called`);
    }
    case "arrow": {
      const fn = (...args) => {
        if (++calls > MAX_CALLS) {
          throw new Error("too many function calls");
        }
        if (++nesting > MAX_NESTING) {
          nesting--;
          throw new Error("too many nested function calls");
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
    case "call": {
      const args = node.args.map((a) => ev(a));
      const callee = node.callee;
      if (callee.t === "member") {
        if (callee.obj.t === "id" && callee.obj.name === "Math") {
          if (!args.every((a) => isPrimitive(a))) {
            throw new Error("Math functions only take values");
          }
          return MATH[callee.name](...args);
        }
        const obj = ev(callee.obj);
        if (!args.every((a) => isPrimitive(a))) {
          throw new Error("methods only take values");
        }
        if (typeof obj === "string" && STRING_METHODS.has(callee.name)) {
          return String.prototype[callee.name].apply(obj, args);
        }
        if (typeof obj === "number" && NUMBER_METHODS.has(callee.name)) {
          return Number.prototype[callee.name].apply(obj, args);
        }
        if (Array.isArray(obj) && ARRAY_METHODS.has(callee.name)) {
          return Array.prototype[callee.name].apply(obj, args);
        }
        throw new Error(`".${callee.name}" is not allowed on ${typeof obj}`);
      }
      const fn = ev(callee);
      if (typeof fn !== "function" || !(closures.has(fn) || Object.values(GLOBALS).includes(fn))) {
        throw new Error("only allowed functions can be called");
      }
      if (Object.values(GLOBALS).includes(fn) && !args.every((a) => isPrimitive(a))) {
        throw new Error("functions only take values");
      }
      return fn(...args);
    }
  }
}
function parseFormula(source) {
  if (typeof source !== "string") {
    throw new Error("not a text");
  }
  if (source.length > MAX_LENGTH) {
    throw new Error("too long");
  }
  const ast = new Parser(tokenize(source)).parse();
  return (val) => {
    calls = 0;
    nesting = 0;
    const result = evaluate(ast, /* @__PURE__ */ new Map([["val", val]]), 0);
    if (typeof result === "function") {
      throw new Error("the result is a function");
    }
    return result;
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  parseFormula
});
//# sourceMappingURL=expression.js.map
