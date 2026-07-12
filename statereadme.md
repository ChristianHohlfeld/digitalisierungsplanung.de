# Zustand-Vertrag

Status: normativ

Schema: State Blueprint Version 2

Stand: 2026-07-12

Auditbasis: Repository-Commit `6db6c54`, Produktquellen zuletzt geändert in
`3ef5b0b`, gemeinsame Freigabe zu Auditbeginn `release-63`

Dieses Dokument ist der schriftliche Vertrag von Zustand / Digitalisierungsplanung.
Es beschreibt die Invarianten, die Editor, Runtime, Export, API, MCP und
Realtime-Transport gemeinsam einhalten müssen. Die Tests sind die ausführbare
Absicherung dieses Vertrags.

## 0. App-Prinzip und durchgängiger Systemfluss

- **PRN-001 Ausführbares Prozessmodell:** Zustand ist kein reiner
  Diagrammeditor. Die App modelliert einen fachlichen Prozess als ausführbare
  endliche Zustandsmaschine. Der Canvas ist die visuelle Autorenansicht dieses
  Programms; die generierte App führt dasselbe Programm aus.
- **PRN-002 Fachliche Zuordnung:** Ein State ist ein Prozessschritt und seine
  sichtbare Ansicht. Eine Transition ist der einzige erlaubte Wechsel. Ihr
  Trigger bestimmt die Ursache, ihre Condition die Zulassung und ihr `set` die
  Datenwirkung. Komponenten stellen Modell und Daten dar, dürfen aber keinen
  zweiten Ablauf erfinden.
- **PRN-003 Zwei Wahrheiten, klare Grenze:** Das normalisierte Modell ist die
  persistierte strukturelle Wahrheit. Der globale JSON-Bus ist die einzige
  veränderliche Laufzeit-Wahrheit. Editor-DOM, SVG, Vorschau, Inspektor,
  Host-Snapshot und Server sind ausschließlich Projektionen oder Transport.
- **PRN-004 Autorenfluss:** Jede fachliche Modelloperation MUSS das Modell
  ändern, normalisieren, in der Historie erfassen und persistieren; relevante
  Auswahl- und Ebenendaten gehören zum Sitzungssnapshot. Danach sendet der Host
  das Modell per `STATE_BLUEPRINT_MODEL` an die Vorschau. Eine DOM-Änderung
  allein ist keine Modelloperation. Rein lokale UI- und Kameraänderungen dürfen
  außerhalb der Modellhistorie persistieren.
- **PRN-005 Laufzeitzyklus:** Ein reales Nutzerereignis oder ein deklarierter
  automatischer beziehungsweise externer Trigger erzeugt ein Runtime-Ereignis.
  Die Runtime schreibt dessen Metadaten in den Bus, stellt es in die
  Ereigniswarteschlange, sucht im aktiven State-/Elternpfad passende
  Transitionen, wertet die Condition aus, wendet bei Erfolg `set` an, wechselt
  zum aufgelösten Ziel, führt Eintrittseffekte aus und rendert den neuen Stand.
- **PRN-006 Verschachtelte Prozesse:** Ein Parent ist ein echter State und seine
  Kinder sind eine echte innere Zustandsmaschine. Die Boundary ist die
  ausdrückliche öffentliche Ein-/Ausgangsschnittstelle des Parents. Ohne
  echten inneren oder äußeren Ausgang stoppt die Maschine.
- **PRN-007 Eine Runtime:** Editorvorschau, Standalone-HTML und die öffentliche
  Demo MÜSSEN aus demselben Modell und derselben generierten Runtime entstehen.
  `index.html` ist deshalb eine kompilierte Beispiel-App und keine getrennte
  Marketing- oder Ersatzimplementierung.
- **PRN-008 MCP als zweite Autorenoberfläche:** MCP ist eine headless
  Autoren- und Steueroberfläche für dasselbe Modell. Es darf Aktionen planen,
  ordnen, validieren, persistieren und exportieren, aber weder ein zweites
  Fachmodell noch eine abweichende Runtime-Semantik besitzen.
- **PRN-009 Realtime als Ereignistransport:** Realtime transportiert
  katalogisierte Runtime-Ereignisse zwischen Teilnehmern. Es synchronisiert
  keine Canvas-Operationen, Modell-Patches oder dauerhaften fachlichen Daten und
  ist daher keine kollaborative Modellbearbeitung.
- **PRN-010 Clientseitiger Kern:** Editor und Standalone-Runtime arbeiten
  clientseitig. Ein Server wird nur für bereitgestellte Netzfunktionen wie
  Realtime, Tokenausgabe, Katalog und externe Fetch-Ziele benötigt; er darf die
  lokale Modell- und Bushoheit nicht übernehmen.
- **PRN-011 Produktziel:** Ein digitalisierter Prozess ist erst dann vollständig
  beschrieben, wenn Ablauf, Daten, Darstellung, Seiteneffekte, Schnittstellen
  und Grenzen explizit im Modell liegen, im Browser beweisbar sind und ohne den
  Editor als eigenständige App exportiert werden können.

Der Hauptpfad des Systems lautet:

```text
Editoraktion
  -> normalisiertes Modell + Editorsitzung + Historie
  -> STATE_BLUEPRINT_MODEL
  -> generierte Runtime im Vorschau-Iframe
  -> Runtime-Ereignis -> Bus -> Transition -> Eintrittseffekt -> Render
  -> STATE_BLUEPRINT_RUNTIME_STATE
  -> nur lesender Host-Snapshot, Canvas-Markierung und optionales Realtime-Relay
```

## 1. Normative Sprache und Geltung

- **MUSS** und **DARF NICHT** bezeichnen ausnahmslose Vertragsregeln.
- **SOLL** bezeichnet eine Regel, von der nur mit dokumentiertem Grund
  abgewichen werden darf.
- **DARF** bezeichnet erlaubtes, aber nicht erforderliches Verhalten.
- Jede Regel besitzt eine stabile Vertrags-ID. Tests und Änderungen SOLLEN
  diese ID nennen, wenn sie eine Regel konkret absichern oder verändern.
- Ein Widerspruch zwischen Dokument, Test und Implementierung ist ein Fehler.
  Eine beabsichtigte Vertragsänderung MUSS Dokument, Tests und Implementierung
  gemeinsam ändern.
- Ein bestehender Test DARF NICHT abgeschwächt, mit Wiederholungen verdeckt oder
  auf ein Implementierungsdetail umgebogen werden, nur damit ein Fehler grüne
  Ergebnisse liefert.
- Nicht normative Produktideen stehen am Ende dieses Dokuments und dürfen
  bestehende Vertragsregeln nicht stillschweigend verändern.

## 2. Begriffe und Wahrheiten

- **SYS-001 Strukturelle Wahrheit:** Das kanonische JSON-Modell ist die einzige
  persistierte Wahrheit über Zustände, Übergänge, Auslöser, Bedingungen,
  Daten-Deklarationen, Darstellung, Reihenfolge, Verschachtelung und Boundary.
- **SYS-002 Laufzeit-Wahrheit:** Der globale JSON-Zustands-/Ereignisbus ist die
  einzige veränderliche Wahrheit über fachliche Laufzeitdaten und Ereignisse.
- **SYS-003 Projektionen:** DOM, SVG, Vorschau, Inspektor, Host-Snapshot,
  Exportansicht und Realtime-Konsole sind Projektionen. Sie DÜRFEN NICHT als
  zweite fachliche Wahrheit verwendet werden.
- **SYS-004 Datenfluss:** Der verbindliche Datenfluss lautet:

  ```text
  kanonisches Modell
    -> globaler JSON-Zustands-/Ereignisbus
    -> FSM-Runtime
    -> DOM-/SVG-Projektion
  ```

- **SYS-005 Kein Schattenzustand:** Ablauf oder fachliche Daten DÜRFEN NICHT
  ausschließlich im DOM, in Komponenten, Vorlagen, HTML-Fragmenten, Closures,
  Cache-Objekten, Host-Snapshots oder parallelen Stores leben.
- **SYS-006 Editor-Sitzung:** Auswahl, Hover, Fokus, geöffnete Ebene,
  Zwischenablage, Undo/Redo, Panelgrößen und mobile Ansicht sind
  Editor-Sitzungszustand. Sie DÜRFEN die fachliche Bedeutung des Modells nicht
  verändern.
- **SYS-007 Host-Runtime-Vertrauensgrenze:** Jede `postMessage`-Nachricht MUSS
  an die konkrete Vorschauinstanz gebunden sein. Der Host darf Runtime-
  Nachrichten nur von `frameEl.contentWindow` beziehungsweise dem ausdrücklich
  geöffneten Vorschaufenster annehmen; die Vorschau darf Hostbefehle nur von
  ihrem tatsächlichen Host annehmen. Eine fremde Child-, Sibling- oder Opener-
  Quelle DARF weder Modell, Runtime-Zustand, Realtime, Shortcuts noch externe
  Navigation beeinflussen. Wo wegen einer Blob-Origin `targetOrigin: "*"`
  technisch nötig ist, MUSS zusätzlich die Fensteridentität und eine pro
  Vorschauinstanz erzeugte Sitzungskennung geprüft werden.

## 3. Kanonisches Modell und Persistenzgrenze

- **MOD-001 Version:** Ein kanonisches Modell MUSS `version: 2`, einen Namen,
  `initial`, `states` und `transitions` besitzen. Eine leere Definition mit
  `initial: ""`, `states: []` und `transitions: []` ist gültig.
- **MOD-002 Normalisierung:** Jeder Schreibweg MUSS vor Persistenz normalisieren
  und danach validieren. Editor, API und MCP MÜSSEN dieselben Invarianten
  anwenden.
- **MOD-003 Keine undefinierten Werte:** `undefined` DARF weder im Modell noch im
  Bus, Export oder Storage persistieren. Leere Werte MÜSSEN als `""`, `false`,
  `0`, `null`, `[]` oder `{}` bewusst dargestellt oder entfernt werden.
- **MOD-004 Verbotene Modellfelder:** Das kanonische Modell DARF insbesondere
  keine `editorGroups`, Realtime-Katalogkopie, Provider-/Transportkonfiguration,
  Runtime-Historie, Runtime-Kontextkopie, `localState`, `stateStore`, `store`
  oder komponentenlokales `html` enthalten.
- **MOD-005 Alte Aliase:** Entfernte Aliase und Fallback-Felder DÜRFEN weder an
  Parser-, Import-, API- oder MCP-Grenzen noch im kanonischen Modell oder Export
  fortleben. Schema v2 besitzt keine Legacy-Kompatibilitätsschicht. Dazu gehören
  insbesondere
  automatische `body`-Migrationen, alte Trigger-Aliase, `dataWireId`-Aliase,
  lokale Fetch-Aliase und versteckte Child-Outlet-/Passive-Render-Konstrukte.
- **MOD-006 Legacy-Body:** Ein eingelesenes, nicht unterstütztes `body`-Feld
  DARF NICHT stillschweigend in eine Komponente oder sichtbaren Inhalt
  umgewandelt werden.
- **MOD-007 Referenzintegrität:** Jede persistierte Referenz MUSS auf ein
  vorhandenes Objekt des richtigen Typs zeigen. Ungültige Transition-Endpunkte,
  Data-Wire-Platzhalter und Transition-Button-Platzhalter MÜSSEN abgelehnt,
  entfernt oder eindeutig repariert werden.
- **MOD-008 Löschkaskade:** Beim Löschen eines Zustands MÜSSEN ungültig
  gewordene Transitionen, deklarierte Zustandsdaten und zugehörige Referenzen
  entfernt oder vertragskonform neu verdrahtet werden.
- **MOD-009 UI-Persistenz:** Kamera und ausdrücklich exportierbare
  Ansichtsmetadaten DÜRFEN außerhalb des fachlichen Modells gespeichert werden.
  Panelgrößen, Auswahl und Vorschau-Zustand DÜRFEN NICHT in das fachliche
  Modell gelangen.
- **MOD-010 Leeres Modell:** Ein gültiges leeres Modell MUSS in Editorvorschau,
  Standalone-Export und MCP-Export leer bleiben. Normalisierung oder Runtime
  DÜRFEN keinen synthetischen Zustand, keine Initial-ID und keine Transition in
  das fachliche Modell oder seine Ausführung einfügen.

## 4. IDs und Namensräume

- **ID-001 Globaler Entitätsraum:** Zustands-IDs und Transition-IDs teilen
  genau einen globalen Namensraum. Keine Zustands-ID darf einer Transition-ID
  entsprechen.
- **ID-002 Eindeutigkeit:** Jede erzeugte oder importierte Entitäts-ID MUSS nach
  Normalisierung global eindeutig sein.
- **ID-003 Reservierte Runtime-IDs:** IDs mit dem Präfix `__runtime_` sind für
  abgeleitete Runtime-Aktionen reserviert und DÜRFEN NICHT als formale
  Zustands- oder Transition-IDs gespeichert werden.
- **ID-004 Boundary-IDs:** Explizite Boundary-Verbindungen dürfen stabile IDs
  wie `boundary-flow:<scope>:<side>` verwenden. Sie bleiben echte
  Modellreferenzen und DÜRFEN NICHT mit Nutzerentitäten kollidieren.
- **ID-005 Anzeige und Bindung:** Sichtbarer Text, Titel und Label sind Anzeige.
  Ausschließlich IDs sind Bindung.
- **ID-006 Kopieren und Vorlagen:** Kopieren, Duplizieren, Preset-Drop,
  Gruppieren und Import MÜSSEN für jede neue Entität kollisionsfreie IDs und
  intern konsistente Referenzen erzeugen.
- **ID-007 Importstabilität:** Eine formale Definition darf nur IDs akzeptieren,
  die ohne Veränderung kanonisch sind. Alternativ MUSS eine notwendige
  Normalisierung alle referenzierenden Felder in derselben atomaren Operation
  umschreiben. Eine Definition erst zu akzeptieren und danach IDs zu ändern,
  `initial`, Parent-, Boundary- oder Transition-Referenzen zu verlieren, ist
  verboten.

## 5. Zustände und Zustandsdaten

- **STA-001 Zustand:** Ein Zustand ist eine explizite FSM-Entität und eine Sicht
  auf den für ihn relevanten Ausschnitt des globalen Busses.
- **STA-002 Datenscope:** Deklarierte fachliche Daten eines Zustands MÜSSEN
  kanonisch unter `states.<stateId>.*` liegen.
- **STA-003 Pfadnormalisierung:** Unqualifizierte Zustandsvariablen,
  Transition-Bedingungen und Transition-`set`-Pfade MÜSSEN auf den Scope des
  Quell- beziehungsweise Besitzerzustands normalisiert werden.
- **STA-004 Typen:** Deklarierte Einträge in `dataTypes` MÜSSEN zu vorhandenen
  Zustandsdaten passen. Unterstützte Typen müssen im Editor und in der Runtime
  konsistent interpretiert werden.
- **STA-005 Eintrittswerte:** Zustands-Defaults dürfen erst beim aktiven Eintritt
  dieses Zustands in den Bus gelangen. Preset-Daten und Daten in inaktiven
  Zuständen DÜRFEN den Runtime-Bus nicht vorab befüllen.
