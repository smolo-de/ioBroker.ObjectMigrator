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
var types_exports = {};
__export(types_exports, {
  addStats: () => addStats,
  emptyStats: () => emptyStats
});
module.exports = __toCommonJS(types_exports);
function emptyStats() {
  return {
    read: 0,
    written: 0,
    skippedExisting: 0,
    skippedDuplicate: 0,
    skippedOverlap: 0,
    excluded: 0,
    skippedMarker: 0
  };
}
function addStats(a, b) {
  a.read += b.read;
  a.written += b.written;
  a.skippedExisting += b.skippedExisting;
  a.skippedDuplicate += b.skippedDuplicate;
  a.skippedOverlap += b.skippedOverlap;
  a.excluded += b.excluded;
  a.skippedMarker += b.skippedMarker;
  return a;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  addStats,
  emptyStats
});
//# sourceMappingURL=types.js.map
