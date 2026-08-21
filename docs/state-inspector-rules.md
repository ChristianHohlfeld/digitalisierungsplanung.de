# State Inspector Rules

UX-Schnitt:

- **State Inspector**: Trigger-Kontext wählen. Beispiel: Klick, Timer, Webhook/Event, Auto.
- **Transition Inspector**: auf konkretes Signal lauschen und einfache Regeln bearbeiten.

Regeln sind bewusst schlicht:

```text
Feld                  Operator   Wert
Checkbox A.checked   ==         true
Checkbox B.checked   ==         false
E-Mail.value         !=         ""
```

Kombinationen:

- `UND`: alle Regeln müssen passen.
- `ODER`: eine Regel reicht.

Der Rule Builder zeigt unterscheidbare Felder mit State-ID:

- `Checkbox A (checkbox_a) · checked`
- `Checkbox B (checkbox_b) · checked`
- `E-Mail (email) · value`
- `Suchfeld (search) · value`
- Event/Webhook-Felder wie `Incoming call · caller`

Kein freies JSON als Hauptbedienung. Jede Regel ist eine eigene Zeile und einzeln löschbar.