- **STA-006 Kein Überschreiben:** Eintrittswerte DÜRFEN bereits vorhandene
  Buswerte nicht überschreiben. Insbesondere MUSS ein zuvor ausgeführtes
  Transition-`set` gegenüber einem Default erhalten bleiben.
- **STA-007 Deklarierte externe Writes:** Externe Ereignisse und Widgets DÜRFEN
  nur in deklarierte, für sie gebundene Zustandsdaten schreiben. Sie DÜRFEN
  keine beliebigen neuen Buspfade erzeugen.
- **STA-008 Laufende Eingaben und Hot-Update:** Ein Re-Render oder eine
  Modellbearbeitung DARF bestehende Runtime-Eingaben nicht löschen oder mit
  geänderten Defaults überschreiben. Ein neuer oder geänderter Default darf in
  der Editorvorschau höchstens für den aktiven Zustand live übernommen werden,
  wenn der betroffene Buswert noch nicht von seinem bisherigen Default
  abgewichen ist. Daten in inaktiven Zuständen bleiben bis zu deren Eintritt
  unberührt. Nur ein ausdrücklicher Reset darf Laufzeitwerte zurücksetzen.
- **STA-009 Abonnements:** `subscriptions` beschreiben gelesene Buspfade. Das
  Hinzufügen einer Darstellung oder eines Data Wires DARF Abonnements nicht
  als versteckten Schreibkanal missbrauchen.
- **STA-010 Runtime-Steuerung:** Globale Runtime-Steuerung lebt im Bus, zum
  Beispiel `runtime.paused`; es DARF keine zweite lokale Variable wie
  `runtimePaused` geben.
- **STA-011 Host-Snapshot:** `latestRuntimeContext` und vergleichbare
  Host-Snapshots sind nur lesende Momentaufnahmen. Sie DÜRFEN weder das Modell
  noch Zustandsdefaults verändern oder persistieren.
- **STA-012 Eindeutige Datenrepräsentation:** Zustandsdaten MÜSSEN genau eine
  kanonische Pfadrepräsentation besitzen. Flache Pfadschlüssel und
  verschachtelte Objekte DÜRFEN denselben Buspfad nicht gleichzeitig
  deklarieren; mehrere Zustände DÜRFEN denselben Pfad nicht als jeweils eigenen
  Default beanspruchen. Normalisierung, Eintritt und Hot-Update MÜSSEN vom
  Einfüge- oder Property-Order eines JSON-Objekts unabhängig sein.

## 6. Übergänge und Ereigniskausalität

- **TRN-001 Echte Kante:** Ein Übergang MUSS eine eindeutige ID sowie vorhandene
  `from`- und `to`-Zustände besitzen.
- **TRN-002 Aktive Quelle:** Ein Übergang darf nur feuern, wenn seine effektive
  Quelle im aktuellen Runtime-Kontext aktiv und erreichbar ist.
- **TRN-003 Auslöser:** Ein Übergang startet nur durch seinen deklarierten
  Auslöser. Vertragsrelevante Typen sind `button`, `timer`, `change`, `event`,
  `realtime` und `immediate`.
- **TRN-004 Button-Ereignis:** Ein Button-Übergang bindet über seine
  `transitionId` und das Ereignis `button.<transitionId>.clicked`. Sein Label
  ist ausschließlich Anzeige.
- **TRN-005 Keine Inferenz:** Weder Label, sichtbarer Text, Reihenfolge,
  `set`-Pfad noch Datenwert darf verwendet werden, um einen Übergang zu erraten.
- **TRN-006 Bedingung:** Eine Bedingung liest ausschließlich aus dem globalen
  Bus. Sie entscheidet nach Eingang des passenden Auslösers, ob der Übergang
  feuern darf.
- **TRN-007 Wirkung:** `set` beschreibt ausschließlich die Buswirkung eines
  erfolgreich ausgelösten Übergangs. `set` DARF NICHT als UI-Bindung oder
  Triggerquelle dienen.
- **TRN-008 Reihenfolge:** Ein akzeptierter Auslöser wird gegen die aktive
  Quelle und Bedingung geprüft. Danach wird `set` über den autorisierten Bus
  geschrieben, der aktive Zustand gewechselt und der Zielzustand betreten.
  Ziel-Defaults DÜRFEN die so geschriebenen Werte nicht überschreiben.
- **TRN-009 Keine versteckten Kanten:** Die Runtime DARF keine synthetischen
  `next`, Parent-Return-, Geschwister-, Child-Outlet- oder sonstigen fachlichen
  Übergänge erfinden.
- **TRN-010 Sichtbarkeit:** Sichtbare normale Button-Übergänge MÜSSEN als
  echte, aktivierbare Controls rendern. Timer-, Change-, Realtime- und andere
  automatische Übergänge DÜRFEN NICHT als irreführende Buttons erscheinen.
- **TRN-011 Mehrfachausgänge:** Mehrere ausgehende Button-Übergänge MÜSSEN
  ihre eigenen IDs, Ziele, Ereignisse und Farben behalten.
- **TRN-012 Vertrauensgrenze:** Synthetisch erzeugte DOM-UI-Events DÜRFEN keine
  fachliche Buswirkung oder Transition committen. Echte Nutzer-Clicks und
  Nutzereingaben MÜSSEN über den Bus verarbeitet werden.
- **TRN-013 Schreibautorisierung:** Runtime-Writes MÜSSEN über den zentralen
  Bus und dessen Quellen-/Tokenprüfung laufen. Direkte Kontextzuweisungen sind
  außerhalb der Bus-Interna verboten.
- **TRN-014 Pause:** `runtime.paused` MUSS automatische Fortsetzungen, Timer und
  Change-Verarbeitung stoppen und anstehende automatische Arbeit verwerfen.
  Beim Fortsetzen DÜRFEN keine veralteten Ereignisse nachgeholt werden.
- **TRN-015 Name und Route:** Eine neue Transition ohne ausdrücklich gesetztes
  Label MUSS exakt `Weiter` heißen. Das Label ist nutzereigene Anzeige und DARF
  beim Umbenennen eines Zustands oder Umverdrahten der Transition nicht
  automatisch geändert werden. Der Inspector MUSS die echte Verbindung als
  `Quellzustand → Zielzustand` getrennt vom editierbaren Label anzeigen. Die
  Normalisierung DARF den Labelinhalt nicht anhand von Quelle, Ziel, Sprache,
  Präfix oder vermeintlicher Herkunft interpretieren. Ein leeres Label wird
  `Weiter`; jedes vorhandene nicht leere Label bleibt nach dem Trimmen
  unverändert. Es gibt keine Kompatibilitätsliste und keine Labelmigration.

## 7. Verschachtelung und Boundary

- **NEST-001 Echte Eltern:** Gruppierte oder zusammengesetzte Abläufe MÜSSEN
  durch einen echten Parent-Zustand und echte Child-Zustände mit `parentId`
  dargestellt werden. `editorGroups` ist verboten.
- **NEST-002 Exakte Ebene:** Ein Child gehört genau zur Ebene seines Parents.
  Editor und Runtime MÜSSEN beim aktiven Child diese Ebene anzeigen und
  Zustände anderer Ebenen ausblenden.
- **NEST-003 Parent ist sichtbar:** Ein Parent ist selbst ein echter
  Runtime-Zustand und MUSS seine eigene Darstellung zeigen können, bevor ein
  expliziter Boundary-Eintritt aktiviert wird.
- **NEST-004 Eintritt:** `boundary.entryId` bezeichnet den echten Child-Eintritt.
  Ein manueller Eintritt wird als explizite Aktion angeboten. Nur eine
  ausdrückliche Konfiguration wie `entryTriggerType: "auto"` darf den Parent
  automatisch in sein Entry-Child weiterführen.
- **NEST-005 Wiedereintritt:** Wird ein Parent erneut betreten, MUSS sein
  Boundary-Eintritt wieder am konfigurierten Entry-Child beginnen; ein zuvor
  aktives tieferes Child darf nicht stillschweigend fortgesetzt werden.
- **NEST-006 Interner Ablauf:** Child-zu-Child-Verbindungen sind echte
  Transitionen innerhalb derselben Ebene. Wires DÜRFEN nicht unbemerkt über
  Ebenengrenzen springen.
- **NEST-007 Ausgang:** `boundary.exitId` bezeichnet das Child, an dem echte
  Parent-Ausgänge projiziert werden dürfen.
- **NEST-008 Ausgangsprojektion:** Am Exit-Child MÜSSEN zuerst dessen eigene
  ausgehende Aktionen und danach die echt verdrahteten Parent-Ausgänge
  erscheinen.
- **NEST-009 Kein impliziter Ausgang:** Ein Child ohne konfigurierten Ausgang
  DARF keine Parent-Ausgänge, Geschwisteraktionen oder Rückkehr zum Parent
  erben.
- **NEST-010 Stopregel:** Besitzt ein Boundary-Ausgang keinen echten
  Parent-Übergang, stoppt der Ablauf dort. Die Runtime DARF keinen Ersatzknopf
  oder Kreis zum Eingang erfinden.
- **NEST-011 Keine Boundary-Schaltfläche:** Technische Boundary-Flow-Kanten
  DÜRFEN nicht zusätzlich als normale fachliche Buttons gerendert werden.
- **NEST-012 Umverdrahten:** Wird ein Parent-Ein- oder -Ausgang umverdrahtet,
  MÜSSEN Projektion und Runtime unmittelbar auf die echte neue Referenz folgen.
- **NEST-013 Gruppieren:** Gruppieren beziehungsweise Collapse MUSS einen echten
  Parent erzeugen, eingehende und ausgehende Kanten über Entry und Exit
  verdrahten und rekursiv vorhandene Child-Strukturen erhalten.
- **NEST-014 Entgruppieren:** Degroup MUSS das Modell, die Entitätsreihenfolge
  und die vorherige externe Verdrahtung exakt wiederherstellen; es darf keine
  Editor-Metadaten als fachliche Abkürzung verwenden.
- **NEST-015 Boundary-Reparatur:** Nach Löschen oder Verschieben eines
  verankerten Childs MÜSSEN Boundary-Anker wiederverwendbar bleiben und auf
  einen gültigen Endpunkt neu gesetzt oder explizit deaktiviert werden.
- **NEST-016 Ausgänge am aktiven Parent:** Solange ein Parent selbst der
  aktuelle Runtime-Zustand ist, MUSS `outgoing(parent)` den synthetischen
  Boundary-Kind-Eintritt und sämtliche echten, direkt vom Parent ausgehenden
  Transitionen enthalten. Die Triggerart bestimmt ausschließlich, wie eine
  Transition dargestellt beziehungsweise ausgelöst wird; sie DARF ihre
  Zugehörigkeit zur Kandidatenmenge nicht verändern. Der Kind-Eintritt MUSS vor
  den direkten Parent-Transitionen geordnet bleiben. Sobald ein Kind aktiv ist,
  DÜRFEN direkte Parent-Transitionen nicht frei vererbt werden; sie sind nur
  gemäß NEST-007 und NEST-008 am konfigurierten Boundary-Ausgang projiziert
  verfügbar.

## 8. Darstellung und Render-Reihenfolge

- **REN-001 Reine Projektion:** Darstellung liest Modell und Bus. Sie DARF keine
  Ablaufentscheidung, fachlichen Daten oder Datenladeeffekte erfinden.
- **REN-002 Render-Einträge:** Die sichtbare Reihenfolge besteht aus manuellen
  Komponenten sowie referenziellen Platzhaltern vom Typ `dataWire` und
  `transitionButton`.
- **REN-003 Referenzen statt Kopien:** Ein `dataWire`-Platzhalter speichert nur
  seine `wireId`; ein `transitionButton`-Platzhalter nur seine `transitionId`.
  Daten oder Transitionen DÜRFEN nicht in den Platzhalter kopiert werden.
- **REN-004 Ordnung:** Unplatzierte Data Wires werden vor der expliziten
  Renderliste in ihrer Modellreihenfolge gerendert. Platzierte Komponenten,
  Data Wires und Transition-Buttons folgen danach exakt der Reihenfolge in
  `components`. Ein Übergang darf höchstens einmal sichtbar gerendert werden.
- **REN-005 Bearbeitbarkeit:** Render-Einträge MÜSSEN per Maus und Touch
  umsortierbar sein; die gespeicherte Reihenfolge und Runtime-Ausgabe MÜSSEN
  unmittelbar übereinstimmen.
- **REN-006 Data Wire:** Ein Data Wire ist eine lesende Zuordnung von
  `sourcePath` zu Darstellungsrolle und Komponententyp. Er DARF Quelldaten nicht
  kopieren und Abonnements nicht als Nebenwirkung verändern.
- **REN-007 Kein Rehydrieren:** Wird eine Data-Wire-Darstellung gelöscht, DARF
  sie nicht aus Repeat- oder Fetch-Heuristiken automatisch wieder erscheinen.
- **REN-008 Repeat:** Repeat-Quellen MÜSSEN aus lesbaren, abgeleiteten
  Kandidaten explizit ausgewählt werden. Die Auswahl DARF NICHT als freier
  unvalidierter Pfad oder automatische Render-Zuordnung entstehen.
- **REN-009 Arraypfade:** Repeat-Data-Wires MÜSSEN verschachtelte und
  arrayindizierte Item-Pfade, einschließlich Bildpfaden, korrekt auflösen.
- **REN-010 Kein Template-Fallback:** Sichtbare Datenabbildung DARF nicht auf
  versteckten `{{...}}`-Tokens, einem Template-Binding-Picker oder automatischer
  Repeat-Erkennung beruhen.
- **REN-011 Live-Synchronität:** Eine Komponentenbearbeitung MUSS sofort in
  Modell und Vorschau sichtbar werden, ohne den aktiven Runtime-Zustand neu zu
  laden.
- **REN-012 Externe Links:** Ein Link in der Editor-Vorschau DARF den
  eingebetteten Runtime-Flow nicht aus seinem Iframe herausnavigieren.
- **REN-013 Farben:** Jeder sichtbare Transition-Button MUSS exakt die Farbe
  seiner zugehörigen Kante verwenden. Transition-Buttons DÜRFEN keinen
  Farbverlauf verwenden.
- **REN-014 Saubere Runtime:** Generierte Nutzeroberflächen DÜRFEN keine
  Editor-Hilfetexte wie `No outgoing transitions`, keine Template-Tokens und
  keine nicht angeforderte Sound-/Vorleselogik anzeigen.
- **REN-015 Panel-Aktionen:** Ein- und Ausklappen von Eigenschaften, Vorschau
  und Vorlagen MUSS über konsistente Icon-Aktionen mit eindeutigem
  `aria-label`, `aria-controls` und `aria-expanded` erfolgen; rohe Zeichen wie
  `<`, `>`, `^` oder `v` sind als sichtbare Controls unzulässig. Die
  eingeklappte Desktop-Vorschau DARF höchstens 46 px Layoutbreite belegen. Ihre
  Aufklappaktion liegt oben und „App separat öffnen“ unten in derselben
  vertikalen Schiene, ohne eine zusätzliche Grid-Spalte zu beanspruchen. Der
  Breitengewinn MUSS mit dem eingeklappten Zustand ohne nachlaufende
  Spaltenanimation gelten.

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
  verändern.
