# Zustand Runtime

Der Dienst auf `realtime.digitalisierungsplanung.de` liefert den kleinen Product Contract und führt Website-Aufnahme sowie echten Replay in Playwright-Chromium aus. Es gibt keine Admin-, Autoren-, Billing-, MCP-, Event- oder WebSocket-Fläche.

## Laufzeit

- Node.js 24
- Playwright 1.60 mit gepinntem Chromium
- ein PM2-Prozess auf `127.0.0.1:8788`
- Nginx als TLS- und Routengrenze

```bash
npm ci --omit=dev
npx playwright install chromium
npm run server:start
```

## Routen

| Methode und Route | Zweck |
|---|---|
| `GET /healthz` | Release- und Chromium-Bereitschaft |
| `GET /version` | aktive Release-Metadaten |
| `GET /contract` | `flow/1` und 13 Basic-Presets |
| `GET /recorder.html` | eingebettete Recorder-Oberfläche |
| `POST /recorder/sessions` | Aufnahme starten |
| `POST /recorder/sessions/:id/actions` | definierte Aktion aufnehmen |
| `POST /recorder/sessions/:id/finish` | Recording und Chart kompilieren |
| `POST /recorder/replays` | transportables Recording in frischem Browser starten |
| `POST /recorder/sessions/:id/replay/next` | nächste echte Aktion ausführen und prüfen |
| `POST /recorder/sessions/:id/replay/stop` | Replay schließen |
| `DELETE /recorder/sessions/:id` | Session schließen |
| `POST /assets/inline-image` | öffentliches Bild begrenzt als Data-URL laden |

Nginx veröffentlicht keine anderen Pfade. PM2 setzt die Produktions-Origins explizit; die Anwendungsvorgaben enthalten zusätzlich nur die beiden lokalen Entwicklungs-Origins.

## Sicherheitsgrenzen

- öffentliche HTTP(S)-Ziele und DNS-/Request-Prüfung
- private und reservierte Netze gesperrt
- Service Worker und WebSocket-Verbindungen im Recorder blockiert
- Passwortwerte nie im Recording
- pro Client und global begrenzte Sessions
- 80 Aktionen pro Aufnahme
- 15 Minuten Standard-TTL
- maximal 128 KiB JSON und 6 MiB Bilddaten
- Replay stoppt beim ersten Checkpoint-Mismatch

## Deployment

Einmalig als `root`:

```bash
bash server/deploy.sh
```

Die CI prüft Source und Verträge. Der Deploy-Runner akzeptiert danach nur einen Release-Commit, der außer `release-version.js` exakt diesem grünen Source-Commit entspricht. Er installiert Production-Abhängigkeiten und Chromium, startet PM2, prüft Nginx und verlangt `recorderReady: true` für dieselbe Release-ID.

Der Timer `server/auto-deploy.sh` deployt ausschließlich neue grüne Release-Stempel. Bei Fehlern checkt er den zuletzt bestätigten Commit aus, startet ihn neu und verifiziert ihn, bevor er den Marker unverändert lässt.

```bash
curl -fsS https://realtime.digitalisierungsplanung.de/healthz
curl -fsS https://realtime.digitalisierungsplanung.de/version
curl -fsS https://realtime.digitalisierungsplanung.de/contract
curl -fsS https://realtime.digitalisierungsplanung.de/recorder.html >/dev/null
pm2 status digitalisierungsplanung-realtime
```
