# 09 – Entscheidungen und offene Fragen

## Entschieden

| # | Thema | Entscheidung |
|---|---|---|
| D-01 | Adaptername | **`objectmigrator`** (`iobroker.objectmigrator`) |
| D-02 | Umfang Settings | **Alle** Einstellungen des Original-Objekts übernehmen können. Generisch über alle `common.custom`-Keys, abhängig von den installierten Adaptern (03 §1) |
| D-03 | History-Backends | v1: nur Standard-**`history`**-Adapter (Referenz <https://github.com/ioBroker/ioBroker.history>, v5.3.0). Danach `influxdb`, wenn möglich. `sql` evtl. später (04 §1) |
| D-04 | Abgrenzung | Kein Ersatz für alias-manager. Schwerpunkt Historie + einfache Bedienung (00 §2.1/2.2) |
| D-05 | Settings sichtbar + übersteuerbar | Symbol-Leiste pro State, Detail-Editor (jsonCustom des Adapters), Einzel- und Massen-Overrides vor der Übernahme (03 §4, 06 §3.1 ME-04) |
| D-06 | `aliasId` / Kreuzabfragen über mehrere IDs | **Verworfen.** Einmalige Bereinigung: alle Werte physisch in die eine Alias-/Ziel-ID. `aliasId` wird aufgelöst und am Ziel geleert (04 §0) |
| D-07 | Fähigkeiten des history-Adapters | Aus dem Quellcode geklärt (04 §3): `getRawEntries` liest paginiert, `storeState` schreibt beliebige IDs (auch vergangene Tage), dedupliziert aber nicht. Deshalb dedupliziert der Migrator vor dem Schreiben |
| D-08 | History-Vorschau | Per Klick vor der Migration, für **beide Seiten** und das **Ergebnis** in einem Diagramm, inkl. Überlappung/Duplikate/Schnittzeitpunkt (FR-90 ff., 06 §6) |
| D-09 | Datenmenge | **Sehr viele** Daten → tageweise Pakete, Drosselung, Lauf im Hintergrund, Fortsetzen durch erneutes „Schreiben“ (04 §6, HM-04 ff.) |
| D-10 | Instanzen | Nur **eine** history-Instanz (04 §0.3) |
| D-11 | Betrieb der history-Instanz | Die history-Instanz **läuft** während der Migration (nötig für die API). Live-Logging läuft weiter. Optional Neustart am Ende, damit der Cache sofort geschrieben wird (HM-08) |
| D-12 | Umgang mit history-Dateien | Der Migrator fasst **keine Dateien** an und erzeugt keine. Alles läuft über den history-Adapter: **auslesen → mappen → per `storeState` auf Alias-/Objekt-ID schreiben**. Quelldaten bleiben unverändert. Aufräumen macht der Anwender mit dem history-Adapter (04 §0.2) |
| D-13 | Drosselung | Standard 1 Chunk (≤ 5000 Werte) pro Sekunde, in der Instanz-Konfiguration einstellbar (HM-06) |
| D-14 | Bedienkonzept | **Mapping-Editor mit zwei Objektbäumen** (frei wählbare Wurzel), Verknüpfen per Drag & Drop mit Linien, Adapter-Icons statt Zahnrad, Erstellungsmodus (Struktur spiegeln und rechts umbauen). Reiner Definitionsmodus bis zum Button „Schreiben“ (06 §3–§5) |
| D-15 | Überlappung bei mehreren Quellen | Standard ist der **Wechsel** (`switch`): jede Quelle bis zum Beginn der nächsten. Die Einstellungen kommen von der ersten (alten) Quelle, `alias.id` zeigt auf die zuletzt verknüpfte (neue) Quelle, die History wird an **allen** Quellen deaktiviert (04 §4) |
| D-16 | Lesegrenzen des history-Adapters | `getRawEntries` liefert je Aufruf höchstens 2000 (5.2) bzw. 5000 (5.3) Werte. Der Migrator blättert um die tatsächlich gelieferte Anzahl weiter bis zur leeren Seite. `getForeignObjects` ohne Typ liefert nur States, deshalb werden state/channel/device/folder einzeln gelesen |
| D-17 | Änderungen an der Quelle | **Standard: an der Quelle passiert nichts.** Deaktivieren oder Entfernen der Adapter-Einstellungen nur auf ausdrückliche Wahl („Einstellungen an der Quelle“). Doppel-Logging und doppelte lovelace-Entitäten meldet „Prüfen“ als Warnung |
| D-18 | Wer darf den Migrator steuern | Nur der Admin (`system.adapter.admin.N`). Nachrichten anderer Adapter/Skripte werden abgewiesen ([docs/security.md](../security.md)) |
| D-19 | Formeln (Umrechnung, alias.read/write) | Nur Ausdrücke mit `val`: keine Anweisungen, keine Zuweisungen, keine Zugriffe auf die Laufzeit (Sperrliste). Die Historie wird mit derselben read-Formel umgerechnet wie der Live-Wert |
| D-20 | Alias umhängen | Ein vorhandener Alias (auch einer aus einem früheren Lauf) bekommt `common.alias` vollständig neu (id, read, write) – unabhängig von „Einstellungen übernehmen“. Eine alte Formel bleibt nicht stehen |
| D-21 | CI | „Test and Release“ läuft bei jedem Push auf `main` und bei Pull Requests, einschließlich des Ende-zu-Ende-Tests mit echtem history-Adapter (`npm run test:e2e`). CodeQL läuft zusätzlich wöchentlich. Dependabot schlägt monatlich Updates vor; automatisch zusammengeführt wird nichts |
| D-22 | Lovelace-Entität beim Umzug | Bleibt gleich (gleicher `name` im Custom), damit Dashboards weiterlaufen. Solange die Quelle die Entität noch hat, warnt „Prüfen“ (03 §3, D-17) |
| D-23 | Umrechnungen | Neben den einfachen Umrechnungen (Faktor/Offset, Nachkommastellen, Invertieren, Wertetabelle) sind eigene Formeln möglich, beschränkt nach D-19 (CV-01). Weitere Funktionen des alias-manager sind nicht Ziel (D-04) |
| D-24 | Ziel hat schon eigene Historie | Unkritisch: Werte werden ergänzt, Duplikate übersprungen, vorhandene Werte nie verändert (04 §4, HM-05) |

## Offen

| # | Frage | Vorschlag / Stand |
|---|---|---|
| Q-08 | Sollen Alias-Geräte auch mit dem Format des `devices`-Adapters kompatibel sein (Struktur und Rollen wie dort)? | Ja, über Rollen nach Type-Detector (AM-10) |
| Q-10 | Gefundene IDs in Skripten und VIS automatisch ersetzen? | Bisher Fundstellen-Report mit kopierbarer Ersetzungsliste (FR-70). Ersetzen nach Bestätigung je Fundstelle später (FR-71) |
