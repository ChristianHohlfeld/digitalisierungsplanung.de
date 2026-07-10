# Zustand-Vertrag

Status: normativ

Schema: State Blueprint Version 2

Stand: 2026-07-10

Dieses Dokument ist der schriftliche Vertrag von Zustand / Digitalisierungsplanung.
Es beschreibt die Invarianten, die Editor, Runtime, Export, API, MCP und
Realtime-Transport gemeinsam einhalten muessen. Die Tests sind die ausfuehrbare
Absicherung dieses Vertrags.

## 1. Normative Sprache und Geltung

- **MUSS** und **DARF NICHT** bezeichnen ausnahmslose Vertragsregeln.
- **SOLL** bezeichnet eine Regel, von der nur mit dokumentiertem Grund
  abgewichen werden darf.
- **DARF** bezeichnet erlaubtes, aber nicht erforderliches Verhalten.
- Jede Regel besitzt eine stabile Vertrags-ID. Tests und Aenderungen SOLLEN
  diese ID nennen, wenn sie eine Regel konkret absichern oder veraendern.
- Ein Widerspruch zwischen Dokument, Test und Implementierung ist ein Fehler.
  Eine beabsichtigte Vertragsaenderung MUSS Dokument, Tests und Implementierung
  gemeinsam aendern.
- Ein bestehender Test DARF NICHT abgeschwaecht, mit Wiederholungen verdeckt oder
  auf ein Implementierungsdetail umgebogen werden, nur damit ein Fehler gruene
  Ergebnisse liefert.
- Nicht normative Produktideen stehen am Ende dieses Dokuments und duerfen
  bestehende Vertragsregeln nicht stillschweigend veraendern.

## 2. Begriffe und Wahrheiten

- **SYS-001 Strukturelle Wahrheit:** Das kanonische JSON-Modell ist die einzige
  persistierte Wahrheit ueber Zustaende, Uebergaenge, Ausloeser, Bedingungen,
  Daten-Deklarationen, Darstellung, Reihenfolge, Verschachtelung und Boundary.
- **SYS-002 Laufzeit-Wahrheit:** Der globale JSON-Zustands-/Ereignisbus ist die
  einzige veraenderliche Wahrheit ueber fachliche Laufzeitdaten und Ereignisse.
- **SYS-003 Projektionen:** DOM, SVG, Vorschau, Inspektor, Host-Snapshot,
  Exportansicht und Realtime-Konsole sind Projektionen. Sie DUERFEN NICHT als
  zweite fachliche Wahrheit verwendet werden.
- **SYS-004 Datenfluss:** Der verbindliche Datenfluss lautet:

  ```text
  kanonisches Modell
    -> globaler JSON-Zustands-/Ereignisbus
    -> FSM-Runtime
    -> DOM-/SVG-Projektion
  ```

- **SYS-005 Kein Schattenzustand:** Ablauf oder fachliche Daten DUERFEN NICHT
  ausschliesslich im DOM, in Komponenten, Vorlagen, HTML-Fragmenten, Closures,
  Cache-Objekten, Host-Snapshots oder parallelen Stores leben.
- **SYS-006 Editor-Sitzung:** Auswahl, Hover, Fokus, geoeffnete Ebene,
  Zwischenablage, Undo/Redo, Panelgroessen und mobile Ansicht sind
  Editor-Sitzungszustand. Sie DUERFEN die fachliche Bedeutung des Modells nicht
  veraendern.

## 3. Kanonisches Modell und Persistenzgrenze

- **MOD-001 Version:** Ein kanonisches Modell MUSS `version: 2`, einen Namen,
  `initial`, `states` und `transitions` besitzen. Eine leere Definition mit
  `initial: ""`, `states: []` und `transitions: []` ist gueltig.
- **MOD-002 Normalisierung:** Jeder Schreibweg MUSS vor Persistenz normalisieren
  und danach validieren. Editor, API und MCP MUESSEN dieselben Invarianten
  anwenden.
- **MOD-003 Keine undefinierten Werte:** `undefined` DARF weder im Modell noch im
  Bus, Export oder Storage persistieren. Leere Werte MUESSEN als `""`, `false`,
  `0`, `null`, `[]` oder `{}` bewusst dargestellt oder entfernt werden.
- **MOD-004 Verbotene Modellfelder:** Das kanonische Modell DARF insbesondere
  keine `editorGroups`, Realtime-Katalogkopie, Provider-/Transportkonfiguration,
  Runtime-Historie, Runtime-Kontextkopie, `localState`, `stateStore`, `store`
  oder komponentenlokales `html` enthalten.
- **MOD-005 Alte Aliase:** Entfernte Aliase und Fallback-Felder DUERFEN NICHT im
  kanonischen Modell oder Export fortleben. Dazu gehoeren insbesondere
  automatische `body`-Migrationen, alte Trigger-Aliase, `dataWireId`-Aliase,
  lokale Fetch-Aliase und versteckte Child-Outlet-/Passive-Render-Konstrukte.
- **MOD-006 Legacy-Body:** Ein eingelesenes, nicht unterstuetztes `body`-Feld
  DARF NICHT stillschweigend in eine Komponente oder sichtbaren Inhalt
  umgewandelt werden.
- **MOD-007 Referenzintegritaet:** Jede persistierte Referenz MUSS auf ein
  vorhandenes Objekt des richtigen Typs zeigen. Ungueltige Transition-Endpunkte,
  Data-Wire-Platzhalter und Transition-Button-Platzhalter MUESSEN abgelehnt,
  entfernt oder eindeutig repariert werden.
- **MOD-008 Loeschkaskade:** Beim Loeschen eines Zustands MUESSEN ungueltig
  gewordene Transitionen, deklarierte Zustandsdaten und zugehoerige Referenzen
  entfernt oder vertragskonform neu verdrahtet werden.
- **MOD-009 UI-Persistenz:** Kamera und ausdruecklich exportierbare
  Ansichtsmetadaten DUERFEN ausserhalb des fachlichen Modells gespeichert werden.
  Panelgroessen, Auswahl und Vorschau-Zustand DUERFEN NICHT in das fachliche
  Modell gelangen.

## 4. IDs und Namensraeume

