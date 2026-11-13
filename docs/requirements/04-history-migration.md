# 04 – Historien-Migration

## 0. Grundentscheidungen

### 0.1 Einmalige Bereinigung in eine ID

Am Ende steht **ein** Alias-State (bzw. ein Ziel-State), und **alle**
historischen Werte liegen unter **dieser einen ID**.

- **Keine** dauerhaften Umleitungen über `aliasId` und keine Kreuzabfragen über
  mehrere IDs.
- Bestehende `aliasId`-Umleitungen werden **aufgelöst**: Liegen die Daten einer
  Quelle wegen `aliasId` unter einer anderen ID, wird von **dieser** ID gelesen.
  `aliasId` wird am Ziel geleert (03 §3).

### 0.2 Alles läuft über den history-Adapter

Der Migrator greift **nicht** auf das Dateisystem zu. Er **liest, schreibt
und erzeugt keine history-Dateien selbst**. Alle Zugriffe laufen über die
Message-API der history-Instanz (`sendTo`):

```
  history.0  ──getRawEntries / getHistory──►  Migrator
                                              │ mappen: Konverter, Ausschlüsse,
                                              │ Überlappung, Duplikate
  history.0  ◄──────── storeState ───────────┘   (auf Alias- oder Objekt-ID)
```

- Der history-Adapter legt die Daten der Ziel-ID selbst in seinem Format und
  an seinem Ort ab.
- Die Daten der Quell-IDs bleiben unverändert (nur gelesen). Der Migrator löscht
  nichts. Aufräumen macht der Anwender später mit dem history-Adapter selbst
  (Tab „Statistics“ → „cleanup orphaned“).
- Die history-Instanz **läuft** während der Migration (nötig für die API).

### 0.3 Eine history-Instanz

Es wird **genau eine** history-Instanz berücksichtigt (z. B. `history.0`), in der
Instanz-Konfiguration wählbar.

## 1. Scope und Ausbaustufen

