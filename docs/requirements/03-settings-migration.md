# 03 – Settings-Migration

## 1. Grundsatz: alles übernehmen, was am Original hängt

Ziel ist, dass das Ziel-Objekt **alle Einstellungen** trägt, die das Original-Objekt
hatte. Der Adapter hat dafür **keine feste Liste** unterstützter Adapter. Er
arbeitet generisch:

- **Jeder** Eintrag unter `common.custom[<adapter>.<instanz>]` wird als Ganzes
  übernommen (unverändert, inkl. unbekannter und zukünftiger Felder).
- Welche Einträge angeboten werden, ergibt sich aus dem Original-Objekt **und**
  den **installierten Adapter-Instanzen** im System (`system.adapter.<adapter>.<instanz>`).
- Spezialbehandlung gibt es nur dort, wo eine reine Kopie fachlich falsch wäre
  (siehe §3). Alles andere ist 1:1-Kopie.

| ID | Anforderung |
|---|---|
| SM-01 | Standard: **alle** Custom-Einträge des Originals sind vorausgewählt. Abwählen pro Instanz ist möglich |
| SM-02 | Für jeden Custom-Key wird geprüft, ob die Instanz `system.adapter.<key>` existiert. Ergebnis in der UI: ✓ installiert & aktiv / ⚠ installiert, deaktiviert / ✗ nicht installiert |
| SM-03 | Keys von **nicht installierten** Instanzen werden standardmäßig trotzdem übernommen (verlustfrei, sie werden aktiv, sobald der Adapter installiert wird), mit Hinweis. Option: überspringen |
| SM-04 | Instanz-Umschreibung (FR-37): ein Key lässt sich auf eine andere installierte Instanz desselben Adapters abbilden (z. B. `history.0` → `history.1`). Die Auswahl zeigt nur installierte Instanzen |
| SM-05 | Die Anzeigenamen/Icons der Adapter kommen aus `system.adapter.*.common` (titleLang, icon), damit der Anwender erkennt, was migriert wird |
| SM-06 | Neben `common.custom` werden ebenfalls übernommen (einzeln abwählbar): `common.smartName`, Enum-Mitgliedschaften, ausgewählte `common`-Attribute (§2) |

## 2. Übersicht der übernommenen Bereiche

| Bereich | Ort im Objekt | Behandlung |
|---|---|---|
| Custom aller Adapter | `common.custom["<adapter>.N"]` | 1:1-Kopie (generisch), Ausnahmen in §3 |
| Smart Home | `common.smartName` | 1:1-Kopie (String, Sprachobjekt oder `false`) |
| Enums | `enum.*.common.members[]` | Ziel eintragen. Modus *verschieben*: Quelle austragen |
| common-Metadaten | `name`, `desc`, `role`, `unit`, `min`, `max`, `step`, `states`, `icon`, `color` | Optional pro Attribut, Standard: nur wenn am Ziel leer |

**Nicht übernommen:** `_id`, `common.type`, `common.read`, `common.write` (diese
kommen vom Ziel), `native` (adapterspezifisch), `acl` (optional, C).

## 3. Fachliche Sonderfälle

Nur diese Keys werden nicht blind kopiert:

| Adapter | Feld | Regel |
|---|---|---|
| `history` (v1), später `influxdb`, `sql` | `enabled` | Am Ziel wie im Original. An der Quelle **standardmäßig unverändert** (D-17); „Prüfen“ warnt vor Doppel-Logging. Abschalten nur, wenn „Einstellungen an der Quelle: deaktivieren/entfernen“ gewählt ist (FR-35) |
| `history`, `influxdb`, `sql` | `aliasId` | Wird **nie** übernommen, am Ziel immer leer (einmalige Bereinigung, 04 §0). Hat die Quelle eine `aliasId`, liest die History-Migration die Daten von dieser ID |
| `lovelace` | `name` / Entity-ID | Bleibt gleich, damit Dashboards weiterlaufen. An der Quelle standardmäßig unverändert (D-17); „Prüfen“ warnt, dass es dann zwei Entities mit gleichem Namen gibt → Namen am Ziel ändern oder an der Quelle deaktivieren/entfernen |
| `history` | `retention` | Warnung, wenn sie kürzer ist als der älteste übertragene Datenpunkt |

Neue Sonderfälle werden als **Regel-Plugins** ergänzt (ein Modul pro Adapter).
Der generische Kopierpfad bleibt dabei unverändert.

## 4. Anzeige und selektives Übersteuern vor der Übernahme

Der Anwender sieht **vor** dem Anlegen bzw. der Übernahme alle gesetzten
Einstellungen und kann jede davon einzeln ändern.

