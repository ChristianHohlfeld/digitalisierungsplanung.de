# Zustand · Digitalisierungsplanung

Zustand visualisiert Firmenabläufe als klickbare State Charts. Der Editor bewahrt den etablierten Desktop- und Mobile-Arbeitsablauf vollständig:

- Eigenschaften links
- App-Vorschau rechts
- Vorlagen-Dock unten
- Canvas mit Single- und Mehrfachauswahl, Doubleclick, Drag, Pan, Wheel-Zoom und Rectangle-Select
- Touch mit Doubletap, Hold-to-drag, Pan und Pinch-Zoom
- mobile Ansichten für Vorlagen, Canvas, Bearbeitung und App

Die Vereinfachung liegt hinter dieser Oberfläche: Der öffentliche Product Contract enthält nur eine Kategorie und genau 13 Basic-Presets. Das Canvas-, Drawer- und Eingabesystem ist kein Gegenstand des Cleanups.

## Produktkern

1. States und Transitionen bilden einen realen Prozess ab.
2. Die generierte App-Vorschau lässt diesen Prozess durchklicken.
3. **URL aufnehmen** öffnet den kontrollierten Website-Recorder.
4. Jede aufgezeichnete Aktion erzeugt exakt eine Transition und einen neuen State.
5. Echter Replay führt dieselben Aktionen in einem frischen Chromium-Kontext aus und stoppt beim ersten Checkpoint-Mismatch.

Die 13 Basics sind Dropdown, Button, Toast, Checkbox, Textfeld, Zahlenfeld, Suche, E-Mail-Feld, Passwortfeld, Überschrift, Bild, Datum und Radio. Es gibt keine zweite Preset-Quelle, Pakete, Abos oder Connectoren im öffentlichen Vertrag.

## Verträge

- `state-blueprint-definition`, `schemaVersion: 2`: Editorprojekt mit einem kanonischen `model`
- `flow/1`: kleiner öffentlicher Produktvertrag
- `website-recording/1`: transportables Aufnahme-/Replay-Paket

Zwingende Umkehrinvariante:

```text
Aktionen = Recording-Schritte = Transitionen
States = Aktionen + 1
```

Details: [docs/state-contract.md](docs/state-contract.md).

## Lokal

Voraussetzung: Node.js 24.

```bash
npm ci
npx playwright install chromium
npm test
```

```bash
npm run server:start
node tests/serve-state.mjs
```

- Editor: `http://127.0.0.1:8124/state.html`
- Recorder-Dienst: `http://127.0.0.1:8788/recorder.html`

## Produktion

GitHub Pages liefert das Frontend. `realtime.digitalisierungsplanung.de` liefert Health, Version, Product Contract, Recorder, Replay und kontrollierten Bildimport.

Die Pipeline testet den Source-Commit, erzeugt danach einen monotonen `release-N`-Commit und wartet auf Produktionskonvergenz. Der Server deployt nur einen grünen Release-Stempel und stellt bei Fehlern den letzten gesunden Commit wieder her.

- [digitalisierungsplanung.de](https://digitalisierungsplanung.de)
- [Runtime-Health](https://realtime.digitalisierungsplanung.de/healthz)
- [Product Contract](https://realtime.digitalisierungsplanung.de/contract)

## Relevante Dateien

- `state.html` – vollständiger visueller Editor und generierte App-Vorschau
- `recorder.html` – kontrollierter Screenshot-Browser
- `server/recorder.js` – Aufnahme, Compiler, Checkpoints und echter Replay
- `server/server.js` – kleiner HTTP-Dienst
- `server/product-contract.js` und `server/preset-catalog.js` – Minimalvertrag und 13 Basics
- `server/deploy.sh` und `server/auto-deploy.sh` – Green-Release-Deploy und Rollback
- `tests/state-tool.spec.js` und `tests/canvas-camera.spec.js` – eingefrorener UI-/Input-Vertrag
- `scripts/production-smoke.mjs` – produktive Freigabeprüfung
