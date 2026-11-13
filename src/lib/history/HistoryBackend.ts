import type { DataRange, HistoryEntry, TimeRange } from './types';

/** Access to one history instance - only through its message API (04 §0.2) */
export interface HistoryBackend {
    /** e.g. `history.0` */
    readonly instance: string;
    /** Is the instance running? */
    isAlive(): Promise<boolean>;
    /**
     * First/last ts and number of values per ID (undefined: no data) - one call for many IDs.
     * maxAgeMs > 0 allows a result of a previous call that is not older (default: always fresh).
     */
    getRanges(ids: string[], maxAgeMs?: number): Promise<Record<string, DataRange | undefined>>;
    /** Forgets cached ranges (after writing or a rollback) */
    invalidate?(): void;
    /** All raw values of an ID in the range (inclusive borders), sorted ascending */
    readRange(id: string, range: TimeRange): Promise<HistoryEntry[]>;
    /** Adds values to an ID (`storeState`) */
    store(id: string, entries: HistoryEntry[]): Promise<void>;
    /** Deletes the values of an ID in the range (`deleteRange`, inclusive borders) */
    deleteRange(id: string, range: TimeRange): Promise<void>;
    /** Configuration of the logged datapoints by object ID (`getEnabledDPs`) - contains `aliasId` */
    enabledDPs?(): Promise<Record<string, Record<string, unknown>>>;
    /** Min/max per interval for the preview of large series (FR-95) - about 2 × points values */
    readAggregated?(id: string, range: TimeRange, points: number): Promise<HistoryEntry[]>;
}

/** The part of the adapter needed for the message API - makes the backend testable */
export interface MessageTransport {
    /** Sends a message to an instance and waits for the answer */
    sendTo(instance: string, command: string, message: unknown, timeoutMs: number): Promise<unknown>;
    /** Reads a foreign state */
    getForeignState(id: string): Promise<ioBroker.State | null | undefined>;
}

interface StatisticsAnswer {
    error?: string;
    result?: { id: string; count: number; firstTs: number | null; lastTs: number | null }[];
}

/**
 * File name part of an ID as the history adapter builds it
 *
 * @param id - state ID
 */
