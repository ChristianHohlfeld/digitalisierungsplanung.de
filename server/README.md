# Digitalisierungsplanung Realtime Server

WebSocket relay for `state.html` realtime canvas/runtime events.

## Runtime

- Public endpoint: `wss://realtime.digitalisierungsplanung.de/ws`
- Token endpoint: `https://realtime.digitalisierungsplanung.de/token`
- Local process: `127.0.0.1:8788`
- Allowed browser origin: `https://digitalisierungsplanung.de`
- Room auth: signed HMAC room token via `REALTIME_ROOM_SECRET`

## Message Types

- `join`: first client message, requires `roomId`, `clientId`, and signed `token` in production.
- `presence.cursor`: transient cursor/drag presence, dropped for slow peers.
- `runtime.event`: relayed event name and detail for state-machine runtime reactions.
- `graph.patch`: persistent graph mutation ops, rev increments on the server.
- `snapshot.request` and `snapshot`: reconnect/resync support.

The server broadcasts to other clients in the same room only. It does not echo messages to the sender.

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

Only event names starting with `realtime.` are relayed. Existing `button.*`, `change.*`, `timer.*`, and `auto.*` events remain local runtime events.

Example:

```js
window.__stateBlueprintRealtime.emit("realtime.canvas.pulse", { stateId: "start" });
```

Use a matching transition in the model:

```text
triggerType: event
triggerEvent: realtime.canvas.pulse
```

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
pm2 status digitalisierungsplanung-realtime
```

The smoke test reads `/etc/digitalisierungsplanung-realtime.env` automatically when it exists, so `server:smoke:wss:prod` performs a signed join on the Droplet.

For a custom env file:

```sh
npm run server:smoke:wss -- --env-file=/path/to/realtime.env
```