- **ID-001 Globaler Entitaetsraum:** Zustands-IDs und Transition-IDs teilen
  genau einen globalen Namensraum. Keine Zustands-ID darf einer Transition-ID
  entsprechen.
- **ID-002 Eindeutigkeit:** Jede erzeugte oder importierte Entitaets-ID MUSS nach
  Normalisierung global eindeutig sein.
- **ID-003 Reservierte Runtime-IDs:** IDs mit dem Praefix `__runtime_` sind fuer
  abgeleitete Runtime-Aktionen reserviert und DUERFEN NICHT als formale
  Zustands- oder Transition-IDs gespeichert werden.
- **ID-004 Boundary-IDs:** Explizite Boundary-Verbindungen duerfen stabile IDs
  wie `boundary-flow:<scope>:<side>` verwenden. Sie bleiben echte
  Modellreferenzen und DUERFEN NICHT mit Nutzerentitaeten kollidieren.
- **ID-005 Anzeige und Bindung:** Sichtbarer Text, Titel und Label sind Anzeige.
  Ausschliesslich IDs sind Bindung.
- **ID-006 Kopieren und Vorlagen:** Kopieren, Duplizieren, Preset-Drop,
  Gruppieren und Import MUESSEN fuer jede neue Entitaet kollisionsfreie IDs und
  intern konsistente Referenzen erzeugen.

## 5. Zustaende und Zustandsdaten

- **STA-001 Zustand:** Ein Zustand ist eine explizite FSM-Entitaet und eine Sicht
  auf den fuer ihn relevanten Ausschnitt des globalen Busses.
- **STA-002 Datenscope:** Deklarierte fachliche Daten eines Zustands MUESSEN
  kanonisch unter `states.<stateId>.*` liegen.
- **STA-003 Pfadnormalisierung:** Unqualifizierte Zustandsvariablen,
  Transition-Bedingungen und Transition-`set`-Pfade MUESSEN auf den Scope des
  Quell- beziehungsweise Besitzerzustands normalisiert werden.
- **STA-004 Typen:** Deklarierte Eintraege in `dataTypes` MUESSEN zu vorhandenen
  Zustandsdaten passen. Unterstuetzte Typen muessen im Editor und in der Runtime
  konsistent interpretiert werden.
- **STA-005 Eintrittswerte:** Zustands-Defaults duerfen erst beim aktiven Eintritt
  dieses Zustands in den Bus gelangen. Preset-Daten und Daten in inaktiven
  Zustaenden DUERFEN den Runtime-Bus nicht vorab befuellen.
- **STA-006 Kein Ueberschreiben:** Eintrittswerte DUERFEN bereits vorhandene
  Buswerte nicht ueberschreiben. Insbesondere MUSS ein zuvor ausgefuehrtes
  Transition-`set` gegenueber einem Default erhalten bleiben.
- **STA-007 Deklarierte externe Writes:** Externe Ereignisse und Widgets DUERFEN
  nur in deklarierte, fuer sie gebundene Zustandsdaten schreiben. Sie DUERFEN
  keine beliebigen neuen Buspfade erzeugen.
- **STA-008 Laufende Eingaben:** Ein Re-Render oder eine Bearbeitung des aktuell
  aktiven Zustands DARF bestehende Runtime-Eingaben nicht loeschen. Nur ein
  ausdruecklicher Reset darf sie zuruecksetzen.
- **STA-009 Abonnements:** `subscriptions` beschreiben gelesene Buspfade. Das
  Hinzufuegen einer Darstellung oder eines Data Wires DARF Abonnements nicht
  als versteckten Schreibkanal missbrauchen.
- **STA-010 Runtime-Steuerung:** Globale Runtime-Steuerung lebt im Bus, zum
  Beispiel `runtime.paused`; es DARF keine zweite lokale Variable wie
  `runtimePaused` geben.
- **STA-011 Host-Snapshot:** `latestRuntimeContext` und vergleichbare
  Host-Snapshots sind nur lesende Momentaufnahmen. Sie DUERFEN weder das Modell
  noch Zustandsdefaults veraendern oder persistieren.

## 6. Uebergaenge und Ereigniskausalitaet

- **TRN-001 Echte Kante:** Ein Uebergang MUSS eine eindeutige ID sowie vorhandene
  `from`- und `to`-Zustaende besitzen.
- **TRN-002 Aktive Quelle:** Ein Uebergang darf nur feuern, wenn seine effektive
  Quelle im aktuellen Runtime-Kontext aktiv und erreichbar ist.
- **TRN-003 Ausloeser:** Ein Uebergang startet nur durch seinen deklarierten
  Ausloeser. Vertragsrelevante Typen sind `button`, `timer`, `change`, `event`,
  `realtime` und `immediate`.
- **TRN-004 Button-Ereignis:** Ein Button-Uebergang bindet ueber seine
  `transitionId` und das Ereignis `button.<transitionId>.clicked`. Sein Label
  ist ausschliesslich Anzeige.
- **TRN-005 Keine Inferenz:** Weder Label, sichtbarer Text, Reihenfolge,
  `set`-Pfad noch Datenwert darf verwendet werden, um einen Uebergang zu erraten.
- **TRN-006 Bedingung:** Eine Bedingung liest ausschliesslich aus dem globalen
  Bus. Sie entscheidet nach Eingang des passenden Ausloesers, ob der Uebergang
  feuern darf.
- **TRN-007 Wirkung:** `set` beschreibt ausschliesslich die Buswirkung eines
  erfolgreich ausgeloesten Uebergangs. `set` DARF NICHT als UI-Bindung oder
  Triggerquelle dienen.
- **TRN-008 Reihenfolge:** Ein akzeptierter Ausloeser wird gegen die aktive
  Quelle und Bedingung geprueft. Danach wird `set` ueber den autorisierten Bus
  geschrieben, der aktive Zustand gewechselt und der Zielzustand betreten.
  Ziel-Defaults DUERFEN die so geschriebenen Werte nicht ueberschreiben.
- **TRN-009 Keine versteckten Kanten:** Die Runtime DARF keine synthetischen
  `next`, Parent-Return-, Geschwister-, Child-Outlet- oder sonstigen fachlichen
  Uebergaenge erfinden.
