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
var createMode_exports = {};
__export(createMode_exports, {
  mirrorStructure: () => mirrorStructure,
  normalizeIdPart: () => normalizeIdPart,
  validateBasePath: () => validateBasePath
});
module.exports = __toCommonJS(createMode_exports);
const FORBIDDEN = /[\][*,;'"`<>\\?\s.]/g;
function normalizeIdPart(part) {
  return part.trim().replace(FORBIDDEN, "_");
}
function validateBasePath(basePath) {
  const errors = [];
  if (!/^alias\.0(\.|$)/.test(basePath)) {
    errors.push({ code: "basePathNotAlias", id: basePath });
  }
  const parts = basePath.split(".");
  parts.forEach((part, i) => {
    if (!part) {
      errors.push({ code: "basePathEmptySegment", id: basePath, args: { pos: i + 1 } });
    } else if (normalizeIdPart(part) !== part) {
      errors.push({ code: "basePathForbidden", id: basePath, args: { part } });
    }
  });
  return errors;
}
const MIRRORED_STATE_COMMON = [
  "name",
  "desc",
  "type",
  "role",
  "unit",
  "min",
  "max",
  "step",
  "states",
  "read",
  "write",
  "def"
];
function mirrorStructure(sourceRoot, objects, basePath, options = {}) {
  var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m;
  const drafts = /* @__PURE__ */ new Map();
  const existing = (_a = options.existingIds) != null ? _a : /* @__PURE__ */ new Set();
  const baseParts = basePath.split(".");
  for (let i = 2; i < baseParts.length; i++) {
    const id = baseParts.slice(0, i + 1).join(".");
    if (existing.has(id)) {
      continue;
    }
    const isLast = i === baseParts.length - 1;
    const type = (_c = (_b = options.basePathTypes) == null ? void 0 : _b[i - 2]) != null ? _c : isLast ? "device" : "folder";
    const rootName = isLast ? (_e = (_d = objects[sourceRoot]) == null ? void 0 : _d.common) == null ? void 0 : _e.name : void 0;
    drafts.set(id, { id, type, common: { name: rootName != null ? rootName : baseParts[i] }, native: {} });
  }
  const prefix = `${sourceRoot}.`;
  const ids = Object.keys(objects).filter((id) => id.startsWith(prefix)).sort();
  const wanted = (id) => {
    if (!options.onlySourceIds) {
      return true;
    }
    if (options.onlySourceIds.has(id)) {
      return true;
    }
    for (const only of options.onlySourceIds) {
      if (only.startsWith(`${id}.`) || id.startsWith(`${only}.`)) {
        return true;
      }
    }
    return false;
  };
  for (const sourceId of ids) {
    const obj = objects[sourceId];
    if (!obj || !wanted(sourceId)) {
      continue;
    }
    const relative = sourceId.slice(prefix.length).split(".").map(normalizeIdPart).join(".");
    const id = `${basePath}.${relative}`;
    const parts = relative.split(".");
    for (let i = 1; i < parts.length; i++) {
      const parentId = `${basePath}.${parts.slice(0, i).join(".")}`;
      if (!drafts.has(parentId) && !existing.has(parentId)) {
        drafts.set(parentId, { id: parentId, type: "folder", common: { name: parts[i - 1] }, native: {} });
      }
    }
    if (existing.has(id)) {
      continue;
    }
    if (obj.type === "state") {
      const common = {};
      const sourceCommon = obj.common;
      for (const attr of MIRRORED_STATE_COMMON) {
        if (sourceCommon[attr] !== void 0) {
          common[attr] = structuredClone(sourceCommon[attr]);
        }
      }
      (_f = common.name) != null ? _f : common.name = parts[parts.length - 1];
      (_g = common.type) != null ? _g : common.type = "mixed";
      (_h = common.role) != null ? _h : common.role = "state";
      (_i = common.read) != null ? _i : common.read = true;
      (_j = common.write) != null ? _j : common.write = false;
      common.alias = { id: sourceId };
      drafts.set(id, { id, type: "state", common, native: {}, sourceId });
    } else if (obj.type === "device" || obj.type === "channel" || obj.type === "folder") {
      const common = { name: (_l = (_k = obj.common) == null ? void 0 : _k.name) != null ? _l : parts[parts.length - 1] };
      if ((_m = obj.common) == null ? void 0 : _m.role) {
        common.role = obj.common.role;
      }
      drafts.set(id, { id, type: obj.type, common, native: {} });
    }
  }
  return [...drafts.values()];
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  mirrorStructure,
  normalizeIdPart,
  validateBasePath
});
//# sourceMappingURL=createMode.js.map
