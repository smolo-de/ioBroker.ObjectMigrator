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
var settings_exports = {};
__export(settings_exports, {
  COPYABLE_COMMON: () => COPYABLE_COMMON,
  HISTORY_ADAPTERS: () => HISTORY_ADAPTERS,
  adapterOfKey: () => adapterOfKey,
  deepMerge: () => deepMerge,
  instanceStatusMap: () => instanceStatusMap,
  planEnums: () => planEnums,
  planSettings: () => planSettings
});
module.exports = __toCommonJS(settings_exports);
const HISTORY_ADAPTERS = ["history", "sql", "influxdb"];
const COPYABLE_COMMON = [
  "name",
  "desc",
  "role",
  "unit",
  "min",
  "max",
  "step",
  "states",
  "icon",
  "color"
];
function adapterOfKey(key) {
  return key.split(".")[0];
}
function isEmpty(value) {
  return value === void 0 || value === null || value === "" || typeof value === "object" && !Object.keys(value).length;
}
function deepMerge(a, b) {
  const result = { ...a };
  for (const [key, value] of Object.entries(b)) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") {
      continue;
    }
    if (value === null) {
      delete result[key];
    } else if (value && typeof value === "object" && !Array.isArray(value) && result[key] && typeof result[key] === "object" && !Array.isArray(result[key])) {
      result[key] = deepMerge(result[key], value);
    } else {
      result[key] = value;
    }
  }
  return result;
}
function planSettings(source, target, instances, options = {}) {
  var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o, _p, _q, _r, _s;
  const plan = { targetCustom: {}, sourceCustom: {}, targetCommon: {}, status: {}, warnings: [] };
  const sourceMode = (_a = options.sourceMode) != null ? _a : "keep";
  const copyUninstalled = (_b = options.copyUninstalled) != null ? _b : true;
  const sourceCustom = (_d = (_c = source.common) == null ? void 0 : _c.custom) != null ? _d : {};
  const targetCustom = (_f = (_e = target == null ? void 0 : target.common) == null ? void 0 : _e.custom) != null ? _f : {};
  for (const [key, settings] of Object.entries(sourceCustom)) {
    if (!settings || typeof settings !== "object") {
      continue;
    }
    if (options.include && !options.include.includes(key)) {
      continue;
    }
    if ((_g = options.exclude) == null ? void 0 : _g.includes(key)) {
      continue;
    }
    const targetKey = (_i = (_h = options.instanceRemap) == null ? void 0 : _h[key]) != null ? _i : key;
    const status = (_j = instances[targetKey]) != null ? _j : "missing";
    if (status === "missing") {
      if (!copyUninstalled) {
        plan.warnings.push({ code: "instanceMissingSkipped", args: { key, instance: targetKey } });
        continue;
      }
      plan.warnings.push({ code: "instanceMissingCopied", args: { key, instance: targetKey } });
    } else if (status === "disabled") {
      plan.warnings.push({ code: "instanceDisabled", args: { key, instance: targetKey } });
    }
    const adapter = adapterOfKey(key);
    let value = structuredClone(settings);
    if (HISTORY_ADAPTERS.includes(adapter)) {
      value.aliasId = "";
    }
    const existing = targetCustom[targetKey];
    if (existing) {
      plan.warnings.push({ code: "targetHasSettings", args: { key: targetKey } });
      value = deepMerge(existing, value);
      if (existing.enabled === true) {
        value.enabled = true;
      }
    }
    const override = (_k = options.overrides) == null ? void 0 : _k[targetKey];
    if (override) {
      value = deepMerge(value, override);
    }
    plan.targetCustom[targetKey] = value;
    plan.status[targetKey] = status;
    if (sourceMode === "remove") {
      plan.sourceCustom[key] = null;
    } else if (sourceMode === "disable") {
      if (!HISTORY_ADAPTERS.includes(adapter)) {
        plan.sourceCustom[key] = null;
      } else if (settings.enabled !== false) {
        plan.sourceCustom[key] = { enabled: false };
      }
    } else if (settings.enabled !== false && value.enabled !== false) {
      if (HISTORY_ADAPTERS.includes(adapter)) {
        plan.warnings.push({ code: "doubleLogging", args: { key } });
      } else if (adapter === "lovelace") {
        plan.warnings.push({ code: "lovelaceDuplicate", args: { key } });
      }
    }
  }
  for (const [key, override] of Object.entries((_l = options.overrides) != null ? _l : {})) {
    if (key in plan.targetCustom || ((_m = options.exclude) == null ? void 0 : _m.includes(key)) || !override) {
      continue;
    }
    plan.targetCustom[key] = deepMerge((_n = targetCustom[key]) != null ? _n : {}, override);
    plan.status[key] = (_o = instances[key]) != null ? _o : "missing";
  }
  const sourceCommon = source.common;
  const targetCommon = (_p = target == null ? void 0 : target.common) != null ? _p : {};
  if (((_q = options.copySmartName) != null ? _q : true) && !isEmpty(sourceCommon.smartName)) {
    plan.targetCommon.smartName = structuredClone(sourceCommon.smartName);
  }
  for (const attr of (_r = options.copyCommon) != null ? _r : []) {
    if (!isEmpty(sourceCommon[attr]) && isEmpty(targetCommon[attr])) {
      plan.targetCommon[attr] = structuredClone(sourceCommon[attr]);
    }
  }
  for (const [attr, value] of Object.entries((_s = options.commonOverrides) != null ? _s : {})) {
    plan.targetCommon[attr] = value;
  }
  return plan;
}
function instanceStatusMap(instanceObjects) {
  const result = {};
  for (const [id, obj] of Object.entries(instanceObjects)) {
    if ((obj == null ? void 0 : obj.type) !== "instance") {
      continue;
    }
    const key = id.replace(/^system\.adapter\./, "");
    result[key] = obj.common.enabled ? "active" : "disabled";
  }
  return result;
}
function planEnums(enums, sourceId, targetId, removeSource) {
  var _a, _b;
  const changes = [];
  for (const [enumId, obj] of Object.entries(enums)) {
    const members = (_b = (_a = obj == null ? void 0 : obj.common) == null ? void 0 : _a.members) != null ? _b : [];
    if (!members.includes(sourceId)) {
      continue;
    }
    let next = members.includes(targetId) ? [...members] : [...members, targetId];
    if (removeSource) {
      next = next.filter((m) => m !== sourceId);
    }
    changes.push({ enumId, members: next });
  }
  return changes;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  COPYABLE_COMMON,
  HISTORY_ADAPTERS,
  adapterOfKey,
  deepMerge,
  instanceStatusMap,
  planEnums,
  planSettings
});
//# sourceMappingURL=settings.js.map
