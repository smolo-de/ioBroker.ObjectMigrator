# 00 – Überblick

## 1. Problemstellung

In einer gewachsenen ioBroker-Installation hängen an den States eines Adapters
(z. B. `hm-rpc.0.ABC123.1.TEMPERATURE`) viele Einstellungen:

- Historisierung (`history.x`, `sql.x`, `influxdb.x`) inkl. Parametern
  (Entprellung, Änderungsschwelle, Aufbewahrung, `aliasId`, ...)
- Lovelace-Entity-Konfiguration (`lovelace.x`)
- weitere `common.custom`-Einträge (z. B. `statistics.x`, `telegram.x`, ...)
- Smart-Home-Namen (`common.smartName` für iot/cloud/alexa/...)
- Zuordnung zu Räumen und Funktionen (`enum.rooms.*`, `enum.functions.*`)

Wird ein Gerät oder Adapter ausgetauscht (neuer Adapter, neue Hardware, neue Instanz),
ändern sich die Objekt-IDs. Dabei gehen die Einstellungen verloren und die Historie
bricht ab: die alten Werte liegen unter der alten ID, die neuen unter der neuen.

Heute muss man das alles von Hand übertragen. Bei vielen Objekten ist das
fehleranfällig und kostet viel Zeit.

## 2. Ziel

Ein Adapter, der

1. Einstellungen von Quell-Objekten auf Ziel-Objekte überträgt (anderer Adapter
   oder Alias),
2. historisierte Werte von der alten ID auf die neue ID überträgt bzw. zusammenführt,
3. Alias-Geräte als **stabile virtuelle Repräsentation** eines Geräts anlegt.
   Deren einzelne States lassen sich einzeln auf Objekte eines anderen Adapters
   umhängen, und die **kombinierte Historie** bleibt erhalten.

**Leitidee:** Das Alias-Objekt ist die dauerhafte Identität eines Datenpunkts.
Hardware und Adapter dürfen wechseln, ID, Einstellungen und Historie des Alias bleiben.

### 2.1 Prioritäten (verbindlich)

1. **Historische Werte zuerst.** Die durchgehende Historie (alt + neu) ist das
   wichtigste Ergebnis. Eine Migration ohne korrekte Historie gilt als
   fehlgeschlagen.
2. **Einfache Handhabung.** Der Standardfall (Gerät → Alias inkl. Historie,
   später Quelle umhängen) muss mit wenigen Klicks und sinnvollen Vorgaben
   gehen, ohne Alias- oder Datenbank-Fachwissen.
3. Alle weiteren Funktionen (Vorlagen, Referenzsuche, native DB-Pfade, ...)
   sind diesen beiden Punkten untergeordnet und dürfen den Standardablauf
   nicht komplizierter machen.

### 2.2 Abgrenzung zu `ioBroker.alias-manager`

Referenz: <https://github.com/iobroker-community-adapters/ioBroker.alias-manager>

Der bestehende alias-manager ist ein allgemeines Werkzeug zum Anlegen und
Bearbeiten von Aliasen. Für diesen Anwendungsfall ist er **zu komplex und
erfüllt die Anforderungen nicht**, vor allem weil er **keine Migration
historischer Werte** vorsieht und nicht auf einen geführten Migrationsablauf
ausgelegt ist.

| Aspekt | alias-manager | dieser Adapter |
|---|---|---|
| Schwerpunkt | Aliase anlegen und bearbeiten | **Migration**: Einstellungen + **Historie** auf Alias bzw. neuen Adapter |
| Historie | nicht im Fokus | Kernfunktion: einmalige Zusammenführung in eine ID, Vorschau beider Seiten, Verifikation |
| Bedienung | allgemeiner Editor | Mapping-Editor mit zwei Objektbäumen, Drag & Drop, Erstellungsmodus, Dry-Run, Rollback |
| Quellenwechsel | Alias-Ziel manuell ändern | Umhängen pro State oder Gerät, mit Chronik und Kompatibilitätsprüfung |

Kein Nachbau des alias-manager: allgemeine Alias-Bearbeitung (Formeln,
beliebige Strukturen) ist **nicht** Ziel. Was der Adapter anlegt, sind normale
`alias.0.*`-Objekte. Sie bleiben weiterhin mit alias-manager oder dem
Admin-Objektbrowser bearbeitbar.

## 3. Begriffe

| Begriff | Bedeutung |
|---|---|
| **Quell-Objekt** | Bestehender State (`type: state`), dessen Einstellungen/Historie migriert werden sollen |
| **Ziel-Objekt** | State, auf den migriert wird – Objekt eines anderen Adapters oder Alias |
| **Alias** | Objekt unter `alias.0.*` mit `common.alias.id` (String oder `{read, write}`) auf einen Ziel-State |
| **Alias-Gerät** | Struktur `alias.0.<pfad>` vom Typ `device`/`channel` mit Alias-States als virtuelles Gerät |
| **Custom-Settings** | Inhalt von `common.custom[<adapter>.<instanz>]` |
| **History-Backend** | Instanz von `history`, `sql` oder `influxdb` |
| **Mapping** | Zuordnung Quelle → Ziel (1:1) inkl. Optionen, gespeichert als Migrationsplan |
| **Migrationsplan** | Persistierte, prüfbare Liste von Mappings + Aktionen, die per Button „Schreiben“ ausgeführt wird |
| **Dry-Run** | Simulation eines Plans ohne Schreibzugriffe, Ergebnis ist ein Diff/Report |

## 4. Scope

### In Scope
- Übernahme **aller** Einstellungen des Original-Objekts: jeder
  `common.custom`-Eintrag generisch (abhängig von den installierten Adaptern),
  dazu `common.smartName`, Enum-Mitgliedschaften und ausgewählte
  `common`-Attribute (name, role, unit, min, max, states, ...)
- Historien-Migration: **v1 nur Standard-`history`-Adapter**, danach
  `influxdb` (wenn möglich), später evtl. `sql`
- Anlegen/Pflegen von Alias-Geräten und Umhängen von Alias-Zielen
- Massenbearbeitung über Muster/Regeln (Regex, Platzhalter, Vorlagen)
- Dry-Run, Report, Backup, Rollback

### Out of Scope (v1)
- Automatisches Umschreiben von IDs in Skripten (javascript), VIS/VIS-2-Views,
  Grafana-Dashboards. Diese Stellen werden nur **gefunden und gemeldet**
  (siehe FR-70).
- Migration zwischen *verschiedenen* History-Backends (z. B. history → influxdb).
  Ist als „Nice to have“ vorgesehen (FR-48).
- Änderungen an Geräten selbst (Pairing, Firmware o. Ä.)
