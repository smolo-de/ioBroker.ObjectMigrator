# Anforderungen

Anforderungen an den Adapter `objectmigrator` (Deutsch). Sie beschreiben den Soll-Zustand. Wie der
Adapter bedient wird, steht in der [Bedienungsanleitung](../de/README.md).

| Dokument | Inhalt | IDs |
|---|---|---|
| [00 – Überblick](00-overview.md) | Problem, Ziel, Prioritäten, Abgrenzung zum alias-manager, Begriffe, Scope | – |
| [01 – Use Cases](01-use-cases.md) | Anwendungsfälle mit durchgängigem Beispiel | UC |
| [02 – Funktionale Anforderungen](02-functional-requirements.md) | alle Funktionen im Überblick, mit Priorität | FR |
| [03 – Settings-Migration](03-settings-migration.md) | Übernahme der Einstellungen, Anzeige und Übersteuern | SM, SO |
| [04 – Historien-Migration](04-history-migration.md) | Ablauf über den history-Adapter, Überlappung, DB-Namen | HM |
| [05 – Alias-Gerätemodell](05-alias-model.md) | Struktur, Umhängen, Einlesen bestehender Zuordnungen | AM |
| [06 – Admin-UI](06-ui.md) | Mapping-Editor, Erstellungsmodus, Umrechnung, Schreiben, Vorschau, Bedienung | ME, EM, CV, WR, UX |
| [07 – Technische Architektur](07-technical-architecture.md) | Basis, Module, Message-API, Persistenz | – |
| [08 – Nicht-funktionale Anforderungen](08-non-functional.md) | Datenintegrität, Performance, Robustheit, Tests, Betrieb | NFR |
| [09 – Entscheidungen und offene Fragen](09-open-questions.md) | getroffene Entscheidungen, offene Punkte | D, Q |

## Konventionen

- **IDs** bleiben stabil: Eine ID wird nicht neu vergeben, auch wenn ihre Anforderung entfällt. Code,
  Tests und Kommentare verweisen auf diese IDs (z. B. `FR-56`, `EM-12`).
- **Priorität** (in 02): **M** = Must (v1), **S** = Should (v1, wenn machbar), **C** = Could (später).
  Die Detail-Anforderungen in 03–08 gehören zu den FR in 02.
- **Verweise:** „04 §3“ = Dokument 04, Abschnitt 3. „FR-90 ff.“ = FR-90 und die folgenden.
- **„Prüfen“ und „Schreiben“** sind die beiden Knöpfe der Ausführung (06 §5). „Prüfen“ ist der
  Dry-Run; nur „Schreiben“ ändert etwas in ioBroker.
