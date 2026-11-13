# 07 – Technische Architektur

## 1. Basis

Der Adapter ist mit dem offiziellen Generator `@iobroker/create-adapter` (3.1.5) angelegt:

| Thema | Wahl |
|---|---|
| Sprache | **TypeScript** |
| Instanz-Konfiguration | **JSON-UI** (jsonConfig) |
| Admin-Tab | eigene React-App (`adminUI.tab: "html"`), mit Vite gebaut nach `admin/tab.html` und `admin/build/` |
| Adapter-Typ | `utility`, Start-Modus `daemon` (das Schreiben läuft im Hintergrund, Messages werden verarbeitet), `tier: 3`, `messagebox: true` |
| ESLint / Prettier | Flat-Config `@iobroker/eslint-config` |
| Tests | Unit-Tests mit Mocha, `@iobroker/testing` (package, integration), Ende-zu-Ende-Tests gegen ein laufendes ioBroker (`test/e2e/`) |
| Release | `@alcalzone/release-script` + GitHub Actions, Release bei einem Versions-Tag (D-21) |
| Lizenz | MIT |

**Mindestversionen**

| Komponente | Version |
|---|---|
| Node.js | ≥ 22 |
| js-controller | ≥ 6.0.11 (`common.dependencies`) |
| admin | ≥ 7.6.20 (`common.globalDependencies`) |
| history (optional) | ≥ 5.2.0 (`getRawEntries`, `getDpStatistics`) |
| Admin-Tab | React 19, MUI 9, echarts 6, `@tanstack/react-virtual`. Alles Dev-Abhängigkeiten, die gebündelt in `admin/build/` landen |

Adaptername: **`objectmigrator`** (Paket `iobroker.objectmigrator`, Instanzen `objectmigrator.N`).
Übersetzungen der Instanz-Konfiguration liegen in `admin/i18n/*`, die Texte des Tabs in
`src-admin/src/i18n.ts`. Für spätere DB-Zugänge sind `encryptedNative`/`protectedNative` vorgesehen
(NFR-04).

## 2. Module

```
src/
  main.ts                    Adapter-Klasse, Message-API (§3), nimmt nur Nachrichten des Admin an (D-18)
  lib/
    access.ts                Prüfung des Absenders (D-18)
    messages.ts              Meldungen von „Prüfen“ und Erstellungsmodus: Code + Argumente, Texte de/en
    alias/
      createMode.ts          Spiegeln der Quellstruktur, Basispfad- und ID-Prüfung (EM-01 ff.)
      converter.ts           Umrechnung einer Verknüpfung → alias.read/write und für die Historie (CV-01)
      expression.ts          sichere Formeln mit `val` (D-19)
    history/
      HistoryBackend.ts      history-Instanz nur über sendTo: getRawEntries, getHistory, getDpStatistics,
                             storeState, deleteRange (04 §0.2)
      transfer.ts            auslesen → mappen → schreiben, tageweise, Drosselung, Stop (04 §2, HM-04 ff.)
      merge.ts               sortieren, deduplizieren gegen das Ziel, Überlappungsregeln (04 §4)
    settings/
      settings.ts            generische Custom-Kopie, smartName, Enums, Merge, Sonderfälle je Adapter (03)
    migration/
      MigrationRunner.ts     Prüfen, Schreiben (Objekte → History → Settings → Nachholen), Stop/Abbruch,
                             Objekt-Backup, Rollback, Pläne, Vorlagen
      types.ts               Plan, Lauf, Ergebnisse
    refs/
      references.ts          Fundstellen alter IDs (FR-70)
src-admin/src/               Admin-Tab
  model.ts                   Logik des Editors ohne UI: Baum, Verknüpfungen, Entwurf, Einlesen, Plan erzeugen
  App.tsx                    Editor und Ansichten, Wurzeln, Laden der Bäume, Rückgängig
  session.ts                 Arbeitsstand im Sitzungsspeicher (UX-09)
  connection.ts              Socket-Verbindung zum Admin (Objekte, States, sendTo)
  i18n.ts                    Texte de/en
  components/
    ObjectTree.tsx           virtualisierter Baum mit Adapter-Icons und Markierungen
    LinkLayer.tsx            Linien zwischen den Bäumen (SVG)
    LinkLegend.tsx, Help.tsx Hilfe in der App (ME-10, EM-12)
    PropertiesPanel.tsx      Eigenschaften des Ziel-Werts
    AdapterSettings.tsx      Adapter-Formulare je Wert (jsonCustom, SO-08)
    ConverterEditor.tsx      Umrechnung (CV-01)
    HistoryDialog.tsx        History-Vorschau (echarts, FR-90 ff.)
    Dialogs.tsx              Prüfen, Schreiben, Rückfragen
    RunLog.tsx, RunsView.tsx Log und Verlauf mit Rollback
    RefsView.tsx             Referenzen (FR-70)
    DbNamesView.tsx          DB-Namen (FR-57)
    ObjectPicker.tsx         Objekt-Auswahl (UX-14)
    TemplateDialogs.tsx      Vorlagen (EM-13)
```

