# Realtime API

Diese API gehoert zum Realtime-Server unter `server/`. Sie transportiert Runtime-Events fuer `state.html` und stellt den Marketplace bereit. Sie ist nicht die Modell-API und persistiert keinen fachlichen Zustand.

## Grundsatz

Der globale JSON-State/Event-Bus bleibt die einzige fachliche Wahrheit. Der Realtime-Server ist:

- Transport fuer WSS-Runtime-Events,
- Live-Marketplace fuer angebotene Presets, Events, Endpoints und State-Felder,
- stateless Fire-Endpunkt fuer externe Systeme.

Der Canvas speichert keine Marketplace-Kopie. Er speichert nur konkrete Referenzen, die er wirklich verwendet, zum Beispiel `triggerEvent: "realtime.sip.call.incoming"`.

## Base URLs

```text
HTTPS base: https://realtime.digitalisierungsplanung.de
WSS base:   wss://realtime.digitalisierungsplanung.de/ws
```

Lokaler Prozess hinter Nginx:

```text
http://127.0.0.1:8788
```

## Origin und Auth

Browser-Origin ist in Production auf `https://digitalisierungsplanung.de` begrenzt. Konfiguriert wird das ueber `REALTIME_ALLOWED_ORIGINS`.

REST-Kataloge erlauben:

- Requests ohne `Origin`, z.B. `curl` oder Server-to-server,
- Requests mit erlaubtem `Origin`,
- `OPTIONS` fuer Browser-Preflight.

`/token` braucht einen erlaubten Browser-Origin und `REALTIME_ROOM_SECRET`.

`/emit` braucht:

```http
Authorization: Bearer <REALTIME_EMIT_SECRET>
Content-Type: application/json
```

Server-to-server `/emit` darf ohne `Origin` kommen. Browser-Requests mit fremdem Origin werden abgelehnt.

## Namensregeln

IDs duerfen nur diese Zeichen enthalten:

```text
a-z A-Z 0-9 _ . : -
```

Limits:

- `roomId`, `clientId`, Preset-IDs: maximal 128 Zeichen
- Eventnamen: maximal 160 Zeichen
- State-Pfade: maximal 240 Zeichen
- Request-Body: default maximal 64 KiB

Realtime-Events im App-Contract beginnen mit:

```text
realtime.
```

`/emit` akzeptiert nur Events, die im aktuellen `/events`-Katalog angeboten werden.

## REST Endpoints

### `GET /healthz`

Public Healthcheck ohne Auth.

Response:

```json
{
  "ok": true,
  "rooms": 0,
  "clients": 0
}
```

### `GET /marketplace.html`

HTML-Explorer fuer den Live-Marketplace. Laedt `/marketplace`, `/presets`, `/events`, `/endpoints` und `/state-schema` direkt vom Server.

### `GET /console.html`

HTML-Testkonsole fuer `/emit`. Die Seite speichert serverseitig nichts. Das Emit-Secret wird nur im Browserfeld verwendet und als Bearer-Token an `/emit` gesendet.

### `GET /marketplace`

Index. Liefert nur Links und Counts, keine konkreten Contracts.

Response:

```json
{
  "links": {
    "presets": "https://realtime.digitalisierungsplanung.de/presets",
    "events": "https://realtime.digitalisierungsplanung.de/events",
    "endpoints": "https://realtime.digitalisierungsplanung.de/endpoints",
    "stateSchema": "https://realtime.digitalisierungsplanung.de/state-schema"
  },
  "counts": {
    "presets": 1,
    "events": 3,
    "endpoints": 3,
    "stateFields": 10
  }
}
```

### `GET /events`

Event-Definitionen. Das ist die Live-Quelle fuer auswaehlbare Realtime-Events im Editor.

Response:

```json
{
  "events": [
    {
      "name": "realtime.sip.call.incoming",
      "label": "Incoming call",
      "description": "SIP phone call started",
      "detail": {
        "caller": "text",
        "callee": "text",
        "callId": "text"
      },
      "bindings": [
        {
          "from": "detail.caller",
          "to": "realtime.sip.call.incoming.caller",
          "type": "text"
        }
      ]
    }
  ]
}
```

Felder:

- `name`: Event-ID, muss mit `realtime.` beginnen.
- `label`: Anzeige im Editor.
- `description`: optionale Beschreibung.
- `detail`: erwartete Payload-Felder und Typen.
- `bindings`: Mapping von `detail.*` in den globalen JSON-State.

Unterstuetzte Typen:

```text
text, email, password, number, boolean, url, image, object, list
```

### `GET /presets`

Preset-Referenzen. Keine Contract-Kopie, sondern Gruppierung konkreter IDs.

Response:

```json
{
  "presets": [
    {
      "id": "realtime.sip.call",
      "label": "Sip Call",
      "kind": "realtime",
      "eventIds": [
        "realtime.sip.call.incoming",
        "realtime.sip.call.answered",
        "realtime.sip.call.ended"
      ],
      "endpointIds": [
        "realtime.websocket",
        "realtime.emit"
      ],
      "statePaths": [
        "realtime.sip.call.incoming.caller"
      ]
    }
  ]
}
```

