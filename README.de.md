![Logo](admin/objectmigrator.png)
# ioBroker.objectmigrator

[![NPM version](https://img.shields.io/npm/v/iobroker.objectmigrator.svg)](https://www.npmjs.com/package/iobroker.objectmigrator)
[![Downloads](https://img.shields.io/npm/dm/iobroker.objectmigrator.svg)](https://www.npmjs.com/package/iobroker.objectmigrator)
![Number of Installations](https://iobroker.live/badges/objectmigrator-installed.svg)
![Current version in stable repository](https://iobroker.live/badges/objectmigrator-stable.svg)

**Tests:** ![Test and Release](https://github.com/smolo-de/ioBroker.objectmigrator/workflows/Test%20and%20Release/badge.svg)

## Objekt-Migrator für ioBroker

Überträgt **historisierte Werte** und **Objekt-Einstellungen** von den Objekten eines Adapters auf
**Alias-Objekte** oder auf die Objekte eines anderen Adapters. Typischer Fall: Ein Gerät wird künftig
von einem neuen Adapter geliefert. Der Alias soll beide Historien lückenlos enthalten, und alle
Einstellungen (History, lovelace, telegram, influxdb …) sollen erhalten bleiben.

**Prioritäten:** 1. die Historie bleibt vollständig, 2. einfache Bedienung. Für das allgemeine
Bearbeiten von Aliasen gibt es den
[ioBroker.alias-manager](https://github.com/iobroker-community-adapters/ioBroker.alias-manager) –
dieser Adapter ist für die **Migration** da.

> Status: **in Entwicklung** – noch nicht für den produktiven Einsatz.
>
> Der Adapter ändert Objekte und schreibt historische Werte. **Vor dem ersten „Schreiben“ eine
> vollständige Sicherung anlegen.** Die Nutzung erfolgt auf eigenes Risiko und ohne Gewährleistung –
> siehe [Haftungs- und Gewährleistungsausschluss](#haftungs--und-gewährleistungsausschluss).
>
> English: [README.md](README.md) · Bedienungsanleitung: [docs/de/README.md](docs/de/README.md)

### Funktionen

- **Mapping-Editor** (Admin-Tab): zwei Objektbäume, Verknüpfen per Drag & Drop mit Linien,
  Adapter-Symbole je Datenpunkt, Erstellungsmodus, der eine Struktur unter einem Basispfad spiegelt,
  Vorlagen.
- **Historien-Migration** über den history-Adapter (≥ 5.2.0): lesen → zusammenführen → per
  `storeState` ins Ziel schreiben. Mehrere Quellen je Ziel (Überlappungsregeln: Wechsel, alles,
  bevorzugen, Schnitt), Umrechnung mit derselben Formel wie `alias.read`. Werte mit schon vorhandenem
  Zeitstempel werden übersprungen – erneutes Schreiben schreibt nichts doppelt.
- **Einstellungen** aller Adapter (`common.custom`), smartName, Räume/Funktionen – je Datenpunkt mit
  den eigenen Formularen der Adapter (`jsonCustom`) änderbar.
- **Bis „Schreiben“ wird nichts geändert** – „Prüfen“ zeigt vorher alles. An der Quelle ändert sich
  standardmäßig nichts.
- **Verlauf der Läufe mit Rollback**, **Referenzen** (wo alte IDs in Skripten, VIS, lovelace und
  Adapter-Konfigurationen verwendet werden), **bestehende Zuordnungen einlesen**, **DB-Namen**
  (`aliasId`).

### Bedienung

Admin → Tab **„Objekt-Migrator“**:

1. Links: die Wurzel der Quelle wählen (Adapter-Instanz, beliebiger Knoten oder „Alle Objekte“).
2. Rechts: **Erstellungsmodus** → Basispfad (z. B. `alias.0.Geraete.Thermostat`) → **Spiegeln**.
3. Den neuen Adapter verknüpfen: Knoten auf Knoten ziehen (Zuordnung nach Pfad/Name) oder Datenpunkt
   auf Datenpunkt.
4. Rechts anpassen (umbenennen, entfernen, Umrechnung, Einstellungen), Historie ansehen (📈).
5. **Prüfen** → **Schreiben**. Jeder Lauf lässt sich im **Verlauf** zurücknehmen.

Ausführlich: [Bedienungsanleitung](docs/de/README.md).

### Voraussetzungen

- js-controller ≥ 6.0.11, admin ≥ 7.6.20, Node.js ≥ 22
- history ≥ 5.2.0 für die Historien-Migration (eine Instanz, in der Instanz-Konfiguration gewählt)

### Installation von GitHub

Der Adapter ist noch nicht im ioBroker-Repository. Installiert wird der Branch `dev`, der die gebauten
Dateien enthält:

- Admin → Adapter → GitHub-Symbol „Installieren aus eigener URL“ → „Benutzerdefiniert“:
  `https://github.com/smolo-de/ioBroker.objectmigrator/tree/dev`
- oder auf der Konsole: `iobroker url https://github.com/smolo-de/ioBroker.objectmigrator/tree/dev`

Danach eine Instanz anlegen („+“ im Admin bzw. `iobroker add objectmigrator`). Wichtig ist
`/tree/dev`: Ohne Branch wird `main` installiert, und dort fehlen die gebauten Dateien.

## Dokumentation

| Datei | Inhalt |
|---|---|
| [docs/de/README.md](docs/de/README.md) | Bedienungsanleitung |
| [docs/requirements/](docs/requirements/README.md) | Anforderungen: Use Cases, Settings- und Historien-Migration, Alias-Modell, UI, Architektur, nicht-funktionale Anforderungen, Entscheidungen |
| [docs/security.md](docs/security.md) | Sicherheitsprüfung (Englisch): Angriffsfläche, Regeln für Formeln, Abhängigkeiten |

## Entwicklung

| Befehl | Zweck |
|---|---|
| `npm run build` | Backend (TypeScript) und Admin-Tab |
| `npm run build:tab` | nur der Admin-Tab (`src-admin/` → `admin/tab.html`, Vite) |
| `npm run check` | Typprüfung (Backend und Tab) |
| `npm run lint` | ESLint (`@iobroker/eslint-config`) |
| `npm run test:ts` | Unit-Tests (`src/**/*.test.ts`, `src-admin/src/**/*.test.ts`) |
| `npm run test:package` / `test:integration` | Paketdateien / Adapterstart mit js-controller |
| `npm run test:e2e` | Ende-zu-Ende-Test gegen ein laufendes ioBroker mit history (siehe unten) |
| `npm run dev:start` | lokales Test-ioBroker starten (Admin: http://127.0.0.1:8081) |
| `npm run dev:deploy` | bauen, ins lokale ioBroker kopieren, Instanz neu starten |

Lokales Testsystem (einmalig): `npx @iobroker/dev-server@0.8 setup`, dann in `.dev-server/default`:
`npm install iobroker.history@5.2.0` und `node node_modules/iobroker.js-controller/iobroker.js add history`.
`iobroker.objectmigrator` aus `.dev-server/default/package.json` entfernen – `npm run dev:deploy`
kopiert den Adapter (einen Symlink findet js-controller nicht, und npm würde die Kopie ersetzen).
`dev-server watch` funktioniert unter Windows 11 nicht (es ruft das entfernte `wmic.exe` auf).

`test/e2e/dbnames.test.js` (Teil von `npm run test:e2e`) setzt, löst auf und nimmt zurück: den DB-Namen
(`aliasId`) eines Wegwerf-Datenpunkts samt Umzug seiner Werte. Die Ende-zu-Ende-Tests auf einer
Wegwerf-Instanz laufen lassen (`OM_INSTANCE=objectmigrator.N`), damit ihre Läufe nicht im Verlauf der
Instanz landen, mit der du arbeitest.

**CI:** „Test and Release“ (Typprüfung, Lint, `npm audit`, Unit- und Integrationstests,
Ende-zu-Ende-Test mit js-controller, admin und history; Release bei einem Versions-Tag) läuft bei jedem
Push auf `main` und bei Pull Requests. „CodeQL security analysis“ läuft bei Pushes, Pull Requests und
wöchentlich. Dependabot schlägt monatlich Updates vor; automatisch zusammengeführt wird nichts (dafür
wäre das Secret `AUTO_MERGE_TOKEN` nötig, siehe `.github/workflows/dependabot-auto-merge.yml`).

## Haftungs- und Gewährleistungsausschluss

- Der Adapter ändert Objekte und ihre Einstellungen und schreibt historische Werte in deine
  ioBroker-Installation. **Vor dem ersten „Schreiben“ eine vollständige Sicherung anlegen** (z. B. mit
  BackItUp, einschließlich der Daten des history-Adapters).
- **Gewährleistungsausschluss:** Die Software wird bereitgestellt, wie sie ist („as is“), **ohne jede
  Gewährleistung** – weder ausdrücklich noch stillschweigend, insbesondere ohne Gewähr für
  Fehlerfreiheit, Marktgängigkeit, Eignung für einen bestimmten Zweck oder die Nichtverletzung von
  Rechten Dritter.
- **Haftungsausschluss:** Die Nutzung erfolgt **auf eigenes Risiko**. Soweit gesetzlich zulässig, wird
  keine Haftung für Schäden übernommen, insbesondere nicht für Datenverlust (Objekte, Einstellungen,
  historische Werte) oder Ausfälle. Unberührt bleibt die Haftung für Vorsatz und grobe Fahrlässigkeit
  sowie nach zwingenden gesetzlichen Vorschriften.
- Es gilt die [MIT-Lizenz](LICENSE); bei Abweichungen geht der englische Lizenztext vor.
- Privates Projekt, in der Freizeit entwickelt und ohne geschäftliches Ziel; kein offizielles
  ioBroker-Projekt. Alle genannten Produkt- und Firmennamen sowie Logos sind Marken™ oder eingetragene®
  Marken ihrer jeweiligen Inhaber. Ihre Nennung bedeutet keine Verbindung zu ihnen und keine
  Unterstützung durch sie.

## Änderungen

Siehe [Changelog im englischen README](README.md#changelog).

## Lizenz

MIT-Lizenz – Copyright (c) 2026 smolo-de. Der vollständige Text steht in [LICENSE](LICENSE).
