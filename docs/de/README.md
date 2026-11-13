# Objekt-Migrator – Bedienungsanleitung

Der Objekt-Migrator überträgt **historisierte Werte** und **Objekt-Einstellungen** von einem Adapter
auf Alias-Objekte oder auf die Objekte eines anderen Adapters. Typischer Fall: Ein Gerät wird künftig
von einem neuen Adapter geliefert. Der Alias soll beide Historien lückenlos enthalten, und alle
Einstellungen (History, lovelace, telegram, influxdb …) sollen erhalten bleiben.

> **Grundsatz:** Bis zum Klick auf **„Schreiben“** wird nichts verändert. Die Quellen werden nur
> gelesen und bleiben unverändert, solange du nichts anderes einstellst. Jeder Lauf kann im
> **Verlauf** zurückgesetzt werden.
>
> **Vor dem ersten „Schreiben“ eine vollständige Sicherung anlegen.** Die Nutzung erfolgt auf eigenes
> Risiko und ohne Gewährleistung – siehe [Haftungs- und Gewährleistungsausschluss](#haftungs--und-gewährleistungsausschluss).

## Voraussetzungen

- Admin ≥ 7.6.20, js-controller ≥ 6.0.11
- history-Adapter ≥ 5.2.0 für die Historie (eine Instanz, in der Instanz-Konfiguration wählbar)

## Aufbau

Admin → **„Object Migrator“**. Oben stehen die Ansichten **Editor**, **Verlauf** und **Referenzen**,
rechts daneben die Sprache **DE/EN**.

### Editor

| Bereich | Inhalt |
|---|---|
| **Quelle** (links) | Objektbaum ab einer frei wählbaren Wurzel oder **„Alle Objekte“** (ganzer Objektbaum; eine Adapter-Instanz wird erst beim Aufklappen geladen). „↑“ geht eine Ebene hoch, über einer Instanz zu „Alle Objekte“; beim Darüberfahren erscheint an jedem Knoten „⤓ als Wurzel“ (oder Doppelklick). Strg/Shift-Klick markiert mehrere Objekte |
| **Linien** (Mitte) | Verknüpfungen Quelle → Ziel. Grün = passt, orange = andere Einheit/Rolle, rot = anderer Typ, grau = migriert, grau gestrichelt = eingelesen und unverändert. Bei zugeklappten Knoten gebündelt mit Anzahl. **„? Linien“** über den Linien erklärt alle Linienarten und Markierungen |
| **Ziel** (rechts) | Zielbaum mit Entwürfen (kursiv, „Entwurf“) und vorhandenen Objekten. „✎ geändert“ markiert vorhandene Objekte mit offenen Änderungen |
| **Eigenschaften** | Details der markierten Zeile; oben rechts ★ als Vorlage speichern und 🗑 aus dem Entwurf entfernen |

Die Breite der Bereiche lässt sich an den Trennern verschieben.

## Ablauf

1. **Quelle wählen:** links die Wurzel setzen, z. B. die Instanz des alten Adapters.
2. **Erstellungsmodus:** Basispfad festlegen (z. B. `alias.0.Geraete.Thermostat`) → „Spiegeln“.
   Die Struktur wird als Entwurf angelegt, jeder State mit seiner Quelle verknüpft. Mit markierten
   Objekten links wird nur die Auswahl gespiegelt.
3. **Neuen Adapter verknüpfen:** Knoten links auf Knoten rechts ziehen (Zuordnung nach Pfad oder
   Name) oder State auf State. Mehrere Quellen pro Ziel werden zusammengeführt.
4. **Aufräumen:** rechts umbenennen, verschieben (ziehen), entfernen, neue Werte anlegen.
5. **Prüfen** → **Schreiben**.

## Neue Objekte anlegen

Im Panel eines Alias-Knotens rechts: **„+ Neuer Wert“**, **„+ Neuer Kanal“**, **„+ Neuer Ordner“**,
**„+ Neues Gerät“**. Tooltips und das **„?“** daneben erklären, was jeweils entsteht:

- **Wert** (State): Typ, Rolle, Einheit, min/max, lesbar/schreibbar im Panel. Eine Quelle bekommt er
  durch Ziehen oder ID-Eingabe unter „Quellen“. **Ohne Quelle** wird er ohne `alias.id` angelegt –
  „Prüfen“ warnt, dass er keine Werte liefert, bis später eine Quelle verknüpft ist.
- **Kanal** (channel): bündelt die Werte einer Funktion, z. B. „Heizkreis 1“; Visualisierungen und
  Sprachassistenten erkennen Geräte meist an Kanal oder Gerät mit passenden Rollen.
- **Ordner** (folder): nur Gliederung. **Gerät** (device): ein physisches Gerät, z. B. „Thermostat“.

Alles Neue ist ein Entwurf und entsteht erst beim „Schreiben“; ein Rollback löscht es wieder.

## Eigenschaften eines Ziel-Werts

- **Objekt:** ID, Name, Rolle, Einheit, Typ, min/max, lesbar/schreibbar (bei Entwürfen).
- **Quellen:** alle verknüpften Quellen mit Kompatibilität. „live“ markiert die Quelle, von der
  der Alias seinen Wert bekommt (`alias.id`, Standard: die zuletzt verknüpfte, also der neue
  Adapter). Neue Quelle per ID eingeben oder mit 🔍 auswählen.
- **Umrechnung** je Quelle: Ergebnis-Typ (Zahl, Text, Logikwert), Faktor/Offset, Nachkommastellen,
  Invertieren, Text danach, Wertetabelle (auch aus `common.states`) oder eigene Formel. Daraus
  entstehen `alias.read/write`. **Dieselbe Formel rechnet die migrierte Historie um.** Die Vorschau
  zeigt den aktuellen Wert vorher/nachher.
- **Historie:** migrieren ja/nein und die **Überlappung**:
  - *Wechsel* (Standard bei mehreren Quellen): jede Quelle bis zum Beginn der nächsten
  - *alle Werte übernehmen*
  - *bevorzugen*: im Überlappungszeitraum nur eine Quelle
  - *Schnitt bei Zeitpunkt*: vorher alt, danach neu
- **Adapter-Einstellungen:** jeder installierte Adapter mit Einstellungen je Datenpunkt erscheint mit
  Schalter und seinem eigenen Formular – wie im Objekt-Dialog des Admin. Auch Adapter, die an der
  Quelle nicht gesetzt waren, lassen sich einschalten.
- **Einstellungen an der Quelle:** *unverändert lassen* (Standard), *deaktivieren* oder *entfernen*.
  Bleibt die History an der Quelle aktiv, loggen Quelle und Ziel doppelt – „Prüfen“ weist darauf hin.
- **Räume/Funktionen übernehmen:** die Mitgliedschaften der Quelle werden auf das Ziel übertragen.

## History-Vorschau (📈)

Zeigt alle Quellen, das vorhandene Ziel und das **Ergebnis** (Überlappung, Umrechnung und
Ausschlüsse angewendet). Bei großen Reihen Min/Max je Intervall, beim Hineinzoomen Rohwerte.

- **Schnitt bei Zeitpunkt:** Modus einschalten, ins Diagramm klicken → Überlappungsregel „Schnitt“.
- **Wert ausschließen:** Modus einschalten, auf einen Rohwert einer Quelle klicken (rot markiert);
  erneuter Klick nimmt ihn wieder auf.

## Vorlagen

Einen Knoten rechts mit ★ als Vorlage speichern. Texte wie der Gerätename werden dabei durch
Platzhalter ersetzt (`Thermostat` → `{{name}}`). „★ Aus Vorlage“ legt die Struktur mit allen
Einstellungen und Umrechnungen unter einem neuen Pfad an und fragt die Platzhalter ab. Ist links ein
Knoten markiert, werden die neuen Werte nach Pfad/Name mit ihm verknüpft.

## Prüfen und Schreiben

**Prüfen** zeigt ohne etwas zu ändern:

- Fehler und Warnungen, nach Ziel gruppiert
- anzulegende Objekte
- Einstellungen je Ziel mit Adapter-Symbolen
- geänderte Alias-Zuordnungen (bisher → neu)
- je Ziel und Quelle die Anzahl der Werte, den Zeitraum, die am Ziel vorhandenen Werte und wie viele
  höchstens geschrieben werden, dazu die geschätzte Dauer

Ist rechts ein Knoten markiert, kann **nur dieser Teilbaum** geprüft und geschrieben werden.

**Schreiben** fragt nach und läuft im Hintergrund: Objekte anlegen → Historie migrieren →
Einstellungen und Alias-Zuordnungen setzen → nachholen, was die Quellen währenddessen geloggt haben.

Während des Laufs ist der **Plan gesperrt**. Unten stehen nur noch zwei Knöpfe:

- **Stop** hält nach dem aktuellen Block an. Erneutes „Schreiben“ setzt fort; Werte mit vorhandenem
  Zeitstempel werden übersprungen.
- **Abbruch** hält an und nimmt den Lauf zurück (wie „Zurücknehmen“ im Verlauf).

Das **Log** unter dem Editor zeigt live, was passiert: je Ziel geschriebene, schon vorhandene und
ausgelassene Werte, bei großen Zielen alle 10 Sekunden den Stand. Seine Höhe ändert man durch Ziehen
an der Oberkante; der Browser merkt sie sich. Dasselbe Log steht später im
Bericht unter „Verlauf“.

**Einstellungen an der Quelle – deaktivieren:** History-Adapter werden abgeschaltet
(`enabled: false`, die Einstellungen bleiben stehen), alle anderen Adapter-Einstellungen (z. B.
lovelace) werden entfernt – so wie der Admin es beim Abschalten macht. Nur so zieht eine
lovelace-Entität ans Ziel um und das Dashboard läuft ohne Änderung weiter.

**Zwischendurch woanders hin:** Wer im Admin kurz auf „Objekte“ oder „Adapter“ wechselt, findet beim
Zurückkommen alles wie verlassen vor – Plan, Rückgängig, Auswahl, aufgeklappte Knoten, Filter,
Scrollposition, Log. Das gilt im selben Browser-Tab; ein neuer Tab beginnt mit dem gespeicherten Plan.

### Beispiel: Adapterwechsel mit Alias-Gerät

Ein Thermostat kam bisher über `hm-rpc` und kommt jetzt über `zigbee` – die Historie soll bleiben, die Werte
sollen künftig vom neuen Adapter kommen:

1. Rechts ein neues **Gerät** anlegen (z. B. „Heizung“), links die alten Werte (Temperatur, Ventil)
   markieren und auf das Gerät ziehen. Bei beiden „Einstellungen an der Quelle: deaktivieren“ – dann
   ziehen Historie und lovelace-Entität zum Alias um.
2. **Schreiben**: Der Alias bekommt die ganze alte Historie und loggt selbst weiter.
3. Danach (oder gleich vor dem ersten Schreiben) links die Wurzel auf den neuen Adapter stellen und
   dessen Werte (`local_temperature`, `pi_heating_demand`) auf dieselben Alias-Werte ziehen. Der
   Alias liest standardmäßig die **zuletzt verknüpfte** Quelle.
4. **Schreiben**: Der Alias zeigt jetzt auf den neuen Adapter, Historie und Dashboard bleiben, neue
   Werte werden am Alias weitergeloggt.

## Bestehende Zuordnungen einlesen

Ein Alias-Gerät, das es schon gibt (von Hand angelegt oder aus einem früheren Lauf), lässt sich in den
Editor holen: rechts mit der Maus über den Knoten fahren → **„⇠ einlesen“** (oder im Panel des
Knotens) – auch an der Wurzel und an einzelnen Werten. Jede `alias.id` wird zur Linie zu ihrer Quelle.
Links werden die Quellen aufgeklappt; liegen sie außerhalb der linken Wurzel, wird die Wurzel so weit
erweitert, dass alle zu sehen sind – bei Quellen in mehreren Adaptern bis **„Alle Objekte“**:

- **gestrichelt grau** = eingelesen und unverändert – „Schreiben“ macht dafür nichts
- Formeln (`alias.read`/`alias.write`) stehen als Experten-Umrechnung im Panel, eine getrennte
  Schreib-ID (`alias.id = { read, write }`) bleibt erhalten
- Historie und Einstellungen sind bei eingelesenen Werten zunächst **aus** – für das reine Umhängen
  braucht es keine History-Migration. Im Panel lassen sie sich einschalten.

Ändern wie gewohnt: eine andere Quelle auf den Alias ziehen (die zuletzt verknüpfte wird `alias.id`),
Umrechnung ändern, Verknüpfung lösen. Die Linie wird dann normal gezeichnet, „Prüfen“ zeigt genau die
Änderung. Im Panel eines Alias steht immer, worauf er gerade zeigt.

## DB-Namen

history, sql und influxdb können einen Datenpunkt per Einstellung „Alias-ID“ unter einem **anderen
Namen** in der Datenbank speichern. Solche Datenpunkte tragen in den Bäumen ein lila **DB**, das Panel
zeigt je Instanz „speichert als …“. Die Ansicht **„DB-Namen“** listet alle Umleitungen mit der Zahl der
Werte unter dem Namen.

- **ändern**: neuer Name; leer = wieder unter der eigenen ID
- **auflösen**: zurück auf die eigene ID
- **Vorhandene Werte mitnehmen** (nur bei der history-Instanz des Migrators): die Werte unter dem alten
  Namen werden über die history-API unter den neuen kopiert. Die Daten unter dem alten Namen bleiben
  stehen.

Das läuft als normaler Lauf mit Log, Bericht und Rollback. Der Rollback stellt die Einstellung wieder
her und entfernt die umgezogenen Werte – außer, am Ziel lagen im selben Zeitraum schon Werte (dann
bleiben sie, weil sie sich nicht sicher trennen lassen; der Bericht sagt das).

## Verlauf und Rollback

Jeder Lauf erscheint im **Verlauf** mit Bericht (geschrieben / schon vorhanden je Ziel). Der
**Rollback** zeigt vorher, was passiert:

- Objekte werden auf den Stand vor dem Lauf zurückgesetzt (spätere Änderungen gehen verloren)
- angelegte Objekte werden gelöscht, samt ihrer ganzen Historie (auch was sie nach dem Lauf selbst
  geloggt haben)
- bei schon vorhandenen Zielen wird die geschriebene Historie entfernt – nur wenn sie vorher im
  Zeitraum keine Werte hatten

## Referenzen

Sucht, wo die alten IDs noch verwendet werden: Skripte, Adapter-Konfigurationen (z. B. telegram),
lovelace-Dashboards, Aliase, Räume/Funktionen und VIS-Projekte. Die Ersetzungsliste (alt;neu) lässt
sich kopieren.

## Entwurf

Der Entwurf wird automatisch im Adapter gespeichert (nicht im Browser). Ist er in einem anderen
Fenster geändert worden, fragt der Editor, welcher Stand gelten soll. **„Plan leeren“** entfernt alle
Entwürfe, Verknüpfungen und Änderungen (Strg+Z macht es rückgängig).

## Haftungs- und Gewährleistungsausschluss

- Der Objekt-Migrator ändert Objekte und ihre Einstellungen und schreibt historische Werte in deine
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
- Es gilt die [MIT-Lizenz](../../LICENSE); bei Abweichungen geht der englische Lizenztext vor.
- Privates Projekt, in der Freizeit entwickelt und ohne geschäftliches Ziel; kein offizielles
  ioBroker-Projekt. Alle genannten Produkt- und Firmennamen sowie Logos sind Marken™ oder eingetragene®
  Marken ihrer jeweiligen Inhaber. Ihre Nennung bedeutet keine Verbindung zu ihnen und keine
  Unterstützung durch sie.
