# 05 – Alias-Gerätemodell

## 1. Struktur

```
alias.0.<Pfad>                     type: folder   (optional, z. B. Raum)
alias.0.<Pfad>.<Gerät>             type: device   common.role z. B. "thermostat"
alias.0.<Pfad>.<Gerät>.<State>     type: state    common.alias.id = <Ziel-ID> | { read, write }
```

Beispiel Alias-State:

```json
{
  "_id": "alias.0.Wohnzimmer.Heizung.SET_POINT",
  "type": "state",
  "common": {
    "name": "Solltemperatur",
    "type": "number",
    "role": "level.temperature",
    "unit": "°C",
    "min": 5, "max": 30,
    "read": true, "write": true,
    "alias": {
      "id": { "read": "zigbee.0.00158d0001abcd.local_temperature_setpoint",
              "write": "zigbee.0.00158d0001abcd.occupied_heating_setpoint" },
      "read": "val",
      "write": "val"
    },
    "custom": { "history.0": { "enabled": true } }
  },
  "native": {
    "migrator": {
      "createdBy": "objectmigrator.0",
      "sourceHistory": [
        { "from": 1700000000000, "to": 1762900000000, "read": "hm-rpc.0.OLD123.4.SET_TEMPERATURE", "write": "hm-rpc.0.OLD123.4.SET_TEMPERATURE", "jobId": "j-0001" },
        { "from": 1762900000000, "to": null, "read": "zigbee.0....", "write": "zigbee.0....", "jobId": "j-0007" }
      ]
    }
  }
}
```

## 2. Anforderungen im Detail

| ID | Anforderung |
|---|---|
| AM-01 | Ziel-IDs = **festgelegter Basispfad** (z. B. `alias.0.xyz.abc`) + **relativer Pfad** der Quelle unterhalb der Quellwurzel (06 §4, EM-01 ff.). Anschließend lässt sich die Struktur unterhalb des Basispfads im Editor frei umbauen |
| AM-02 | IDs werden normalisiert (verbotene Zeichen `[*?"'\`]`, Leerzeichen → `_`, optional Umlaute ersetzen) |
| AM-03 | Ein bestehender Alias wird nie stillschweigend überschrieben. Bei Kollision: überspringen / umbenennen / aktualisieren |
| AM-04 | Beim Umhängen (FR-52): Kompatibilitätsprüfung (Typ, Einheit, Wertebereich, `states`). Die `read`/`write`-Konverter bleiben erhalten oder werden aus dem Mapping neu gesetzt |
| AM-05 | Gerätevorlage für das Umhängen: Zuordnung `<Alias-StateName> → <Ziel-Relativpfad>`. Damit wird ein ganzes Gerät in einem Schritt umgehängt, auch teilweise (nur ausgewählte States) |
| AM-06 | Quellen-Chronik (FR-53) wird bei jedem Umhängen fortgeschrieben, nicht überschrieben |
| AM-07 | Der Alias historisiert. Die Quell-Objekte loggen nach der Migration standardmäßig nicht mehr (kein Doppel-Logging) |
| AM-08 | Für das Umhängen ist keine History-Migration nötig. Optional können Werte aus der Lücke (Zeit zwischen letztem Wert der alten und erstem Wert der neuen Quelle) nicht interpoliert, sondern nur im Report gezeigt werden |
| AM-09 | Alias-Instanz konfigurierbar (`alias.0` ist Standard; js-controller unterstützt nur `alias.0`, das wird geprüft) |
| AM-10 | Rollen nach Type-Detector-Konventionen, damit material, lovelace, iot und devices das virtuelle Gerät erkennen |
| AM-11 | Alias-Geräte, die vom Migrator angelegt wurden, werden in `native.migrator` markiert, damit Health-Check und Aufräumen nur eigene Objekte betreffen |
| AM-12 | **Einlesen** (FR-56): je Alias-State eine Verknüpfung von der Lese-ID; eine abweichende Schreib-ID wird als Schreib-Quelle gemerkt und beim Umhängen beibehalten (`alias.id = { read, write }`). Vorhandene Formeln werden als Experten-Umrechnung übernommen. Eingelesene Ziele haben „Historie übernehmen“ und „Einstellungen übernehmen“ zunächst **aus** – das Umhängen allein braucht keine History-Migration (AM-08) |
| AM-13 | Eine Quelle, die schon mit einem anderen Ziel verknüpft ist, wird nicht ein zweites Mal verknüpft (ME-13); das Einlesen meldet solche Fälle |

## 3. Lebenszyklus eines Alias-States

```
 [angelegt] ──(Settings+History migriert)──► [aktiv: Quelle A]
     │                                            │
     │                                   (umhängen, AM-04/05)
     ▼                                            ▼
 [verwaist] ◄──(Ziel gelöscht, FR-54)──── [aktiv: Quelle B] ──► ...
```

## 4. Zusammenspiel mit Historie

- Die History-Serie heißt **immer** wie die Alias-ID, unabhängig von der Quelle.
- Werte entstehen durch Alias-Weiterleitung (js-controller). Sie tragen `from`
  der Quelle und `ack: true`.
- Der Wechsel der Quelle ist über die Quellen-Chronik nachvollziehbar und kann
  in Diagrammen (z. B. Flot/echarts) als Markierung gezeigt werden (C).
