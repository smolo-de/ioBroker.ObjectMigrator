/*
 * Messages of "Prüfen" and the create mode: the backend sends only a code and arguments,
 * the admin tab shows them in the language of the user (de/en). The English text is also used
 * for the log of the adapter.
 */

/** Codes of all messages */
export type MessageCode =
    | 'basePathNotAlias'
    | 'basePathEmptySegment'
    | 'basePathForbidden'
    | 'draftDuplicate'
    | 'draftTypeConflict'
    | 'draftNoSource'
    | 'sourceMissing'
    | 'targetMissing'
    | 'instanceMissingSkipped'
    | 'instanceMissingCopied'
    | 'instanceDisabled'
    | 'targetHasSettings'
    | 'doubleLogging'
    | 'lovelaceDuplicate'
    | 'historyNotRunning'
    | 'taskTargetTwice'
    | 'taskSourceTwice'
    | 'retentionDeletes'
    | 'aliasNotAlias'
    | 'aliasTargetMissing'
    | 'invalidId'
    | 'invalidExpression'
    // log of a run ("Schreiben")
    | 'logStart'
    | 'logObjects'
    | 'logTask'
    | 'logTaskProgress'
    | 'logNoHistory'
    | 'logSettings'
    | 'logAliases'
    | 'logDbName'
    | 'dbNameNoSettings'
    | 'dbNameUnchanged'
    | 'dbNameNoMove'
    | 'dbNameInstance'
    | 'logCatchUp'
    | 'logDone'
    | 'logStopped'
    | 'logFailed'
    | 'logAbort'
    | 'logRolledBack';

/** One message: code, the object it belongs to and the values for the text */
export interface Message {
    /** What happened */
    code: MessageCode;
    /** Object (target or source) the message belongs to - used for grouping */
    id?: string;
    /** Values for the text */
    args?: Record<string, string | number>;
}

type Texts = Record<MessageCode, string>;

const en: Texts = {
    basePathNotAlias: 'The path must start with "alias.0"',
    basePathEmptySegment: 'Empty part at position {pos}',
    basePathForbidden: 'Part "{part}" contains forbidden characters',
    draftDuplicate: 'The ID is used twice in the draft',
    draftTypeConflict: 'Exists already as {type}',
    draftNoSource: 'No source: created without alias.id - delivers no values until a source is linked',
    sourceMissing: 'Source {source} does not exist',
    targetMissing: 'Target does not exist and is not part of the draft',
    instanceMissingSkipped: '{key}: instance {instance} is not installed - skipped',
    instanceMissingCopied: '{key}: instance {instance} is not installed - settings are taken over anyway',
    instanceDisabled: '{key}: instance {instance} is disabled',
    targetHasSettings: '{key}: the target has settings already - merged, the source wins',
    doubleLogging: '{key}: stays active at the source - source and target both log (double logging)',
    lovelaceDuplicate: '{key}: same entity at source and target - change the name at the target',
    historyNotRunning: 'The history instance {instance} is not running',
    taskTargetTwice: 'The target is used in more than one history task',
    taskSourceTwice: 'Source {source} is listed twice',
    retentionDeletes:
        'The retention ({days} days) would delete migrated values - set another retention (e.g. 0 = keep forever)',
    aliasNotAlias: 'Only objects below alias.0 can get an alias.id',
    aliasTargetMissing: 'The alias does not exist',
    invalidId: 'Invalid object ID "{value}"',
    invalidExpression: 'The formula "{value}" is not allowed: {reason}',
    logStart: 'Run started: {objects} new objects, {targets} history targets, {settings} settings',
    logObjects: '{count} objects created',
    logTask:
        '{written} values written, {existing} existed already, {overlap} left out (overlap), {read} read - {seconds} s',
    logTaskProgress: 'up to {day}: {written} values written so far',
    logNoHistory: '{count} targets without history at their sources',
    logSettings: 'Settings written: {targets} targets, {sources} sources changed',
    logAliases: '{count} aliases remapped',
    logDbName: '{instance} stores it as "{to}" now (before "{from}"), {written} values moved',
    dbNameNoSettings: '{instance} has no settings at this object',
    dbNameUnchanged: 'The DB name stays "{name}"',
    dbNameNoMove: '{instance}: only the setting changes - the migrator moves values only for {history}',
    dbNameInstance: 'Not a logging instance: {instance}',
    logCatchUp: '{written} values caught up that the source logged while the run was copying',
    logDone: 'Finished: {written} values written, {existing} existed already - {seconds} s',
    logStopped: 'Stopped - "Schreiben" again continues, values that are there already are skipped',
    logFailed: 'Failed: {error}',
    logAbort: 'Abort: the run stops and is rolled back',
    logRolledBack: 'Rolled back: {history} histories removed, {restored} objects restored, {deleted} deleted',
};

