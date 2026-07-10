# Realtime-API

Diese API gehört zum Realtime-Server unter `server/`. Sie transportiert Runtime-Ereignisse für `state.html`. Sie ist nicht die Modell-API und persistiert keinen fachlichen Zustand.

## Grundsatz

Der globale JSON-Zustands-/Ereignisbus bleibt die einzige fachliche Wahrheit. Der Realtime-Server hat nur diese Aufgaben:

- WSS-Transport für Runtime-Ereignisse,
- Ereigniskatalog für erlaubte `realtime.*`-Ereignisse,
- zustandsloser Sende-Endpunkt für externe Systeme,
- Browser-Testkonsole für manuelles Emitten.

Der Realtime-Server liefert nur diesen Kern. Die Arbeitsfläche speichert nur konkrete Referenzen, die sie wirklich verwendet, zum Beispiel `triggerEvent: "realtime.sip.call.incoming"`.

## Basis-URLs

```text
HTTPS base: https://realtime.digitalisierungsplanung.de
WSS base:   wss://realtime.digitalisierungsplanung.de/ws
```

Lokaler Prozess hinter Nginx:

```text
http://127.0.0.1:8788
```

## Ursprung und Authentifizierung

Browser-Origin ist in Produktion auf `https://digitalisierungsplanung.de` begrenzt. Konfiguriert wird das über `REALTIME_ALLOWED_ORIGINS`.

`/events` erlaubt:

- Anfragen ohne `Origin`, z.B. `curl` oder Server-zu-Server,
- Anfragen mit erlaubtem `Origin`,
- `OPTIONS` für Browser-Preflight.

`/token` braucht einen erlaubten Browser-Origin und `REALTIME_ROOM_SECRET`.

`/emit` braucht:

```http
Authorization: Bearer <REALTIME_EMIT_SECRET>
Content-Type: application/json
```

Server-zu-Server-`/emit` darf ohne `Origin` kommen. Browser-Anfragen mit fremdem Origin werden abgelehnt.

## Namensregeln

IDs dürfen nur diese Zeichen enthalten:

```text
a-z A-Z 0-9 _ . : -
```

Limits:

- `roomId`, `clientId`: maximal 128 Zeichen
- Ereignisnamen: maximal 160 Zeichen
- Zustandspfade in Ereignisdetails/Bindings: maximal 240 Zeichen
- Anfrage-Body: standardmäßig maximal 64 KiB

Realtime-Ereignisse im App-Vertrag beginnen mit:

```text
realtime.
```

`/emit` und WSS-`runtime.event` akzeptieren nur Ereignisse, die im aktuellen `/events`-Katalog angeboten werden.

## REST-Endpunkte

### `GET /healthz`

Öffentlicher Healthcheck ohne Auth.

Antwort:

```json
{
  "ok": true,
  "rooms": 0,
  "clients": 0
}
```

### `GET /console.html`

HTML-Testkonsole für `/emit`. Die Seite speichert serverseitig nichts. Das Emit-Secret wird nur im Browserfeld verwendet und als Bearer-Token an `/emit` gesendet.

### `GET /events`

Ereignisdefinitionen. Das ist die Live-Quelle für auswählbare Realtime-Ereignisse im Editor.

Antwort:

```json
{
  "events": [
    {
      "name": "realtime.sip.call.incoming",
      "label": "Eingehender Anruf",
      "description": "SIP-Anruf gestartet",
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

- `name`: Ereignis-ID, muss mit `realtime.` beginnen.
- `label`: Anzeige im Editor.
- `description`: optionale Beschreibung.
- `detail`: erwartete Payload-Felder und Typen.
- `bindings`: Mapping von `detail.*` in den globalen JSON-Zustand.

Unterstützte Typen:

```text
text, email, password, number, boolean, url, image, object, list
```

### `GET /token?roomId=<room>&clientId=<client>`

Erzeugt ein kurzlebiges HMAC-Token für den ersten WSS-Join.

Anfrage:

```bash
curl "https://realtime.digitalisierungsplanung.de/token?roomId=smoke&clientId=browser-1" \
  -H "Origin: https://digitalisierungsplanung.de"