- **FX-005 Ergebnisereignisse:** Fetch-Erfolg und Fetch-Fehler MÜSSEN als
  explizite FSM-Ereignisse in den Bus eintreten. Nur Transitionen, die den
  aktiven Fetch-Kontext referenzieren, dürfen automatisch folgen.
- **FX-006 Wiederholung:** Konfigurierte Retries dürfen nur laufen, solange die
  zugehörige Aktivierung aktiv ist. Erst nach dem letzten fehlgeschlagenen
  Versuch darf das endgültige Fehlerereignis entstehen.
- **FX-007 Kein Fetch-Schattenzustand:** Es DARF keinen komponentenlokalen oder
  Host-seitigen `fetchRun`-/Cache-Zustand als zweite fachliche Wahrheit geben.
- **FX-008 Pause:** Während `runtime.paused` dürfen Fetch-, Timer-, Change- oder
  Immediate-Fortsetzungen nicht committen oder für später aufgestaut werden.

## 10. DaisyUI-Bausteine und Presets

- **PRE-001 Katalog:** Ein Preset ist ein Katalogeintrag und besitzt außerhalb
  des Canvas keine Runtime-Wirkung.
- **PRE-002 Materialisierung:** Erst beim Drop oder expliziten Hinzufügen wird
  ein Preset als echter Zustand mit eigenem Scope `states.<stateId>.*`
  materialisiert.
- **PRE-003 Strukturierte Daten:** DaisyUI liefert Darstellung. Presets MÜSSEN
  strukturierte Busdaten verwenden und DÜRFEN weder Komponenten-`html` noch
  versteckte lokale Widget-Zustände speichern.
- **PRE-004 Explizite Aktionen:** Interaktive Buttons, Karten, Heroes, Modals,
  Feature-Grids, Pricing-Karten, Breadcrumbs, Footer, Menüs, Dropdowns,
  Bottom-Navigation, Drawer, Steps, Tabs, Navbar-Varianten, Checkboxen und
  Toggles dürfen Flow nur über explizite Transition-IDs auslösen.
- **PRE-005 Text ist Anzeige:** Gleicher Text oder gleiches Label DARF keine
  Preset-Aktion an einen Übergang binden. Ohne explizite ID bleibt das Element
  ohne FSM-Wirkung.
- **PRE-006 Autowiring:** Ein aktionsfähiges Preset MUSS für jede fachliche
  Aktion echte Zielzustände und echte Transitionen erzeugen. Alle Referenzen
  MÜSSEN eindeutig und erreichbar sein.
- **PRE-007 Widget-Writes:** Eingaben und Widgets dürfen nur ihre gebundenen,
  deklarierten Felder wie `value`, `checked`, `selected`, `open`, `index` oder
  `finished` schreiben.
- **PRE-008 Countdown:** Countdown-Ende MUSS als Change-Ereignis auf dem
  deklarierten `finished`-Pfad modelliert sein.
- **PRE-009 Loading:** Das Loading-Preset MUSS als Timer-Übergang mit 2000 ms
  modelliert sein und DARF keinen sichtbaren Transition-Button vortäuschen.
- **PRE-010 Toast:** Toast MUSS als zeitgesteuerte Busnachricht ohne impliziten
  Button modelliert sein.
- **PRE-011 Checkbox/Toggle:** Bedingungen und Wirkungen von Checkbox und Toggle
  MÜSSEN ausschließlich deren scoped Zustandsfelder verwenden.
- **PRE-012 Preset-Qualität:** Jeder eingebaute Preset-Typ MUSS eindeutig
  benannt, mit nutzbaren Defaults gefüllt, ohne defekte Bilder renderbar und
  ohne horizontalen Seitenüberlauf nutzbar sein.
- **PRE-013 Offizielle Klassen:** Daisy-Presets MÜSSEN die für ihre Variante
  vorgesehenen daisyUI-Klassen und strukturierten Datenformen verwenden.
  Entfernte Varianten und alte Navbar-Layouts DÜRFEN NICHT wieder erscheinen.
- **PRE-014 Snapshots:** Gespeicherte Nutzer-Presets sind unabhängige Snapshots.
  Sie DÜRFEN weder ihre Quelle noch andere Instanzen nachträglich mutieren.
- **PRE-015 Transition-Drop:** Wird ein neuer Preset-Zustand auf eine vorhandene
  Transition gelegt, MUSS er in diese Transition eingesetzt werden. Die
  eingehende Transition behält ihre Identität; eine neue ausgehende
  Transition verbindet zum bisherigen Ziel.
- **PRE-016 Panelhoheit:** Preset-Materialisierung durch `Hinzufügen`,
  `Verwenden`, Doppelklick, Drag-Drop oder den Import einer Zustandskomponente
  DARF den geöffneten beziehungsweise geschlossenen Inspectorzustand NICHT
  verändern. Nur eine getrennte, ausdrücklich auf Inspector, Eigenschaften oder
  Bearbeiten gerichtete Nutzeraktion darf ihn öffnen oder schließen. Auf Mobil
  MÜSSEN `Hinzufügen` und `Verwenden` außerdem die gewählte Arbeitsansicht
  unverändert lassen.

## 11. Editor-Vertrag

- **ED-001 Gemeinsame Operationen:** Verschieben, Verbinden, Umverdrahten,
  Gruppieren, Entgruppieren, Löschen, Kopieren, Einfügen, Undo und Redo MÜSSEN
  dieselben kanonischen Modelloperationen verwenden wie API und MCP.
- **ED-002 Neue Szene:** Eine neue Szene startet leer beziehungsweise mit dem
  vertraglich definierten frischen Starter und DARF keine Demo-Abkürzungen
  enthalten.
- **ED-003 Demo-Laden:** Die Demo darf nur explizit oder über
  `?demo=zustand` geladen werden. Vorhandene Arbeit MUSS vor Ersetzen bestätigt
  werden.
- **ED-004 Tastatur:** `Ctrl+N` öffnet den App-Dialog und DARF keinen Browser-Tab
  öffnen. `Ctrl+S` speichert eine formale Definition.
- **ED-005 Delete-Fokus:** `Delete` darf Graphentitäten nur löschen, wenn der
  Canvas fokussiert ist. In einem Texteditor bleibt Delete nativ. `Backspace`
  DARF niemals Graphentitäten löschen.
- **ED-006 Auswahl:** Leerer Einzelclick leert den Inspektorkontext; Pan startet
  keine unbeabsichtigte Deselektion. Shift-Click, Mehrfachauswahl und `Ctrl+A`
  MÜSSEN deterministisch funktionieren.
- **ED-007 Transition-Auswahl:** Ein einzelner Click auf einen
  Transition-Handle wählt aus und DARF keinen neuen Zustand erzeugen.
  Umverdrahten darf nur vom vorgesehenen Arrowhead/Pin und nicht vom Linienkörper
  starten.
- **ED-008 Duplikate:** Ein normaler Verbindungsdrag DARF keine identische
  Duplikat-Transition erzeugen. Explizites Umverdrahten MUSS die Identität der
  bestehenden Transition erhalten.
- **ED-009 Undo/Redo:** Historie MUSS deterministisch sein, unveränderte Saves
  dürfen keine zusätzlichen Schritte erzeugen, und Wiederherstellung MUSS
  Modell sowie relevante Auswahl korrekt rekonstruieren. Undo und Redo DÜRFEN
  als sichtbare Aktionen genau einmal erscheinen: oben rechts im Canvas. Die
  Desktop-Topbar, das Mehr-Menü und die mobile Navigation DÜRFEN keine
  Duplikate enthalten. Die beiden Canvas-Aktionen MÜSSEN eindeutige,
  entgegengesetzt gerichtete Undo-/Redo-SVG-Icons ohne Spiegelung, Rotation oder
  schriftabhängige Pfeilzeichen verwenden.
- **ED-010 Fokus und Tabfolge:** Zustands-, Transition- und Runtime-Editoren
  MÜSSEN eine vorhersehbare Tabfolge, Enter-Commit- und Escape-Semantik besitzen.
  Ein aktiver Inline-Titeleditor MUSS den Fokus behalten; verzögerte
  Canvas-Fokussierung DARF ihn nicht übernehmen.
- **ED-011 Lokale UI:** Panelbreiten, Explorerzustand, Preview-Collapse und mobile
  Arbeitsansicht dürfen lokal persistieren, ohne das Modell zu verändern.
- **ED-012 Responsive Bedienung:** Desktop, Tablet und Mobile MÜSSEN Canvas,
  Vorlagen, Details und Vorschau erreichbar halten. In der mobilen
  Arbeitsansicht MÜSSEN diese vier Aufgaben über vier gleich breite,
  mindestens 44 Pixel hohe Navigationsziele erreichbar sein. Jeder Modus MUSS
  die Arbeitsfläche ohne Restzeile, frei verschiebbaren Split oder verdeckten
  Inhalt belegen. Canvas, Vorlagen und Details MÜSSEN jeweils eine exklusive
  Vollfläche bleiben. Die mobile Vorschau MUSS dagegen innerhalb derselben
  Vollfläche den echten Canvas-Renderer als nicht interaktiven Live-Monitor und
  die bedienbare App gleichzeitig zeigen: in Portrait übereinander, in
  Querformat nebeneinander. Der Monitor MUSS die an einer Runtime-Transition
  beteiligten States und die bestehende State-/Kantenanimation sichtbar halten,
  DARF keinen zweiten Renderer oder Modellstand erzeugen und DARF die vom Nutzer
  gespeicherte Canvas-Kamera nicht überschreiben. Controls und Beschriftungen
  dürfen nicht überlappen, abgeschnitten werden, horizontal aus dem Viewport
  laufen oder durch Scrollbars verdeckt werden.
- **ED-013 Touch:** Touch-Drag, Long-Press, Double-Tap, Pinch-Zoom,
  Zwei-Finger-Pan und Touch-Reorder MÜSSEN absichtlich unterscheidbar sein.
  Ein Ein-Finger-Wisch auf dem Canvas MUSS nach Überschreiten der
  Bewegungsschwelle pannen, unabhängig davon, ob er auf leerer Fläche, einem
  State-Körper, einem Transition-Linienkörper, einem Transition-Label, einem
  Edge-Pin oder einem Arrowhead beginnt. Die frühe Bewegung MUSS den jeweiligen
  Long-Press abbrechen und DARF weder den State verschieben noch die Transition
  umverdrahten. State-Drag und Transition-Rerouting DÜRFEN weiterhin erst nach
  ihrem vorgesehenen Long-Press beginnen; Rerouting DARF ausschließlich von den
  dafür vorgesehenen Arrowheads und Pins starten. Vertikales Preset-Scrollen
  DARF keinen Drag starten.
- **ED-014 Gestenabbruch:** Verlorenes `mouseup`, Pointer-Verlassen oder
  Fenster-Blur MUSS Drag, Pan, Connect und Rechteckauswahl sauber abbrechen.
- **ED-015 Keine Browser-Nebeneffekte:** Canvas und Vorschau MÜSSEN
  unbeabsichtigte Textauswahl, Callouts und Browsernavigation verhindern, ohne
  legitime Eingaben unbenutzbar zu machen.
- **ED-016 Inspector:** State-, Render- und Datenbereiche MÜSSEN unabhängig
  einklappbar sein. Aktionen MÜSSEN im Drawer bleiben; kompakte Controls dürfen
  nicht überlappen.
- **ED-017 Keine Rohdatenpflicht:** Der Hauptworkflow MUSS typisierte Variablen,
  Bedingungen, `set`, Repeat und Data Wires ohne verpflichtende Bearbeitung
  roher Buspfade oder Template-Tokens anbieten.
- **ED-018 JSON-Fehler:** Ungültiges JSON in Daten- oder `set`-Editoren DARF das
  letzte gültige Modell nicht überschreiben.

## 12. Canvas, Routing und Treffererkennung

- **CAN-001 Renderer:** State-Nodes werden als DOM-Elemente, Kabel, Ports,
  Arrowheads und Edge-Pins als SVG gerendert. Ein zusätzlicher Canvas-Renderer
  DARF keine zweite interaktive Geometrie führen.
- **CAN-002 Koordinatensystem:** Nodes, SVG-Ports, Edge-Pins und Kabel MÜSSEN
  dasselbe Weltkoordinatensystem verwenden und bei Drag sowie Release dieselbe
  Position besitzen.
- **CAN-003 Raster:** Nodes, Ports und Pfadpunkte MÜSSEN exakt auf das
  Canvas-Raster einrasten.
- **CAN-004 Orthogonalität:** Transitionen MÜSSEN orthogonale Pfade verwenden.
  Ein freier, ausgerichteter Pfad bleibt gerade; kleine Offsets verwenden kurze
  Vorwärtsbiegungen statt Schleifen.
- **CAN-005 Hindernisse:** Kabel MÜSSEN sichtbare State-Bounding-Boxes mit dem
  vertraglichen Sicherheitsabstand, mindestens dem geprüften halben Raster,
  umgehen.
- **CAN-006 Lanes:** Gemeinsame Ein- und Ausgänge MÜSSEN unterscheidbare
  Pins/Lanes erhalten. Horizontale und vertikale Kabel dürfen nicht unlesbar
  übereinander liegen.
- **CAN-007 Eingangsrichtung:** Arrowheads MÜSSEN nach vertikalen Umwegen von
  links in den Eingangsport laufen.
- **CAN-008 Live entspricht Final:** Die Route während eines Node-Drags MUSS
  geometrisch der Route unmittelbar nach Release entsprechen.
- **CAN-009 Drag-Performance:** Live-Routing DARF bei dichten Graphen keine
  vollständige dichte Grid-Suche pro Pointer-Frame ausführen.
- **CAN-010 DOM-Wiederverwendung:** Ein voller Redraw MUSS bestehende SVG-Wire-
  und Port-Elemente nach Möglichkeit wiederverwenden. Eine reine
  Runtime-Kontextänderung DARF keinen vollen Canvas-Redraw auslösen.
- **CAN-011 Runtime-Markierung:** Aktiver Zustand, Eintritt, Austritt und
  Transition-Puls MÜSSEN sichtbar unterscheidbar sein. Der Puls DARF keine
  frameweise DOM-Geometrieabfrage oder Style-Mutation verwenden.
- **CAN-012 Hit-Priorität:** Innerhalb der sichtbaren Fläche eines State-Nodes
  MUSS der Node für Auswahl und Drag vor unsichtbaren Hitflächen fremder
  `.edge-pin`, `.edge-tip-hit` oder `.svg-port` liegen. Edge-Hitflächen DÜRFEN
  keinen darunterliegenden fremden Node blockieren. Liegt eine solche SVG-
  Hitfläche geometrisch über einem fremden State, MUSS
  `document.elementFromPoint(x, y)` den State-Node oder eines seiner Kinder
  liefern. Ein einzelner nicht erzwungener Klick MUSS diesen State auswählen;
  ein einzelner nicht erzwungener Drag MUSS ihn bewegen. Explizite Click-
  Retries, Force-Clicks und Locator-Fallbacks sind für diese Treffererkennung
  unzulässig.
