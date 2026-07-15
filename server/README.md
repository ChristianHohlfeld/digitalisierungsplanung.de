# Digitalisierungsplanung Managed-Pilot Server

Der Droplet unter `realtime.digitalisierungsplanung.de` betreibt zwei bewusst
getrennte Servergrenzen:

- Realtime transportiert validierte Runtime-Ereignisse, persistiert aber kein
  Prozessmodell.
- Die Managed-Pilot-API authentifiziert Benutzer, trennt Organisationen,
  autorisiert Rollen und persistiert versionierte kanonische Prozessmodelle.

GitHub Pages veröffentlicht nur die allowlist-basierte öffentliche Root-Runtime
mit ihren Assets und `release-version.js`. `state.html` ist **kein** öffentliches
Pages-Artefakt. Der Server liefert dieselbe interne Studio-Implementierung nur
über den kontrollierten Einstieg `/studio.html` aus.

## Endpunkte

- Public endpoint: `wss://realtime.digitalisierungsplanung.de/ws`
- Token endpoint: `https://realtime.digitalisierungsplanung.de/token`
- Pilot login/console: `https://realtime.digitalisierungsplanung.de/pilot-admin.html`
- Authorized studio: `https://realtime.digitalisierungsplanung.de/studio.html?project=<project-id>`
- Managed API: `https://realtime.digitalisierungsplanung.de/api/v1`
- Managed readiness: `https://realtime.digitalisierungsplanung.de/readyz`
- Admin hub: `https://realtime.digitalisierungsplanung.de/`
- Test console: `https://realtime.digitalisierungsplanung.de/console.html`
- Event designer: `https://realtime.digitalisierungsplanung.de/events-admin.html`
- Preset designer: `https://realtime.digitalisierungsplanung.de/presets-admin.html`
- Product contract: `https://realtime.digitalisierungsplanung.de/contract`
- Event definitions: `https://realtime.digitalisierungsplanung.de/events`
- Shared release: `https://realtime.digitalisierungsplanung.de/version`
- Local process: `127.0.0.1:8788`
- Allowed cross-origin runtime origin: `https://digitalisierungsplanung.de`
- Room auth: signed HMAC room token via `REALTIME_ROOM_SECRET`

Verträge:

- [`../docs/managed-pilot-api.md`](../docs/managed-pilot-api.md)
- [`../docs/realtime-api.md`](../docs/realtime-api.md)
- [`../docs/operations/production-readiness.md`](../docs/operations/production-readiness.md)

## Managed Pilot

`/pilot-admin.html` übernimmt Provisionierung, Anmeldung, Benutzer-, Projekt-
und Versionsverwaltung. Die Bearer-Sitzung liegt ausschließlich unter
`zustand.pilot.session.v1` in `sessionStorage`; sie gehört weder in eine URL
noch in Logs oder Exporte. Die Rollen sind:

| Rolle | Lesen/Export | Projekte/Versionen | Benutzer/Organisation | Audit/Backup |
| --- | ---: | ---: | ---: | ---: |
| `owner` | Ja | Ja | Ja | Ja |
| `editor` | Ja | Ja | Nein | Nein |
| `viewer` | Ja | Nein | Nein | Nein |

Owner und Editor erreichen das Studio ausschließlich über den Projektlink der
Konsole. `/studio.html` ohne gültige Sitzung, ohne Projekt oder mit einer nicht
editierbaren Rolle muss sofort zu `/pilot-admin.html` zurückführen. Das
Ausliefern der HTML-Shell allein ist keine Autorisierung: jeder Lese- und
Schreibzugriff auf Modelle wird zusätzlich serverseitig an Session,
Organisation, Rolle und Projekt gebunden.

Projektänderungen erzeugen unveränderliche Versionen. Clients senden
`expectedCurrentVersionId`; konkurrierende Änderungen werden mit Konflikt
abgelehnt. Restore erzeugt eine neue Version, statt Historie umzuschreiben.
Das Audit ist je Organisation hashverkettet. Der JSON-Store ist für einen
kontrollierten Single-Host-Pilot ausgelegt, nicht für horizontales SaaS.

Produktions- und Backupspeicher liegen explizit außerhalb des Git-Checkouts und
außerhalb voneinander:

```text
PILOT_DATA_DIR=/var/lib/digitalisierungsplanung-pilot
PILOT_BACKUP_DIR=/mnt/digitalisierungsplanung-pilot-backups
```

Die Verzeichnisse erhalten Modus `0700`, Persistenz-, Backup- und
Manifestdateien restriktive Rechte. Das signierte Backup benötigt einen
mindestens 32 Zeichen langen Schlüssel aus dem Secret Store. Es ersetzt weder
verschlüsselten Offsite-Schutz noch einen getesteten isolierten Restore:

```sh
PILOT_DATA_DIR=/var/lib/digitalisierungsplanung-pilot \
PILOT_BACKUP_DIR=/mnt/digitalisierungsplanung-pilot-backups \
PILOT_BACKUP_SIGNING_KEY="$PILOT_BACKUP_SIGNING_KEY" \
npm run pilot:backup
```

Inspektion, Dry Run und der atomare mandantenisolierte Restore sind im
[`Backup-/Restore-Runbook`](../docs/operations/backup-restore-runbook.md)
dokumentiert. Der Restore widerruft alle bestehenden Sessions des betroffenen
Mandanten.

`PILOT_BOOTSTRAP_TOKEN` provisioniert Organisationen und muss mindestens 32
Zeichen lang, außerhalb von Git und nur Operatoren zugänglich sein. Deployment
erzeugt bei Bedarf das rotierbare Bootstrap-Secret. Den
Backup-Signaturschlüssel erzeugt es bewusst **nicht**: Er muss vorher aus einem
externen, wiederherstellbaren Secret Store bereitgestellt und unabhängig vom
Host gesichert sein. Das Deployment verweigert fehlende/kurze Schlüssel,
verschachtelte Pfade, ein fehlendes vorab gemountetes Backupverzeichnis und ein
Backupziel auf demselben Dateisystemgerät wie die Produktivdaten. Vor Echtdaten
bleiben alle Gates des Production-Readiness-Dokuments verbindlich.

## Message Types

- `join`: first client message, requires `roomId`, `clientId`, and signed `token` in production.
- `runtime.event`: relayed event name and detail for state-machine runtime reactions. The server accepts only catalogued `realtime.*` names from `/events`.

The server broadcasts to other clients in the same room only. It does not echo messages to the sender.
It intentionally has no cursor presence and no peer join/leave broadcast.
Der Realtime-Kanal akzeptiert keine Modell-Patches oder Snapshots. Persistente
Modellschreibvorgänge laufen ausschließlich über die tenantgebundene
Managed-Pilot-API, die den kanonischen State-Blueprint-Vertrag validiert.

## Studio- und Runtime-Integration

Ein Owner oder Editor öffnet den Studio-Projektlink aus der Pilot-Konsole:

```text
https://realtime.digitalisierungsplanung.de/studio.html?project=<project-id>&api=/api/v1
```

Sessiontokens bleiben in `sessionStorage`; weder Session- noch Raumtoken stehen
in der URL. Eine veröffentlichte Standalone-Prozess-App erhält ihren Raum aus
kontrollierter Deployment-Konfiguration. Sie lädt ein kurzlebiges signiertes
Raumtoken von `/token`, öffnet `wss://realtime.digitalisierungsplanung.de/ws`
und tritt dem Raum bei. Preview und Standalone besitzen denselben Transport;
der Editor-Host leitet keine Ereignisse weiter.

Realtime is transport only. Runtime state still flows through the existing global JSON bus:

```text
runtime.event -> emitRuntimeEvent(...) -> writeRuntimeState("events..." / "lastEvent")
```

`/emit` accepts only offered `realtime.*` events from `/events` and requires an offered `emitterId`. The emitter must be allowed to fire that event. `button`, `change`, `event`, `api`, `timer`, and `auto` remain local runtime triggers; internal `flow` only guides nested states.
Graph/model collaboration must go through the documented State Blueprint API, not through this WSS relay.

The browser bridge has no emitter. Offered events enter through the authenticated external `/emit` boundary or the stateless test console.

Use a matching transition in the model:

```text
triggerType: realtime
triggerEvent: realtime.sip.call.incoming
```

If one state needs multiple transitions for the same realtime event, add a
typed `triggerMatch` on a matchable event field from `/contract`. Catch-all
events and overlapping numeric ranges are rejected by editor, API, MCP, and
runtime.

