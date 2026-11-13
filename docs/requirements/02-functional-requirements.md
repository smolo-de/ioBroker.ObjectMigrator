# 02 – Funktionale Anforderungen

Priorität: **M** = Must (v1), **S** = Should (v1, wenn machbar), **C** = Could (später)

## 1. Auswahl & Inventar

| ID | Prio | Anforderung |
|---|---|---|
| FR-01 | M | Quell-Objekte wählbar als Einzel-State, Gerät/Kanal (rekursiv), Adapter-Instanz, Muster (Wildcard `*` und Regex) |
| FR-02 | M | Anzeige in den Objektbäumen des Mapping-Editors (06 §3): pro State alle vorhandenen Einstellungen (Custom pro Instanz, smartName, Enums) und Historie-Metadaten (Backend, erster/letzter Zeitstempel, Anzahl Datenpunkte, sofern ermittelbar) |
| FR-03 | S | Filter „nur States mit Historisierung“, „nur States mit Custom-Settings von Instanz X“ |
| FR-04 | M | Erkennen, ob ein Quell-Objekt bereits Ziel eines Alias ist (Rückwärtssuche über `common.alias.id`) |

## 2. Mapping

| ID | Prio | Anforderung |
|---|---|---|
| FR-20 | M | Manuelles Mapping Quelle → Ziel pro State per **Drag & Drop zwischen zwei Objektbäumen**, mit Linien als Darstellung (06 §3, ME-01 ff.) |
| FR-20a | M | **Erstellungsmodus:** Fehlen die Zielobjekte, wird die Quellstruktur rechts als Entwurf gespiegelt (inkl. Verknüpfungen). Danach lässt sie sich per Drag & Drop umbauen, Werte lassen sich entfernen, Namen und Eigenschaften festlegen (06 §4, EM-01 ff.) |
| FR-20b | M | **Definitionsmodus:** Alle Editor-Aktionen sind nur ein Entwurf (Plan). Geschrieben wird ausschließlich per Button „Schreiben“ nach „Prüfen“ (06 §5, WR-01 ff.) |
| FR-21 | M | Automatischer Vorschlag beim Ziehen Knoten → Knoten nach: gleichem State-Namen, `common.role`, `common.unit`, Typ. Jeder Vorschlag bekommt einen Konfidenzwert |
| FR-22 | S | Mapping-Vorlagen (z. B. „hm-rpc HM-CC-RT-DN → zigbee TRV“) speichern, laden, exportieren/importieren (JSON) |
| FR-23 | M | Typprüfung: Warnung bei abweichendem `common.type`, `unit`, `states` oder `role`; Fehler bei inkompatiblen Typen ohne Konverter |
| FR-24 | S | Wertkonvertierung pro Mapping (z. B. `°F → °C`, invertieren, Faktor/Offset), angewendet auf History-Daten und als `common.alias.read`/`write` beim Alias |
| FR-25 | M | Eine Quelle darf nur auf ein Ziel zeigen. Mehrere Quellen auf ein Ziel sind erlaubt (Zusammenführen der Historie) und werden deutlich angezeigt (ME-12/13) |

## 3. Settings-Migration

Details: [03-settings-migration.md](03-settings-migration.md)

| ID | Prio | Anforderung |
|---|---|---|
| FR-30 | M | **Alle** `common.custom`-Einträge des Originals generisch übernehmen (standardmäßig alle ausgewählt, einzeln abwählbar). Angeboten wird abhängig von den installierten Adapter-Instanzen (siehe 03 §1, SM-01…SM-06) |
| FR-31 | M | `common.smartName` übernehmen |
| FR-32 | M | Enum-Mitgliedschaften (`enum.rooms.*`, `enum.functions.*`, eigene Enums) übernehmen |
| FR-33 | S | Ausgewählte `common`-Attribute übernehmen: `name`, `desc`, `role`, `unit`, `min`, `max`, `step`, `states`, `color`, `icon` |
| FR-34 | M | Modus pro Quelle: **kopieren** / **verschieben** (an der Quelle deaktivieren) / **verschieben + entfernen** |
| FR-35 | M | Konfliktregel Doppel-Logging: wird ein History-Backend am Ziel aktiviert, muss das System anbieten, es an der Quelle zu deaktivieren. Standard: **an der Quelle nichts ändern**, „Prüfen“ warnt (D-17) |
| FR-36 | M | Merge-Strategie, wenn am Ziel schon Custom-Settings existieren: *überschreiben* / *behalten* / *zusammenführen (Ziel gewinnt)* / *zusammenführen (Quelle gewinnt)* |
| FR-37 | M | Instanz-Umschreibung: Custom-Key einer Instanz auf eine andere Instanz abbilden (z. B. `history.0` → `history.1`) |

