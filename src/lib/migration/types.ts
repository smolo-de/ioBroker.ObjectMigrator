import type { DraftObject } from '../alias/createMode';
import type { TransferResult } from '../history/transfer';
import type { DataRange, TransferTask } from '../history/types';
import type { Message } from '../messages';
import type { SettingsOptions, SettingsPlan } from '../settings/settings';

/** Settings takeover of one state */
export interface SettingsMapping {
    /** Source state - missing for settings of a target without source (new values, SO-08) */
    sourceId?: string;
    /** Target state (existing or draft) */
    targetId: string;
    /** Selection, overrides, modes */
    options?: SettingsOptions;
    /** Take over room/function membership (FR-32). Default true */
    enums?: boolean;
    /** Further sources of the same target: their history settings are disabled too (only if chosen) */
    disableHistoryAt?: string[];
}

/** `common.alias` of an alias - replaced completely, so an old read/write function does not stay */
/** `common.alias.id`: one source, or separate sources for reading and writing (FR-52) */
export type AliasId = string | { read: string; write: string };

/** `common.alias` of a state */
export interface AliasDefinition {
    /** Source of the live value */
    id: AliasId;
    /** Formula source → alias */
    read?: string;
    /** Formula alias → source */
    write?: string;
}

/** New alias definition of an existing alias (UC-3B: remap to the new adapter, conversion) */
export interface AliasUpdate {
    /** Existing alias */
    targetId: string;
    /** New definition */
    alias: AliasDefinition;
}

/** What "Schreiben" executes (WR-03) - built by the mapping editor */
export interface MigrationPlan {
    /** Objects of the create mode (existing ones are skipped) */
    drafts?: DraftObject[];
    /** Settings per state */
    mappings?: SettingsMapping[];
    /** History per target */
    tasks?: TransferTask[];
    /** alias.id / read / write of existing aliases - applied after the history */
    aliases?: AliasUpdate[];
    /** DB names (`aliasId`) of logging adapters (FR-57, HM-14) - applied first */
    dbNames?: DbNameChange[];
}

/** Changes the name a logging instance stores a datapoint under (`aliasId`, UC-7b) */
export interface DbNameChange {
    /** Object ID */
    id: string;
    /** Logging instance, e.g. history.0 */
    instance: string;
    /** New DB name - '' (or the object ID): the values are stored under the object ID again */
    to: string;
    /** Move the values from the old name to the new one (only the history instance of the migrator) */
    moveValues?: boolean;
}

/** What a run did with a DB name */
export interface DbNameResult {
    /** Object ID */
    id: string;
    /** Logging instance */
    instance: string;
    /** Name the values were stored under before */
    from: string;
    /** Name they are stored under now */
    to: string;
    /** Values moved from `from` to `to` */
    moved?: TransferResult;
}

/** Status of a run */
export type RunStatus = 'running' | 'cancelled' | 'failed' | 'done' | 'rolledBack';
/** Step of a run */
export type RunPhase = 'objects' | 'history' | 'settings' | 'finished';

/** One execution of "Schreiben" - stored for the report and the rollback */
export interface MigrationRun {
    /** ID, e.g. run-2026-11-12T20-00-00-000Z */
    id: string;
    /** Status */
    status: RunStatus;
    /** Current step */
    phase: RunPhase;
    /** The executed plan */
    plan: MigrationPlan;
    /** Index of the current history task */
    taskIndex: number;
    /** Result per history task */
    results: TransferResult[];
    /** IDs created by the run (for rollback) */
    createdIds: string[];
    /** Start time */
    startedAt: number;
    /** End time */
    finishedAt?: number;
    /** Error message if failed */
    error?: string;
    /** Warnings of the check */
    warnings: Message[];
    /** Time of the rollback */
    rolledBackAt?: number;
    /** "Abbruch": the run is rolled back when it has stopped */
    abortRequested?: boolean;
    /** What the run did, line by line (shown live and in the report) */
    log?: RunLogEntry[];
    /** DB names changed by the run (FR-57) */
    dbNames?: DbNameResult[];
}

/** One line of the log of a run */
export interface RunLogEntry {
    /** Time */
    ts: number;
    /** Text as code and arguments (translated in the admin tab); id = target */
    msg: Message;
}

/** Line of the run list ("Verlauf") */
export interface RunSummary {
    /** Run ID */
    id: string;
    /** Status */
    status: RunStatus;
    /** Start time */
    startedAt: number;
    /** End time */
    finishedAt?: number;
    /** Time of the rollback */
    rolledBackAt?: number;
    /** Objects created */
    created: number;
    /** Settings written */
    settings: number;
    /** History targets */
    targets: number;
    /** Values written / skipped because the target had them */
    written: number;
    /** Values skipped because the target had them */
    skippedExisting: number;
    /** Error message */
    error?: string;
}

/** What a rollback does - shown before it is executed */
export interface RollbackPlan {
    /** History values removed per target (written range) */
    removeHistory: { target: string; start: number; end: number; written: number; beforeRestore?: boolean }[];
    /** Targets that had values before in the written range: their history is kept */
    keepHistory: string[];
    /** Objects restored from the backup (state before the run) */
    restore: string[];
    /** Objects created by the run - deleted */
    delete: string[];
    /** The backup of the objects is missing */
    noBackup: boolean;
}

/** Result of "Prüfen" (WR-02) */
export interface CheckResult {
    /** No errors */
    ok: boolean;
    /** Errors - block "Schreiben" */
    errors: Message[];
    /** Warnings */
    warnings: Message[];
    /** Configured history instance */
    historyInstance: string;
    /** Is it running */
    historyAlive: boolean;
    /** Objects of the draft */
    objects: { id: string; action: 'create' | 'exists' }[];
    /** Settings per mapping */
    settings: (SettingsMapping & { plan: SettingsPlan; enumChanges: { enumId: string; members: string[] }[] })[];
    /** Alias updates: current and new definition */
    aliases: { targetId: string; from?: unknown; to: AliasDefinition }[];
    /** History per target */
    history: {
        target: string;
        /** Values at the target before (with count) */
        targetRange?: DataRange;
        /** Values per source; estimate = values expected to be written from this source */
        sources: { id: string; range?: DataRange; estimate?: number }[];
        /** Estimated values written in total (overlap rule applied, evenly spread values assumed) */
        estimate?: number;
        /** Retention of the target in seconds, if set */
        retention?: number;
    }[];
    /** DB names to change: old and new name, values under the old name */
    dbNames?: { id: string; instance: string; from: string; to: string; move: boolean; range?: DataRange }[];
}
