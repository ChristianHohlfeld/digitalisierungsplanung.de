# Zustand-Vertrag

Status: normativ

Schema: State Blueprint Version 2

Stand: 2026-07-14

Auditbasis: Repository-Commit `d061538`, gemeinsame Freigabe zu Auditabschluss
`release-96`

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
  Runtime-Events und Server sind ausschließlich Projektion oder Transport.
- **PRN-004 Autorenfluss:** Jede fachliche Modelloperation MUSS das Modell
  ändern, normalisieren, in der Historie erfassen und persistieren; relevante
  Auswahl- und Ebenendaten gehören zur Editorsitzung. Danach sendet der Host
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
  -> Runtime-Eventhandler -> Canvas- und Inspektorprojektion
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
- **SYS-003 Projektionen:** DOM, SVG, Vorschau, Inspektor, Runtime-Events,
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
  Cache-Objekten, Host-Ablagen oder parallelen Stores leben.
- **SYS-006 Editor-Sitzung:** Auswahl, Hover, Fokus, geöffnete Ebene,
  Zwischenablage, Undo/Redo, Panelgrößen und mobile Ansicht sind
  Editor-Sitzungszustand. Sie DÜRFEN die fachliche Bedeutung des Modells nicht
  verändern.
- **SYS-007 Host-Runtime-Vertrauensgrenze:** Jede `postMessage`-Nachricht MUSS
  an die konkrete Vorschauinstanz gebunden sein. Der Host darf Runtime-
  Nachrichten nur von `frameEl.contentWindow` annehmen; die Vorschau darf
  Hostbefehle nur von ihrem tatsächlichen Parent-Window annehmen. Eine fremde
  Child-, Sibling- oder Opener-Quelle DARF weder Modell, Runtime-Zustand,
  Realtime, Shortcuts noch externe
  Navigation beeinflussen. Window, exakte Origin und eine pro Frame erzeugte
  Sitzungskennung MÜSSEN für jede Nachricht übereinstimmen.

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
- **STA-003 Kanonische Pfade:** Unqualifizierte Zustandsvariablen,
  Transition-Bedingungen und Transition-`set`-Pfade MÜSSEN abgelehnt werden.
  Runtime-Referenzen auf fachliche Daten verwenden ausschließlich
  `states.<stateId>.<feld>` und werden weder präfixiert noch migriert.
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
  geänderten Defaults überschreiben. Neue oder geänderte Defaults gelangen
  ausschließlich beim nächsten Eintritt des betroffenen Zustands in den Bus.
  Nur ein ausdrücklicher Reset darf Laufzeitwerte zurücksetzen.
- **STA-009 Abonnements:** `subscriptions` beschreiben gelesene Buspfade. Das
  Hinzufügen einer Darstellung oder eines Data Wires DARF Abonnements nicht
  als versteckten Schreibkanal missbrauchen.
- **STA-010 Runtime-Steuerung:** Globale Runtime-Steuerung lebt im Bus, zum
  Beispiel `runtime.paused`; es DARF keine zweite lokale Variable wie
  `runtimePaused` geben.
- **STA-011 Runtime-Events:** Der Host verarbeitet Runtime-Nachrichten als
  Events. Ihr `detail` darf nur im Eventhandler für die UI-Projektion verwendet
  werden. Der Host DARF weder einen Context noch einzelne Buswerte in
  parallelen Variablen, Stores, Closures oder Caches halten.
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
  `realtime` und `auto`.
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
  automatisch in sein Entry-Child weiterführen. Jeder bestätigte, bewegungsfreie
  State-Klick im Canvas startet den gewählten State erneut, auch nach Reload oder
  bei bereits bestehender Auswahl. Löst ein Auto-Parent dabei den Child-Eintritt
  aus, folgen Canvas-Ebene, Auswahl und Inspector atomar dem aktiven Child.
- **NEST-005 Wiedereintritt:** Wird ein Parent erneut betreten, MUSS sein
  Boundary-Eintritt wieder am konfigurierten Entry-Child beginnen; ein zuvor
  aktives tieferes Child darf nicht stillschweigend fortgesetzt werden.
- **NEST-006 Interner Ablauf:** Child-zu-Child-Verbindungen sind echte
  Transitionen innerhalb derselben Ebene. Wires DÜRFEN nicht unbemerkt über
  Ebenengrenzen springen.
- **NEST-007 Ausgang:** `boundary.exitId` bezeichnet das Child, an dem echte
  Parent-Ausgänge projiziert werden dürfen.
- **NEST-008 Ausgangsprojektion:** In der Runtime MÜSSEN am Exit-Child zuerst
  dessen eigene ausgehende Aktionen und danach die echt verdrahteten
  Parent-Ausgänge erscheinen. Der Editor-Canvas zeigt davon unabhängig pro
  Parent-Layer genau eine kanonische Input- und Output-Boundary-Route; externe
  Parent-Kanten DÜRFEN dort nicht als vervielfachte Kabel erscheinen.
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
- **PRE-014 Server-Contract:** Presets kommen ausschließlich aus dem Product
  Contract des Servers. Der Editor DARF keine lokalen Preset-Definitionen,
  Katalogkopien oder exportierbaren Preset-Artefakte speichern.
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
- **PRE-017 Zugeordnete Widgets:** Jedes einem Zustand zugeordnete Widget MUSS im
  Bausteinbereich als sichtbarer Eintrag erscheinen. Seine Bearbeiten-Aktion
  öffnet den bestehenden Komponenten-Editor; sie DARF keine zweite
  Bearbeitungsform erzeugen. Drag-Reihenfolge im Bausteinbereich, generische
  Renderliste, Modell, Preview und Export MÜSSEN dasselbe `components`-Array
  verwenden und unmittelbar dieselbe Reihenfolge zeigen.

## 11. Editor-Vertrag

- **ED-000 Contract-Boot:** Der Editor MUSS `/contract` mit `no-store` laden,
  bevor er Typen, Trigger, Presets oder Contract-Felder normalisiert. Ist der
  Product Contract nicht erreichbar, DARF der Editor keine eigenen Defaults
  erfinden und MUSS die contractrelevante Arbeit verweigern.
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
  starten. Ein Desktop-Drag auf dem Linienkörper MUSS stattdessen den Canvas
  pannen; ein danach ausgeführter eigener Click MUSS die Transition unmittelbar
  auswählen können.
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
  Canvas-Fokussierung DARF ihn nicht übernehmen. Sobald der Nutzer den
  Inspector per Pointer oder Fokus bedient, MUSS ein noch geplanter
  Canvas-Runtime-Start abgebrochen werden; Eingabefelder dürfen dadurch weder
  ersetzt noch geschlossen werden.
- **ED-011 Lokale UI:** Panelbreiten, Explorerzustand, Preview-Collapse und mobile
  Arbeitsansicht dürfen lokal persistieren, ohne das Modell zu verändern.
- **ED-012 Responsive Bedienung:** Desktop, Tablet und Mobile MÜSSEN Canvas,
  Vorlagen, Details und Vorschau erreichbar halten. In der mobilen
  Arbeitsansicht MÜSSEN diese vier Aufgaben über vier gleich breite,
  mindestens 44 Pixel hohe Navigationsziele erreichbar sein. Der Canvas MUSS in
  jedem mobilen Modus sichtbar bleiben und DARF von keinem Panel vollständig
  oder teilweise überdeckt werden. Nur der Canvas-Modus verwendet die gesamte
  Arbeitsfläche. Vorlagen, Details und Vorschau teilen sie mit demselben echten
  Canvas-Renderer: in Portrait übereinander, in Querformat nebeneinander. Die
  Vorschau verwendet den Canvas als nicht interaktiven Live-Monitor; Vorlagen
  und Details behalten den normalen Editor-Canvas als Kontext. Jeder Teil MUSS
  eine feste, bedienbare Mindestgröße besitzen. Ein gemeinsamer mobiler
  Split-Griff DARF das Verhältnis verändern, MUSS aber Canvas und Panel auf
  ihren vertraglichen Mindestgrößen begrenzen; freie oder panelspezifische
  Resizer und unsichtbare Restflächen sind verboten. Der gemeinsame Canvas MUSS die an einer
  Runtime-Transition beteiligten States und die bestehende State-/Kantenanimation
  sichtbar halten, DARF keinen zweiten Renderer oder Modellstand erzeugen und
  DARF die vom Nutzer gespeicherte Canvas-Kamera nicht überschreiben. Beim
  Wechsel zurück in den Canvas-Modus MUSS die vorherige Kamera exakt
  wiederhergestellt werden. Controls und Beschriftungen
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
- **ED-019 Touch-Auswahl:** Ein Touch-Tap auf einen State MUSS ihn auswählen,
  DARF den Inspectorzustand aber NICHT verändern. Sichtbares Bearbeiten wird auf
  Touch ausdrücklich über die Bearbeiten-Aktion geöffnet; ein zweiter gültiger
  Tap öffnet stattdessen die innere Ebene. Damit bleibt die Canvas-Geometrie
  während der Double-Tap-Erkennung unverändert.
