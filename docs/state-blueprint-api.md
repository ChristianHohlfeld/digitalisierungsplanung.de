# Zustand API-Referenz

Dieses Dokument beschreibt den Automatisierungs-Vertrag für Zustand /
Digitalisierungsplanung. Die API bearbeitet dasselbe kanonische JSON-Modell wie
der visuelle Editor. Sie klickt keine DOM-Elemente, hält keinen zweiten
Runtime-Speicher und erzeugt keinen versteckten lokalen Zustand.

## Kernregel

Es gibt genau eine Wahrheit:

```text
Zustand-JSON-Modell -> globaler JSON-Zustands-/Ereignisbus -> FSM-Runtime
```

API-Aufrufe dürfen das Modell verändern. Runtime-Werte entstehen in der
generierten App über den Bus. Komponenten sind nur Ansichten und explizite
Ereignisoberflächen über diesem Bus.

## MCP-Server Starten

```bash
STATE_BLUEPRINT_MODEL_PATH=./state-blueprint.workspace.json npm run mcp:state
```

Ohne `STATE_BLUEPRINT_MODEL_PATH` liest und schreibt der Server
`./state-blueprint.workspace.json`.

Die Datei verwendet ausschließlich `kind: "state-blueprint.workspace"` mit
`schemaVersion: 1`. Ein nacktes Modell oder eine
`state-blueprint-definition` ist keine Workspace-Datei und wird abgelehnt.
Formale `.state.json`-Definitionen gelangen ausschließlich über
`state_blueprint_import_definition` in den Workspace. Werkzeug-, Aktions-,
Befehls- und Feldnamen sind exakt; es gibt keine Aliasnamen oder Migration.

Der Server spricht MCP JSON-RPC über stdio. Jede Antwort liefert JSON-Text in
`content[0].text` und denselben Wert in `structuredContent`.

Minimaler JSON-RPC-Aufruf:

```json
{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"state_blueprint_validate","arguments":{}}}
```

## Werkzeuge

| Werkzeug | Zweck |
| --- | --- |
| `state_blueprint_get_model` | Liest das aktuelle kanonische Workspace-Modell. |
| `state_blueprint_replace_model` | Ersetzt das ganze Modell nach Normalisierung und Validierung. |
| `state_blueprint_apply_actions` | Führt geordnete Modellaktionen atomar aus. |
| `state_blueprint_apply_commands` | Führt vollständige Editorbefehle aus: Modell, Auswahl, Ebene, Ansicht, Kopieren/Einfügen, Gruppieren/Auflösen, Undo/Redo. |
| `state_blueprint_plan_prompt` | Wandelt eine unterstützte Textanweisung in Modellaktionen um, ohne zu schreiben. |
| `state_blueprint_apply_prompt` | Wandelt eine unterstützte Textanweisung in Modellaktionen um und wendet sie an. |
| `state_blueprint_validate` | Validiert das Modell gegen den FSM-/Bus-Vertrag. |
| `state_blueprint_export_definition` | Liefert die formale `.state.json`-Definition. |
| `state_blueprint_import_definition` | Importiert eine formale `.state.json`-Definition. |
| `state_blueprint_export_html` | Baut dieselbe eigenständige HTML-App wie der Editor-Export. |
| `state_blueprint_action_catalog` | Liefert Modellaktionsnamen und Prompt-Beispiele. |
| `state_blueprint_command_catalog` | Liefert alle programmatischen Editorbefehle. |

## Haupt-Schreibschnittstellen

Nutze `state_blueprint_apply_actions`, wenn nur das kanonische Modell geändert
werden soll.

```json
{
  "actions": [
    { "type": "upsert_state", "id": "start", "title": "Start" },
    { "type": "upsert_state", "id": "done", "title": "Fertig", "x": 360, "y": 120 },
    { "type": "upsert_transition", "id": "start_to_done", "from": "start", "to": "done", "label": "Weiter" }
  ],
  "dryRun": false,
  "allowInvalid": false
}
```

Modellaktionen werden vor der Ausführung in Abhängigkeitsreihenfolge gebracht, damit
Zustände vor Übergängen existieren. Das Ergebnis wird normalisiert und validiert,
bevor es geschrieben wird.

Explizite Komponenten- und DaisyUI-Aktionsbindungen referenzieren eine vorhandene
ausgehende Transition-ID. Mehrere Controls dürfen dieselbe Transition auslösen;
sie erzeugen dadurch keinen weiteren Trigger. Die ID darf auch nach einem
Triggerwechsel als Slot-Zuordnung bestehen bleiben; nur `triggerType: "button"`
rendert daraus ein interaktives Control. Fehlende und fremde Referenzen machen
das Modell ungültig.
Ein Aktionsslot darf alternativ eine URL enthalten. Eine nicht leere
Transition-ID und eine URL im selben Slot sind ungültig.