## 3. Message-API (UI ↔ Adapter)

Alle Aufrufe über `sendTo('objectmigrator.N', <command>, payload)`. Angenommen werden nur Nachrichten
des Admin (D-18, [docs/security.md](../security.md)).

| Command | Zweck |
|---|---|
| `history.status` | gewählte history-Instanz und ob sie läuft (HM-03) |
| `history.range` | Zeitraum und Anzahl der Werte je ID (`getDpStatistics`) |
| `history.preview` | Rohwerte für die Vorschau (FR-90) |
| `history.aggregate` | min/max je Intervall für große Serien, bei kleinen Bereichen Rohwerte (FR-95) |
| `settings.instances` | installierte Instanzen mit Status (SM-02) |
| `settings.plan` | Übernahme der Einstellungen eines States (03) |
| `mirror.preview` | Erstellungsmodus: gespiegelte Entwürfe unter dem Basispfad (EM-02) |
| `plan.save` / `plan.load` | Entwurf des Editors speichern/laden, mit Versionsprüfung gegen gleichzeitiges Bearbeiten (WR-01) |
| `plan.check` | „Prüfen“ (WR-02) |
| `plan.write` | „Schreiben“ (WR-03) |
| `run.cancel` / `run.abort` | Stop / Abbruch = Stop + Rollback (FR-46) |
| `run.status` / `run.list` | aktueller oder gespeicherter Lauf, Liste der Läufe |
| `run.rollbackPlan` / `run.rollback` | Vorschau des Rollbacks / Rollback (FR-81) |
| `refs.find` | Fundstellen von IDs (FR-70) |
| `dbNames.list` | DB-Namen (`aliasId`) aller Logging-Instanzen (FR-57) |
| `template.list` / `template.save` / `template.load` / `template.delete` | Vorlagen (EM-13) |

Antworten: `{ ok: true, data } | { ok: false, error: { code, message } }`.

## 4. Persistenz

Dateien im Dateispeicher der Instanz (`writeFileAsync('objectmigrator.N', …)`):

| Daten | Ort |
|---|---|
| Entwurf des Editors | `plans/<name>.json` (`current`), mit Versionsnummer |
| Vorlagen | `templates/<name>.json` |
| Lauf: Plan, Ergebnisse je Ziel (geschriebene Bereiche und Anzahlen für Verifikation und Rollback), Warnungen, Log | `runs/<id>.json` |
| Objekt-Backup eines Laufs | `backups/<id>.json` |
| Status und Fortschritt des laufenden Schreibens | States `objectmigrator.N.run.*` (id, status, phase, progress, current, info, log) |

## 5. Wichtige Plattform-Hinweise

- Fremde Objekte schreiben mit `setForeignObjectAsync`/`extendForeignObjectAsync`.
  Enums über `getForeignObjectsAsync('enum.*', 'enum')`.
- Bei `extendForeignObject` werden Custom-Keys tief zusammengeführt. Zum
  **Entfernen** eines Custom-Keys muss der Wert auf `null` gesetzt werden.
- `getForeignObjects` ohne Typ liefert nur States; Teilbäume werden je Typ (state, channel, device,
  folder) gelesen (D-16).
- History-Backends reagieren auf Objekt-Änderungen (`objectChange`). Settings
  des Ziels erst **nach** dem Transfer aktivieren (HM-10), die der Quellen dann
  deaktivieren.
- **Kein Dateisystem-Zugriff** auf die history-Daten. Alles läuft über `sendTo`
  an die history-Instanz (04 §0.2). Der Migrator darf daher auch auf einem
  anderen Host laufen.
- `sendTo` mit Timeout. Antworten von `storeState` heißen nur
  „verarbeitet“ (04 §3), deshalb wird über Lesen verifiziert.
- Das Schreiben kooperativ unterbrechen (Abbruchflag, geprüft vor jedem Tag und Paket). `onUnload`
  bricht ab, erneutes „Schreiben“ setzt fort.
- Kein Blockieren des Event-Loops bei großen Objektmengen (Batches, `setImmediate`).
- Frontend: Drag & Drop über die HTML5-API, Virtualisierung mit `@tanstack/react-virtual`, Linien
  als SVG-Overlay (feste Zeilenhöhe, Positionen aus dem Zeilenindex). Die Objekte lädt der Tab über
  die Admin-Socket-Verbindung (`getObjectView`, `getForeignObjects`), Werte per State-Subscription
  je geladenem Bereich.