- **ED-020 Gestenhoheit:** Runtime-Nachrichten DÜRFEN laufende oder erkannte
  Editor-Pointergesten NICHT zurücksetzen. Ein State-Double-Tap ist an State-ID
  und aktuelle Ebene gebunden und wird zwischen den Pointer-Down-Zeitpunkten
  gemessen. Beide echten Browser-Taps MÜSSEN den State ohne erzwungenes Event,
  Retry oder Locator-Fallback treffen.
- **ED-021 Übergangszuordnung:** Wird im State-Inspector ein ausgehender
  Übergang, dessen Auslöser oder dessen konkretes Ereignis gewählt, MUSS genau
  die zugeordnete sichtbare Canvas-Transition kurz pulsieren. Diese rein visuelle
  Rückmeldung DARF weder die Transition auslösen noch Modell, Runtime-Zustand
  oder Canvas-Auswahl verändern.
- **ED-022 Einzel- und Doppelclick:** Der erste bewegungsfreie State-Click MUSS
  sofort auswählen. Erst nach Ablauf des Doppelclick-Zeitfensters darf er als
  bestätigter Einzelclick die Runtime starten. Ein gültiger Doppelclick MUSS den
  ausstehenden Runtime-Start verwerfen und ausschließlich die innere State-Ebene
  öffnen. Jede vorher beginnende weitere Canvas- oder Inspector-Interaktion
  MUSS den ausstehenden Runtime-Start ebenfalls verwerfen.
- **ED-023 Deterministischer Desktop-Abschluss:** State-, Canvas- und
  Transition-Gesten MÜSSEN beim zugehörigen `pointerup` genau einmal
  abgeschlossen werden. Ein nachfolgendes `mouseup` DARF dieselbe Geste weder
  erneut anwenden noch ihre Auswahl verlieren. Sichtbares Transition-Label,
  Pfad und Hitfläche MÜSSEN denselben Gestenpfad verwenden; ihre Einzel- und
  Shift-Auswahl DARF nicht von einem nativen Browser-`click` abhängen.

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
  unzulässig. Eine rein visuelle, pointerlose Portprojektion DARF über der
  Node-Ebene liegen; sie DARF `elementFromPoint()` und die Ereignisquelle nicht
  verändern.
- **CAN-013 Port-Erreichbarkeit:** Die vorgesehene sichtbare Port-/Pin-Zone am
  Rand des eigenen Nodes MUSS weiterhin für Connect und Reroute erreichbar
  bleiben. Das sichtbare Portsymbol MUSS über der Fläche seines eigenen Nodes
  gezeichnet werden. Beginnt ein Pointer auf der innerhalb des Owner-Nodes
  liegenden Hälfte dieses Symbols, MUSS der Owner den Start als Portinteraktion
  und nicht als Node-Drag behandeln. Die freie Maus-Zielfläche eines
  State-Ausgangs MUSS unabhängig vom Canvas-Zoom mindestens 32 CSS-Pixel nach
  außen und 44 CSS-Pixel in der Höhe greifbar sein. Dort MUSS erst eine vom Port
  weg gerichtete Mausbewegung von
  mehr als 7 CSS-Pixeln die Verbindung starten. Drücken, Klicken und eine zum
  Port gerichtete Drag-Bewegung DÜRFEN keine Verbindung starten. Ein Drag
  deutlich innerhalb des Node-Körpers MUSS den Node bewegen und DARF keine
  Verbindung starten. Die vergrößerte Zielfläche DARF die Fremd-State-Priorität
  aus CAN-012 NICHT umgehen.
- **CAN-014 Layout-Stabilität:** Titel, Statusbadges, Open-Aktion, Ports und
  Layer-Rahmen DÜRFEN nicht inkonsistent überlappen. Normale States sind in
  Editor und MCP exakt 168 Pixel breit; lange Titel werden innerhalb dieser
  Breite kontrolliert auf zwei Zeilen begrenzt.

## 13. Speichern, Import und Export

- **EXP-001 Formale Definition:** Eine gespeicherte Definition MUSS
  `kind: "state-blueprint-definition"`, `schemaVersion: 2` und das normalisierte
  Modell enthalten.
- **EXP-002 Zulässige Metadaten:** Eine formale Definition DARF Kamera
  enthalten. Sie DARF keine Preset-Definitionen, Undo-Historie, Zwischenablage,
  Runtime-Werte oder flüchtige Panelzustände enthalten.
- **EXP-003 Roundtrip:** Speichern und erneutes Laden MUSS dasselbe normalisierte
  Modell, dieselben Render-Referenzen, Daten, Typen und Transitionen
  wiederherstellen.
- **EXP-004 Teilimport/-export:** Einzelne Zustandskomponenten und volle
  Definitionen MÜSSEN ohne Verlust von Data Wires und Render-Reihenfolge
  importier- und exportierbar sein. Presets sind contract-managed und DÜRFEN
  nicht als lokale Komponenten importiert oder exportiert werden.
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
- **RT-006 Host-Grenze:** Der Host verarbeitet Runtime-Meldungen als Events und
  DARF deren Businhalt nicht speichern. Ein empfangenes
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
- **RT-015 Öffentliche Routen:** Nginx darf nur `/console.html`,
  `/events-admin.html`, `/events-admin/catalog`, `/healthz`, `/version`,
  `/token`, `/contract`, `/events`, `/events/contract`, `/emit` und `/ws` an den lokalen Prozess auf
  `127.0.0.1:8788` weiterleiten. Nicht definierte Kernrouten wie `/`,
  `/catalog`, `/schema`, `/api` und `/process/*` liefern 404.
- **RT-016 Transportierte Definition:** Der Server MUSS einem akzeptierten
  `runtime.event` die zu diesem Namen gehörende normalisierte Katalogdefinition
  beilegen. Der Empfänger verwendet diese Definition für Bindings und DARF den
  fachlichen Bus-Eintritt nicht wegen eines zusätzlichen fehlgeschlagenen
  `/events`-Abrufs verwerfen.
- **RT-017 Live-Reihenfolge:** Die generierte Runtime besitzt ihre WebSocket-
  Verbindung selbst und verarbeitet akzeptierte Frames in Empfangsreihenfolge.
  Der Host leitet keine Realtime-Frames weiter. Bei Verbindungsabbruch wird neu
  verbunden; Ereignisse während der Trennung werden nicht gepuffert oder
  nachgespielt.
- **RT-018 Keine Browser-Outbox:** Im trigger-only-Produktumfang erzeugt der
  Browser keine ausgehenden fachlichen Realtime-Ereignisse und hält deshalb
  keine Outbox oder Verbindungswarteschlange dafür. Ein künftiger
  Emitter müsste seine Outbox-, ACK-, Kapazitäts- und Replay-Regeln als neue
  Vertragsfunktion definieren.
- **RT-019 Gemeinsame Release-Wahrheit:** `release-version.js` ist die einzige
  Release-Wahrheit für statisches Frontend und Backend. Eine
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
- **RT-022 Verifikation und Retry-only Deploy:** Eine Release gilt erst nach erfolgreichem
  PM2-Start mit aktualisierter Umgebung, `nginx -t` und einem Healthcheck mit
  exakt passender Release-ID als deployt. Vorher DARF der Erfolgsmarker nicht
  fortgeschrieben werden. Schlägt das Update nach Retries fehl, bleibt der
  letzte Erfolgsmarker unverändert; ein späterer Timerlauf versucht denselben
  freigegebenen Release-Stand erneut. Es gibt kein Rollback.
