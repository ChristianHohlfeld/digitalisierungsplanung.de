# Realtime-API

Diese API gehört zum Realtime-Server unter `server/`. Sie transportiert Runtime-Ereignisse für `state.html`. Sie ist nicht die Modell-API und persistiert keinen fachlichen Zustand.

## Grundsatz

Der globale JSON-Zustands-/Ereignisbus bleibt die einzige fachliche Wahrheit. Der Realtime-Server hat nur diese Aufgaben:

- WSS-Transport für Runtime-Ereignisse,
- Ereigniskatalog für erlaubte `realtime.*`-Ereignisse,
- Connector-Katalog für echte Ereignisquellen,
- zustandsloser Sende-Endpunkt für externe Systeme,
- Browser-Testkonsole für manuelles Emitten,
- Admin-Designer für Katalogänderungen per Git.

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

`/contract` und `/events` erlauben:

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

Beispielantwort; die Werte kommen immer aus der aktuellen
[`release-version.js`](../release-version.js):

```json
{
  "ok": true,
  "releaseId": "release-123",
  "releaseSequence": 123,
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
  "releaseId": "release-123",
  "releaseSequence": 123,
  "builtAt": "2026-07-12T00:00:00Z",
  "sourceCommit": "1234567890abcdef",
  "deployedCommit": "abcdef1234567890"
}
```

`sourceCommit` ist der durch die vollständigen CI-Verträge freigegebene
Quellcommit. `deployedCommit` ist der auf dem Server ausgecheckte
Release-Commit.

### `GET /` und `GET /admin.html`

Zentraler Admin-Hub für die menschlichen Server-Werkzeuge: Event Designer,
Preset Designer, Event Console, Product Contract und Systemstatus. Die Seite
hält keine eigene Routenliste, sondern rendert den JSON-Index aus
`/admin/routes`.

### `GET /admin/routes`

Öffentlicher, nicht persistierender JSON-Index der sichtbaren Realtime-Tools
und technischen Endpunkte. Dieser Index ist nur Navigation und Server-Doku; er
ist nicht Teil des Canvas-/Produkt-Contracts. `state.html` konsumiert weiterhin
`/contract`.

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
- `POST`: validiert und committet ausschließlich den Katalog; der Commit wird
  auf einen eindeutigen `admin/events-*`-Review-Branch gepusht. Die Antwort
  enthält `reviewRequired: true` und `branch`.
- `POST ?validate=1` oder Body `{ "validateOnly": true }`: validiert ohne Git-Schreibvorgang

Die UI braucht diese Admin-API nur für sicheren Load und einen Review-Entwurf. Lesen kann sie
den Product Contract über `/contract` und den Live-Katalog über `/events`.
Es gibt kein Pinning alter Contract-Versionen; die Release-ID ist
Nachvollziehbarkeit, nicht Laufzeit-Auswahl.

Der Save-Pfad nutzt Git, verändert aber weder `release-version.js` noch
`origin/main`. Der Review-Branch muss als PR geprüft, durch die vollständige CI
geführt und danach über den manuellen Release veröffentlicht werden. Falls der
Server-Checkout nicht mit seinen vorhandenen Remote-Credentials pushen kann,
muss `REALTIME_GIT_PUSH_TOKEN` gesetzt sein.

### `GET /presets-admin.html`

Verwaltungsoberfläche für DaisyUI-v5.6.18-Snippets, Preset-Kategorien,
kommerzielle Pakete und verwaltete Presets. Das Admin-Secret wird wie beim
Event Designer nur im lokalen Browser gespeichert und ausschließlich als
Bearer-Token an die beiden Admin-Endpunkte gesendet.

### `POST /presets-admin/parse`

Secret-geschützte, nicht persistierende Übersetzung eines DaisyUI-Snippets in
eine Preset-Definition.

```json
{
  "snippet": "<footer class=\"footer sm:footer-horizontal\">...</footer>",
  "title": "Portal-Fußzeile",
  "categoryId": "portal",
  "packageIds": ["portal.pro"]
}
```

Die Antwort enthält nur `id`, `variant`, `title`, `description`, `categoryId`,
`packageIds` und strukturierte `data`. Rohes HTML wird nicht zurückgegeben oder
gespeichert. Aktive Elemente, eingebettete Dokumente, Metadaten, Templates und
`on*`-Attribute werden abgelehnt. Nicht unterstützte oder mehrdeutige
Komponenten liefern einen 400-Fehler.

### `POST /presets-admin/import`

Secret-geschützter, nicht persistierender API-Import. Der Server ruft die
angegebene öffentliche HTTPS-URL per `GET` ab. Die JSON-Antwort muss exakt die
kanonischen Felder `id`, `variant`, `title`, `description`, `categoryId`,
`packageIds` und `data` enthalten. Der Request enthält `url` und die aktuell
vollständig zu validierende `library`.