Open `https://realtime.digitalisierungsplanung.de/console.html?room=<room-id>` for a browser test emitter. The console loads connector sources, event names, and detail fields from `/events`, then POSTs to `/emit` with the Bearer secret. The emit secret is stored only in this browser's localStorage for convenience; it is not rendered by the server or stored server-side.

## Event Catalog

The event catalog is the server-side source of truth for offered realtime events and connector sources. Unknown `realtime.*` names are rejected on `/emit`, rejected on `/ws`, and ignored by the host bridge before they can enter the generated runtime. New datasets are created by editing this one catalog through the admin designer and saving it through the server.

- `server/event-catalog.json`: single contract/catalog source in Git.
- `server/preset-catalog.js`: standard preset definitions and contract materialization.
- `server/preset-library.json`: single managed source for preset categories, package metadata, and custom presets.
- `/` and `/admin.html`: central admin hub for human-facing server tools.
- `/admin/routes`: one JSON route index consumed by the admin hub.
- `/healthz`: process and shared-release health.
- `/readyz`: Managed-Pilot store/provisioning readiness.
- `/pilot-admin.html`: login, provisioning and project console.
- `/studio.html`: internal Studio shell; usable only with a valid editable
  project session.
- `/api/v1/*`: authentication, organizations, users, projects, immutable
  versions, restore, export, audit and organization backups.
- `/contract`: product contract for frontend trigger types, value types, datasets, connector sources, preset types, preset packages, the Managed Pilot offer, and collision-free state contribution paths. `subscriptionPlans` remains an empty compatibility field in V1.
- `/events`: canonical realtime catalog for event keys, detail types, emitters, and contribution paths.
- `/ws`: WebSocket relay only.
- `/emit`: authenticated server-to-server fire endpoint only.
- `/console.html`: manual browser emitter for testing only.
- `/events-admin.html`: simple event designer for event type, dataset, fields, source, and global-state contribution.
- `/events-admin/catalog`: load and validate the complete managed event
  catalog; saves create an `admin/events-*` review branch.
- `/presets-admin.html`: secret-protected DaisyUI snippet, category, package, and preset designer.
- `/presets-admin/parse`: parse-only conversion from DaisyUI v5.6.18 markup to structured preset data; it never persists raw HTML.
- `/presets-admin/import`: admin-only import of one exact canonical preset definition from a public HTTPS JSON endpoint; URL and response are never persisted.
- `/presets-admin/catalog`: load and validate the complete managed preset
  library; saves create an `admin/presets-*` review branch.
- `/assets/inline-image`: stateless runtime helper for standalone HTML exports. It accepts one public image URL and returns a Data URI; it stores no asset and rejects private targets, redirects, non-images, and oversized responses.

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

The designer shows existing datasets as a dropdown, creates new datasets as
blank `custom.dataset` entries, then follows the canvas contract order: event
type, dataset key, fields, source. The admin secret is
stored only in this browser's localStorage and is required when reloading or
saving through the admin API. A save validates the same strict server contract,
writes only the relevant catalog source, commits it and pushes a unique
`admin/events-*` or `admin/presets-*` review branch. It never changes
`release-version.js` and never pushes directly to `main`. Publication happens
only after review, merge, full CI and a separate manual sequenced release.
There is no selector for old contract versions; runtime uses the currently
published `release-N`. Release IDs are immutable audit labels, not
compatibility branches.

Preset packages group technical capabilities and templates; they are not offers
or user entitlements. Presets keep their normal `stateContribution`, and package
IDs never become a second canvas state or a local catalog copy. V1 publishes
only `pilotOffers.managed-pilot-v1`: a one-time 2,500–7,500 EUR engagement with
a typical duration of 6–12 weeks. `subscriptionPlans` is deliberately empty for
compatibility. User access comes only from authenticated tenant roles, never
from package or contract metadata.

The editor initially exposes one preset category, `websuite-builder`, containing
all shipped website, basic, form, data, and additional presets. Categories are
navigation; packages are separate commercial metadata. The Preset Designer may
add categories, packages, and custom presets through the complete-library
contract. Preset and component variants are exposed through `/contract.presetTypes`;
the frontend must not keep a second product variant list. Active markup, event
attributes, unsupported or ambiguous components, and malformed structured
defaults are rejected. Only the normalized variant and data are persisted in
Git; snippets and raw HTML never enter `/contract` or a canvas model.