- **RT-023 Versions-API:** Für jede neue `release-N`-Freigabe MÜSSEN `/version`
  und `/healthz` mit `no-store` exakt die vom Backend verwendete
  `releaseId`, Release-Sequenz,
  Erstellungszeit sowie Quell- und Deploy-Commit ausgeben.
- **RT-024 Trigger-only:** Zustand konsumiert Realtime vorerst ausschließlich
  als katalogisierten externen Trigger. Weder Modell noch Host dürfen eine
  eigenständige Emitter-Wirkung oder eine öffentliche lokale `emit`-API
  bereitstellen. `/emit` bleibt ein authentifizierter externer Servereingang
  für Integrationen und Testkonsole. Ein fachlicher App-Emitter wäre eine neue
  Vertragsfunktion und dürfte erst gemeinsam mit Payloadschema, Reihenfolge,
  Autorisierung, ACK und Fehlersemantik eingeführt werden.

## 16. Öffentliche Demo und Produkt-Abnahme

- **DEMO-001 Modell:** Die eingebaute Website-Demo heißt
  `Digitalisierungsplanung`,
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
  gemeinsame Navbar mit `Digitalisierungsplanung`, `Start`, `Nutzen`,
  `Angebot`, `Kontakt` und `Konto` sowie einen Footer mit
  `Digitalisierungsplanung.de` und fünf gebundenen Aktionen.
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
  `Digitalisierungsplanung.de` ausliefern.
- **DEMO-011 Kein Cache:** Editor, Root-Demo, Exporte und statische Assets
  DÜRFEN weder einen App-Shell-/Asset-Cache anlegen noch Stale-while-revalidate
  verwenden. Die App DARF keinen Service Worker registrieren. Ein ausschließlich
  zur Deinstallation alter Worker ausgelieferter Tombstone DARF nur vorhandene
  Registrierungen und Cache-Storage-Bestände löschen und DARF keinen
  Fetch-Handler besitzen. Jede kontrollierte Hostingantwort MUSS
  `Cache-Control: no-store` liefern.
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
  Spezifikation 357 expandierte Playwright-Fälle in sechs Spec-Dateien und 27
  Node-Server-Tests, insgesamt 384 Fälle.
- **TST-002 Smoke:** 260 Playwright-Fälle tragen `@smoke`. `npm test` prüft
  zuerst die 27 Server-Tests und danach diese 260 Smoke-Fälle.
- **TST-003 Vollständiger Lauf:** `npm run test:full` prüft zuerst alle 27
  Server-Tests und danach alle 357 Playwright-Fälle. Der vollständige lokale
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
  vollständigen Bestand von 27 Server- und 357 Playwright-Fällen ausführen.
  Gitea verwendet `npm run test:full`. GitHub Actions DARF die Playwright-Fälle
  in disjunkte Shards aufteilen, wenn deren Vereinigung exakt alle 357 Fälle
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
- **TST-009 Never-Cache-Verhalten:** Der No-Cache-Vertrag MUSS zusätzlich zu
  Quelltextalarmen in einem echten Browser beweisen, dass keine Registrierung
  verbleibt, Cache Storage leer ist und weder Registrierungs- noch Fetch-
  Interceptor-Code ausgeliefert wird. Der Origin-Header der ersten Antwort ist
  getrennt an der kontrollierten Hostinggrenze nachzuweisen.
- **TST-010 Einzeltestbudget:** Jeder Browserfall MUSS mit dem globalen
  30-Sekunden-Limit auskommen. Vollständigkeitsmatrizen MÜSSEN deterministisch
  in disjunkte, parallel ausführbare Fälle geteilt werden. Längere
  Sondertimeouts, Retries, Force-Klicks und abgeschwächte Assertions sind
  verboten.
- **TST-011 Lean- und Runtime-Drift:** Der Editor-Host DARF keine benannte
  Funktion enthalten, die im Produktquelltext ausschließlich deklariert wird.
  Die eingebettete Runtime ist bei diesem Host-Audit getrennt zu betrachten.
  Preview, Editor-Export und MCP-Export MÜSSEN dieselbe aktuelle kanonische
  Runtime verwenden. Der Nachweis berechnet Bytezahl und SHA-256 im jeweiligen
  Testlauf aus `APP_HTML`; ein fester Release-Hash ist verboten, weil er
  vertragskonforme gemeinsame Runtime-Änderungen künstlich blockieren würde.

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

- **GAP-001 SVG-Hit-Priorität, geschlossen am 2026-07-12:** Das interaktive
  Port-SVG liegt gemeinsam mit den Wires unterhalb der Node-Ebene; seine Port-,
  Pin- und Tip-Hitflächen bleiben außerhalb von Nodes interaktiv. Eine zweite,
  pointerlose SVG-Projektion zeichnet ausschließlich die sichtbaren Ports über
  dem eigenen Node. Der Owner erkennt die innere Hälfte seines
  Ausgangsports selbst als Connect-Kandidaten, ohne die Trefferreihenfolge für
  fremde States zu ändern. Ein eigener Browser-Regressionsfall beweist die
  Ebenenfolge interaktiver Port `1`, Nodes `2`, pointerlose Portprojektion `3`,
  identische Portkoordinaten während Live-Drag, zwei reine Klicks ohne
  Seiteneffekt sowie den ersten Mouse- und Touch-Connect vom inneren Halbkreis.
  Ein weiterer Browser-Regressionsfall legt `.svg-port` und `.edge-pin` eines
  Owners geometrisch
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
- **GAP-003 Geteilte Kernlogik, offen am 2026-07-14:** Teile der
  Modellnormalisierung existieren weiterhin getrennt im Host und im MCP-Core.
  Die Runtime-Erzeugung gehört nicht mehr zu diesem Gap: `APP_HTML` ist die
  einzige Runtime-Quelle für Preview, Standalone-Export und MCP-Export; sie wird
  weder gepatcht noch nachträglich erweitert. Für die verbleibende
  Modellnormalisierung gibt es noch kein gemeinsam importiertes Kernmodul.
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
- **GAP-005 Mobile Bedienbarkeit, geschlossen am 2026-07-11 und nachgeschärft am
  2026-07-13:** Der visuelle
  Ist-Audit mit 360×800, 390×844, 430×932 und 844×390 Pixeln belegte fünf
  Vertragsverletzungen: unlesbar klein eingepasste Zustände, eine nur 80 Pixel
  hohe und damit unbedienbare Vorschau, tote Restflächen in Details und
  Vorschau, abgeschnittene sechs-spaltige Navigation sowie ein unbrauchbarer
  Querformat-Split. Der Mobile-Vertrag verwendet deshalb in Portrait,
  Querformat und auf mittleren Touch-Geräten genau vier Aufgaben:
  `canvas`, `presets`, `edit` und `app`. Die Navigation zeigt nur Canvas,
  Vorlagen, Details und Vorschau. Undo/Redo liegen ausschließlich als
  44-Pixel-Aktionen oben rechts auf dem Canvas. Primäraktionen in Topbar und
  Vorlagenkarten verwenden auf Mobile kompakte Symbole mit weiterhin mindestens
  44 Pixel großen Touchzielen. Der gemeinsame Split-Griff verändert die
  Canvasfläche in Portrait vertikal und in Querformat horizontal; seine Grenzen
  halten beide Arbeitsbereiche bedienbar.
  Beim Öffnen oder Laden fokussiert der Canvas den fachlichen Startzustand mit
  mindestens 0,82 Skalierung; der explizite Befehl `Einpassen` bleibt der
  vollständige Modellüberblick. Eine spätere Vollflächenregel für Vorlagen und
  Details erwies sich als unbrauchbar, weil sie den Canvas vollständig verdeckte;
  sie ist ersatzlos entfernt. Canvas bleibt jetzt in allen vier Aufgaben sichtbar.
  Vorlagen, Details und Vorschau liegen in Portrait unter und in Querformat neben
  demselben Renderer, ohne Überdeckung oder zweiten Modellstand. Nur die Vorschau
  schaltet ihn als Live-Monitor nicht interaktiv. Die Panelkamera ist temporär;
  die Nutzerkamera wird beim Rückwechsel exakt wiederhergestellt. Browsertests
  prüfen Sichtbarkeit, Mindestgröße, lückenlose Teilung und fehlende Überdeckung
  für alle vier Aufgaben in Portrait und Querformat.
