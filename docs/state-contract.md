# Zustand-Vertrag

Stand: 22. August 2026

## 1. Projekt

Die Produktoberfläche speichert genau ein Format:

```json
{
  "kind": "zustand-project",
  "version": 1,
  "startStateId": "state_001",
  "states": [],
  "transitions": [],
  "recording": null
}
```

Ein State besitzt `id`, `title`, Position, Trigger-Kontext, erkannte Felder und optional einen visuellen Snapshot. Eine Transition besitzt `id`, `from`, `to`, sichtbares Label, Listener, strukturierte Regeln und Replay-Delay.

IDs sind eindeutig. `startStateId` zeigt auf einen vorhandenen State. Jede Transition verbindet vorhandene States. Statewechsel existieren nur als Transition.

## 2. Trigger und Listener

Trigger-Kontexte: `interaction`, `timer`, `event`, `auto`.

Listener: `click`, `input`, `change`, `key`, `scroll`, `navigate`, `timer`, `event`, `auto`.

Regeln bestehen aus Feld, Operator und Wert. Erlaubte Operatoren sind `==`, `!=`, `>`, `>=`, `<`, `<=`, `truthy` und `falsy`; mehrere Regeln werden explizit mit UND oder ODER verbunden.

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