| ID | Anforderung |
|---|---|
| SO-01 | **Symbol-Leiste pro State:** je Custom-Key das Adapter-Icon (aus `system.adapter.*.common.icon`). Zustände: farbig = aktiv (`enabled: true`), grau = konfiguriert aber `enabled: false`, durchgestrichen/rot = Adapter nicht installiert. Dazu Symbole für smartName 🗣, Enums (Raum/Funktion als Chips) und „hat Historie“ 📈 mit Anzahl Werte |
| SO-02 | Tooltip/Hover auf ein Symbol zeigt die wichtigsten Werte (z. B. history: changesOnly, debounce, retention, maxLength) |
| SO-03 | **Detail-Editor pro State:** Klick auf ein Symbol öffnet die Einstellungen dieses Adapters als Formular. Wo der Adapter ein `jsonCustom`-Schema mitbringt (`admin/jsonCustom.json` bzw. `common.adminUI.custom`), wird **dessen Formular** verwendet. Sonst gibt es einen generischen Key/Value- bzw. JSON-Editor |
| SO-04 | Jeder Wert ist **übersteuerbar**: Quellwert anzeigen, neuen Wert setzen, Override zurücksetzen. Übersteuerte Werte sind optisch markiert (z. B. Punkt/Fettschrift) |
| SO-05 | **Massen-Übersteuern:** Spalte bzw. Adapter für mehrere markierte States gleichzeitig ändern (z. B. `retention` für alle auf 2 Jahre, Lovelace für alle aus) |
| SO-06 | Pro State und Adapter eine Checkbox „übernehmen“ (an/aus) direkt an der Symbol-Leiste |
| SO-07 | Auch `smartName`, Enum-Zuordnung, `name`, `role`, `unit` usw. sind in derselben Ansicht übersteuerbar |
| SO-08 | **Adapter-Einstellungen je Wert** im Eigenschaften-Panel, wie im Objekt-Dialog des Admin: Jeder installierte Adapter mit `supportCustoms` erscheint mit Ein/Aus-Schalter und seinem eigenen Formular aus `admin/jsonCustom.json` (inkl. Übersetzungen, `hidden`/`disabled`, `default`/`defaultFunc`). Auch Adapter, die an der Quelle nicht gesetzt waren, lassen sich einschalten |
| SO-09 | Validierung der Overrides gegen das `jsonCustom`-Schema (soweit vorhanden) bzw. gegen den Typ des Quellwerts |
| SO-10 | Overrides sind Teil des Migrationsplans (persistiert, exportierbar) und erscheinen im Dry-Run-Diff als „Quelle → Override“ |

## 5. Regeln

1. **Atomar pro Objekt:** Alle Änderungen eines Ziel-Objekts werden mit **einem**
   `extendForeignObject`/`setForeignObject` geschrieben. Die Quelle wird erst
   danach angepasst.
2. **Merge (FR-36):** Gibt es am Ziel schon einen Custom-Key, wird tief
   zusammengeführt. Konflikte zeigt der Dry-Run feldgenau.
3. **Modus an der Quelle (FR-34):** *unverändert lassen* (**Standard**, an der
   Quelle passiert nichts, D-17) / *deaktivieren* (History-Adapter `enabled: false`,
   die Einstellungen bleiben stehen; alle anderen Adapter werden **entfernt** wie beim
   Abschalten im Admin – lovelace wertet `enabled` nicht aus und behielte die Entität
   sonst an der Quelle; bei mehreren Quellen auch die History der weiteren Quellen) /
   *entfernen*.

## 6. Beispiel Diff (Dry-Run)

```diff
 alias.0.Wohnzimmer.Heizung.TEMPERATURE
   common.custom:
+    "history.0":    { "enabled": true, "changesOnly": true, "debounceTime": 0,
+                      "retention": 31536000, "aliasId": "" }          ✓ installiert
+    "lovelace.0":   { "enabled": true, "entity": "sensor", "name": "wohnzimmer_temperatur" } ✓
+    "statistics.0": { "enabled": true, "avg": true, ... }               ⚠ deaktiviert
+    "telegram.0":   { ... }                                             ✗ nicht installiert
+  common.smartName: "Wohnzimmer Temperatur"
 enum.rooms.livingroom.common.members:
-    "hm-rpc.0.OLD123.1.TEMPERATURE"
+    "alias.0.Wohnzimmer.Heizung.TEMPERATURE"
 hm-rpc.0.OLD123.1.TEMPERATURE
   common.custom:
~    "history.0".enabled: true → false
-    "lovelace.0"
```