- **GAP-006 Geteilte CI-Abnahme, geschlossen am 2026-07-10:**
  `npm run test:full` umfasst Server und Browser und bleibt die lokale sowie die
  Gitea-Abnahme. GitHub Actions prüft denselben Bestand schneller in vier
  disjunkten Playwright-Shards und einem einmaligen Serverlauf. Der Deploy-Job
  hängt vom Erfolg der gesamten Matrix ab; die Freigabe umfasst deshalb weiter
  alle 346 Vertragsfälle.
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
  Produktvertrag gibt es keinen App-Shell- oder Asset-Cache mehr. Die App
  registriert keinen Worker. `disable-sw.js` und der nicht interceptierende
  `sw.js`-Tombstone entfernen ausschließlich Altregistrierungen und alte
  Cache-Storage-Bestände. Die Hostinggrenze liefert jede Appantwort mit
  `no-store`.
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
- **GAP-013 Geteilte Runtime-Erzeugung, geschlossen am 2026-07-14:** `APP_HTML`
  ist die einzige kanonische Runtime-Quelle. `GENERATED_APP_HTML` referenziert
  sie unverändert; Preview, Standalone-Export und MCP-Export lesen exakt diese
  Quelle. Runtime-Enhancer, String- und Bereichsersetzungen sowie die dafür
  benötigte VM-Auswertung wurden entfernt. Ein Smoke-Vertrag verbietet ihre
  Wiedereinführung.
- **GAP-014 Label als Ablaufsemantik, geschlossen am 2026-07-12:** Leere Labels
  werden zu `Weiter`. Explizite Labels bleiben opak. Die Runtime klassifiziert
  keine Namen als positiv oder negativ; Enter verwendet die erste bereits
  explizit geordnete Button-Transition.
- **GAP-015 Verdeckte Fetch- und Eingabeinferenz, geschlossen am 2026-07-12:**
  Fetch- und Change-Transitionen reagieren ausschließlich auf ihren expliziten
  `triggerType` und `triggerEvent`. Eine Condition ist nur Guard nach dem
  passenden Ereignis. Die generierte Runtime erzeugt weder Trigger noch
  Eingabefelder aus Condition-Text; Eingaben existieren nur als explizite,
  busgebundene Komponenten.
- **GAP-016 Realtime-Bindings, geschlossen am 2026-07-12:** Standardereignisse
  besitzen keine Bindings. Optionale Katalogbindings dürfen ausschließlich auf
  deklarierte `states.<id>.<feld>`-Pfade schreiben; der Payload bleibt unter
  `events.<name>.detail` lesbar.
- **GAP-017 Mehrdeutige Ereignisauflösung, geschlossen am 2026-07-12:** Genau
  ein wahrer Kandidat darf feuern. Null wahre Kandidaten stoppen; mehrere wahre
  Kandidaten erzeugen `ambiguous-transition` ohne State-Wechsel.
- **GAP-018 Realtime-Zustellgarantie, geschlossen am 2026-07-12:** Der aktuelle
  Browser ist trigger-only und besitzt keine ausgehende Queue oder Outbox. Der
  zustandslose Server garantiert geordnete Live-Übertragung innerhalb der
  aktiven WebSocket-Sitzung, aber kein Offline-Replay.
- **GAP-019 Erzwungene und wiederholte Testinteraktionen, geschlossen am
  2026-07-12:** Gemeinsame Inspector- und Ebenenhelfer verwenden normale
  Playwright-Interaktionen ohne `force`, Retry oder Fallback. Der
  Fremd-Hitbox-Fall und die Demo-Traversierung müssen beim ersten Versuch
  treffen.
- **GAP-020 Triggerdialekt, geschlossen am 2026-07-12:** `auto` ist in Vertrag,
  Editor, API, MCP und Runtime der einzige Name für eine unmittelbare
  Fortsetzung. `immediate` ist kein Alias.
- **GAP-021 Template-Tokens gegen strukturierte Data Wires, offen am
  2026-07-12:** REN-010 verbietet eine sichtbare Datenabbildung über
  `{{...}}`-Tokens. Die Runtime implementiert mit `renderLiteralText` und
  `exactTemplatePath` weiterhin genau diese Syntax; zahlreiche Tests und
  Testmodelle verwenden sie für Text, Links, Fetch und Repeat. Der aktuelle
  Bestand behauptet deshalb gleichzeitig, Tokens seien verboten und
  ausführbarer Vertragsbestand.
- **GAP-022 Pause als Schattenzustand, geschlossen am 2026-07-12:**
  `runtime.paused` lebt ausschließlich im Runtime-Bus. Host und MCP besitzen
  weder `runtimePaused` noch `preview.pause`. Der Host sendet einen
  `STATE_BLUEPRINT_RUNTIME_CONTROL`-Befehl und rendert den Pausenstand erst aus
  dem folgenden Runtime-Event.
- **GAP-023 Safari nur manuell nachgewiesen, offen am 2026-07-12:**
  DEMO-012 besitzt einen automatisierten Reload-Test, der reguläre
  Vertragsbestand installiert und startet jedoch nur Chromium. Der in GAP-011
  genannte WebKit-Lauf war eine manuelle Abnahme und ist keine dauerhafte
  CI-Regression. Der ursprüngliche Safari-Fehler kann deshalb browserbezogen
  zurückkehren, ohne die Freigabematrix zu brechen.
- **GAP-024 Uneinheitliche Node-Geometrie, geschlossen am 2026-07-12:** Editor
  und MCP verwenden für normale States dieselbe feste Breite von 168 Pixeln.
  Titel ändern weder State-, Port- noch Routinggeometrie.
- **GAP-025 Kompatibilitätsoberflächen, geschlossen am 2026-07-12:** Entfernte
  Discriminator-, Release- und Parser-Aliase sind gelöscht. Formale Grenzen
  lehnen Legacy-Eingaben ab und migrieren sie nicht.
- **GAP-026 Halbe Realtime-Produktoberflächen, geschlossen am 2026-07-12:**
  Presence, Browser-Emitter, lokale Outbox und Peer-Lifecycle-Produktoberflächen
  sind entfernt. Realtime bleibt trigger-only.
- **GAP-027 Kontrollierte Erstantwort, operativ offen am 2026-07-12:** Die
  Repository- und Servergrenze besitzt eine getestete Nginx-Allowlist mit
  `Cache-Control: no-store, max-age=0`, deaktiviertem ETag und deaktiviertem
  `if_modified_since`. Die App registriert keinen Worker und besitzt keinen
  Cache-Fallback. Extern bleibt die Regel bis zur DNS-/TLS-Umschaltung offen,
  weil GitHub Pages am 2026-07-12 noch `Cache-Control: max-age=600` lieferte.
- **GAP-028 Condition-Sprache ohne exakte Grammatik, offen am 2026-07-12:** Die
  Runtime unterstützt faktisch eine kleine Sprache aus `!`, Vergleichen, `&&`
  und `||`, zerlegt diese Operatoren jedoch per String-Split und validiert die
  Syntax beim Speichern nicht. Klammern, Escaping, Operatoren in Stringwerten,
  Typumwandlung und Fehlerdarstellung sind nicht normativ festgelegt. Ein
  Schreibfehler kann deshalb lediglich als nicht erfüllte Condition erscheinen.
- **GAP-029 Standalone-Host-Erkennung, geschlossen am 2026-07-12:** Nur eine
  vollständig authentifizierte Window-/Origin-/Session-Zuordnung aktiviert die
  Editorbrücke. Ein Standalone-Export rendert auch in einem Iframe oder Fenster
  mit Opener selbstständig und konsumiert Realtime direkt.
- **GAP-030 Leeres Modell, geschlossen am 2026-07-12:** Ein formal leeres Modell
  bleibt in Preview und Export leer. Die Runtime erfindet keinen `start`-State.
