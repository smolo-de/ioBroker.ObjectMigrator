/** One value as the history adapter delivers it (`getRawEntries`) and accepts it (`storeState`) */
export interface HistoryEntry {
    /** Value */
    val: ioBroker.StateValue;
    /** Timestamp in ms */
    ts: number;
    /** Acknowledged */
    ack?: boolean | number;
    /** Quality code */
    q?: number;
    /** Writer of the value */
    from?: string;
}

/** Time range with inclusive borders in ms since epoch */
export interface TimeRange {
    /** First timestamp (inclusive) */
    start: number;
    /** Last timestamp (inclusive) */
    end: number;
}

/** Time range of the stored values of an ID plus their number */
export interface DataRange extends TimeRange {
    /** Number of stored values */
    count: number;
}

/** Simple value conversion, applied to the source values before writing (FR-24) */
export type Converter =
    | { type: 'none' }
    /** val * factor + offset, only for numbers */
    | { type: 'linear'; factor: number; offset: number }
    /** !val for booleans, 1 - val for 0/1 numbers */
    | { type: 'invert' }
    /** The alias read expression of the link - the history is converted exactly like the live value */
    | { type: 'expression'; read: string };

/** One source of a transfer task */
export interface SourceSpec {
    /** ID to read the history from (aliasId already resolved by the history adapter) */
    id: string;
    /** Higher priority wins if two sources have a value with the same ts. Default 0 */
    priority?: number;
    /** Conversion of the values (alias read expression of the link) */
    converter?: Converter;
}

/**
 * How overlapping periods of several sources are handled (04 §4)
 * - all: take everything, values with the same ts only once
 * - prefer: inside the range of the preferred source only its values
 * - cut: before `at` only the "old" sources, from `at` on only the others
 */
export type OverlapRule =
    | { type: 'all' }
    | { type: 'prefer'; sourceId: string }
    | { type: 'cut'; at: number; oldSourceIds: string[] }
    /** Adapter change: every source is used until the next source starts (sorted by their first value) */
    | { type: 'switch' };

/** One target with all its sources - result of the mapping in the editor */
export interface TransferTask {
    /** Target state */
    target: string;
    /** Sources with priority */
    sources: SourceSpec[];
    /** What happens where sources overlap */
    overlap: OverlapRule;
    /** Optional limitation of the migrated period (FR-45) */
    range?: Partial<TimeRange>;
    /** Take over the start/stop markers (null values) of the history adapter. Default false */
    keepMarkers?: boolean;
    /** Values excluded in the preview (FR-96): `${sourceId}|${ts}` */
    excluded?: string[];
}

/** Counters of a transfer */
export interface TransferStats {
    /** Values read from the sources */
    read: number;
    /** Values written to the target */
    written: number;
    /** Skipped - the target has a value with this timestamp */
    skippedExisting: number;
    /** Skipped - another source had a value with this timestamp */
    skippedDuplicate: number;
    /** Skipped by the overlap rule */
    skippedOverlap: number;
    /** Excluded in the preview */
    excluded: number;
    /** Start/stop markers of the history adapter (null, q=0x40) that were not taken over */
    skippedMarker: number;
}

/** Creates empty counters */
export function emptyStats(): TransferStats {
    return {
        read: 0,
        written: 0,
        skippedExisting: 0,
        skippedDuplicate: 0,
        skippedOverlap: 0,
        excluded: 0,
        skippedMarker: 0,
    };
}

/**
 * Adds the counters of `b` to `a`
 *
 * @param a - counters, changed
 * @param b - counters to add
 */
export function addStats(a: TransferStats, b: TransferStats): TransferStats {
    a.read += b.read;
    a.written += b.written;
    a.skippedExisting += b.skippedExisting;
    a.skippedDuplicate += b.skippedDuplicate;
    a.skippedOverlap += b.skippedOverlap;
    a.excluded += b.excluded;
    a.skippedMarker += b.skippedMarker;
    return a;
}