- **TRN-010 Sichtbarkeit:** Sichtbare normale Button-Uebergaenge MUESSEN als
  echte, aktivierbare Controls rendern. Timer-, Change-, Realtime- und andere
  automatische Uebergaenge DUERFEN NICHT als irrefuehrende Buttons erscheinen.
- **TRN-011 Mehrfachausgaenge:** Mehrere ausgehende Button-Uebergaenge MUESSEN
  ihre eigenen IDs, Ziele, Ereignisse und Farben behalten.
- **TRN-012 Vertrauensgrenze:** Synthetisch erzeugte DOM-UI-Events DUERFEN keine
  fachliche Buswirkung oder Transition committen. Echte Nutzer-Clicks und
  Nutzereingaben MUESSEN ueber den Bus verarbeitet werden.
- **TRN-013 Schreibautorisierung:** Runtime-Writes MUESSEN ueber den zentralen
  Bus und dessen Quellen-/Tokenpruefung laufen. Direkte Kontextzuweisungen sind
  ausserhalb der Bus-Interna verboten.
- **TRN-014 Pause:** `runtime.paused` MUSS automatische Fortsetzungen, Timer und
  Change-Verarbeitung stoppen und anstehende automatische Arbeit verwerfen.
  Beim Fortsetzen DUERFEN keine veralteten Ereignisse nachgeholt werden.

## 7. Verschachtelung und Boundary

- **NEST-001 Echte Eltern:** Gruppierte oder zusammengesetzte Ablaeufe MUESSEN
  durch einen echten Parent-Zustand und echte Child-Zustaende mit `parentId`
  dargestellt werden. `editorGroups` ist verboten.
- **NEST-002 Exakte Ebene:** Ein Child gehoert genau zur Ebene seines Parents.
  Editor und Runtime MUESSEN beim aktiven Child diese Ebene anzeigen und
  Zustaende anderer Ebenen ausblenden.
- **NEST-003 Parent ist sichtbar:** Ein Parent ist selbst ein echter
  Runtime-Zustand und MUSS seine eigene Darstellung zeigen koennen, bevor ein
  expliziter Boundary-Eintritt aktiviert wird.
- **NEST-004 Eintritt:** `boundary.entryId` bezeichnet den echten Child-Eintritt.
  Ein manueller Eintritt wird als explizite Aktion angeboten. Nur eine
  ausdrueckliche Konfiguration wie `entryTriggerType: "auto"` darf den Parent
  automatisch in sein Entry-Child weiterfuehren.
- **NEST-005 Wiedereintritt:** Wird ein Parent erneut betreten, MUSS sein
  Boundary-Eintritt wieder am konfigurierten Entry-Child beginnen; ein zuvor
  aktives tieferes Child darf nicht stillschweigend fortgesetzt werden.
- **NEST-006 Interner Ablauf:** Child-zu-Child-Verbindungen sind echte
  Transitionen innerhalb derselben Ebene. Wires DUERFEN nicht unbemerkt ueber
  Ebenengrenzen springen.
- **NEST-007 Ausgang:** `boundary.exitId` bezeichnet das Child, an dem echte
  Parent-Ausgaenge projiziert werden duerfen.
- **NEST-008 Ausgangsprojektion:** Am Exit-Child MUESSEN zuerst dessen eigene
  ausgehende Aktionen und danach die echt verdrahteten Parent-Ausgaenge
  erscheinen.
- **NEST-009 Kein impliziter Ausgang:** Ein Child ohne konfigurierten Ausgang
  DARF keine Parent-Ausgaenge, Geschwisteraktionen oder Rueckkehr zum Parent
  erben.
- **NEST-010 Stopregel:** Besitzt ein Boundary-Ausgang keinen echten
  Parent-Uebergang, stoppt der Ablauf dort. Die Runtime DARF keinen Ersatzknopf
  oder Kreis zum Eingang erfinden.
- **NEST-011 Keine Boundary-Schaltflaeche:** Technische Boundary-Flow-Kanten
  DUERFEN nicht zusaetzlich als normale fachliche Buttons gerendert werden.
- **NEST-012 Umverdrahten:** Wird ein Parent-Ein- oder -Ausgang umverdrahtet,
  MUESSEN Projektion und Runtime unmittelbar auf die echte neue Referenz folgen.
- **NEST-013 Gruppieren:** Gruppieren beziehungsweise Collapse MUSS einen echten
  Parent erzeugen, eingehende und ausgehende Kanten ueber Entry und Exit
  verdrahten und rekursiv vorhandene Child-Strukturen erhalten.
- **NEST-014 Entgruppieren:** Degroup MUSS das Modell, die Entitaetsreihenfolge
  und die vorherige externe Verdrahtung exakt wiederherstellen; es darf keine
  Editor-Metadaten als fachliche Abkuerzung verwenden.
- **NEST-015 Boundary-Reparatur:** Nach Loeschen oder Verschieben eines
  verankerten Childs MUESSEN Boundary-Anker wiederverwendbar bleiben und auf
  einen gueltigen Endpunkt neu gesetzt oder explizit deaktiviert werden.

## 8. Darstellung und Render-Reihenfolge

- **REN-001 Reine Projektion:** Darstellung liest Modell und Bus. Sie DARF keine
  Ablaufentscheidung, fachlichen Daten oder Datenladeeffekte erfinden.
- **REN-002 Render-Eintraege:** Die sichtbare Reihenfolge besteht aus manuellen
  Komponenten sowie referenziellen Platzhaltern vom Typ `dataWire` und
  `transitionButton`.
- **REN-003 Referenzen statt Kopien:** Ein `dataWire`-Platzhalter speichert nur
  seine `wireId`; ein `transitionButton`-Platzhalter nur seine `transitionId`.
  Daten oder Transitionen DUERFEN nicht in den Platzhalter kopiert werden.
- **REN-004 Ordnung:** Unplatzierte Data Wires werden vor der expliziten
  Renderliste in ihrer Modellreihenfolge gerendert. Platzierte Komponenten,
  Data Wires und Transition-Buttons folgen danach exakt der Reihenfolge in
  `components`. Ein Uebergang darf hoechstens einmal sichtbar gerendert werden.
- **REN-005 Bearbeitbarkeit:** Render-Eintraege MUESSEN per Maus und Touch
  umsortierbar sein; die gespeicherte Reihenfolge und Runtime-Ausgabe MUESSEN
  unmittelbar uebereinstimmen.