- **GAP-031 Kanonische Zustandsdaten, geschlossen am 2026-07-12:** `state.data`
  enthält ausschließlich zustandszugeordnete Default-Deklarationen mit relativen
  Feldnamen. Die Runtime montiert sie
  beim Eintritt unter `states.<id>` in genau einen globalen Bus, erhält dessen
  Objektidentität bei Update und Reset und entfernt beim Löschen den gesamten
  State-Zweig. Dotted Keys und relative Runtime-Referenzen werden abgelehnt.
- **GAP-032 MCP-Normalisierungsparität, geschlossen am 2026-07-12:** Editor,
  Runtime und MCP verwenden dieselben zustandszugeordneten Defaults, vollqualifizierten
  Fetch-Ziele, Boundary-Felder und Modellstandards. Import, Ersetzen und einzelne
  Aktionen werden durch dieselben Paritätsfälle geschützt.
- **GAP-033 Kanonische IDs, geschlossen am 2026-07-12:** Formale Grenzen lehnen
  nicht kanonische IDs, Kollisionen und reservierte Runtime-/Boundary-Namensräume
  ab. Es gibt keine stille Teilnormalisierung und kein partielles Referenz-Rewrite.
- **GAP-034 Formale Boundary-Definitionen unterscheiden sich zwischen Editor
  und MCP, offen am 2026-07-12:** `modelDefinitionSnapshot()` entfernt jede
  `boundaryFlow`-Transition. `mcp.definitionPayload()` exportiert dieselben
  technischen `boundary-flow:*`-/`proxy:*`-Kanten dagegen als Teil des formalen
  Modells. Der MCP-Roundtrip-Test prüft ihren Workspace-Bestand, vergleicht aber
  die formale Transitionmenge nicht mit dem Editor. ID-004, EXP-001, API-009 und
  die noch offene Materialisierungsentscheidung DEC-005 sind damit nicht
  konsistent umgesetzt.
- **GAP-035 Standalone-Veröffentlichungsprofil, geschlossen am 2026-07-12:**
  Generische Exporte bleiben selbstenthalten und registrieren keinen Worker.
  Plattformmetadaten und Root-Assets gehören ausschließlich zum separaten
  Root-Demo-Build.
- **GAP-036 Host-/Runtime-Nachrichtenquelle, geschlossen am 2026-07-12:** Host
  und Runtime prüfen Window, Origin und eine pro Frame neue Session-ID. Fremde,
  alte und neu eingeschleuste Frames bleiben für Modell, aktiven State,
  Realtime, Shortcuts und Navigation wirkungslos. Browserregressionen senden
  diese Nachrichten absichtlich von einem Fremd-Frame.
- **GAP-037 Never-Cache-Browservertrag, geschlossen am 2026-07-12:** Der
  Browsertest legt einen Cache-Storage-Bestand an und beweist nach Appstart null
  Registrierungen und leeren Cache Storage. Source- und Hostingtests beweisen
  zusätzlich: keine Registrierung, kein Fetch-Handler und `no-store` an der
  kontrollierten Nginx-Grenze. Die externe Erstantwort bleibt GAP-027.
- **GAP-038 Passive Child-States, geschlossen am 2026-07-13:**
  `renderMode` ist kein Modellfeld und wird an allen formalen Grenzen abgelehnt.
  Die Runtime rendert ausschließlich den aktiven State; Parent und Child werden
  niemals gemeinsam oder passiv gerendert. Verschachtelte States und Layer
  bleiben echte FSM-Schritte mit `parentId`, Boundary und eigenen Transitionen.
  Sichtbarer Inhalt gehört in das `components`-Array des States, der ihn
  tatsächlich rendert. Formale und Browserregressionen sichern diese Trennung.
- **GAP-039 Deutsche Systemdefaults, geschlossen am 2026-07-12:** Runtime,
  Editor und MCP verwenden für sichtbare Produktdefaults ausschließlich native
  deutsche Texte. `Weiter` ist der kanonische leere Transitionname; englische
  Fallbacktitel und ASCII-Umschriften sind per Quellvertrag ausgeschlossen.
- **GAP-040 Touch-Double-Tap und Panelhoheit, geschlossen am 2026-07-12:** Ein
  erster echter Touch-Tap konnte durch automatisches Öffnen des Inspectors die
  Canvas-Geometrie verschieben; die anschließende Runtime-Antwort löschte zudem
  den erkannten ersten Tap. Touch-Auswahl verändert den Panelzustand nun nie,
  und Runtime-Nachrichten greifen nicht mehr in den durch State-ID und Ebene
  begrenzten Gestenautomaten ein. Ein Real-Browser-Test prüft beide
  `elementFromPoint()`-Treffer und den ersten Double-Tap ohne Force oder Retry.
- **GAP-041 Widget-Bearbeitung und Reihenfolge, geschlossen am 2026-07-13:**
  Zugeordnete Widgets waren nur indirekt als generische, eingeklappte
  Komponenten bearbeitbar und im Bausteinbereich nicht sortierbar. Der
  Bausteinbereich zeigt nun dieselben Komponenten als sichtbare Zeilen, öffnet
  per Pencil-Aktion den einzigen vorhandenen Komponenten-Editor und sortiert per
  Grip-Drag unmittelbar das kanonische `components`-Array. Ein Browsertest
  beweist Bearbeitung, Modellreihenfolge und Preview-Reihenfolge gemeinsam.

Auditnachweis vom 2026-07-13: `playwright test --list` bestätigt 345 Fälle in
fünf Dateien, davon 246 Smoke-Fälle. Hinzu kommen 26 Node-Server-Tests. Es gibt
keine regulären `skip`-, `only`-, Retry-, Force-Click- oder Sondertimeout-Fälle.
Der vollständige Endlauf und seine Dauer stehen in Abschnitt 22.5.

## 19. Implementierungslandkarte des Ist-Stands

Diese Landkarte beschreibt den auditierten Aufbau. Widerspricht ein Ist-Punkt
einer Vertragsregel, ist er in Abschnitt 18 als offene Abweichung zu behandeln.

- **ARC-001 Editor-Monolith:** `state.html` ist eine selbstenthaltene
  Vanilla-JavaScript-Anwendung. Sie enthält Host-Oberfläche, Canvas, SVG-
  Routing, Inspektoren, Presets, Modelloperationen, Persistenz, Exportlogik und
  den escaped Quelltext der generierten Runtime.
- **ARC-002 Editorzustand:** Der Host speichert Modell, Auswahl und aktive Ebene
  unter `stateBlueprintHotLinked.model.v2.editor`. Kamera und UI-Zustand liegen
  getrennt unter `.camera` und `.ui`. Presets, Trigger-Typen, Value-Types,
  Datasets und Connectoren kommen aus `/contract` und werden nicht im Editor-
  Snapshot oder im State-Explorer-Storage gespiegelt. Runtime-Kontext wird nicht
  in State-Defaults zurückpersistiert.
- **ARC-003 Historie:** Undo/Redo erfasst normalisierte Modell- und relevante
  Sitzungssnapshots, fasst zusammengehörige Dauerinteraktionen über einen
  History-Key zusammen und begrenzt die Historie auf 100 Einträge.
- **ARC-004 Runtime-Erzeugung:** `APP_HTML` ist die einzige eingebettete
  Standalone-Runtime; `GENERATED_APP_HTML` ist dieselbe Zeichenfolge. Sie wird
  unverändert als Blob-URL in das Vorschau-Iframe geladen. Der Standalone-Export
  und der MCP-Export injizieren das Modell in genau diesen Quelltext. Es gibt
  keine Runtime-Enhancer, String-Patches oder zweite Exportvorlage. Die
  generierte Runtime besitzt weder lokale Modellpersistenz noch
  Storage-Synchronisation. Standalone und Root-Demo besitzen getrennte
  Veröffentlichungsprofile; eine Parent-/Opener-Beziehung allein aktiviert
  keine Hostbrücke.
- **ARC-005 Host-Runtime-Brücke:** Der Host sendet Modell, Reset- und
  Startinformationen per `STATE_BLUEPRINT_MODEL`. Die Runtime antwortet mit
  `STATE_BLUEPRINT_RUNTIME_STATE`. Der Host verarbeitet jede Meldung unmittelbar
  als Ereignis für Anzeige, Canvas-Markierung und Ebenenbezug. Es gibt keinen
  zweiten Realtime- oder Bus-Nachrichtentyp. Der Host speichert weder Context noch
  einzelne Buswerte. Window, Origin und die pro Frame neue Session-ID sind für
  jede Nachricht verbindlich.