Website Builder includes `Exportierbares Bild`, a normal contract preset with
an `image` field under its unique state contribution. A local editor upload is
read once in the browser and its Data URI becomes the canonical image value;
there is no server-side asset store or second copy. For external URL values the
editor stores no derived Base64 copy in the model. During standalone HTML
export it sends image-like state values and image component URLs to
`/assets/inline-image`; successful responses are written only into the derived
downloaded HTML, while the editor model/global state keeps the original URL or
existing Data URI.

All connector IDs are globally unique and path-safe. Runtime state is written under `events.<eventName>.*` and `emitters.<emitterId>.*`. Exact ID collisions and parent/child path collisions are rejected server-side. Every global-state contribution includes `fieldTypes` for compact display and `fieldSchemas` for hard validation: each field has a concrete value type, JSON type, default, and constraints such as length, range, format, protocol, max depth, or max items. `/emit` and WebSocket runtime events use the same schema validator, so a value can have the right JSON type and still be rejected when it violates the contract. The canvas loads `/contract` fresh with `no-store` before editor boot. On a connection or release error, managed/production mode may visibly degrade only to the last fully verified contract for at most 24 hours. It blocks when that cache is missing or expired and always blocks an incompatible core; it never invents local trigger types, value types, preset contracts, endpoint definitions, catalog copies, or preset instances.

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

The systemd timer checks `origin/main` every minute. It deploys only a shared
`release-N` created by the manual **Publish managed release** workflow after
full CI and environment approval. It locks against a second run, discards all
local repository changes, checks out the exact remote commit, runs `deploy.sh`,
updates the PM2 environment, validates Nginx and requires `/healthz` to report
the same release ID plus `/readyz` to confirm the Managed-Pilot store. The
success marker advances only after all checks pass. A failed deployment does
not advance the marker; the timer keeps retrying that same immutable release.
Catalog saves never create a release and remain on review branches until their
normal PR, merge and manual publication.

Useful commands:

```sh
sudo bash server/auto-deploy.sh --once
sudo bash server/auto-deploy.sh --status
systemctl status digitalisierungsplanung-auto-deploy.timer
journalctl -u digitalisierungsplanung-auto-deploy.service -n 100 --no-pager
curl -fsS https://realtime.digitalisierungsplanung.de/version
```

`/etc/digitalisierungsplanung-realtime.env`, `PILOT_DATA_DIR` and the externally
mounted `PILOT_BACKUP_DIR` remain outside the repository and are never removed
by the force sync. The backup signing key must also be escrowed outside that
host. Do not keep manual production code changes inside
`/var/www/digitalisierungsplanung.de`; `origin/main` intentionally wins.

The event and preset designers need `REALTIME_ADMIN_SECRET`. Saving through a
designer also needs repository push credentials limited to creating review
branches. If the Git remote cannot push with its configured credentials, set
`REALTIME_GIT_PUSH_TOKEN` in `/etc/digitalisierungsplanung-realtime.env` to a
short-lived or tightly scoped GitHub credential. It must not bypass branch
protection or publish releases.

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
curl -fsS https://realtime.digitalisierungsplanung.de/readyz
curl -fsS https://realtime.digitalisierungsplanung.de/version
npm run test:pilot
npm run server:smoke:wss
npm run server:smoke:wss:prod
npm run server:smoke:emit
npm run server:smoke:emit:prod
pm2 status digitalisierungsplanung-realtime
```

The smoke tests read `/etc/digitalisierungsplanung-realtime.env` automatically
when it exists. `server:smoke:wss:prod` performs a signed join on the Droplet,
and `server:smoke:emit:prod` performs the authenticated `/emit` POST. Before
Echtdaten, a staging browser test must additionally prove login/logout,
owner/editor/viewer authorization, cross-tenant denial, Studio redirect,
version conflict and isolated restore; unit tests alone are not that proof.

For a custom env file:

```sh
npm run server:smoke:wss -- --env-file=/path/to/realtime.env
npm run server:smoke:emit -- --env-file=/path/to/realtime.env
```
