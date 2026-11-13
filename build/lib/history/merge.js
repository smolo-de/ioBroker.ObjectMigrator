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
var merge_exports = {};
__export(merge_exports, {
  convertValue: () => convertValue,
  estimateValues: () => estimateValues,
  isLoggingMarker: () => isLoggingMarker,
  mergeWindow: () => mergeWindow,
  resolveOverlap: () => resolveOverlap
});
module.exports = __toCommonJS(merge_exports);
var import_converter = require("../alias/converter");
var import_types = require("./types");
function resolveOverlap(sources, ranges, rule) {
  const result = {};
  for (const s of sources) {
    result[s.id] = [];
  }
  if (rule.type === "prefer") {
    const preferred = ranges[rule.sourceId];
    if (preferred) {
      for (const s of sources) {
        if (s.id !== rule.sourceId) {
          result[s.id].push({ start: preferred.start, end: preferred.end });
        }
      }
    }
  } else if (rule.type === "switch") {
    const withData = sources.filter((s) => ranges[s.id]).sort((a, b) => ranges[a.id].start - ranges[b.id].start);
    for (let i = 0; i < withData.length - 1; i++) {
      result[withData[i].id].push({ start: ranges[withData[i + 1].id].start, end: Number.MAX_SAFE_INTEGER });
    }
  } else if (rule.type === "cut") {
    for (const s of sources) {
      if (rule.oldSourceIds.includes(s.id)) {
        result[s.id].push({ start: rule.at, end: Number.MAX_SAFE_INTEGER });
      } else {
        result[s.id].push({ start: Number.MIN_SAFE_INTEGER, end: rule.at - 1 });
      }
    }
  }
  return result;
}
function convertValue(val, converter) {
  if (!converter || converter.type === "none" || val === null || val === void 0) {
    return val;
  }
  if (converter.type === "expression") {
    return (0, import_converter.compileExpression)(converter.read)(val);
  }
  if (converter.type === "linear") {
    return typeof val === "number" ? val * converter.factor + converter.offset : val;
  }
  if (typeof val === "boolean") {
    return !val;
  }
  if (val === 0 || val === 1) {
    return 1 - val;
  }
  return val;
}
function isLoggingMarker(entry) {
  var _a, _b;
  return entry.val === null && (entry.q === 64 || ((_b = (_a = entry.from) == null ? void 0 : _a.startsWith("system.adapter.history.")) != null ? _b : false));
}
function inRanges(ts, ranges) {
  return !!(ranges == null ? void 0 : ranges.some((r) => ts >= r.start && ts <= r.end));
}
function mergeWindow(input) {
  var _a, _b;
  const stats = (0, import_types.emptyStats)();
  const byTs = /* @__PURE__ */ new Map();
  const ordered = [...input.sources].sort((a, b) => {
    var _a2, _b2;
    return ((_a2 = b.priority) != null ? _a2 : 0) - ((_b2 = a.priority) != null ? _b2 : 0);
  });
  for (const source of ordered) {
    const list = (_a = input.entries[source.id]) != null ? _a : [];
    for (const entry of list) {
      if (!entry || typeof entry.ts !== "number") {
        continue;
      }
      stats.read++;
      if (!input.keepMarkers && isLoggingMarker(entry)) {
        stats.skippedMarker++;
        continue;
      }
      if ((_b = input.excluded) == null ? void 0 : _b.has(`${source.id}|${entry.ts}`)) {
        stats.excluded++;
        continue;
      }
      if (inRanges(entry.ts, input.exclude[source.id])) {
        stats.skippedOverlap++;
        continue;
      }
      if (input.existingTargetTs.has(entry.ts)) {
        stats.skippedExisting++;
        continue;
      }
      if (byTs.has(entry.ts)) {
        stats.skippedDuplicate++;
        continue;
      }
      const out = { val: convertValue(entry.val, source.converter), ts: entry.ts };
      if (entry.ack !== void 0) {
        out.ack = !!entry.ack;
      }
      if (entry.q !== void 0) {
        out.q = entry.q;
      }
      if (entry.from !== void 0) {
        out.from = entry.from;
      }
      byTs.set(entry.ts, out);
    }
  }
  const toWrite = [...byTs.values()].sort((a, b) => a.ts - b.ts);
  stats.written = toWrite.length;
  return { toWrite, stats };
}
function estimateValues(sources, ranges, rule) {
  var _a;
  const exclude = resolveOverlap(sources, ranges, rule);
  const perSource = {};
  let total = 0;
  for (const s of sources) {
    const r = ranges[s.id];
    if (!r || !r.count) {
      perSource[s.id] = 0;
      continue;
    }
    const span = r.end - r.start;
    let excluded = 0;
    for (const e of (_a = exclude[s.id]) != null ? _a : []) {
      const from = Math.max(e.start, r.start);
      const to = Math.min(e.end, r.end);
      if (to >= from) {
        excluded += span > 0 ? (to - from) / span : 1;
      }
    }
    const n = Math.round(r.count * Math.max(0, 1 - Math.min(1, excluded)));
    perSource[s.id] = n;
    total += n;
  }
  return { perSource, total };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  convertValue,
  estimateValues,
  isLoggingMarker,
  mergeWindow,
  resolveOverlap
});
//# sourceMappingURL=merge.js.map
