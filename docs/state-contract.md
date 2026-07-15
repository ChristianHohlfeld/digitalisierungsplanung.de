# Zustand Kernvertrag

Status: normativ
Schema: State Blueprint 2
Stand: 2026-07-15

Dieses Dokument ist die kanonische Kurzfassung des Produktvertrags. Editor,
MCP, Preview, Standalone-Export und Tests müssen dieselben Regeln anwenden.
[`../statereadme.md`](../statereadme.md) erläutert Architektur und Auditverlauf,
ist aber keine zweite Grammatik.

## 1. Prinzip

1. Das JSON-Modell ist die einzige persistierte Prozessstruktur.
2. Der globale JSON-Bus ist der einzige veränderliche Laufzeitzustand.
3. Canvas, Inspector, DOM, SVG, Preview und Server sind Projektion oder
   Transport. Sie besitzen keinen fachlichen Shadow State.
4. Ein State ist zugleich Prozessschritt und Renderfläche. Eine Transition ist
   der einzige Zustandswechsel.
5. Preview und Standalone-Export verwenden bytegleich dieselbe Runtime. Der
   Standalone-Export überspringt nur die Editor-Host-Kommunikation; Realtime und
   API bleiben produktive Runtime-Funktionen.

## 2. Eingabegrenze

- Rohdaten werden vor Normalisierung validiert.
- Ungültige Daten werden abgelehnt, niemals repariert, migriert, umbenannt oder
  still entfernt.
- Schema 2 besitzt keine Legacy-Aliasse oder Origin-Fallbacks.
- `null`, `undefined`, Array-Lücken, `NaN` und unendliche Zahlen sind als
  Buswerte verboten. Ein optionales Feld fehlt oder besitzt einen vollständig
  definierten JSON-Wert.
- IDs von States und Transitionen teilen sich einen globalen Namensraum.
- IDs und Triggeridentitäten sind eindeutig. Mehrere Transitionen dürfen
  dieselbe Quelle und dasselbe Ziel besitzen, wenn ihre Triggeridentitäten
  verschieden sind; die Route selbst ist keine Triggeridentität.

## 3. Formale Definition

Eine austauschbare Definition besitzt exakt:

```json
{
  "kind": "state-blueprint-definition",
  "schemaVersion": 2,
  "app": "Zustand",
  "savedAt": "ISO-8601",
  "model": {},
  "stateTemplates": [],
  "editor": {}
}
```

`stateTemplates` bleibt leer. Presets kommen ausschließlich aus dem zentralen
Product Contract. Interne Boundary-Projektionen werden nicht exportiert.

Das Modell besitzt `version: 2`, `name`, `initial`, `boundary`, `states` und
`transitions`. Eine leere Szene mit `initial: ""` ist gültig.

Ein State besitzt die kanonischen Felder:

```text
id, title, components, data, dataTypes, dataSource, repeat, dataWires,
subscriptions, boundary, parentId, x, y
```

Ein Transition besitzt die kanonischen Felder:

```text
id, from, to, label, condition, triggerType, triggerEvent, timerMs, set,
groupEntryId, groupExitId
```

`renderMode`, `body`, `editorGroups`, lokales Realtime, lokales Presetinventar,
`localState`, `stateStore`, `store`, komponentenlokales `html` und alte
Boundary-Felder sind verboten.

## 4. Datenbus

- Persistierte Defaults stehen relativ in `state.data` und verwenden lokale
  Identifier ohne Punkte.
- Die Runtime mountet sie einmal unter `states.<stateId>`; anschließend ist nur
  der globale Bus veränderlich.
- Laufzeitbindungen verwenden ausschließlich vollqualifizierte Pfade.
- Komponenten schreiben nur nach `states.<id>.<field>`.
- `transition.set` schreibt nur nach `states.<id>.<field>`.
- `dataPath`, `dataWires`, `repeat`, Conditions und Subscriptions lesen
  vollqualifizierte Pfade.
- Text bleibt literal. `{{...}}` und andere String-Interpolation sind verboten;
  dynamische Anzeige nutzt `dataPath` oder `dataWires`.
- Wird ein State gelöscht, wird sein gesamter Buszweig `states.<id>` entfernt.
- Ein typisierter `image`-Wert ist entweder eine öffentliche HTTP(S)-URL oder
  eine unterstützte Bild-Data-URI. Der Bild-Upload liest die gewählte lokale
  Datei einmal im Browser und schreibt diese Data-URI über denselben
  Autorenpfad als den kanonischen Bildwert; es entsteht kein Asset-Speicher und
  keine zweite Kopie.
- Beim Standalone-Export werden externe Bild-URLs ausschließlich in der
  abgeleiteten Exportkopie als Data-URI eingebettet. Modell und globaler Bus
  behalten ihren vorhandenen Wert unverändert.
