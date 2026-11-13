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
var messages_exports = {};
__export(messages_exports, {
  formatMessage: () => formatMessage,
  logText: () => logText
});
module.exports = __toCommonJS(messages_exports);
const en = {
  basePathNotAlias: 'The path must start with "alias.0"',
  basePathEmptySegment: "Empty part at position {pos}",
  basePathForbidden: 'Part "{part}" contains forbidden characters',
  draftDuplicate: "The ID is used twice in the draft",
  draftTypeConflict: "Exists already as {type}",
  draftNoSource: "No source: created without alias.id - delivers no values until a source is linked",
  sourceMissing: "Source {source} does not exist",
  targetMissing: "Target does not exist and is not part of the draft",
  instanceMissingSkipped: "{key}: instance {instance} is not installed - skipped",
  instanceMissingCopied: "{key}: instance {instance} is not installed - settings are taken over anyway",
  instanceDisabled: "{key}: instance {instance} is disabled",
  targetHasSettings: "{key}: the target has settings already - merged, the source wins",
  doubleLogging: "{key}: stays active at the source - source and target both log (double logging)",
  lovelaceDuplicate: "{key}: same entity at source and target - change the name at the target",
  historyNotRunning: "The history instance {instance} is not running",
  taskTargetTwice: "The target is used in more than one history task",
  taskSourceTwice: "Source {source} is listed twice",
  retentionDeletes: "The retention ({days} days) would delete migrated values - set another retention (e.g. 0 = keep forever)",
  aliasNotAlias: "Only objects below alias.0 can get an alias.id",
  aliasTargetMissing: "The alias does not exist",
  invalidId: 'Invalid object ID "{value}"',
  invalidExpression: 'The formula "{value}" is not allowed: {reason}',
  logStart: "Run started: {objects} new objects, {targets} history targets, {settings} settings",
  logObjects: "{count} objects created",
  logTask: "{written} values written, {existing} existed already, {overlap} left out (overlap), {read} read - {seconds} s",
  logTaskProgress: "up to {day}: {written} values written so far",
  logNoHistory: "{count} targets without history at their sources",
  logSettings: "Settings written: {targets} targets, {sources} sources changed",
  logAliases: "{count} aliases remapped",
  logDbName: '{instance} stores it as "{to}" now (before "{from}"), {written} values moved',
  dbNameNoSettings: "{instance} has no settings at this object",
  dbNameUnchanged: 'The DB name stays "{name}"',
  dbNameNoMove: "{instance}: only the setting changes - the migrator moves values only for {history}",
  dbNameInstance: "Not a logging instance: {instance}",
  logCatchUp: "{written} values caught up that the source logged while the run was copying",
  logDone: "Finished: {written} values written, {existing} existed already - {seconds} s",
  logStopped: 'Stopped - "Schreiben" again continues, values that are there already are skipped',
  logFailed: "Failed: {error}",
  logAbort: "Abort: the run stops and is rolled back",
  logRolledBack: "Rolled back: {history} histories removed, {restored} objects restored, {deleted} deleted"
};
const de = {
  basePathNotAlias: "Der Pfad muss mit \u201Ealias.0\u201C beginnen",
  basePathEmptySegment: "Leerer Teil an Position {pos}",
  basePathForbidden: "Teil \u201E{part}\u201C enth\xE4lt verbotene Zeichen",
  draftDuplicate: "Die ID kommt im Entwurf doppelt vor",
  draftTypeConflict: "Existiert schon als {type}",
  draftNoSource: "Ohne Quelle: wird ohne alias.id angelegt und liefert keine Werte, bis eine Quelle verkn\xFCpft ist",
  sourceMissing: "Quelle {source} existiert nicht",
  targetMissing: "Ziel existiert nicht und ist nicht im Entwurf",
  instanceMissingSkipped: "{key}: Instanz {instance} ist nicht installiert \u2013 nicht \xFCbernommen",
  instanceMissingCopied: "{key}: Instanz {instance} ist nicht installiert \u2013 Einstellungen werden trotzdem \xFCbernommen",
  instanceDisabled: "{key}: Instanz {instance} ist ausgeschaltet",
  targetHasSettings: "{key}: das Ziel hat schon Einstellungen \u2013 zusammengef\xFChrt, die Quelle gewinnt",
  doubleLogging: "{key}: bleibt an der Quelle aktiv \u2013 Quelle und Ziel loggen doppelt",
  lovelaceDuplicate: "{key}: gleiche Entit\xE4t an Quelle und Ziel \u2013 Namen am Ziel \xE4ndern",
  historyNotRunning: "Die history-Instanz {instance} l\xE4uft nicht",
  taskTargetTwice: "Das Ziel kommt in mehreren History-Aufgaben vor",
  taskSourceTwice: "Quelle {source} ist doppelt aufgef\xFChrt",
  retentionDeletes: "Die Aufbewahrung ({days} Tage) w\xFCrde migrierte Werte l\xF6schen \u2013 andere Aufbewahrung w\xE4hlen (z. B. 0 = f\xFCr immer)",
  aliasNotAlias: "Nur Objekte unter alias.0 k\xF6nnen eine alias.id bekommen",
  aliasTargetMissing: "Den Alias gibt es nicht",
  invalidId: "Ung\xFCltige Objekt-ID \u201E{value}\u201C",
  invalidExpression: "Die Formel \u201E{value}\u201C ist nicht erlaubt: {reason}",
  logStart: "Lauf gestartet: {objects} neue Objekte, {targets} Ziele mit Historie, {settings} Einstellungen",
  logObjects: "{count} Objekte angelegt",
  logTask: "{written} Werte geschrieben, {existing} schon vorhanden, {overlap} ausgelassen (\xDCberlappung), {read} gelesen \u2013 {seconds} s",
  logTaskProgress: "bis {day}: bisher {written} Werte geschrieben",
  logNoHistory: "{count} Ziele ohne Historie an ihren Quellen",
  logSettings: "Einstellungen geschrieben: {targets} Ziele, {sources} Quellen ge\xE4ndert",
  logAliases: "{count} Aliase umgeh\xE4ngt",
  logDbName: "{instance} speichert jetzt als \u201E{to}\u201C (vorher \u201E{from}\u201C), {written} Werte umgezogen",
  dbNameNoSettings: "{instance} hat an diesem Objekt keine Einstellungen",
  dbNameUnchanged: "Der DB-Name bleibt \u201E{name}\u201C",
  dbNameNoMove: "{instance}: nur die Einstellung \xE4ndert sich \u2013 Werte zieht der Migrator nur bei {history} um",
  dbNameInstance: "Keine loggende Instanz: {instance}",
  logCatchUp: "{written} Werte nachgeholt, die die Quelle w\xE4hrend des Kopierens geloggt hat",
  logDone: "Fertig: {written} Werte geschrieben, {existing} schon vorhanden \u2013 {seconds} s",
  logStopped: "Angehalten \u2013 erneutes \u201ESchreiben\u201C setzt fort, vorhandene Werte werden \xFCbersprungen",
  logFailed: "Fehlgeschlagen: {error}",
  logAbort: "Abbruch: der Lauf h\xE4lt an und wird zur\xFCckgenommen",
  logRolledBack: "Zur\xFCckgenommen: {history} Historien entfernt, {restored} Objekte wiederhergestellt, {deleted} gel\xF6scht"
};
const texts = { en, de };
function formatMessage(m, lang = "en") {
  var _a, _b;
  const template = (_b = ((_a = texts[lang]) != null ? _a : en)[m.code]) != null ? _b : m.code;
  return template.replace(/\{(\w+)\}/g, (_, k) => {
    var _a2, _b2;
    return String((_b2 = (_a2 = m.args) == null ? void 0 : _a2[k]) != null ? _b2 : "");
  });
}
function logText(m) {
  return m.id ? `${m.id}: ${formatMessage(m)}` : formatMessage(m);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  formatMessage,
  logText
});
//# sourceMappingURL=messages.js.map
