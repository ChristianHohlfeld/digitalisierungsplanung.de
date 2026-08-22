# Zustand · Digitalisierungsplanung

Zustand macht reale Abläufe sichtbar, editierbar und wiederholbar. Die Produktoberfläche ist bewusst auf zwei Seiten desselben Vorgangs reduziert:

- **App Recorder · Input:** eine öffentliche Website im eingebetteten Browser bedienen und als echte Aktionsfolge aufnehmen.
- **App Render · Output:** den daraus entstandenen Ablauf als State Chart prüfen, manuell bearbeiten, durchklicken und gegen die echte Website wiedergeben.

Die fokussierte Recorder/Render-Oberfläche aus Release 206 ist damit wieder die Produktbasis. Der spätere 1,38-MB-Pre-Focus-Editor, Admin-Flächen, Agent-Widget, MCP, Event-Katalog, Realtime/WebSocket, Billing und Preset-Pakete gehören nicht mehr zum Produkt.

## Produktkern

- schlankes State Chart mit Inspector
- manuelle States, Transitionen, Trigger, Listener und einfache Regeln
- responsives Desktop-/Mobile-Layout mit Pointer- und Touch-Drag
- eingebetteter Screenshot-Browser statt unsicherem Cross-Origin-Ziel-Iframe
- serverseitiges Chromium für Aufnahme und echten Replay
- semantische Locator mit Koordinaten-Fallback
- URL-, Titel- und Control-Fingerprint als Checkpoint
- Projekt-JSON und eigenständiger HTML-Export
- genau 13 Basic-Presets im öffentlichen Product Contract

Die 13 Basics sind: Dropdown, Button, Toast, Checkbox, Textfeld, Zahlenfeld, Suche, E-Mail-Feld, Passwortfeld, Überschrift, Bild, Datum und Radio. Es gibt genau eine Kategorie und keine zweite Preset-Quelle.

## Ablauf

### Firmenprozess modellieren

1. States und Transitionen im Chart anlegen.
2. Trigger-Kontext, Listener und Regeln im Inspector setzen.
3. Im Tab **App Render · Output** die States durchklicken.
4. Projekt als JSON oder eigenständige HTML-App exportieren.

### Website aufnehmen

1. Im Tab **App Recorder · Input** eine öffentliche HTTP(S)-URL eingeben.
2. **Aufnahme starten** wählen.
3. Die Website im eingebetteten Screenshot-Browser klicken, beschreiben, per Taste bedienen oder scrollen.
4. **Fertig → Projekt** wählen.
5. Zustand erzeugt `Aktionen + 1` States und exakt eine Transition pro Aktion.
6. Im Output-Tab **Echter Replay** starten.

Der Replay öffnet einen frischen Chromium-Kontext, führt die gespeicherten Aktionen gegen die echte Website aus und stoppt beim ersten abweichenden Checkpoint. Passwortwerte werden nie gespeichert und beim Replay erneut abgefragt.

## Verträge

- `flow/1`: kleiner öffentlicher Produktvertrag und 13 Basics
- `zustand-project` Version 1: gespeichertes UI-Projekt
- `website-recording/1`: transportabler Aufnahme-/Replay-Vertrag

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
```

In zwei Terminals:

```bash
npm run server:start
node tests/serve-state.mjs
```

- Editor: `http://127.0.0.1:8124/state.html`
- Recorder-Dienst: `http://127.0.0.1:8788/recorder.html`

Tests:

```bash
npm test
```

## Produktion

GitHub Pages liefert das Frontend. `realtime.digitalisierungsplanung.de` veröffentlicht ausschließlich Health, Version, Product Contract, Recorder, Replay und kontrollierten Bildimport.

Die Pipeline testet jeden Source-Commit, stempelt danach monoton `release-N` und wartet auf echte Produktionskonvergenz. Der Server-Timer deployt nur einen solchen grünen Stempel. Bei Fehlern stellt er den zuletzt gesunden Commit wieder her und prüft ihn erneut.

- [digitalisierungsplanung.de](https://digitalisierungsplanung.de)
- [Runtime-Health](https://realtime.digitalisierungsplanung.de/healthz)
- [Product Contract](https://realtime.digitalisierungsplanung.de/contract)

## Relevante Dateien

- `state.html` – fokussierte Recorder/Render-Produktoberfläche
- `recorder.html` – eingebetteter Screenshot-Browser
- `server/recorder.js` – Aufnahme, Compiler, Checkpoints und echter Replay
- `server/server.js` – minimaler HTTP-Dienst
- `server/product-contract.js` und `server/preset-catalog.js` – Minimalvertrag und Basics
- `server/deploy.sh` und `server/auto-deploy.sh` – Green-Release-Deploy und Rollback
- `scripts/production-smoke.mjs` – produktive Freigabeprüfung
