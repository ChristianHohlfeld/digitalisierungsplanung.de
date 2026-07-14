# Realtime-API

Diese API gehört zum Realtime-Server unter `server/`. Sie transportiert Runtime-Ereignisse für `state.html`. Sie ist nicht die Modell-API und persistiert keinen fachlichen Zustand.

## Grundsatz

Der globale JSON-Zustands-/Ereignisbus bleibt die einzige fachliche Wahrheit. Der Realtime-Server hat nur diese Aufgaben:

- WSS-Transport für Runtime-Ereignisse,
- Ereigniskatalog für erlaubte `realtime.*`-Ereignisse,
- Connector-Katalog für echte Ereignisquellen,
- zustandsloser Sende-Endpunkt für externe Systeme,
- Browser-Testkonsole für manuelles Emitten,
- Admin-Designer für Katalogänderungen per Git,
- zustandslose Analyse explizit freigegebener Browser-Prozessaufnahmen für den Editor.

Zusätzlich veröffentlicht der Server lesend die gemeinsame
Frontend-/Backend-Release-ID. Er besitzt dafür keinen zweiten Versionszähler.

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

`/contract`, `/events` und `/events/contract` erlauben:

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

`/emit` und WSS-`runtime.event` akzeptieren nur Ereignisse, die im aktuellen `/events`-Katalog angeboten werden. `/emit` braucht zusätzlich eine angebotene `emitterId`; diese Quelle muss für das konkrete Ereignis freigeschaltet sein.

Der harte Dataset-Contract kommt aus `server/event-catalog.json` und wird unter
`/contract` als Product Contract ausgeliefert. Neue Event-Namen oder
Detail-Felder entstehen nur über diesen Server-Contract: als `realtime.*`-Key
mit festen Datentypen. Exakte ID-Kollisionen und Parent/Child-Pfadkollisionen
im globalen State Tree werden serverseitig abgelehnt.

## REST-Endpunkte

### `GET /healthz`

Öffentlicher Healthcheck ohne Auth.

Antwort:

```json
{
  "ok": true,
  "releaseId": "release-59",
  "releaseSequence": 59,
  "builtAt": "2026-07-12T00:00:00Z",
  "sourceCommit": "1234567890abcdef",
  "deployedCommit": "abcdef1234567890",
  "rooms": 0,
  "clients": 0
}
```

### `GET /version`

Liefert mit `Cache-Control: no-store` dieselbe kanonische Release-ID, die das
statische Frontend aus `release-version.js` veröffentlicht und mit der der
Backend-Prozess gestartet wurde. Es gibt keinen Service Worker und keinen
Browser-, Proxy- oder Servercache für diese Antwort.

```json
{
  "ok": true,
  "releaseId": "release-59",
  "releaseSequence": 59,
  "builtAt": "2026-07-12T00:00:00Z",
  "sourceCommit": "1234567890abcdef",
  "deployedCommit": "abcdef1234567890"
}
```

`sourceCommit` ist der durch die vollständigen CI-Verträge freigegebene
Quellcommit. `deployedCommit` ist der auf dem Server ausgecheckte
Release-Commit.

### `GET /console.html`

HTML-Testkonsole für `/emit`. Die Seite speichert serverseitig nichts. Das
Emit-Secret wird lokal im Browser-`localStorage` gespeichert und als
Bearer-Token an `/emit` gesendet.

### `GET /events-admin.html`

Einfacher Designer für `server/event-catalog.json`. Er folgt dem Canvas-Vertrag:
Event-Type, Dataset-Key, Felder, Quelle. Der globale State-Beitrag wird aus
Datensatz und Quelle abgeleitet. Das Admin-Secret wird lokal im
Browser-`localStorage` gespeichert und nur als Bearer-Token an die Admin-API
gesendet.

### `GET/POST /events-admin/catalog`

Secret-geschützte Admin-API für den Designer.

