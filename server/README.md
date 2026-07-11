# Digitalisierungsplanung Realtime Server

WebSocket relay for `state.html` realtime canvas/runtime events.

## Runtime

- Public endpoint: `wss://realtime.digitalisierungsplanung.de/ws`
- Token endpoint: `https://realtime.digitalisierungsplanung.de/token`
- Test console: `https://realtime.digitalisierungsplanung.de/console.html`
- Event definitions: `https://realtime.digitalisierungsplanung.de/events`
- Shared release: `https://realtime.digitalisierungsplanung.de/version`
- Local process: `127.0.0.1:8788`
- Allowed browser origin: `https://digitalisierungsplanung.de`
- Room auth: signed HMAC room token via `REALTIME_ROOM_SECRET`

Full API reference: [`../docs/realtime-api.md`](../docs/realtime-api.md)

## Message Types

- `join`: first client message, requires `roomId`, `clientId`, and signed `token` in production.
- `presence.cursor`: transient cursor/drag presence, dropped for slow peers.
- `runtime.event`: relayed event name and detail for state-machine runtime reactions. The server accepts only catalogued `realtime.*` names from `/events`.

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

`/emit` accepts only offered `realtime.*` events from `/events`. Existing `button.*`, `change.*`, `timer.*`, and `auto.*` events remain local runtime events.
Graph/model collaboration must go through the documented State Blueprint API, not through this WSS relay.

Example:

```js
await window.__stateBlueprintRealtime.emit("realtime.sip.call.incoming", {
  caller: "+491234",
  callee: "100",
  callId: "local-123"
});
```

Use a matching transition in the model:

```text
triggerType: realtime
triggerEvent: realtime.sip.call.incoming
```

Open `https://realtime.digitalisierungsplanung.de/console.html?room=<room-id>` for a browser test emitter. The console loads event names and detail fields from `/events`, then POSTs to `/emit` with the Bearer secret you paste into the page. It stores no server-side state.

## Event Catalog

The event catalog is the server-side source of truth for offered realtime events. Unknown `realtime.*` names are rejected on `/emit`, rejected on `/ws`, and ignored by the host bridge before they can enter the generated runtime.

- `/events`: event definitions only.
- `/ws`: WebSocket relay only.
- `/emit`: authenticated server-to-server fire endpoint only.
- `/console.html`: manual browser emitter for testing only.

The canvas should store only concrete refs it uses, mainly `triggerType: realtime` and `triggerEvent`. It should not store preset contracts, endpoint definitions, catalog copies, or preset instances.

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

For an already installed server, install the automatic release watcher once:

```sh
cd /var/www/digitalisierungsplanung.de
git fetch --prune --force origin +refs/heads/main:refs/remotes/origin/main
git reset --hard origin/main
git clean -ffd
sudo bash server/deploy.sh
sudo bash server/auto-deploy.sh --install
```

The systemd timer checks `origin/main` every minute. It deploys only when CI has
advanced the shared `release-N` ID in `sw-version.js`. It then locks against a
second run, discards all local repository changes, checks out the exact remote
commit, runs `deploy.sh`, updates the PM2 environment, validates Nginx and
requires `/healthz` to report the same release ID. The success marker advances
only after all checks pass. A failed update is retried and then rolled back to
the last verified commit; the timer tries the new release again later.
Only the one-time rollback to a pre-`release-N` deployment may accept its old
health payload without an ID. Every new release requires an exact API match.

Useful commands:

```sh
sudo bash server/auto-deploy.sh --once
sudo bash server/auto-deploy.sh --status
systemctl status digitalisierungsplanung-auto-deploy.timer
journalctl -u digitalisierungsplanung-auto-deploy.service -n 100 --no-pager
curl -fsS https://realtime.digitalisierungsplanung.de/version
```

`/etc/digitalisierungsplanung-realtime.env` remains outside the repository and
is never removed by the force sync. Do not keep manual production changes
inside `/var/www/digitalisierungsplanung.de`; `origin/main` intentionally wins.

`deploy.sh` remains the bootstrap and manual recovery command. It installs only
missing runtime packages, runs `npm ci --omit=dev`, starts or reloads PM2 with
`--update-env`, saves PM2 for reboot, validates the shared release, and reloads
Nginx.

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
curl -fsS https://realtime.digitalisierungsplanung.de/version
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
