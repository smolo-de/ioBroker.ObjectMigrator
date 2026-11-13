# 08 – Nicht-funktionale Anforderungen

## Sicherheit & Datenintegrität

| ID | Anforderung |
|---|---|
| NFR-01 | **Kein Datenverlust.** Kein Dateizugriff. Quelldaten werden über den history-Adapter nur gelesen, am Ziel werden Werte nur ergänzt (04 §0.2, §4). Das Entfernen von Custom-Keys an Quell-Objekten läuft nur nach Dry-Run, Objekt-Backup und Bestätigung |
| NFR-02 | „Schreiben“ ist **idempotent**: Ein erneutes Ausführen nach Abbruch erzeugt keine Duplikate (Duplikatprüfung über `ts` am Ziel) |
| NFR-03 | Objekt-Backup vor jeder Änderung. Rollback-Fähigkeit wird im Dry-Run angezeigt |
| NFR-04 | Zugangsdaten für native DB-Zugriffe (später, 06 §2) werden verschlüsselt gespeichert und nie geloggt |
| NFR-05 | Der Adapter verändert nur Objekte, die im Plan stehen. Fremde Alias-Objekte (ohne `native.migrator`) fasst er nur nach Bestätigung an |

## Performance

| ID | Anforderung |
|---|---|
| NFR-10 | Inventar-Scan von 50 000 Objekten < 30 s, UI bleibt bedienbar |
| NFR-11 | Generischer History-Transfer: Durchsatz konfigurierbar. Die history-Instanz darf nicht blockiert werden (HM-06). Ziel: ≥ 2 000 Werte/s über die Message-API, abhängig von der Hardware |
| NFR-12 | Speicherbedarf beim Transfer begrenzt durch tageweise Verarbeitung (< 200 MB zusätzlich), unabhängig von der Gesamtgröße |
| NFR-13 | Ausgelegt auf **sehr große Bestände** (D-09): Millionen Werte pro State, Hunderte States, mehrere Jahre. Dry-Run und Vorschau lesen nur Metadaten/Stichproben und blockieren nicht |
| NFR-14 | Die history-Instanz läuft während der Migration weiter (Live-Logging ohne Lücke). Die Migration ist gedrosselt (HM-06). Der Dry-Run schätzt die Gesamtdauer |

## Robustheit

| ID | Anforderung |
|---|---|
| NFR-20 | Nach einem Adapter- oder Host-Neustart gilt ein laufendes Schreiben als abgebrochen. Erneutes „Schreiben“ setzt ohne Duplikate fort |
| NFR-21 | Ist die history-Instanz nicht erreichbar, bricht das Schreiben mit einer klaren Meldung ab. Erneutes „Schreiben“ setzt fort |
| NFR-22 | Verständliche Fehlermeldungen pro Objekt. Ein fehlerhaftes Objekt bricht nicht das ganze Schreiben ab (konfigurierbar: *fail-fast* / *continue*) |

## Qualität & Tests

| ID | Anforderung |
|---|---|
| NFR-30 | Unit-Tests für Mapping, Merge, Diff, Konverter, Alias-Pfad-Normalisierung (Ziel: ≥ 80 % Abdeckung in `lib/`) |
| NFR-31 | Integrationstests mit `@iobroker/testing` (js-controller in CI). v1: history-Adapter als Backend (installiert in der Test-Umgebung). Dazu Settings-Tests mit Custom-Keys installierter und nicht installierter Adapter |
| NFR-32 | E2E-Testszenario: UC-3 komplett (Adapter A Dummy-States → Alias → Umhängen auf Adapter B Dummy-States, History durchgehend) |
| NFR-33 | Repository-Checker ohne Fehler, ESLint/Prettier/TypeScript-strict sauber |

## Betrieb

| ID | Anforderung |
|---|---|
| NFR-40 | Logging auf `info`: Start/Ende/Zusammenfassung des Schreibens. Auf `debug`: Details pro Objekt |
| NFR-41 | Mehrsprachigkeit über das i18n-Verfahren des Templates |
| NFR-42 | Dokumentation (README de/en) mit Schritt-für-Schritt-Anleitungen für UC-1 bis UC-3 |