- Eine Bild-URL ist ausschließlich die Quelle des gerenderten Bildes. Bilder
  erzeugen weder in der Preview noch im Standalone-Export implizite Links oder
  neue Tabs; Navigation benötigt eine ausdrücklich modellierte Link-Komponente
  oder Aktion.

Lesbare Wurzeln sind:

```text
states.<id>.*
state.current
runtime.paused
events.*
emitters.*
realtime.*
```

Externe `events`, `emitters` und `realtime`-Pfade müssen vom Product Contract
deklariert sein.

## 5. Trigger

Öffentliche Trigger-Typen sind:

| Typ | Identität |
| --- | --- |
| `button` | Transition-ID; erzeugt eine echte Schaltfläche |
| `change` | ein konkreter `change.<busPath>` |
| `event` | ein konkreter fachlicher Ereignisname außerhalb reservierter Namensräume |
| `realtime` | ein konkretes katalogisiertes `realtime.*`-Ereignis |
| `api` | exakt `fetch.<target>.success` oder `fetch.<target>.error` |
| `timer` | der eine Timer des wirksamen States |
| `auto` | die einzige ausgehende Transition des wirksamen States |

`flow` ist ausschließlich eine interne Boundary-Projektion und kommt in keiner
formalen Definition vor.

Jede Transition besitzt exakt einen Trigger. Ein State darf mehrere ausgehende
Transitionen besitzen, wenn ihre Triggeridentitäten verschieden sind.
Conditions gehören nicht zur Triggeridentität. Bei Realtime darf die
Identität zusätzlich einen formalen `triggerMatch` auf einem vom Product
Contract freigegebenen Event-Feld enthalten. Der Event-Katalog deklariert
`matchFields` immer explizit; fehlende Felder werden niemals aus `detail`
abgeleitet. `/contract` veröffentlicht die exakten Operatordefinitionen unter
`matchOperators` und die pro Feld erlaubten IDs unter
`matchFieldSchemas.<field>.operators`. Editor, Import und MCP dürfen keine
Operatoren aus dem Feldtyp ableiten oder ergänzen. Alle Realtime-Matches
desselben Events und derselben effektiven
Quelle müssen mathematisch disjunkt sein. Unterschiedliche Felder gelten als
potenziell überlappend. Ein Event ohne `triggerMatch` ist catch-all und darf
keine spezifischen Matches daneben haben. Der Editor deaktiviert bereits
belegte oder überlappende Optionen; Import, API und MCP lehnen Konflikte ab;
die Runtime arbeitet bei einem Fremdmodell fail-closed.

`triggerMatch` fehlt für einen Catch-all vollständig oder enthält `field`,
`operator` und `value` vollständig typisiert. Leere, teilweise, `null` oder
`undefined` gesetzte Match-Objekte sowie unbekannte Eigenschaften sind
ungültig und werden nicht normalisiert. Ein `between`-Wert enthält ausschließlich
`min`, `max` und optional die booleschen Werte `minInclusive` und
`maxInclusive`; beide Grenzen müssen innerhalb der Feld-Constraints liegen.

## 6. Conditions

Die einzige Grammatik ist:

```text
condition := or
or        := and ("||" and)*
and       := atom ("&&" atom)*
atom      := "true" | "false" | path | "!" path | path operator literal
operator  := "==" | "!=" | ">" | ">=" | "<" | "<="
literal   := boolean | finite-number | quoted-string
```

Numerische Operatoren verlangen eine Zahl. Boolesche Vergleiche verlangen
einen echten Boolean. `null`, `undefined`, freie Ausdrücke, Funktionsaufrufe,
Zuweisungen und implizite Typumwandlung sind verboten. Ungültige Conditions
werden an jeder Autoren- oder Importgrenze abgelehnt und in der Runtime niemals
ausgeführt.

## 7. API

Ein State mit `dataSource` startet beim Eintritt genau einen GET-Abruf mit
`cache: "no-store"`. Das Ergebnis wird unter dem deklarierten `target` in den
globalen Bus geschrieben.

- vollständig definierte JSON-Antwort: `fetch.<target>.success`
- HTTP-, Timeout-, JSON-, Select- oder Nullish-Fehler:
  `fetch.<target>.error`

Ein API-Ereignis ist ein echter Trigger und kein `change`-Alias. Ein generischer
`event`-Trigger darf den `fetch.*`-Namensraum nicht verwenden.

## 8. Verschachtelte FSM

- Parent und Child sind echte States in getrennten Canvas-Layern.
- Der Eintritt in einen Parent wählt niemals die erste, letzte oder geometrisch
  sortierte Transition. Eine ausgeführte Eingangstransition schreibt zuerst ihr
  `set` und verwendet danach ihr explizites `groupEntryId` oder andernfalls das
  exakt deklarierte `parent.boundary.entryId`.
