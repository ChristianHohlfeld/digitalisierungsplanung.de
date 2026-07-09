# Zustand-Kontrakt

Dieses Dokument ist der schriftliche Kontrakt für Zustand und Digitalisierungsplanung. Es beschreibt, was die Maschine ist, was sie niemals tun darf und welche Regeln Editor, Laufzeit, Presets, Render, API und Tests schützen müssen.

## Grundprinzip

Es gibt genau einen lebenden Anwendungszustand:

```text
globalState
```

Das JSON-Modell beschreibt States, Transitionen, Render-Reihenfolge, Bus-Defaults, Subscriptions, Komponenten-Bindings und Presets. Die Laufzeit hält ein einziges veränderbares Objekt, `globalState`, und wendet die Modellregeln als Lese- und Schreiboperationen auf dieses Objekt an.

Nichts, was Daten oder Ablauf beeinflusst, darf nur im DOM, in einem Komponenten-Cache, in Preset-HTML, in einem Widget-Store oder in einer zweiten Datenhaltung leben.

## FSM-Kontrakt

- Ein State ist eine Sicht auf eine relevante Konstellation des globalen JSON-Baums.
- Ein State darf UI rendern, Bus-Pfade abonnieren und ausgehende Transitionen anbieten.
- Eine Transition ist eine echte Kante im Modell und verbindet existierende States.
- Transitionen werden durch explizite Events, Timer, Auto-Trigger oder Bus-Änderungen ausgelöst.
- Transition-Conditions lesen ausschließlich aus `globalState`.
- Transition-`set`-Patches schreiben ausschließlich in `globalState`.
- Der aktive State ist selbst Bus-Daten: `state.current`, `state.previous` und `state.lastTransition`.
- Wenn ein aktiver State keinen echten Out hat, stoppt die Maschine.
- Wenn ein Child nur bis zum Parent-Out-Proxy kommt, der Parent aber keine echte folgende Transition hat, stoppt die Maschine ebenfalls.
- Parent/Child-Flows verwenden Boundary-Proxies als Referenzen auf echte Parent-Kanten, nicht als kopierte States und nicht als magische Rückwege.

## Daten-Contract

- `state.data` ist eine Modell-Deklaration für Form, Defaults und Scope im globalen Bus.
- `state.data` ist kein zweiter Laufzeit-Store.
- Neue State-Variablen müssen eindeutig unter dem Scope des owning States liegen, normalerweise `states.<stateId>.*`.
- Unqualifizierte Pfade werden beim Schreiben durch API oder Preset-Instanziierung in den State-Scope normalisiert.
- `undefined` ist als persistierter Kontrakt-Wert verboten.
- Bedeutungsvolle leere Werte müssen explizit sein, zum Beispiel `""`, `false`, `0`, `[]` oder `{}`.
- Entfernte Canvas-States entfernen auch ihre deklarierten state-scoped Bus-Beiträge.
- Presets sind Katalogeinträge. Sie erzeugen erst Live-Daten, wenn sie als echter State auf den Canvas gelegt werden.
- Interaktive Werte leben im Bus. Components dürfen keine private Kopie ihrer gebundenen Daten führen.

## Render-Kontrakt

- Render ist eine Sicht auf JSON-Modell und `globalState`.
- Render darf keine Fetches starten.
- Render darf keine Flow-Entscheidungen erzeugen.
- Render darf keine Modelldaten erfinden.
- Render-Reihenfolge ist Modelldaten und muss im State-Inspector bearbeitbar bleiben.
- Transition-Buttons sind Render-Einträge, wenn sie in der Vorschau sichtbar sind.
- Data-Wires sind Render-Einträge, wenn sie sichtbaren Output beeinflussen.
- Komponenten dürfen nur explizite Bus-Pfade lesen oder schreiben.
- Text ist Darstellung. IDs sind Bindung. Labels dürfen niemals entscheiden, welche Transition feuert.

## DaisyUI-Kontrakt

DaisyUI ist Skin und Widget-Renderer, nicht die Wahrheit.