- **CAN-013 Port-Erreichbarkeit:** Die vorgesehene sichtbare Port-/Pin-Zone am
  Rand des eigenen Nodes MUSS weiterhin für Connect und Reroute erreichbar
  bleiben. Die freie Maus-Zielfläche eines State-Ausgangs MUSS unabhängig vom
  Canvas-Zoom mindestens 32 CSS-Pixel nach außen und 44 CSS-Pixel in der Höhe
  greifbar sein. Dort MUSS erst eine vom Port weg gerichtete Mausbewegung von
  mehr als 7 CSS-Pixeln die Verbindung starten. Drücken, Klicken und eine zum
  Port gerichtete Drag-Bewegung DÜRFEN keine Verbindung starten. Ein Drag
  deutlich innerhalb des Node-Körpers MUSS den Node bewegen und DARF keine
  Verbindung starten. Die vergrößerte Zielfläche DARF die Fremd-State-Priorität
  aus CAN-012 NICHT umgehen.
- **CAN-014 Layout-Stabilität:** Titel, Statusbadges, Open-Aktion, Ports und
  Layer-Rahmen DÜRFEN nicht inkonsistent überlappen. Lange Titel müssen wachsen
  oder kontrolliert auf zwei Zeilen begrenzt werden.

## 13. Speichern, Import und Export

- **EXP-001 Formale Definition:** Eine gespeicherte Definition MUSS
  `kind: "state-blueprint-definition"`, `schemaVersion: 2` und das normalisierte
  Modell enthalten.
- **EXP-002 Zulässige Metadaten:** Eine formale Definition DARF Kamera und
  State-Presets enthalten. Sie DARF keine Undo-Historie, Zwischenablage,
  Runtime-Werte oder flüchtige Panelzustände enthalten.
- **EXP-003 Roundtrip:** Speichern und erneutes Laden MUSS dasselbe normalisierte
  Modell, dieselben Render-Referenzen, Daten, Typen und Transitionen
  wiederherstellen.
- **EXP-004 Teilimport/-export:** Einzelne Zustandskomponenten, Presets und volle
  Definitionen MÜSSEN ohne Verlust von Data Wires und Render-Reihenfolge
  importier- und exportierbar sein.
- **EXP-005 Standalone-HTML:** HTML-Export MUSS selbstenthalten, syntaktisch
  gültig und ohne Editor-Helfer lauffähig sein. Er MUSS das exportierte Modell
  verwenden und DARF nicht aus Local Storage auf ein anderes Modell fallen.
- **EXP-006 Script-Sicherheit:** Eingebettete Script-Endsequenzen MÜSSEN so
  escaped werden, dass verschachtelte Skripte den Export nicht vorzeitig
  beenden.
- **EXP-007 Gleiche Runtime:** Vorschau, exportiertes HTML und MCP-HTML-Export
  MÜSSEN dieselbe FSM-, Bus-, Boundary-, Fetch- und Render-Semantik verwenden.
- **EXP-008 Exportgestaltung:** Der aktuelle Standalone-Export verwendet den
  Dark-Contract mit `--bg: #020617`, `--primary: #38bdf8` und
  `Atkinson Hyperlegible`. Er DARF keine helle White-Card-Fallbackgestaltung und
  keine Speech-Synthesis-/Vorlesefunktion enthalten.
- **EXP-009 UTF-8:** Quellen und erzeugte Artefakte MÜSSEN gültiges, sauberes
  UTF-8 bleiben; fehlerhafte Doppeldecodierung ist verboten.
- **EXP-010 Deutsche Orthografie:** Sichtbare deutsche Texte im Editor, in der
  Runtime, in Demos, Dokumentation und Testzusicherungen MÜSSEN native Umlaute
  und `ß` verwenden. ASCII-Umschriften sichtbarer deutscher Texte und alte
  Parser-Aliasse sind nicht zulässig. Technische IDs, JSON-Schlüssel,
  Ereignisnamen, Funktionsnamen und URLs DÜRFEN durch Textkorrekturen nicht
  verändert werden.
- **EXP-011 Produktionsartefakt:** Standalone-HTML und Root-Demo DÜRFEN keine
  Runtime-Diagnoseoberfläche und keinen zugehörigen Quelltext ausliefern. Das
  schließt insbesondere `flowDebug`, `.flow-debug*`, `runtimeFlowDebug*` sowie
  das schwebende `Ablauf`-Control mit Zustand, Übergang, Ereignis und geändertem
  Pfad aus. Der interne Runtime-Kontext für FSM-Semantik und Tests bleibt davon
  unberührt.
- **EXP-012 Eigenständiger Start:** Ein Standalone-Export MUSS sein eingebettetes
  Modell unmittelbar ausführen, unabhängig davon, ob er als oberstes Dokument,
  in einem `iframe` oder mit vorhandenem `window.opener` geladen wird. Nur eine
  ausdrücklich als Host-Vorschau erzeugte Runtime mit erfolgreichem Handshake
  darf auf ein Hostmodell warten; die bloße Existenz von `parent` oder `opener`
  ist kein Hostnachweis.
- **EXP-013 Veröffentlichungsprofil:** Ein beliebiger Nutzerexport DARF keine
  fest verdrahtete Canonical-URL, Share-Card, Manifest-, Icon- oder Service-
  Worker-Referenz von `digitalisierungsplanung.de` erhalten. Solche
  Veröffentlichungsmetadaten gehören ausschließlich in den getrennten Build
  der öffentlichen Root-Demo. Ein generischer Standalone-Export bleibt ohne
  Origin-Abhängigkeit vollständig lauffähig.
- **EXP-014 Deutsche Systemdefaults:** Vom Produkt erzeugte sichtbare
  Standardtexte in Editor und Runtime MÜSSEN deutsch sein. Dazu gehören
  insbesondere leere Transitionnamen, abgeleitete Aktionen, Carousel-
  Navigation sowie automatisch erzeugte Feld- und Listentitel. Frei modellierte
  Nutzerdaten bleiben unverändert.

## 14. API- und MCP-Vertrag

- **API-001 Ein Modell:** API und MCP lesen und bearbeiten dasselbe kanonische
  Modell wie der visuelle Editor.
- **API-002 Keine DOM-Automation:** API- und MCP-Kommandos DÜRFEN die
  Oberfläche nicht durch DOM-Clicks steuern.
- **API-003 Kein zweiter Speicher:** Der MCP-Server darf einen konfigurierten
  Workspace persistieren, aber keinen abweichenden fachlichen Runtime-Speicher
  führen.
- **API-004 Schreibablauf:** Modellaktionen MÜSSEN Abhängigkeiten ordnen,
  normalisieren und validieren, bevor sie atomar persistiert werden.
- **API-005 Kommandos:** Editor-Kommandos für Szene, States, Transitionen,
  Variablen, Fetch, Repeat, Data Wires, Komponenten, Boundary, Auswahl, Ebene,
  Viewport, Copy/Paste, Gruppierung und Undo/Redo MÜSSEN über Modell- und
  Session-Operationen statt DOM-Automation laufen.
- **API-006 Werkzeuge:** Der MCP-Vertrag umfasst mindestens
  `state_blueprint_get_model`, `state_blueprint_replace_model`,
  `state_blueprint_apply_actions`, `state_blueprint_apply_commands`,
  `state_blueprint_plan_prompt`, `state_blueprint_apply_prompt`,
  `state_blueprint_validate`, `state_blueprint_export_definition`,
  `state_blueprint_import_definition`, `state_blueprint_export_html`,
  `state_blueprint_action_catalog` und `state_blueprint_command_catalog`.
- **API-007 Prompt-Planung:** Prompt-Planung darf nur unterstützte Absichten in
  explizite vertragskonforme Aktionen übersetzen. Timer, innere Zustände,
  Workflows, Variablen und API-Listen MÜSSEN dieselben Scopes, Boundary-Regeln
  und echten Transitionen erzeugen wie der Editor.
- **API-008 Plan vor Apply:** `plan_prompt` DARF das Modell nicht verändern.
  `apply_prompt` MUSS den erzeugten Plan über die normale Aktionsvalidierung
  anwenden.
- **API-009 Exportgleichheit:** API-/MCP-Definition und HTML-Export MÜSSEN den
  Editor-Exportvertrag einhalten.
- **API-010 Keine Editor-Gruppenaktionen:** Die API DARF keine fachlichen
  `editorGroup`-Abkürzungen anbieten. Gruppierung erfolgt als echter Parent mit
  `parentId` und Boundary.
- **API-011 Normalisierungsparität:** Für dasselbe Eingabemodell MÜSSEN Editor,
  Runtime und MCP dieselben Defaultwerte, Scopes, Boundary-Felder, reservierten
  Namensräume und formalen Exportfelder erhalten. Ein API-Weg DARF weder
  fachliche Felder verwerfen noch technische Projektionsfelder zusätzlich als
  formale Wahrheit exportieren.

## 15. Realtime- und Server-Vertrag

- **RT-001 Transportrolle:** Der Realtime-Server ist ausschließlich Transport,
  Katalog, Token-Aussteller und Testkonsole. Er persistiert keinen fachlichen
  Zustand und besitzt kein zweites Modell.
- **RT-002 Katalogquelle:** `/events` ist die Live-Quelle der erlaubten
  Realtime-Ereignisse. Der Katalog darf `bindings` beschreiben, wird aber nicht
  als `model.realtime` oder Provider-/Transportzustand im Modell gespeichert.
- **RT-003 Modellreferenz:** Das Modell speichert bei Bedarf nur
  `triggerType: "realtime"` und den konkreten `triggerEvent`-Namen.
- **RT-004 Namensraum:** Persistierte Realtime-Ereignisse beginnen mit
  `realtime.`. Ein generischer `event`-Trigger DARF die reservierten
  `button.*`- oder `realtime.*`-Namensräume nicht beanspruchen.
- **RT-005 Bus-Eintritt:** Ein empfangenes Realtime-Ereignis MUSS über den
  globalen Bus in die Runtime eintreten. Nur deklarierte Bindings dürfen
  deklarierte `states.*`-Pfade schreiben.
- **RT-006 Host-Grenze:** Der Host liest den Runtime-Kontext nur als Snapshot und
  DARF weder Modell noch Zustandsdefaults mutieren. Ein empfangenes
  Realtime-Ereignis wird genau einmal mit seiner Katalogdefinition an die
  Runtime zugestellt, dort vor jeder Transition im Bus erfasst und nicht durch
  den Host zurück an den Server gespiegelt. Eine optionale Runtime-Meldung an
  den Host ist reine Beobachtung und kein zweiter Relay- oder Emit-Pfad.
- **RT-007 Origins:** HTTP- und WebSocket-Browserzugriffe MÜSSEN gegen die
  konfigurierte Origin-Allowlist geprüft werden.
- **RT-008 Raumtoken:** Wenn unsignierte Räume deaktiviert sind, MUSS der
  WebSocket-Join ein gültiges signiertes Raumtoken besitzen. `/token` darf nur
  für erlaubte Origins ausstellen und MUSS ohne Secret mit 503 fehlschlagen.
- **RT-009 Ereignisannahme:** WebSocket-`runtime.event` und `/emit` dürfen nur
  aktuell katalogisierte Ereignisse akzeptieren. Unbekannte Ereignisse MÜSSEN
  abgelehnt werden.
- **RT-010 Emit-Schutz:** `/emit` MUSS das Emit-Secret prüfen. Die
  Browser-Konsole DARF dieses Secret nicht eingebettet ausliefern und speichert
  keine Payload serverseitig.
- **RT-011 Relay:** Ein akzeptiertes Runtime-Ereignis wird an andere Peers im
  selben Raum verteilt und DARF nicht an den Sender zurückgespiegelt werden.
- **RT-012 Deduplizierung:** Gleiche oder alte Client-Sequenzen MÜSSEN pro Raum
  und Client verworfen werden.
- **RT-013 Rate Limit:** Laute Clients MÜSSEN rate-limitiert werden.
- **RT-014 Keine Modellwrites:** Nachrichten wie `graph.patch` und `snapshot`
  MÜSSEN abgelehnt werden. Kanonische Modellwrites gehören ausschließlich zur
  Modell-API.
- **RT-015 Öffentliche Routen:** Nginx darf nur `/console.html`, `/healthz`,
  `/version`, `/token`, `/events`, `/emit` und `/ws` an den lokalen Prozess auf
  `127.0.0.1:8788` weiterleiten. Nicht definierte Kernrouten wie `/`,
  `/catalog`, `/schema` und `/api` liefern 404.
- **RT-016 Transportierte Definition:** Der Server MUSS einem akzeptierten
  `runtime.event` die zu diesem Namen gehörende normalisierte Katalogdefinition
  beilegen. Der Empfänger verwendet diese Definition für Bindings und DARF den
  fachlichen Bus-Eintritt nicht wegen eines zusätzlichen fehlgeschlagenen
  `/events`-Abrufs verwerfen.
- **RT-017 Frame-Warteschlange:** Ist die Vorschau-Runtime vorübergehend nicht
  bereit, MÜSSEN Realtime-Ereignisse in einer geordneten Warteschlange erhalten
  bleiben. Modell kommt vor Status und Status vor Ereignis. Ein späterer
  Modell- oder Status-Payload DARF ein wartendes Ereignis nicht überschreiben.
- **RT-018 Keine Browser-Outbox:** Im trigger-only-Produktumfang erzeugt der
  Browser keine ausgehenden fachlichen Realtime-Ereignisse und hält deshalb
  keine Outbox oder Verbindungswarteschlange dafür. Die geordnete Host-zu-
  Runtime-Warteschlange für empfangene Frames bleibt RT-017. Ein künftiger
  Emitter müsste seine Outbox-, ACK-, Kapazitäts- und Replay-Regeln als neue
  Vertragsfunktion definieren.
- **RT-019 Gemeinsame Release-Wahrheit:** `sw-version.js` ist die einzige
  Release-Wahrheit für statisches Frontend, Service Worker und Backend. Eine
  Release besitzt eine streng steigende numerische Sequenz und die daraus
  abgeleitete ID `release-<sequence>`. Frontend und Backend DÜRFEN keine
  getrennten Zähler führen.
- **RT-020 Release-Gate:** CI DARF die Release-Sequenz erst nach dem Erfolg aller
  Server- und Browserverträge erhöhen. Der Produktivserver DARF einen neuen
  Quellcommit erst deployen, wenn dessen neue Release-ID auf `main` vorliegt.
- **RT-021 Atomarer Serverabgleich:** Automatische Deployments MÜSSEN mit einem
  exklusiven Lock laufen, den freigegebenen Remote-Commit erzwingen und lokale
  Änderungen im Server-Checkout verwerfen. Secrets und produktive
  Umgebungswerte MÜSSEN außerhalb dieses Checkouts liegen.
- **RT-022 Verifikation und Rollback:** Eine Release gilt erst nach erfolgreichem
  PM2-Start mit aktualisierter Umgebung, `nginx -t` und einem Healthcheck mit
  exakt passender Release-ID als deployt. Vorher DARF der Erfolgsmarker nicht
  fortgeschrieben werden. Schlägt das Update nach Retries fehl, MUSS der letzte
  verifizierte Commit wiederhergestellt werden; ein späterer Timerlauf versucht
  die neue Release erneut.