export function historySafeId(id: string): string {
    // eslint-disable-next-line no-control-regex
    return id.replace(/[\u0000|*,;"'<>?:/\\]/g, '~');
}

interface RawEntriesAnswer {
    error?: string;
    result?: HistoryEntry[];
}

/** Maximal page size of `getRawEntries` in the history adapter */
export const MAX_RAW_PAGE = 5000;

/** History backend for the standard `history` adapter (v5.2+: `getRawEntries`, `getDpStatistics`) */
export class HistoryAdapterBackend implements HistoryBackend {
    /**
     * @param instance - e.g. `history.0`
     * @param transport - message transport
     * @param timeoutMs - timeout per message
     */
    public constructor(
        public readonly instance: string,
        private readonly transport: MessageTransport,
        private readonly timeoutMs = 120_000,
    ) {}

    private async send<T>(command: string, message: unknown, timeoutMs = this.timeoutMs): Promise<T> {
        const answer = (await this.transport.sendTo(this.instance, command, message, timeoutMs)) as
            (T & { error?: string }) | undefined;
        if (answer === undefined || answer === null) {
            throw new Error(`${this.instance}: no answer to "${command}"`);
        }
        if (typeof answer === 'object' && answer.error) {
            throw new Error(`${this.instance}: ${command} failed: ${answer.error}`);
        }
        return answer;
    }

    public async enabledDPs(): Promise<Record<string, Record<string, unknown>>> {
        return (await this.send<Record<string, Record<string, unknown>>>('getEnabledDPs', {})) ?? {};
    }

    public async isAlive(): Promise<boolean> {
        const state = await this.transport.getForeignState(`system.adapter.${this.instance}.alive`);
        return !!state?.val;
    }

    private async rawPage(
        id: string,
        options: { start?: number; end?: number; sort: 'asc' | 'desc'; limit: number; offset: number },
    ): Promise<HistoryEntry[]> {
        const answer = await this.send<RawEntriesAnswer>('getRawEntries', { id, noTotal: true, ...options });
        return (answer.result ?? []).filter(e => e && typeof e.ts === 'number');
    }

    /**
     * Uses `getDpStatistics`: it scans all files once and has no limit. `getRawEntries` without a range
     * reads only the newest 100000 values, so it can not determine the first value of a large series.
     *
     * @param ids - state IDs
     * @param maxAgeMs - a cached result may be this old, 0 = always fresh
     */
    public async getRanges(ids: string[], maxAgeMs = 0): Promise<Record<string, DataRange | undefined>> {
        const result: Record<string, DataRange | undefined> = {};
        if (!ids.length) {
            return result;
        }
        const byId = await this.statistics(maxAgeMs);
        for (const id of ids) {
            const stat = byId.get(id) ?? byId.get(historySafeId(id));
            result[id] =
                stat && stat.count > 0 && stat.firstTs !== null && stat.lastTs !== null
                    ? { start: stat.firstTs, end: stat.lastTs, count: stat.count }
                    : undefined;
        }
        return result;
    }

    /** Statistics of all data points, cached - getDpStatistics scans all files (slow on large installations) */
    private stats?: { at: number; byId: Map<string, NonNullable<StatisticsAnswer['result']>[number]> };
    private statsPending?: Promise<Map<string, NonNullable<StatisticsAnswer['result']>[number]>>;

    private async statistics(maxAgeMs: number): Promise<Map<string, NonNullable<StatisticsAnswer['result']>[number]>> {
        if (maxAgeMs > 0 && this.stats && Date.now() - this.stats.at <= maxAgeMs) {
            return this.stats.byId;
        }
        // several callers at the same time share one scan
        this.statsPending ??= this.send<StatisticsAnswer>('getDpStatistics', {}, Math.max(this.timeoutMs, 600_000))
            .then(answer => {
                const byId = new Map((answer.result ?? []).map(stat => [stat.id, stat]));
                this.stats = { at: Date.now(), byId };
                return byId;
            })
            .finally(() => {
                this.statsPending = undefined;
            });
        return this.statsPending;
    }

    public invalidate(): void {
        this.stats = undefined;
    }

    public async readRange(id: string, range: TimeRange): Promise<HistoryEntry[]> {
        const all: HistoryEntry[] = [];
        // The adapter caps a page below the requested limit (history 5.2: 2000, 5.3: 5000), so a
        // short page does not mean "finished": advance by what was returned, stop at an empty page.
        for (let offset = 0; ;) {
            const page = await this.rawPage(id, {
                start: range.start,
                end: range.end,
                sort: 'asc',
                limit: MAX_RAW_PAGE,
                offset,
            });
            if (!page.length) {
                break;
            }
            all.push(...page);
            offset += page.length;
        }
        // the adapter filters by day files - make sure the borders are exact
        return all.filter(e => e.ts >= range.start && e.ts <= range.end);
    }

    public async readAggregated(id: string, range: TimeRange, points: number): Promise<HistoryEntry[]> {
        const answer = await this.send<RawEntriesAnswer>('getHistory', {
            id,
            options: {
                start: range.start,
                end: range.end,
                aggregate: 'minmax',
                count: Math.max(10, Math.min(points, 5000)),
                ignoreNull: true,
                ack: true,
                from: true,
            },
        });
        return (answer.result ?? [])
            .filter(e => e && typeof e.ts === 'number' && e.ts >= range.start && e.ts <= range.end)
            .sort((a, b) => a.ts - b.ts);
    }

    public async store(id: string, entries: HistoryEntry[]): Promise<void> {
        if (!entries.length) {
            return;
        }
        await this.send('storeState', { id, state: entries });
    }

    public async deleteRange(id: string, range: TimeRange): Promise<void> {
        await this.send('deleteRange', [{ id, start: range.start, end: range.end }]);
    }
}