- **REN-006 Data Wire:** Ein Data Wire ist eine lesende Zuordnung von
  `sourcePath` zu Darstellungsrolle und Komponententyp. Er DARF Quelldaten nicht
  kopieren und Abonnements nicht als Nebenwirkung veraendern.
- **REN-007 Kein Rehydrieren:** Wird eine Data-Wire-Darstellung geloescht, DARF
  sie nicht aus Repeat- oder Fetch-Heuristiken automatisch wieder erscheinen.
- **REN-008 Repeat:** Repeat-Quellen MUESSEN aus lesbaren, abgeleiteten
  Kandidaten explizit ausgewaehlt werden. Die Auswahl DARF NICHT als freier
  unvalidierter Pfad oder automatische Render-Zuordnung entstehen.
- **REN-009 Arraypfade:** Repeat-Data-Wires MUESSEN verschachtelte und
  arrayindizierte Item-Pfade, einschliesslich Bildpfaden, korrekt aufloesen.
- **REN-010 Kein Template-Fallback:** Sichtbare Datenabbildung DARF nicht auf
  versteckten `{{...}}`-Tokens, einem Template-Binding-Picker oder automatischer
  Repeat-Erkennung beruhen.
- **REN-011 Live-Synchronitaet:** Eine Komponentenbearbeitung MUSS sofort in
  Modell und Vorschau sichtbar werden, ohne den aktiven Runtime-Zustand neu zu
  laden.
- **REN-012 Externe Links:** Ein Link in der Editor-Vorschau DARF den
  eingebetteten Runtime-Flow nicht aus seinem Iframe herausnavigieren.
- **REN-013 Farben:** Jeder sichtbare Transition-Button MUSS exakt die Farbe
  seiner zugehoerigen Kante verwenden. Transition-Buttons DUERFEN keinen
  Farbverlauf verwenden.
- **REN-014 Saubere Runtime:** Generierte Nutzeroberflaechen DUERFEN keine
  Editor-Hilfetexte wie `No outgoing transitions`, keine Template-Tokens und
  keine nicht angeforderte Sound-/Vorleselogik anzeigen.

## 9. Fetch und automatische Effekte

- **FX-001 Entry-Effekt:** Fetch ist ein Effekt beim Eintritt in einen Zustand,
  nicht beim Rendern und nicht beim Lesen eines Caches.
- **FX-002 Scope:** Das Standardziel einer Datenquelle MUSS unter
  `states.<ownerStateId>.fetch` liegen. Jede Preset-Instanz MUSS einen eigenen
  Zustandszweig erhalten.
- **FX-003 Aktivierungsbindung:** Ein Fetch-Lauf MUSS an die konkrete Aktivierung
  seines Quellzustands gebunden sein.
- **FX-004 Veraltete Antworten:** Antwortet ein Fetch nach Verlassen oder neuer
  Aktivierung des Quellzustands, DARF sein Ergebnis weder Bus noch FSM
  veraendern.
- **FX-005 Ergebnisereignisse:** Fetch-Erfolg und Fetch-Fehler MUESSEN als
  explizite FSM-Ereignisse in den Bus eintreten. Nur Transitionen, die den
  aktiven Fetch-Kontext referenzieren, duerfen automatisch folgen.
- **FX-006 Wiederholung:** Konfigurierte Retries duerfen nur laufen, solange die
  zugehoerige Aktivierung aktiv ist. Erst nach dem letzten fehlgeschlagenen
  Versuch darf das endgueltige Fehlerereignis entstehen.
- **FX-007 Kein Fetch-Schattenzustand:** Es DARF keinen komponentenlokalen oder
  Host-seitigen `fetchRun`-/Cache-Zustand als zweite fachliche Wahrheit geben.
- **FX-008 Pause:** Waerend `runtime.paused` duerfen Fetch-, Timer-, Change- oder
  Immediate-Fortsetzungen nicht committen oder fuer spaeter aufgestaut werden.

## 10. DaisyUI-Bausteine und Presets

- **PRE-001 Katalog:** Ein Preset ist ein Katalogeintrag und besitzt ausserhalb
  des Canvas keine Runtime-Wirkung.
- **PRE-002 Materialisierung:** Erst beim Drop oder expliziten Hinzufuegen wird
  ein Preset als echter Zustand mit eigenem Scope `states.<stateId>.*`
  materialisiert.
- **PRE-003 Strukturierte Daten:** DaisyUI liefert Darstellung. Presets MUESSEN
  strukturierte Busdaten verwenden und DUERFEN weder Komponenten-`html` noch
  versteckte lokale Widget-Zustaende speichern.
- **PRE-004 Explizite Aktionen:** Interaktive Buttons, Karten, Heroes, Modals,
  Feature-Grids, Pricing-Karten, Breadcrumbs, Footer, Menues, Dropdowns,
  Bottom-Navigation, Drawer, Steps, Tabs, Navbar-Varianten, Checkboxen und
  Toggles duerfen Flow nur ueber explizite Transition-IDs ausloesen.
- **PRE-005 Text ist Anzeige:** Gleicher Text oder gleiches Label DARF keine
  Preset-Aktion an einen Uebergang binden. Ohne explizite ID bleibt das Element
  ohne FSM-Wirkung.
- **PRE-006 Autowiring:** Ein aktionsfaehiges Preset MUSS fuer jede fachliche
  Aktion echte Zielzustaende und echte Transitionen erzeugen. Alle Referenzen
  MUESSEN eindeutig und erreichbar sein.
- **PRE-007 Widget-Writes:** Eingaben und Widgets duerfen nur ihre gebundenen,
  deklarierten Felder wie `value`, `checked`, `selected`, `open`, `index` oder
  `finished` schreiben.
- **PRE-008 Countdown:** Countdown-Ende MUSS als Change-Ereignis auf dem
  deklarierten `finished`-Pfad modelliert sein.
- **PRE-009 Loading:** Das Loading-Preset MUSS als Timer-Uebergang mit 2000 ms
  modelliert sein und DARF keinen sichtbaren Transition-Button vortaeuschen.