- **ARC-006 Runtime-Bus:** Fachliche Schreibvorgänge laufen zentral durch den
  Runtime-Bus und eine erlaubte Quellenliste. Echte UI-Ereignisse werden von
  synthetischen Ereignissen unterschieden. Pause leert Warteschlange, Timer und
  Countdowns und sperrt weitere Ereignisverarbeitung bis zur Fortsetzung.
  Defaults werden nur beim Eintritt montiert; Hot-Updates erhalten bestehende
  Buswerte und dieselbe Bus-Objektidentität.
- **ARC-007 Transitionen und Fetch:** Ereignisse werden gezählt und in einer
  Warteschlange verarbeitet. Die Condition-Auswertung nutzt ein begrenztes, eval-freies
  Ausdrucksmodell. Fetch ist ein State-Eintrittseffekt; Aktivierungs-ID und
  Quellsignatur verwerfen veraltete Antworten, Retries wachsen exponentiell und
  Erfolg beziehungsweise Fehler treten wieder als FSM-Ereignisse ein. Nur ein
  explizit deklarierter Trigger bildet eine Transition auf dieses Ereignis ab;
  Conditions entscheiden ausschließlich über die Zulassung.
- **ARC-008 Rendering:** Die Runtime rendert ausschließlich den aktiven State
  aus strukturierten State-Daten. Parent, Child und Geschwister werden niemals
  gleichzeitig oder passiv gerendert. Explizite Render-Reihenfolge verbindet manuelle
  Komponenten, `dataWire`-Referenzen und `transitionButton`-Referenzen. Text ist
  Anzeige; nur explizite Transition-IDs binden eine Nutzeraktion an den Ablauf.
  Parallel dazu interpretiert `renderLiteralText` weiterhin `{{path}}`-Tokens;
  siehe GAP-021.
- **ARC-009 MCP-Schicht:** `mcp/state-blueprint-core.js` implementiert
  normalisierte Modellaktionen und Editor-Kommandos ohne DOM. Der
  `state-blueprint-server.js` stellt sie als zeilenbasiertes JSON-RPC über stdio
  mit dateibasiertem Workspace bereit. `state-blueprint-intents.js` ist ein
  deterministischer Regex-Intent-Parser und kein Sprachmodell; sein Ergebnis
  sind normale, validierte Aktionen. Normalisierung und technische IDs sind
  editorgleich; die offene Boundary-Materialisierung steht in GAP-034.
- **ARC-010 Realtime-Schicht:** `server/server.js` liefert Katalog, HMAC-
  Raumtoken, WebSocket-Relay und HTTP-Emit. Der Server bleibt fachlich zustandslos.
  Presence, Browser-Emitter, lokale Outbox und Graph-/Modellnachrichten sind
  entfernt. Der Browser konsumiert katalogisierte Ereignisse ausschließlich als
  Trigger; `/emit` ist die authentifizierte externe Eingangsgrenze.
- **ARC-011 Build und Öffentlichkeit:** `scripts/build-index.mjs` startet den
  echten Editor mit `?demo=zustand`, betätigt dessen Export und schreibt das
  Ergebnis als `index.html`. Die Root-Seite ist deshalb die laufende exportierte
  Demo. Die App registriert keinen Worker; Cleanup-Dateien entfernen nur alte
  Registrierungen und Cache-Storage-Bestände. Die kontrollierte Nginx-Grenze
  liefert jede freigegebene Datei mit `no-store`.
- **ARC-012 Deployment:** GitHub Actions installiert Abhängigkeiten in vier
  parallelen Browser-Shards, führt die Serverfälle einmal aus und aktualisiert
  `release-version.js` erst nach Erfolg der vollständigen Matrix.
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
- **DEC-013 ist entschieden:** Es gibt keine komponentenartigen Child-States
  und keine passive Renderregion. `renderMode` ist verboten. Verschachtelte
  States bleiben echte FSM-Schritte; sichtbarer Inhalt gehört als Komponente
  auf genau den State, der ihn rendert.
- Mobile verwendet genau die vier Aufgaben Canvas, Vorlagen, Details und
  Vorschau. Der echte Canvas bleibt in jeder davon sichtbar; Vorlagen, Details
  und App teilen sich den verbleibenden Platz ohne Überdeckung. Nur die Vorschau
  verwendet ihn als nicht interaktiven Live-Monitor. Gesten müssen ohne
  verdeckte Bedienflächen oder konkurrierende Panels funktionieren.
- Inspector-, Vorschau- und Vorlagenzustand gehören dem Nutzer. Touch-Auswahl,
  Runtime-Nachrichten und Preset-Aktionen dürfen diese Zustände und die gewählte
  mobile Arbeitsansicht nicht eigenmächtig öffnen, schließen oder wechseln.
- State, Ports, Pins und Kabel teilen ein Koordinatensystem. Fremde SVG-
  Hitflächen dürfen einen State nicht überdecken; normale Erstinteraktionen
  müssen ohne Force, Retry oder Locator-Fallback treffen.
- Standalone-Export und Root-Demo verwenden dieselbe Runtime wie die Vorschau
  und enthalten weder Editor- noch Ablauf-Diagnoseoberflächen. Sichtbare deutsche
  Systemtexte verwenden native Umlaute und `ß`.
- Es gibt keinen App-Shell- oder Asset-Cache und keinen registrierten Service
  Worker. Frontend und Backend teilen genau eine erst nach vollständigem Vertragslauf erhöhte
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
- **DEC-005 Boundary-Eintritt:** Festzulegen ist, ob der aus der Boundary
  abgeleitete Kind-Eintritt die einzige erlaubte abgeleitete Transition bleibt
  oder als echte Transition im Modell materialisiert wird. In beiden Fällen
  müssen Trigger, Condition, Timer, ID, Reihenfolge und Darstellung denselben
  Resolver verwenden wie normale Transitionen.
- **DEC-007 Datenabbildung:** Zu entscheiden ist zwischen ausschließlich
  strukturierten Data Wires und einer ausdrücklich unterstützten, validierten
  Template-Sprache. Beides gleichzeitig widerspricht dem Ziel einer einzigen
  verständlichen Datenbindung.
- **DEC-011 Condition-Grammatik:** Die unterstützten Operatoren, Typregeln,
  Klammern, Stringliterale, Fehler und Validierung müssen exakt definiert werden;
  alternativ entfällt freie Condition-Eingabe zugunsten ausschließlich
  strukturierter Regeln.
### 20.3 Index der zentralen Leitfragen

- **App-Prinzip und Contract-Schutz:** PRN-001 bis PRN-011 sowie SYS-001 bis
  SYS-007; offen bleiben vor allem die getrennten Implementierungen aus GAP-003
  und GAP-013.
- **Transitionname gegen Route:** TRN-004, TRN-005 und TRN-015 sind entschieden:
  Standardname `Weiter`, Route separat, Zustandsumbenennung ohne Labeländerung.
  GAP-014 und GAP-039 sind geschlossen.
- **Mehrere Ausgänge auf dasselbe Ereignis:** GAP-017 und DEC-002 sind
  entschieden: exakt ein wahrer Kandidat feuert, mehrere führen zu
  `ambiguous-transition`, niemals entscheidet Modellreihenfolge.
- **Realtime-Trigger oder Emitter:** DEC-003 und RT-024 sind trigger-only
  entschieden. Zustellklasse und eine mögliche spätere Erweiterung stehen
  getrennt in DEC-004; GAP-018 und GAP-026 sind geschlossen.
- **Parent-/Child-Laufzeit:** NEST-001 bis NEST-016; offene Resolver- und
  Boundary-Fragen stehen in GAP-013, GAP-034 und DEC-005. Passive Child-States
  sind mit DEC-013 und GAP-038 ausgeschlossen.
- **Never-cache und gemeinsame Release-ID:** DEMO-011 sowie RT-019 bis RT-023
  sind fest. Offen sind der beweisbare Header der ersten Antwort in DEC-010 und
  GAP-027. GAP-037 ist geschlossen.
