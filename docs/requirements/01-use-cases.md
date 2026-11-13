# 01 – Use Cases

Durchgängiges Beispiel: Ein Heizkörperthermostat war bisher über Adapter A
(`hm-rpc.0.OLD123.*`) angebunden und wird jetzt über Adapter B
(`zigbee.0.00158d0001abcd.*`) angebunden.

---

## UC-1: Adapterwechsel – Einstellungen + Historie direkt auf neuen Adapter migrieren

**Akteur:** Anwender
**Vorbedingung:** Quell- und Ziel-Objekte existieren beide.

**Ablauf**
1. Anwender wählt Quell-Gerät/-Kanal (z. B. `hm-rpc.0.OLD123`) und Ziel-Gerät
   (`zigbee.0.00158d0001abcd`).
2. System schlägt ein Mapping der States vor (Name, Rolle, Einheit, Ähnlichkeit,
   Vorlagen, siehe FR-20 ff.). Anwender korrigiert es bei Bedarf.
3. Anwender wählt, welche Einstellungen migriert werden (Custom pro Instanz,
   smartName, Enums, common-Attribute).
4. Historie (siehe [04-history-migration.md](04-history-migration.md)): die
   alten Werte werden über den history-Adapter **ausgelesen, gemappt und per
   `storeState` auf die Ziel-ID geschrieben**. Die Quelldaten bleiben unverändert.
   Hat das Ziel schon eigene Werte, werden sie ergänzt, Duplikate werden
   übersprungen.
5. Anwender sieht die Einstellungen als Symbole und übersteuert sie bei Bedarf
   (03 §4). Per Klick öffnet sich die History-Vorschau beider Seiten und des
   Ergebnisses (FR-90 ff.).
6. Dry-Run zeigt Diff und Mengengerüst (Anzahl Objekte, Datenpunkte, geschätzte Dauer).
7. Ausführung per Button „Schreiben“ mit Fortschritt, danach ein Report.
8. Optional: Einstellungen am Quell-Objekt deaktivieren oder entfernen.

**Ergebnis:** Das neue Objekt hat dieselben Einstellungen und eine durchgehende Historie.

---

## UC-2: Einstellungen auf Alias übertragen (mit / ohne Historie)

**Ablauf**
1. Anwender wählt Quell-Objekte (einzeln, Gerät, Kanal, Muster).
2. System erzeugt Alias-States (siehe [05-alias-model.md](05-alias-model.md)), z. B.
   `alias.0.Wohnzimmer.Thermostat.TEMPERATURE` → `common.alias.id = hm-rpc.0.OLD123.1.TEMPERATURE`.
3. Varianten:
   - **2a – nur Einstellungen:** Custom-Settings, smartName und Enums werden auf den
     Alias kopiert (optional am Quell-Objekt entfernt). Die Historie bleibt an der alten ID.
   - **2b – Einstellungen + Historie:** zusätzlich wird die Historie der alten ID
     auf die Alias-ID übertragen. Ab dann historisiert der Alias.
   - **2c – Historie ohne Einstellungen:** nur Daten übertragen, z. B. weil das
     Backend am Alias neu konfiguriert werden soll.
4. Bei Übertragung von Historisierungs-Settings stellt das System sicher, dass
   nicht doppelt geloggt wird (Quelle **und** Alias). Dafür gibt es eine
   Konfliktregel (FR-35).

**Ergebnis:** Der Alias trägt die Einstellungen und, je nach Variante, die Historie.

---

## UC-3: Alte Werte auf Alias umstellen, danach Alias-Ziele einzeln auf neuen Adapter umhängen

**Phase A – Umstellen auf Alias**
1. Wie UC-2b: Alias-Gerät anlegen, Einstellungen und Historie der alten Objekte
   auf die Alias-States übertragen.
2. Ab jetzt arbeiten Visualisierung, Skripte und Smart-Home nur noch mit den
   Alias-IDs (Report der Fundstellen alter IDs: FR-70).

**Phase B – Schrittweises Umhängen**
3. Anwender hängt einzelne Alias-States von der alten Quelle auf ein Objekt des
   neuen Adapters um (`common.alias.id` ändern, ggf. getrennt `read`/`write`).