- Auth: `Authorization: Bearer <REALTIME_ADMIN_SECRET>`
- `GET`: lädt den Katalog aus `server/event-catalog.json`
- `POST`: validiert, schreibt, committet und pusht den Katalog zusammen mit `release-version.js`
- `POST ?validate=1` oder Body `{ "validateOnly": true }`: validiert ohne Git-Schreibvorgang

Die UI braucht diese Admin-API nur für sicheren Load und Save. Lesen kann sie
den Product Contract über `/contract` und den Live-Katalog über `/events`.
Es gibt kein Pinning alter Contract-Versionen; die Release-ID ist
Nachvollziehbarkeit, nicht Laufzeit-Auswahl.

Der Save-Pfad nutzt Git. Falls der Server-Checkout nicht mit seinen vorhandenen
Remote-Credentials pushen kann, muss `REALTIME_GIT_PUSH_TOKEN` gesetzt sein.

### `GET /events`

Ereignisdefinitionen. Das ist die Live-Quelle für auswählbare Realtime-Ereignisse im Editor. Die Antwort enthält auch die aktuelle gemeinsame Release-Metainfo.

### `GET /contract`

Zentraler Product Contract für `state.html` und den Event Designer. Dieser
Endpoint ist die frische Server-Wahrheit für vordefinierte Contract-Teile:
Trigger-Typen, Value-Types mit Constraints, Realtime-Datasets, Connector-Quellen,
Presets und State-Contribution-Pfade. Jedes Feld, das vom Contract in den
globalen JSON-State geschrieben werden kann, hat neben dem kompakten Typstring
ein `fieldSchemas`-Objekt mit `type`, `jsonType`, `default` und harten
`constraints`.

Die App darf daraus UI-Optionen rendern und konkrete Referenzen speichern, aber
keine Contract-Kopie in den Canvas schreiben.

Antwort, gekürzt:

```json
{
  "schemaVersion": 1,
  "provider": {
    "id": "digitalisierungsplanung.realtime",
    "label": "Digitalisierungsplanung Realtime"
  },
  "valueTypes": [
    {
      "id": "text",
      "label": "Text",
      "jsonType": "string",
      "default": "",
      "constraints": { "minLength": 0, "maxLength": 20000 }
    }
  ],
  "triggerTypes": [
    {
      "id": "realtime",
      "label": "Realtime-Ereignis",
      "settings": {},
      "events": [
        {
          "name": "realtime.sip.call.incoming",
          "detail": { "caller": "text", "callee": "text", "callId": "text" },
          "detailSchemas": {
            "caller": {
              "type": "text",
              "jsonType": "string",
              "default": "",
              "constraints": { "minLength": 0, "maxLength": 20000 }
            }
          }
        }
      ]
    }
  ],
  "datasets": [
    {
      "id": "realtime.sip.call.incoming",
      "type": "realtime",
      "key": "sip.call.incoming",
      "fields": { "caller": "text", "callee": "text", "callId": "text" },
      "fieldSchemas": {
        "caller": {
          "type": "text",
          "jsonType": "string",
          "default": "",
          "constraints": { "minLength": 0, "maxLength": 20000 }
        }
      }
    }
  ],
  "connectors": [],
  "presets": [
    {
      "id": "builtin_daisy_button",
      "title": "Aktionsbutton",
      "rootStateId": "button",
      "data": { "label": "Weiter", "clicked": false, "clickedAt": 0 },
      "dataTypes": { "label": "text", "clicked": "boolean", "clickedAt": "number" },
      "stateContribution": {
        "root": "states.button",
        "fieldSchemas": {
          "states.button.clicked": {
            "type": "boolean",
            "jsonType": "boolean",
            "default": false,
            "constraints": { "enum": [true, false] }
          }
        }
      }
    }
  ],
  "stateContributions": [
    {
      "id": "realtime.sip.call.incoming",
      "source": "event",
      "root": "events.realtime.sip.call.incoming",
      "fields": ["events.realtime.sip.call.incoming.detail.caller"],
      "fieldTypes": {
        "events.realtime.sip.call.incoming.detail.caller": "text"
      },
      "fieldSchemas": {
        "events.realtime.sip.call.incoming.detail.caller": {
          "type": "text",
          "jsonType": "string",
          "default": "",
          "constraints": { "minLength": 0, "maxLength": 20000 }
        }
      }
    }
  ]
}
```