| Stufe | Backend | Status |
|---|---|---|
| **v1** | **`history`** (eine Instanz, Referenz: <https://github.com/ioBroker/ioBroker.history>, Stand v5.3.0) | **Must** – einziges Backend in v1 |
| v2 | `influxdb` | Should, *wenn möglich*. Gleiche API (`getHistory`/`storeState`), daher gleicher Ablauf |
| später | `sql` | Could, ebenfalls über dieselbe API |

Das Backend ist hinter einem Interface (`HistoryBackend`) gekapselt. Weil
history, influxdb und sql dieselbe Message-API haben, wird es später
hauptsächlich um Konfiguration und Tests gehen.

## 2. Ablauf: auslesen → mappen → schreiben

```
1. Preflight   – history-Instanz alive? Quellen: Zeitraum + Anzahl (getDpStatistics/getRawEntries)
                 Ziel: vorhandene Werte? Retention ok?
2. Vorschau    – beide Seiten + Ergebnis (FR-90 ff.), Überlappungsregel, Ausschlüsse
3. Pro Tag (aufsteigend), pro Quelle:
   a) auslesen   getRawEntries { id: quelle, start: tagStart, end: tagEnde, sort: 'asc',
                                 limit: 5000, offset, noTotal: true }   (seitenweise)
   b) Ziel lesen getRawEntries { id: ziel, start, end }  → vorhandene ts für Duplikatprüfung
   c) mappen     Konverter (FR-24), Ausschlüsse (FR-96), Überlappung (§4), Duplikate (gleicher ts) entfernen,
                 nach ts sortieren
   d) schreiben  storeState { id: ziel, state: [ {val, ts, ack, q, from}, ... ] }   (ohne rules)
4. Cache       – warten, bis die Instanz geschrieben hat (§3), oder Instanz-Neustart nach Bestätigung
5. Verifizieren – getRawEntries/getDpStatistics am Ziel: Anzahl + min/max(ts)
6. Settings    – Ziel: history.N.enabled = true (mit Overrides), Quellen: enabled = false (FR-35)
7. Report      – inkl. Hinweis auf Aufräumen der alten IDs mit dem history-Adapter
```

## 3. history-Adapter (v1) – Fakten aus dem Quellcode

Quelle: `src/main.ts` und `src/lib/getHistory.ts` in ioBroker.history v5.3.0 (GitHub) und v5.2.0 (npm, lokal getestet).

| Thema | Verhalten | Folge für den Migrator |
|---|---|---|
| `getRawEntries` | Rohwerte paginiert: `id`, `start`, `end`, `sort` (`asc`/`desc`), `limit` (max. 5000), `offset`. Berücksichtigt den RAM-Cache. **Ohne Zeitgrenzen liest es nur die neuesten 100.000 Werte** (v5.2.0), daher nie zur Bestimmung des ersten Werts verwenden | **Haupt-Lesepfad** tageweise (Migration und Vorschau) |
| `getHistory` | `aggregate: 'none'` liefert Rohwerte. Weitere Aggregationen (min/max/average) gibt es für die Diagramm-Vorschau | Vorschau bei großen Serien (FR-95) |
| `getDpStatistics` | Statistik pro Datenpunkt (`count`, `firstTs`, `lastTs`, inkl. RAM-Cache), scannt alle Dateien einmal | **Zeitraum und Anzahl je ID** für Prüfen und Schreiben, ein Aufruf für alle IDs |
| `storeState` | Formate: `{id, state}`, `{id, state: [...]}`, `[{id, state}, ...]`. Beliebige IDs, auch ohne History-Settings (dann ohne `rules`). Die Werte kommen in den RAM-Cache der ID | **Schreibpfad** auf Alias- oder Objekt-ID |
| RAM → Datei | Ist der Cache länger als `maxLength` (Standard 960), werden die Werte in die Tagesdatei **ihres jeweiligen ts** geschrieben (auch vergangene Tage). Zusätzlich schreibt die Instanz alle 10 min und beim Stoppen | Nach dem Schreiben ≤ 10 min warten oder neu starten. Bis dahin liefert `getRawEntries` die Werte schon aus dem Cache |
| Duplikate | Beim Anhängen wird weder sortiert noch dedupliziert. Beim Lesen sortiert der Adapter | Der **Migrator dedupliziert vor dem Schreiben** (Schritt 3b/c) |
| Antwort | `storeState` meldet nur „verarbeitet“, nicht „auf Disk“ | Verifikation über Lesen (Schritt 5) |
| `writeNulls` | Ist es in der Instanz aktiv, schreibt der Adapter beim Stoppen für jede ID im Cache einen `null`-Wert | Hinweis im Preflight, falls aktiv, und die Instanz während des Schreibens nicht neu starten |
| Parallelität | „Maximum parallel queries“ (Standard 3) begrenzt gleichzeitige Abfragen | Migrator liest sequenziell bzw. mit höchstens 2 parallelen Abfragen |
| `aliasId` | Logging wird von `id` auf `aliasMap[id]` umgeleitet | Lesen über die aufgelöste ID (`getRawEntries` macht das selbst) |

## 4. Überlappung und Duplikate (FR-44)

Gilt, wenn mehrere Quellen oder die Quelle und vorhandene Ziel-Werte im selben
Zeitraum Werte haben:

| Regel | Verhalten |
|---|---|
| **Wechsel** (Standard bei mehreren Quellen, `switch`) | Die Quellen werden nach ihrem ersten Wert sortiert. Jede Quelle gilt bis zum Beginn der nächsten (automatischer Schnitt, auch bei 3+ Quellen). Grund: Zwei Adapter messen nie auf dieselbe Millisekunde. Bei „Alles übernehmen“ lägen beide Reihen in der Überlappung verschachtelt im Ziel (Zickzack im Diagramm) |
| **Alles übernehmen** (Standard bei einer Quelle) | Alle Werte zusammenführen. Ein Wert mit einem `ts`, den das Ziel schon hat, wird **nicht** geschrieben |
| **Quelle A bevorzugen** | Im Überlappungszeitraum nur Werte von A |
| **Schnitt zu Zeitpunkt T** | Vor T nur alte Quelle, ab T nur neue Quelle bzw. vorhandene Ziel-Werte. T ist in der Vorschau per Klick setzbar (FR-93) |

Bereits vorhandene Ziel-Werte werden **nie** verändert oder gelöscht (der Migrator
kann über `storeState` nur hinzufügen). Eine Regel kann daher nur steuern,
welche **Quellwerte** zusätzlich geschrieben werden.

## 5. Anforderungen

| ID | Anforderung |
|---|---|
| HM-01 | Lesen ausschließlich über `getRawEntries` (Migration) bzw. `getHistory` (aggregierte Vorschau). Kein Dateizugriff |
| HM-02 | Schreiben ausschließlich über `storeState` auf die Ziel-ID (Alias- oder Objekt-ID), ohne `rules` |
| HM-03 | Precondition: die gewählte history-Instanz ist **alive**. Sonst meldet „Prüfen“ einen Fehler und „Schreiben“ ist gesperrt |
| HM-04 | Verarbeitung **tageweise aufsteigend**, Chunks ≤ 5000 Werte. Jeder Chunk ist nach `ts` sortiert (weniger Schreibvorgänge in der Instanz) |
| HM-05 | **Idempotenz:** Vor jedem Chunk werden die vorhandenen `ts` des Ziels im Chunk-Zeitraum gelesen. Bereits vorhandene Werte werden übersprungen. Ein erneutes „Schreiben“ nach Abbruch oder Neustart setzt so ohne Duplikate fort |
| HM-06 | **Drosselung:** konfigurierbare Pause zwischen Chunks und maximale Werte pro Sekunde, damit die history-Instanz (Cache/RAM, Disk-I/O) nicht überlastet wird. Standard konservativ, z. B. 1 Chunk/s |
| HM-07 | **Stop** jederzeit (nach dem aktuellen Paket). Kein gespeicherter Cursor: fortgesetzt wird durch erneutes „Schreiben“ dank HM-05 (FR-46). **Abbruch** = Stop + Rollback des Laufs (HM-12) |
| HM-08 | Nach dem letzten Chunk: Hinweis, dass der Adapter innerhalb von ≤ 10 min auf die Disk schreibt. Option „history-Instanz jetzt neu starten“ (mit Bestätigung), damit sofort geschrieben wird |
| HM-09 | Verifikation (FR-47) über `getRawEntries`/`getDpStatistics` am Ziel: Anzahl und min/max(ts) = vorher vorhandene Werte + geschriebene Werte |
| HM-10 | Settings erst **nach** dem Transfer: Ziel `history.N.enabled = true` (mit Overrides), Quellen `enabled = false` (FR-35). Objekt-Änderungen, keine Dateien. Danach ein **Nachhol-Durchgang**: was die Quellen während des Kopierens geloggt haben (die Bereiche stammen vom Start des Laufs), wird ab dem damaligen Ende übertragen – sonst fehlt am Ziel die Laufzeit des Laufs (bei großen Plänen Stunden). Reihenfolge der Settings: andere Adapter an der Quelle zuerst (lovelace: warten, bis die Instanz die Änderung verarbeitet hat), dann das Ziel, dann die History-Adapter der Quelle – so loggt das Ziel, bevor die Quelle aufhört |
| HM-11 | Retention-Prüfung: Ist am Ziel eine `retention` gesetzt, die kürzer ist als der älteste übernommene Wert, würde der Adapter die Daten wieder löschen. Deshalb gibt es einen **Fehler**, bis die Retention übersteuert oder ausdrücklich bestätigt wird |
| HM-12 | Rollback der History: nur über `deleteRange` für **genau die beim Schreiben geschriebenen Zeitbereiche** am Ziel und nur für Ziele, die **vor** dem Schreiben keine Werte in diesem Bereich hatten (sonst nur Objekt-Rollback und Hinweis). Bestätigung erforderlich |
| HM-13 | Report: geschriebene Werte je Ziel, übersprungene Duplikate, Ausschlüsse, Zeitraum, Dauer. Liste der alten IDs zum späteren Aufräumen mit dem history-Adapter |
| HM-14 | **DB-Namen ändern** (FR-57): Ablauf je Datenpunkt: 1. `aliasId` am Objekt setzen (neuer Name, leer = eigene ID), warten, bis die history-Instanz die Änderung übernommen hat; 2. auf Wunsch die Werte vom alten DB-Namen über `getRawEntries` lesen und per `storeState` auf die Objekt-ID schreiben – die Instanz legt sie unter dem neuen Namen ab; vorhandene Zeitstempel werden übersprungen (HM-05). Die Daten unter dem alten Namen bleiben stehen. Rollback: Einstellung zurück, die umgezogenen Werte werden am neuen Namen entfernt, wenn dort im selben Zeitraum vorher nichts lag (HM-12); ist der neue Name die Objekt-ID, wird **vor** dem Zurücksetzen der Einstellung gelöscht, sonst leitete die history-Instanz das Löschen auf den alten Namen um. sql/influxdb: nur die Einstellung, ohne Umzug (FR-41) |

## 6. Mengengerüst und Dauer

Bei sehr großen Beständen (D-09) bestimmt die Drosselung (HM-06) die Dauer.
Der Dry-Run zeigt:
- Anzahl Werte je Quelle (über `getDpStatistics`),
- die geschätzte Dauer bei der gewählten Drosselung,
- den RAM-Bedarf in der history-Instanz (Chunkgröße × parallele IDs).

Das Schreiben läuft im Adapter im Hintergrund und kann lange dauern. Live-Logging läuft
parallel normal weiter.

## 7. Randfälle

- **Datentyp-Wechsel** (z. B. number → boolean): nur mit Konverter (FR-24).
- **Ziel loggt schon live** (z. B. Objekt des neuen Adapters): unkritisch. Die
  migrierten Werte liegen in der Vergangenheit, die live geloggten kommen dazu.
  Duplikate verhindert HM-05.
- **Zeitstempel in Sekunden** (alte Dateien): rechnet der Adapter beim Lesen in
  ms um. Der Migrator übernimmt die Werte, wie er sie bekommt.
- **Start/Stopp-Marker** des history-Adapters (`val: null`, `q: 0x40`, Option `writeNulls`):
  werden standardmäßig **nicht** übernommen (`skippedMarker`). Am Ziel würden sie
  Lücken genau an den Quellwechseln erzeugen. Option `keepMarkers` pro Verknüpfung.
  Andere `null`-Werte der Quelle werden übernommen.
- **`from`/`ack`/`q`:** werden 1:1 übernommen. `from` bleibt die Original-Quelle
  (z. B. `system.adapter.hm-rpc.0`), damit die Herkunft erkennbar bleibt.
