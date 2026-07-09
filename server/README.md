# Digitalisierungsplanung Realtime Server

WebSocket relay for `state.html` realtime canvas/runtime events.

## Runtime

- Public endpoint: `wss://realtime.digitalisierungsplanung.de/ws`
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

## Droplet Deploy

Point DNS first:

```sh
realtime.digitalisierungsplanung.de A <droplet-ip>
```

Then on the droplet:

```sh
APP_DIR=/var/www/digitalisierungsplanung.de \
BRANCH=agent/realtime-wss-server \
bash server/deploy.sh
```

If the repository is not cloned yet, bootstrap it first:

```sh
git clone --branch agent/realtime-wss-server https://github.com/ChristianHohlfeld/digitalisierungsplanung.de.git /var/www/digitalisierungsplanung.de
cd /var/www/digitalisierungsplanung.de
bash server/deploy.sh
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
pm2 status digitalisierungsplanung-realtime
```

For a full signed join smoke test:

```sh
set -a
. /etc/digitalisierungsplanung-realtime.env
set +a
npm run server:smoke:wss
```