- **Keine Legacy-Fallbacks:** DEC-009 und MOD-005 sind strikt entschieden;
  GAP-025 ist geschlossen.
- **Mobile Bedienbarkeit, Treffer und Panelhoheit:** ED-011 bis ED-015,
  CAN-012 bis CAN-014 und PRE-016 sind fest; dauerhafte WebKit-Absicherung und
  gemeinsame Node-Geometrie sind bis auf den WebKit-CI-Nachweis aus GAP-023
  umgesetzt. GAP-024 ist geschlossen.
- **Vollständige, schnellere Tests:** TST-001 bis TST-009 erlauben nur
  Parallelisierung. GAP-019 ist geschlossen; Force, Retry und Fallback bleiben
  verboten.
- **Neu aus diesem Vollaudit:** Kanonische Zustandsdaten, Rendering und formale
  ID-Grammatik stehen in DEC-012 bis DEC-014. Alle drei Entscheidungen sowie
  GAP-031, GAP-033 und GAP-038 sind umgesetzt.

## 21. Nicht normative Richtung

Diese Punkte beschreiben mögliche Weiterentwicklung und sind kein bestehender
Abnahmevertrag:

- stärkere Typ-, Wertebereichs- und Schema-Prüfung des globalen Datenbaums,
- einfachere Auswahl von Datenkonstellationen für Change-Übergänge,
- ein Preset-Designer für vollständig vertragskonforme DaisyUI-Bausteine,
- vollständige, nachvollziehbare und testbare API-Steuerung jeder Editoraktion,
- eine gemeinsam importierte Modellnormalisierung für Editor und MCP,
- ausschließlich explizite Trigger, Datenbindungen und Transitionwirkungen,
- ein Resolver, der Mehrdeutigkeit sichtbar und fehlgeschlossen behandelt,
- eine benannte und technisch nachweisbare Realtime-Zustellklasse.

## 22. Verbindlicher Umsetzungsstand vom 2026-07-12

Dieser Abschnitt beschreibt den nach dem Vollaudit implementierten Vertrag. Er
ersetzt widersprechende Ist-Beschreibungen und offene Statusangaben in den
Abschnitten 18 bis 20. Ältere GAP-Texte bleiben als Auditspur erhalten, sind
aber nicht mehr normativ, wenn sie hier ausdrücklich geschlossen werden.

### 22.1 Ein Modell und genau ein Runtime-Bus

- Das persistierte Modell ist die einzige strukturelle Wahrheit. Der globale
  JSON-Bus ist die einzige veränderliche Laufzeitwahrheit.
- `state.data` ist ausschließlich persistierte Modellkonfiguration für
  Eintritts-Defaults. Schlüssel sind zustandsrelative Identifier ohne Punkte;
  `dataTypes` referenziert dieselben relativen Feldpfade. `state.data` ist kein
  Runtime-State und wird zur Laufzeit niemals verändert.
- Beim Eintritt eines aktiven States montiert die Runtime fehlende Defaults
  einmal unter `states.<stateId>`. Danach lesen und schreiben Komponenten,
  Data Wires, Repeat, Fetch, Conditions, Subscriptions und Transitionen nur den
  globalen Bus.
- Alle Runtime-Referenzen sind vollqualifiziert. Lesbare Systempfade sind
  `state.current`, `runtime.paused`, `realtime.*` und `events.*`. Fachlich
  beschreibbar sind ausschließlich deklarierte Pfade
  `states.<stateId>.<feld>`. Systemzweige sind für Modellaktionen schreibgeschützt.
- Relative Runtime-Pfade, Dotted Keys in `state.data`, qualifizierte
  `dataTypes`-Schlüssel und Writes auf Systemzweige werden an formalen Import-
  und MCP-Grenzen abgelehnt. Sie werden weder migriert noch automatisch
  präfixiert noch still verworfen.
- Ein Hot-Update mutiert dasselbe Bus-Root-Objekt in-place. Ein Reset leert und
  initialisiert dasselbe Objekt in-place. Es gibt zu keinem Zeitpunkt eine
  zweite Runtime-State-Instanz.
- Entfernt das Modell einen State, entfernt die Runtime den gesamten Zweig
  `states.<stateId>`, einschließlich aller durch UI, Transition, Fetch oder
  Realtime angereicherten Werte. Andere State- und Systemzweige bleiben
  erhalten. Entfernte deklarierte Unterpfade werden ebenfalls bereinigt.
- Ein Modellupdate überschreibt keine laufenden Werte und montiert neue
  Defaults nicht vor dem nächsten State-Eintritt. Die Runtime erzeugt keine
  Eingaben aus Condition-Text. Nutzereingaben existieren ausschließlich als
  explizite Komponenten mit vollqualifizierter Busbindung.
- Jeder State ist ein vollständiger FSM-State. `parentId` bildet weiterhin echte
  verschachtelte States und Editor-Layer; Eintritt, Ausgang und Stop-Verhalten
  folgen ausschließlich den definierten Transitionen und Boundaries.
- Ein geöffneter Parent-Layer zeigt genau eine technische Input- und eine
  technische Output-Boundary-Route. `groupEntryId` und `groupExitId` erhalten
  die Zuordnung zu den echten Parent-Transitionen, ohne deren externe Kabel im
  Child-Canvas zu vervielfachen.
- Die Runtime rendert genau den aktiven State. Sie rendert weder dessen Parent
  noch dessen Children zusätzlich. `renderMode` ist kein Vertragsfeld, wird
  nicht migriert und an Modell-, Template- und MCP-Grenzen abgelehnt.
- Ein einfaches eingebautes Inhalts-Preset erzeugt auf der Root-Ebene einen
  normalen State mit genau dieser Komponente. Innerhalb eines Parent-Layers
  oder bei direktem Hinzufügen auf einen State wird dieselbe Komponente an das
  bestehende `components`-Array dieses States angehängt; es entsteht kein
  versteckter Child-State. Explizit erzeugte Child-States, gespeicherte
  State-Vorlagen und verschachtelte Layer bleiben unverändert echte States.
- Preset-Aktionen verändern den vom Nutzer bestimmten Inspectorzustand nicht.
  Die Aktion `In <Parent>` ist ein ausdrücklicher Bearbeitungsbefehl und darf
  den Inspector des Layer-Owners öffnen.

Damit sind **DEC-012**, **DEC-014**, **GAP-030**, **GAP-031**, **GAP-032** und
**GAP-033** sowie **DEC-013/GAP-038** entschieden und umgesetzt.

### 22.2 Runtime-, Frame- und Realtime-Besitz

- Preview und Standalone verwenden dieselbe generierte Runtime. Standalone hat
  keine Editor-Host-Brücke, konsumiert Realtime aber direkt wie die Preview.
  Die Preview startet mit einem leeren Modell und akzeptiert das Autorenmodell
  ausschließlich vom zugeordneten Host. Standalone startet ausschließlich mit
  dem eingebetteten Exportmodell. Die Runtime liest oder schreibt kein Modell
  in Local Storage und besitzt keinen Storage-Synchronisationspfad.
- Nur das aktuell eingebundene App-Frame darf Runtime-Nachrichten an den Host
  liefern. Die Runtime akzeptiert Modell- und Steuernachrichten nur vom
  zugeordneten Host-Window, von der exakten Origin und mit der aktuellen
  Session-ID. Ein Reload erzeugt eine neue Session.
- Alte, fremde, neu eingeschleuste und absichtlich sendende Frames bleiben für
  Modell, aktiven State, Realtime und Preview wirkungslos. Es gibt keinen
  Origin-, Opener- oder Storage-Fallback und keinen Kompatibilitätsalias.
- Die generierte Runtime besitzt Tokenabruf, WebSocket, Join, Reconnect,
  Ereignisaufzeichnung, Katalogdefinition und Transition selbst. Der Editor-
  Host besitzt Modell und Steuerbefehle. Runtime-Meldungen werden als Events
  verarbeitet; Context, aktueller State und Pause werden nicht als parallele
  Hostvariablen gespeichert.
- Realtime ist trigger-only. Es gibt keinen Browser-Emitter, keine lokale
  Outbox, keine Presence und keine Graph-/Modellnachrichten über WSS. `/emit`
  ist die authentifizierte externe Eingangsgrenze.
