import type { HistoryBackend } from './HistoryBackend';
import { mergeWindow, resolveOverlap } from './merge';
import {
    addStats,
    emptyStats,
    type DataRange,
    type HistoryEntry,
    type TimeRange,
    type TransferStats,
    type TransferTask,
} from './types';

const DAY = 24 * 60 * 60 * 1000;

/**
 * Local midnight of the day of `ts`
 *
 * @param ts - timestamp in ms
 */
export function startOfDay(ts: number): number {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
}

/**
 * Local midnight of the following day (handles DST)
 *
 * @param dayStart - local midnight of a day
 */
export function nextDay(dayStart: number): number {
    const d = new Date(dayStart + DAY + 2 * 60 * 60 * 1000);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
}

/** Progress of one task */
export interface TransferProgress {
    /** Target ID */
    target: string;
    /** Start of the day that was just finished */
    day: number;
    /** 0..1 with respect to the time range of the task */
    fraction: number;
    /** Counters so far */
    stats: TransferStats;
}

/** Result of one task - also the basis for the rollback (HM-12) */
export interface TransferResult {
    /** Target ID */
    target: string;
    /** Range of the target data before the transfer - undefined if the target was empty */
    targetRangeBefore?: TimeRange;
    /** First and last ts actually written */
    written?: TimeRange;
    /** Counters */
    stats: TransferStats;
    /** Stopped by "Abbrechen" - a new run continues, written values are skipped (HM-05) */
    cancelled?: boolean;
}

/** Options of the runner */
export interface TransferOptions {
    /** Values per `storeState` (≤ 5000) */
    chunkSize: number;
    /** Pause after every chunk in ms (HM-06) */
    pauseMs: number;
    /** Polled before every day and every chunk */
    isCancelled?: () => boolean;
    /** Called after every day */
    onProgress?: (progress: TransferProgress) => void;
    /** Ranges determined before (one `getDpStatistics` for all tasks) - otherwise they are fetched */
    ranges?: Record<string, DataRange | undefined>;
    /** Replaceable for tests */
    sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Determines the overall range of a task: union of the source ranges, limited by `task.range`
 *
 * @param ranges - first/last ts per source
 * @param limit - optional limitation
 */
export function taskRange(ranges: (TimeRange | undefined)[], limit?: Partial<TimeRange>): TimeRange | undefined {
    const valid = ranges.filter((r): r is TimeRange => !!r);
    if (!valid.length) {
        return undefined;
    }
    const start = Math.max(Math.min(...valid.map(r => r.start)), limit?.start ?? Number.MIN_SAFE_INTEGER);
    const end = Math.min(Math.max(...valid.map(r => r.end)), limit?.end ?? Number.MAX_SAFE_INTEGER);
    return start <= end ? { start, end } : undefined;
}

/**
 * Reads the history of all sources of the task day by day through the history adapter,
 * merges it and writes it to the target with `storeState` (04 §2).
 * Source data is only read, target values are only added. Values that exist at the target are
 * skipped, so after a cancel the same task can simply be started again.
 *
 * @param backend - the history instance
 * @param task - target, sources and rules
 * @param options - throttling, cancel and progress
 */
export async function runTransfer(
    backend: HistoryBackend,
    task: TransferTask,
    options: TransferOptions,
): Promise<TransferResult> {
    const sleep = options.sleep ?? defaultSleep;
    const chunkSize = Math.max(1, Math.min(options.chunkSize || 5000, 5000));
    const isCancelled = options.isCancelled ?? ((): boolean => false);
    const result: TransferResult = { target: task.target, stats: emptyStats() };

    const ids = [...task.sources.map(s => s.id), task.target];
    const known =
        options.ranges && ids.every(id => id in options.ranges!) ? options.ranges : await backend.getRanges(ids);
    const sourceRanges: Record<string, TimeRange | undefined> = {};
    for (const source of task.sources) {
        sourceRanges[source.id] = known[source.id];
    }
    const before = known[task.target];
    result.targetRangeBefore = before ? { start: before.start, end: before.end } : undefined;

    const range = taskRange(Object.values(sourceRanges), task.range);
    if (!range) {
        return result;
    }

    const exclude = resolveOverlap(task.sources, sourceRanges, task.overlap);
    const excluded = task.excluded?.length ? new Set(task.excluded) : undefined;
    const activeSources = task.sources.filter(s => sourceRanges[s.id]);
    const total = Math.max(1, range.end - range.start);

    // values of several days are collected until a chunk is full, so the pause applies per chunk
    // and not per day (series with few values per day would otherwise be throttled to one day per pause)
    // On cancel the buffer (less than two chunks, already read and merged) is still written.
    let buffer: HistoryEntry[] = [];
    const flush = async (all: boolean): Promise<boolean> => {
        while (buffer.length >= chunkSize || (all && buffer.length)) {
            if (!all && isCancelled()) {
                return false;
            }
            const chunk = buffer.slice(0, chunkSize);
            buffer = buffer.slice(chunkSize);
            await backend.store(task.target, chunk);
            result.written = {
                start: Math.min(result.written?.start ?? chunk[0].ts, chunk[0].ts),
                end: Math.max(result.written?.end ?? chunk[chunk.length - 1].ts, chunk[chunk.length - 1].ts),
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

        const window: TimeRange = {
            start: Math.max(day, range.start),
            end: Math.min(nextDay(day) - 1, range.end),
        };

        const entries: Record<string, HistoryEntry[]> = {};
        let any = false;
        for (const source of activeSources) {
            const r = sourceRanges[source.id]!;
            if (r.end < window.start || r.start > window.end) {
                continue;
            }
            entries[source.id] = await backend.readRange(source.id, window);
            any ||= entries[source.id].length > 0;
        }

        if (any) {
            const existing = await backend.readRange(task.target, window);
            const { toWrite, stats } = mergeWindow({
                entries,
                sources: activeSources,
                existingTargetTs: new Set(existing.map(e => e.ts)),
                exclude,
                excluded,
                keepMarkers: task.keepMarkers,
            });

            buffer.push(...toWrite);
            addStats(result.stats, stats);
            if (!(await flush(false))) {
                await flush(true);
                return { ...result, cancelled: true };
            }
        }

        options.onProgress?.({
            target: task.target,
            day,
            fraction: Math.min(1, (window.end - range.start) / total),
            stats: result.stats,
        });
    }

    await flush(true);
    return result;
}
