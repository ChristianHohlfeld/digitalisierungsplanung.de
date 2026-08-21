# Zustand Project Contract v1

`zustand-project` verbindet **State Input** (Recorder) und **State Output** (Render/Replay).

## State

Der State besitzt den Trigger-Kontext: `interaction`, `timer`, `event` oder `auto`.

Erkannte Eingabefelder werden eindeutig über State-ID und Feld-ID adressiert, zum Beispiel:

- `states.state_002.email.value`
- `states.state_003.freigabe.checked`

## Transition

Die Transition besitzt den konkreten Listener innerhalb des Source-State-Kontexts, zum Beispiel `click`, `input`, `change`, `key`, `scroll`, `event`, `timer` oder `auto`.

Filter bestehen aus strukturierten Regeln:

```json
{
  "rules": {
    "join": "and",
    "items": [
      { "field": "states.state_003.freigabe.checked", "operator": "==", "value": "true" }
    ]
  }
}
```

Operatoren: `==`, `!=`, `>`, `>=`, `<`, `<=`, `truthy`, `falsy`.

Die Editor-UI bearbeitet jede Regel als einzelne Zeile; kein freies technisches Condition-Feld ist Teil des normalen Produktflusses.

## Recording

`project.recording` enthält Start-URL, Viewport, Actions, Delays und Snapshot-Anzahl für echten Browser-Replay. Sensitive Eingaben werden nicht als Klartext gespeichert.