- **RT-023 Versions-API:** Für jede neue `release-N`-Freigabe MÜSSEN `/version`
  und `/healthz` mit `no-store` exakt die vom Backend verwendete
  `serviceWorkerId`, Release-Sequenz,
  Erstellungszeit sowie Quell- und Deploy-Commit ausgeben.
- **RT-024 Trigger-only:** Zustand konsumiert Realtime vorerst ausschließlich
  als katalogisierten externen Trigger. Weder Modell noch Host dürfen eine
  eigenständige Emitter-Wirkung oder eine öffentliche lokale `emit`-API
  bereitstellen. `/emit` bleibt ein authentifizierter externer Servereingang
  für Integrationen und Testkonsole. Ein fachlicher App-Emitter wäre eine neue
  Vertragsfunktion und dürfte erst gemeinsam mit Payloadschema, Reihenfolge,
  Autorisierung, ACK und Fehlersemantik eingeführt werden.

## 16. Öffentliche Demo und Produkt-Abnahme

- **DEMO-001 Modell:** Die eingebaute Website-Demo heißt `Zustand-Beispiel`,
  startet in `site_home` und besitzt exakt diese neun Zustände:

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
- **DEMO-004 Sichtbare Auslöser:** Jede der 47 Transitionen MUSS in ihrem
  effektiven Quellzustand genau als sichtbarer, aktivierter Control mit ihrer
  Vertrags-ID erreichbar sein.
- **DEMO-005 Traversierung:** Ein echter Nutzer-Click MUSS für jede
  Demo-Transition `current`, `previous` und `lastTransition` exakt auf die
  erwarteten IDs setzen. Alle neun Zustände und alle 47 Transitionen MÜSSEN
  vollständig click-traversierbar sein. Nach einmaligem Sichtbarrollen MUSS der
  Mittelpunkt jedes Controls bei `elementFromPoint` das Control oder eines
  seiner Kinder liefern; anschließend MUSS genau ein nicht erzwungener Click
  ohne Retry oder Fallback genügen.
- **DEMO-006 Shell:** Die acht sichtbaren Seitenzustände verwenden eine
  gemeinsame Navbar mit `Zustand`, `Start`, `Nutzen`, `Angebot`, `Kontakt` und
  `Konto` sowie einen Footer mit `Zustand GmbH` und fünf gebundenen Aktionen.
- **DEMO-007 Fachabläufe:** Start, Nutzen, Angebot, Anfrage, Kontakt, Danke,
  Konto und Profil MÜSSEN über echte FSM-Transitionen funktionieren.
  Checkout schreibt den gewählten Plan und Abschluss in
  `states.site_thanks.order`; Login und Logout verwenden echte gebundene
  Transitionen.
- **DEMO-008 Kein Überlauf:** Demo-Seiten und Presets dürfen keinen relevanten
  horizontalen Seitenüberlauf erzeugen. Ein Zustandswechsel nach Scrollen MUSS
  die neue Seite oben beginnen.
- **DEMO-009 Root-Seite:** `index.html` ist der eigenständige Export dieser
  Demo, nicht der Editor. Sie MUSS ohne Editor-Controls laufen, auf
  `state.html?demo=zustand` als Werkzeug-Einstieg verweisen, Manifest und
  Share-Card laden und die getesteten Navigations-, Checkout- und Kontaktpfade
  ausführen.
- **DEMO-010 Manifest:** Das Webmanifest MUSS den Namen
  `Zustand Digitalisierungsplanung` ausliefern.
- **DEMO-011 Kein Cache:** Editor, Root-Demo, Exporte und statische Assets
  DÜRFEN weder einen App-Shell-/Asset-Cache anlegen noch Stale-while-revalidate
  verwenden. Im kontrollierten öffentlichen Hosting MUSS der Service Worker
  vorhandene Cache-Storage-Bestände löschen und jeden gleich-originigen GET mit
  Cache-Buster und `cache: "no-store"` aus dem Netz laden; Worker-Updates
  verwenden `updateViaCache: "none"`. Die HTTP-Antwort eines generischen,
  origin-unabhängigen Standalone-Artefakts kann nur dessen jeweiliger Host mit
  `Cache-Control: no-store` garantieren und DARF NICHT durch eine fest
  verdrahtete fremde Service-Worker-URL vorgetäuscht werden.
- **DEMO-012 Safari-Reload-Viewport:** Root-Demo und Standalone-Export MÜSSEN
  genau den Dokument-Viewport als vertikale Scrollfläche verwenden; `body`
  DARF keine zweite Momentum-Scrollfläche bilden. Die automatische
  Browser-Scrollrestauration MUSS vor dem Body deaktiviert werden. Während des
  initialen `DOMContentLoaded`-, `load`- und `pageshow`-Fensters MUSS die
  Runtime auch eine verspätete Safari-/Visual-Viewport-Restaurierung auf
  Position `0,0` korrigieren. Dieser Reset MUSS mit der ersten echten
  Nutzerinteraktion enden und DARF danach normales Scrollen nicht beeinflussen.

## 17. Ausführbare Absicherung

- **TST-001 Testbestand:** Am Stand dieses Dokuments umfasst die ausführbare
  Spezifikation 326 expandierte Playwright-Fälle in fünf Spec-Dateien und 18
  Node-Server-Tests, insgesamt 344 Fälle.
- **TST-002 Smoke:** 226 Playwright-Fälle tragen `@smoke`. `npm test` prüft
  zuerst die 18 Server-Tests und danach diese 226 Smoke-Fälle.
- **TST-003 Vollständiger Lauf:** `npm run test:full` prüft zuerst alle 18
  Server-Tests und danach alle 326 Playwright-Fälle. Der vollständige lokale
  Vertragslauf ist damit genau ein Befehl:

  ```bash
  npm run test:full
  ```

- **TST-004 Keine Ausnahmen:** Vertrags-Specs DÜRFEN nicht mit `skip` oder
  `only` im regulären Bestand verbleiben.
- **TST-005 Verhaltensbeweis:** Quelltext- und Stringprüfungen dürfen als
  Driftalarm dienen, ersetzen aber keinen Browser-Verhaltenstest für
  Nutzerinteraktionen.
- **TST-006 Regression:** Jeder behobene Nutzerfehler MUSS einen Test erhalten,
  der vor dem Fix am beobachteten Verhalten scheitert und nach dem Fix ohne
  Retry, Force-Click oder Sonderpfad besteht.
- **TST-007 CI-Freigabe:** GitHub Actions und Gitea MÜSSEN beide den
  vollständigen Bestand von 18 Server- und 326 Playwright-Fällen ausführen.
  Gitea verwendet `npm run test:full`. GitHub Actions DARF die Playwright-Fälle
  in disjunkte Shards aufteilen, wenn deren Vereinigung exakt alle 326 Fälle
  enthält, die Serverfälle genau einmal laufen und der Deploy von allen Shards
  abhängt. Kein Deploy darf nur durch den kleineren Smoke-Lauf freigegeben
  werden.
- **TST-008 Parallele Ausführung:** Parallelisierung DARF ausschließlich die
  Verteilung des vollständigen Testbestands verändern. Der lokale automatische
  Standard ist auf höchstens vier Playwright-Worker begrenzt, CI auf höchstens
  zwei Worker je disjunktem Shard. `PLAYWRIGHT_WORKERS` beziehungsweise
  `TEST_WORKERS` dürfen dies für bewusst dimensionierte Ausführungsumgebungen
  überschreiben. Parallelisierung DARF weder Retries noch gelockerte Timeouts,
  ausgelassene Fälle oder abgeschwächte Assertions einführen.
- **TST-009 Service-Worker-Verhalten:** Der No-Cache-Vertrag MUSS zusätzlich zu
  Quelltextalarmen in einem echten Browser bewiesen werden. Der Test MUSS
  Registrierung, Aktivierung, Controllerwechsel, Löschen vorhandener
  Cache-Storage-Bestände, Netzabruf mit `no-store` und ein Release-Update ohne
  Rückgriff auf alte Antworten beobachten. Der Origin-Header der ersten noch
  unkontrollierten Antwort bleibt davon getrennt nachzuweisen.

Abdeckungsbereiche:

| Datei | Verbindlicher Schwerpunkt |
| --- | --- |
| `tests/core-contracts.spec.js` | Modell-, Bus-, Runtime-, Render-, Boundary- und Source-Invarianten |
| `tests/state-tool.spec.js` | Editor, Canvas, Presets, Daten, Fetch, Mobile, Demo, Import und Export |
| `tests/nested-runtime-regressions.spec.js` | verschachtelte Runtime und Ebenenwechsel |
| `tests/state-blueprint-mcp.spec.js` | API-, MCP-, Prompt- und Workspace-Vertrag |
| `tests/root-page.spec.js` | öffentlicher Standalone-Demoexport |
| `server/server.test.js` | Realtime-Transport, Auth, Katalog und Nginx-Grenze |

## 18. Auditbefunde, geschlossene Abweichungen und Risiken

- **GAP-001 SVG-Hit-Priorität, geschlossen am 2026-07-11:** Das Port-SVG liegt
  jetzt gemeinsam mit den Wires unterhalb der Node-Ebene; seine Port-, Pin- und
  Tip-Hitflächen bleiben außerhalb von Nodes interaktiv. Ein Browser-
  Regressionstest legt `.svg-port` und `.edge-pin` eines Owners geometrisch
  über einen fremden State. `elementsFromPoint` belegt beide SVG-Hitflächen,
  `elementFromPoint` liefert dennoch den fremden State, und je ein unabhängiger
  erster, nicht erzwungener Click und Drag wählt beziehungsweise bewegt nur
  diesen State. Die vorhandenen Geometrie-, Connect- und Reroute-Tests sichern
  die Erreichbarkeit der eigenen Portzone weiter ab. Die eigentliche SVG-Hitbox
  behält ihre kollisionsfreie Größe von 18 Welt-Pixeln nach außen und 32 Welt-
  Pixeln Höhe. Zusätzlich wird eine 32 × 44 CSS-Pixel große Ausgangszone in
  Bildschirmkoordinaten als ausstehender Drag-Kandidat erkannt. Sie läuft nur
  auf leerer Canvas-Fläche und startet eine Verbindung erst nach mehr als 7
  CSS-Pixeln Mausbewegung vom Port weg. Eine zum Port gerichtete Anfangsbewegung
  bleibt ein Canvas-Pan. Drücken oder Klicken allein startet keine Verbindung;
  Node-Drags, Transition-Pins, Pfeilspitzen, Reroutes und Canvas-Doppelklicks
  behalten ihre bisherige Trefferlogik. Der Demo-Traversal rollt jedes Control
  einmal sichtbar, prüft dessen Mittelpunkt als ersten Hit und führt genau einen
  nicht erzwungenen Click aus. Auch der allgemeine Transition-Click-Helfer
  verlangt nun einen freien Trefferpunkt und besitzt keinen Force-Fallback mehr.
- **GAP-002 Definitionsformat, geschlossen am 2026-07-10:** Editor, MCP-Core
  und MCP-Import verwenden jetzt einheitlich
  `kind: "state-blueprint-definition"` mit `schemaVersion: 2`. Ein Smoke-Test
  liest den Editor-Discriminator, vergleicht ihn mit dem MCP-Export und prüft
  Export, Reimport, Validierung und persistierten Workspace als Roundtrip.
- **GAP-003 Geteilte Kernlogik, offen am 2026-07-12:** Modellnormalisierung und Teile der
  Ablauflogik existieren getrennt im Host, in der eingebetteten Runtime und im
  MCP-Core. Die finale Runtime wird zusätzlich durch exakte String-Ersetzungen
  von `enhanceGeneratedAppHtml(APP_HTML)` erzeugt. Source-Tests wirken als
  Driftalarm, aber es gibt noch kein gemeinsam importiertes Kernmodul. Kleine
  Quellenabweichungen können deshalb Editor, Export und MCP auseinanderlaufen
  lassen.
- **GAP-004 Übersetzungs- und Testdrift, geschlossen am 2026-07-10:** Die 21
  zuvor roten `state-tool`-Fälle wurden gegen das beabsichtigte deutsche
  Produktverhalten bereinigt. Sichtbare Systemtexte werden deutsch erwartet;
  frei modellierte Busdaten wie `Shipping` und `Returns` bleiben wortgetreu und
  werden nicht heimlich übersetzt. Interne IDs und Funktionsnamen bleiben von
  der Oberflächenübersetzung unberührt. Die normative Orthografieregel und der
  UTF-8-/Orthografie-Smoke-Test sichern native Umlaute und `ß` gegen erneute
  ASCII-Umschrift ab.
  Der damalige Freigabestand bestand mit 315/315 Playwright- und 14/14 Server-
  Fällen; der aktuelle Bestand ist unter `TST-001` festgehalten.
- **GAP-005 Mobile Bedienbarkeit, geschlossen am 2026-07-11:** Der visuelle
  Ist-Audit mit 360×800, 390×844, 430×932 und 844×390 Pixeln belegte fünf
  Vertragsverletzungen: unlesbar klein eingepasste Zustände, eine nur 80 Pixel
  hohe und damit unbedienbare Vorschau, tote Restflächen in Details und
  Vorschau, abgeschnittene sechs-spaltige Navigation sowie ein unbrauchbarer
  Querformat-Split. Der neue Mobile-Vertrag verwendet deshalb in Portrait,
  Querformat und auf mittleren Touch-Geräten ausschließlich vier Arbeitsansichten:
  `canvas`, `presets`, `edit` und `app`. Die Navigation zeigt nur Canvas,
  Vorlagen, Details und Vorschau. Undo/Redo liegen ausschließlich als
  44-Pixel-Aktionen oben rechts auf dem Canvas. Mobile Panel-Resizer sind
  deaktiviert.
  Beim Öffnen oder Laden fokussiert der Canvas den fachlichen Startzustand mit
  mindestens 0,82 Skalierung; der explizite Befehl `Einpassen` bleibt der
  vollständige Modellüberblick. Die Vorlagenansicht belegt die ganze
  Arbeitsfläche und ordnet kompakte Karten adaptiv an. Kein mobiler Modus darf
  ein unabhängiges zweites Panel oder eine unsichtbare Restzeile reservieren.
  Die Vorschau verwendet seit dem Live-Ablauf-Audit denselben Canvas-Renderer
  als festen, nicht interaktiven Runtime-Monitor über beziehungsweise neben der
  App; sie besitzt weder einen Resizer noch eine zweite Canvas-Geometrie. Der
  Nachher-Audit derselben vier Viewports bestätigt für alle 16 Kombinationen
  aus Viewport und Modus: exakt eine vollflächige Arbeitsansicht, keine
  abgeschnittenen Tabs, keinen Dokument-Overflow und keine Browser- oder
  Konsolenfehler.
- **GAP-006 Geteilte CI-Abnahme, geschlossen am 2026-07-10:**
  `npm run test:full` umfasst Server und Browser und bleibt die lokale sowie die
  Gitea-Abnahme. GitHub Actions prüft denselben Bestand schneller in vier
  disjunkten Playwright-Shards und einem einmaligen Serverlauf. Der Deploy-Job
  hängt vom Erfolg der gesamten Matrix ab; die Freigabe umfasst deshalb weiter
  alle 344 Vertragsfälle.