- **PRE-010 Toast:** Toast MUSS als zeitgesteuerte Busnachricht ohne impliziten
  Button modelliert sein.
- **PRE-011 Checkbox/Toggle:** Bedingungen und Wirkungen von Checkbox und Toggle
  MUESSEN ausschliesslich deren scoped Zustandsfelder verwenden.
- **PRE-012 Preset-Qualitaet:** Jeder eingebaute Preset-Typ MUSS eindeutig
  benannt, mit nutzbaren Defaults gefuellt, ohne defekte Bilder renderbar und
  ohne horizontalen Seitenueberlauf nutzbar sein.
- **PRE-013 Offizielle Klassen:** Daisy-Presets MUESSEN die fuer ihre Variante
  vorgesehenen daisyUI-Klassen und strukturierten Datenformen verwenden.
  Entfernte Varianten und alte Navbar-Layouts DUERFEN NICHT wieder erscheinen.
- **PRE-014 Snapshots:** Gespeicherte Nutzer-Presets sind unabhaengige Snapshots.
  Sie DUERFEN weder ihre Quelle noch andere Instanzen nachtraeglich mutieren.
- **PRE-015 Transition-Drop:** Wird ein neuer Preset-Zustand auf eine vorhandene
  Transition gelegt, MUSS er in diese Transition eingesetzt werden. Die
  eingehende Transition behaelt ihre Identitaet; eine neue ausgehende
  Transition verbindet zum bisherigen Ziel.

## 11. Editor-Vertrag

- **ED-001 Gemeinsame Operationen:** Verschieben, Verbinden, Umverdrahten,
  Gruppieren, Entgruppieren, Loeschen, Kopieren, Einfuegen, Undo und Redo MUESSEN
  dieselben kanonischen Modelloperationen verwenden wie API und MCP.
- **ED-002 Neue Szene:** Eine neue Szene startet leer beziehungsweise mit dem
  vertraglich definierten frischen Starter und DARF keine Demo-Abkuerzungen
  enthalten.
- **ED-003 Demo-Laden:** Die Demo darf nur explizit oder ueber
  `?demo=zustand` geladen werden. Vorhandene Arbeit MUSS vor Ersetzen bestaetigt
  werden.
- **ED-004 Tastatur:** `Ctrl+N` oeffnet den App-Dialog und DARF keinen Browser-Tab
  oeffnen. `Ctrl+S` speichert eine formale Definition.
- **ED-005 Delete-Fokus:** `Delete` darf Graphentitaeten nur loeschen, wenn der
  Canvas fokussiert ist. In einem Texteditor bleibt Delete nativ. `Backspace`
  DARF niemals Graphentitaeten loeschen.
- **ED-006 Auswahl:** Leerer Einzelclick leert den Inspektorkontext; Pan startet
  keine unbeabsichtigte Deselektion. Shift-Click, Mehrfachauswahl und `Ctrl+A`
  MUESSEN deterministisch funktionieren.
- **ED-007 Transition-Auswahl:** Ein einzelner Click auf einen
  Transition-Handle waehlt aus und DARF keinen neuen Zustand erzeugen.
  Umverdrahten darf nur vom vorgesehenen Arrowhead/Pin und nicht vom Linienkoerper
  starten.
- **ED-008 Duplikate:** Ein normaler Verbindungsdrag DARF keine identische
  Duplikat-Transition erzeugen. Explizites Umverdrahten MUSS die Identitaet der
  bestehenden Transition erhalten.
- **ED-009 Undo/Redo:** Historie MUSS deterministisch sein, unveraenderte Saves
  duerfen keine zusaetzlichen Schritte erzeugen, und Wiederherstellung MUSS
  Modell sowie relevante Auswahl korrekt rekonstruieren.
- **ED-010 Fokus und Tabfolge:** Zustands-, Transition- und Runtime-Editoren
  MUESSEN eine vorhersehbare Tabfolge, Enter-Commit- und Escape-Semantik besitzen.
- **ED-011 Lokale UI:** Panelbreiten, Explorerzustand, Preview-Collapse und mobile
  Arbeitsansicht duerfen lokal persistieren, ohne das Modell zu veraendern.
- **ED-012 Responsive Bedienung:** Desktop, Tablet und Mobile MUESSEN Canvas,
  Presets, Editor und App erreichbar halten. Controls duerfen nicht ueberlappen,
  horizontal aus dem Viewport laufen oder durch Scrollbars verdeckt werden.
- **ED-013 Touch:** Touch-Drag, Long-Press, Double-Tap, Pinch-Zoom,
  Zwei-Finger-Pan und Touch-Reorder MUESSEN absichtlich unterscheidbar sein.
  Vertikales Preset-Scrollen DARF keinen Drag starten.
- **ED-014 Gestenabbruch:** Verlorenes `mouseup`, Pointer-Verlassen oder
  Fenster-Blur MUSS Drag, Pan, Connect und Rechteckauswahl sauber abbrechen.
- **ED-015 Keine Browser-Nebeneffekte:** Canvas und Vorschau MUESSEN
  unbeabsichtigte Textauswahl, Callouts und Browsernavigation verhindern, ohne
  legitime Eingaben unbenutzbar zu machen.
- **ED-016 Inspector:** State-, Render- und Datenbereiche MUESSEN unabhaengig
  einklappbar sein. Aktionen MUESSEN im Drawer bleiben; kompakte Controls duerfen
  nicht ueberlappen.
- **ED-017 Keine Rohdatenpflicht:** Der Hauptworkflow MUSS typisierte Variablen,
  Bedingungen, `set`, Repeat und Data Wires ohne verpflichtende Bearbeitung
  roher Buspfade oder Template-Tokens anbieten.
- **ED-018 JSON-Fehler:** Ungueltiges JSON in Daten- oder `set`-Editoren DARF das
  letzte gueltige Modell nicht ueberschreiben.

## 12. Canvas, Routing und Treffererkennung

- **CAN-001 Renderer:** State-Nodes werden als DOM-Elemente, Kabel, Ports,
  Arrowheads und Edge-Pins als SVG gerendert. Ein zusaetzlicher Canvas-Renderer
  DARF keine zweite interaktive Geometrie fuehren.
