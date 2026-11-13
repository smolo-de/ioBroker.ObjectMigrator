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
var transfer_exports = {};
__export(transfer_exports, {
  nextDay: () => nextDay,
  runTransfer: () => runTransfer,
  startOfDay: () => startOfDay,
  taskRange: () => taskRange
});
module.exports = __toCommonJS(transfer_exports);
var import_merge = require("./merge");
var import_types = require("./types");
const DAY = 24 * 60 * 60 * 1e3;
function startOfDay(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
function nextDay(dayStart) {
  const d = new Date(dayStart + DAY + 2 * 60 * 60 * 1e3);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function taskRange(ranges, limit) {
  var _a, _b;
  const valid = ranges.filter((r) => !!r);
  if (!valid.length) {
    return void 0;
  }
  const start = Math.max(Math.min(...valid.map((r) => r.start)), (_a = limit == null ? void 0 : limit.start) != null ? _a : Number.MIN_SAFE_INTEGER);
  const end = Math.min(Math.max(...valid.map((r) => r.end)), (_b = limit == null ? void 0 : limit.end) != null ? _b : Number.MAX_SAFE_INTEGER);
  return start <= end ? { start, end } : void 0;
}
async function runTransfer(backend, task, options) {
  var _a, _b, _c, _d;
  const sleep = (_a = options.sleep) != null ? _a : defaultSleep;
  const chunkSize = Math.max(1, Math.min(options.chunkSize || 5e3, 5e3));
  const isCancelled = (_b = options.isCancelled) != null ? _b : (() => false);
  const result = { target: task.target, stats: (0, import_types.emptyStats)() };
  const ids = [...task.sources.map((s) => s.id), task.target];
  const known = options.ranges && ids.every((id) => id in options.ranges) ? options.ranges : await backend.getRanges(ids);
  const sourceRanges = {};
  for (const source of task.sources) {
    sourceRanges[source.id] = known[source.id];
  }
  const before = known[task.target];
  result.targetRangeBefore = before ? { start: before.start, end: before.end } : void 0;
  const range = taskRange(Object.values(sourceRanges), task.range);
  if (!range) {
    return result;
  }
  const exclude = (0, import_merge.resolveOverlap)(task.sources, sourceRanges, task.overlap);
  const excluded = ((_c = task.excluded) == null ? void 0 : _c.length) ? new Set(task.excluded) : void 0;
  const activeSources = task.sources.filter((s) => sourceRanges[s.id]);
  const total = Math.max(1, range.end - range.start);
  let buffer = [];
  const flush = async (all) => {
    var _a2, _b2, _c2, _d2;
    while (buffer.length >= chunkSize || all && buffer.length) {
      if (!all && isCancelled()) {
        return false;
      }
      const chunk = buffer.slice(0, chunkSize);
      buffer = buffer.slice(chunkSize);
      await backend.store(task.target, chunk);
      result.written = {
        start: Math.min((_b2 = (_a2 = result.written) == null ? void 0 : _a2.start) != null ? _b2 : chunk[0].ts, chunk[0].ts),
        end: Math.max((_d2 = (_c2 = result.written) == null ? void 0 : _c2.end) != null ? _d2 : chunk[chunk.length - 1].ts, chunk[chunk.length - 1].ts)
      };
      if (options.pauseMs > 0) {
        await sleep(options.pauseMs);
      }
    }
    return true;
  };
  for (let day = startOfDay(range.start); day <= range.end; day = nextDay(day)) {
    if (isCancelled()) {
      await flush(true);
      return { ...result, cancelled: true };
    }
    const window = {
      start: Math.max(day, range.start),
      end: Math.min(nextDay(day) - 1, range.end)
    };
    const entries = {};
    let any = false;
    for (const source of activeSources) {
      const r = sourceRanges[source.id];
      if (r.end < window.start || r.start > window.end) {
        continue;
      }
      entries[source.id] = await backend.readRange(source.id, window);
      any || (any = entries[source.id].length > 0);
    }
    if (any) {
      const existing = await backend.readRange(task.target, window);
      const { toWrite, stats } = (0, import_merge.mergeWindow)({
        entries,
        sources: activeSources,
        existingTargetTs: new Set(existing.map((e) => e.ts)),
        exclude,
        excluded,
        keepMarkers: task.keepMarkers
      });
      buffer.push(...toWrite);
      (0, import_types.addStats)(result.stats, stats);
      if (!await flush(false)) {
        await flush(true);
        return { ...result, cancelled: true };
      }
    }
    (_d = options.onProgress) == null ? void 0 : _d.call(options, {
      target: task.target,
      day,
      fraction: Math.min(1, (window.end - range.start) / total),
      stats: result.stats
    });
  }
  await flush(true);
  return result;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  nextDay,
  runTransfer,
  startOfDay,
  taskRange
});
//# sourceMappingURL=transfer.js.map