### `GET /events/contract`

Niedriger Realtime-Katalog-Contract: Event-Keys, feste Detail-Datentypen,
Emitter und abgeleitete State-Contribution-Pfade. Neue Frontend-Verbraucher
sollten `/contract` verwenden; die Autorität für Kollisionsfreiheit und
Uniqueness bleibt `validateEventCatalog` auf dem Server.

Antwort:

```json
{
  "provider": {
    "id": "digitalisierungsplanung.realtime",
    "label": "Digitalisierungsplanung Realtime"
  },
  "state": {
    "path": "realtime",
    "schema": {
      "roomId": "text",
      "clientId": "text",
      "status": "text",
      "connected": "boolean",
      "joined": "boolean",
      "connecting": "boolean",
      "reconnectAttempt": "number",
      "error": "text"
    }
  },
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
      "bindings": [],
      "contributes": {
        "root": "events.realtime.sip.call.incoming",
        "fields": [
          "events.realtime.sip.call.incoming.count",
          "events.realtime.sip.call.incoming.lastAt",
          "events.realtime.sip.call.incoming.detail",
          "events.realtime.sip.call.incoming.detail.caller",
          "events.realtime.sip.call.incoming.detail.callee",
          "events.realtime.sip.call.incoming.detail.callId"
        ]
      }
    }
  ],
  "emitters": [
    {
      "id": "sip.threecx",
      "type": "sip",
      "label": "3CX / SIP phone system",
      "description": "Business phone bridge for real call events",
      "endpoint": "POST /emit",
      "events": [
        "realtime.sip.call.incoming"
      ],
      "contributes": {
        "root": "emitters.sip.threecx",
        "fields": [
          "emitters.sip.threecx.count",
          "emitters.sip.threecx.lastAt",
          "emitters.sip.threecx.lastEvent",
          "emitters.sip.threecx.lastDetail",
          "emitters.sip.threecx.status",
          "emitters.sip.threecx.error"
        ]
      }
    }
  ],
  "release": {
    "ok": true,
    "releaseId": "release-74",
    "releaseSequence": 74,
    "builtAt": "2026-07-13T12:30:00Z",
    "sourceCommit": "abc1234",
    "deployedCommit": "def5678"
  }
}
```

Felder:

- `name`: Ereignis-ID, muss mit `realtime.` beginnen.
- `label`: Anzeige im Editor.
- `description`: optionale Beschreibung.
- `detail`: erwartete Payload-Felder und Typen.
- `bindings`: Optionales Mapping von `detail.*` auf einen vollständig
  qualifizierten, im Modell deklarierten Pfad `states.<id>.<feld>`. Andere
  Ziele werden verworfen. Die Standardereignisse besitzen keine Bindings.
- `emitters`: echte Connector-Quellen. Eine Quelle darf nur die in `events`
  gelisteten Ereignisse feuern.
- `contributes`: abgeleiteter State-Beitrag im globalen JSON-Bus. Der Canvas
  speichert diese Metadaten nicht als Kopie.