## 4. Historien-Migration

Details: [04-history-migration.md](04-history-migration.md)

| ID | Prio | Anforderung |
|---|---|---|
| FR-40 | M | Ablauf **auslesen → mappen → schreiben**: alte Werte über den history-Adapter lesen, mappen (Konverter, Ausschlüsse, Überlappung, Duplikate) und über den history-Adapter auf die Alias- oder Objekt-ID schreiben. Keine `aliasId`-Umleitung (04 §0) |
| FR-41 | M | Backend v1: **eine** `history`-Instanz. Danach als S: `influxdb`, wenn machbar. Als C: `sql`. Alle über dieselbe Message-API, Backends über ein Interface austauschbar (04 §1) |
| FR-42 | M | Zugriff **ausschließlich über die Message-API** der history-Instanz: `getRawEntries`/`getHistory`/`getDpStatistics` zum Lesen, `storeState` zum Schreiben. **Kein** Dateizugriff, keine eigenen Dateien (04 §0.2) |
| FR-43 | M | Die history-Instanz läuft während der Migration. Live-Logging läuft parallel weiter. Drosselung konfigurierbar (HM-06) |
| FR-44 | M | Überlappungsbehandlung: *alles übernehmen* / *Quelle bevorzugen* / *Schnitt bei T*. Werte mit `ts`, die das Ziel schon hat, werden nicht geschrieben. Vorhandene Ziel-Werte werden nie verändert (04 §4) |
| FR-45 | M | Zeitraumfilter (von/bis) pro Verknüpfung |
| FR-46 | M | Verarbeitung in Paketen mit Fortschritt, **Stop** und **Abbruch**. **Stop** hält nach dem aktuellen Paket an; erneutes „Schreiben“ setzt fort, bereits geschriebene Werte werden übersprungen (HM-05). **Abbruch** hält an und nimmt den Lauf zurück (FR-81). Während des Laufs ist der Plan gesperrt (WR-09), ein **Log** zeigt Ziel für Ziel, was migriert wurde (WR-10) |
| FR-47 | M | Verifikation nach Transfer: Anzahl Datenpunkte und min/max-Zeitstempel an Quelle und Ziel vergleichen |
| FR-48 | C | Migration zwischen *verschiedenen* Backends (z. B. history → influxdb) |
| FR-49 | S | Werte beim Transfer konvertieren (FR-24) |

## 4a. History-Vorschau (vor der Migration)

| ID | Prio | Anforderung |
|---|---|---|
| FR-90 | M | Per Klick auf das History-Symbol eines States öffnet sich die **Vorschau der historischen Werte**: Diagramm + Tabelle (paginiert, über `getRawEntries`/`getHistory` der history-Instanz) |
| FR-91 | M | Beim Zusammenführen: **beide Seiten** (alle Quellen und vorhandene Ziel-Daten) **gleichzeitig** im selben Diagramm, farblich getrennt, mit gemeinsamer Zeitachse und Zoom |
| FR-92 | M | **Ergebnis-Vorschau:** die zusammengeführte Serie, wie sie nach der Migration aussieht, inkl. markierter Überlappungen, Duplikate und Lücken |
| FR-93 | S | Schnittzeitpunkt für die Regel „Schnitt zu Zeitpunkt T“ (04 §5) per Klick im Diagramm setzen |
| FR-94 | M | Kennzahlen je Seite: Anzahl Werte, erster/letzter Zeitstempel, Anzahl Tage, Überlappungszeitraum, Anzahl Duplikate, Speichergröße |
| FR-95 | S | Bei sehr großen Serien: Diagramm aggregiert (min/max pro Intervall), Tabelle zeigt Rohwerte paginiert. Die Vorschau lädt nie die ganze Serie in den Browser |
| FR-96 | S | Einzelne Werte in der Vorschau ausschließen (z. B. Ausreißer, Fehlwerte beim Hardwaretausch). Sie werden beim Merge nicht übernommen und im Plan gespeichert |

## 5. Alias-Gerätemodell

Details: [05-alias-model.md](05-alias-model.md)