- Katalog-Bindings dürfen nur auf deklarierbare `states.<id>.<feld>`-Pfade
  zeigen. Die Standardereignisse besitzen keine Bindings. Payloads bleiben
  unabhängig davon unter `events.<eventName>.detail` lesbar.
- Der Transport garantiert geordnete Live-Zustellung innerhalb einer aktiven
  WebSocket-Sitzung. Wegen des ausdrücklich zustandslosen, cachefreien Vertrags
  gibt es keine dauerhafte Offline-Outbox, kein Replay und keine Zustellgarantie
  über einen Verbindungsabbruch hinweg.

Damit sind **GAP-025**, **GAP-026**, **GAP-029** und **GAP-036** geschlossen.
**DEC-004** ist auf geordnete Live-Zustellung ohne dauerhafte Speicherung
festgelegt.

### 22.3 Deterministische Transitionen

- Für ein eintreffendes Ereignis sammelt die Runtime alle strukturell passenden
  Ausgänge der aktiven State-/Parent-Kandidatenmenge und wertet alle Conditions
  ohne dazwischenliegenden Buswrite aus.
- Kein wahrer Kandidat bedeutet keinen State-Wechsel.
- Genau ein wahrer Kandidat wird ausgeführt.
- Mehrere wahre Kandidaten erzeugen `ambiguous-transition`; es wird keine
  Transition ausgeführt. Modellreihenfolge ist niemals Priorität.
- Ein Button-Ereignis trägt seine Transition-ID und bleibt dadurch auch bei
  mehreren sichtbaren Ausgängen eindeutig.
- Fetch, Change, Event und Realtime dürfen eine Transition nur über deren
  expliziten `triggerType` und `triggerEvent` erreichen. Weder Condition noch
  Label, Set-Pfad oder Datenwert erzeugen einen Trigger.

Damit sind **DEC-002**, **GAP-015** und **GAP-017** entschieden und umgesetzt.

### 22.4 Never-Cache und gemeinsame Release-ID

- Die App registriert keinen Service Worker. `disable-sw.js` meldet eventuell
  noch vorhandene Registrierungen ab und löscht alte Cache-Storage-Bestände.
  `sw.js` ist nur ein Deinstallations-Tombstone ohne Fetch-Handler und meldet
  sich beim Aktivieren selbst ab. Keiner dieser Pfade legt Cache-Daten an.
- Frontend, Assets, Release-Datei und Realtime-Antworten werden an der
  kontrollierten Nginx-Grenze mit `Cache-Control: no-store, max-age=0`,
  `Pragma: no-cache`, abgelaufenem `Expires`, deaktiviertem ETag und
  deaktiviertem `if_modified_since` ausgeliefert.
- `release-version.js` ist die einzige inkrementelle Release-Datei. Frontend
  und Backend verwenden exakt `release-N`; `/version` und `/healthz` liefern
  `releaseId`. Es gibt keine Service-Worker-ID und keinen alten Payload-Alias.
- CI erhöht die Release-ID erst nach allen Vertragsfällen. Auto-Deploy prüft
  die exakte ID, PM2, Nginx und Health, schreibt den Erfolgsmarker nur danach
  fort und wiederholt fehlgeschlagene Deploys ohne Rollback.

Die Code- und Servergrenze für **GAP-027** ist umgesetzt. Die öffentliche
Erstantwort bleibt operativ offen, solange DNS noch auf GitHub Pages zeigt;
dort wurde am 2026-07-12 weiterhin `Cache-Control: max-age=600` gemessen. Der
Vertrag ist erst nach DNS-/TLS-Umschaltung auf die kontrollierte Nginx-Grenze
auch extern erfüllt.

### 22.5 Nachweise

- Core-Verträge: Frame-Eigentum, Preview/Standalone-Realtime, deklarierte
  Realtime-Writes, Bus-Objektidentität, vollständige State-Zweig-Löschung,
  Reset in-place, Host ohne Busspiegel und deterministische Mehrfachereignisse.
- MCP-Verträge: zustandszugeordnete Deklarationen, vollqualifizierte Runtime-Pfade und
  ausdrückliche Ablehnung jeder relativen Runtime-Referenz.
- Hosting-Verträge: kein Service-Worker-Fetch-Handler, keine Registrierung,
  leere Cache Storage nach Start, No-Store-Nginx-Allowlist und gemeinsame
  `releaseId`.
- UI-Verträge: Realtime-Katalog bleibt unpersistiert; Data-Wire-, Repeat- und
  Renderpfade bleiben vollständig qualifiziert, Eingaben sind explizite
  Komponenten, keine Runtime-Daten werden in `state.data` kopiert, Touch-Auswahl
  lässt den Inspectorzustand unverändert und echte Touch-Taps bleiben unabhängig
  von asynchronen Runtime-Nachrichten deterministisch.
- Vollständige lokale Abnahme vom 2026-07-14: 27/27 Node-Server-Tests sowie
  357/357 Playwright-Fälle bestanden. Die Browserabnahme lief vollständig und
  disjunkt als 260/260 Smoke- und 97/97 übrige Fälle mit vier Workern; kein Test
  wurde ausgelassen oder durch Retry beziehungsweise Force ersetzt.
- Lean-Audit vom 2026-07-14: Die Runtime-Enhancer-Kette und 54 nachweislich
  aufruferlose Hostfunktionen wurden entfernt. Der Produktcode in `state.html`
  und `mcp/state-blueprint-server.js` schrumpfte netto um 4.421 Zeilen. Die
  kanonische Runtime blieb gegenüber dem vollständigen Upstream-Endergebnis mit
  264.354 Byte und SHA-256
  `736630e9aed63799603b28da28d6ac607f6d114db6c70cc218184f17b13ddcb7`
  bytegenau unverändert. Der statische Abschluss-Audit findet keine deklarierte
  Hostfunktion ohne Verwendung.
- Ausführbarer Lean-Vertrag vom 2026-07-14: Der Core-Test isoliert den
  Editor-Host von der eingebetteten Runtime und lehnt jede benannte Funktion ab,
  die im Produktquelltext nur als Deklaration vorkommt. Preview, Editor-Export
  und MCP-Export werden gegen die jeweils aktuelle kanonische `APP_HTML`-Quelle
  per Bytezahl und zur Laufzeit berechnetem SHA-256 verglichen. Es gibt bewusst
  keinen festgeschriebenen Release-Hash: Eine gemeinsam geänderte Runtime bleibt
  grün, unbeabsichtigte Auslieferungsdrift nicht.

### 22.6 Weiterhin offen, ohne stillen Fallback

- **GAP-003:** Editor und MCP teilen noch nicht dieselbe importierte
  Modellnormalisierung. Die Runtime-Parität ist dagegen strukturell erzwungen:
  GAP-013 ist geschlossen und alle Auslieferungspfade verwenden `APP_HTML`
  unverändert.
- **DEC-001:** Die fachliche Standardaktion für Enter ist noch nicht als
  explizites Modellfeld entschieden.
- **DEC-005:** Der abgeleitete Boundary-Eintritt ist noch nicht als normale
  persistierte Transition materialisiert. GAP-034 dokumentiert die verbleibende
  Editor-/MCP-Formalisierungsstelle.
- **DEC-007/GAP-021:** Strukturierte Data Wires und validierte `{{path}}`-
  Anzeigetokens existieren parallel. Relative Tokens sind verboten; die
  langfristige Reduktion auf eine Darstellungsform ist noch offen.
- **DEC-011/GAP-028:** Die freie Condition-Sprache ist eval-frei und ihre
  Referenzen sind kanonisch, aber ihre vollständige formale Grammatik ist noch
  nicht als eigenständiges Schema dokumentiert.
- **GAP-023:** Safari-Verhalten ist per Chromium-Vertrag und realer Beobachtung
  adressiert, aber noch nicht durch einen dauerhaft laufenden WebKit-CI-Job
  abgesichert.
- **GAP-027 operativ:** DNS und TLS für die statische Hauptdomain müssen auf die
  kontrollierte Nginx-Grenze umgestellt und danach extern per Headerprobe
  verifiziert werden.