- **GAP-007 Realtime-Ausgang am Parent, geschlossen am 2026-07-11:** Das im
  Nutzerbrowser persistierte Fehlermodell enthielt einen aktiven Parent
  `start`, dessen manuellen Boundary-Eintritt und den echten Realtime-Ausgang
  `start -> zustand_2`. Das Serverereignis erreichte den Browser und wurde im
  Bus gezählt; `transitionMatchesRuntimeEvent` und die leere Bedingung waren
  beide wahr. `outgoing("start")` gab jedoch ausschließlich den synthetischen
  Kind-Eintritt zurück und entfernte den echten Realtime-Ausgang. Runtime und
  Editor kombinieren am aktiven Parent nun den Kind-Eintritt mit sämtlichen
  echten direkten Parent-Ausgängen, unabhängig von deren Triggerart. Die
  Browsertests sichern sowohl die gleichzeitige Sichtbarkeit eines direkten
  Parent-Buttons als auch den Wechsel über einen Realtime-Ausgang nach einer
  einzelnen Nachricht ohne Retry ab.
- **GAP-008 Realtime-Verlustpfade, historisch geschlossen am 2026-07-11 und
  durch RT-024 teilweise überholt:** Ein zweiter
  reproduzierter Fehler überschrieb lokal erzeugte Realtime-Ereignisse durch
  das folgende `state.*.entered`, bevor der Host den `lastEvent`-Snapshot
  relayn konnte. Die Runtime meldet deshalb das Realtime-Ereignis vor der
  Transition dediziert an den Host. Der Host dedupliziert, behält ausgehende
  Ereignisse bis zum Join vollständig und überschreibt eingehende Ereignisse
  bei einem nicht bereiten Frame nicht mehr mit Status oder Modell. Der Server
  transportiert die Katalogdefinition mit der Nachricht, sodass ein separater
  Katalogfehler den Bus-Eintritt nicht verwirft. Drei Browserregressionen prüfen
  Parent-Ausgang, genau einmaligen Relay und Frame-/Katalogausfall. Nach der
  trigger-only-Entscheidung bleiben geordnete eingehende Frame-Zustellung und
  mitgelieferte Katalogdefinition gültig. Der lokale Outbound-Relay und sein
  positiver Test gehören dagegen nicht mehr zum Zielvertrag; siehe GAP-018 und
  GAP-026.
- **GAP-009 Auslieferungscache, entfernt am 2026-07-11:** Auf ausdrücklichen
  Produktvertrag gibt es keinen App-Shell- oder Asset-Cache mehr. Der Worker
  löscht beim Installieren und Aktivieren alle Cache-Storage-Bestände, hängt an
  jeden gleich-originigen GET einen versionsgebundenen Cache-Buster und lädt mit
  `no-store`. Die Registrierung lädt den Deploy-Stamp ebenfalls cachefrei und
  setzt `updateViaCache: "none"`.
- **GAP-010 Zielunabhängige Übergangsnamen, geschlossen am 2026-07-12:** Neue
  Transitionen aus Canvas, API, MCP und Prompt-Planung verwenden den stabilen
  Standard `Weiter`. Editor und Zustandsinspektor zeigen Quelle und Ziel separat
  als Route. Labelinhalte werden weder als Generatorwerte erkannt noch anhand
  eines Ziels umgeschrieben. Die zuvor vorhandene Kompatibilitätserkennung ist
  vollständig entfernt. Regressionen sichern zusätzlich ab, dass eine spätere
  Zustandsumbenennung das Transitionlabel nicht verändert.
- **GAP-011 Mobile Real-Browser-Nachabnahme, geschlossen am 2026-07-12:** Die
  vier mobilen Arbeitsansichten wurden nach der Umsetzung erneut in Chromium
  bei 360×800 und 390×844 Pixeln sowie im Querformat bei 844×390 Pixeln
  bedient und fotografiert. Canvas, Vorlagen, Details und Vorschau bleiben ohne
  relevante horizontale Überläufe oder gegenseitige Überdeckung erreichbar.
  In der Vorschau bleibt der nicht interaktive Live-Canvas sichtbar, während
  die App unabhängig vertikal bedienbar ist; ein einzelner normaler Klick auf
  `Nutzen` wechselte App und Canvas-Markierung gemeinsam zu `site_features`.
  Verzögerte Kamera-Speicherungen erfassen ihren Canvas-Snapshot bereits beim
  Planen und lesen niemals später die temporäre Monitor-Kamera aus; auch ein
  zeitgleich fälliger Speichertimer kann die nutzereigene Kamera daher nicht
  überschreiben.
  Die gleiche Vorschau wurde zusätzlich mit WebKit geprüft. Ein WebKit-Reload
  der zuvor gescrollten Root-Demo endete nach `DOMContentLoaded`, `load` und
  dem verzögerten Viewport-Fenster bei Dokument-, Body- und Visual-Viewport-
  Position `0`; es traten keine Page-Errors und kein festsitzender oberer
  Leerraum auf.
- **GAP-012 Lokale Testparallelität, geschlossen am 2026-07-12:** Sechs
  gleichzeitige Chromium-Worker auf einem Rechner mit sechs logischen Kernen
  sättigten die Ausführungsumgebung. Unveränderte UI-, Timer- und Demo-Fälle
  benötigten dadurch das Zwei- bis Dreifache ihrer kontrollierten Laufzeit und
  verfehlten Interaktionsfenster. Alle fünf betroffenen Szenarien bestanden
  anschließend ohne Produktänderung jeweils zweimal mit zwei Workern. Der
  lokale automatische Standard verwendet deshalb höchstens vier Worker. Die
  Abdeckung bleibt vollständig; CI beschleunigt weiter über vier disjunkte
  Shards mit jeweils höchstens zwei Workern.
- **GAP-013 Geteilte Runtime-Erzeugung, offen am 2026-07-12:** Die finale
  Runtime entsteht weiterhin aus `APP_HTML` und 105 überwiegend stillen
  String-Ersetzungen in `enhanceGeneratedAppHtml`. Mindestens die vorgesehene
  Erweiterung von `runtimeChildEntryTransition` greift im auditierten Stand
  nicht: Das erzeugte `index.html` enthält weder `runtimeBoundaryEntry` noch die
  dort vorgesehenen Boundary-Trigger-, Condition- und Timerfelder. Auch
  `replaceGeneratedRange` gibt bei fehlenden Markern unverändert die Quelle
  zurück. Damit können Vorschau, Export und MCP-Export trotz grüner
  Quelltextalarme semantisch driften. Das widerspricht PRN-007 und EXP-007.
- **GAP-014 Label bleibt nicht überall reine Anzeige, offen am 2026-07-12:** Die
  exportierte Runtime normalisiert ein leeres Transitionlabel noch zu `Next`;
  der MCP-Upsert behält bei einem ausdrücklich leeren Label den bisherigen Namen
  statt `Weiter` zu setzen. Zusätzlich klassifiziert `isNegativeTransition`
  Labels anhand von Wörtern wie `Fehler`, `Zurück`, `Back` oder `Abbruch`, um die
  per Enter aktivierte Standardaktion auszuwählen. Eine reine Umbenennung kann
  dadurch Laufzeitverhalten ändern. Das verletzt TRN-004, TRN-005 und TRN-015.
- **GAP-015 Verdeckte Fetch- und Eingabeinferenz, offen am 2026-07-12:**
  `transitionMatchesRuntimeEvent` behandelt eine Transition als passenden
  Fetch-Ausgang, sobald ihre Condition den aktiven Fetch-Zielpfad erwähnt. Eine
  nicht typisierte und dadurch als `button` normalisierte Transition kann so
  ohne Button-Ereignis automatisch feuern. `inferVariables` leitet außerdem aus
  Condition-Text nicht deklarierte Eingabefelder ab und rendert sie. Condition
  entscheidet damit nicht nur nach einem passenden Trigger über die Zulassung,
  sondern beeinflusst Trigger und Darstellung. Das widerspricht PRN-002,
  TRN-003 und TRN-006; bestehende Fetch-Tests schreiben einen Teil dieses
  Verhaltens derzeit fest.
- **GAP-016 Realtime-Bindings ohne wirksames Ziel, offen am 2026-07-12:** Der
  Standardkatalog und `docs/realtime-api.md` liefern Bindings nach
  `realtime.*`. `runtimeExternalWritePathIsAuthorized` erlaubt für externe
  Bindings dagegen nur deklarierte `states.*`-Pfade oder ausdrücklich
  freigegebene Bookkeeping-Pfade und verwirft diese Katalogziele. Ein Test
  erwartet dieses Verwerfen ausdrücklich. Der Ereignispayload liegt bereits
  ohne Kopie unter `events.<name>.detail`; der Vertrag muss entscheiden, ob
  Katalogbindings ganz entfallen oder ausschließlich modellseitig deklarierte
  State-Ziele verwenden.
- **GAP-017 Mehrdeutige Ereignisauflösung, offen am 2026-07-12:** Mehrere
  ausgehende Event-, Realtime-, Change-, Timer- oder Auto-Transitionen können
  denselben effektiven Auslöser besitzen. Die Runtime feuert derzeit die erste
  Transition in Modellreihenfolge, deren Condition wahr ist. Weder Vertrag noch
  Validator definieren oder beanstanden diese unsichtbare Priorität. Auch die
  Reihenfolge zwischen direktem Child-Ausgang und projiziertem Parent-Ausgang
  ist dadurch fachlich relevant, ohne als Priorität modelliert zu sein.
- **GAP-018 Realtime-Zustellgarantie, offen am 2026-07-12:** Die ausgehende
  Browserqueue ist flüchtiger Speicher. Ein Payload wird direkt nach
  `WebSocket.send` entfernt; der Server bestätigt weder Annahme noch Relay und
  besitzt kein Replay. Reload, Prozessneustart oder ein Verbindungsabbruch im
  unbestätigten Fenster können daher Ereignisse verlieren. Die Sequenzprüfung
  verhindert Duplikate, ersetzt aber kein ACK. Eine unbegrenzte flüchtige Queue
  ist zugleich keine belastbare Ressourcenregel. Der bestehende zustandslose
  Serververtrag garantiert geordnete Live-Übertragung, aber keine absolute oder
  dauerhafte Zustellung. Nach RT-024 gehört diese Browser-Outbox nicht mehr zum
  aktuellen Produktumfang und ist zu entfernen. Die Zustellklassenfrage aus
  DEC-004 bleibt nur für externe Integrationen beziehungsweise einen später neu
  entschiedenen Emitter relevant.
- **GAP-019 Erzwungene und wiederholte Testinteraktionen, offen am 2026-07-12:**
  Gemeinsame Inspector-Helfer in `state-tool.spec.js` und
  `core-contracts.spec.js` verwenden weiterhin Playwright-Force-Clicks. Der
  gemeinsame Ebenenwechsel-Helfer versucht einen Doppelklick bis zu dreimal.
  Dadurch können zahlreiche Tests trotz einer real schwer oder nicht beim
  ersten Versuch erreichbaren Bedienfläche grün bleiben. Das widerspricht
  TST-006 und der für CAN-012 beziehungsweise DEMO-005 bereits durchgesetzten
  Ersttrefferregel.
- **GAP-020 Triggerdialekt `immediate` gegen `auto`, offen am 2026-07-12:**
  TRN-003 und FX-008 nennen `immediate`; Editor, API-Dokumentation, MCP und
  Runtime akzeptieren stattdessen `auto`. Ein eingelesenes `immediate` wird
  aktuell zu `button` normalisiert. Es gibt damit keinen einzigen
  schemaübergreifend kanonischen Namen für eine ereignislose unmittelbare
  Fortsetzung.
- **GAP-021 Template-Tokens gegen strukturierte Data Wires, offen am
  2026-07-12:** REN-010 verbietet eine sichtbare Datenabbildung über
  `{{...}}`-Tokens. Die Runtime implementiert mit `renderLiteralText` und
  `exactTemplatePath` weiterhin genau diese Syntax; zahlreiche Tests und
  Testmodelle verwenden sie für Text, Links, Fetch und Repeat. Der aktuelle
  Bestand behauptet deshalb gleichzeitig, Tokens seien verboten und
  ausführbarer Vertragsbestand.
- **GAP-022 Pause als Schattenzustand, offen am 2026-07-12:** Neben
  `runtime.paused` im Bus hält der Host `runtimePaused` als schreibbare lokale
  Variable und der MCP-Workspace ein gleichnamiges Editorfeld. Die Hostvariable
  steuert Buttontext, Reload-Payload und den nächsten Toggle-Befehl. Das ist mehr
  als eine rein lesende Momentaufnahme und widerspricht STA-010, solange ihre
  Projektions- und Befehlsgrenze nicht enger definiert oder die Variable entfernt
  wird.
- **GAP-023 Safari nur manuell nachgewiesen, offen am 2026-07-12:**
  DEMO-012 besitzt einen automatisierten Reload-Test, der reguläre
  Vertragsbestand installiert und startet jedoch nur Chromium. Der in GAP-011
  genannte WebKit-Lauf war eine manuelle Abnahme und ist keine dauerhafte
  CI-Regression. Der ursprüngliche Safari-Fehler kann deshalb browserbezogen
  zurückkehren, ohne die Freigabematrix zu brechen.
- **GAP-024 Uneinheitliche Node-Geometrie, offen am 2026-07-12:** Der Editor
  berechnet State-Breiten titelabhängig zwischen 168 und 720 Pixeln; der MCP-Core
  rechnet für Bounds, Gruppierung, Duplikation und Viewport-Fit fest mit 168
  Pixeln. CAN-014 erlaubt sowohl Wachstum als auch kontrollierte Zweizeiligkeit
  und entscheidet die Produktfrage damit nicht. Editor und headless Operationen
  besitzen aktuell keine gemeinsame Geometriewahrheit.
- **GAP-025 Verbleibende Kompatibilitätsoberflächen, offen am 2026-07-12:** Der
  MCP-Workspace akzeptiert zusätzlich `state-blueprint.definition`, Releasecode
  erkennt weiterhin `deploy-*`, und der Prompt-Parser akzeptiert `uebergang`.
  MOD-005 und die ausdrücklich festgelegte strikte v2-Politik erlauben keinen
  dieser Pfade. Sie sind zu entfernen; es gibt dafür keine noch offene
  Kompatibilitätsentscheidung.
- **GAP-026 Halbe Realtime-Produktoberflächen, offen am 2026-07-12:** Der Server
  unterstützt und testet `presence.cursor` sowie Peer-Join/-Leave, obwohl der
  Editor diese Presence nicht verwendet. Der Host veröffentlicht zusätzlich
  `window.__stateBlueprintRealtime.emit`, ohne dass ein Emitter als
  Modelloperation, Transitionwirkung oder Zustellvertrag definiert ist. RT-024
  entscheidet den aktuellen Produktumfang als trigger-only: Die lokale Emit-API
  und die ungenutzte Presence-Oberfläche sind deshalb zu entfernen, nicht zu
  einem halben Emittersystem auszubauen.
