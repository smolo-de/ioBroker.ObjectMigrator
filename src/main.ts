/*
 * ioBroker.objectmigrator
 * Migrates object settings and history data to alias objects or objects of another adapter.
 * Requirements: docs/requirements/*.md
 */

import * as utils from '@iobroker/adapter-core';
import { mirrorStructure, validateBasePath } from './lib/alias/createMode';
import { HistoryAdapterBackend, MAX_RAW_PAGE, type HistoryBackend } from './lib/history/HistoryBackend';
import { isAllowedSender } from './lib/access';
import { isRunId, isValidId, MigrationRunner } from './lib/migration/MigrationRunner';
import { findReferences, type RefSource } from './lib/refs/references';
import type { MigrationPlan } from './lib/migration/types';
import { instanceStatusMap, planSettings, type SettingsOptions } from './lib/settings/settings';

type Handler = (message: any) => Promise<unknown>;

/** The preview may use history ranges of the last 5 minutes (getDpStatistics scans all files) */
const PREVIEW_RANGES_MAX_AGE = 300_000;

/**
 * IDs of a message - only valid object IDs, at most 2000
 *
 * @param ids - IDs from a message
 */
function idList(ids: unknown): string[] {
    if (!Array.isArray(ids)) {
        return [];
    }
    return ids.filter(isValidId).slice(0, 2000);
}

class Objectmigrator extends utils.Adapter {
    private backend?: HistoryBackend;
    private runner?: MigrationRunner;

    public constructor(options: Partial<utils.AdapterOptions> = {}) {
        super({
            ...options,
            name: 'objectmigrator',
        });
        this.on('ready', this.onReady.bind(this));
        this.on('message', this.onMessage.bind(this));
        this.on('unload', this.onUnload.bind(this));
    }

    private async onReady(): Promise<void> {
        const historyInstance = this.config.historyInstance || 'history.0';
        this.backend = new HistoryAdapterBackend(historyInstance, {
            sendTo: (instance, command, message, timeout) =>
                this.sendToAsync(instance, command, message as ioBroker.MessagePayload, { timeout }),
            getForeignState: id => this.getForeignStateAsync(id),
        });
        this.runner = new MigrationRunner(this, this.backend, {
            chunkSize: Number(this.config.chunkSize) || 5000,
            chunkPauseMs: Number(this.config.chunkPauseMs) || 0,
            copyUninstalledSettings: this.config.copyUninstalledSettings !== false,
        });
        await this.runner.init();

        if (!(await this.backend.isAlive())) {
            this.log.warn(`History instance ${historyInstance} is not running - history migration is not possible`);
        }
        this.log.info(`Ready. History instance: ${historyInstance}`);
    }

    private async onUnload(callback: () => void): Promise<void> {
        try {
            await this.runner?.stop();
        } catch (e) {
            this.log.error(`Error during unloading: ${(e as Error).message}`);
        }
        callback();
    }

