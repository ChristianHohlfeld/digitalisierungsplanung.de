# Zustand

Zustand macht aus einem echten Browser-Ablauf ein visuelles, replaybares State-Projekt.

Der Produktkern hat zwei Seiten derselben Sache:

- **App Recorder · Input** – eine bestehende Website/App wird im echten Browser-Tab benutzt. Klicks, Inputs, Checkboxen, Tasten, Scrolls, Navigationen und Timings werden im Hintergrund aufgenommen.
- **App Render · Output** – das daraus entstandene State-Projekt wird als State Chart visualisiert, im Inspector bearbeitet und als echter Browser-Ablauf wieder abgespielt.

Der Editor ist `state.html`. `recorder.html` ist nur noch ein Redirect auf den Recorder-Tab des Editors.

## Aufnahme

Für neue Browserpfade wird einmalig der **Zustand Desktop Recorder** installiert. Er ist eine Browser-Erweiterung und läuft direkt in Chrome/Edge – kein lokaler Node-Prozess, kein localhost-Port und keine Screenshot-Fernsteuerung.

1. In **App Recorder · Input** den Desktop Recorder installieren, falls er noch fehlt.
2. Ziel-URL eingeben und **Aufnahme starten** klicken.
3. Die Zielseite öffnet sich als normaler Browser-Tab.
4. Die App normal benutzen.
5. Zum Editor zurückkehren und **Fertig → Projekt** klicken.
6. Zustand übernimmt den Ablauf direkt als State-Projekt und wechselt zu **App Render · Output**.

Öffentliche Seiten und Intranet-Ziele funktionieren über denselben Browser-Kontext des Benutzers. Deshalb benötigt der Server weder DNS- noch Netzwerkzugriff auf eine interne Zielseite.

Auf dem Smartphone bleibt Editor/Chart/Render nutzbar; neue Browserpfade werden auf Desktop aufgenommen. Die Oberfläche zeigt dort ausdrücklich **Aufnahme auf Desktop verfügbar** statt Entwickler-Infrastruktur.

Aufgenommen werden unter anderem:

- Clicks mit Selector und Koordinaten-Fallback
- Inputs und Changes
- Checkbox-/Radio-Zustände als Boolean
- Special Keys wie Enter/Tab/Escape
- Scrolls
- Navigationen
- echte Action-Delays
- visuelle Snapshots

Passwortwerte werden nie gespeichert. Ein Replay eines geschützten Passwort-Felds verlangt den Wert erneut.

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

Ein State kann erkannte Felder bereitstellen, zum Beispiel:

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
- `navigate`
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

Im Tab **App Render · Output** öffnet **Echter Replay** einen echten Browser-Tab und führt die aufgenommenen Actions erneut aus. Der State Chart folgt dem Fortschritt.

Das ist kein Screenshot-Slideshow-Replay: Inputs, Checkboxen, Klicks, Scrolls und Navigationen werden gegen die echte Website ausgeführt.

## Dateien

- `state.html` – schlanke Produktoberfläche für Chart, Inspector und Input/Output-Tabs
- `state-app.js` – fokussierter Editor-/Chart-/Inspector-/Replay-Runtime
- `recorder-extension/` – Desktop Recorder für echte Browser-Tabs
- `recorder-extension/editor-bridge.js` – Verbindung zwischen Editor und Erweiterung
- `server/external-recorder.js` – serverseitiger Automationsbrowser für Backend/Smokes, nicht die Aufnahme-UX
- `disable-sw.js` – nur Service-Worker-/Cache-Cleanup

## Tests

```bash
npm run test:server
```

Release-kritisch getestet werden Produkt-Surface, Extension-Manifest/Bridge, echter Browser-Extension-Record→Chart→Replay-Flow, Inspector-Vertrag und Server-/Deployment-Verträge.
