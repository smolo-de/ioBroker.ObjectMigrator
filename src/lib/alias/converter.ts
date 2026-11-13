import { parseFormula, type Formula } from './expression';

/*
 * Value conversion of a link (number ↔ text, factor, decimals, value table, …).
 * One definition creates the alias functions `common.alias.read/write` AND converts the migrated
 * history values - the history is converted with the very same read expression, so the live value
 * and the history always match.
 */

/** Conversion of one source → target */
export interface ValueConverter {
    /** Value table, applied first: `{ "0": "Aus", "1": "An" }` (keys are the source values as text) */
    map?: Record<string, string | number | boolean>;
    /** val × factor + offset (numbers) */
    factor?: number;
    /** Added after the factor */
    offset?: number;
    /** true ↔ false, 0 ↔ 1 */
    invert?: boolean;
    /** Type of the target value - undefined keeps the type */
    to?: 'number' | 'string' | 'boolean';
    /** Decimals: rounds numbers, fixed decimals for text */
    decimals?: number;
    /** Text after the value (only `to: 'string'`), e.g. " °C" */
    suffix?: string;
    /** Expert: own expressions with `val`, replace everything else */
    read?: string;
    /** Expert: alias → source (write) */
    write?: string;
}

/** Characters JSON leaves raw in a text - escaped, so the text stays one literal wherever the formula ends up */
const UNSAFE_IN_CODE: Record<string, string> = {
    '<': '\\u003C',
    '>': '\\u003E',
    '/': '\\u002F',
    '\u2028': '\\u2028',
    '\u2029': '\\u2029',
};

/**
 * A value (text, table) as literal in a formula: JSON with the characters above escaped
 *
 * @param v - value
 */
const lit = (v: unknown): string =>
    (JSON.stringify(v) ?? 'null').replace(/[<>/\u2028\u2029]/g, ch => UNSAFE_IN_CODE[ch]);

/**
 * Only a finite number goes into a formula - anything else (text, NaN, Infinity) is the default
 *
 * @param v - value of the converter
 * @param fallback - default
 */
const finite = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/**
 * Decimals 0…15 (an integer), else none
 *
 * @param v - value of the converter
 */
const decimalsOf = (v: unknown): number | undefined =>
    typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 15 ? v : undefined;

/**
 * Is anything converted?
 *
 * @param c - converter
 */
export function isConverting(c?: ValueConverter): c is ValueConverter {
    return (
        !!c &&
        !!(
            c.read?.trim() ||
            (c.map && Object.keys(c.map).length) ||
            (c.factor !== undefined && c.factor !== 1) ||
            (c.offset !== undefined && c.offset !== 0) ||
            c.invert ||
            c.to ||
            c.decimals !== undefined ||
            c.suffix
        )
    );
}

const round = (expr: string, decimals: number): string => {
    const p = 10 ** decimals;
    return `Math.round(${expr} * ${p}) / ${p}`;
};

/**
 * Alias functions of a converter (EM-06): `read` = source → alias, `write` = alias → source (only if
 * it can be inverted and the alias is writeable)
 *
 * @param c - converter
 * @param writeable - the target is writeable
 */
export function converterToAlias(c: ValueConverter | undefined, writeable = false): { read?: string; write?: string } {
    if (!isConverting(c)) {
        return {};
    }
    if (c.read?.trim()) {
        return { read: c.read.trim(), write: writeable && c.write?.trim() ? c.write.trim() : undefined };
    }
    let e = 'val';
    let invertible = true;
    if (c.map && Object.keys(c.map).length) {
        e = `(${lit(c.map)}[String(${e})] ?? ${e})`;
    }
    const factor = finite(c.factor, 1);
    const offset = finite(c.offset, 0);
    const decimals = decimalsOf(c.decimals);
    if (factor !== 1 || offset !== 0) {
        e = `(Number(${e}) * ${factor}${offset ? ` + ${offset}` : ''})`;
        // × 0 can not be inverted
        invertible = factor !== 0;
    }
    if (c.invert) {
        e = `((v) => (typeof v === 'boolean' ? !v : 1 - Number(v)))(${e})`;
    }
    if (c.to === 'number') {
        e = `((v) => (typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'))))(${e})`;
        if (decimals !== undefined) {
            e = round(e, decimals);
        }
    } else if (c.to === 'string') {
        e =
            decimals !== undefined
                ? `((v) => (isNaN(Number(v)) || v === '' || v === null ? String(v) : Number(v).toFixed(${decimals})))(${e})`
                : `String(${e})`;
        if (c.suffix) {
            e = `${e} + ${lit(c.suffix)}`;
        }
    } else if (c.to === 'boolean') {
        e = `((v) => v === true || v === 1 || ['true', '1', 'on', 'an', 'ja', 'yes'].includes(String(v).toLowerCase()))(${e})`;
        invertible = false;
    } else if (decimals !== undefined) {
        e = `((v) => (typeof v === 'number' ? ${round('v', decimals)} : v))(${e})`;
    }
    const result: { read?: string; write?: string } = { read: e };

    if (writeable && invertible) {
        // inverse in reverse order: text → number, invert, linear, table
        let w = 'val';
        if (c.to === 'string') {
            w = `parseFloat(String(${w})${c.suffix ? `.replace(${lit(c.suffix)}, '')` : ''}.replace(',', '.'))`;
        }
        if (c.invert) {
            w = `((v) => (typeof v === 'boolean' ? !v : 1 - Number(v)))(${w})`;
        }
        if (factor !== 1 || offset !== 0) {
            w = `((Number(${w})${offset ? ` - ${offset}` : ''}) / ${factor})`;
        }
        if (c.map && Object.keys(c.map).length) {
            const inverse: Record<string, string> = {};
            for (const [k, v] of Object.entries(c.map)) {
                inverse[String(v)] = k;
            }
            // an expression only (no statements) - the same rules as for read
            w = `((v, k) => (k === undefined ? v : isNaN(Number(k)) ? k : Number(k)))(${w}, ${lit(inverse)}[String(${w})])`;
        }
        if (w !== 'val') {
            result.write = w;
        }
    }
    return result;
}

/**
 * Checks a formula (alias read/write, own conversion). Returns the reason if it is not allowed.
 * Formulas are parsed by an allow-list interpreter (expression.ts) - they are never executed as
 * JavaScript, so a formula can not reach the runtime of the adapter or the browser.
 *
 * @param expression - formula with `val`
 */
export function checkExpression(expression: string): string | undefined {
    try {
        parseFormula(expression);
        return undefined;
    } catch (e) {
        return (e as Error).message;
    }
}

const compiled = new Map<string, Formula>();

/**
 * Prepares a formula for evaluation (`val` is the value) - throws if it is not allowed
 *
 * @param expression - e.g. `val * 10`
 */
export function compileExpression(expression: string): Formula {
    let fn = compiled.get(expression);
    if (!fn) {
        try {
            fn = parseFormula(expression);
        } catch (e) {
            throw new Error(`Formula not allowed (${(e as Error).message}): ${expression}`);
        }
        if (compiled.size > 500) {
            compiled.clear();
        }
        compiled.set(expression, fn);
    }
    return fn;
}

/**
 * Converts a value with the read expression of a converter - for previews and tests
 *
 * @param c - converter
 * @param val - source value
 */
export function convertWith(c: ValueConverter | undefined, val: unknown): unknown {
    const { read } = converterToAlias(c);
    return read ? compileExpression(read)(val) : val;
}
