"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var utils = __toESM(require("@iobroker/adapter-core"));
var import_createMode = require("./lib/alias/createMode");
var import_HistoryBackend = require("./lib/history/HistoryBackend");
var import_access = require("./lib/access");
var import_MigrationRunner = require("./lib/migration/MigrationRunner");
var import_references = require("./lib/refs/references");
var import_settings = require("./lib/settings/settings");
const PREVIEW_RANGES_MAX_AGE = 3e5;
function idList(ids) {
  if (!Array.isArray(ids)) {
    return [];
  }
  return ids.filter(import_MigrationRunner.isValidId).slice(0, 2e3);
}
class Objectmigrator extends utils.Adapter {
  backend;
  runner;
  constructor(options = {}) {
    super({
      ...options,
      name: "objectmigrator"
    });
    this.on("ready", this.onReady.bind(this));
    this.on("message", this.onMessage.bind(this));
    this.on("unload", this.onUnload.bind(this));
  }
  async onReady() {
    const historyInstance = this.config.historyInstance || "history.0";
    this.backend = new import_HistoryBackend.HistoryAdapterBackend(historyInstance, {
      sendTo: (instance, command, message, timeout) => this.sendToAsync(instance, command, message, { timeout }),
      getForeignState: (id) => this.getForeignStateAsync(id)
    });
    this.runner = new import_MigrationRunner.MigrationRunner(this, this.backend, {
      chunkSize: Number(this.config.chunkSize) || 5e3,
      chunkPauseMs: Number(this.config.chunkPauseMs) || 0,
      copyUninstalledSettings: this.config.copyUninstalledSettings !== false
    });
    await this.runner.init();
    if (!await this.backend.isAlive()) {
      this.log.warn(`History instance ${historyInstance} is not running - history migration is not possible`);
    }
    this.log.info(`Ready. History instance: ${historyInstance}`);
  }
  async onUnload(callback) {
    var _a;
    try {
      await ((_a = this.runner) == null ? void 0 : _a.stop());
    } catch (e) {
      this.log.error(`Error during unloading: ${e.message}`);
    }
    callback();
  }
  /** Message API for the admin tab (07 §3) */
  handlers = {
    // ---- history
    "history.status": async () => ({
      instance: this.backend.instance,
      alive: await this.backend.isAlive()
    }),
    "history.range": async (msg) => {
      return this.backend.getRanges(idList(msg == null ? void 0 : msg.ids), (msg == null ? void 0 : msg.fresh) ? 0 : PREVIEW_RANGES_MAX_AGE);
    },
    // raw values for the preview (FR-90) - limited per ID
    "history.preview": async (msg) => {
      var _a;
      const limit = Math.min((_a = msg.limit) != null ? _a : import_HistoryBackend.MAX_RAW_PAGE, import_HistoryBackend.MAX_RAW_PAGE * 4);
      const result = {};
      for (const id of idList(msg == null ? void 0 : msg.ids)) {
        const entries = await this.backend.readRange(id, { start: Number(msg.start), end: Number(msg.end) });
        result[id] = { total: entries.length, entries: entries.slice(0, limit) };
      }
      return result;
    },
    // min/max per interval for large series (FR-95) - raw values if the range is small
    "history.aggregate": async (msg) => {
      const points = Math.min(Math.max(Number(msg.points) || 1e3, 10), 5e3);
      const ids = idList(msg == null ? void 0 : msg.ids);
      const ranges = await this.backend.getRanges(ids, PREVIEW_RANGES_MAX_AGE);
      const result = {};
      for (const id of ids) {
        const range = ranges[id];
        if (!range) {
          result[id] = { count: 0, raw: true, entries: [] };
          continue;
        }
        const window = { start: Math.max(msg.start, range.start), end: Math.min(msg.end, range.end) };
        const share = (window.end - window.start) / Math.max(1, range.end - range.start);
        if (range.count * share <= points * 2 || !this.backend.readAggregated) {
          const entries = await this.backend.readRange(id, window);
          result[id] = { count: range.count, raw: true, entries: entries.slice(0, import_HistoryBackend.MAX_RAW_PAGE * 4) };
        } else {
          const entries = await this.backend.readAggregated(id, window, points);
          result[id] = { count: range.count, raw: false, entries };
        }
      }
      return { ranges, series: result };
    },
    // ---- settings
    "settings.instances": async () => (0, import_settings.instanceStatusMap)(await this.getForeignObjectsAsync("system.adapter.*", "instance")),
    "settings.plan": async (msg) => {
      if (!(0, import_MigrationRunner.isValidId)(msg == null ? void 0 : msg.sourceId) || msg.targetId !== void 0 && !(0, import_MigrationRunner.isValidId)(msg.targetId)) {
        throw new Error("Invalid ID");
      }
      const source = await this.getForeignObjectAsync(msg.sourceId);
      if (!source) {
        throw new Error(`${msg.sourceId} not found`);
      }
      const target = msg.targetId ? await this.getForeignObjectAsync(msg.targetId) : void 0;
      const instances = (0, import_settings.instanceStatusMap)(await this.getForeignObjectsAsync("system.adapter.*", "instance"));
      return (0, import_settings.planSettings)(source, target != null ? target : void 0, instances, {
        copyUninstalled: this.config.copyUninstalledSettings !== false,
        ...msg.options
      });
    },
    // ---- create mode
    "mirror.preview": async (msg) => {
      var _a;
      const errors = (0, import_createMode.validateBasePath)(String((_a = msg == null ? void 0 : msg.basePath) != null ? _a : ""));
      if (!(0, import_MigrationRunner.isValidId)(msg == null ? void 0 : msg.sourceRoot)) {
        errors.push({ code: "invalidId", args: { value: String(msg == null ? void 0 : msg.sourceRoot) } });
      }
      if (errors.length) {
        return { errors, drafts: [] };
      }
      const objects = await this.getSubtree(msg.sourceRoot);
      const root = await this.getForeignObjectAsync(msg.sourceRoot);
      if (root) {
        objects[msg.sourceRoot] = root;
      }
      const existing = await this.getSubtree(msg.basePath);
      const existingIds = new Set(Object.keys(existing));
      for (let parts = msg.basePath.split("."); parts.length > 2; parts.pop()) {
        if (await this.getForeignObjectAsync(parts.join("."))) {
          existingIds.add(parts.join("."));
        }
      }
      return {
        errors: [],
        drafts: (0, import_createMode.mirrorStructure)(msg.sourceRoot, objects, msg.basePath, {
          existingIds,
          onlySourceIds: msg.onlySourceIds ? new Set(idList(msg.onlySourceIds)) : void 0
        })
      };
    },
    // ---- "Prüfen" / "Schreiben" (06 §5)
    "plan.check": (msg) => this.runner.check(msg),
    "plan.write": (msg) => this.runner.write(msg),
    "run.cancel": () => {
      this.runner.cancel();
      return Promise.resolve(this.runner.getCurrent());
    },
    "run.abort": () => {
      this.runner.abort();
      return Promise.resolve(this.runner.getCurrent());
    },
    "run.status": (msg) => (msg == null ? void 0 : msg.runId) ? this.runner.loadRun(msg.runId) : Promise.resolve(this.runner.getCurrent()),
    "run.list": () => this.runner.listRuns(),
    "run.rollbackPlan": (msg) => this.runner.rollbackPlan(msg == null ? void 0 : msg.runId),
    "run.rollback": (msg) => {
      if (!(0, import_MigrationRunner.isRunId)(msg == null ? void 0 : msg.runId)) {
        throw new Error("Invalid run ID");
      }
      return this.runner.rollback(msg.runId);
    },
    // ---- where are the IDs used (FR-70)
    "refs.find": async (msg) => (0, import_references.findReferences)(idList(msg == null ? void 0 : msg.ids), await this.referenceSources()),
    // DB names (aliasId) of the logging instances (FR-57) - with the values under the name at the history instance
    "dbNames.list": async () => {
      var _a, _b;
      const view = await this.getObjectViewAsync("system", "custom", {});
      const rows = [];
      for (const row of (_a = view == null ? void 0 : view.rows) != null ? _a : []) {
        const custom = (_b = row.value) != null ? _b : {};
        for (const [instance, cfg] of Object.entries(custom)) {
          const name = typeof (cfg == null ? void 0 : cfg.aliasId) === "string" ? cfg.aliasId.trim() : "";
          if (/^(history|sql|influxdb)\.\d+$/.test(instance) && name && name !== row.id) {
            rows.push({ id: row.id, instance, name, enabled: (cfg == null ? void 0 : cfg.enabled) !== false });
          }
        }
      }
      const names = rows.filter((r) => r.instance === this.backend.instance).map((r) => r.name);
      const ranges = names.length && await this.backend.isAlive() ? await this.backend.getRanges(names) : {};
      return rows.map((r) => ({ ...r, range: r.instance === this.backend.instance ? ranges[r.name] : void 0 })).sort((a, b) => a.id.localeCompare(b.id) || a.instance.localeCompare(b.instance));
    },
    // ---- templates of the create mode
    "template.list": () => this.runner.listTemplates(),
    "template.save": (msg) => this.runner.saveTemplate(msg.name, msg.template),
    "template.load": (msg) => this.runner.loadTemplate(msg.name),
    "template.delete": (msg) => this.runner.deleteTemplate(msg.name),
    // ---- drafts of the editor (WR-01)
    "plan.save": (msg) => {
      var _a;
      return this.runner.savePlan(
        String((_a = msg == null ? void 0 : msg.name) != null ? _a : "current"),
        msg == null ? void 0 : msg.plan,
        typeof (msg == null ? void 0 : msg.baseVersion) === "number" ? msg.baseVersion : void 0
      );
    },
    "plan.load": (msg) => {
      var _a;
      return this.runner.loadPlan((_a = msg == null ? void 0 : msg.name) != null ? _a : "current");
    }
  };
  /**
   * All objects below an ID. Without a type js-controller returns only states, so the four
   * structure types are read one after the other.
   *
   * @param root - parent ID
   */
  async getSubtree(root) {
    const result = {};
    for (const type of ["state", "channel", "device", "folder"]) {
      Object.assign(result, await this.getForeignObjectsAsync(`${root}.*`, type));
    }
    return result;
  }
  /** Texts of all places that may use object IDs (FR-70) */
  async referenceSources() {
    var _a;
    const sources = [];
    const name = (common) => {
      const n = common == null ? void 0 : common.name;
      return typeof n === "string" ? n : n && typeof n === "object" ? JSON.stringify(n) : void 0;
    };
    const scripts = await this.getForeignObjectsAsync("script.js.*", "script");
    for (const [id, obj] of Object.entries(scripts)) {
      const source = obj.common.source;
      if (source) {
        sources.push({
          kind: "script",
          location: id,
          name: name(obj.common),
          text: source
        });
      }
    }
    const instances = await this.getForeignObjectsAsync("system.adapter.*", "instance");
    for (const [id, obj] of Object.entries(instances)) {
      if (id === `system.adapter.${this.namespace}` || !obj.native) {
        continue;
      }
      sources.push({ kind: "instance", location: id, text: JSON.stringify(obj.native) });
      const instance = id.replace(/^system\.adapter\./, "");
      if (instance.startsWith("lovelace.")) {
        const config = await this.getForeignObjectAsync(`${instance}.configuration`);
        if (config) {
          sources.push({ kind: "lovelace", location: config._id, text: JSON.stringify((_a = config.native) != null ? _a : {}) });
        }
      }
      const adapter = instance.split(".")[0];
      if (adapter === "vis" || adapter === "vis-2") {
        try {
          const projects = await this.readDirAsync(instance, "");
          for (const project of projects.filter((p) => p.isDir)) {
            try {
              const file = await this.readFileAsync(instance, `${project.file}/vis-views.json`);
              sources.push({
                kind: "vis",
                location: `${instance}/${project.file}`,
                text: file.file.toString()
              });
            } catch {
            }
          }
        } catch {
        }
      }
    }
    const aliases = await this.getForeignObjectsAsync("alias.*", "state");
    for (const [id, obj] of Object.entries(aliases)) {
      const alias = obj.common.alias;
      if (alias) {
        sources.push({ kind: "alias", location: id, text: JSON.stringify(alias) });
      }
    }
    const enums = await this.getForeignObjectsAsync("enum.*", "enum");
    for (const [id, obj] of Object.entries(enums)) {
      const members = obj.common.members;
      if (members == null ? void 0 : members.length) {
        sources.push({
          kind: "enum",
          location: id,
          name: name(obj.common),
          text: JSON.stringify(members)
        });
      }
    }
    return sources;
  }
  async onMessage(obj) {
    if (!(obj == null ? void 0 : obj.command)) {
      return;
    }
    const handler = Object.hasOwn(this.handlers, obj.command) ? this.handlers[obj.command] : void 0;
    let response;
    if (!(0, import_access.isAllowedSender)(obj.from)) {
      this.log.warn(
        `Message "${obj.command}" from ${obj.from} rejected - only the admin may control the migrator`
      );
      response = { ok: false, error: { code: "FORBIDDEN", message: "Only the admin may control the migrator" } };
    } else if (!handler) {
      response = { ok: false, error: { code: "UNKNOWN_COMMAND", message: `Unknown command ${obj.command}` } };
    } else if (!this.backend || !this.runner) {
      response = { ok: false, error: { code: "NOT_READY", message: "Adapter is not ready yet" } };
    } else {
      try {
        response = { ok: true, data: await handler(obj.message) };
      } catch (e) {
        this.log.warn(`${obj.command} failed: ${e.message}`);
        response = { ok: false, error: { code: "FAILED", message: e.message } };
      }
    }
    if (obj.callback) {
      this.sendTo(obj.from, obj.command, response, obj.callback);
    }
  }
}
if (require.main !== module) {
  module.exports = (options) => new Objectmigrator(options);
} else {
  (() => new Objectmigrator())();
}
//# sourceMappingURL=main.js.map