- **CAN-002 Koordinatensystem:** Nodes, SVG-Ports, Edge-Pins und Kabel MUESSEN
  dasselbe Weltkoordinatensystem verwenden und bei Drag sowie Release dieselbe
  Position besitzen.
- **CAN-003 Raster:** Nodes, Ports und Pfadpunkte MUESSEN exakt auf das
  Canvas-Raster einrasten.
- **CAN-004 Orthogonalitaet:** Transitionen MUESSEN orthogonale Pfade verwenden.
  Ein freier, ausgerichteter Pfad bleibt gerade; kleine Offsets verwenden kurze
  Vorwaertsbiegungen statt Schleifen.
- **CAN-005 Hindernisse:** Kabel MUESSEN sichtbare State-Bounding-Boxes mit dem
  vertraglichen Sicherheitsabstand, mindestens dem geprueften halben Raster,
  umgehen.
- **CAN-006 Lanes:** Gemeinsame Ein- und Ausgaenge MUESSEN unterscheidbare
  Pins/Lanes erhalten. Horizontale und vertikale Kabel duerfen nicht unlesbar
  uebereinander liegen.
- **CAN-007 Eingangsrichtung:** Arrowheads MUESSEN nach vertikalen Umwegen von
  links in den Eingangsport laufen.
- **CAN-008 Live entspricht Final:** Die Route waehrend eines Node-Drags MUSS
  geometrisch der Route unmittelbar nach Release entsprechen.
- **CAN-009 Drag-Performance:** Live-Routing DARF bei dichten Graphen keine
  vollstaendige dichte Grid-Suche pro Pointer-Frame ausfuehren.
- **CAN-010 DOM-Wiederverwendung:** Ein voller Redraw MUSS bestehende SVG-Wire-
  und Port-Elemente nach Moeglichkeit wiederverwenden. Eine reine
  Runtime-Kontextaenderung DARF keinen vollen Canvas-Redraw ausloesen.
- **CAN-011 Runtime-Markierung:** Aktiver Zustand, Eintritt, Austritt und
  Transition-Puls MUESSEN sichtbar unterscheidbar sein. Der Puls DARF keine
  frameweise DOM-Geometrieabfrage oder Style-Mutation verwenden.
- **CAN-012 Hit-Prioritaet:** Innerhalb der sichtbaren Flaeche eines State-Nodes
  MUSS der Node fuer Auswahl und Drag vor unsichtbaren Hitflaechen fremder
  `.edge-pin`, `.edge-tip-hit` oder `.svg-port` liegen. Edge-Hitflaechen DUERFEN
  keinen darunterliegenden fremden Node blockieren.
- **CAN-013 Port-Erreichbarkeit:** Die vorgesehene sichtbare Port-/Pin-Zone am
  Rand des eigenen Nodes MUSS weiterhin fuer Connect und Reroute erreichbar
  bleiben. Ein Drag deutlich innerhalb des Node-Koerpers MUSS den Node bewegen
  und DARF keine Verbindung starten.
- **CAN-014 Layout-Stabilitaet:** Titel, Statusbadges, Open-Aktion, Ports und
  Layer-Rahmen DUERFEN nicht inkonsistent ueberlappen. Lange Titel muessen wachsen
  oder kontrolliert auf zwei Zeilen begrenzt werden.

## 13. Speichern, Import und Export

- **EXP-001 Formale Definition:** Eine gespeicherte Definition MUSS
  `kind: "state-blueprint-definition"`, `schemaVersion: 2` und das normalisierte
  Modell enthalten.
- **EXP-002 Zulaessige Metadaten:** Eine formale Definition DARF Kamera und
  State-Presets enthalten. Sie DARF keine Undo-Historie, Zwischenablage,
  Runtime-Werte oder fluechtige Panelzustaende enthalten.
- **EXP-003 Roundtrip:** Speichern und erneutes Laden MUSS dasselbe normalisierte
  Modell, dieselben Render-Referenzen, Daten, Typen und Transitionen
  wiederherstellen.
- **EXP-004 Teilimport/-export:** Einzelne Zustandskomponenten, Presets und volle
  Definitionen MUESSEN ohne Verlust von Data Wires und Render-Reihenfolge
  importier- und exportierbar sein.
- **EXP-005 Standalone-HTML:** HTML-Export MUSS selbstenthalten, syntaktisch
  gueltig und ohne Editor-Helfer lauffaehig sein. Er MUSS das exportierte Modell
  verwenden und DARF nicht aus Local Storage auf ein anderes Modell fallen.
- **EXP-006 Script-Sicherheit:** Eingebettete Script-Endsequenzen MUESSEN so
  escaped werden, dass verschachtelte Skripte den Export nicht vorzeitig
  beenden.
- **EXP-007 Gleiche Runtime:** Vorschau, exportiertes HTML und MCP-HTML-Export
  MUESSEN dieselbe FSM-, Bus-, Boundary-, Fetch- und Render-Semantik verwenden.
- **EXP-008 Exportgestaltung:** Der aktuelle Standalone-Export verwendet den
  Dark-Contract mit `--bg: #020617`, `--primary: #38bdf8` und
  `Atkinson Hyperlegible`. Er DARF keine helle White-Card-Fallbackgestaltung und
  keine Speech-Synthesis-/Vorlesefunktion enthalten.
- **EXP-009 UTF-8:** Quellen und erzeugte Artefakte MUESSEN gueltiges, sauberes
  UTF-8 bleiben; fehlerhafte Doppeldecodierung ist verboten.

## 14. API- und MCP-Vertrag

- **API-001 Ein Modell:** API und MCP lesen und bearbeiten dasselbe kanonische
  Modell wie der visuelle Editor.
- **API-002 Keine DOM-Automation:** API- und MCP-Kommandos DUERFEN die
  Oberflaeche nicht durch DOM-Clicks steuern.
- **API-003 Kein zweiter Speicher:** Der MCP-Server darf einen konfigurierten
  Workspace persistieren, aber keinen abweichenden fachlichen Runtime-Speicher
  fuehren.
- **API-004 Schreibablauf:** Modellaktionen MUESSEN Abhaengigkeiten ordnen,
  normalisieren und validieren, bevor sie atomar persistiert werden.