Der Trigger wird ausschliesslich an der Transition modelliert. Bezogen auf die
effektive Quelle (`from`, bei Parent-Ausgaengen `groupExitId`) darf dieselbe
Triggeridentitaet nur einmal vorkommen. Conditions gehoeren nicht zur Identitaet;
sie sind Guards nach einem passenden Trigger. Fuer `realtime` kann die
Identitaet einen strukturierten `triggerMatch` enthalten. Matches desselben
Events muessen disjunkt sein: unterschiedliche Werte auf demselben skalaren
Feld sind erlaubt, Zahlenbereiche duerfen sich nicht schneiden, unterschiedliche
Felder gelten als potenziell ueberlappend, und ein fehlender Match ist ein
exklusiver catch-all. Ein Timer ist hoechstens einmal erlaubt, `auto` ist
exklusiv. Interne `flow`-Kanten zaehlen nicht als fachliche Trigger.
Zulaessige fachliche Typen sind ausschliesslich `button`, `change`, `event`,
`realtime`, `api`, `timer` und `auto`; `flow` ist ausschliesslich intern.
Andere Werte und ungueltige Kombinationen werden ohne Alias oder Normalisierung
abgelehnt. Condition-Pfade unter `events.*`, `realtime.*` und `emitters.*`
muessen aus dem Product Contract kommen.

Nutze `state_blueprint_apply_commands`, wenn ein externe Anwendung die App wie ein
Nutzer steuern soll, aber ohne DOM-Klicks. Befehle laufen über dieselben
Kernfunktionen wie die Modellaktionen und führen zusätzlich Editor-Sitzungs-
Aktionen aus.

```json
{
  "commands": [
    { "command": "scene.new", "title": "Auftragsprozess" },
    { "command": "state.create", "id": "start", "title": "Start", "x": 96, "y": 120 },
    { "command": "state.create", "id": "done", "title": "Fertig", "x": 456, "y": 120 },
    { "command": "transition.create", "id": "start_done", "from": "start", "to": "done", "label": "Weiter" },
    { "command": "graph.insert_state_on_transition", "transitionId": "start_done", "stateId": "prüfen", "title": "Prüfen" },
    { "command": "viewport.fit", "viewportWidth": 1200, "viewportHeight": 800 }
  ]
}
```

Wichtige Befehle:

| Befehl | Zweck |
| --- | --- |
| `scene.new`, `scene.rename`, `model.replace` | Szene neu anlegen, benennen oder komplett ersetzen. |
| `state.create`, `state.upsert`, `state.move`, `state.delete`, `state.set_initial` | Zustände erzeugen, bearbeiten, verschieben, löschen und initial setzen. |
| `transition.create`, `transition.update`, `transition.rewire`, `transition.delete` | Übergänge erzeugen, bearbeiten, umverdrahten und löschen. |
| `variable.upsert`, `variable.delete` | Zustandsbezogene Bus-Variablen anlegen oder entfernen. |
| `fetch.configure`, `repeat.configure`, `wire.upsert`, `wire.remove` | Datenquelle, Wiederholung und Datenverbindungen konfigurieren. |
| `component.add`, `component.update`, `component.remove`, `component.reorder` | Render-Komponenten und Bausteine bearbeiten. |
| `boundary.set` | echte Boundary-/Proxy-Verbindungen setzen. |
| `selection.set`, `selection.clear`, `selection.all` | Editor-Auswahl setzen. |
| `layer.open`, `layer.back`, `layer.root` | Arbeitsebenen navigieren. |
| `viewport.set_camera`, `viewport.reset`, `viewport.fit` | Pan/Zoom programmatisch setzen. |
| `preview.set_collapsed`, `ui.set_panel` | Editor-UI-Zustand steuern. |
| `graph.copy_selection`, `graph.paste`, `graph.duplicate_selection`, `graph.delete_selection` | Graph-Auswahl kopieren, einfügen, duplizieren oder löschen. |
| `graph.collapse_to_parent`, `graph.degroup_parent` | Zustände zu einem echten Parent-Zustand gruppieren oder wieder auflösen. |
| `history.undo`, `history.redo` | Befehlsbasierte Editor-Änderungen rückgängig machen oder wiederholen. |

## Modellaktionen

### `create_flow`

Leert das Modell und startet frisch.

Felder:

| Feld | Typ | Erforderlich | Hinweise |
| --- | --- | --- | --- |
| `name` | string | nein | Ablaufname. Standard ist `Unbenannter Ablauf`. |

Beispiel:

```json
{ "type": "create_flow", "name": "Anfrageablauf" }
```

### `set_model_name`

Benennt den Ablauf um, ohne Zustände oder Übergänge zu ändern.

```json
{ "type": "set_model_name", "name": "Order intake" }
```

### `replace_model`

Ersetzt das ganze kanonische Modell. Das ist für vollständige Importe oder
generierte Modellneubauten gedacht. Die rohe Eingabe wird validiert und nur bei
Erfolg kanonisch übernommen; sie wird nicht repariert oder migriert.

```json
{
  "type": "replace_model",
  "model": {
    "version": 2,
    "name": "Kleiner Ablauf",
    "initial": "start",
    "boundary": { "entryId": "start", "exitId": "start", "entryDisabled": false, "exitDisabled": false },
    "states": [{ "id": "start", "title": "Start", "x": 120, "y": 120, "components": [] }],
    "transitions": []
  }
}
```

### `upsert_state`

Erzeugt oder aktualisiert einen Zustand.

Felder:

| Feld | Typ | Erforderlich | Hinweise |
| --- | --- | --- | --- |
| `id` | string | nein | Stabile Zustandsidentität. Wird aus dem Titel erzeugt, wenn sie fehlt. |
| `title` | string | nein | Menschlich lesbarer Name. |
| `parentId` | string | nein | Legt den Zustand in eine Parent-Ebene. Leer bedeutet Root. |
| `x`, `y` | number | nein | Koordinaten auf der Arbeitsfläche, am Raster ausgerichtet. |
| `components` | array | nein | Strukturierte Render-Zeilen. Keine `html`-, `localState`- oder versteckten Store-Felder. |
| `data` | object | nein | Zustandsbezogene Vorgaben und Form für den globalen Bus. |
| `dataTypes` | object | nein | Typdeklarationen für Pfade aus `data`. |
| `dataSource` | object | nein | Fetch-beim-Betreten-Konfiguration. |
| `repeat` | object | nein | Listen-/Wiederholungs-Konfiguration. |
| `dataWires` | array | nein | Daten-zu-Darstellung-Zuordnungen. |
| `subscriptions` | array | nein | Bus-Pfade, für die sich dieser Zustand interessiert. |
| `boundary` | object | nein | Eingangs-/Ausgangsdaten für Kind-Ebenen. |

`renderMode` ist kein Vertragsfeld. Sichtbare Komponenten gehören immer direkt
zu ihrem State.

Beispiel: Zustand mit Textkomponente erzeugen.

```json
{
  "type": "upsert_state",
  "id": "cart",
  "title": "Warenkorb",
  "x": 96,
  "y": 120,
  "components": [
    { "id": "cart_intro", "type": "text", "text": "Bestellung prüfen.", "url": "" }
  ]
}
```

Beispiel: Kind-Zustand erzeugen.

```json
{
  "type": "upsert_state",
  "id": "address_form",
  "title": "Adresse",
  "parentId": "checkout",
  "x": 120,
  "y": 120
}
```

### `move_state`

Move a state on the canvas.

```json
{ "type": "move_state", "stateId": "cart", "x": 240, "y": 192 }
```

### `delete_state`

Delete a state. Descendants and connected transitions are removed by default.

```json
{ "type": "delete_state", "id": "cart" }
```

Nur den Zustand selbst löschen:

```json
{ "type": "delete_state", "id": "cart", "deleteDescendants": false }
```

### `set_initial`

Setzt den initialen Runtime-Zustand.

```json
{ "type": "set_initial", "stateId": "cart" }
```

### `upsert_transition`

Create or update one explicit FSM transition. Endpoints must be existing states
in the same layer. Cross-layer flow must use boundary input/output references.

Fields:

| Feld | Typ | Erforderlich | Hinweise |
| --- | --- | --- | --- |
| `id` | string | nein | Stabile Uebergangsidentitaet. |
| `from` | Zustands-ID | ja | Quellzustand. |
| `to` | Zustands-ID | ja | Zielzustand. |
| `label` | string | nein | Nutzereigene Beschriftung fuer Schaltflaeche oder Kante. Ohne Angabe exakt `Weiter`; Quelle und Ziel bleiben davon getrennte `from`-/`to`-Referenzen. |
| `triggerType` | `button`, `change`, `event`, `realtime`, `api`, `timer`, `auto` | nein | Standard ist `button`. |
| `triggerEvent` | string | nein | Konkreter Ereignisname. Wird nur fuer Schaltflaeche/Timer/Auto erzeugt. Change, Event, Realtime und API verlangen eine konkrete Referenz. |
| `triggerMatch` | object | nein | Nur fuer `realtime`: `{ field, operator, value }` gegen Product-Contract-Felder. Skalare Felder erlauben `equals`; Zahlen erlauben `equals`, `gt`, `gte`, `lt`, `lte`, `between`. Matches desselben Events muessen disjunkt sein. |
| `timerMs` | number | nein | Dauer fuer Timer-Uebergaenge. |
| `condition` | string | nein | Bedingung ueber Bus-Pfade. |
| `set` | object | nein | Patch, der beim Uebergang in den globalen Bus geschrieben wird. |
| `groupEntryId`, `groupExitId` | Zustands-ID | nein | Editor-Projektionshinweise, kein Runtime-Zustand. |

Das Label wird bei einer Zustandsumbenennung oder beim Umverdrahten nicht
automatisch verändert. Die Normalisierung interpretiert den Inhalt nicht anhand
von Quelle, Ziel, Sprache oder Präfixen. Ein leeres Label wird `Weiter`; jedes
vorhandene nicht leere Label bleibt nach dem Trimmen unverändert.

Schaltflächen-Übergang:

```json
{
  "type": "upsert_transition",
  "id": "cart_to_shipping",
  "from": "cart",
  "to": "shipping",
  "label": "Zur Kasse",
  "triggerType": "button",
  "set": { "states.cart.checkoutStarted": true }
}
```

Timer-Übergang:

```json
{
  "type": "upsert_transition",
  "id": "loading_to_done",
  "from": "loading",
  "to": "done",
  "label": "Geladen",
  "triggerType": "timer",
  "timerMs": 2000,
  "set": { "states.loading.loaded": true }
}
```

Bus-Änderungs-Übergang:

```json
{
  "type": "upsert_transition",
  "id": "valid_to_next",
  "from": "form",
  "to": "summary",
  "label": "Weiter",
  "triggerType": "change",
  "triggerEvent": "change.states.form.accepted",
  "condition": "states.form.accepted == true"
}
```

Relative Runtime-Pfade wie `accepted` sind ungueltig. Bedingungen, Wirkungen,
Datenverbindungen und Render-Bindungen verwenden immer den vollstaendigen
Buspfad.

Realtime-Uebergang mit formalem Match:

```json
{
  "type": "upsert_transition",
  "id": "call_to_live",
  "from": "waiting",
  "to": "live_call",
  "label": "Eingehender Anruf",
  "triggerType": "realtime",
  "triggerEvent": "realtime.sip.call.incoming",
  "triggerMatch": { "field": "caller", "operator": "equals", "value": "+491234" },
  "condition": "events.realtime.sip.call.incoming.count > 0"
}
```

Realtime event definitions and matchable fields stay on the Realtime API (`/events`) and Product Contract (`/contract`). The model stores no `model.realtime` contract copy.

API-Antwort:

```json
{
  "type": "upsert_transition",
  "id": "products_loaded",
  "from": "products",
  "to": "results",
  "label": "Geladen",
  "triggerType": "api",
  "triggerEvent": "fetch.states.products.fetch.success"
}
```
Der Fehlerpfad verwendet entsprechend `fetch.states.products.fetch.error`.
`api` ist ein eigener Trigger und kein Alias fuer `change` oder `event`.
Conditions gehoeren nicht zur Triggeridentitaet; derselbe konkrete Trigger darf
pro effektiver Quelle nur einmal vorkommen. Fuer `realtime` entscheidet ein
optionaler, typisierter `triggerMatch` ueber die konkrete Teilmenge des Events;
ueberlappende Teilmengen sind ungueltig.

Conditions erlauben ausschließlich `&&`, `||`, `!`, die Operatoren `==`, `!=`,
`>`, `>=`, `<`, `<=` sowie boolesche, endliche numerische oder gequotete
String-Literale. `null`, `undefined`, freie Ausdrücke und implizite
Typumwandlung sind verboten.

Preset categories, package metadata, and managed preset definitions stay on the
Product Contract (`/contract`). The model and MCP workspace store only the
materialized states, components, transitions, and their canonical bus paths.

### `delete_transition`

Delete one transition. Any render placeholder button for that transition is also
removed.

```json
{ "type": "delete_transition", "transitionId": "cart_to_shipping" }
```

### `upsert_state_variable`

Deklariert oder aktualisiert eine zustandsbezogene Variable im globalen Busbaum.

