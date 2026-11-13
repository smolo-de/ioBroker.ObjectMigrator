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
var MigrationRunner_exports = {};
__export(MigrationRunner_exports, {
  MigrationRunner: () => MigrationRunner,
  isRunId: () => isRunId,
  isValidDbName: () => isValidDbName,
  isValidId: () => isValidId,
  safeName: () => safeName,
  validatePlan: () => validatePlan
});
module.exports = __toCommonJS(MigrationRunner_exports);
var import_converter = require("../alias/converter");
var import_createMode = require("../alias/createMode");
var import_merge = require("../history/merge");
var import_transfer = require("../history/transfer");
var import_messages = require("../messages");
var import_settings = require("../settings/settings");
const MAX_LOG = 5e3;
const LOG_PROGRESS_MS = 1e4;
const localDay = (ts) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const RUN_DIR = "runs";
const BACKUP_DIR = "backups";
const CHECK_RANGES_MAX_AGE = 12e4;
function safeName(name) {
  return name.replace(/[^\w.\-äöüÄÖÜß ]/g, "_").trim() || "unnamed";
}
function isRunId(id) {
  return typeof id === "string" && /^run-[0-9T-]+Z$/.test(id);
}
function isValidId(id) {
  return typeof id === "string" && id.length > 2 && id.length <= 500 && id.includes(".") && !id.startsWith(".") && !id.endsWith(".") && !id.includes("..") && // forbidden in ioBroker IDs (js-controller FORBIDDEN_CHARS) and control characters
  // eslint-disable-next-line no-control-regex
  !/[*,;'"`<>\\?[\]\u0000-\u001f]/.test(id);
}
function isValidDbName(name) {
  return typeof name === "string" && name.trim() === name && name.length > 0 && name.length <= 500 && !name.includes("..") && // eslint-disable-next-line no-control-regex
  !/[/*,;'"`<>\\?[\]\u0000-\u001f]/.test(name);
}
function dbNames(n, custom) {
  var _a;
  const current = typeof custom.aliasId === "string" && custom.aliasId.trim() ? custom.aliasId.trim() : "";
  return { from: current || n.id, to: ((_a = n.to) == null ? void 0 : _a.trim()) || n.id };
}
function validatePlan(plan) {
  var _a, _b, _c, _d, _e, _f;
  const errors = [];
  const text = (value) => {
    var _a2;
    return typeof value === "string" ? value : (_a2 = JSON.stringify(value)) != null ? _a2 : "undefined";
  };
  const id = (value) => {
    if (!isValidId(value)) {
      errors.push({ code: "invalidId", args: { value: text(value) } });
    }
  };
  const aliasId = (value) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const v = value;
      id(v.read);
      id(v.write);
    } else {
      id(value);
    }
  };
  const expr = (value, owner) => {
    if (value === void 0 || value === null || value === "") {
      return;
    }
    const reason = typeof value === "string" ? (0, import_converter.checkExpression)(value) : "not a text";
    if (reason) {
      errors.push({ code: "invalidExpression", id: owner, args: { value: text(value), reason } });
    }
  };
  if (!plan || typeof plan !== "object") {
    return [{ code: "invalidId", args: { value: "plan" } }];
  }
  for (const d of Array.isArray(plan.drafts) ? plan.drafts : []) {
    id(d == null ? void 0 : d.id);
    const alias = (_a = d == null ? void 0 : d.common) == null ? void 0 : _a.alias;
    if ((alias == null ? void 0 : alias.id) !== void 0) {
      aliasId(alias.id);
    }
    expr(alias == null ? void 0 : alias.read, d == null ? void 0 : d.id);
    expr(alias == null ? void 0 : alias.write, d == null ? void 0 : d.id);
  }
  for (const m of Array.isArray(plan.mappings) ? plan.mappings : []) {
    id(m == null ? void 0 : m.targetId);
    if ((m == null ? void 0 : m.sourceId) !== void 0) {
      id(m.sourceId);
    }
    ((_b = m == null ? void 0 : m.disableHistoryAt) != null ? _b : []).forEach(id);
  }
  for (const t of Array.isArray(plan.tasks) ? plan.tasks : []) {
    id(t == null ? void 0 : t.target);
    for (const s of Array.isArray(t == null ? void 0 : t.sources) ? t.sources : []) {
      id(s == null ? void 0 : s.id);
      if (((_c = s == null ? void 0 : s.converter) == null ? void 0 : _c.type) === "expression") {
        expr(s.converter.read, t.target);
      }
    }
  }
  for (const n of Array.isArray(plan.dbNames) ? plan.dbNames : []) {
    id(n == null ? void 0 : n.id);
    if (typeof (n == null ? void 0 : n.instance) !== "string" || !/^(history|sql|influxdb)\.\d+$/.test(n.instance)) {
      errors.push({ code: "dbNameInstance", args: { instance: text(n == null ? void 0 : n.instance) } });
    }
    if ((n == null ? void 0 : n.to) !== "" && (n == null ? void 0 : n.to) !== void 0 && !isValidDbName(n.to)) {
      errors.push({ code: "invalidId", args: { value: text(n.to) } });
    }
  }
  for (const a of Array.isArray(plan.aliases) ? plan.aliases : []) {
    id(a == null ? void 0 : a.targetId);
    aliasId((_d = a == null ? void 0 : a.alias) == null ? void 0 : _d.id);
    expr((_e = a == null ? void 0 : a.alias) == null ? void 0 : _e.read, a == null ? void 0 : a.targetId);
    expr((_f = a == null ? void 0 : a.alias) == null ? void 0 : _f.write, a == null ? void 0 : a.targetId);
  }
  return errors;
}
class MigrationRunner {
  /**
   * @param adapter - the adapter instance
   * @param backend - the history instance
   * @param config - throttling and options
   */
  constructor(adapter, backend, config) {
    this.adapter = adapter;
    this.backend = backend;
    this.config = config;
  }
  current;
  cancelRequested = false;
  /** Creates the progress states and the file storage */
  async init() {
    await this.adapter.setForeignObjectNotExistsAsync(this.adapter.namespace, {
      type: "meta",
      common: { name: "Object Migrator files", type: "meta.user" },
      native: {}
    });
    await this.adapter.setObjectNotExistsAsync("run", {
      type: "channel",
      common: { name: "Migration (Schreiben)" },
      native: {}
    });
    const states = {
      "run.id": { name: "Current/last run", type: "string", role: "text", read: true, write: false },
      "run.status": { name: "Status", type: "string", role: "text", read: true, write: false },
      "run.phase": { name: "Step", type: "string", role: "text", read: true, write: false },
      "run.progress": {
        name: "Progress",
        type: "number",
        role: "value",
        unit: "%",
        min: 0,
        max: 100,
        read: true,
        write: false
      },
      "run.current": { name: "Current target", type: "string", role: "text", read: true, write: false },
      "run.info": { name: "Details (JSON)", type: "string", role: "json", read: true, write: false },
      "run.log": { name: "Last line of the log (JSON)", type: "string", role: "json", read: true, write: false }
    };
    for (const [id, common] of Object.entries(states)) {
      await this.adapter.setObjectNotExistsAsync(id, { type: "state", common, native: {} });
    }
    const status = await this.adapter.getStateAsync("run.status");
    if ((status == null ? void 0 : status.val) === "running") {
      await this.adapter.setStateAsync("run.status", "cancelled", true);
    }
  }
  /** Current or last run of this adapter start */
  getCurrent() {
    return this.current;
  }
  /** Is a run active */
  isRunning() {
    var _a;
    return ((_a = this.current) == null ? void 0 : _a.status) === "running";
  }
  // ------------------------------------------------------------------ storage
  async writeJson(path, data) {
    await this.adapter.writeFileAsync(this.adapter.namespace, path, JSON.stringify(data));
  }
  async readJson(path) {
    try {
      const res = await this.adapter.readFileAsync(this.adapter.namespace, path);
      return JSON.parse(res.file.toString());
    } catch {
      return void 0;
    }
  }
  /**
   * Stores the draft of the mapping editor (WR-01) - nothing is written to the objects.
   * With `baseVersion` the plan is only stored if nobody saved it in between (two open tabs).
   *
   * @param name - plan name
   * @param plan - editor state, stored as it is
   * @param baseVersion - version the editor loaded; undefined overwrites
   */
  async savePlan(name, plan, baseVersion) {
    var _a;
    const path = `plans/${safeName(name)}.json`;
    const current = await this.readJson(path);
    const currentVersion = (_a = current == null ? void 0 : current.version) != null ? _a : 0;
    if (baseVersion !== void 0 && current && baseVersion !== currentVersion) {
      return { version: currentVersion, conflict: true, savedAt: current.savedAt };
    }
    const version = currentVersion + 1;
    await this.writeJson(path, { savedAt: Date.now(), version, plan });
    return { version };
  }
  /**
   * Loads a stored draft
   *
   * @param name - plan name
   */
  async loadPlan(name) {
    return this.readJson(`plans/${safeName(name)}.json`);
  }
  /** Names of the stored templates (structure templates of the create mode) */
  async listTemplates() {
    try {
      const files = await this.adapter.readDirAsync(this.adapter.namespace, "templates");
      return files.filter((f) => !f.isDir && f.file.endsWith(".json")).map((f) => f.file.replace(/\.json$/, "")).sort();
    } catch {
      return [];
    }
  }
  /**
   * Stores a template
   *
   * @param name - template name
   * @param template - nodes and settings, stored as they are
   */
  async saveTemplate(name, template) {
    await this.writeJson(`templates/${safeName(name)}.json`, template);
  }
  /** @param name - template name */
  async loadTemplate(name) {
    return this.readJson(`templates/${safeName(name)}.json`);
  }
  /** @param name - template name */
  async deleteTemplate(name) {
    await this.adapter.delFileAsync(this.adapter.namespace, `templates/${safeName(name)}.json`);
  }
  async saveRun() {
    if (this.current) {
      await this.writeJson(`${RUN_DIR}/${this.current.id}.json`, this.current);
    }
  }
  /**
   * Loads a stored run (report, rollback)
   *
   * @param id - run ID
   */
  async loadRun(id) {
    var _a;
    if (!isRunId(id)) {
      throw new Error("Invalid run ID");
    }
    return ((_a = this.current) == null ? void 0 : _a.id) === id ? this.current : this.readJson(`${RUN_DIR}/${id}.json`);
  }
  /** All stored runs, newest first ("Verlauf") */
  async listRuns() {
    var _a, _b, _c, _d;
    let files = [];
    try {
      files = await this.adapter.readDirAsync(this.adapter.namespace, RUN_DIR);
    } catch {
      return [];
    }
    const result = [];
    for (const f of files) {
      const id = f.file.replace(/\.json$/, "");
      if (f.isDir || !isRunId(id)) {
        continue;
      }
      const run = await this.loadRun(id);
      if (!run) {
        continue;
      }
      const stats = run.results.filter((r) => r == null ? void 0 : r.stats).map((r) => r.stats);
      result.push({
        id: run.id,
        status: run.status,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        rolledBackAt: run.rolledBackAt,
        created: run.createdIds.length,
        settings: (_b = (_a = run.plan.mappings) == null ? void 0 : _a.length) != null ? _b : 0,
        targets: (_d = (_c = run.plan.tasks) == null ? void 0 : _c.length) != null ? _d : 0,
        written: stats.reduce((n, s) => n + s.written, 0),
        skippedExisting: stats.reduce((n, s) => n + s.skippedExisting, 0),
        error: run.error
      });
    }
    return result.sort((a, b) => b.startedAt - a.startedAt);
  }
  async publish(progress, currentTarget) {
    var _a, _b;
    const run = this.current;
    if (!run) {
      return;
    }
    await this.adapter.setStateAsync("run.id", run.id, true);
    await this.adapter.setStateAsync("run.status", run.status, true);
    await this.adapter.setStateAsync("run.phase", run.phase, true);
    if (progress !== void 0) {
      await this.adapter.setStateAsync("run.progress", Math.round(progress * 1e3) / 10, true);
    }
    if (currentTarget !== void 0) {
      await this.adapter.setStateAsync("run.current", currentTarget, true);
    }
    await this.adapter.setStateAsync(
      "run.info",
      JSON.stringify({
        id: run.id,
        status: run.status,
        phase: run.phase,
        taskIndex: run.taskIndex,
        tasks: (_b = (_a = run.plan.tasks) == null ? void 0 : _a.length) != null ? _b : 0,
        results: run.results.map((r) => ({ target: r.target, cancelled: r.cancelled, ...r.stats })),
        error: run.error
      }),
      true
    );
  }
  // ------------------------------------------------------------------ "Prüfen"
  async instanceStatus() {
    return (0, import_settings.instanceStatusMap)(await this.adapter.getForeignObjectsAsync("system.adapter.*", "instance"));
  }
  /**
   * "Prüfen": shows everything that would happen, writes nothing (WR-02)
   *
   * @param plan - the plan of the editor
   * @param options - fresh: read the history ranges again (before "Schreiben")
   * @param options.fresh - do not use cached history ranges
   */
  async check(plan, options = {}) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o;
    const result = {
      ok: true,
      errors: [],
      warnings: [],
      historyInstance: this.backend.instance,
      historyAlive: await this.backend.isAlive(),
      objects: [],
      settings: [],
      aliases: [],
      history: []
    };
    result.errors.push(...validatePlan(plan));
    if (result.errors.length) {
      result.ok = false;
      return result;
    }
    const draftIds = /* @__PURE__ */ new Set();
    for (const draft of (_a = plan.drafts) != null ? _a : []) {
      if (draftIds.has(draft.id)) {
        result.errors.push({ code: "draftDuplicate", id: draft.id });
      }
      draftIds.add(draft.id);
      result.errors.push(...(0, import_createMode.validateBasePath)(draft.id));
      const existing = await this.adapter.getForeignObjectAsync(draft.id);
      result.objects.push({ id: draft.id, action: existing ? "exists" : "create" });
      if (existing && existing.type !== draft.type) {
        result.errors.push({ code: "draftTypeConflict", id: draft.id, args: { type: existing.type } });
      }
      const alias = draft.common.alias;
      if (!existing && draft.type === "state" && draft.id.startsWith("alias.") && !(alias == null ? void 0 : alias.id)) {
        result.warnings.push({ code: "draftNoSource", id: draft.id });
      }
    }
    const instances = await this.instanceStatus();
    const enums = await this.adapter.getForeignObjectsAsync("enum.*", "enum");
    for (const mapping of (_b = plan.mappings) != null ? _b : []) {
      const source = mapping.sourceId ? await this.adapter.getForeignObjectAsync(mapping.sourceId) : { common: {} };
      if (!source) {
        result.errors.push({
          code: "sourceMissing",
          id: mapping.targetId,
          args: { source: mapping.sourceId }
        });
        continue;
      }
      const target = (_d = await this.adapter.getForeignObjectAsync(mapping.targetId)) != null ? _d : (_c = plan.drafts) == null ? void 0 : _c.find((d) => d.id === mapping.targetId);
      if (!target) {
        result.errors.push({ code: "targetMissing", id: mapping.targetId });
        continue;
      }
      const settingsPlan = (0, import_settings.planSettings)(source, target, instances, {
        copyUninstalled: this.config.copyUninstalledSettings,
        ...mapping.options
      });
      result.warnings.push(...settingsPlan.warnings.map((w) => ({ ...w, id: mapping.targetId })));
      const enumChanges = mapping.enums === false || !mapping.sourceId ? [] : (0, import_settings.planEnums)(enums, mapping.sourceId, mapping.targetId, ((_e = mapping.options) == null ? void 0 : _e.sourceMode) === "remove");
      result.settings.push({ ...mapping, plan: settingsPlan, enumChanges });
    }
    for (const update of (_f = plan.aliases) != null ? _f : []) {
      if (!update.targetId.startsWith("alias.")) {
        result.errors.push({ code: "aliasNotAlias", id: update.targetId });
        continue;
      }
      const obj = await this.adapter.getForeignObjectAsync(update.targetId);
      if (!obj) {
        if (!draftIds.has(update.targetId)) {
          result.errors.push({ code: "aliasTargetMissing", id: update.targetId });
        }
        continue;
      }
      result.aliases.push({
        targetId: update.targetId,
        from: obj.common.alias,
        to: update.alias
      });
    }
    if ((_g = plan.dbNames) == null ? void 0 : _g.length) {
      result.dbNames = [];
      for (const n of plan.dbNames) {
        const obj = await this.adapter.getForeignObjectAsync(n.id);
        const custom = (_i = (_h = obj == null ? void 0 : obj.common) == null ? void 0 : _h.custom) == null ? void 0 : _i[n.instance];
        if (!custom) {
          result.errors.push({ code: "dbNameNoSettings", id: n.id, args: { instance: n.instance } });
          continue;
        }
        const { from, to } = dbNames(n, custom);
        if (from === to) {
          result.warnings.push({ code: "dbNameUnchanged", id: n.id, args: { name: to } });
        }
        const move = !!n.moveValues && n.instance === this.backend.instance && from !== to;
        if (n.moveValues && n.instance !== this.backend.instance) {
          result.warnings.push({
            code: "dbNameNoMove",
            id: n.id,
            args: { instance: n.instance, history: this.backend.instance }
          });
        }
        if (move && !result.historyAlive) {
          result.errors.push({ code: "historyNotRunning", args: { instance: this.backend.instance } });
        }
        const range = move ? (await this.backend.getRanges([from], options.fresh ? 0 : CHECK_RANGES_MAX_AGE))[from] : void 0;
        result.dbNames.push({ id: n.id, instance: n.instance, from, to, move, range });
      }
    }
    if (((_k = (_j = plan.tasks) == null ? void 0 : _j.length) != null ? _k : 0) > 0 && !result.historyAlive) {
      result.errors.push({ code: "historyNotRunning", args: { instance: this.backend.instance } });
    }
    const ranges = result.historyAlive && ((_l = plan.tasks) == null ? void 0 : _l.length) ? await this.backend.getRanges(
      plan.tasks.flatMap((t) => [t.target, ...t.sources.map((s) => s.id)]),
      options.fresh ? 0 : CHECK_RANGES_MAX_AGE
    ) : {};
    const targets = /* @__PURE__ */ new Set();
    for (const task of (_m = plan.tasks) != null ? _m : []) {
      if (targets.has(task.target)) {
        result.errors.push({ code: "taskTargetTwice", id: task.target });
      }
      targets.add(task.target);
      const seen = /* @__PURE__ */ new Set();
      for (const s of task.sources) {
        if (seen.has(s.id)) {
          result.errors.push({ code: "taskSourceTwice", id: task.target, args: { source: s.id } });
        }
        seen.add(s.id);
      }
      const entry = { target: task.target, sources: [] };
      if (result.historyAlive) {
        entry.targetRange = ranges[task.target];
        const estimate = (0, import_merge.estimateValues)(task.sources, ranges, task.overlap);
        for (const s of task.sources) {
          entry.sources.push({ id: s.id, range: ranges[s.id], estimate: estimate.perSource[s.id] });
        }
        entry.estimate = estimate.total;
      }
      const settings = result.settings.find((m) => m.targetId === task.target);
      const retention = Number((_o = (_n = settings == null ? void 0 : settings.plan.targetCustom[this.backend.instance]) == null ? void 0 : _n.retention) != null ? _o : 0);
      if (retention > 0) {
        entry.retention = retention;
        const oldest = Math.min(...entry.sources.map((s) => {
          var _a2, _b2;
          return (_b2 = (_a2 = s.range) == null ? void 0 : _a2.start) != null ? _b2 : Infinity;
        }));
        if (oldest !== Infinity && oldest < Date.now() - retention * 1e3) {
          result.errors.push({
            code: "retentionDeletes",
            id: task.target,
            args: { days: Math.round(retention / 86400) }
          });
        }
      }
      result.history.push(entry);
    }
    result.ok = result.errors.length === 0;
    return result;
  }
  // ------------------------------------------------------------------ "Schreiben"
  /**
   * "Schreiben": checks the plan and starts the execution in the background (WR-03)
   *
   * @param plan - the plan of the editor
   */
  async write(plan) {
    var _a, _b, _c, _d;
    if (this.isRunning()) {
      throw new Error(`Run ${this.current.id} is still active`);
    }
    const check = await this.check(plan, { fresh: true });
    if (!check.ok) {
      return { check };
    }
    this.current = {
      id: `run-${(/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-")}`,
      status: "running",
      phase: "objects",
      plan,
      taskIndex: 0,
      results: [],
      createdIds: [],
      startedAt: Date.now(),
      warnings: check.warnings
    };
    check.warnings.forEach((w) => this.adapter.log.debug(`${this.current.id}: ${(0, import_messages.logText)(w)}`));
    this.cancelRequested = false;
    this.addLog(this.current, {
      code: "logStart",
      args: {
        objects: check.objects.filter((o) => o.action === "create").length,
        targets: (_b = (_a = plan.tasks) == null ? void 0 : _a.length) != null ? _b : 0,
        settings: (_d = (_c = plan.mappings) == null ? void 0 : _c.length) != null ? _d : 0
      }
    });
    await this.publish(0, "");
    await this.backupObjects(plan);
    await this.saveRun();
    void this.execute();
    return { runId: this.current.id, check };
  }
  /** "Stop": stops after the current chunk. "Schreiben" again continues */
  cancel() {
    if (this.isRunning()) {
      this.cancelRequested = true;
    }
  }
  /** "Abbruch": stops after the current chunk and rolls the run back (HM-12) */
  abort() {
    const run = this.current;
    if ((run == null ? void 0 : run.status) === "running" && !run.abortRequested) {
      run.abortRequested = true;
      this.cancelRequested = true;
      this.addLog(run, { code: "logAbort" });
    }
  }
  /**
   * Adds a line to the log of a run and publishes it (state run.log) for the admin tab
   *
   * @param run - the run
   * @param msg - the line
   */
  addLog(run, msg) {
    var _a, _b;
    const entry = { ts: Date.now(), msg };
    (_a = run.log) != null ? _a : run.log = [];
    run.log.push(entry);
    if (run.log.length > MAX_LOG) {
      run.log.splice(1, run.log.length - MAX_LOG);
    }
    this.adapter.log.debug(`${run.id}: ${(0, import_messages.logText)(msg)}`);
    if (((_b = this.current) == null ? void 0 : _b.id) === run.id) {
      void this.adapter.setStateAsync("run.log", JSON.stringify({ runId: run.id, ...entry }), true);
    }
  }
  async execute() {
    var _a, _b, _c, _d, _e, _f;
    const run = this.current;
    try {
      await this.publish(0);
      await this.applyDbNames(run);
      await this.createObjects(run);
      run.phase = "history";
      const ranges = await this.backend.getRanges(
        ((_a = run.plan.tasks) != null ? _a : []).flatMap((t) => [t.target, ...t.sources.map((s) => s.id)])
      );
      const complete = await this.transferHistory(run, ranges);
      if (complete) {
        run.phase = "settings";
        await this.publish();
        await this.applySettings(run);
        await this.applyAliases(run);
        await this.catchUp(run, ranges);
        run.phase = "finished";
        run.status = "done";
        this.adapter.log.info(
          `Run ${run.id} finished. The history instance writes the values to disk within 10 minutes (HM-08)`
        );
      } else {
        run.status = "cancelled";
        this.adapter.log.info(`Run ${run.id} cancelled - click "Schreiben" again to continue`);
      }
    } catch (e) {
      run.status = "failed";
      run.error = e.message;
      this.adapter.log.error(`Run ${run.id} failed: ${run.error}`);
    }
    (_c = (_b = this.backend).invalidate) == null ? void 0 : _c.call(_b);
    run.finishedAt = Date.now();
    const total = { written: 0, existing: 0 };
    for (const r of run.results) {
      total.written += (_d = r == null ? void 0 : r.stats.written) != null ? _d : 0;
      total.existing += (_e = r == null ? void 0 : r.stats.skippedExisting) != null ? _e : 0;
    }
    if (run.status === "done") {
      this.addLog(run, {
        code: "logDone",
        args: { ...total, seconds: Math.round((run.finishedAt - run.startedAt) / 1e3) }
      });
    } else if (run.status === "cancelled" && !run.abortRequested) {
      this.addLog(run, { code: "logStopped" });
    } else if (run.status === "failed") {
      this.addLog(run, { code: "logFailed", args: { error: (_f = run.error) != null ? _f : "" } });
    }
    await this.saveRun();
    await this.publish(run.status === "done" ? 1 : void 0);
    if (run.abortRequested) {
      try {
        await this.rollback(run.id);
      } catch (e) {
        this.adapter.log.error(`Rollback of ${run.id} failed: ${e.message}`);
      }
    }
  }
  /**
   * Objects a run may change - their state before is stored for the rollback
   *
   * @param plan - the plan of the editor
   */
  async backupObjects(plan) {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    const ids = /* @__PURE__ */ new Set();
    (_a = plan.drafts) == null ? void 0 : _a.forEach((d) => ids.add(d.id));
    (_b = plan.aliases) == null ? void 0 : _b.forEach((a) => ids.add(a.targetId));
    (_c = plan.dbNames) == null ? void 0 : _c.forEach((n) => ids.add(n.id));
    const sources = /* @__PURE__ */ new Set();
    (_d = plan.mappings) == null ? void 0 : _d.forEach((m) => {
      var _a2;
      if (m.sourceId) {
        ids.add(m.sourceId);
        sources.add(m.sourceId);
      }
      ids.add(m.targetId);
      (_a2 = m.disableHistoryAt) == null ? void 0 : _a2.forEach((id) => ids.add(id));
    });
    const backup = {};
    for (const id of ids) {
      backup[id] = (_e = await this.adapter.getForeignObjectAsync(id)) != null ? _e : null;
    }
    if ((_f = plan.mappings) == null ? void 0 : _f.some((m) => m.enums !== false)) {
      const enums = await this.adapter.getForeignObjectsAsync("enum.*", "enum");
      for (const [id, obj] of Object.entries(enums)) {
        const members = (_h = (_g = obj == null ? void 0 : obj.common) == null ? void 0 : _g.members) != null ? _h : [];
        if (members.some((m) => sources.has(m))) {
          backup[id] = obj;
        }
      }
    }
    await this.writeJson(`${BACKUP_DIR}/${this.current.id}.json`, backup);
  }
  async createObjects(run) {
    var _a;
    const drafts = [...(_a = run.plan.drafts) != null ? _a : []].sort((a, b) => a.id.split(".").length - b.id.split(".").length);
    for (const draft of drafts) {
      if (await this.adapter.getForeignObjectAsync(draft.id)) {
        continue;
      }
      await this.adapter.setForeignObjectAsync(draft.id, {
        type: draft.type,
        common: draft.common,
        native: { ...draft.native, migrator: { createdBy: this.adapter.namespace, runId: run.id } }
      });
      run.createdIds.push(draft.id);
    }
    if (run.createdIds.length) {
      this.addLog(run, { code: "logObjects", args: { count: run.createdIds.length } });
    }
    await this.saveRun();
  }
  /**
   * Copies the history of all tasks
   *
   * @param run - the run
   * @param ranges - one fresh scan of the history files for all tasks, before anything is written
   */
  async transferHistory(run, ranges) {
    var _a;
    const tasks = (_a = run.plan.tasks) != null ? _a : [];
    let empty = 0;
    for (; run.taskIndex < tasks.length; run.taskIndex++) {
      const task = tasks[run.taskIndex];
      await this.publish(run.taskIndex / tasks.length, task.target);
      const started = Date.now();
      let lastLine = started;
      const result = await (0, import_transfer.runTransfer)(this.backend, task, {
        chunkSize: this.config.chunkSize,
        pauseMs: this.config.chunkPauseMs,
        isCancelled: () => this.cancelRequested,
        ranges,
        onProgress: (p) => {
          void this.publish((run.taskIndex + p.fraction) / tasks.length, task.target);
          if (Date.now() - lastLine >= LOG_PROGRESS_MS) {
            lastLine = Date.now();
            this.addLog(run, {
              code: "logTaskProgress",
              id: task.target,
              args: { day: localDay(p.day), written: p.stats.written }
            });
          }
        }
      });
      run.results[run.taskIndex] = result;
      if (result.stats.read || result.written) {
        this.addLog(run, {
          code: "logTask",
          id: task.target,
          args: {
            written: result.stats.written,
            existing: result.stats.skippedExisting,
            overlap: result.stats.skippedOverlap + result.stats.skippedDuplicate,
            read: result.stats.read,
            seconds: Math.round((Date.now() - started) / 100) / 10
          }
        });
      } else {
        empty++;
      }
      await this.saveRun();
      if (result.cancelled) {
        return false;
      }
    }
    if (empty) {
      this.addLog(run, { code: "logNoHistory", args: { count: empty } });
    }
    return true;
  }
  /**
   * The tasks read the sources up to the ranges of the scan at the start of the run. What the
   * sources logged while the run was copying (minutes, hours for a big plan) is copied now - the
   * settings are applied, so from here on the target logs itself. Values the target has already
   * (alias states carry the timestamp of their source) are skipped as always.
   *
   * @param run - the run
   * @param ranges - the scan of the start of the run
   */
  async catchUp(run, ranges) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i;
    const tasks = (_a = run.plan.tasks) != null ? _a : [];
    const now = Date.now();
    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      const main = run.results[i];
      const known = { [task.target]: ranges[task.target] };
      let from = Infinity;
      for (const s of task.sources) {
        const r = ranges[s.id];
        known[s.id] = r ? { ...r, end: now } : void 0;
        if (r) {
          from = Math.min(from, r.end);
        }
      }
      const start = Math.max(from, (_c = (_b = task.range) == null ? void 0 : _b.start) != null ? _c : from);
      const end = Math.min(now, (_e = (_d = task.range) == null ? void 0 : _d.end) != null ? _e : now);
      if (!main || from === Infinity || start > end) {
        continue;
      }
      const result = await (0, import_transfer.runTransfer)(
        this.backend,
        { ...task, range: { start, end } },
        { chunkSize: this.config.chunkSize, pauseMs: this.config.chunkPauseMs, ranges: known }
      );
      if (result.written) {
        this.addLog(run, { code: "logCatchUp", id: task.target, args: { written: result.stats.written } });
        main.stats.written += result.stats.written;
        main.written = {
          start: Math.min((_g = (_f = main.written) == null ? void 0 : _f.start) != null ? _g : result.written.start, result.written.start),
          end: Math.max((_i = (_h = main.written) == null ? void 0 : _h.end) != null ? _i : result.written.end, result.written.end)
        };
      }
    }
    await this.saveRun();
  }
  async applySettings(run) {
    var _a, _b, _c;
    const check = await this.check({ mappings: run.plan.mappings });
    let targets = 0;
    const sources = /* @__PURE__ */ new Set();
    const split = (custom, history) => Object.fromEntries(
      Object.entries(custom).filter(([key]) => import_settings.HISTORY_ADAPTERS.includes((0, import_settings.adapterOfKey)(key)) === history)
    );
    const waitFor = /* @__PURE__ */ new Set();
    const since = Date.now();
    for (const item of check.settings) {
      const other = split(item.plan.sourceCustom, false);
      if (item.sourceId && Object.keys(other).length) {
        await this.adapter.extendForeignObjectAsync(item.sourceId, { common: { custom: other } });
        sources.add(item.sourceId);
        Object.keys(other).filter((key) => (0, import_settings.adapterOfKey)(key) === "lovelace" && item.plan.targetCustom[key]).forEach((key) => waitFor.add(key));
      }
    }
    for (const instance of waitFor) {
      await this.waitForLovelace(instance, since);
    }
    for (const item of check.settings) {
      const { plan } = item;
      await this.adapter.extendForeignObjectAsync(item.targetId, {
        common: { ...plan.targetCommon, custom: plan.targetCustom }
      });
      if (Object.keys(plan.targetCustom).length || Object.keys(plan.targetCommon).length) {
        targets++;
      }
      const history = split(plan.sourceCustom, true);
      if (item.sourceId && Object.keys(history).length) {
        await this.adapter.extendForeignObjectAsync(item.sourceId, {
          common: { custom: history }
        });
        sources.add(item.sourceId);
      }
      for (const id of (_a = item.disableHistoryAt) != null ? _a : []) {
        const obj = await this.adapter.getForeignObjectAsync(id);
        const custom = (_c = (_b = obj == null ? void 0 : obj.common) == null ? void 0 : _b.custom) != null ? _c : {};
        const patch = {};
        for (const [key, value] of Object.entries(custom)) {
          if (import_settings.HISTORY_ADAPTERS.includes((0, import_settings.adapterOfKey)(key)) && value && value.enabled !== false) {
            patch[key] = { enabled: false };
          }
        }
        if (Object.keys(patch).length) {
          await this.adapter.extendForeignObjectAsync(id, { common: { custom: patch } });
        }
      }
      for (const change of item.enumChanges) {
        await this.adapter.extendForeignObjectAsync(change.enumId, {
          common: { members: change.members }
        });
      }
    }
    if (targets || sources.size) {
      this.addLog(run, { code: "logSettings", args: { targets, sources: sources.size } });
    }
  }
  /**
   * Waits until a lovelace instance has handled the object changes (its state info.entitiesUpdated
   * is set after every batch), at most 20 s - a stopped instance reads everything at its start
   *
   * @param instance - e.g. lovelace.0
   * @param since - time of the changes
   */
  async waitForLovelace(instance, since) {
    const alive = await this.adapter.getForeignStateAsync(`system.adapter.${instance}.alive`);
    if (!(alive == null ? void 0 : alive.val)) {
      return;
    }
    for (let waited = 0; waited < 2e4; waited += 500) {
      const updated = await this.adapter.getForeignStateAsync(`${instance}.info.entitiesUpdated`);
      if (updated && updated.ts > since) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    this.adapter.log.warn(`${instance} did not report its entities within 20 s - check the lovelace entities`);
  }
  /**
   * DB names (FR-57, HM-14). The history instance redirects reading, writing and deleting of an
   * object ID to its DB name - so the order matters:
   * - from the object ID to a name: copy while the object ID is not redirected yet, then switch
   * - from a name (to the object ID or another name): switch, then copy - writing to the object ID
   *   reaches its own data only after the redirection is gone
   * The values under the old name stay (04 §0.2).
   *
   * @param run - the run
   */
  async applyDbNames(run) {
    var _a, _b, _c, _d, _e, _f;
    const changes = (_a = run.plan.dbNames) != null ? _a : [];
    if (!changes.length) {
      return;
    }
    (_b = run.dbNames) != null ? _b : run.dbNames = [];
    for (const n of changes) {
      if (this.cancelRequested) {
        return;
      }
      const obj = await this.adapter.getForeignObjectAsync(n.id);
      const custom = (_d = (_c = obj == null ? void 0 : obj.common) == null ? void 0 : _c.custom) == null ? void 0 : _d[n.instance];
      if (!obj || !custom) {
        continue;
      }
      const { from, to } = dbNames(n, custom);
      if (from === to) {
        continue;
      }
      const move = !!n.moveValues && n.instance === this.backend.instance;
      const record = { id: n.id, instance: n.instance, from, to };
      run.dbNames.push(record);
      const copy = async () => {
        var _a2, _b2, _c2, _d2, _e2, _f2;
        const result = await (0, import_transfer.runTransfer)(
          this.backend,
          { target: to, sources: [{ id: from, priority: 0 }], overlap: { type: "all" } },
          {
            chunkSize: this.config.chunkSize,
            pauseMs: this.config.chunkPauseMs,
            isCancelled: () => this.cancelRequested
          }
        );
        if (record.moved) {
          record.moved.stats.written += result.stats.written;
          if (result.written) {
            record.moved.written = {
              start: Math.min((_b2 = (_a2 = record.moved.written) == null ? void 0 : _a2.start) != null ? _b2 : result.written.start, result.written.start),
              end: Math.max((_d2 = (_c2 = record.moved.written) == null ? void 0 : _c2.end) != null ? _d2 : result.written.end, result.written.end)
            };
          }
        } else {
          record.moved = result;
        }
        (_f2 = (_e2 = this.backend).invalidate) == null ? void 0 : _f2.call(_e2);
        return result;
      };
      if (move && from === n.id) {
        await this.publish(0, n.id);
        await copy();
        await copy();
        await this.switchDbName(n, custom, to);
      } else {
        await this.switchDbName(n, custom, to);
        if (move) {
          await this.publish(0, n.id);
          await copy();
        }
      }
      this.addLog(run, {
        code: "logDbName",
        id: n.id,
        args: { instance: n.instance, from, to, written: (_f = (_e = record.moved) == null ? void 0 : _e.stats.written) != null ? _f : 0 }
      });
      await this.saveRun();
    }
  }
  /**
   * Sets `aliasId` and waits until the history instance uses it (getEnabledDPs)
   *
   * @param n - the change
   * @param custom - current settings of the instance at the object
   * @param to - new DB name (the object ID: no redirection)
   */
  async switchDbName(n, custom, to) {
    var _a;
    const aliasId = to === n.id ? "" : to;
    await this.adapter.extendForeignObjectAsync(n.id, {
      common: { custom: { [n.instance]: { ...custom, aliasId } } }
    });
    if (n.instance !== this.backend.instance || !this.backend.enabledDPs || custom.enabled === false) {
      await new Promise((resolve) => setTimeout(resolve, 1e3));
      return;
    }
    for (let i = 0; i < 40; i++) {
      const dps = await this.backend.enabledDPs().catch(() => ({}));
      const config = dps[n.id];
      if (((_a = config == null ? void 0 : config.aliasId) != null ? _a : "") === aliasId) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    this.adapter.log.warn(`${n.instance} did not take over the DB name of ${n.id} within 10 s`);
  }
  /**
   * New `common.alias` of existing aliases. The definition is replaced as a whole - extending
   * the object would keep an old read/write function of the previous source.
   *
   * @param run - the run
   */
  async applyAliases(run) {
    var _a;
    let count = 0;
    for (const update of (_a = run.plan.aliases) != null ? _a : []) {
      const obj = await this.adapter.getForeignObjectAsync(update.targetId);
      if (!obj || obj.type !== "state") {
        continue;
      }
      const alias = {
        id: typeof update.alias.id === "object" ? { ...update.alias.id } : update.alias.id
      };
      if (update.alias.read) {
        alias.read = update.alias.read;
      }
      if (update.alias.write) {
        alias.write = update.alias.write;
      }
      obj.common.alias = alias;
      await this.adapter.setForeignObjectAsync(update.targetId, obj);
      count++;
    }
    if (count) {
      this.addLog(run, { code: "logAliases", args: { count } });
    }
  }
  /** Stops on adapter unload */
  async stop() {
    if (this.isRunning()) {
      this.cancelRequested = true;
      this.current.status = "cancelled";
      await this.saveRun();
    }
  }
  // ------------------------------------------------------------------ rollback
  /**
   * What a rollback of a run would do - shown before it is executed (HM-12)
   *
   * @param runId - the run
   */
  async rollbackPlan(runId) {
    var _a, _b, _c;
    const run = await this.loadRun(runId);
    if (!run) {
      throw new Error(`Run ${runId} not found`);
    }
    const plan = { removeHistory: [], keepHistory: [], restore: [], delete: [], noBackup: false };
    const created = new Set(run.createdIds);
    const settingsApplied = run.phase === "settings" || run.phase === "finished";
    for (const result of run.results) {
      if (!result) {
        continue;
      }
      if (created.has(result.target) && !result.targetRangeBefore && (result.written || settingsApplied)) {
        plan.removeHistory.push({
          target: result.target,
          start: Math.min((_b = (_a = result.written) == null ? void 0 : _a.start) != null ? _b : run.startedAt, run.startedAt),
          end: Date.now(),
          written: result.stats.written
        });
        continue;
      }
      if (!result.written) {
        continue;
      }
      const before = result.targetRangeBefore;
      if (before && before.start <= result.written.end && before.end >= result.written.start) {
        plan.keepHistory.push(result.target);
      } else {
        plan.removeHistory.push({ target: result.target, ...result.written, written: result.stats.written });
      }
    }
    for (const d of (_c = run.dbNames) != null ? _c : []) {
      const moved = d.moved;
      if (!(moved == null ? void 0 : moved.written)) {
        continue;
      }
      const before = moved.targetRangeBefore;
      if (before && before.start <= moved.written.end && before.end >= moved.written.start) {
        plan.keepHistory.push(d.to);
      } else {
        plan.removeHistory.push({
          target: d.to,
          ...moved.written,
          written: moved.stats.written,
          ...d.to === d.id ? { beforeRestore: true } : {}
        });
      }
    }
    const backup = await this.readJson(`${BACKUP_DIR}/${runId}.json`);
    if (backup) {
      plan.restore = Object.entries(backup).filter(([, obj]) => !!obj).map(([id]) => id);
    } else {
      plan.noBackup = true;
    }
    plan.delete = [...run.createdIds].sort((a, b) => b.split(".").length - a.split(".").length);
    return plan;
  }
  /**
   * Restores the objects of a run and removes the written history values where this is safe (HM-12)
   *
   * @param runId - the run
   */
  async rollback(runId) {
    var _a, _b, _c;
    const run = await this.loadRun(runId);
    if (!run) {
      throw new Error(`Run ${runId} not found`);
    }
    if (run.status === "running") {
      throw new Error("Cancel the run first");
    }
    if (run.status === "rolledBack") {
      throw new Error("The run was rolled back already");
    }
    const plan = await this.rollbackPlan(runId);
    const backup = await this.readJson(`${BACKUP_DIR}/${runId}.json`);
    for (const h of plan.removeHistory.filter((x) => x.beforeRestore)) {
      await this.backend.deleteRange(h.target, { start: h.start, end: h.end });
    }
    for (const id of plan.restore) {
      const obj = backup == null ? void 0 : backup[id];
      if (obj) {
        await this.adapter.setForeignObjectAsync(id, obj);
      }
    }
    for (const id of plan.delete) {
      await this.adapter.delForeignObjectAsync(id);
    }
    if (plan.delete.length && plan.removeHistory.length) {
      await new Promise((resolve) => setTimeout(resolve, 1e3));
    }
    const created = new Set(run.createdIds);
    for (const h of plan.removeHistory.filter((x) => !x.beforeRestore)) {
      const end = created.has(h.target) ? Date.now() : h.end;
      await this.backend.deleteRange(h.target, { start: h.start, end });
    }
    (_b = (_a = this.backend).invalidate) == null ? void 0 : _b.call(_a);
    run.status = "rolledBack";
    run.rolledBackAt = Date.now();
    if (((_c = this.current) == null ? void 0 : _c.id) === runId) {
      this.current = run;
      await this.publish();
    }
    this.addLog(run, {
      code: "logRolledBack",
      args: { history: plan.removeHistory.length, restored: plan.restore.length, deleted: plan.delete.length }
    });
    await this.writeJson(`${RUN_DIR}/${runId}.json`, run);
    this.adapter.log.info(
      `Run ${runId} rolled back: ${plan.removeHistory.length} histories removed, ${plan.restore.length} objects restored, ${plan.delete.length} deleted`
    );
    return plan;
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  MigrationRunner,
  isRunId,
  isValidDbName,
  isValidId,
  safeName,
  validatePlan
});
//# sourceMappingURL=MigrationRunner.js.map
