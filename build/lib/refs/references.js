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
var references_exports = {};
__export(references_exports, {
  countId: () => countId,
  findReferences: () => findReferences
});
module.exports = __toCommonJS(references_exports);
const ID_CHAR = /[\p{L}\p{N}_\-.]/u;
function countId(text, id) {
  var _a, _b;
  let count = 0;
  for (let i = text.indexOf(id); i !== -1; i = text.indexOf(id, i + id.length)) {
    const before = i > 0 ? text[i - 1] : "";
    const after = (_a = text[i + id.length]) != null ? _a : "";
    const continues = after === "." ? ID_CHAR.test((_b = text[i + id.length + 1]) != null ? _b : "") : ID_CHAR.test(after);
    if (!(before && ID_CHAR.test(before)) && !continues) {
      count++;
    }
  }
  return count;
}
function findReferences(ids, sources) {
  const result = {};
  for (const id of ids) {
    result[id] = [];
  }
  for (const src of sources) {
    for (const id of ids) {
      if (src.location === id || !src.text.includes(id)) {
        continue;
      }
      const count = countId(src.text, id);
      if (count) {
        result[id].push({ kind: src.kind, location: src.location, name: src.name, count });
      }
    }
  }
  return result;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  countId,
  findReferences
});
//# sourceMappingURL=references.js.map
