# Zustand-Vertrag

Stand: 22. August 2026

## 1. Projekt

Die Produktoberfläche speichert genau ein Format:

```json
{
  "kind": "state-blueprint-definition",
  "schemaVersion": 2,
  "app": "Zustand",
  "savedAt": "2026-08-22T00:00:00.000Z",
  "model": {
    "version": 2,
    "name": "Freigabeprozess",
    "initial": "state_001",
    "states": [],
    "transitions": []
  },
  "camera": { "x": 0, "y": 0, "scale": 1 },
  "previewCollapsed": false
}
```

Ein State besitzt mindestens `id`, `title`, `x` und `y`; Darstellung, Daten und Verschachtelung sind optionale Modelldetails. Eine Transition besitzt mindestens `id`, `from`, `to` und ein sichtbares `label`; Trigger, Bedingung und Schreiboperationen sind optional.

IDs sind eindeutig. `model.initial` zeigt auf einen vorhandenen State. Jede Transition verbindet vorhandene States. Statewechsel existieren nur als Transition.

## 2. Trigger und Listener

Der kleine öffentliche Katalog kennt `button`, `change`, `event`, `api`, `timer` und `auto`; internes `flow` dient ausschließlich verschachtelten Abläufen. Unbekannte Trigger werden nicht als Alias normalisiert. Bedingungen und Schreiboperationen bleiben Eigentum der Transition.

## 3. Aufnahme

Der transportable Vertrag heißt `website-recording/1`:

```json
{
  "schema": "website-recording/1",
  "startUrl": "https://example.com/",
  "initialStateId": "recorded_001",
  "initialCheckpoint": {},
  "steps": [],
  "snapshotCount": 1
}
```

Ein Schritt besitzt eine eindeutige `id`, `transitionId`, `fromStateId`, `toStateId`, `delayMs`, genau eine Aktion und den erwarteten Ziel-Checkpoint. Aktionen sind `click`, `input`, `key`, `scroll` oder `navigate`.

## 4. Umkehrinvariante

```text
Aktion 1 <-> Schritt 1 <-> Transition 1 <-> State 1 → State 2
Aktion 2 <-> Schritt 2 <-> Transition 2 <-> State 2 → State 3
…
```

Daraus folgt zwingend:

- `steps.length === transitions.length`
- `snapshotCount === steps.length + 1`
- Schritt- und Transition-IDs sind jeweils eindeutig
- jeder `fromStateId` ist der Zielstate des vorherigen Schritts
- es gibt keinen erfundenen, verlorenen oder zusammengefassten Statewechsel

Ein Recording-Paket ist selbstständig replaybar; eine abgelaufene Aufnahmesession ist dafür nicht erforderlich.

## 5. Echter Replay

1. Recording-Paket validieren.
2. Start-URL in einem frischen Browser-Kontext öffnen.
3. Start-Checkpoint prüfen.
4. pro Schritt das aufgezeichnete Delay abwarten.
5. semantischen Locator auflösen, Koordinate nur als Fallback verwenden.
6. Aktion gegen die echte Website ausführen.
7. URL, Titel und sichtbare Control-Struktur hashen.
8. Ziel-Checkpoint prüfen.
9. nur bei Übereinstimmung den zugeordneten State markieren.

Beim ersten Mismatch stoppt der Replay. Eine Chart-Animation ohne reale Browseraktion ist kein Replay.

## 6. Sicherheit

- nur öffentliche HTTP(S)-Ziele
- DNS-Prüfung vor Start, Navigation und jeder Browser-Anfrage
- keine privaten, Loopback-, Link-Local-, Multicast- oder reservierten Ziele
- keine URL-Zugangsdaten
- begrenzte Sessions, Aktionen, Requests und Laufzeiten
- keine frei gelieferten Skripte
- Passwortwerte ausschließlich als redacted Action
- Parent-Nachrichten nur von erwartetem Window und Origin
- Zielwebsite niemals als rohes Cross-Origin-Iframe

## 7. Release

Ein Release ist grün, wenn Server- und Browserverträge bestehen, Chromium ausführbar ist, Source- und Release-Commit außer `release-version.js` identisch sind und Frontend, Version, Health, Contract sowie Recorder dieselbe Release-ID melden. Ein fehlgeschlagener Deploy muss den letzten gesunden Commit wiederherstellen.