```

Antwort:

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

Server-zu-Server-Sende-Endpunkt. Er persistiert keine Payload und hält keinen fachlichen Zustand. Er sendet nur eine Ereignisinstanz in den Raum.

Anfrage:

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

Antwort:

```json
{
  "ok": true,
  "roomId": "smoke",
  "name": "realtime.sip.call.incoming",
  "delivered": 1
}
```

`delivered` ist die Anzahl verbundener anderer Clients im Raum. `0` ist kein Fehler, sondern bedeutet: aktuell hört niemand in diesem Raum.

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

## WebSocket-API

Endpunkt:

```text
wss://realtime.digitalisierungsplanung.de/ws
```

Der Browser muss mit erlaubtem `Origin` verbinden. In Produktion ist die erste Client-Nachricht immer ein `join`.

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

Andere Clients im selben Raum bekommen:

```json
{
  "type": "peer.join",
  "roomId": "smoke",
  "clientId": "browser-1",
  "serverTime": 1780000000000
}
```

Beim Trennen der Verbindung:

```json
{
  "type": "peer.leave",
  "roomId": "smoke",
  "clientId": "browser-1",
  "serverTime": 1780000000000
}
```

### Runtime-Ereignis

Client sendet ein Ereignis, das im aktuellen `/events`-Katalog angeboten wird:

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

Andere Clients im selben Raum bekommen dasselbe Ereignis mit `roomId`, `clientId`, `serverTime`, optionaler `seq`, `name` und `detail`.

`seq` ist optional. Wenn vorhanden, verwirft der Server alte oder doppelte Sequenzen pro `clientId` und Raum.

### Präsenz-Cursor

Flüchtiger Cursor-/Drag-Frame. Der Server darf ihn für langsame Empfänger verwerfen.

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
event_not_offered
invalid_detail
rate_limited
room_missing
invalid_message
client_replaced
```

Einige Fehler schließen die Verbindung mit Policy-Code `1008` oder internem Code `4008` bei `client_replaced`.

## Integration in `state.html`

Aktivierung:

```text
https://digitalisierungsplanung.de/state.html?room=<room-id>
```

Ablauf:

```text
state.html
  -> GET /token
  -> WSS /ws
  -> join(roomId, clientId, token)
  -> runtime.event
  -> STATE_BLUEPRINT_REALTIME_EVENT
  -> globaler JSON-Bus
  -> Übergänge prüfen triggerType=realtime + triggerEvent=<name>
```

Der Runtime-Kontext bleibt für den Host nur lesend. Fachliche Daten werden erst in der generierten Runtime in den JSON-Bus geschrieben.

## Aktuelle Standard-Ereignisse

Wenn kein `REALTIME_EVENT_CATALOG_PATH` gesetzt ist, bietet der Server diese Ereignisse an:

```text
realtime.sip.call.incoming
realtime.sip.call.answered
realtime.sip.call.ended
```

Die Laufzeit-Wahrheit ist immer `/events`, nicht diese Dokumentation.

## Konfiguration

Wichtige Umgebungsvariablen:

```text
REALTIME_HOST=127.0.0.1
REALTIME_PORT=8788
REALTIME_PATH=/ws
REALTIME_TOKEN_PATH=/token
REALTIME_EVENTS_PATH=/events
REALTIME_EMIT_PATH=/emit
REALTIME_CONSOLE_PATH=/console.html
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
2. SIP-Bridge ruft `/emit` auf.
3. Eine geöffnete Arbeitsfläche in `state.html?room=sales-floor` empfängt das Ereignis.
4. Die Runtime schreibt:

```text
events.realtime.sip.call.incoming.detail
events.realtime.sip.call.incoming.count
events.realtime.sip.call.incoming.lastAt
lastEvent
```

5. Ein Übergang mit diesen Daten kann feuern:

```text
triggerType: realtime
triggerEvent: realtime.sip.call.incoming
```