- **API-005 Kommandos:** Editor-Kommandos fuer Szene, States, Transitionen,
  Variablen, Fetch, Repeat, Data Wires, Komponenten, Boundary, Auswahl, Ebene,
  Viewport, Copy/Paste, Gruppierung und Undo/Redo MUESSEN ueber Modell- und
  Session-Operationen statt DOM-Automation laufen.
- **API-006 Werkzeuge:** Der MCP-Vertrag umfasst mindestens
  `state_blueprint_get_model`, `state_blueprint_replace_model`,
  `state_blueprint_apply_actions`, `state_blueprint_apply_commands`,
  `state_blueprint_plan_prompt`, `state_blueprint_apply_prompt`,
  `state_blueprint_validate`, `state_blueprint_export_definition`,
  `state_blueprint_import_definition`, `state_blueprint_export_html`,
  `state_blueprint_action_catalog` und `state_blueprint_command_catalog`.
- **API-007 Prompt-Planung:** Prompt-Planung darf nur unterstuetzte Absichten in
  explizite vertragskonforme Aktionen uebersetzen. Timer, innere Zustaende,
  Workflows, Variablen und API-Listen MUESSEN dieselben Scopes, Boundary-Regeln
  und echten Transitionen erzeugen wie der Editor.
- **API-008 Plan vor Apply:** `plan_prompt` DARF das Modell nicht veraendern.
  `apply_prompt` MUSS den erzeugten Plan ueber die normale Aktionsvalidierung
  anwenden.
- **API-009 Exportgleichheit:** API-/MCP-Definition und HTML-Export MUESSEN den
  Editor-Exportvertrag einhalten.
- **API-010 Keine Editor-Gruppenaktionen:** Die API DARF keine fachlichen
  `editorGroup`-Abkuerzungen anbieten. Gruppierung erfolgt als echter Parent mit
  `parentId` und Boundary.

## 15. Realtime- und Server-Vertrag

- **RT-001 Transportrolle:** Der Realtime-Server ist ausschliesslich Transport,
  Katalog, Token-Aussteller und Testkonsole. Er persistiert keinen fachlichen
  Zustand und besitzt kein zweites Modell.
- **RT-002 Katalogquelle:** `/events` ist die Live-Quelle der erlaubten
  Realtime-Ereignisse. Der Katalog darf `bindings` beschreiben, wird aber nicht
  als `model.realtime` oder Provider-/Transportzustand im Modell gespeichert.
- **RT-003 Modellreferenz:** Das Modell speichert bei Bedarf nur
  `triggerType: "realtime"` und den konkreten `triggerEvent`-Namen.
- **RT-004 Namensraum:** Persistierte Realtime-Ereignisse beginnen mit
  `realtime.`. Ein generischer `event`-Trigger DARF die reservierten
  `button.*`- oder `realtime.*`-Namensraeume nicht beanspruchen.
- **RT-005 Bus-Eintritt:** Ein empfangenes Realtime-Ereignis MUSS ueber den
  globalen Bus in die Runtime eintreten. Nur deklarierte Bindings duerfen
  deklarierte `states.*`-Pfade schreiben.
- **RT-006 Host-Relay:** Der Host liest den Runtime-Kontext nur als Snapshot,
  relayed `lastEvent`, ignoriert Remote-Loops und DARF weder Modell noch
  Zustandsdefaults mutieren.
- **RT-007 Origins:** HTTP- und WebSocket-Browserzugriffe MUESSEN gegen die
  konfigurierte Origin-Allowlist geprueft werden.
- **RT-008 Raumtoken:** Wenn unsignierte Raeume deaktiviert sind, MUSS der
  WebSocket-Join ein gueltiges signiertes Raumtoken besitzen. `/token` darf nur
  fuer erlaubte Origins ausstellen und MUSS ohne Secret mit 503 fehlschlagen.
- **RT-009 Ereignisannahme:** WebSocket-`runtime.event` und `/emit` duerfen nur
  aktuell katalogisierte Ereignisse akzeptieren. Unbekannte Ereignisse MUESSEN
  abgelehnt werden.
- **RT-010 Emit-Schutz:** `/emit` MUSS das Emit-Secret pruefen. Die
  Browser-Konsole DARF dieses Secret nicht eingebettet ausliefern und speichert
  keine Payload serverseitig.
- **RT-011 Relay:** Ein akzeptiertes Runtime-Ereignis wird an andere Peers im
  selben Raum verteilt und DARF nicht an den Sender zurueckgespiegelt werden.
- **RT-012 Deduplizierung:** Gleiche oder alte Client-Sequenzen MUESSEN pro Raum
  und Client verworfen werden.
- **RT-013 Rate Limit:** Laute Clients MUESSEN rate-limitiert werden.
- **RT-014 Keine Modellwrites:** Nachrichten wie `graph.patch` und `snapshot`
  MUESSEN abgelehnt werden. Kanonische Modellwrites gehoeren ausschliesslich zur
  Modell-API.
- **RT-015 Oeffentliche Routen:** Nginx darf nur `/console.html`, `/healthz`,
  `/token`, `/events`, `/emit` und `/ws` an den lokalen Prozess auf
  `127.0.0.1:8788` weiterleiten. Nicht definierte Kernrouten wie `/`,
  `/catalog`, `/schema` und `/api` liefern 404.

## 16. Oeffentliche Demo und Produkt-Abnahme

- **DEMO-001 Modell:** Die eingebaute Website-Demo heisst `Zustand Beispiel`,
  startet in `site_home` und besitzt exakt diese neun Zustaende:

  ```text
  site_home
  site_features
  site_pricing
  site_checkout
  site_checkout_flow
  site_contact
  site_thanks
  site_login
  site_profile
  ```

- **DEMO-002 Boundary:** Die Root-Boundary der Demo verwendet
  `entryId: "site_home"` und `exitId: "site_thanks"`.
- **DEMO-003 Transitionen:** Die Demo besitzt exakt 47 Nutzer-Transitionen.
  Jede ID ist im gemeinsamen State-/Transition-Namensraum eindeutig, jedes Ziel
  existiert, jeder Zustand ist erreichbar und jede Transition besitzt
  `triggerType: "button"` sowie
  `triggerEvent: "button.<transitionId>.clicked"`.
