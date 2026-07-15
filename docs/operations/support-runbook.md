# Support-Runbook

Status: V1-Verfahren; Kanal, Besetzung und vertragliche Ziele werden im
Pilot-Steckbrief festgelegt

Stand: 2026-07-15

## Supportgrenze

Support umfasst die vereinbarte Prozess-App, ihre dokumentierte Konfiguration,
den Pilotbetrieb und reproduzierbare Produktfehler. Neue Prozessvarianten,
Integrationen und Gestaltung sind Changes und werden nicht als Störung
umetikettiert.

## Eingang eines Falls

Jeder Fall erhält:

- Ticket-ID, Kunde/Pilot und Melder,
- Zeitpunkt, betroffene Rolle und Umgebung,
- Release-ID, Browser/Gerät und Prozessschritt,
- erwartetes und tatsächliches Verhalten,
- Fall-/Korrelations-ID statt unnötigem Inhaltsdump,
- Auswirkung und vorhandenen Workaround,
- Anhänge nach Datenminimierung und
- Schweregrad P0–P3 gemäß Incident-Runbook.

Secrets, Passwörter, Tokens und ungeschwärzte personenbezogene Massendaten
werden niemals per normalem Ticket oder Chat angefordert.

## Triage

1. Empfang bestätigen und Auswirkung klären.
2. Produktfehler, Bedienfrage, Datenproblem, Fremdsystem oder Change trennen.
3. P0/P1 oder möglicher Security-/Datenschutzfall sofort in
   [`incident-runbook.md`](incident-runbook.md) überführen.
4. Mit kleinstmöglichen Daten reproduzieren; Produktionsdaten nicht in lokale
   Umgebungen kopieren.
5. Workaround nur anbieten, wenn Datenintegrität und Berechtigung gewahrt bleiben.
6. Fix über normalen PR-, CI- und Releaseweg liefern.
7. Kunde bestätigt Wirkung; Ursache und Prävention werden intern dokumentiert.

## Operative Zielwerte

Der Pilot legt Supportfenster, Erstreaktion, Updatefrequenz und
Wiederherstellungsziel je Schweregrad fest. Bis die dafür nötige Besetzung und
Messung nachgewiesen ist, sind interne Zielwerte keine vertragliche SLA.

## Wöchentliche Auswertung

- Tickets nach Ursache und Schweregrad,
- wiederkehrende Fragen als Onboarding-/UX-Signal,
- Operatorzeit je 100 Pilotfälle,
- Zeit bis Triage und Lösung,
- offene Workarounds und Risiken sowie
- überfällige Präventionsmaßnahmen.

Ziel ist nicht nur schnelles Schließen, sondern weniger wiederkehrende Fälle.
Ein Problem, das mehrfach auftritt, erhält eine Ursachenmaßnahme im
Produkt-/Technikbacklog.

## Abschluss

Ein Ticket ist geschlossen, wenn Wirkung behoben oder bewusst akzeptiert,
Kundennachweis erfolgt, Dokumentation aktualisiert und ein temporärer
Supportzugriff wieder entzogen ist. Supportdaten folgen dem festgelegten
Aufbewahrungs- und Löschweg.