`path` ist immer ein zustandsrelativer Feldpfad innerhalb der Modellkonfiguration
`state.data`. Die API speichert
keinen qualifizierten Schlüssel und ergänzt keinen Präfix. Die Runtime stellt
die Deklaration beim State-Eintritt ausschließlich unter
`states.<stateId>.<path>` bereit.

```json
{
  "type": "upsert_state_variable",
  "stateId": "form",
  "path": "email",
  "valueType": "email",
  "value": ""
}
```

Stored result:

```json
{
  "data": { "email": "" },
  "dataTypes": { "email": "email" }
}
```

Allowed `valueType`: `text`, `email`, `password`, `number`, `boolean`, `url`,
`image`, `object`, `list`.

### `delete_state_variable`

Entfernt einen deklarierten Bus-Pfad aus einem Zustand. Passende Datenverbindungen werden mit entfernt.

```json
{ "type": "delete_state_variable", "stateId": "form", "path": "email" }
```

### `configure_fetch`

Konfiguriert Fetch als Eintrittseffekt des aktiven Zustands. Fetch ist niemals
ein Render-Nebeneffekt.

Fields:

| Field | Type | Notes |
| --- | --- | --- |
| `stateId` | string | erforderlich. |
| `url` | string | Endpunkt-URL. |
| `target` | Bus-Pfad | Standard ist `states.<stateId>.fetch`. |
| `select` | Pfad | Optionaler Auswahlpfad in der Antwort. |
| `timeoutMs` | number | Zwischen 1000 und 30000 begrenzt. |
| `retries` | number | Zwischen 0 und 5 begrenzt. |

```json
{
  "type": "configure_fetch",
  "stateId": "products",
  "url": "https://api.example.test/products",
  "target": "states.products.fetch",
  "select": "",
  "timeoutMs": 8000,
  "retries": 2
}
```

### `configure_repeat`

Rendert eine Liste aus einem expliziten Bus-Pfad.

```json
{
  "type": "configure_repeat",
  "stateId": "products",
  "path": "states.products.fetch.data",
  "as": "item",
  "index": "i",
  "manual": true
}
```

### `upsert_data_wire`

Ordnet einen Bus-Pfad sichtbarem Render-Inhalt zu.

Fields:

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Stabile Verbindungs-ID. |
| `stateId` | string | Besitzender Zustand. |
| `sourcePath` | Bus-Pfad | Zu lesender Wert. |
| `scopePath` | Bus-Pfad | Optionaler Listenpfad für Wiederholung. |
| `itemPath` | Pfad | Optionaler Pfad innerhalb jedes Listeneintrags. |
| `role` | string | `image`, `title`, `price`, `description`, `field`, `link`, `note`. |
| `componentType` | string | `heading`, `text`, `image`, `link`, `note`. |
| `label` | string | Sichtbarer Name für Nutzer. |

Beispiel: Produkttitel aus einer wiederholten Liste rendern.

```json
{
  "type": "upsert_data_wire",
  "stateId": "products",
  "id": "wire_product_title",
  "sourcePath": "states.products.fetch.data.title",
  "scopePath": "states.products.fetch.data",
  "itemPath": "title",
  "role": "title",
  "componentType": "heading",
  "label": "Titel"
}
```

### `remove_data_wire`

Entfernt eine Daten-zu-Darstellung-Zuordnung.

```json
{ "type": "remove_data_wire", "stateId": "products", "wireId": "wire_product_title" }
```

### `add_component`

Hängt eine strukturierte Render-Komponente an oder fügt sie ein.

Erlaubter Komponenten-`type`: `heading`, `text`, `image`, `list`, `link`, `note`,
`divider`, `daisy`, `transitionButton`, `dataWire`.

No component may carry `html`, `localState`, `stateStore`, or `store`. If a
component needs data, bind it through `dataPath` or `wireId`.

Textkomponente:

```json
{
  "type": "add_component",
  "stateId": "cart",
  "index": 0,
  "component": { "id": "cart_copy", "type": "text", "text": "Bestellung prüfen.", "url": "" }
}
```

Daisy-Baustein:

```json
{
  "type": "add_component",
  "stateId": "cart",
  "component": {
    "id": "cart_card",
    "type": "daisy",
    "variant": "card",
    "dataPath": "states.cart.card",
    "dataRole": "widget",
    "dataLabel": "Warenkorbkarte"
  }
}
```

Platzierte Übergangsschaltfläche:

```json
{
  "type": "add_component",
  "stateId": "cart",
  "component": { "id": "slot_checkout", "type": "transitionButton", "transitionId": "cart_to_shipping" }
}
```

