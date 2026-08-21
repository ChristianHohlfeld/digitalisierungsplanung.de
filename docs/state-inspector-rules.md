# State Inspector Rules

Der Inspector darf nicht zwei verschiedene Regelwelten zeigen.

## Schnitt

- **State Inspector**: Der State bestimmt den Trigger-Kontext. Beispiel: Klick, Timer, Webhook/Event oder Auto.
- **Transition Inspector**: Die Kante lauscht innerhalb dieses Kontexts auf ein konkretes Signal und filtert über einfache Regeln.

## Sichtbare UI

Die sichtbare Transition-Regel-UI ist nur:

```text
Feld                  Operator   Wert      Löschen
Checkbox A.checked   ==         true      ×
Checkbox B.checked   ==         false     ×
E-Mail.value         !=         ""        ×
```

Dazu gibt es nur:

- `+ Regel`
- `Alle löschen`
- `UND` / `ODER`

Jede Regel ist eine eigene Zeile und einzeln löschbar.

## Felder

Felder müssen unterscheidbar bleiben. Deshalb zeigt der Builder State-ID und Feld:

- `Checkbox A (checkbox_a) · checked`
- `Checkbox B (checkbox_b) · checked`
- `E-Mail (email) · value`
- `Suchfeld (search) · value`
- Event/Webhook-Felder wie `Incoming call · caller`

## Was nicht sichtbar sein darf

Die alte Advanced-Maske ist keine Hauptbedienung mehr:

- keine sichtbare `Trigger-Regel`-Card
- kein `Match-Feld`
- kein `Match-Operator`
- keine `Technische Bedingung` als Standardfläche
- kein freies JSON als normale Bedienung

Der Contract kann weiterhin eine `condition` speichern. Die UI bearbeitet diese Condition aber über einfache Zeilen.