### `GET /presets/:presetId`

Ein einzelnes Preset.

Response:

```json
{
  "preset": {
    "id": "realtime.sip.call",
    "label": "Sip Call",
    "kind": "realtime",
    "eventIds": [
      "realtime.sip.call.incoming"
    ],
    "endpointIds": [
      "realtime.websocket",
      "realtime.emit"
    ],
    "statePaths": [
      "realtime.sip.call.incoming.caller"
    ]
  }
}
```

Fehler:

- `400 {"error":"invalid_preset"}`
- `404 {"error":"preset_not_found"}`

### `GET /endpoints`

Technische Endpoints, die der Marketplace anbietet.

Response:

```json
{
  "endpoints": [
    {
      "id": "realtime.websocket",
      "label": "Realtime WebSocket",
      "kind": "websocket",
      "url": "wss://realtime.digitalisierungsplanung.de/ws",
      "emits": [
        "realtime.sip.call.incoming"
      ]
    },
    {
      "id": "realtime.token",
      "label": "Realtime room token",
      "kind": "http",
      "method": "GET",
      "url": "https://realtime.digitalisierungsplanung.de/token"
    },
    {
      "id": "realtime.emit",
      "label": "Emit realtime event",
      "kind": "http",
      "method": "POST",
      "url": "https://realtime.digitalisierungsplanung.de/emit",
      "emits": [
        "realtime.sip.call.incoming"
      ]
    }
  ]
}
```

### `GET /state-schema`

State-Felder, die durch Realtime-Transport und Event-Bindings im globalen JSON-State auftauchen koennen.

Response:

```json
{
  "rootPath": "realtime",
  "fields": [
    {
      "path": "realtime.connected",
      "type": "boolean",
      "source": "realtime.transport"
    },
    {
      "path": "realtime.sip.call.incoming.caller",
      "type": "text",
      "source": "realtime.sip.call.incoming"
    }
  ]
}
```

### `GET /token?roomId=<room>&clientId=<client>`

Erzeugt ein kurzlebiges HMAC-Token fuer den ersten WSS-Join.

Request:

```bash
curl "https://realtime.digitalisierungsplanung.de/token?roomId=smoke&clientId=browser-1" \
  -H "Origin: https://digitalisierungsplanung.de"
```

Response:

```json
{
  "roomId": "smoke",
  "clientId": "browser-1",
  "token": "<signed-token>",
  "expiresInMs": 3600000
}
```

Fehler:

- `400 {"error":"invalid_room_or_client"}`
- `403 {"error":"origin_not_allowed"}`
- `503 {"error":"room_secret_required"}`

### `POST /emit`

Server-to-server Fire-Endpunkt. Er persistiert keine Payload und haelt keinen fachlichen Zustand. Er broadcastet nur eine Event-Instanz in den Room.

Request:

```bash
curl -X POST https://realtime.digitalisierungsplanung.de/emit \
  -H "Authorization: Bearer $REALTIME_EMIT_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "roomId": "smoke",
    "clientId": "sip-gateway",
    "name": "realtime.sip.call.incoming",
    "detail": {
      "caller": "+491234",
      "callee": "100",
      "callId": "abc-123"
    }
  }'
```

Response:

```json
{
  "ok": true,
  "roomId": "smoke",
  "name": "realtime.sip.call.incoming",
  "delivered": 1
}
```

`delivered` ist die Anzahl verbundener anderer Clients im Room. `0` ist kein Fehler, sondern bedeutet: aktuell hoert niemand in diesem Room.

Fehler:

- `400 {"error":"invalid_json"}`
- `400 {"error":"invalid_room"}`
- `400 {"error":"invalid_client"}`
- `400 {"error":"invalid_event_name"}`
- `400 {"error":"event_not_offered"}`
- `400 {"error":"invalid_detail"}`
- `401 {"error":"unauthorized"}`
- `403 {"error":"origin_not_allowed"}`
- `413 {"error":"payload_too_large"}`
- `503 {"error":"emit_secret_required"}`

## WebSocket API

Endpoint:

```text
wss://realtime.digitalisierungsplanung.de/ws
```

Der Browser muss mit erlaubtem `Origin` verbinden. In Production ist der erste Client-Frame immer ein `join`.

### Join

Client sendet:

```json
{
  "type": "join",
  "roomId": "smoke",
  "clientId": "browser-1",
  "token": "<token-from-/token>"
}
```

Server antwortet:

```json
{
  "type": "joined",
  "roomId": "smoke",
  "clientId": "browser-1",
  "rev": 0,
  "serverTime": 1780000000000
}
```

Andere Clients im selben Room bekommen:

```json
{
  "type": "peer.join",
  "roomId": "smoke",
  "clientId": "browser-1",
  "serverTime": 1780000000000
}
```

Beim Disconnect:

```json
{
  "type": "peer.leave",
  "roomId": "smoke",
  "clientId": "browser-1",
  "serverTime": 1780000000000
}
```

### Runtime Event

Client sendet:

```json
{
  "type": "runtime.event",
  "seq": 1,
  "name": "realtime.sip.call.incoming",
  "detail": {
    "caller": "+491234",
    "callee": "100",
    "callId": "abc-123"
  }
}
```

Andere Clients im selben Room bekommen:

```json
{
  "type": "runtime.event",
  "roomId": "smoke",
  "clientId": "browser-1",
  "serverTime": 1780000000000,
  "seq": 1,
  "name": "realtime.sip.call.incoming",
  "detail": {
    "caller": "+491234",
    "callee": "100",
    "callId": "abc-123"
  }
}
```

`seq` ist optional. Wenn vorhanden, droppt der Server alte oder doppelte Sequenzen pro `clientId` und Room.

### Presence Cursor

Transienter Cursor/Drag-Frame. Der Server darf ihn fuer langsame Peers droppen.

Client sendet:

```json
{
  "type": "presence.cursor",
  "seq": 2,
  "cursor": {
    "x": 120,
    "y": 80,
    "worldX": 920,
    "worldY": 460,
    "stateId": "start"
  }
}
```

Andere Clients bekommen denselben Frame mit `roomId`, `clientId` und `serverTime`.

### WebSocket Fehler

Fehler kommen als JSON:

```json
{
  "type": "error",
  "code": "invalid_token"
}
```

Wichtige Codes:

```text
join_required
invalid_room
invalid_client
room_secret_required
invalid_token
invalid_json
invalid_type
invalid_seq
invalid_cursor
invalid_event_name
invalid_detail
rate_limited
room_missing
invalid_message
client_replaced
```

Einige Fehler schliessen die Verbindung mit Policy-Code `1008` oder internem Code `4008` bei `client_replaced`.

## Integration in `state.html`

Aktivierung:

```text
https://digitalisierungsplanung.de/state.html?room=<room-id>
```

Flow:

```text
state.html
  -> GET /token
  -> WSS /ws
  -> join(roomId, clientId, token)
  -> runtime.event
  -> STATE_BLUEPRINT_REALTIME_EVENT
  -> globaler JSON-Bus
  -> Transitionen pruefen triggerType=realtime + triggerEvent=<name>
```

Der Runtime-Kontext bleibt read-only fuer den Host. Fachliche Daten werden erst in der generierten Runtime in den JSON-Bus geschrieben.

## Aktuelle Default-Events

Wenn kein `REALTIME_EVENT_CATALOG_PATH` gesetzt ist, bietet der Server diese Events an:

```text
realtime.sip.call.incoming
realtime.sip.call.answered
realtime.sip.call.ended
```

Die Live-Wahrheit ist immer `/events`, nicht diese Dokumentation.

## Konfiguration

Wichtige Env-Variablen:

```text
REALTIME_HOST=127.0.0.1
REALTIME_PORT=8788
REALTIME_PATH=/ws
REALTIME_TOKEN_PATH=/token
REALTIME_EVENTS_PATH=/events
REALTIME_EMIT_PATH=/emit
REALTIME_CONSOLE_PATH=/console.html
REALTIME_MARKETPLACE_HTML_PATH=/marketplace.html
REALTIME_MARKETPLACE_PATH=/marketplace
REALTIME_PRESETS_PATH=/presets
REALTIME_ENDPOINTS_PATH=/endpoints
REALTIME_STATE_SCHEMA_PATH=/state-schema
REALTIME_ALLOWED_ORIGINS=https://digitalisierungsplanung.de
REALTIME_ROOM_SECRET=<secret>
REALTIME_EMIT_SECRET=<secret>
REALTIME_ROOM_TOKEN_TTL_MS=3600000
REALTIME_EVENT_CATALOG_PATH=/path/to/catalog.json
REALTIME_RATE_LIMIT=360
REALTIME_RATE_WINDOW_MS=10000
REALTIME_MAX_PAYLOAD_BYTES=65536
```

## Externer SIP-Call als Beispiel

1. SIP-Anlage erkennt eingehenden Anruf.
2. SIP-Bridge ruft `/emit` auf:

```bash
curl -X POST https://realtime.digitalisierungsplanung.de/emit \
  -H "Authorization: Bearer $REALTIME_EMIT_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "roomId": "sales-floor",
    "clientId": "sip",
    "name": "realtime.sip.call.incoming",
    "detail": {
      "caller": "+491234",
      "callee": "100",
      "callId": "call-42"
    }
  }'
```

3. Ein geoeffneter Canvas in `state.html?room=sales-floor` empfaengt das Event.
4. Die Runtime schreibt:

```text
events.realtime.sip.call.incoming.detail
events.realtime.sip.call.incoming.count
events.realtime.sip.call.incoming.lastAt
lastEvent
```

5. Eine Transition mit diesen Daten kann feuern:

```text
triggerType: realtime
triggerEvent: realtime.sip.call.incoming
```