const de: Texts = {
    basePathNotAlias: 'Der Pfad muss mit „alias.0“ beginnen',
    basePathEmptySegment: 'Leerer Teil an Position {pos}',
    basePathForbidden: 'Teil „{part}“ enthält verbotene Zeichen',
    draftDuplicate: 'Die ID kommt im Entwurf doppelt vor',
    draftTypeConflict: 'Existiert schon als {type}',
    draftNoSource: 'Ohne Quelle: wird ohne alias.id angelegt und liefert keine Werte, bis eine Quelle verknüpft ist',
    sourceMissing: 'Quelle {source} existiert nicht',
    targetMissing: 'Ziel existiert nicht und ist nicht im Entwurf',
    instanceMissingSkipped: '{key}: Instanz {instance} ist nicht installiert – nicht übernommen',
    instanceMissingCopied: '{key}: Instanz {instance} ist nicht installiert – Einstellungen werden trotzdem übernommen',
    instanceDisabled: '{key}: Instanz {instance} ist ausgeschaltet',
    targetHasSettings: '{key}: das Ziel hat schon Einstellungen – zusammengeführt, die Quelle gewinnt',
    doubleLogging: '{key}: bleibt an der Quelle aktiv – Quelle und Ziel loggen doppelt',
    lovelaceDuplicate: '{key}: gleiche Entität an Quelle und Ziel – Namen am Ziel ändern',
    historyNotRunning: 'Die history-Instanz {instance} läuft nicht',
    taskTargetTwice: 'Das Ziel kommt in mehreren History-Aufgaben vor',
    taskSourceTwice: 'Quelle {source} ist doppelt aufgeführt',
    retentionDeletes:
        'Die Aufbewahrung ({days} Tage) würde migrierte Werte löschen – andere Aufbewahrung wählen (z. B. 0 = für immer)',
    aliasNotAlias: 'Nur Objekte unter alias.0 können eine alias.id bekommen',
    aliasTargetMissing: 'Den Alias gibt es nicht',
    invalidId: 'Ungültige Objekt-ID „{value}“',
    invalidExpression: 'Die Formel „{value}“ ist nicht erlaubt: {reason}',
    logStart: 'Lauf gestartet: {objects} neue Objekte, {targets} Ziele mit Historie, {settings} Einstellungen',
    logObjects: '{count} Objekte angelegt',
    logTask:
        '{written} Werte geschrieben, {existing} schon vorhanden, {overlap} ausgelassen (Überlappung), {read} gelesen – {seconds} s',
    logTaskProgress: 'bis {day}: bisher {written} Werte geschrieben',
    logNoHistory: '{count} Ziele ohne Historie an ihren Quellen',
    logSettings: 'Einstellungen geschrieben: {targets} Ziele, {sources} Quellen geändert',
    logAliases: '{count} Aliase umgehängt',
    logDbName: '{instance} speichert jetzt als „{to}“ (vorher „{from}“), {written} Werte umgezogen',
    dbNameNoSettings: '{instance} hat an diesem Objekt keine Einstellungen',
    dbNameUnchanged: 'Der DB-Name bleibt „{name}“',
    dbNameNoMove: '{instance}: nur die Einstellung ändert sich – Werte zieht der Migrator nur bei {history} um',
    dbNameInstance: 'Keine loggende Instanz: {instance}',
    logCatchUp: '{written} Werte nachgeholt, die die Quelle während des Kopierens geloggt hat',
    logDone: 'Fertig: {written} Werte geschrieben, {existing} schon vorhanden – {seconds} s',
    logStopped: 'Angehalten – erneutes „Schreiben“ setzt fort, vorhandene Werte werden übersprungen',
    logFailed: 'Fehlgeschlagen: {error}',
    logAbort: 'Abbruch: der Lauf hält an und wird zurückgenommen',
    logRolledBack:
        'Zurückgenommen: {history} Historien entfernt, {restored} Objekte wiederhergestellt, {deleted} gelöscht',
};

const texts: Record<string, Texts> = { en, de };

/**
 * Text of a message in a language (en for all others)
 *
 * @param m - message
 * @param lang - language
 */
export function formatMessage(m: Message, lang = 'en'): string {
    const template = (texts[lang] ?? en)[m.code] ?? m.code;
    return template.replace(/\{(\w+)\}/g, (_, k: string) => String(m.args?.[k] ?? ''));
}

/**
 * Message with its object, for the log: `alias.0.x: text`
 *
 * @param m - message
 */
export function logText(m: Message): string {
    return m.id ? `${m.id}: ${formatMessage(m)}` : formatMessage(m);
}