- Daisy-Presets speichern strukturierte JSON-Daten, keine HTML-Blobs als Logik.
- Daisy-Components binden über explizite `dataPath`-Werte an den Bus.
- Buttons, Links, Menüeinträge, Step-Items und Footer-Links feuern Flow nur über explizite `transitionId`.
- `transition.set` beschreibt Wirkung nach einem Event. Es darf niemals bestimmen, welcher Button eine Transition bekommt.
- Inputs schreiben explizit gebundene Bus-Felder wie `value`, `checked`, `selected` oder `open`.
- Dropdowns, Modals, Drawer, Tabs und Toggles dürfen nur dann semantischen Zustand haben, wenn dieser im Bus liegt.
- Rein kosmetische Hover- und Fokuszustände dürfen lokal bleiben.

## Editor-Kontrakt

- Der Editor bearbeitet ausschließlich das JSON-Modell.
- Die Vorschau läuft mit demselben Modell gegen dieselbe Laufzeit-Logik.
- Fetch ist ein Entry-Effekt eines States und schreibt in konfigurierte Bus-Ziele.
- Repeat-Pfade und Render-Mappings sind explizite User-Entscheidungen.
- Automapping darf Kandidaten anzeigen, aber nichts erraten und persistieren.
- Presets im Explorer sind wiederverwendbare Modellvorlagen, keine Laufzeit-Caches.
- Gruppen, Collapse und Nested States dürfen den echten FSM-Flow nicht verändern. Sie ordnen oder strukturieren nur den bestehenden Drahtpfad.

## Proxy- und Nested-Kontrakt

- Parent-IN führt in den Child-Entry des Parents.
- Child-States laufen entlang ihrer echten Transitionen.
- Child-OUT führt nur dann weiter, wenn der Parent an seinem Out eine echte folgende Transition hat.
- Es gibt keinen automatischen Child-zurück-zum-Parent-Button.
- Es gibt keinen Loop von Proxy-Out zurück zum Proxy-In, solange er nicht als echte Transition im Modell existiert.
- Boundary-Anker müssen auch nach Löschen von States oder Transitions bestehen bleiben, damit der Flow reparierbar bleibt.

## API- und MCP-Kontrakt

- Die MCP/API-Schicht bearbeitet dasselbe kanonische JSON-Modell wie der Editor.
- API-Aufrufe klicken nicht die UI.
- API-Aufrufe halten keinen zweiten Laufzeit-Store.
- `state_blueprint_apply_actions` wendet Aktionen in Kontrakt-Reihenfolge an, normalisiert und validiert vor dem Schreiben.
- `state_blueprint_export_html` muss dieselbe HTML-Laufzeit erzeugen wie der Export-Button im Editor.
- Natural-Language-Planung ist nur eine Komfortschicht über denselben Aktionen.
- Externe Agenten sollen immer lesen, planen, per Testlauf validieren und erst dann schreiben.

## Test-Kontrakt

Tests schützen Verhalten, nicht zufällige alte DOM-Struktur.

- Kontrakt-Tests haben Vorrang vor Momentaufnahmen.
- Tests dürfen nicht abgeschwächt werden, um Regressionen passend zu machen.
- Wenn ein Test auf altem Markup hängt, wird er auf den aktuellen öffentlichen Kontrakt umgestellt.
- Canvas-Connectoren, Boundary-Proxies, Nested Flow, Render-Reihenfolge, Bus-Schreibpfade und API-Export müssen direkt geschützt bleiben.

## Roadmap

- Visuelles DataWire-Tool: Bus-Pfade per Drag-and-drop auf Render-Komponenten verdrahten.
- Data-Design-Tool: Typen, Bounds, Null-Regeln, Wertebereiche und harte Kontrakt-Validierung.
- Subscription-Builder: Schlüssel-Schloss-UI für Datenkonstellationen, die States oder Transitionen wecken.
- Preset-Designer: DaisyUI-only, vollständig in FSM und Bus integriert.
- API-first-Automation: vollständige, dokumentierte Steuerbarkeit jeder Editor-Aktion über MCP/API.