Datenverbindungs-Renderzeile:

```json
{
  "type": "add_component",
  "stateId": "products",
  "component": { "id": "product_title_row", "type": "dataWire", "wireId": "wire_product_title" }
}
```

### `update_component`

Patcht eine Komponente.

```json
{
  "type": "update_component",
  "stateId": "cart",
  "componentId": "cart_copy",
  "patch": { "text": "Artikel und Mengen prüfen." }
}
```

### `remove_component`

Remove one render component. This does not delete state variables unless you also
call `delete_state_variable`.

```json
{ "type": "remove_component", "stateId": "cart", "componentId": "cart_copy" }
```

### `reorder_components`

Set render order for visible rows. Omitted component ids keep their relative
order after the listed ids.

```json
{
  "type": "reorder_components",
  "stateId": "cart",
  "componentIds": ["slot_checkout", "cart_copy", "cart_card"]
}
```

### `set_boundary`

Set root or nested layer input/output references. This creates or updates the
matching proxy transitions.

Wurzelgrenze:

```json
{
  "type": "set_boundary",
  "entryId": "home",
  "exitId": "thanks",
  "title": "Website-Ablauf",
  "note": "Öffentlicher Hauptablauf"
}
```

Verschachtelte Grenze:

```json
{
  "type": "set_boundary",
  "parentId": "checkout",
  "entryId": "address_form",
  "exitId": "review"
}
```

Contract rule: child states do not jump back to the parent by magic. A child can
only leave through an explicit boundary output and whatever real parent-layer
transition is connected after that.

### Gruppieren / Auflösen

Grouping is not a second editor-only model. Use the command API so the same
canonical JSON structure is used as in the visual editor:

```json
{
  "commands": [
    {
      "command": "graph.collapse_to_parent",
      "id": "checkout",
      "title": "Kasse",
      "stateIds": ["cart", "shipping", "payment"]
    }
  ]
}
```

Regeln:

- Eine Gruppe ist ein echter Parent-Zustand mit Kindzuständen.
- Eingang und Ausgang werden durch den Boundary-Vertrag des Parents dargestellt.
- `model.editorGroups` is invalid and stripped during normalization.
- Auflösen nutzt `graph.degroup_parent` und legt die Kinder wieder in die
  äußere Ebene, ohne die FSM-Bedeutung des Ablaufs zu verändern.

## Vollständige Abläufe

### Zwei Zustände erzeugen und verbinden

```json
{
  "actions": [
    { "type": "create_flow", "name": "Einfacher Ablauf" },
    { "type": "upsert_state", "id": "start", "title": "Start", "x": 96, "y": 120 },
    { "type": "upsert_state", "id": "fertig", "title": "Fertig", "x": 384, "y": 120 },
    { "type": "upsert_transition", "id": "start_to_fertig", "from": "start", "to": "fertig", "label": "Weiter" },
    { "type": "set_initial", "stateId": "start" }
  ]
}
```

### Zustand zwischen zwei Zustände setzen

```json
{
  "actions": [
    { "type": "delete_transition", "transitionId": "a_to_c" },
    { "type": "upsert_state", "id": "b", "title": "Prüfen", "x": 360, "y": 120 },
    { "type": "upsert_transition", "id": "a_to_b", "from": "a", "to": "b", "label": "Prüfen" },
    { "type": "upsert_transition", "id": "b_to_c", "from": "b", "to": "c", "label": "Weiter" }
  ]
}
```

### Funktionalen daisyUI-Kartenzustand anlegen

```json
{
  "actions": [
    {
      "type": "upsert_state_variable",
      "stateId": "product",
      "path": "card",
      "valueType": "object",
      "value": {
        "title": "Prozesskarte",
        "body": "Erst verstehen, dann digitalisieren.",
        "actionLabel": "Öffnen"
      }
    },
    {
      "type": "add_component",
      "stateId": "product",
      "component": {
        "id": "product_card",
        "type": "daisy",
        "variant": "card",
        "dataPath": "states.product.card",
        "dataRole": "widget",
        "dataLabel": "Produktkarte"
      }
    },
    { "type": "upsert_state", "id": "details", "title": "Details", "x": 384, "y": 120 },
    { "type": "upsert_transition", "id": "product_to_details", "from": "product", "to": "details", "label": "Öffnen" }
  ]
}
```

### JSON laden und Liste darstellen

