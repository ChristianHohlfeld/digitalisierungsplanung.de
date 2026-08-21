# Inspector-Regeln

Der Inspector folgt genau zwei Regeln:

**State:** definiert den Trigger-Kontext (`Interaktion`, `Timer`, `Event/Webhook`, `Auto`).

**Transition:** definiert den konkreten Listener und optionale Filterregeln.

Eine Filterregel ist immer eine einfache Zeile:

`Feld | Operator | Wert | Löschen`

Mehrere Regeln werden mit `UND` oder `ODER` verbunden. Checkboxen und Inputs sind über State-ID + Feld-ID eindeutig, zum Beispiel:

- `states.state_003.freigabe.checked`
- `states.state_004.email.value`

Die UI enthält keine alte Trigger-Match-Maske, keinen Range-Builder und kein freies technisches Condition-JSON.
