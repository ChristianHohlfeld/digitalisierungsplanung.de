# Zustand

Zustand macht aus einem echten Browser-Ablauf ein visuelles, replaybares State-Projekt.

Der Produktkern hat zwei Seiten derselben Sache:

- **App Recorder · Input** – eine bestehende Website/App wird in einem echten lokalen Chromium benutzt. Klicks, Inputs, Checkboxen, Tasten, Scrolls und Timings werden im Hintergrund aufgenommen.
- **App Render · Output** – das daraus entstandene State-Projekt wird als State Chart visualisiert, im Inspector bearbeitet und als echter Browser-Ablauf wieder abgespielt.

Der Editor ist `state.html`. `recorder.html` ist nur noch ein Redirect auf den Recorder-Tab des Editors.

## Schnellstart

```bash
npm ci
npm run recorder:agent
```

Dann `https://digitalisierungsplanung.de/state.html?tab=recorder` öffnen, URL eingeben und **Aufnahme starten**.

Der Local Recorder Agent läuft standardmäßig auf `http://127.0.0.1:8799`. Er öffnet ein headed Chromium auf demselben Rechner. Dadurch funktionieren auch Intranet-Ziele, die nur vom Client-Netz erreichbar sind.

## Aufnahme

1. Im Tab **App Recorder · Input** die Ziel-URL eingeben.
2. **Aufnahme starten** klicken.
3. Das geöffnete Chromium normal benutzen. Kein Screenshot-Remote-Control und kein separates Text-Senden-Feld.
4. Zurück im Editor **Fertig → Projekt** klicken.
5. Zustand übernimmt das Recording direkt als Projekt und wechselt zu **App Render · Output**.

Aufgenommen werden unter anderem:

- Clicks mit Selector und Koordinaten-Fallback
- Inputs und Changes
- Checkbox-/Radio-Zustände als Boolean
- Special Keys wie Enter/Tab/Escape
- debounced Scrolls
- echte Action-Delays
- visuelle Snapshots pro Schritt

Passwortwerte werden nicht im Recording gespeichert. Ein echter Replay eines redacted Passwort-Felds benötigt einen Secret-Wert für dessen Selector.

## State-Projekt

Das fokussierte Produktformat ist `zustand-project` Version 1.

```json
{
  "kind": "zustand-project",
  "version": 1,
  "startStateId": "state_001",
  "states": [],
  "transitions": [],
  "recording": {}
}
```

### State

Der **State besitzt den Trigger-Kontext**:

- `interaction`
- `timer`
- `event`
- `auto`

Ein State kann außerdem erkannte Felder bereitstellen, zum Beispiel:

- `states.state_002.email.value`
- `states.state_003.freigabe.checked`

Damit bleiben unterschiedliche Checkboxen und Inputs eindeutig und einfach regelbar.

### Transition

Die **Transition beschreibt, worauf innerhalb des State-Kontexts gehört wird**:

- `click`
- `input`
- `change`
- `key`
- `scroll`
- `event`
- `timer`
- `auto`

Filter sind strukturierte Regelzeilen, keine JSON-Eingabe:

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

Im Inspector wird das als **Feld · Operator · Wert** dargestellt; jede Regel ist einzeln editier- und löschbar, mit UND/ODER für Kombinationen.

## Echter Replay

Im Tab **App Render · Output** startet **Echter Replay** einen neuen lokalen Chromium und führt die aufgenommenen Browser-Actions erneut aus. Selector ist primär, Click-Koordinaten dienen als Fallback. Die State-Chart-Auswahl folgt dem Replay-Fortschritt.

Das ist kein Screenshot-Slideshow-Replay: die Actions werden gegen die echte Website ausgeführt.

## Dateien

- `state.html` – Produkteditor, State Chart, Inspector, App Recorder/Input, App Render/Output
- `server/native-recorder-agent.js` – lokaler HTTP-Agent für Record/Replay
- `server/native-browser-recorder.js` – Browser-Recorder-Kern und CLI
- `server/external-recorder.js` – bestehender Server-Recorder/Compiler, nicht der primäre Produkt-UX
- `disable-sw.js` – nur Service-Worker-/Cache-Cleanup

## Tests

```bash
npm run test:server
```

Release-kritisch getestet werden der Produkt-Surface-Contract, native Recorder-Action-Capture, der Local-Agent-Projektvertrag und die bestehenden Server-Verträge.