- **GAP-027 Erste unkontrollierte Auslieferung, offen am 2026-07-12:** Der
  Service Worker erzwingt Cache-Buster und `no-store`, sobald er eine Seite
  kontrolliert. Die erste HTML-Antwort vor Registrierung des Workers wird im
  Repository jedoch nicht durch einen Origin-Headervertrag abgesichert. Der
  Produktionsabruf nach Freigabe von `release-64` am 2026-07-12 bestätigt den
  offenen Widerspruch: `/`, `index.html`, `state.html`, `sw.js`,
  `register-sw.js` und `sw-version.js` werden von GitHub Pages jeweils mit
  `Cache-Control: max-age=600` ausgeliefert. Cache-Buster, Fetch-Option und
  `updateViaCache: "none"` sichern nur die dafür vorgesehenen Browserpfade; sie
  ändern diesen Origin-Header nicht und schützen insbesondere den ersten noch
  unkontrollierten Dokumentabruf nicht. Soll DEMO-011 ausnahmslos auch für
  diesen Request gelten, benötigt die statische Auslieferung eine überprüfbare
  server- oder CDN-seitige `Cache-Control: no-store`-Regel.
- **GAP-028 Condition-Sprache ohne exakte Grammatik, offen am 2026-07-12:** Die
  Runtime unterstützt faktisch eine kleine Sprache aus `!`, Vergleichen, `&&`
  und `||`, zerlegt diese Operatoren jedoch per String-Split und validiert die
  Syntax beim Speichern nicht. Klammern, Escaping, Operatoren in Stringwerten,
  Typumwandlung und Fehlerdarstellung sind nicht normativ festgelegt. Ein
  Schreibfehler kann deshalb lediglich als nicht erfüllte Condition erscheinen.
- **GAP-029 Standalone wartet auf einen nicht vorhandenen Host, offen am
  2026-07-12:** `hasHostWindow()` wertet jedes `parent !== window` und jeden
  vorhandenen `window.opener` als Editorhost. Der Standalone-Build deaktiviert
  gleichzeitig seine Modell- und Storage-Listener. Ein echter Chromium-Lauf
  zeigte deshalb: Top-Level rendert `site_home` mit Überschrift `Start`; derselbe
  `index.html`-Export besitzt im `iframe` und in einem Fenster mit Opener einen
  leeren State-Pill, keine Überschrift und keine Screen-Kindelemente. Kein bestehender
  Test startet einen Standalone-Export in diesen Umgebungen. Das verletzt
  EXP-005 und EXP-012.
- **GAP-030 Leeres Modell erzeugt einen erfundenen Zustand, offen am
  2026-07-12:** MOD-001 erlaubt `initial: ""`, `states: []` und
  `transitions: []`. Die Runtime-Normalisierung fügt trotzdem einen Zustand
  `start` mit Titel `Start` ein. Im Chromium-Test zeigte die Editorvorschau für
  ein formal leeres gespeichertes Modell genau diesen synthetischen Zustand.
  Der bestehende Blank-Runtime-Test sendet nach dem Start ein nicht leeres
  Modell; der Blank-Export-Test prüft nur die heruntergeladene Definition. Beide
  verfehlen MOD-010.
- **GAP-031 Zustandsdaten verletzen Scope, Eintritt und Laufzeitbesitz, offen am
  2026-07-12:** Host, Runtime und MCP erhalten unqualifizierte `state.data`-
  Schlüssel. Die Runtime schrieb `{local: "value"}` nachweislich als
  `context.local` statt `states.<id>.local`. Flache Schlüssel wie `"states.a"`
  und ein verschachteltes `states.a` werden gleichzeitig akzeptiert; bei
  vertauschter JSON-Property-Reihenfolge gewann jeweils der zuerst gelesene Wert.
  Ein Modell-Hot-Update befüllte außerdem Daten von Zustand `b`, obwohl Zustand
  `a` aktiv blieb, und ersetzte einen durch eine echte Transition auf
  `user-value` geänderten Buswert anschließend durch `edited-default`.
  Validatoren prüfen weder Besitzer-Scope noch überlappende Pfade. Mehrere
  vorhandene Tests erwarten unqualifizierte Defaults oder das Live-Einfügen
  neuer Defaults und schreiben damit Teile des Verstoßes gegen STA-002,
  STA-005, STA-006, STA-008 und STA-012 fest.
- **GAP-032 MCP-Normalisierung verliert oder erfindet Vertragsfelder, offen am
  2026-07-12:** Für eine State-Datenquelle ohne Ziel setzt MCP global `fetch`,
  während Editor und Runtime `states.<stateId>.fetch` verwenden. MCP entfernt
  bei Boundary-Konfigurationen `entryTimerMs` und `entryCondition`; sein
  Standardmodell heißt `State App` statt des Editorstandards. Die Aktionsroute
  `configure_fetch` setzt den Scope zwar korrekt, ein importiertes oder ganz
  ersetztes Modell jedoch nicht. Bestehende MCP-Tests decken nur den
  Aktionspfad ab. Das verletzt FX-002 und API-011.
- **GAP-033 ID-Prüfung ist nicht kanonisch und schützt technische Namensräume
  nicht vollständig, offen am 2026-07-12:** Der Editorvalidator akzeptierte eine
  Definition mit `State One`, `Done-State` und Transition `Go Now` vollständig.
  Die anschließende Normalisierung änderte die State-IDs zu `state_one` und
  `done_state`, leerte `initial` und entfernte die Transition, statt Referenzen
  atomar umzuschreiben oder die Definition abzulehnen. Der MCP-Validator nahm
  zusätzlich eine Transition `__runtime_edge` sowie eine frei eingespeiste
  `boundary-flow:*`-Kante mit `proxy:*`-Endpunkt als gültig an. Das verletzt
  MOD-007, ID-003, ID-004, ID-007 und EXP-003.
- **GAP-034 Formale Boundary-Definitionen unterscheiden sich zwischen Editor
  und MCP, offen am 2026-07-12:** `modelDefinitionSnapshot()` entfernt jede
  `boundaryFlow`-Transition. `mcp.definitionPayload()` exportiert dieselben
  technischen `boundary-flow:*`-/`proxy:*`-Kanten dagegen als Teil des formalen
  Modells. Der MCP-Roundtrip-Test prüft ihren Workspace-Bestand, vergleicht aber
  die formale Transitionmenge nicht mit dem Editor. ID-004, EXP-001, API-009 und
  die noch offene Materialisierungsentscheidung DEC-005 sind damit nicht
  konsistent umgesetzt.
- **GAP-035 Generischer Standalone-Export trägt fremde Plattformmetadaten und
  driftet vom MCP-Export, offen am 2026-07-12:** Der Editor injiziert in jeden
  Nutzerexport die Canonical-URL und Share-Card von
  `digitalisierungsplanung.de`, absolute Root-Referenzen auf Manifest und Icons
  sowie `/register-sw.js`. Der Export ist dadurch nicht mehr origin-unabhängig
  selbstenthalten und versucht auf einem fremden Host dessen Root-Scope als
  Service Worker zu verwenden. Der MCP-HTML-Export injiziert diese Tags nicht;
  beide Exporte sind für dasselbe Modell also nicht gleich. Die öffentliche
  Root-Demo benötigt ein eigenes Veröffentlichungsprofil gemäß EXP-013.
- **GAP-036 Host-/Runtime-Nachrichten prüfen ihre Quelle nicht, offen am
  2026-07-12:** Der Host verarbeitet `SHORTCUT`, `OPEN_URL`, `RUNTIME_EVENT` und
  `RUNTIME_STATE` ohne `evt.source`-, Origin- oder Sitzungsprüfung; die
  Vorschau-Runtime verfährt mit Modell-, Control-, Status- und Realtime-
  Nachrichten ebenso. Ein zweites, nicht als Vorschau registriertes Child-
  Iframe konnte im Browser den angezeigten Runtimezustand eines gültigen
  Zweizustandsmodells von `a` auf `b` setzen. Die Nachrichten verwenden zudem
  `targetOrigin: "*"`. Es fehlt jeder Negativtest mit einer fremden Quelle. Das
  verletzt SYS-007 und erlaubt neben falscher Canvas-Projektion auch fremde
  Shortcuts, Realtime-Aktionen und Navigation.
- **GAP-037 No-Cache ist nur als Quelltext, nicht als Worker-Verhalten getestet,
  offen am 2026-07-12:** `root-page.spec.js` lädt `sw.js` und `register-sw.js`
  als Text und prüft Marker. Kein Test registriert einen Worker, beobachtet
  `controllerchange`, legt einen Cache-Storage-Bestand an, prüft dessen Löschung
  oder führt ein Release-Update gegen echte Netzantworten aus. TST-005 und
  TST-009 verlangen diesen Browserbeweis; die erste unkontrollierte Antwort
  bleibt zusätzlich GAP-027.
- **GAP-038 `renderMode: "component"` ist eine nicht definierte passive
  Zustandssemantik, offen am 2026-07-12:** Ein Child mit diesem Modus wird samt
  eigener Defaults rekursiv im aktiven Parent gerendert, obwohl es nicht der
  aktuelle FSM-Zustand ist und seine Transitionen nicht zur aktiven
  Kandidatenmenge gehören. Ein Smoke-Test erwartet dieses Verhalten
  ausdrücklich, während andere Tests nur das alte Feld `passiveRender`
  verbieten. Der Vertrag beschreibt Children als echte innere FSM-Schritte und
  definiert keine parallele oder passive Region. Damit sind PRN-002, PRN-006,
  STA-005 und NEST-001 gegenüber der API-Beschreibung eines
  „komponentenartigen Zustands“ unvollständig.
- **GAP-039 Sichtbare englische Systemdefaults verbleiben in der Runtime und im
  MCP-Promptpfad, offen am 2026-07-12:** Der erzeugte Export enthält weiterhin
  `Next` als leeres Transitionlabel und abgeleiteten Kind-Eintritt, `Next` als
  Carousel-Aktion sowie `Step`, `Value`, `Price` und `Item` als automatisch
  sichtbare Fallbacktitel. Der MCP-Intentparser erzeugt ebenfalls `Next` und
  `Step`. Diese Strings stammen vom Produkt, nicht aus Nutzerdaten, und
  widersprechen TRN-015 sowie EXP-014. Der vorhandene Orthografietest sucht nur
  nach ASCII-Umschriften deutscher Wörter und erkennt diese Sprachdrift nicht.

Auditnachweis vom 2026-07-12 auf `6db6c54`: Alle 18 Node-Server-Tests bestanden
in 9,4 Sekunden; alle 326 expandierten Playwright-Fälle bestanden mit vier
Chromium-Workern in 3,9 Minuten. `--list --grep @smoke` bestätigte 226 Smoke-
Fälle in fünf Dateien. Es existieren keine regulären `skip`- oder `only`-Fälle.
Die sieben in den angehängten CI-Verläufen zu #42, #50 und #54 fehlgeschlagenen
Double-Click-, Parent-Rewire-, Node-Breiten-, Transition-Hit- und Reroute-Fälle
bestanden auf der Auditbasis anschließend jeweils dreimal, insgesamt 21/21 in
18,5 Sekunden. Der weiterhin dreifach versuchende gemeinsame Ebenenhelfer aus
GAP-019 bleibt davon unberührt und ist kein Ersttrefferbeweis.
Die grünen 344/344 Fälle schließen die oben reproduzierten Lücken ausdrücklich
nicht, weil die betreffenden Umgebungen, Fremdquellen und Paritätsvergleiche im
aktuellen Bestand fehlen oder widersprüchliches Verhalten positiv festschreiben.

## 19. Implementierungslandkarte des Ist-Stands

Diese Landkarte beschreibt den auditierten Aufbau. Widerspricht ein Ist-Punkt
einer Vertragsregel, ist er in Abschnitt 18 als offene Abweichung zu behandeln.

- **ARC-001 Editor-Monolith:** `state.html` ist eine selbstenthaltene
  Vanilla-JavaScript-Anwendung. Sie enthält Host-Oberfläche, Canvas, SVG-
  Routing, Inspektoren, Presets, Modelloperationen, Persistenz, Exportlogik und
  den escaped Quelltext der generierten Runtime.
- **ARC-002 Editorzustand:** Der Host speichert Modell, Auswahl, aktive Ebene,
  State-Presets und bearbeitetes Preset unter
  `stateBlueprintHotLinked.model.v2.editor`. Kamera, UI-Zustand und
  State-Explorer liegen getrennt unter `.camera`, `.ui` und `.stateExplorer`.
  Runtime-Kontext wird nicht in State-Defaults zurückpersistiert.
- **ARC-003 Historie:** Undo/Redo erfasst normalisierte Modell- und relevante
  Sitzungssnapshots, fasst zusammengehörige Dauerinteraktionen über einen
  History-Key zusammen und begrenzt die Historie auf 100 Einträge.
- **ARC-004 Runtime-Erzeugung:** `APP_HTML` enthält die eingebettete
  Standalone-Runtime. `enhanceGeneratedAppHtml` erweitert diesen Quelltext;
  `GENERATED_APP_HTML` wird anschließend als Blob-URL in das Vorschau-Iframe
  geladen. Der Standalone-Export injiziert das Modell in genau diesen Quelltext
  und deaktiviert dessen lokale Editor-Modellpfade. Die Erweiterungen beruhen
  derzeit auf stillen String- und Bereichsersetzungen; siehe GAP-013. Der
  Standalone-Start verwechselt jede Parent-/Opener-Beziehung mit einem Host und
  generische Editor-Exporte erhalten Root-Demo-Metadaten; siehe GAP-029 und
  GAP-035.
- **ARC-005 Host-Runtime-Brücke:** Der Host sendet Modell, Reset- und
  Startinformationen per `STATE_BLUEPRINT_MODEL`. Die Runtime antwortet mit
  `STATE_BLUEPRINT_RUNTIME_STATE` und meldet Realtime-Busereignisse vor ihrer
  Transition zusätzlich per `STATE_BLUEPRINT_RUNTIME_EVENT`. Der Host verwendet
  diese Antworten nur für Anzeige, aktive Canvas-Markierung, Ebenenbezug und
  Realtime-Transport; sie sind kein zweiter persistierter Runtime-Speicher. Die
  aktuelle Brücke authentifiziert die konkrete Nachrichtenquelle nicht; siehe
  GAP-036.
- **ARC-006 Runtime-Bus:** Fachliche Schreibvorgänge laufen zentral durch den
  Runtime-Bus und eine erlaubte Quellenliste. Echte UI-Ereignisse werden von
  synthetischen Ereignissen unterschieden. Pause leert Warteschlange, Timer und
  Countdowns und sperrt weitere Ereignisverarbeitung bis zur Fortsetzung.
  State-Defaults und Modell-Hot-Updates umgehen derzeit jedoch Owner-Scope,
  Eintrittszeitpunkt und den Besitz bereits geänderter Runtime-Werte; siehe
  GAP-031.
