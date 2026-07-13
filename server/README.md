# Digitalisierungsplanung Realtime Server

WebSocket relay for `state.html` realtime canvas/runtime events.
The droplet owns only `realtime.digitalisierungsplanung.de`. The root app
(`index.html`, `state.html`, assets, and `release-version.js`) is published by
GitHub Pages, not by this server deploy.

## Runtime

- Public endpoint: `wss://realtime.digitalisierungsplanung.de/ws`
- Token endpoint: `https://realtime.digitalisierungsplanung.de/token`
- Test console: `https://realtime.digitalisierungsplanung.de/console.html`
- Event designer: `https://realtime.digitalisierungsplanung.de/events-admin.html`
- Event definitions: `https://realtime.digitalisierungsplanung.de/events`
- Shared release: `https://realtime.digitalisierungsplanung.de/version`
- Local process: `127.0.0.1:8788`
- Allowed browser origin: `https://digitalisierungsplanung.de`
- Room auth: signed HMAC room token via `REALTIME_ROOM_SECRET`

Full API reference: [`../docs/realtime-api.md`](../docs/realtime-api.md)

## Message Types

- `join`: first client message, requires `roomId`, `clientId`, and signed `token` in production.
- `runtime.event`: relayed event name and detail for state-machine runtime reactions. The server accepts only catalogued `realtime.*` names from `/events`.

The server broadcasts to other clients in the same room only. It does not echo messages to the sender.
It intentionally has no cursor presence and no peer join/leave broadcast.
The server does not accept model patches or snapshots. Model writes stay in the canonical State Blueprint JSON/API layer.

## State Runtime Integration

Open the static app with a room id:

```text
https://digitalisierungsplanung.de/state.html?room=<room-id>
```

The generated runtime fetches a short-lived signed room token from `/token`, opens `wss://realtime.digitalisierungsplanung.de/ws`, and joins the room. Preview and standalone own the same transport; the editor host does not relay events.

Realtime is transport only. Runtime state still flows through the existing global JSON bus:

```text
runtime.event -> emitRuntimeEvent(...) -> writeRuntimeState("events..." / "lastEvent")
```

`/emit` accepts only offered `realtime.*` events from `/events` and requires an offered `emitterId`. The emitter must be allowed to fire that event. Existing `button.*`, `change.*`, `timer.*`, and `auto.*` events remain local runtime events.
Graph/model collaboration must go through the documented State Blueprint API, not through this WSS relay.

The browser bridge has no emitter. Offered events enter through the authenticated external `/emit` boundary or the stateless test console.

Use a matching transition in the model:

```text
triggerType: realtime
triggerEvent: realtime.sip.call.incoming
```

Open `https://realtime.digitalisierungsplanung.de/console.html?room=<room-id>` for a browser test emitter. The console loads connector sources, event names, and detail fields from `/events`, then POSTs to `/emit` with the Bearer secret. The emit secret is stored only in this browser's localStorage for convenience; it is not rendered by the server or stored server-side.

## Event Catalog

The event catalog is the server-side source of truth for offered realtime events and connector sources. Unknown `realtime.*` names are rejected on `/emit`, rejected on `/ws`, and ignored by the host bridge before they can enter the generated runtime. New datasets are created by editing this one catalog through the admin designer and saving it through the server.

- `server/event-catalog.json`: single contract/catalog source in Git.
- `/events/contract`: current server contract for event keys, detail types, and collision-free state contribution paths.
- `/events`: current event and connector definitions.
- `/ws`: WebSocket relay only.
- `/emit`: authenticated server-to-server fire endpoint only.
- `/console.html`: manual browser emitter for testing only.
- `/events-admin.html`: simple event designer for event type, dataset, fields, source, and global-state contribution.

Default connector sources are deliberately practical:

- `sip.threecx`: 3CX / SIP phone system bridge.
- `mail.gmail`: Gmail inbox bridge.
- `mail.outlook`: Microsoft Outlook bridge.
- `webhook.endpoint`: generic inbound webhook bridge.
- `data.source`: external business data update bridge.

The setup rule is always the same: the real system or a tiny bridge posts the
designer's example payload to `/emit` with `REALTIME_EMIT_SECRET`. For 3CX this
is a phone-system webhook or call-flow bridge. For Gmail this is a Google
Workspace automation or small mail bridge. For Outlook this is a Microsoft
automation or Graph/mail bridge. The realtime server does not poll mailboxes or
run a SIP stack.

The designer shows the existing contract datasets first, then follows the canvas
contract order: event type, dataset key, fields, source. The admin secret is
stored only in this browser's localStorage and is required when reloading or
saving through the admin API. A save validates the
same strict server contract, writes `server/event-catalog.json` and
`release-version.js` as one release unit, commits them, and pushes to GitHub.
There is no version selector and no old contract pinning; runtime always uses
the latest green `release-N`. Release IDs are audit labels, not compatibility
branches.

All connector IDs are globally unique and path-safe. Runtime state is written under `events.<eventName>.*` and `emitters.<emitterId>.*`. Exact ID collisions and parent/child path collisions are rejected server-side. The canvas should store only concrete refs it uses, mainly `triggerType: realtime` and `triggerEvent`. It should not store preset contracts, endpoint definitions, catalog copies, or preset instances.

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
sudo bash server/deploy.sh
```

For an already installed server, rerun the same command. It also installs or
refreshes the automatic release watcher:

```sh
cd /var/www/digitalisierungsplanung.de
git fetch --prune --force origin +refs/heads/main:refs/remotes/origin/main
git reset --hard origin/main
git clean -ffd
sudo bash server/deploy.sh
```

The systemd timer checks `origin/main` every minute. It deploys only when CI has
accepted a shared `release-N` ID in `release-version.js`. It then locks against a
second run, discards all local repository changes, checks out the exact remote
commit, runs `deploy.sh`, updates the PM2 environment, validates Nginx and
requires `/healthz` to report the same release ID. The success marker advances
only after all checks pass. A failed deployment does not advance the marker and
does not search for older commits; the timer keeps retrying the latest green
`release-N` until that same release is live. Event-designer saves may include
`server/event-catalog.json` in the stamped release unit; other non-stamped
`main` changes are discarded by the next force sync.

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

The event designer needs `REALTIME_ADMIN_SECRET`. Saving through the designer
also needs repository push credentials on the server. If the Git remote cannot
push with its configured credentials, set `REALTIME_GIT_PUSH_TOKEN` in
`/etc/digitalisierungsplanung-realtime.env` to a GitHub token with contents
write permission for this repository.

`deploy.sh` remains the bootstrap and manual recovery command. It installs
missing runtime packages, validates that the checkout contains only the green
release source plus `release-version.js`, runs `npm ci --omit=dev`, starts or
reloads PM2 with `--update-env`, saves PM2 for reboot, reloads Nginx, and
installs or refreshes the watcher unless `DEPLOY_SKIP_AUTO_DEPLOY=1`. It also
removes obsolete root-domain Nginx config from older deployments so the droplet
stays realtime-only.

Manual recovery uses the same release-gated path:

```sh
cd /var/www/digitalisierungsplanung.de
sudo bash server/deploy.sh
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
