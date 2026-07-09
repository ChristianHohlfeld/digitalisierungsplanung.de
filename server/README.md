# Digitalisierungsplanung Realtime Server

WebSocket relay for `state.html` realtime canvas/runtime events.

## Runtime

- Public endpoint: `wss://realtime.digitalisierungsplanung.de/ws`
- Token endpoint: `https://realtime.digitalisierungsplanung.de/token`
- Marketplace HTML: `https://realtime.digitalisierungsplanung.de/marketplace.html`
- Test console: `https://realtime.digitalisierungsplanung.de/console.html`
- Marketplace index: `https://realtime.digitalisierungsplanung.de/marketplace`
- Preset refs: `https://realtime.digitalisierungsplanung.de/presets`
- Event definitions: `https://realtime.digitalisierungsplanung.de/events`
- Endpoint definitions: `https://realtime.digitalisierungsplanung.de/endpoints`
- State schema: `https://realtime.digitalisierungsplanung.de/state-schema`
- Local process: `127.0.0.1:8788`
- Allowed browser origin: `https://digitalisierungsplanung.de`
- Room auth: signed HMAC room token via `REALTIME_ROOM_SECRET`

Full API reference: [`../docs/realtime-api.md`](../docs/realtime-api.md)

## Message Types

- `join`: first client message, requires `roomId`, `clientId`, and signed `token` in production.
- `presence.cursor`: transient cursor/drag presence, dropped for slow peers.
- `runtime.event`: relayed event name and detail for state-machine runtime reactions. The app contract consumes `realtime.*` names.

The server broadcasts to other clients in the same room only. It does not echo messages to the sender.
The server does not accept model patches or snapshots. Model writes stay in the canonical State Blueprint JSON/API layer.

## State Runtime Integration

Open the static app with a room id:

```text
https://digitalisierungsplanung.de/state.html?room=<room-id>
```

The host page fetches a short-lived signed room token from `/token`, opens `wss://realtime.digitalisierungsplanung.de/ws`, and joins the room.

Realtime is transport only. Runtime state still flows through the existing global JSON bus:

```text
STATE_BLUEPRINT_REALTIME_EVENT -> emitRuntimeEvent(...) -> writeRuntimeState("events..." / "lastEvent")
```

`/emit` accepts only offered `realtime.*` events from the live marketplace. Existing `button.*`, `change.*`, `timer.*`, and `auto.*` events remain local runtime events.
Graph/model collaboration must go through the documented State Blueprint API, not through this WSS relay.

Example:

```js
window.__stateBlueprintRealtime.emit("realtime.canvas.pulse", { stateId: "start" });
```

Use a matching transition in the model:

```text
triggerType: realtime
triggerEvent: realtime.canvas.pulse
```

Open `https://realtime.digitalisierungsplanung.de/console.html?room=<room-id>` for a browser test emitter. The console loads event names and detail fields from `/events`, then POSTs to `/emit` with the Bearer secret you paste into the page. It stores no server-side state.

## Marketplace Catalog

The marketplace is the server-side source of truth for offered realtime presets. Each area has one responsibility:

- `/marketplace.html`: browser explorer for the live marketplace endpoints.
- `/marketplace`: index links and counts only.
- `/presets`: concrete preset refs only, using `eventIds`, `endpointIds`, and `statePaths`.
- `/events`: event definitions only.
- `/endpoints`: websocket/http endpoint definitions only.
- `/state-schema`: global JSON state field definitions only.

The canvas should store only concrete refs it uses, such as `triggerEvent`, field paths, room id, and endpoint ids. It should not store preset contracts, imported endpoint definitions, or preset instances.

Detailed payloads, error codes, curl examples, and WebSocket frame shapes are documented in [`../docs/realtime-api.md`](../docs/realtime-api.md).

## Droplet Deploy

Point DNS first:

```sh
realtime.digitalisierungsplanung.de A <droplet-ip>
```

Then on the droplet:

```sh
APP_DIR=/var/www/digitalisierungsplanung.de \
BRANCH=main \
bash server/deploy.sh
```

If the repository is not cloned yet, bootstrap it first:

```sh
git clone --branch main https://github.com/ChristianHohlfeld/digitalisierungsplanung.de.git /var/www/digitalisierungsplanung.de
cd /var/www/digitalisierungsplanung.de
bash server/deploy.sh
```

For an already installed server, the shortest safe update is:

```sh
cd /var/www/digitalisierungsplanung.de
git pull --ff-only origin main
bash server/deploy.sh
```

`deploy.sh` runs `npm ci --omit=dev`, starts/restarts PM2 with `--update-env`, saves PM2 for reboot, and reloads Nginx. Use it after Nginx config changes such as `/token`.

If you update manually instead:

```sh
cd /var/www/digitalisierungsplanung.de
git pull --ff-only origin main
npm ci --omit=dev
pm2 restart digitalisierungsplanung-realtime --update-env
cp server/nginx/realtime.digitalisierungsplanung.de.conf /etc/nginx/sites-available/realtime.digitalisierungsplanung.de
nginx -t && systemctl reload nginx
```

If TLS is not installed yet, create DNS first and then run:

```sh
certbot certonly --webroot -w /var/www/certbot -d realtime.digitalisierungsplanung.de
cp server/nginx/realtime.digitalisierungsplanung.de.conf /etc/nginx/sites-available/realtime.digitalisierungsplanung.de
ln -sf /etc/nginx/sites-available/realtime.digitalisierungsplanung.de /etc/nginx/sites-enabled/realtime.digitalisierungsplanung.de
nginx -t && systemctl reload nginx
```

Smoke checks:

```sh
curl -fsS https://realtime.digitalisierungsplanung.de/healthz
npm run server:smoke:wss
npm run server:smoke:wss:prod
npm run server:smoke:emit
npm run server:smoke:emit:prod
pm2 status digitalisierungsplanung-realtime
```

The smoke tests read `/etc/digitalisierungsplanung-realtime.env` automatically when it exists. `server:smoke:wss:prod` performs a signed join on the Droplet, and `server:smoke:emit:prod` performs the authenticated `/emit` POST.

For a custom env file:

```sh
npm run server:smoke:wss -- --env-file=/path/to/realtime.env
npm run server:smoke:emit -- --env-file=/path/to/realtime.env
```
