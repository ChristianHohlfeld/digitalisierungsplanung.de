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
apt-get update
apt-get install -y git nginx certbot python3-certbot-nginx
npm install -g pm2

mkdir -p /var/www
cd /var/www
git clone https://github.com/ChristianHohlfeld/digitalisierungsplanung.de.git || true
cd digitalisierungsplanung.de
git pull --ff-only
npm ci --omit=dev

export REALTIME_ROOM_SECRET="$(openssl rand -base64 48)"
pm2 start server/ecosystem.config.cjs --update-env
pm2 save
pm2 startup systemd -u root --hp /root
```

Install TLS and Nginx:

```sh
mkdir -p /var/www/certbot
certbot certonly --nginx -d realtime.digitalisierungsplanung.de
cp server/nginx/realtime.digitalisierungsplanung.de.conf /etc/nginx/sites-available/realtime.digitalisierungsplanung.de
ln -sf /etc/nginx/sites-available/realtime.digitalisierungsplanung.de /etc/nginx/sites-enabled/realtime.digitalisierungsplanung.de
nginx -t
systemctl reload nginx
```

Smoke checks:

```sh
curl -fsS https://realtime.digitalisierungsplanung.de/healthz
pm2 status digitalisierungsplanung-realtime
```