- Ein direkter Editor-Klick führt keine erfundene Eingangstransition aus. Er
  behält den globalen Bus bei und startet den Parent über dessen deklarierte
  Boundary. Fehlt diese, findet kein automatischer Child-Eintritt statt und das
  Modell wird an der nächsten formalen Grenze abgelehnt.
- Ein Parent mit Children benötigt einen exakten direkten `boundary.entryId`
  oder ausdrücklich `entryDisabled: true`.
- Es gibt keine First-Child-Inferenz.
- Eine zusammengesetzte Preset- oder Importdefinition muss ihre interne
  `boundary.entryId` selbst enthalten. Materialisierung und Import ergänzen sie
  nicht nachträglich.
- Das erste in einem leeren Layer erzeugte Child darf als Teil derselben
  Autorenaktion als Entry und Exit gespeichert werden, solange die jeweilige
  Boundary nicht deaktiviert ist. Das gilt nur für die Boundary des bereits
  geöffneten, vor der Aktion leeren Layers; interne Boundaries eines
  zusammengesetzten Presets bleiben vollständig deklarationspflichtig.
  Vorhandene Referenzen werden nie repariert oder überschrieben.
- Wird ein deklarierter Boundary-State gelöscht oder aus dem Layer verschoben,
  wählt der Editor keinen Ersatz. Bei verbleibenden Children wird die betroffene
  Boundary geleert und explizit deaktiviert.
- Ein Initial-State kann bei verbleibenden States erst gelöscht werden, nachdem
  ein anderer Initial-State ausdrücklich gesetzt wurde.
- Gruppieren ohne explizite Boundary ist nur erlaubt, wenn der ausgewählte Graph
  genau eine Quelle und genau eine Senke besitzt.
- Eine generische Enter-Aktion feuert nur bei genau einer sichtbaren
  Button-Transition; bei mehreren Buttons ist ein konkreter Klick erforderlich.
- Beim Eintritt wird immer nur der aufgelöste aktive State gerendert. Parent-
  und Child-Inhalt werden niemals gemischt.
- Ein Child kann den Parent nur über die deklarierte Exit-Boundary verlassen.
- Ohne gültige innere oder äußere Verbindung stoppt der Ablauf.
- Ein bestätigter bewegungsfreier State-Klick zeigt noch im zugehörigen
  `pointerup` eine grüne Canvas-Rückmeldung. Diese Rückmeldung ist reine
  Interaktionsprojektion; ausschließlich die Runtime-Bestätigung darf einen
  State als aktiv markieren oder das Aktiv-Badge anzeigen.
- Auswahl, Layer-Follow, Undo und Redo verändern das Modell deterministisch;
  Drag und Scroll starten keine Runtime-Aktion.

## 9. Host und Runtime

- Nur das aktuell eingebundene App-Frame darf Runtime-Nachrichten liefern.
- Die Runtime akzeptiert Modellupdates nur vom zugehörigen Host.
- Window, exakte Origin und die aktuelle Frame-Session müssen übereinstimmen.
- Alte, fremde oder neu eingeschleuste Frames bleiben wirkungslos.
- Ein Frame-Reload erzeugt eine neue Session.
- Der Host erhält strukturierte Runtime-Nachrichten, aber keinen zweiten
  veränderlichen Laufzeitspeicher.
- Pause ist ein globaler Runtime-Wert für den Editor. Standalone-Seiten haben
  keinen Editor-Pause-Shortcut.

## 10. Realtime und Server

- `/contract` liefert den aggregierten Product Contract v2 für Trigger,
  Datentypen, Match-Operatoren, Datasets, Connectoren, Presets, Pakete und
  Pläne.
- `/events` liefert den kanonischen niedrigen Realtime-Katalog.
- Es gibt keinen Alias `/events/contract`.
- `/emit` und `/ws` akzeptieren nur katalogisierte Ereignisse.
- Der Server ist stateless Transport und besitzt weder Prozessmodell noch
  Runtime-Bus.
- Alle Antworten und statischen App-Dateien verwenden `no-store`; es gibt
  keinen Service-Worker-Fetch-Cache.
- `server/admin-tools.js` ist die Routenliste. Tests beweisen jede dort
  aufgeführte Route gegen Server und Nginx.

## 11. Absicherung

Vertragsänderungen müssen gemeinsam ändern:

1. Editor-Validierung und Autorenoberfläche,
2. MCP-Core und MCP-Import/Export,
3. eingebettete Preview-/Export-Runtime,
4. Product Contract beziehungsweise Event-Katalog,
5. Browser-, MCP- und Servertests,
6. dieses Dokument und betroffene API-Dokumentation.

Ein grüner Test ersetzt keine inhaltliche Vertragsprüfung. Tests müssen die
Invariante an mindestens einer ungültigen und einer gültigen Grenze beweisen.