Private, lokale und reservierte Ziele, Redirects, Nicht-JSON-Antworten,
Antworten über 64 KiB und Abrufe über acht Sekunden werden abgelehnt. Header
oder Zugangsdaten können nicht mitgegeben werden. URL und Rohantwort werden
nicht gespeichert; Persistenz erfolgt nur über `/presets-admin/catalog`.

### `GET/POST /presets-admin/catalog`

Secret-geschützte API für die vollständige `server/preset-library.json`.

- Auth: `Authorization: Bearer <REALTIME_ADMIN_SECRET>`
- `GET`: lädt Kategorien, Pakete und verwaltete Presets.
- `POST`: validiert die gesamte Library, committet ausschließlich
  `server/preset-library.json` und pusht einen eindeutigen
  `admin/presets-*`-Review-Branch. Die Antwort enthält `reviewRequired: true`
  und `branch`.
- `POST ?validate=1` oder Body `{ "validateOnly": true }`: validiert ohne
  Schreib- oder Git-Vorgang.

`websuite-builder` und die acht Produktpakete sind erforderliche geschützte
Einträge. Weitere Kategorien und Pakete dürfen ergänzt werden. Parsen allein
ändert weder Library noch Product Contract. Ein Save erzeugt einen
Review-Branch; dauerhaft produktiv wird der Stand erst nach Review, Merge,
vollständiger CI und manuellem Release.

### `POST /assets/inline-image`

Zustandsloser Exporthelfer für eigenständige HTML-Dateien. Der Body enthält
ausschließlich `{ "url": "https://..." }`. Der Server akzeptiert nur öffentliche
HTTP(S)-Bildziele, folgt keinen Redirects und lehnt private Netze, Nicht-Bilder
und zu große Antworten ab. Die Antwort enthält die ursprüngliche URL,
MIME-Type, Bytezahl und `dataUri`; weder URL noch Bild werden gespeichert.
Schlägt das Inlining fehl, behält der Export den ursprünglichen Bildwert.
Bereits im Editor hochgeladene Bilder liegen als kanonische Data-URI vor und
benötigen diesen Endpunkt nicht.

### `GET /events`

Ereignisdefinitionen. Das ist die Live-Quelle für auswählbare Realtime-Ereignisse im Editor. Die Antwort enthält auch die aktuelle gemeinsame Release-Metainfo.

### `GET /contract`

Zentraler Product Contract für `state.html` und den Event Designer. Dieser
Endpoint ist die frische Server-Wahrheit für vordefinierte Contract-Teile:
Trigger-Typen, Value-Types mit Constraints, Realtime-Datasets, Connector-Quellen,
Match-Operatoren, Preset-Typen mit Varianten, Preset-Kategorien, Presets,
Preset-Pakete, das Managed-Pilot-Angebot und State-Contribution-Pfade. Jedes Feld, das vom Contract in den
globalen JSON-State geschrieben werden kann, hat neben dem kompakten Typstring
ein `fieldSchemas`-Objekt mit `type`, `jsonType`, `default` und harten
`constraints`.

Der Event-Katalog deklariert `matchFields` explizit. Der Product Contract
liefert dazu `matchOperators` mit stabiler ID, Anzeige, erlaubten Feldtypen und
strikter Operandenform. Jedes `matchFieldSchemas.<field>` enthält zusätzlich
genau die dort erlaubten Operator-IDs. Consumer dürfen weder Match-Felder aus
`detail` noch Operatoren aus `type` ableiten.

Die App darf daraus UI-Optionen rendern und konkrete Referenzen speichern, aber
keine Contract-Kopie in den Canvas schreiben.

`presetTypes` definiert die serverseitig gültigen Preset- und Component-Typen.
`state.html` darf daraus UI-Optionen ableiten, aber keine eigene Variantenliste
als Produktwahrheit führen. `presetCategories` steuert ausschließlich die sichtbaren Gruppen im Editor.
Initial enthält sie nur `websuite-builder`; alle mitgelieferten Presets gehören
zu dieser Kategorie. `presetPackages` gruppiert technische Fähigkeiten;
`pilotOffers` beschreibt den kommerziellen Managed-Pilot-Rahmen.
`subscriptionPlans` bleibt in V1 als leeres Kompatibilitätsfeld erhalten.
Keine dieser Metadaten entscheidet lokal im Canvas über Verhalten oder
Benutzerrechte. Ein Preset bleibt
contract-konform, weil sein fachlicher Beitrag ausschließlich über
`stateContribution` im globalen State landet. Berechtigungen kommen
ausschließlich aus einer authentifizierten Mandanten- und Rollenquelle.

