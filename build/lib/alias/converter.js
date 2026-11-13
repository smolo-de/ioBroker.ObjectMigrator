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
var converter_exports = {};
__export(converter_exports, {
  checkExpression: () => checkExpression,
  compileExpression: () => compileExpression,
  convertWith: () => convertWith,
  converterToAlias: () => converterToAlias,
  isConverting: () => isConverting
});
module.exports = __toCommonJS(converter_exports);
var import_expression = require("./expression");
const lit = (v) => JSON.stringify(v);
function isConverting(c) {
  var _a;
  return !!c && !!(((_a = c.read) == null ? void 0 : _a.trim()) || c.map && Object.keys(c.map).length || c.factor !== void 0 && c.factor !== 1 || c.offset !== void 0 && c.offset !== 0 || c.invert || c.to || c.decimals !== void 0 || c.suffix);
}
const round = (expr, decimals) => {
  const p = 10 ** decimals;
  return `Math.round(${expr} * ${p}) / ${p}`;
};
function converterToAlias(c, writeable = false) {
  var _a, _b, _c, _d;
  if (!isConverting(c)) {
    return {};
  }
  if ((_a = c.read) == null ? void 0 : _a.trim()) {
    return { read: c.read.trim(), write: writeable && ((_b = c.write) == null ? void 0 : _b.trim()) ? c.write.trim() : void 0 };
  }
  let e = "val";
  let invertible = true;
  if (c.map && Object.keys(c.map).length) {
    e = `(${lit(c.map)}[String(${e})] ?? ${e})`;
  }
  const factor = (_c = c.factor) != null ? _c : 1;
  const offset = (_d = c.offset) != null ? _d : 0;
  if (factor !== 1 || offset !== 0) {
    e = `(Number(${e}) * ${factor}${offset ? ` + ${offset}` : ""})`;
  }
  if (c.invert) {
    e = `((v) => (typeof v === 'boolean' ? !v : 1 - Number(v)))(${e})`;
  }
  if (c.to === "number") {
    e = `((v) => (typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'))))(${e})`;
    if (c.decimals !== void 0) {
      e = round(e, c.decimals);
    }
  } else if (c.to === "string") {
    e = c.decimals !== void 0 ? `((v) => (isNaN(Number(v)) || v === '' || v === null ? String(v) : Number(v).toFixed(${c.decimals})))(${e})` : `String(${e})`;
    if (c.suffix) {
      e = `${e} + ${lit(c.suffix)}`;
    }
  } else if (c.to === "boolean") {
    e = `((v) => v === true || v === 1 || ['true', '1', 'on', 'an', 'ja', 'yes'].includes(String(v).toLowerCase()))(${e})`;
    invertible = false;
  } else if (c.decimals !== void 0) {
    e = `((v) => (typeof v === 'number' ? ${round("v", c.decimals)} : v))(${e})`;
  }
  const result = { read: e };
  if (writeable && invertible) {
    let w = "val";
    if (c.to === "string") {
      w = `parseFloat(String(${w})${c.suffix ? `.replace(${lit(c.suffix)}, '')` : ""}.replace(',', '.'))`;
    }
    if (c.invert) {
      w = `((v) => (typeof v === 'boolean' ? !v : 1 - Number(v)))(${w})`;
    }
    if (factor !== 1 || offset !== 0) {
      w = `((Number(${w})${offset ? ` - ${offset}` : ""}) / ${factor})`;
    }
    if (c.map && Object.keys(c.map).length) {
      const inverse = {};
      for (const [k, v] of Object.entries(c.map)) {
        inverse[String(v)] = k;
      }
      w = `((v, k) => (k === undefined ? v : isNaN(Number(k)) ? k : Number(k)))(${w}, ${lit(inverse)}[String(${w})])`;
    }
    if (w !== "val") {
      result.write = w;
    }
  }
  return result;
}
function checkExpression(expression) {
  try {
    (0, import_expression.parseFormula)(expression);
    return void 0;
  } catch (e) {
    return e.message;
  }
}
const compiled = /* @__PURE__ */ new Map();
function compileExpression(expression) {
  let fn = compiled.get(expression);
  if (!fn) {
    try {
      fn = (0, import_expression.parseFormula)(expression);
    } catch (e) {
      throw new Error(`Formula not allowed (${e.message}): ${expression}`);
    }
    if (compiled.size > 500) {
      compiled.clear();
    }
    compiled.set(expression, fn);
  }
  return fn;
}
function convertWith(c, val) {
  const { read } = converterToAlias(c);
  return read ? compileExpression(read)(val) : val;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  checkExpression,
  compileExpression,
  convertWith,
  converterToAlias,
  isConverting
});
//# sourceMappingURL=converter.js.map