- **DEMO-004 Sichtbare Ausloeser:** Jede der 47 Transitionen MUSS in ihrem
  effektiven Quellzustand genau als sichtbarer, aktivierter Control mit ihrer
  Vertrags-ID erreichbar sein.
- **DEMO-005 Traversierung:** Ein echter Nutzer-Click MUSS fuer jede
  Demo-Transition `current`, `previous` und `lastTransition` exakt auf die
  erwarteten IDs setzen. Alle neun Zustaende und alle 47 Transitionen MUESSEN
  vollstaendig click-traversierbar sein.
- **DEMO-006 Shell:** Die acht sichtbaren Seitenzustaende verwenden eine
  gemeinsame Navbar mit `Zustand`, `Start`, `Nutzen`, `Angebot`, `Kontakt` und
  `Konto` sowie einen Footer mit `Zustand GmbH` und fuenf gebundenen Aktionen.
- **DEMO-007 Fachablaeufe:** Start, Nutzen, Angebot, Anfrage, Kontakt, Danke,
  Konto und Profil MUESSEN ueber echte FSM-Transitionen funktionieren.
  Checkout schreibt den gewaehlten Plan und Abschluss in
  `states.site_thanks.order`; Login und Logout verwenden echte gebundene
  Transitionen.
- **DEMO-008 Kein Ueberlauf:** Demo-Seiten und Presets duerfen keinen relevanten
  horizontalen Seitenueberlauf erzeugen. Ein Zustandswechsel nach Scrollen MUSS
  die neue Seite oben beginnen.
- **DEMO-009 Root-Seite:** `index.html` ist der eigenstaendige Export dieser
  Demo, nicht der Editor. Sie MUSS ohne Editor-Controls laufen, auf
  `state.html?demo=zustand` als Werkzeug-Einstieg verweisen, Manifest und
  Share-Card laden und die getesteten Navigations-, Checkout- und Kontaktpfade
  ausfuehren.
- **DEMO-010 Manifest:** Das Webmanifest MUSS den Namen
  `Zustand Digitalisierungsplanung` ausliefern.

## 17. Ausfuehrbare Absicherung

- **TST-001 Testbestand:** Am Stand dieses Dokuments umfasst die ausfuehrbare
  Spezifikation 314 expandierte Playwright-Faelle in fuenf Spec-Dateien und 14
  Node-Server-Tests, insgesamt 328 Faelle.
- **TST-002 Smoke:** 214 Playwright-Faelle tragen `@smoke`. `npm test` prueft
  zuerst die 14 Server-Tests und danach diese 214 Smoke-Faelle.
- **TST-003 Vollstaendiger Lauf:** `npm run test:full` prueft alle 314
  Playwright-Faelle, aber nicht die Server-Tests. Der vollstaendige lokale
  Vertragslauf lautet daher:

  ```bash
  npm run test:server
  npm run test:full
  ```

- **TST-004 Keine Ausnahmen:** Vertrags-Specs DUERFEN nicht mit `skip` oder
  `only` im regulaeren Bestand verbleiben.
- **TST-005 Verhaltensbeweis:** Quelltext- und Stringpruefungen duerfen als
  Driftalarm dienen, ersetzen aber keinen Browser-Verhaltenstest fuer
  Nutzerinteraktionen.
- **TST-006 Regression:** Jeder behobene Nutzerfehler MUSS einen Test erhalten,
  der vor dem Fix am beobachteten Verhalten scheitert und nach dem Fix ohne
  Retry, Force-Click oder Sonderpfad besteht.

Abdeckungsbereiche:

| Datei | Verbindlicher Schwerpunkt |
| --- | --- |
| `tests/core-contracts.spec.js` | Modell-, Bus-, Runtime-, Render-, Boundary- und Source-Invarianten |
| `tests/state-tool.spec.js` | Editor, Canvas, Presets, Daten, Fetch, Mobile, Demo, Import und Export |
| `tests/nested-runtime-regressions.spec.js` | verschachtelte Runtime und Ebenenwechsel |
| `tests/state-blueprint-mcp.spec.js` | API-, MCP-, Prompt- und Workspace-Vertrag |
| `tests/root-page.spec.js` | oeffentlicher Standalone-Demoexport |
| `server/server.test.js` | Realtime-Transport, Auth, Katalog und Nginx-Grenze |

## 18. Bekannte noch nicht ausfuehrbar geschlossene Luecke

- **GAP-001 SVG-Hit-Prioritaet:** `CAN-012` ist fachlich verbindlich, besitzt
  aber noch keinen vollstaendigen Regressionstest fuer einen Edge-Pin oder Port,
  dessen unsichtbare Hitflaeche ueber einem fremden State liegt.
- Der vorhandene Geometrietest prueft die gemeinsame Weltposition von Node,
  SVG-Port und Edge-Pin sowie Node-Dragging nahe dem eigenen Port.
- Der vorhandene SVG-Test prueft Pfad-, Port- und Pin-Koordinaten.
- Noch erforderlich ist ein Browser-Test, der einen fremden Edge-Pin gezielt
  ueber einem State platziert und mit `elementFromPoint`, einfachem Click und
  Drag beweist, dass der State beim ersten Versuch gewinnt und der Port an
  seiner vorgesehenen Zone dennoch erreichbar bleibt.
- Der aktuelle Demo-Traversal verwendet bis zu drei koordinatenbasierte
  Click-Versuche und danach einen Locator-Fallback. Das beweist letztendliche
  Erreichbarkeit, aber nicht deterministische Hit-Erkennung beim ersten Click.
  Fuer `CAN-012`, `DEMO-004`, `DEMO-005` und `TST-006` ist deshalb ein
  retryfreier Regressionstest erforderlich.

## 19. Nicht normative Richtung

Diese Punkte beschreiben moegliche Weiterentwicklung und sind kein bestehender
Abnahmevertrag:

- visuelles Verbinden von Datenpfaden und Darstellungsbausteinen,
- staerkere Typ-, Wertebereichs- und Schema-Pruefung des globalen Datenbaums,
- einfachere Auswahl von Datenkonstellationen fuer Change-Uebergaenge,
- ein Preset-Designer fuer vollstaendig vertragskonforme DaisyUI-Bausteine,
- vollstaendige, nachvollziehbare und testbare API-Steuerung jeder Editoraktion.