| ID | Prio | Anforderung |
|---|---|---|
| FR-50 | M | Alias-Gerät anlegen: Ordner/Device/Channel-Struktur unter `alias.0.*` mit frei wählbarem Pfad (Vorschlag: `<Raum>.<Gerätename>`) |
| FR-51 | M | Alias-States übernehmen `type`, `role`, `unit`, `min`, `max`, `states`, `read`, `write` des Ziels, mit Anpassungsmöglichkeit |
| FR-52 | M | Umhängen des Ziels eines Alias-States (`common.alias.id`) einzeln oder per Vorlage für ein ganzes Gerät. Getrennte `read`/`write`-IDs werden unterstützt |
| FR-53 | M | Quellen-Chronik pro Alias-State: wann der State auf welche Quelle zeigte (gespeichert in `native` des Alias-Objekts oder im Adapter-Speicher) |
| FR-54 | S | Health-Check: Alias-Ziele, die nicht existieren, keinen Wert liefern oder deren `ack`-Zeitstempel veraltet ist |
| FR-55 | S | Rollen-/Struktur-Vorlagen nach Type-Detector (z. B. Thermostat, Fensterkontakt), damit Material/Lovelace/iot die Geräte richtig erkennen |
| FR-56 | M | **Bestehende Zuordnungen einlesen** (UC-7a): Für einen Alias-Knoten werden alle `common.alias.id` als Verknüpfungen übernommen, `alias.read`/`alias.write` als Umrechnung, eine getrennte Schreib-ID bleibt erhalten. Eingelesene, unveränderte Zuordnungen erzeugen beim Schreiben keine Änderung (keine Historie, keine Einstellungen, kein Umhängen) |
| FR-57 | M | **DB-Namen** (UC-7b): Datenpunkte mit `aliasId` bei history/sql/influxdb werden markiert und in einer Liste gezeigt. Der DB-Name lässt sich setzen, ändern und auflösen; bei der history-Instanz auf Wunsch mit Umzug der vorhandenen Werte (HM-14) |

## 6. Plan, Ausführung, Report

| ID | Prio | Anforderung |
|---|---|---|
| FR-60 | M | Ein Migrationsplan (Mappings + Optionen) wird persistiert und kann bearbeitet, dupliziert, exportiert und importiert werden |
| FR-61 | M | Dry-Run: vollständiger Diff aller Objekt-Änderungen und Mengengerüst der History-Daten, ohne Schreibzugriffe |
| FR-62 | M | Ausführung **nur über den Button „Schreiben“**. Sie läuft im Adapter im Hintergrund (Datenmenge), Status `running`, `cancelled`, `failed`, `done`, `rolledBack`. Es läuft immer nur ein Schreibvorgang, es gibt keine Warteschlange und keine eigene Job-Verwaltung |
| FR-63 | M | Report pro Schreibvorgang (Markdown/JSON): was geändert wurde, Warnungen, Fehler, Verifikationsergebnis |
| FR-64 | M | Ein laufender Schreibvorgang läuft weiter, auch wenn die Admin-UI geschlossen wird. Der Fortschritt steht in den States `objectmigrator.N.run.*` |

## 7. Referenzsuche

| ID | Prio | Anforderung |
|---|---|---|
| FR-70 | S | Fundstellen-Report alter IDs in: javascript-Skripten, VIS/VIS-2-Projekten, Lovelace-Konfiguration, Szenen (`scenes`), Grafana-Hinweis (nur Measurement-Name). Es wird nichts automatisch ersetzt |
| FR-71 | C | Optionales Ersetzen der gefundenen IDs nach expliziter Bestätigung pro Fundstelle |

## 8. Backup & Rollback

| ID | Prio | Anforderung |
|---|---|---|
| FR-80 | M | Vor jedem Schreibvorgang wird automatisch ein Backup aller betroffenen **Objekte** angelegt (vollständige Objekt-JSONs, inkl. Enums). Die Quelldaten der History werden nur gelesen und brauchen kein Backup |
| FR-81 | M | Rollback eines Schreibvorgangs stellt die Objekte wieder her. Die geschriebenen History-Werte werden über `deleteRange` am Ziel entfernt, soweit das sicher möglich ist (HM-12). Bei Zielen, die der Lauf angelegt hat, wird die ganze Historie bis zum Rollback entfernt (auch was das Ziel danach selbst geloggt hat) |
| FR-82 | M | Der Migrator löscht **keine** Quelldaten. Das Aufräumen alter Daten macht der Anwender mit dem history-Adapter selbst (Statistics → cleanup orphaned). Der Report nennt die betroffenen IDs |
