import type * as utils from '@iobroker/adapter-core';
import { checkExpression } from '../alias/converter';
import { validateBasePath } from '../alias/createMode';
import type { HistoryBackend } from '../history/HistoryBackend';
import { estimateValues } from '../history/merge';
import { runTransfer, type TransferResult } from '../history/transfer';
import type { DataRange } from '../history/types';
import { logText, type Message } from '../messages';
import {
    adapterOfKey,
    HISTORY_ADAPTERS,
    instanceStatusMap,
    planEnums,
    planSettings,
    type InstanceStatus,
} from '../settings/settings';
import type {
    CheckResult,
    DbNameChange,
    DbNameResult,
    MigrationPlan,
    MigrationRun,
    RollbackPlan,
    RunLogEntry,
    RunSummary,
} from './types';

/** Lines kept in the log of a run */
const MAX_LOG = 5000;
/** Interval of the progress lines of a long history task */
const LOG_PROGRESS_MS = 10_000;

const localDay = (ts: number): string => {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Settings of the runner (from the instance configuration) */
export interface RunnerConfig {
    /** Values per `storeState` */
    chunkSize: number;
    /** Pause between chunks in ms */
    chunkPauseMs: number;
    /** Take over settings of not installed adapters */
    copyUninstalledSettings: boolean;
}

const RUN_DIR = 'runs';
const BACKUP_DIR = 'backups';
/** "Prüfen" may use history ranges of the last 2 minutes - "Schreiben" always reads them fresh */
const CHECK_RANGES_MAX_AGE = 120_000;

/**
 * File name of a plan or template: letters, digits and . _ - only
 *
 * @param name - name entered by the user
 */
export function safeName(name: string): string {
    return name.replace(/[^\w.\-äöüÄÖÜß ]/g, '_').trim() || 'unnamed';
}

/**
 * ID of a run as created by "Schreiben" - checked before it is used in a file path
 *
 * @param id - run ID from a message
 */
export function isRunId(id: unknown): id is string {
    return typeof id === 'string' && /^run-[0-9T-]+Z$/.test(id);
}

/**
 * Object ID that may be used: not empty, at least two parts, no wildcard or forbidden characters
 *
 * @param id - object ID from a plan
 */
export function isValidId(id: unknown): id is string {
    return (
        typeof id === 'string' &&
        id.length > 2 &&
        id.length <= 500 &&
        id.includes('.') &&
        !id.startsWith('.') &&
        !id.endsWith('.') &&
        !id.includes('..') &&
        // forbidden in ioBroker IDs (js-controller FORBIDDEN_CHARS) and control characters
        // eslint-disable-next-line no-control-regex
        !/[*,;'"`<>\\?[\]\u0000-\u001f]/.test(id)
    );
}

/**
 * Name a logging instance stores a datapoint under (`aliasId`, FR-57): any text without the characters
 * of isValidId - and no path parts, the history instance builds file names from it
 *
 * @param name - DB name from a plan
 */
export function isValidDbName(name: unknown): name is string {
    return (
        typeof name === 'string' &&
        name.trim() === name &&
        name.length > 0 &&
        name.length <= 500 &&
        !name.includes('..') &&
        // eslint-disable-next-line no-control-regex
        !/[/*,;'"`<>\\?[\]\u0000-\u001f]/.test(name)
    );
}

/**
 * Old and new DB name of a change: the `aliasId` or the object ID
 *
 * @param n - the change
 * @param custom - current settings of the instance at the object
 */
function dbNames(n: DbNameChange, custom: Record<string, unknown>): { from: string; to: string } {
    const current = typeof custom.aliasId === 'string' && custom.aliasId.trim() ? custom.aliasId.trim() : '';
    return { from: current || n.id, to: n.to?.trim() || n.id };
}

/**
 * Structure and content check of a plan sent by the admin tab - IDs and formulas (security)
 *
 * @param plan - plan from a message
 */
export function validatePlan(plan: MigrationPlan): Message[] {
    const errors: Message[] = [];
    // values of a message may be anything - shown as JSON
    const text = (value: unknown): string =>
        typeof value === 'string' ? value : (JSON.stringify(value) ?? 'undefined');
    const id = (value: unknown): void => {
        if (!isValidId(value)) {
            errors.push({ code: 'invalidId', args: { value: text(value) } });
        }
    };
    // alias.id: an ID or { read, write } (FR-52)
    const aliasId = (value: unknown): void => {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            const v = value as { read?: unknown; write?: unknown };
            id(v.read);
            id(v.write);
        } else {
            id(value);
        }
    };
    const expr = (value: unknown, owner: string): void => {
        if (value === undefined || value === null || value === '') {
            return;
        }
        const reason = typeof value === 'string' ? checkExpression(value) : 'not a text';
        if (reason) {
            errors.push({ code: 'invalidExpression', id: owner, args: { value: text(value), reason } });
        }
    };
    if (!plan || typeof plan !== 'object') {
        return [{ code: 'invalidId', args: { value: 'plan' } }];
    }
    for (const d of Array.isArray(plan.drafts) ? plan.drafts : []) {
        id(d?.id);
        const alias = d?.common?.alias as { id?: unknown; read?: unknown; write?: unknown } | undefined;
        if (alias?.id !== undefined) {
            aliasId(alias.id);
        }
        expr(alias?.read, d?.id);
        expr(alias?.write, d?.id);
    }
    for (const m of Array.isArray(plan.mappings) ? plan.mappings : []) {
        id(m?.targetId);
        if (m?.sourceId !== undefined) {
            id(m.sourceId);
        }
        (m?.disableHistoryAt ?? []).forEach(id);
    }
    for (const t of Array.isArray(plan.tasks) ? plan.tasks : []) {
        id(t?.target);
        for (const s of Array.isArray(t?.sources) ? t.sources : []) {
            id(s?.id);
            if (s?.converter?.type === 'expression') {
                expr(s.converter.read, t.target);
            }
        }
    }
    for (const n of Array.isArray(plan.dbNames) ? plan.dbNames : []) {
        id(n?.id);
        if (typeof n?.instance !== 'string' || !/^(history|sql|influxdb)\.\d+$/.test(n.instance)) {
            errors.push({ code: 'dbNameInstance', args: { instance: text(n?.instance) } });
        }
        if (n?.to !== '' && n?.to !== undefined && !isValidDbName(n.to)) {
            errors.push({ code: 'invalidId', args: { value: text(n.to) } });
        }
    }
    for (const a of Array.isArray(plan.aliases) ? plan.aliases : []) {
        id(a?.targetId);
        aliasId(a?.alias?.id);
        expr(a?.alias?.read, a?.targetId);
        expr(a?.alias?.write, a?.targetId);
    }
    return errors;
}

/**
 * Executes a plan of the mapping editor when "Schreiben" is clicked (WR-03):
 * objects → history → settings and aliases. Runs in the background because the history can be large.
 * There is no pause/resume: after "Abbrechen" or a restart the same plan is simply written again,
 * values that exist at the target are skipped (HM-05).
 */
export class MigrationRunner {
    private current?: MigrationRun;
    private cancelRequested = false;

    /**
     * @param adapter - the adapter instance
     * @param backend - the history instance
     * @param config - throttling and options
     */
    public constructor(
        private readonly adapter: utils.AdapterInstance,
        private readonly backend: HistoryBackend,
        private readonly config: RunnerConfig,
    ) {}

    /** Creates the progress states and the file storage */
    public async init(): Promise<void> {
        await this.adapter.setForeignObjectNotExistsAsync(this.adapter.namespace, {
            type: 'meta',
            common: { name: 'Object Migrator files', type: 'meta.user' },
            native: {},
        });
        await this.adapter.setObjectNotExistsAsync('run', {
            type: 'channel',
            common: { name: 'Migration (Schreiben)' },
            native: {},
        });
        const states: Record<string, ioBroker.StateCommon> = {
            'run.id': { name: 'Current/last run', type: 'string', role: 'text', read: true, write: false },
            'run.status': { name: 'Status', type: 'string', role: 'text', read: true, write: false },
            'run.phase': { name: 'Step', type: 'string', role: 'text', read: true, write: false },
            'run.progress': {
                name: 'Progress',
                type: 'number',
                role: 'value',
                unit: '%',
                min: 0,
                max: 100,
                read: true,
                write: false,
            },
            'run.current': { name: 'Current target', type: 'string', role: 'text', read: true, write: false },
            'run.info': { name: 'Details (JSON)', type: 'string', role: 'json', read: true, write: false },
            'run.log': { name: 'Last line of the log (JSON)', type: 'string', role: 'json', read: true, write: false },
        };
        for (const [id, common] of Object.entries(states)) {
            await this.adapter.setObjectNotExistsAsync(id, { type: 'state', common, native: {} });
        }

        // a run interrupted by a restart is marked as cancelled - "Schreiben" again continues it
        const status = await this.adapter.getStateAsync('run.status');
        if (status?.val === 'running') {
            await this.adapter.setStateAsync('run.status', 'cancelled', true);
        }
    }

    /** Current or last run of this adapter start */
    public getCurrent(): MigrationRun | undefined {
        return this.current;
    }

    /** Is a run active */
    public isRunning(): boolean {
        return this.current?.status === 'running';
    }

    // ------------------------------------------------------------------ storage

    private async writeJson(path: string, data: unknown): Promise<void> {
        await this.adapter.writeFileAsync(this.adapter.namespace, path, JSON.stringify(data));
    }

    private async readJson<T>(path: string): Promise<T | undefined> {
        try {
            const res = await this.adapter.readFileAsync(this.adapter.namespace, path);
            return JSON.parse(res.file.toString()) as T;
        } catch {
            return undefined;
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
    public async savePlan(
        name: string,
        plan: unknown,
        baseVersion?: number,
    ): Promise<{ version: number; conflict?: boolean; savedAt?: number }> {
        const path = `plans/${safeName(name)}.json`;
        const current = await this.readJson<{ savedAt: number; version?: number }>(path);
        const currentVersion = current?.version ?? 0;
        if (baseVersion !== undefined && current && baseVersion !== currentVersion) {
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
    public async loadPlan(name: string): Promise<{ savedAt: number; version?: number; plan: unknown } | undefined> {
        return this.readJson(`plans/${safeName(name)}.json`);
    }

    /** Names of the stored templates (structure templates of the create mode) */
    public async listTemplates(): Promise<string[]> {
        try {
            const files = await this.adapter.readDirAsync(this.adapter.namespace, 'templates');
            return files
                .filter(f => !f.isDir && f.file.endsWith('.json'))
                .map(f => f.file.replace(/\.json$/, ''))
                .sort();
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
    public async saveTemplate(name: string, template: unknown): Promise<void> {
        await this.writeJson(`templates/${safeName(name)}.json`, template);
    }

    /** @param name - template name */
    public async loadTemplate(name: string): Promise<unknown> {
        return this.readJson(`templates/${safeName(name)}.json`);
    }

    /** @param name - template name */
    public async deleteTemplate(name: string): Promise<void> {
        await this.adapter.delFileAsync(this.adapter.namespace, `templates/${safeName(name)}.json`);
    }

    private async saveRun(): Promise<void> {
        if (this.current) {
            await this.writeJson(`${RUN_DIR}/${this.current.id}.json`, this.current);
        }
    }

    /**
     * Loads a stored run (report, rollback)
     *
     * @param id - run ID
     */
    public async loadRun(id: string): Promise<MigrationRun | undefined> {
        if (!isRunId(id)) {
            throw new Error('Invalid run ID');
        }
        return this.current?.id === id ? this.current : this.readJson<MigrationRun>(`${RUN_DIR}/${id}.json`);
    }

    /** All stored runs, newest first ("Verlauf") */
    public async listRuns(): Promise<RunSummary[]> {
        let files: { file: string; isDir: boolean }[] = [];
        try {
            files = await this.adapter.readDirAsync(this.adapter.namespace, RUN_DIR);
        } catch {
            return [];
        }
        const result: RunSummary[] = [];
        for (const f of files) {
            const id = f.file.replace(/\.json$/, '');
            if (f.isDir || !isRunId(id)) {
                continue;
            }
            const run = await this.loadRun(id);
            if (!run) {
                continue;
            }
            const stats = run.results.filter(r => r?.stats).map(r => r.stats);
            result.push({
                id: run.id,
                status: run.status,
                startedAt: run.startedAt,
                finishedAt: run.finishedAt,
                rolledBackAt: run.rolledBackAt,
                created: run.createdIds.length,
                settings: run.plan.mappings?.length ?? 0,
                targets: run.plan.tasks?.length ?? 0,
                written: stats.reduce((n, s) => n + s.written, 0),
                skippedExisting: stats.reduce((n, s) => n + s.skippedExisting, 0),
                error: run.error,
            });
        }
        return result.sort((a, b) => b.startedAt - a.startedAt);
    }

    private async publish(progress?: number, currentTarget?: string): Promise<void> {
        const run = this.current;
        if (!run) {
            return;
        }
        await this.adapter.setStateAsync('run.id', run.id, true);
        await this.adapter.setStateAsync('run.status', run.status, true);
        await this.adapter.setStateAsync('run.phase', run.phase, true);
        if (progress !== undefined) {
            await this.adapter.setStateAsync('run.progress', Math.round(progress * 1000) / 10, true);
        }
        if (currentTarget !== undefined) {
            await this.adapter.setStateAsync('run.current', currentTarget, true);
        }
        await this.adapter.setStateAsync(
            'run.info',
            JSON.stringify({
                id: run.id,
                status: run.status,
                phase: run.phase,
                taskIndex: run.taskIndex,
                tasks: run.plan.tasks?.length ?? 0,
                results: run.results.map(r => ({ target: r.target, cancelled: r.cancelled, ...r.stats })),
                error: run.error,
            }),
            true,
        );
    }

    // ------------------------------------------------------------------ "Prüfen"

    private async instanceStatus(): Promise<Record<string, InstanceStatus>> {
        return instanceStatusMap(await this.adapter.getForeignObjectsAsync('system.adapter.*', 'instance'));
    }

    /**
     * "Prüfen": shows everything that would happen, writes nothing (WR-02)
     *
     * @param plan - the plan of the editor
     * @param options - fresh: read the history ranges again (before "Schreiben")
     * @param options.fresh - do not use cached history ranges
     */
    public async check(plan: MigrationPlan, options: { fresh?: boolean } = {}): Promise<CheckResult> {
        const result: CheckResult = {
            ok: true,
            errors: [],
            warnings: [],
            historyInstance: this.backend.instance,
            historyAlive: await this.backend.isAlive(),
            objects: [],
            settings: [],
            aliases: [],
            history: [],
        };

        // IDs and formulas first - nothing else is looked at if they are invalid
        result.errors.push(...validatePlan(plan));
        if (result.errors.length) {
            result.ok = false;
            return result;
        }

        // objects
        const draftIds = new Set<string>();
        for (const draft of plan.drafts ?? []) {
            if (draftIds.has(draft.id)) {
                result.errors.push({ code: 'draftDuplicate', id: draft.id });
            }
            draftIds.add(draft.id);
            result.errors.push(...validateBasePath(draft.id));
            const existing = await this.adapter.getForeignObjectAsync(draft.id);
            result.objects.push({ id: draft.id, action: existing ? 'exists' : 'create' });
            if (existing && existing.type !== draft.type) {
                result.errors.push({ code: 'draftTypeConflict', id: draft.id, args: { type: existing.type } });
            }
            // a new alias without a source is allowed (EM-12): it is created without alias.id and delivers
            // no values until a source is linked
            const alias = draft.common.alias as { id?: unknown } | undefined;
            if (!existing && draft.type === 'state' && draft.id.startsWith('alias.') && !alias?.id) {
                result.warnings.push({ code: 'draftNoSource', id: draft.id });
            }
        }

        // settings
        const instances = await this.instanceStatus();
        const enums = await this.adapter.getForeignObjectsAsync('enum.*', 'enum');
        for (const mapping of plan.mappings ?? []) {
            const source = mapping.sourceId
                ? await this.adapter.getForeignObjectAsync(mapping.sourceId)
                : ({ common: {} } as unknown as ioBroker.Object);
            if (!source) {
                result.errors.push({
                    code: 'sourceMissing',
                    id: mapping.targetId,
                    args: { source: mapping.sourceId! },
                });
                continue;
            }
            const target =
                (await this.adapter.getForeignObjectAsync(mapping.targetId)) ??
                (plan.drafts?.find(d => d.id === mapping.targetId) as Partial<ioBroker.Object> | undefined);
            if (!target) {
                result.errors.push({ code: 'targetMissing', id: mapping.targetId });
                continue;
            }
            const settingsPlan = planSettings(source, target, instances, {
                copyUninstalled: this.config.copyUninstalledSettings,
                ...mapping.options,
            });
            // warnings belong to the target - the editor groups them by target
            result.warnings.push(...settingsPlan.warnings.map(w => ({ ...w, id: mapping.targetId })));
            const enumChanges =
                mapping.enums === false || !mapping.sourceId
                    ? []
                    : planEnums(enums, mapping.sourceId, mapping.targetId, mapping.options?.sourceMode === 'remove');
            result.settings.push({ ...mapping, plan: settingsPlan, enumChanges });
        }

        // aliases of existing objects (remap, conversion)
        for (const update of plan.aliases ?? []) {
            if (!update.targetId.startsWith('alias.')) {
                result.errors.push({ code: 'aliasNotAlias', id: update.targetId });
                continue;
            }
            const obj = await this.adapter.getForeignObjectAsync(update.targetId);
            if (!obj) {
                if (!draftIds.has(update.targetId)) {
                    result.errors.push({ code: 'aliasTargetMissing', id: update.targetId });
                }
                continue;
            }
            result.aliases.push({
                targetId: update.targetId,
                from: (obj.common as ioBroker.StateCommon).alias,
                to: update.alias,
            });
        }

        // DB names (FR-57)
        if (plan.dbNames?.length) {
            result.dbNames = [];
            for (const n of plan.dbNames) {
                const obj = await this.adapter.getForeignObjectAsync(n.id);
                const custom = (obj?.common as { custom?: Record<string, Record<string, unknown>> } | undefined)
                    ?.custom?.[n.instance];
                if (!custom) {
                    result.errors.push({ code: 'dbNameNoSettings', id: n.id, args: { instance: n.instance } });
                    continue;
                }
                const { from, to } = dbNames(n, custom);
                if (from === to) {
                    result.warnings.push({ code: 'dbNameUnchanged', id: n.id, args: { name: to } });
                }
                const move = !!n.moveValues && n.instance === this.backend.instance && from !== to;
                if (n.moveValues && n.instance !== this.backend.instance) {
                    result.warnings.push({
                        code: 'dbNameNoMove',
                        id: n.id,
                        args: { instance: n.instance, history: this.backend.instance },
                    });
                }
                if (move && !result.historyAlive) {
                    result.errors.push({ code: 'historyNotRunning', args: { instance: this.backend.instance } });
                }
                const range = move
                    ? (await this.backend.getRanges([from], options.fresh ? 0 : CHECK_RANGES_MAX_AGE))[from]
                    : undefined;
                result.dbNames.push({ id: n.id, instance: n.instance, from, to, move, range });
            }
        }

        // history
        if ((plan.tasks?.length ?? 0) > 0 && !result.historyAlive) {
            result.errors.push({ code: 'historyNotRunning', args: { instance: this.backend.instance } });
        }
        const ranges =
            result.historyAlive && plan.tasks?.length
                ? await this.backend.getRanges(
                      plan.tasks.flatMap(t => [t.target, ...t.sources.map(s => s.id)]),
                      options.fresh ? 0 : CHECK_RANGES_MAX_AGE,
                  )
                : {};
        const targets = new Set<string>();
        for (const task of plan.tasks ?? []) {
            if (targets.has(task.target)) {
                result.errors.push({ code: 'taskTargetTwice', id: task.target });
            }
            targets.add(task.target);
            const seen = new Set<string>();
            for (const s of task.sources) {
                if (seen.has(s.id)) {
                    result.errors.push({ code: 'taskSourceTwice', id: task.target, args: { source: s.id } });
                }
                seen.add(s.id);
            }
            const entry: CheckResult['history'][number] = { target: task.target, sources: [] };
            if (result.historyAlive) {
                entry.targetRange = ranges[task.target];
                const estimate = estimateValues(task.sources, ranges, task.overlap);
                for (const s of task.sources) {
                    entry.sources.push({ id: s.id, range: ranges[s.id], estimate: estimate.perSource[s.id] });
                }
                entry.estimate = estimate.total;
            }
            // retention check (HM-11): settings that will be active at the target
            const settings = result.settings.find(m => m.targetId === task.target);
            const retention = Number(settings?.plan.targetCustom[this.backend.instance]?.retention ?? 0);
            if (retention > 0) {
                entry.retention = retention;
                const oldest = Math.min(...entry.sources.map(s => s.range?.start ?? Infinity));
                if (oldest !== Infinity && oldest < Date.now() - retention * 1000) {
                    result.errors.push({
                        code: 'retentionDeletes',
                        id: task.target,
                        args: { days: Math.round(retention / 86400) },
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
    public async write(plan: MigrationPlan): Promise<{ runId?: string; check: CheckResult }> {
        if (this.isRunning()) {
            throw new Error(`Run ${this.current!.id} is still active`);
        }
        // fresh ranges: the rollback relies on the state of the targets before the run
        const check = await this.check(plan, { fresh: true });
        if (!check.ok) {
            return { check };
        }
        this.current = {
            id: `run-${new Date().toISOString().replace(/[:.]/g, '-')}`,
            status: 'running',
            phase: 'objects',
            plan,
            taskIndex: 0,
            results: [],
            createdIds: [],
            startedAt: Date.now(),
            warnings: check.warnings,
        };
        check.warnings.forEach(w => this.adapter.log.debug(`${this.current!.id}: ${logText(w)}`));
        this.cancelRequested = false;
        this.addLog(this.current, {
            code: 'logStart',
            args: {
                objects: check.objects.filter(o => o.action === 'create').length,
                targets: plan.tasks?.length ?? 0,
                settings: plan.mappings?.length ?? 0,
            },
        });
        // reset the progress of the previous run before the (possibly long) backup
        await this.publish(0, '');
        await this.backupObjects(plan);
        await this.saveRun();
        void this.execute();
        return { runId: this.current.id, check };
    }

    /** "Stop": stops after the current chunk. "Schreiben" again continues */
    public cancel(): void {
        if (this.isRunning()) {
            this.cancelRequested = true;
        }
    }

    /** "Abbruch": stops after the current chunk and rolls the run back (HM-12) */
    public abort(): void {
        const run = this.current;
        if (run?.status === 'running' && !run.abortRequested) {
            run.abortRequested = true;
            this.cancelRequested = true;
            this.addLog(run, { code: 'logAbort' });
        }
    }

    /**
     * Adds a line to the log of a run and publishes it (state run.log) for the admin tab
     *
     * @param run - the run
     * @param msg - the line
     */
    private addLog(run: MigrationRun, msg: Message): void {
        const entry: RunLogEntry = { ts: Date.now(), msg };
        run.log ??= [];
        run.log.push(entry);
        if (run.log.length > MAX_LOG) {
            run.log.splice(1, run.log.length - MAX_LOG);
        }
        this.adapter.log.debug(`${run.id}: ${logText(msg)}`);
        if (this.current?.id === run.id) {
            void this.adapter.setStateAsync('run.log', JSON.stringify({ runId: run.id, ...entry }), true);
        }
    }

    private async execute(): Promise<void> {
        const run = this.current!;
        try {
            await this.publish(0);
            await this.applyDbNames(run);
            await this.createObjects(run);

            run.phase = 'history';
            const ranges = await this.backend.getRanges(
                (run.plan.tasks ?? []).flatMap(t => [t.target, ...t.sources.map(s => s.id)]),
            );
            const complete = await this.transferHistory(run, ranges);

            if (complete) {
                // settings and aliases only after the history - then the target logs and the live
                // value comes from the new source (HM-10)
                run.phase = 'settings';
                await this.publish();
                await this.applySettings(run);
                await this.applyAliases(run);
                await this.catchUp(run, ranges);
                run.phase = 'finished';
                run.status = 'done';
                this.adapter.log.info(
                    `Run ${run.id} finished. The history instance writes the values to disk within 10 minutes (HM-08)`,
                );
            } else {
                run.status = 'cancelled';
                this.adapter.log.info(`Run ${run.id} cancelled - click "Schreiben" again to continue`);
            }
        } catch (e) {
            run.status = 'failed';
            run.error = (e as Error).message;
            this.adapter.log.error(`Run ${run.id} failed: ${run.error}`);
        }
        this.backend.invalidate?.();
        run.finishedAt = Date.now();
        const total = { written: 0, existing: 0 };
        for (const r of run.results) {
            total.written += r?.stats.written ?? 0;
            total.existing += r?.stats.skippedExisting ?? 0;
        }
        if (run.status === 'done') {
            this.addLog(run, {
                code: 'logDone',
                args: { ...total, seconds: Math.round((run.finishedAt - run.startedAt) / 1000) },
            });
        } else if (run.status === 'cancelled' && !run.abortRequested) {
            this.addLog(run, { code: 'logStopped' });
        } else if (run.status === 'failed') {
            this.addLog(run, { code: 'logFailed', args: { error: run.error ?? '' } });
        }
        await this.saveRun();
        await this.publish(run.status === 'done' ? 1 : undefined);
        if (run.abortRequested) {
            try {
                await this.rollback(run.id);
            } catch (e) {
                this.adapter.log.error(`Rollback of ${run.id} failed: ${(e as Error).message}`);
            }
        }
    }

    /**
     * Objects a run may change - their state before is stored for the rollback
     *
     * @param plan - the plan of the editor
     */
    private async backupObjects(plan: MigrationPlan): Promise<void> {
        const ids = new Set<string>();
        plan.drafts?.forEach(d => ids.add(d.id));
        plan.aliases?.forEach(a => ids.add(a.targetId));
        plan.dbNames?.forEach(n => ids.add(n.id));
        const sources = new Set<string>();
        plan.mappings?.forEach(m => {
            if (m.sourceId) {
                ids.add(m.sourceId);
                sources.add(m.sourceId);
            }
            ids.add(m.targetId);
            m.disableHistoryAt?.forEach(id => ids.add(id));
        });
        const backup: Record<string, ioBroker.Object | null> = {};
        for (const id of ids) {
            backup[id] = (await this.adapter.getForeignObjectAsync(id)) ?? null;
        }
        // only the rooms/functions that contain a source - they are the ones that are changed
        if (plan.mappings?.some(m => m.enums !== false)) {
            const enums = await this.adapter.getForeignObjectsAsync('enum.*', 'enum');
            for (const [id, obj] of Object.entries(enums)) {
                const members = (obj?.common as ioBroker.EnumCommon | undefined)?.members ?? [];
                if (members.some(m => sources.has(m))) {
                    backup[id] = obj;
                }
            }
        }
        await this.writeJson(`${BACKUP_DIR}/${this.current!.id}.json`, backup);
    }

    private async createObjects(run: MigrationRun): Promise<void> {
        const drafts = [...(run.plan.drafts ?? [])].sort((a, b) => a.id.split('.').length - b.id.split('.').length);
        for (const draft of drafts) {
            if (await this.adapter.getForeignObjectAsync(draft.id)) {
                continue;
            }
            await this.adapter.setForeignObjectAsync(draft.id, {
                type: draft.type,
                common: draft.common,
                native: { ...draft.native, migrator: { createdBy: this.adapter.namespace, runId: run.id } },
            } as unknown as ioBroker.SettableObject);
            run.createdIds.push(draft.id);
        }
        if (run.createdIds.length) {
            this.addLog(run, { code: 'logObjects', args: { count: run.createdIds.length } });
        }
        await this.saveRun();
    }

    /**
     * Copies the history of all tasks
     *
     * @param run - the run
     * @param ranges - one fresh scan of the history files for all tasks, before anything is written
     */
    private async transferHistory(run: MigrationRun, ranges: Record<string, DataRange | undefined>): Promise<boolean> {
        const tasks = run.plan.tasks ?? [];
        let empty = 0;
        for (; run.taskIndex < tasks.length; run.taskIndex++) {
            const task = tasks[run.taskIndex];
            await this.publish(run.taskIndex / tasks.length, task.target);

            const started = Date.now();
            let lastLine = started;
            const result = await runTransfer(this.backend, task, {
                chunkSize: this.config.chunkSize,
                pauseMs: this.config.chunkPauseMs,
                isCancelled: () => this.cancelRequested,
                ranges,
                onProgress: p => {
                    void this.publish((run.taskIndex + p.fraction) / tasks.length, task.target);
                    // long tasks (years of values) get a line now and then
                    if (Date.now() - lastLine >= LOG_PROGRESS_MS) {
                        lastLine = Date.now();
                        this.addLog(run, {
                            code: 'logTaskProgress',
                            id: task.target,
                            args: { day: localDay(p.day), written: p.stats.written },
                        });
                    }
                },
            });
            run.results[run.taskIndex] = result;
            if (result.stats.read || result.written) {
                this.addLog(run, {
                    code: 'logTask',
                    id: task.target,
                    args: {
                        written: result.stats.written,
                        existing: result.stats.skippedExisting,
                        overlap: result.stats.skippedOverlap + result.stats.skippedDuplicate,
                        read: result.stats.read,
                        seconds: Math.round((Date.now() - started) / 100) / 10,
                    },
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
            this.addLog(run, { code: 'logNoHistory', args: { count: empty } });
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
    private async catchUp(run: MigrationRun, ranges: Record<string, DataRange | undefined>): Promise<void> {
        const tasks = run.plan.tasks ?? [];
        const now = Date.now();
        for (let i = 0; i < tasks.length; i++) {
            const task = tasks[i];
            const main = run.results[i];
            const known: Record<string, DataRange | undefined> = { [task.target]: ranges[task.target] };
            let from = Infinity;
            for (const s of task.sources) {
                const r = ranges[s.id];
                // a source without history at the start of the run has nothing to catch up
                known[s.id] = r ? { ...r, end: now } : undefined;
                if (r) {
                    from = Math.min(from, r.end);
                }
            }
            const start = Math.max(from, task.range?.start ?? from);
            const end = Math.min(now, task.range?.end ?? now);
            if (!main || from === Infinity || start > end) {
                continue;
            }
            const result = await runTransfer(
                this.backend,
                { ...task, range: { start, end } },
                { chunkSize: this.config.chunkSize, pauseMs: this.config.chunkPauseMs, ranges: known },
            );
            if (result.written) {
                this.addLog(run, { code: 'logCatchUp', id: task.target, args: { written: result.stats.written } });
                main.stats.written += result.stats.written;
                main.written = {
                    start: Math.min(main.written?.start ?? result.written.start, result.written.start),
                    end: Math.max(main.written?.end ?? result.written.end, result.written.end),
                };
            }
        }
        await this.saveRun();
    }

    private async applySettings(run: MigrationRun): Promise<void> {
        const check = await this.check({ mappings: run.plan.mappings });
        let targets = 0;
        const sources = new Set<string>();
        const split = (custom: Record<string, Record<string, unknown> | null>, history: boolean): typeof custom =>
            Object.fromEntries(
                Object.entries(custom).filter(([key]) => HISTORY_ADAPTERS.includes(adapterOfKey(key)) === history),
            );

        // 1. other adapters at the source first (lovelace: the entity moves to the target). lovelace
        // collects object changes and handles them sorted by ID - target and source in one batch
        // remove the entity of the target again when the source comes after it (alias.0 < zigbee.0)
        const waitFor = new Set<string>();
        const since = Date.now();
        for (const item of check.settings) {
            const other = split(item.plan.sourceCustom, false);
            if (item.sourceId && Object.keys(other).length) {
                await this.adapter.extendForeignObjectAsync(item.sourceId, { common: { custom: other } });
                sources.add(item.sourceId);
                Object.keys(other)
                    .filter(key => adapterOfKey(key) === 'lovelace' && item.plan.targetCustom[key])
                    .forEach(key => waitFor.add(key));
            }
        }
        for (const instance of waitFor) {
            await this.waitForLovelace(instance, since);
        }

        // 2. the targets, then the history adapters at the source - the target logs before the source stops
        for (const item of check.settings) {
            const { plan } = item;
            await this.adapter.extendForeignObjectAsync(item.targetId, {
                common: { ...plan.targetCommon, custom: plan.targetCustom },
            });
            if (Object.keys(plan.targetCustom).length || Object.keys(plan.targetCommon).length) {
                targets++;
            }
            const history = split(plan.sourceCustom, true);
            if (item.sourceId && Object.keys(history).length) {
                await this.adapter.extendForeignObjectAsync(item.sourceId, {
                    common: { custom: history },
                });
                sources.add(item.sourceId);
            }
            for (const id of item.disableHistoryAt ?? []) {
                const obj = await this.adapter.getForeignObjectAsync(id);
                const custom = (obj?.common as ioBroker.StateCommon | undefined)?.custom ?? {};
                const patch: Record<string, { enabled: false }> = {};
                for (const [key, value] of Object.entries(custom)) {
                    if (HISTORY_ADAPTERS.includes(adapterOfKey(key)) && value && value.enabled !== false) {
                        patch[key] = { enabled: false };
                    }
                }
                if (Object.keys(patch).length) {
                    await this.adapter.extendForeignObjectAsync(id, { common: { custom: patch } });
                }
            }
            for (const change of item.enumChanges) {
                await this.adapter.extendForeignObjectAsync(change.enumId, {
                    common: { members: change.members },
                });
            }
        }
        if (targets || sources.size) {
            this.addLog(run, { code: 'logSettings', args: { targets, sources: sources.size } });
        }
    }

    /**
     * Waits until a lovelace instance has handled the object changes (its state info.entitiesUpdated
     * is set after every batch), at most 20 s - a stopped instance reads everything at its start
     *
     * @param instance - e.g. lovelace.0
     * @param since - time of the changes
     */
    private async waitForLovelace(instance: string, since: number): Promise<void> {
        const alive = await this.adapter.getForeignStateAsync(`system.adapter.${instance}.alive`);
        if (!alive?.val) {
            return;
        }
        for (let waited = 0; waited < 20_000; waited += 500) {
            const updated = await this.adapter.getForeignStateAsync(`${instance}.info.entitiesUpdated`);
            if (updated && updated.ts > since) {
                return;
            }
            await new Promise(resolve => setTimeout(resolve, 500));
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
    private async applyDbNames(run: MigrationRun): Promise<void> {
        const changes = run.plan.dbNames ?? [];
        if (!changes.length) {
            return;
        }
        run.dbNames ??= [];
        for (const n of changes) {
            if (this.cancelRequested) {
                return;
            }
            const obj = await this.adapter.getForeignObjectAsync(n.id);
            const custom = (obj?.common as { custom?: Record<string, Record<string, unknown>> } | undefined)?.custom?.[
                n.instance
            ];
            if (!obj || !custom) {
                continue;
            }
            const { from, to } = dbNames(n, custom);
            if (from === to) {
                continue;
            }
            const move = !!n.moveValues && n.instance === this.backend.instance;
            const record: DbNameResult = { id: n.id, instance: n.instance, from, to };
            run.dbNames.push(record);
            const copy = async (): Promise<TransferResult> => {
                const result = await runTransfer(
                    this.backend,
                    { target: to, sources: [{ id: from, priority: 0 }], overlap: { type: 'all' } },
                    {
                        chunkSize: this.config.chunkSize,
                        pauseMs: this.config.chunkPauseMs,
                        isCancelled: () => this.cancelRequested,
                    },
                );
                if (record.moved) {
                    // the second pass: what was logged while copying
                    record.moved.stats.written += result.stats.written;
                    if (result.written) {
                        record.moved.written = {
                            start: Math.min(record.moved.written?.start ?? result.written.start, result.written.start),
                            end: Math.max(record.moved.written?.end ?? result.written.end, result.written.end),
                        };
                    }
                } else {
                    record.moved = result;
                }
                this.backend.invalidate?.();
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
                code: 'logDbName',
                id: n.id,
                args: { instance: n.instance, from, to, written: record.moved?.stats.written ?? 0 },
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
    private async switchDbName(n: DbNameChange, custom: Record<string, unknown>, to: string): Promise<void> {
        const aliasId = to === n.id ? '' : to;
        await this.adapter.extendForeignObjectAsync(n.id, {
            common: { custom: { [n.instance]: { ...custom, aliasId } } },
        });
        if (n.instance !== this.backend.instance || !this.backend.enabledDPs || custom.enabled === false) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            return;
        }
        for (let i = 0; i < 40; i++) {
            const dps: Record<string, Record<string, unknown>> = await this.backend.enabledDPs().catch(() => ({}));
            const config = dps[n.id];
            if ((config?.aliasId ?? '') === aliasId) {
                return;
            }
            await new Promise(resolve => setTimeout(resolve, 250));
        }
        this.adapter.log.warn(`${n.instance} did not take over the DB name of ${n.id} within 10 s`);
    }

    /**
     * New `common.alias` of existing aliases. The definition is replaced as a whole - extending
     * the object would keep an old read/write function of the previous source.
     *
     * @param run - the run
     */
    private async applyAliases(run: MigrationRun): Promise<void> {
        let count = 0;
        for (const update of run.plan.aliases ?? []) {
            const obj = await this.adapter.getForeignObjectAsync(update.targetId);
            if (!obj || obj.type !== 'state') {
                continue;
            }
            const alias: Record<string, unknown> = {
                id: typeof update.alias.id === 'object' ? { ...update.alias.id } : update.alias.id,
            };
            if (update.alias.read) {
                alias.read = update.alias.read;
            }
            if (update.alias.write) {
                alias.write = update.alias.write;
            }
            (obj.common as ioBroker.StateCommon).alias = alias as unknown as ioBroker.StateCommon['alias'];
            await this.adapter.setForeignObjectAsync(update.targetId, obj);
            count++;
        }
        if (count) {
            this.addLog(run, { code: 'logAliases', args: { count } });
        }
    }

    /** Stops on adapter unload */
    public async stop(): Promise<void> {
        if (this.isRunning()) {
            this.cancelRequested = true;
            this.current!.status = 'cancelled';
            await this.saveRun();
        }
    }

    // ------------------------------------------------------------------ rollback

    /**
     * What a rollback of a run would do - shown before it is executed (HM-12)
     *
     * @param runId - the run
     */
    public async rollbackPlan(runId: string): Promise<RollbackPlan> {
        const run = await this.loadRun(runId);
        if (!run) {
            throw new Error(`Run ${runId} not found`);
        }
        const plan: RollbackPlan = { removeHistory: [], keepHistory: [], restore: [], delete: [], noBackup: false };
        const created = new Set(run.createdIds);
        // the settings were applied: the targets may have logged values themselves
        const settingsApplied = run.phase === 'settings' || run.phase === 'finished';
        for (const result of run.results) {
            if (!result) {
                continue;
            }
            // a target created by the run: its whole history belongs to the run - also what it
            // logged itself afterwards (live values, start/stop markers), the object is deleted
            if (created.has(result.target) && !result.targetRangeBefore && (result.written || settingsApplied)) {
                plan.removeHistory.push({
                    target: result.target,
                    start: Math.min(result.written?.start ?? run.startedAt, run.startedAt),
                    end: Date.now(),
                    written: result.stats.written,
                });
                continue;
            }
            if (!result.written) {
                continue;
            }
            const before = result.targetRangeBefore;
            // values that were there before must not be deleted - deleteRange can not distinguish them
            if (before && before.start <= result.written.end && before.end >= result.written.start) {
                plan.keepHistory.push(result.target);
            } else {
                plan.removeHistory.push({ target: result.target, ...result.written, written: result.stats.written });
            }
        }
        // moved values of DB names: removed at the new name (unless it had values in that range before).
        // Is the new name the object ID, it has to happen before the setting is restored - afterwards
        // the history instance would redirect the deletion to the old name
        for (const d of run.dbNames ?? []) {
            const moved = d.moved;
            if (!moved?.written) {
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
                    ...(d.to === d.id ? { beforeRestore: true } : {}),
                });
            }
        }
        const backup = await this.readJson<Record<string, ioBroker.Object | null>>(`${BACKUP_DIR}/${runId}.json`);
        if (backup) {
            plan.restore = Object.entries(backup)
                .filter(([, obj]) => !!obj)
                .map(([id]) => id);
        } else {
            plan.noBackup = true;
        }
        plan.delete = [...run.createdIds].sort((a, b) => b.split('.').length - a.split('.').length);
        return plan;
    }

    /**
     * Restores the objects of a run and removes the written history values where this is safe (HM-12)
     *
     * @param runId - the run
     */
    public async rollback(runId: string): Promise<RollbackPlan> {
        const run = await this.loadRun(runId);
        if (!run) {
            throw new Error(`Run ${runId} not found`);
        }
        if (run.status === 'running') {
            throw new Error('Cancel the run first');
        }
        if (run.status === 'rolledBack') {
            throw new Error('The run was rolled back already');
        }
        const plan = await this.rollbackPlan(runId);
        const backup = await this.readJson<Record<string, ioBroker.Object | null>>(`${BACKUP_DIR}/${runId}.json`);
        for (const h of plan.removeHistory.filter(x => x.beforeRestore)) {
            await this.backend.deleteRange(h.target, { start: h.start, end: h.end });
        }
        for (const id of plan.restore) {
            const obj = backup?.[id];
            if (obj) {
                await this.adapter.setForeignObjectAsync(id, obj);
            }
        }
        for (const id of plan.delete) {
            await this.adapter.delForeignObjectAsync(id);
        }
        // the history last: a deleted target stops logging and the history instance writes its
        // cache (and the closing marker) - give it a moment, then remove it up to now
        if (plan.delete.length && plan.removeHistory.length) {
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        const created = new Set(run.createdIds);
        for (const h of plan.removeHistory.filter(x => !x.beforeRestore)) {
            const end = created.has(h.target) ? Date.now() : h.end;
            await this.backend.deleteRange(h.target, { start: h.start, end });
        }
        this.backend.invalidate?.();

        run.status = 'rolledBack';
        run.rolledBackAt = Date.now();
        if (this.current?.id === runId) {
            this.current = run;
            await this.publish();
        }
        this.addLog(run, {
            code: 'logRolledBack',
            args: { history: plan.removeHistory.length, restored: plan.restore.length, deleted: plan.delete.length },
        });
        await this.writeJson(`${RUN_DIR}/${runId}.json`, run);
        this.adapter.log.info(
            `Run ${runId} rolled back: ${plan.removeHistory.length} histories removed, ${plan.restore.length} objects restored, ${plan.delete.length} deleted`,
        );
        return plan;
    }
}