    /** Message API for the admin tab (07 §3) */
    private readonly handlers: Record<string, Handler> = {
        // ---- history
        'history.status': async () => ({
            instance: this.backend!.instance,
            alive: await this.backend!.isAlive(),
        }),
        'history.range': async (msg: { ids: string[]; fresh?: boolean }) => {
            return this.backend!.getRanges(idList(msg?.ids), msg?.fresh ? 0 : PREVIEW_RANGES_MAX_AGE);
        },
        // raw values for the preview (FR-90) - limited per ID
        'history.preview': async (msg: { ids: string[]; start: number; end: number; limit?: number }) => {
            const limit = Math.min(msg.limit ?? MAX_RAW_PAGE, MAX_RAW_PAGE * 4);
            const result: Record<string, unknown> = {};
            for (const id of idList(msg?.ids)) {
                const entries = await this.backend!.readRange(id, { start: Number(msg.start), end: Number(msg.end) });
                result[id] = { total: entries.length, entries: entries.slice(0, limit) };
            }
            return result;
        },

        // min/max per interval for large series (FR-95) - raw values if the range is small
        'history.aggregate': async (msg: { ids: string[]; start: number; end: number; points?: number }) => {
            const points = Math.min(Math.max(Number(msg.points) || 1000, 10), 5000);
            const ids = idList(msg?.ids);
            const ranges = await this.backend!.getRanges(ids, PREVIEW_RANGES_MAX_AGE);
            const result: Record<string, { count: number; raw: boolean; entries: unknown[] }> = {};
            for (const id of ids) {
                const range = ranges[id];
                if (!range) {
                    result[id] = { count: 0, raw: true, entries: [] };
                    continue;
                }
                const window = { start: Math.max(msg.start, range.start), end: Math.min(msg.end, range.end) };
                // a small part of the series: raw values (the count is only known for the whole series)
                const share = (window.end - window.start) / Math.max(1, range.end - range.start);
                if (range.count * share <= points * 2 || !this.backend!.readAggregated) {
                    const entries = await this.backend!.readRange(id, window);
                    result[id] = { count: range.count, raw: true, entries: entries.slice(0, MAX_RAW_PAGE * 4) };
                } else {
                    const entries = await this.backend!.readAggregated(id, window, points);
                    result[id] = { count: range.count, raw: false, entries };
                }
            }
            return { ranges, series: result };
        },

        // ---- settings
        'settings.instances': async () =>
            instanceStatusMap(await this.getForeignObjectsAsync('system.adapter.*', 'instance')),
        'settings.plan': async (msg: { sourceId: string; targetId?: string; options?: SettingsOptions }) => {
            if (!isValidId(msg?.sourceId) || (msg.targetId !== undefined && !isValidId(msg.targetId))) {
                throw new Error('Invalid ID');
            }
            const source = await this.getForeignObjectAsync(msg.sourceId);
            if (!source) {
                throw new Error(`${msg.sourceId} not found`);
            }
            const target = msg.targetId ? await this.getForeignObjectAsync(msg.targetId) : undefined;
            const instances = instanceStatusMap(await this.getForeignObjectsAsync('system.adapter.*', 'instance'));
            return planSettings(source, target ?? undefined, instances, {
                copyUninstalled: this.config.copyUninstalledSettings !== false,
                ...msg.options,
            });
        },

        // ---- create mode
        'mirror.preview': async (msg: { sourceRoot: string; basePath: string; onlySourceIds?: string[] }) => {
            const errors = validateBasePath(String(msg?.basePath ?? ''));
            if (!isValidId(msg?.sourceRoot)) {
                errors.push({ code: 'invalidId', args: { value: String(msg?.sourceRoot) } });
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
            for (let parts = msg.basePath.split('.'); parts.length > 2; parts.pop()) {
                if (await this.getForeignObjectAsync(parts.join('.'))) {
                    existingIds.add(parts.join('.'));
                }
            }
            return {
                errors: [],
                drafts: mirrorStructure(msg.sourceRoot, objects, msg.basePath, {
                    existingIds,
                    onlySourceIds: msg.onlySourceIds ? new Set(idList(msg.onlySourceIds)) : undefined,
                }),
            };
        },

        // ---- "Prüfen" / "Schreiben" (06 §5)
        'plan.check': (msg: MigrationPlan) => this.runner!.check(msg),
        'plan.write': (msg: MigrationPlan) => this.runner!.write(msg),
        'run.cancel': () => {
            this.runner!.cancel();
            return Promise.resolve(this.runner!.getCurrent());
        },
        'run.abort': () => {
            this.runner!.abort();
            return Promise.resolve(this.runner!.getCurrent());
        },
        'run.status': (msg?: { runId?: string }) =>
            msg?.runId ? this.runner!.loadRun(msg.runId) : Promise.resolve(this.runner!.getCurrent()),
        'run.list': () => this.runner!.listRuns(),
        'run.rollbackPlan': (msg: { runId: string }) => this.runner!.rollbackPlan(msg?.runId),
        'run.rollback': (msg: { runId: string }) => {
            if (!isRunId(msg?.runId)) {
                throw new Error('Invalid run ID');
            }
            return this.runner!.rollback(msg.runId);
        },

        // ---- where are the IDs used (FR-70)
        'refs.find': async (msg: { ids: string[] }) => findReferences(idList(msg?.ids), await this.referenceSources()),
        // DB names (aliasId) of the logging instances (FR-57) - with the values under the name at the history instance
        'dbNames.list': async () => {
            const view = await this.getObjectViewAsync('system', 'custom', {});
            const rows: { id: string; instance: string; name: string; enabled: boolean }[] = [];
            for (const row of view?.rows ?? []) {
                const custom = (row.value ?? {}) as Record<string, { aliasId?: unknown; enabled?: unknown } | null>;
                for (const [instance, cfg] of Object.entries(custom)) {
                    const name = typeof cfg?.aliasId === 'string' ? cfg.aliasId.trim() : '';
                    if (/^(history|sql|influxdb)\.\d+$/.test(instance) && name && name !== row.id) {
                        rows.push({ id: row.id, instance, name, enabled: cfg?.enabled !== false });
                    }
                }
            }
            const names = rows.filter(r => r.instance === this.backend!.instance).map(r => r.name);
            const ranges = names.length && (await this.backend!.isAlive()) ? await this.backend!.getRanges(names) : {};
            return rows
                .map(r => ({ ...r, range: r.instance === this.backend!.instance ? ranges[r.name] : undefined }))
                .sort((a, b) => a.id.localeCompare(b.id) || a.instance.localeCompare(b.instance));
        },

        // ---- templates of the create mode
        'template.list': () => this.runner!.listTemplates(),
        'template.save': (msg: { name: string; template: unknown }) =>
            this.runner!.saveTemplate(msg.name, msg.template),
        'template.load': (msg: { name: string }) => this.runner!.loadTemplate(msg.name),
        'template.delete': (msg: { name: string }) => this.runner!.deleteTemplate(msg.name),

        // ---- drafts of the editor (WR-01)
        'plan.save': (msg: { name?: string; plan: unknown; baseVersion?: number }) =>
            this.runner!.savePlan(
                String(msg?.name ?? 'current'),
                msg?.plan,
                typeof msg?.baseVersion === 'number' ? msg.baseVersion : undefined,
            ),
        'plan.load': (msg?: { name?: string }) => this.runner!.loadPlan(msg?.name ?? 'current'),
    };

    /**
     * All objects below an ID. Without a type js-controller returns only states, so the four
     * structure types are read one after the other.
     *
     * @param root - parent ID
     */
    private async getSubtree(root: string): Promise<Record<string, ioBroker.Object>> {
        const result: Record<string, ioBroker.Object> = {};
        for (const type of ['state', 'channel', 'device', 'folder'] as const) {
            Object.assign(result, await this.getForeignObjectsAsync(`${root}.*`, type));
        }
        return result;
    }

    /** Texts of all places that may use object IDs (FR-70) */
    private async referenceSources(): Promise<RefSource[]> {
        const sources: RefSource[] = [];
        const name = (common: Record<string, unknown> | undefined): string | undefined => {
            const n = common?.name;
            return typeof n === 'string' ? n : n && typeof n === 'object' ? JSON.stringify(n) : undefined;
        };
        const scripts = await this.getForeignObjectsAsync('script.js.*', 'script');
        for (const [id, obj] of Object.entries(scripts)) {
            const source = (obj.common as { source?: string }).source;
            if (source) {
                sources.push({
                    kind: 'script',
                    location: id,
                    name: name(obj.common as unknown as Record<string, unknown>),
                    text: source,
                });
            }
        }
        const instances = await this.getForeignObjectsAsync('system.adapter.*', 'instance');
        for (const [id, obj] of Object.entries(instances)) {
            if (id === `system.adapter.${this.namespace}` || !obj.native) {
                continue;
            }
            sources.push({ kind: 'instance', location: id, text: JSON.stringify(obj.native) });
            const instance = id.replace(/^system\.adapter\./, '');
            // lovelace keeps its dashboards in <instance>.configuration
            if (instance.startsWith('lovelace.')) {
                const config = await this.getForeignObjectAsync(`${instance}.configuration`);
                if (config) {
                    sources.push({ kind: 'lovelace', location: config._id, text: JSON.stringify(config.native ?? {}) });
                }
            }
            // VIS / VIS-2 projects
            const adapter = instance.split('.')[0];
            if (adapter === 'vis' || adapter === 'vis-2') {
                try {
                    const projects = await this.readDirAsync(instance, '');
                    for (const project of projects.filter(p => p.isDir)) {
                        try {
                            const file = await this.readFileAsync(instance, `${project.file}/vis-views.json`);
                            sources.push({
                                kind: 'vis',
                                location: `${instance}/${project.file}`,
                                text: file.file.toString(),
                            });
                        } catch {
                            // project without views
                        }
                    }
                } catch {
                    // no projects
                }
            }
        }
        const aliases = await this.getForeignObjectsAsync('alias.*', 'state');
        for (const [id, obj] of Object.entries(aliases)) {
            const alias = obj.common.alias;
            if (alias) {
                sources.push({ kind: 'alias', location: id, text: JSON.stringify(alias) });
            }
        }
        const enums = await this.getForeignObjectsAsync('enum.*', 'enum');
        for (const [id, obj] of Object.entries(enums)) {
            const members = obj.common.members;
            if (members?.length) {
                sources.push({
                    kind: 'enum',
                    location: id,
                    name: name(obj.common as unknown as Record<string, unknown>),
                    text: JSON.stringify(members),
                });
            }
        }
        return sources;
    }

    private async onMessage(obj: ioBroker.Message): Promise<void> {
        if (!obj?.command) {
            return;
        }
        const handler = Object.hasOwn(this.handlers, obj.command) ? this.handlers[obj.command] : undefined;
        let response: unknown;
        if (!isAllowedSender(obj.from)) {
            this.log.warn(
                `Message "${obj.command}" from ${obj.from} rejected - only the admin may control the migrator`,
            );
            response = { ok: false, error: { code: 'FORBIDDEN', message: 'Only the admin may control the migrator' } };
        } else if (!handler) {
            response = { ok: false, error: { code: 'UNKNOWN_COMMAND', message: `Unknown command ${obj.command}` } };
        } else if (!this.backend || !this.runner) {
            response = { ok: false, error: { code: 'NOT_READY', message: 'Adapter is not ready yet' } };
        } else {
            try {
                response = { ok: true, data: await handler(obj.message) };
            } catch (e) {
                this.log.warn(`${obj.command} failed: ${(e as Error).message}`);
                response = { ok: false, error: { code: 'FAILED', message: (e as Error).message } };
            }
        }
        if (obj.callback) {
            this.sendTo(obj.from, obj.command, response as ioBroker.MessagePayload, obj.callback);
        }
    }
}

if (require.main !== module) {
    // Export the constructor in compact mode
    module.exports = (options: Partial<utils.AdapterOptions> | undefined) => new Objectmigrator(options);
} else {
    // otherwise start the instance directly
    (() => new Objectmigrator())();
}