Antwort, gekürzt:

```json
{
  "schemaVersion": 2,
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
  "matchOperators": [
    {
      "id": "equals",
      "label": "Ist gleich",
      "fieldTypes": ["text", "email", "number", "boolean", "url", "image"],
      "operand": { "kind": "field-value", "schemaSource": "matchFieldSchemas.<field>" }
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
          },
          "matchFields": ["caller", "callee", "callId"],
          "matchFieldSchemas": {
            "caller": {
              "type": "text",
              "jsonType": "string",
              "default": "",
              "constraints": { "minLength": 0, "maxLength": 20000 },
              "operators": ["equals"]
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
  "presetTypes": [
    {
      "id": "component",
      "label": "Basis-Bausteine",
      "variants": [
        { "id": "heading", "label": "Überschrift" },
        { "id": "text", "label": "Text" },
        { "id": "image", "label": "Bild" }
      ]
    },
    {
      "id": "daisy",
      "label": "DaisyUI",
      "daisyVersion": "5.6.18",
      "variants": [
        { "id": "button", "label": "Button" },
        { "id": "chart", "label": "Chart" }
      ]
    }
  ],
  "presetCategories": [
    {
      "id": "websuite-builder",
      "label": "Websuite Builder",
      "sort": 10
    }
  ],
  "presetPackages": [
    {
      "id": "website.builder",
      "label": "Website Builder",
      "category": "package",
      "includedInPlanIds": [],
      "presetIds": ["builtin_daisy_hero", "builtin_daisy_pricing", "builtin_daisy_export_image_asset"],
      "presetCount": 3
    },
    {
      "id": "bi.analytics",
      "label": "BI & Analyse",
      "category": "addon",
      "upsell": true,
      "includedInPlanIds": [],
      "presetIds": ["builtin_daisy_bi_kpi_board"],
      "presetCount": 1
    }
  ],
  "pilotOffers": [
    {
      "id": "managed-pilot-v1",
      "label": "Managed Pilot",
      "price": "2.500–7.500 €",
      "billing": "one-time",
      "duration": "6–12 Wochen",
      "scope": ["1 abgegrenzter Prozess", "Klickbare Prozess-App", "Gemeinsame Abnahme"]
    }
  ],
  "subscriptionPlans": [],
  "presets": [
    {
      "id": "builtin_daisy_button",
      "title": "Aktionsbutton",
      "rootStateId": "button",
      "categoryId": "websuite-builder",
      "packageIds": ["core.process"],
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

## Integration in Studio und Standalone-Runtime

Der Editor wird nicht als öffentliche Pages-Datei ausgeliefert. Ein Owner oder
Bearbeiter öffnet den serverseitigen Studio-Einstieg aus der Pilot-Konsole:

```text
https://realtime.digitalisierungsplanung.de/studio.html?project=<project-id>
```

Ohne gültige Pilot-Sitzung und Projektberechtigung muss die Route zur
Pilot-Konsole zurückführen. Session- oder Realtime-Tokens gehören niemals in
die URL. Eine veröffentlichte Standalone-Prozess-App erhält einen Raum nur aus
der kontrollierten Deployment-Konfiguration, nicht aus einem öffentlichen
Editor-Link.

Ablauf:

```text
generierte Runtime in Preview oder Standalone
  -> GET /token
  -> WSS /ws
  -> join(configured roomId, clientId, short-lived token)
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
REALTIME_ADMIN_PATH=/admin.html
REALTIME_ADMIN_ROUTES_PATH=/admin/routes
REALTIME_PRODUCT_CONTRACT_PATH=/contract
REALTIME_EVENTS_PATH=/events
REALTIME_EMIT_PATH=/emit
REALTIME_CONSOLE_PATH=/console.html
REALTIME_EVENTS_ADMIN_PATH=/events-admin.html
REALTIME_EVENTS_ADMIN_CATALOG_PATH=/events-admin/catalog
REALTIME_PRESETS_ADMIN_PATH=/presets-admin.html
REALTIME_PRESETS_ADMIN_CATALOG_PATH=/presets-admin/catalog
REALTIME_PRESETS_ADMIN_PARSE_PATH=/presets-admin/parse
REALTIME_PRESETS_ADMIN_IMPORT_PATH=/presets-admin/import
REALTIME_IMAGE_INLINE_PATH=/assets/inline-image
REALTIME_PRESET_LIBRARY_PATH=/path/to/preset-library.json
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
```

## Externer SIP-Call als Beispiel

1. SIP-Anlage erkennt eingehenden Anruf.
2. SIP-Bridge ruft `/emit` auf.
3. Eine autorisierte Studio- oder veröffentlichte Standalone-Runtime mit dem
   konfigurierten Raum `sales-floor` empfängt das Ereignis.
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