- `release`: aktuelle gemeinsame Release-Metainfo für Audit und Zuordnung. Die
  Runtime wählt keine alten Versionen aus.

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
    "emitterId": "sip.threecx",
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
- `400 {"error":"invalid_emitter"}`
- `400 {"error":"emitter_not_offered"}`
- `400 {"error":"emitter_event_not_allowed"}`
- `400 {"error":"invalid_detail"}`
- `400 {"error":"missing_detail_field"}`
- `400 {"error":"unknown_detail_field"}`
- `400 {"error":"invalid_detail_type"}`
- `400 {"error":"invalid_detail_value"}`
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
  "serverTime": 1780000000000
}
```

Join und Verbindungsende werden nicht als Peer-Präsenz an andere Clients
gesendet. Der Transport besitzt keine Presence-Oberfläche.

### Runtime-Ereignis

Client sendet ein Ereignis, das im aktuellen `/events`-Katalog angeboten wird:

```json
{
  "type": "runtime.event",
  "seq": 1,
  "name": "realtime.sip.call.incoming",
  "emitterId": "sip.threecx",
  "detail": {
    "caller": "+491234",
    "callee": "100",
    "callId": "abc-123"
  }
}
```

Andere Clients im selben Raum bekommen dasselbe Ereignis mit `roomId`,
`clientId`, `serverTime`, optionaler `seq`, `name`, `detail`, `emitterId`,
`event` und `emitter`.
`event` ist die vom Server normalisierte aktuelle Katalogdefinition für genau
diesen Namen. Dadurch kann die Runtime Bindings anwenden und den Übergang
auslösen, ohne beim Empfang nochmals von einem erfolgreichen `/events`-Abruf
abhängig zu sein.

`seq` ist optional. Wenn vorhanden, verwirft der Server alte oder doppelte Sequenzen pro `clientId` und Raum.

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
invalid_emitter
emitter_not_offered
emitter_event_not_allowed
invalid_detail
missing_detail_field
unknown_detail_field
invalid_detail_type
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
generierte Runtime in Preview oder Standalone
  -> GET /token
  -> WSS /ws
  -> join(roomId, clientId, token)
  -> runtime.event
  -> globaler JSON-Bus
  -> Übergänge prüfen triggerType=realtime + triggerEvent=<name>
```

Die Runtime besitzt den Transport direkt. Der Editor-Host leitet keine
Realtime-Ereignisse weiter und verarbeitet Runtime-Meldungen ausschließlich
als UI-Ereignisse, ohne Businhalt zu speichern.
Standalone verwendet denselben Transport ohne Host-Brücke.

## Aktuelle Standard-Ereignisse und Connectoren

Der Default-Katalog liegt in `server/event-catalog.json`. Wenn
`REALTIME_EVENT_CATALOG_PATH` nicht gesetzt ist, nutzt der Server diese Datei.
Aktuelle Standardereignisse:

```text
realtime.sip.call.incoming
realtime.sip.call.answered
realtime.sip.call.ended
realtime.mail.received
realtime.endpoint.updated
realtime.data.updated
```

Aktuelle Standardconnectoren:

```text
sip.threecx       3CX / SIP phone system
mail.gmail        Gmail inbox
mail.outlook      Outlook inbox
webhook.endpoint  Generic webhook bridge
data.source       External data source bridge
```

Einrichtung ist absichtlich einheitlich: Der echte Dienst oder eine kleine
Bridge postet den Designer-Payload an `/emit`. 3CX nutzt dafür eine
Telefonanlagen-Webhook-/Call-Flow-Bridge, Gmail eine Google-Workspace- oder
Mail-Bridge, Outlook eine Microsoft-Automation oder Graph/Mail-Bridge. Der
Realtime-Server selbst pollt keine Mailboxen und betreibt keinen SIP-Stack.

Die Laufzeit-Wahrheit ist immer `/events`, nicht diese Dokumentation.

## Konfiguration

Wichtige Umgebungsvariablen:

```text
REALTIME_HOST=127.0.0.1
REALTIME_PORT=8788
REALTIME_PATH=/ws
REALTIME_TOKEN_PATH=/token
REALTIME_PRODUCT_CONTRACT_PATH=/contract
REALTIME_EVENTS_PATH=/events
REALTIME_EVENTS_CONTRACT_PATH=/events/contract
REALTIME_EMIT_PATH=/emit
REALTIME_CONSOLE_PATH=/console.html
REALTIME_EVENTS_ADMIN_PATH=/events-admin.html
REALTIME_EVENTS_ADMIN_CATALOG_PATH=/events-admin/catalog
REALTIME_ALLOWED_ORIGINS=https://digitalisierungsplanung.de
REALTIME_ROOM_SECRET=<secret>
REALTIME_EMIT_SECRET=<secret>
REALTIME_ADMIN_SECRET=<secret>
REALTIME_GIT_PUSH_TOKEN=<optional-github-token>
REALTIME_ROOM_TOKEN_TTL_MS=3600000
REALTIME_EVENT_CATALOG_PATH=/path/to/catalog.json
REALTIME_REPO_DIR=/path/to/repo
REALTIME_RATE_LIMIT=360
REALTIME_RATE_WINDOW_MS=10000
REALTIME_MAX_PAYLOAD_BYTES=65536
PROCESS_RECORDER_CONTRACT_PATH=/process/contract
PROCESS_RECORDER_ANALYZE_PATH=/process/analyze
PROCESS_RECORDER_MAX_PAYLOAD_BYTES=8388608
PROCESS_RECORDER_MAX_CONCURRENT=4
PROCESS_RECORDER_TIMEOUT_MS=90000
PROCESS_RECORDER_OPENAI_API_KEY=<optional-server-secret>
PROCESS_RECORDER_MODEL=gpt-5.6-luna
PROCESS_RECORDER_ANALYZER_URL=<optional-custom-agent-url>
PROCESS_RECORDER_ANALYZER_TOKEN=<optional-server-secret>
```

## Browser-Prozessaufnahme

`GET /process/contract` meldet, ob ein Agent konfiguriert ist, und veröffentlicht
nur nicht geheime Grenzen. `POST /process/analyze` akzeptiert höchstens 4000
neutrale `visual`-Ereignisse und 36 zeitlich ausgedünnte
JPEG-Kontextbilder stabiler Änderungen aus der ausdrücklich freigegebenen
Browseroberfläche. Es gibt keinen lokalen Begleiter und keine nativen Hooks.
Die Kontextbilder können alle sichtbaren Inhalte der gewählten Oberfläche
enthalten; personenbezogene Werte dürfen nicht in die Prozessdefinition
übernommen werden.

Der veröffentlichte Vertrag begrenzt eine Sitzung auf zwölf Live-Analysen mit
mindestens 15 Sekunden Abstand. Nach fünf Sekunden ohne relevante Änderung
pausieren neue Ereignisse, Kontextbilder und Agentenaufrufe automatisch. Ein
abschließender Lauf bei Stop ist nur erlaubt, wenn seit der letzten Analyse
neue stabile Zustände hinzugekommen sind.

Der Endpunkt führt keine Session und persistiert weder Eingabe noch Ergebnis.
Er gibt ausschließlich ein vollständiges, vom gemeinsamen MCP-Core validiertes
Modell zurück. OpenAI-Anfragen setzen `store: false` und strukturiertes JSON;
ein eigener Agent darf nur die Prozessspur liefern. IDs, Layout, Transitionen
und Trigger werden immer deterministisch auf dem Zustand-Server erzeugt.

## Externer SIP-Call als Beispiel

1. SIP-Anlage erkennt eingehenden Anruf.
2. SIP-Bridge ruft `/emit` auf.
3. Eine geöffnete Arbeitsfläche in `state.html?room=sales-floor` empfängt das Ereignis.
4. Die Runtime schreibt:

```text
events.realtime.sip.call.incoming.detail
events.realtime.sip.call.incoming.count
events.realtime.sip.call.incoming.lastAt
emitters.sip.threecx.lastEvent
emitters.sip.threecx.count
emitters.sip.threecx.lastAt
lastEvent
```

5. Ein Übergang mit diesen Daten kann feuern:

```text
triggerType: realtime
triggerEvent: realtime.sip.call.incoming
```