- **ARC-007 Transitionen und Fetch:** Ereignisse werden gezählt und in einer
  Warteschlange verarbeitet. Die Condition-Auswertung nutzt ein begrenztes, eval-freies
  Ausdrucksmodell. Fetch ist ein State-Eintrittseffekt; Aktivierungs-ID und
  Quellsignatur verwerfen veraltete Antworten, Retries wachsen exponentiell und
  Erfolg beziehungsweise Fehler treten wieder als FSM-Ereignisse ein. Der
  aktuelle Resolver leitet die Fetch-Kandidatur zusätzlich aus dem Condition-
  Text ab; siehe GAP-015.
- **ARC-008 Rendering:** Die Runtime rendert die aktive Eltern-/Kindkette aus
  strukturierten State-Daten. Explizite Render-Reihenfolge verbindet manuelle
  Komponenten, `dataWire`-Referenzen und `transitionButton`-Referenzen. Text ist
  Anzeige; nur explizite Transition-IDs binden eine Nutzeraktion an den Ablauf.
  Parallel dazu interpretiert `renderLiteralText` weiterhin `{{path}}`-Tokens;
  siehe GAP-021. `renderMode: "component"` rendert außerdem nicht aktive
  Child-States passiv in ihren Parent; siehe GAP-038.
- **ARC-009 MCP-Schicht:** `mcp/state-blueprint-core.js` implementiert
  normalisierte Modellaktionen und Editor-Kommandos ohne DOM. Der
  `state-blueprint-server.js` stellt sie als zeilenbasiertes JSON-RPC über stdio
  mit dateibasiertem Workspace bereit. `state-blueprint-intents.js` ist ein
  deterministischer Regex-Intent-Parser und kein Sprachmodell; sein Ergebnis
  sind normale, validierte Aktionen. Normalisierung, technische IDs und formale
  Exporte sind noch nicht vollständig editorgleich; siehe GAP-032 bis GAP-034.
- **ARC-010 Realtime-Schicht:** `server/server.js` liefert Katalog, HMAC-
  Raumtoken, WebSocket-Relay und HTTP-Emit. Der Server bleibt fachlich zustandslos.
  Das vorhandene Presence-Protokoll ist flüchtig und derzeit nicht in die
  Editoroberfläche integriert. Der Host besitzt daneben eine nicht modellierte
  lokale Emit-Funktion, die nach der trigger-only-Entscheidung zu entfernen ist;
  siehe GAP-018 und GAP-026.
- **ARC-011 Build und Öffentlichkeit:** `scripts/build-index.mjs` startet den
  echten Editor mit `?demo=zustand`, betätigt dessen Export und schreibt das
  Ergebnis als `index.html`. Die Root-Seite ist deshalb die laufende exportierte
  Demo. `sw.js` hält keinen App-Cache: Er löscht vorhandene Cache-Storage-
  Bestände und lädt Navigation sowie Assets mit Cache-Buster und `no-store`
  ausschließlich aus dem Netz. Dieses Verhalten ist bislang nur per Source-
  Test, nicht als echter Worker-Lebenszyklus abgesichert; siehe GAP-027 und
  GAP-037.
- **ARC-012 Deployment:** GitHub Actions installiert Abhängigkeiten in vier
  parallelen Browser-Shards, führt die Serverfälle einmal aus und aktualisiert
  den Service-Worker-Deploy-Stamp erst nach Erfolg der vollständigen Matrix.
  Realtime-Deployment und Nginx-Grenze bleiben von der statischen
  Editor-/Exportauslieferung getrennt.

Der konkrete Autoren- und Ausführungsweg ist damit:

```text
state.html / MCP-Aktion
  -> normalizeModel -> validiertes State-Blueprint-v2-Modell
  -> Editor-Persistenz oder MCP-Workspace
  -> Vorschau-Blob oder Standalone-HTML
  -> globaler Runtime-Bus + FSM + Renderer
  -> optional: /events + /token + /ws als reiner Ereignistransport
```

## 20. Zentraler Vertragsstand und offene Entscheidungen

### 20.1 Bereits festgelegter Kern

Die folgenden Leitfragen sind normativ entschieden und stehen nicht erneut zur
Disposition, solange der Vertrag nicht ausdrücklich gemeinsam geändert wird:

- Zustand ist eine ausführbare FSM und kein bloßes Diagramm. Das normalisierte
  Modell ist die strukturelle Wahrheit, der globale JSON-Bus die einzige
  veränderliche Laufzeitwahrheit; DOM, SVG, Host und Server sind Projektion oder
  Transport.
- Eine Transition ist der einzige fachliche State-Wechsel. Trigger, Condition
  und `set` besitzen getrennte Aufgaben. Label und sichtbarer Text sind reine
  Anzeige; neue oder leere Labels heißen `Weiter`, die Route wird separat
  dargestellt.
- Parent und Children sind echte verschachtelte Zustandsmaschinen. Ein- und
  Ausgang laufen ausschließlich über die erklärte Boundary und echte
  Parent-Transitionen; fehlende Ausgänge stoppen den Ablauf.
- Realtime ist kein zweites Modell und keine kollaborative Graphbearbeitung.
  Katalogisierte Ereignisse treten über den Bus ein; Server und Host dürfen die
  fachliche Modell- und Bushoheit nicht übernehmen.
- **DEC-003 ist entschieden:** Zustand bleibt trigger-only. Die App konsumiert
  katalogisierte Realtime-Ereignisse, besitzt aber weder eine Emitter-Wirkung im
  Modell noch eine öffentliche lokale Emit-API. Der authentifizierte
  Servereingang `/emit` ist eine externe Integrationsgrenze.
- **DEC-009 ist entschieden:** Schema v2 ist strikt. Entfernte Aliasse und
  Legacy-Fallbacks werden an Parser-, Import-, API-, MCP-, Persistenz- und
  Exportgrenzen abgelehnt oder entfernt; es gibt keine dauerhaft erlaubte
  Kompatibilitätsliste.
- Mobile verwendet genau die vier exklusiven Arbeitsansichten Canvas, Vorlagen,
  Details und Vorschau. Die Vorschau zeigt App und nicht interaktiven
  Live-Canvas gemeinsam; Gesten müssen ohne verdeckte Bedienflächen oder
  konkurrierende Panels funktionieren.
- Inspector-, Vorschau- und Vorlagenzustand gehören dem Nutzer. Preset-Aktionen
  dürfen diese Zustände und die gewählte mobile Arbeitsansicht nicht eigenmächtig
  öffnen, schließen oder wechseln.
- State, Ports, Pins und Kabel teilen ein Koordinatensystem. Fremde SVG-
  Hitflächen dürfen einen State nicht überdecken; normale Erstinteraktionen
  müssen ohne Force, Retry oder Locator-Fallback treffen.
- Standalone-Export und Root-Demo verwenden dieselbe Runtime wie die Vorschau
  und enthalten weder Editor- noch Ablauf-Diagnoseoberflächen. Sichtbare deutsche
  Systemtexte verwenden native Umlaute und `ß`.
- Es gibt keinen App-Shell- oder Asset-Cache. Frontend, Service Worker und
  Backend teilen genau eine erst nach vollständigem Vertragslauf erhöhte
  `release-N`-Wahrheit; Deployment muss verifizieren und bei Fehlern auf die
  letzte gesunde Freigabe zurückrollen.
- Testbeschleunigung darf nur parallelisieren. Vollständigkeit, echte
  Browserinteraktion und der Verzicht auf Retries oder abgeschwächte Assertions
  bleiben Teil der Freigabe.

### 20.2 Noch offene Entscheidungen

Die folgenden Entscheidungen sind ausdrücklich noch nicht normativ. Bis zu
ihrer gemeinsamen Festlegung dürfen Implementierung oder Tests keine der
Varianten stillschweigend zum Vertrag erklären:

- **DEC-001 Standardaktion bei Enter:** Soll Enter nur bei exakt einer sichtbaren
  Button-Transition feuern, immer der expliziten Render-Reihenfolge folgen oder
  über ein eigenes Modellfeld eine Standardtransition erhalten? Eine
  Labelauswertung ist gemäß TRN-004 und TRN-005 keine zulässige Variante.
- **DEC-002 Mehrere Transitionen für dasselbe Ereignis:** Zur Wahl stehen ein
  striktes Eindeutigkeitsgebot, explizite Prioritäten oder die Regel „alle
  passenden Conditions auswerten, genau ein wahrer Kandidat feuert, mehrere
  wahre Kandidaten stoppen mit Ambiguitätsfehler“. Eine unsichtbare
  Modellreihenfolge ist keine belastbare Fachregel.
- **DEC-004 Realtime-Zustellung:** Der Vertrag muss ehrlich zwischen geordneter
  sitzungsgebundener Live-Zustellung und dauerhafter garantierter Zustellung
  wählen. Dauerhafte Garantie erfordert mindestens ACK, idempotente Sequenzen,
  persistente Outbox und Replay und ist mit einem vollständig zustandslosen
  Transport allein nicht erreichbar.
- **DEC-005 Boundary-Eintritt:** Festzulegen ist, ob der aus der Boundary
  abgeleitete Kind-Eintritt die einzige erlaubte abgeleitete Transition bleibt
  oder als echte Transition im Modell materialisiert wird. In beiden Fällen
  müssen Trigger, Condition, Timer, ID, Reihenfolge und Darstellung denselben
  Resolver verwenden wie normale Transitionen.
- **DEC-006 Kanonischer Soforttrigger:** `auto` oder `immediate` muss als einziger
  Schemawert gewählt werden. Der andere Begriff darf danach weder Alias noch
  Fallback sein.
- **DEC-007 Datenabbildung:** Zu entscheiden ist zwischen ausschließlich
  strukturierten Data Wires und einer ausdrücklich unterstützten, validierten
  Template-Sprache. Beides gleichzeitig widerspricht dem Ziel einer einzigen
  verständlichen Datenbindung.
- **DEC-008 Node-Breite:** Zur Wahl stehen eine feste, rasterkonforme Breite mit
  höchstens zwei Titelzeilen oder eine titelabhängige Breite, die dann auch MCP,
  Routing und Viewport-Berechnung gemeinsam verwenden müssen.
- **DEC-010 Erste No-Cache-Antwort:** Zu entscheiden ist, welche kontrollierte
  Hostinggrenze die `no-store`-Header für HTML, Service Worker, Deploy-Stamp und
  Assets beweisbar setzt und wie dieser Headervertrag getestet wird.
- **DEC-011 Condition-Grammatik:** Die unterstützten Operatoren, Typregeln,
  Klammern, Stringliterale, Fehler und Validierung müssen exakt definiert werden;
  alternativ entfällt freie Condition-Eingabe zugunsten ausschließlich
  strukturierter Regeln.
- **DEC-012 Kanonische Zustandsdaten:** Festzulegen ist die eine persistierte
  Repräsentation: entweder ein state-lokales Objekt, das beim Eintritt unter
  `states.<id>` gemountet wird, oder eine ausschließlich vollqualifizierte
  Pfadmap. Flache Präfixschlüssel und verschachtelte globale Objekte parallel zu
  akzeptieren ist keine Variante. Die state-lokale Form ist für Autoren
  einfacher; Data Wires und Transitionwirkungen können trotzdem ausschließlich
  vollqualifizierte Buspfade verwenden.
- **DEC-013 Komponentenartige Child-States:** Zu entscheiden ist, ob
  `renderMode: "component"` vollständig entfällt und Darstellung ausschließlich
  über normale Komponenten erfolgt, oder ob echte parallele Regionen mit
  eigener Aktivierung, Transitionkandidaten und Datenlebenszyklus modelliert
  werden. Ein passiv gerenderter halber State ist keine zulässige Endlösung.
- **DEC-014 Kanonische ID-Grammatik:** Die exakte Grammatik für formale State-
  und Transition-IDs ist festzulegen. Für ein striktes v2-Schema liegt nahe,
  nicht kanonische Import-IDs abzulehnen und nur interaktive Neuanlage vor der
  Persistenz zu normalisieren. Stille Teilnormalisierung ohne atomisches
  Referenz-Rewrite bleibt in jedem Fall verboten.

### 20.3 Index der zentralen Leitfragen

- **App-Prinzip und Contract-Schutz:** PRN-001 bis PRN-011 sowie SYS-001 bis
  SYS-007; offen bleiben vor allem die getrennten Implementierungen aus GAP-003
  und GAP-013.
- **Transitionname gegen Route:** TRN-004, TRN-005 und TRN-015 sind entschieden:
  Standardname `Weiter`, Route separat, Zustandsumbenennung ohne Labeländerung.
  Die verbleibenden englischen Defaults stehen in GAP-014 und GAP-039.
- **Mehrere Ausgänge auf dasselbe Ereignis:** GAP-017 und DEC-002. Die aktuelle
  unsichtbare Modellreihenfolge ist ausdrücklich kein Vertrag.
- **Realtime-Trigger oder Emitter:** DEC-003 und RT-024 sind trigger-only
  entschieden. Zustellklasse und eine mögliche spätere Erweiterung stehen
  getrennt in DEC-004; der heutige Codeverstoß steht in GAP-018 und GAP-026.
- **Parent-/Child-Laufzeit:** NEST-001 bis NEST-016; offene Resolver- und
  Boundary-Fragen stehen in GAP-013, GAP-015, GAP-017, GAP-034 und DEC-005.
- **Never-cache und gemeinsame Release-ID:** DEMO-011 sowie RT-019 bis RT-023
  sind fest. Offen sind der beweisbare Header der ersten Antwort in DEC-010 und
  GAP-027 sowie der echte Worker-Lebenszyklustest in GAP-037.
- **Keine Legacy-Fallbacks:** DEC-009 und MOD-005 sind strikt entschieden; die
  noch vorhandenen Codepfade listet GAP-025.
- **Mobile Bedienbarkeit, Treffer und Panelhoheit:** ED-011 bis ED-015,
  CAN-012 bis CAN-014 und PRE-016 sind fest; dauerhafte WebKit-Absicherung und
  gemeinsame Node-Geometrie bleiben GAP-023, GAP-024 und DEC-008.
- **Vollständige, schnellere Tests:** TST-001 bis TST-009 erlauben nur
  Parallelisierung. Force-/Retry-Helfer bleiben GAP-019.
- **Neu aus diesem Vollaudit:** Kanonische Zustandsdaten, komponentenartige
  Child-States und formale ID-Grammatik stehen in DEC-012 bis DEC-014; die
  reproduzierten Ist-Verstöße in GAP-031, GAP-033 und GAP-038.

## 21. Nicht normative Richtung

Diese Punkte beschreiben mögliche Weiterentwicklung und sind kein bestehender
Abnahmevertrag:

- stärkere Typ-, Wertebereichs- und Schema-Prüfung des globalen Datenbaums,
- einfachere Auswahl von Datenkonstellationen für Change-Übergänge,
- ein Preset-Designer für vollständig vertragskonforme DaisyUI-Bausteine,
- vollständige, nachvollziehbare und testbare API-Steuerung jeder Editoraktion,
- eine gemeinsam importierte Modell-/Runtime-Quelle statt String-Patching,
- ausschließlich explizite Trigger, Datenbindungen und Transitionwirkungen,
- ein Resolver, der Mehrdeutigkeit sichtbar und fehlgeschlossen behandelt,
- eine benannte und technisch nachweisbare Realtime-Zustellklasse.