```json
{
  "actions": [
    { "type": "upsert_state", "id": "products", "title": "Produkte", "x": 96, "y": 120 },
    {
      "type": "configure_fetch",
      "stateId": "products",
      "url": "https://api.example.test/products",
      "target": "states.products.fetch"
    },
    { "type": "configure_repeat", "stateId": "products", "path": "states.products.fetch.data", "as": "item", "index": "i", "manual": true },
    {
      "type": "upsert_data_wire",
      "stateId": "products",
      "id": "wire_title",
      "sourcePath": "states.products.fetch.data.title",
      "scopePath": "states.products.fetch.data",
      "itemPath": "title",
      "role": "title",
      "componentType": "heading",
      "label": "Titel"
    },
    { "type": "add_component", "stateId": "products", "component": { "id": "title_row", "type": "dataWire", "wireId": "wire_title" } }
  ]
}
```

### Verschachtelten Ablauf mit Parent-Ausgang erzeugen

```json
{
  "actions": [
    { "type": "upsert_state", "id": "checkout", "title": "Kasse", "x": 96, "y": 120 },
    { "type": "upsert_state", "id": "address", "title": "Adresse", "parentId": "checkout", "x": 120, "y": 120 },
    { "type": "upsert_state", "id": "review", "title": "Prüfen", "parentId": "checkout", "x": 408, "y": 120 },
    { "type": "set_boundary", "parentId": "checkout", "entryId": "address", "exitId": "review" },
    { "type": "upsert_transition", "id": "address_to_review", "from": "address", "to": "review", "label": "Prüfen" },
    { "type": "upsert_state", "id": "thanks", "title": "Danke", "x": 384, "y": 120 },
    { "type": "upsert_transition", "id": "checkout_to_thanks", "from": "checkout", "to": "thanks", "label": "Abschließen" }
  ]
}
```

Das Kind verlässt den Parent über dessen Boundary-Ausgang. Wenn der Parent
danach keinen echten ausgehenden Übergang hat, stoppt die Maschine.

### Ladezustand, der nach zwei Sekunden weitergeht

```json
{
  "actions": [
    {
      "type": "upsert_state_variable",
      "stateId": "loading",
      "path": "loading",
      "valueType": "object",
      "value": { "label": "Lädt..." }
    },
    {
      "type": "add_component",
      "stateId": "loading",
      "component": {
        "id": "loading_widget",
        "type": "daisy",
        "variant": "loading",
        "dataPath": "states.loading.loading",
        "dataRole": "widget",
        "dataLabel": "Laden"
      }
    },
    {
      "type": "upsert_transition",
      "id": "loading_to_done",
      "from": "loading",
      "to": "done",
      "label": "Geladen",
      "triggerType": "timer",
      "timerMs": 2000
    }
  ]
}
```

Timer-Übergänge werden nicht als Schaltflächen gerendert.

## Import, Export, Speichern, Laden

### Aktuellen Workspace lesen

```json
{"name":"state_blueprint_get_model","arguments":{"includeValidation":true}}
```

### Workspace laden oder ersetzen

```json
{"name":"state_blueprint_replace_model","arguments":{"model":{"version":2,"name":"Importiert","states":[],"transitions":[]}}}
```

### Export `.state.json`

```json
{"name":"state_blueprint_export_definition","arguments":{}}
```

### Import `.state.json`

```json
{"name":"state_blueprint_import_definition","arguments":{"definition":{"kind":"state-blueprint-definition","schemaVersion":2,"model":{"version":2,"name":"Importiert","states":[],"transitions":[]},"stateTemplates":[]}}}
```

### Eigenständiges HTML exportieren

HTML in der Antwort zurückgeben:

```json
{"name":"state_blueprint_export_html","arguments":{}}
```

HTML in eine Datei schreiben:

```json
{
  "name": "state_blueprint_export_html",
  "arguments": {
    "outputPath": "./dist/zustand-app.html",
    "includeHtml": false
  }
}
```

Das exportierte HTML bettet `EXPORTED_STATE_BLUEPRINT` ein und läuft ohne Editor.

## Textbefehle

Nur als bequeme Schicht über der Modellaktions-API nutzen.

Planen, ohne zu schreiben:

```json
{
  "name": "state_blueprint_plan_prompt",
  "arguments": {
    "prompt": "füge timer 10s hinzu und weiter zu Fertig",
    "selectedStateId": "start"
  }
}
```

Direkt anwenden:

```json
{
  "name": "state_blueprint_apply_prompt",
  "arguments": {
    "prompt": "Warenkorb -> Versand -> Zahlung -> Fertig"
  }
}
```

Unterstützte Absichten:

- Ablauf erzeugen
- Timer/Countdown hinzufügen
- inneren Zustand hinzufügen
- Übergang/Verbindung hinzufügen
- daisyUI-Komponente/Vorlage hinzufügen
- typisierte Zustandsvariable hinzufügen
- API-/Listen-Fetch konfigurieren

Bei mehrdeutigen Prompts vor dem Anwenden `plan.assumptions` prüfen.

## Editor-zu-API-Zuordnung

| Nutzeraktion im Editor | API |
| --- | --- |
| Neue Szene | `create_flow` |
| Ablauf umbenennen | `set_model_name` |
| Modell speichern/laden | `state_blueprint_get_model`, `state_blueprint_replace_model`, `state_blueprint_import_definition` |
| Export `.state.json` | `state_blueprint_export_definition` |
| Export HTML | `state_blueprint_export_html` |
| Zustand erzeugen | `upsert_state` |
| Zustand verschieben | `move_state` |
| Zustand löschen | `delete_state` |
| Initialzustand setzen | `set_initial` |
| Kind-Zustand erzeugen | `upsert_state` mit `parentId` |
| Zustände verbinden | `upsert_transition` |
| Übergang umverdrahten | `upsert_transition` mit gleicher `id`, neuem `from`/`to` |
| Übergang löschen | `delete_transition` |
| Auslöser-Typ setzen | `upsert_transition` mit `triggerType`, `triggerEvent`, `timerMs` |
| Bedingung setzen | `upsert_transition.condition` |
| Bus-Wirkung des Übergangs setzen | `upsert_transition.set` |
| Zustandsvariable/Ansichtsfeld hinzufügen | `upsert_state_variable` |
| Zustandsvariable/Ansichtsfeld entfernen | `delete_state_variable` |
| Fetch konfigurieren | `configure_fetch` |
| Wiederholung/Liste konfigurieren | `configure_repeat` |
| Datenverbindung hinzufügen | `upsert_data_wire` |
| Datenverbindung entfernen | `remove_data_wire` |
| Baustein/Render-Zeile hinzufügen | `add_component` |
| Baustein/Render-Zeile bearbeiten | `update_component` plus `upsert_state_variable` für gebundene Daten |
| Baustein/Render-Zeile entfernen | `remove_component` |
| Render-Zeilen/Schaltflächen/Bausteine sortieren | `reorder_components` |
| Übergangsschaltfläche im Render platzieren | `add_component` mit `type: transitionButton` |
| Eingangs-/Ausgangs-Proxies einer Ebene setzen | `set_boundary` |
| Zustände gruppieren | `state_blueprint_apply_commands` mit `graph.collapse_to_parent` |
| Zustände auflösen | `state_blueprint_apply_commands` mit `graph.degroup_parent` |
| Vertrag validieren | `state_blueprint_validate` |

Reine Editor-Sitzungsfunktionen wie Hover, Auswahl, Box-Auswahl, Pan, Zoom,
Undo, Redo und Preview-Pause sind keine persistenten Modell-Änderungen.
Automatisierung sollte Dry-Runs, `get_model` und explizites Ersetzen nutzen,
wenn sie eine eigene Historie braucht.

## Vertragsprüfungen

Vor dem Schreiben lehnt die API diese Fälle ab:

- Übergänge, deren Endpunkte nicht existieren.
- Übergänge über Ebenen hinweg ohne Boundary-Proxies.
- Komponentenlokaler Zustand wie `html`, `localState`, `stateStore` oder `store`.
- Datentyp-Einträge ohne passendes `state.data`.
- Datenverbindungs-Komponenten, die auf fehlende Verbindungen zeigen.
- Übergangsschaltflächen, die auf fehlende Übergänge zeigen.
- nicht lokale `path`-Werte in `state.data`-Deklarationen.
- nackte Modelle, Definitionen oder falsche Schema-Versionen als MCP-Workspace.
- entfernte Aktions-, Befehls- und Aliasfeldformen; es gibt keine Kompatibilitätsaliasse.

Ein lokaler Deklarationspfad wie `email` wird in `state.data` gespeichert. Die
Runtime stellt ihn genau einmal unter `states.<stateId>.email` bereit; es
entsteht kein zweiter veränderlicher Zustand.

Empfohlener Schreibablauf für Agenten:

1. `state_blueprint_get_model` mit Validierung aufrufen.
2. Eine kleine Aktionsliste bauen.
3. `state_blueprint_apply_actions` mit `dryRun: true` aufrufen.
4. `validation.ok`, `issues` und `warnings` prüfen.
5. Dieselbe Aktionsliste ohne `dryRun` anwenden.
6. `state_blueprint_validate` aufrufen.