4. Die Historie des Alias läuft weiter, weil sie an der Alias-ID hängt. Der
   Umhängezeitpunkt wird protokolliert (FR-53).
5. Über einen gewissen Zeitraum können Alias-States eines Geräts auf
   **unterschiedliche** Adapter zeigen, z. B. Temperatur schon über zigbee,
   Batteriestatus noch über hm-rpc.

**Ergebnis:** Ein virtuelles Gerät mit Werten aus Adapter A und B und einer
kombinierten Historie (alt + neu unter einer ID).

---

## UC-4 (Ziel-Szenario): Virtuelles Gerät

UC-3 ist der Weg zum eigentlichen Zielbild:

```
alias.0.Wohnzimmer.Heizung            (device)
 ├─ TEMPERATURE   → zigbee.0.00158d0001abcd.temperature     [history ✓ lovelace ✓]
 ├─ SET_POINT     → read: zigbee.0....target / write: zigbee.0....target_set
 ├─ VALVE         → hm-rpc.0.OLD123.1.VALVE_STATE           [history ✓]
 └─ BATTERY_LOW   → hm-rpc.0.OLD123.0.LOW_BAT               [—]
```

- Alle Einstellungen und die gesamte Historie hängen an den `alias.0.*`-IDs.
- Ein Quellwechsel ist ein einziger Schritt pro State (oder pro Gerät mit Vorlage).
- Die Historie enthält die Werte aus allen Quellen nacheinander.

---

## UC-5: Rückgängig machen

Jeder ausgeführte Migrationsjob lässt sich zurücknehmen: Objekt-Einstellungen
werden aus dem Objekt-Backup wiederhergestellt. Die geschriebenen History-Werte
werden über `deleteRange` am Ziel entfernt, soweit das sicher möglich ist
(HM-12). Die Quelldaten wurden nie verändert. Siehe FR-80 ff.

## UC-6: Wiederverwendbare Vorlagen

Viele gleichartige Geräte (z. B. 15 Thermostate) werden mit **einem**
Mapping-Template migriert: Quell-Muster → Ziel-Muster pro State-Name.

## UC-7: Bestehende Zuordnungen sehen, einlesen und ändern

Es gibt schon Objekte, die auf andere Datenpunkte „gemappt“ sind – von Hand angelegt, mit einem
anderen Werkzeug oder von einem früheren Lauf. Zwei Arten:

**a) Alias-Struktur:** Ein Alias-Gerät oder -Kanal, dessen States per `common.alias.id` (auch getrennt
`read`/`write`) und mit Formeln `alias.read`/`alias.write` auf Adapter-Datenpunkte zeigen.

1. Rechts den Alias-Knoten wählen, **„Zuordnungen einlesen“**.
2. Jede bestehende Zuordnung erscheint als Linie zu ihrer Quelle – gestrichelt, solange sie unverändert
   ist. Formeln stehen als Umrechnung im Panel, eine getrennte Schreib-ID bleibt erhalten.
3. Solange nichts geändert wird, ändert „Schreiben“ an diesen Werten nichts.
4. Ändern wie gewohnt: eine andere Quelle draufziehen (Umhängen wie UC-3 Phase B), Umrechnung ändern,
   auf Wunsch die Historie einer Quelle übernehmen. „Prüfen“ zeigt genau die Änderungen.

**b) Speichername in der Datenbank:** history, sql und influxdb können einen Datenpunkt per Einstellung
„Alias-ID“ (`aliasId`) unter einem **anderen Namen** in der Datenbank speichern.

1. Die Bäume markieren solche Datenpunkte, das Panel zeigt je Instanz den DB-Namen.
2. Die Ansicht **„DB-Namen“** listet alle Umleitungen: Datenpunkt → DB-Name je Instanz, mit Filter.
3. Ändern: DB-Namen setzen, ändern oder **auflösen** (Werte wieder unter der eigenen ID, 04 §0.1). Für
   die history-Instanz zieht der Migrator die vorhandenen Werte über die history-API auf Wunsch mit um.
   Die Daten unter dem alten Namen bleiben unverändert stehen (04 §0.2). Rollback wie bei jedem Lauf.
