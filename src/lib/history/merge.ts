import { compileExpression } from '../alias/converter';
import {
    emptyStats,
    type Converter,
    type DataRange,
    type HistoryEntry,
    type OverlapRule,
    type SourceSpec,
    type TimeRange,
    type TransferStats,
} from './types';

/** Ranges in which the values of a source are NOT taken */
export type ExcludeRanges = Record<string, TimeRange[]>;

/**
 * Translates the overlap rule into ranges per source in which its values are dropped
 *
 * @param sources - all sources of the task
 * @param ranges - first/last ts per source ID (sources without data are missing)
 * @param rule - the overlap rule
 */
export function resolveOverlap(
    sources: SourceSpec[],
    ranges: Record<string, TimeRange | undefined>,
    rule: OverlapRule,
): ExcludeRanges {
    const result: ExcludeRanges = {};
    for (const s of sources) {
        result[s.id] = [];
    }
    if (rule.type === 'prefer') {
        const preferred = ranges[rule.sourceId];
        if (preferred) {
            for (const s of sources) {
                if (s.id !== rule.sourceId) {
                    result[s.id].push({ start: preferred.start, end: preferred.end });
                }
            }
        }
    } else if (rule.type === 'switch') {
        const withData = sources.filter(s => ranges[s.id]).sort((a, b) => ranges[a.id]!.start - ranges[b.id]!.start);
        for (let i = 0; i < withData.length - 1; i++) {
            result[withData[i].id].push({ start: ranges[withData[i + 1].id]!.start, end: Number.MAX_SAFE_INTEGER });
        }
    } else if (rule.type === 'cut') {
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

/**
 * Applies a converter to one value
 *
 * @param val - the value
 * @param converter - the conversion
 */
export function convertValue(val: ioBroker.StateValue, converter?: Converter): ioBroker.StateValue {
    if (!converter || converter.type === 'none' || val === null || val === undefined) {
        return val;
    }
    if (converter.type === 'expression') {
        return compileExpression(converter.read)(val) as ioBroker.StateValue;
    }
    if (converter.type === 'linear') {
        return typeof val === 'number' ? val * converter.factor + converter.offset : val;
    }
    // invert
    if (typeof val === 'boolean') {
        return !val;
    }
    if (val === 0 || val === 1) {
        return 1 - val;
    }
    return val;
}

/**
 * Start/stop marker of the history adapter (option "writeNulls"): null with q = 0x40.
 * At the merged target they would show gaps exactly where the source changed (04 §7).
 *
 * @param entry - a stored value
 */
export function isLoggingMarker(entry: HistoryEntry): boolean {
    return entry.val === null && (entry.q === 0x40 || (entry.from?.startsWith('system.adapter.history.') ?? false));
}

function inRanges(ts: number, ranges: TimeRange[] | undefined): boolean {
    return !!ranges?.some(r => ts >= r.start && ts <= r.end);
}

/** Input for merging one time window (usually one day) */
export interface MergeInput {
    /** Values read per source ID */
    entries: Record<string, HistoryEntry[]>;
    /** All sources of the task */
    sources: SourceSpec[];
    /** ts that already exist at the target - never written again (HM-05) */
    existingTargetTs: Set<number>;
    /** Ranges per source whose values are dropped (overlap rule) */
    exclude: ExcludeRanges;
    /** `${sourceId}|${ts}` */
    excluded?: Set<string>;
    /** Take over the start/stop markers of the history adapter. Default false */
    keepMarkers?: boolean;
}

/**
 * Merges the values of all sources of one window into the list to write to the target.
 * The result is sorted by ts and contains every ts only once.
 *
 * @param input - values and rules
 */
export function mergeWindow(input: MergeInput): { toWrite: HistoryEntry[]; stats: TransferStats } {
    const stats = emptyStats();
    const byTs = new Map<number, HistoryEntry>();
    // highest priority first, so it occupies the ts
    const ordered = [...input.sources].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

    for (const source of ordered) {
        const list = input.entries[source.id] ?? [];
        for (const entry of list) {
            if (!entry || typeof entry.ts !== 'number') {
                continue;
            }
            stats.read++;
            if (!input.keepMarkers && isLoggingMarker(entry)) {
                stats.skippedMarker++;
                continue;
            }
            if (input.excluded?.has(`${source.id}|${entry.ts}`)) {
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
            const out: HistoryEntry = { val: convertValue(entry.val, source.converter), ts: entry.ts };
            if (entry.ack !== undefined) {
                out.ack = !!entry.ack;
            }
            if (entry.q !== undefined) {
                out.q = entry.q;
            }
            if (entry.from !== undefined) {
                out.from = entry.from;
            }
            byTs.set(entry.ts, out);
        }
    }

    const toWrite = [...byTs.values()].sort((a, b) => a.ts - b.ts);
    stats.written = toWrite.length;
    return { toWrite, stats };
}

/**
 * Estimated number of values a task writes (for "Prüfen"): every source contributes the share of its
 * values outside the ranges excluded by the overlap rule, assuming evenly spread values. Values with
 * a timestamp the target has already are not counted exactly - it is an estimate.
 *
 * @param sources - sources of the task
 * @param ranges - first/last ts and count per source
 * @param rule - overlap rule
 */
export function estimateValues(
    sources: SourceSpec[],
    ranges: Record<string, DataRange | undefined>,
    rule: OverlapRule,
): { perSource: Record<string, number>; total: number } {
    const exclude = resolveOverlap(sources, ranges, rule);
    const perSource: Record<string, number> = {};
    let total = 0;
    for (const s of sources) {
        const r = ranges[s.id];
        if (!r || !r.count) {
            perSource[s.id] = 0;
            continue;
        }
        const span = r.end - r.start;
        let excluded = 0;
        for (const e of exclude[s.id] ?? []) {
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
