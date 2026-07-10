# Zustand-Vertrag

Dieses Dokument ist der schriftliche Vertrag der Anwendung. Es beschreibt, wie Zustand gebaut ist, welche Regeln immer gelten und welche Dinge bewusst nicht erlaubt sind.

## Grundsatz

Es gibt genau eine fachliche Wahrheit:

```text
globalState
```

Das JSON-Modell beschreibt Zustaende, Uebergaenge, Ausloeser, Bedingungen, Daten, Darstellung und Reihenfolge. Die Laufzeit liest dieses Modell und schreibt fachliche Aenderungen nur in den gemeinsamen Datenbus.

Nichts, was Ablauf oder Daten beeinflusst, darf nur im DOM, in einer Komponente, in einer Vorlage, in einem Zwischenspeicher oder in einer zweiten Datenhaltung leben.

## Zustaende

- Ein Zustand ist eine Sicht auf den relevanten Ausschnitt des globalen JSON-Baums.
- Ein Zustand darf Darstellung zeigen, Datenpfade beobachten und echte ausgehende Uebergaenge anbieten.
- Neue Daten eines Zustands liegen eindeutig unter seinem Bereich, normalerweise `states.<stateId>.*`.
- Wird ein Zustand entfernt, werden auch seine deklarierten Daten aus dem Modell entfernt.
- `undefined` ist als gespeicherter Wert verboten.
- Leere Werte muessen bewusst gesetzt sein, zum Beispiel `""`, `false`, `0`, `[]` oder `{}`.

## Uebergaenge

- Ein Uebergang ist eine echte Kante im Modell.
- Quelle und Ziel muessen vorhandene Zustaende sein.
- Ein Uebergang startet nur durch seinen eingestellten Ausloeser: Schaltflaeche, Datenwechsel, Ereignis, Echtzeit-Ereignis, Zeit oder sofort.
- Bedingungen lesen ausschliesslich aus `globalState`.
- `set` beschreibt nur die Wirkung nach dem Ausloesen. `set` darf nie entscheiden, welche Schaltflaeche welchen Uebergang feuert.
- Text ist Anzeige. IDs sind Bindung.
- Wenn kein echter Ausgang erreichbar ist, stoppt die Maschine.

## Verschachtelung

- Eltern- und Kindzustaende benutzen dieselben Regeln wie jeder andere Zustand.
- Eingang und Ausgang eines Elternzustands sind echte Verweise auf seine Draehte, keine Kopien.
- Eintritt in einen Elternzustand fuehrt in seinen eingestellten Kind-Eingang.
- Kindzustaende laufen entlang ihrer echten Uebergaenge.
- Ein Kind-Ausgang fuehrt nur weiter, wenn am Ausgang des Elternzustands ein echter folgender Uebergang haengt.
- Gibt es keinen solchen Uebergang, stoppt die Maschine.
- Es gibt keinen erfundenen Zurueck-zum-Elternzustand-Knopf.
- Es gibt keinen Kreis vom Ausgang zurueck zum Eingang, ausser er ist als echter Uebergang modelliert.

## Darstellung

- Darstellung ist eine Sicht auf Modell und Datenbus.
- Darstellung darf keine Ablaufentscheidung erfinden.
- Darstellung darf keine Daten erfinden.
- Darstellung darf keine Daten laden.
- Sichtbare Schaltflaechen und Links muessen an echte Uebergaenge gebunden sein.
- Reihenfolge in der Darstellung ist Modelldaten und im Inspektor bearbeitbar.
- Wenn ein Uebergang als Schaltflaeche sichtbar ist, ist er ein echter Darstellungseintrag.
- Datenabbildungen sind Darstellungseintraege, wenn sie sichtbaren Inhalt erzeugen.

## Oberflaechenbausteine

DaisyUI liefert Form und Aussehen. Die Wahrheit bleibt das JSON-Modell.

- Vorlagen speichern strukturierte Daten, keine versteckte Logik.
- Bausteine lesen und schreiben nur explizite Datenpfade.
- Schaltflaechen, Links, Menuepunkte, Schritte und Fusszeilen-Eintraege feuern Ablauf nur ueber explizite `transitionId`.
- Eingaben schreiben nur ihre gebundenen Felder, zum Beispiel `value`, `checked`, `selected` oder `open`.
- Aufklappen, Auswaehlen oder Umschalten ist nur dann fachlicher Zustand, wenn es im Datenbus liegt.
- Rein optische Hover- und Fokuszustaende duerfen lokal bleiben.

## Vorlagen

- Vorlagen sind Katalogeintraege.
- Eine Vorlage erzeugt erst dann Daten, wenn sie als echter Zustand in die Arbeitsflaeche gelegt wird.
- Jede erzeugte ID muss global eindeutig sein.
- Jede erzeugte Verbindung muss auf vorhandene Zustaende zeigen.
- Vorlagen duerfen keine zweite Laufzeitlogik mitbringen.
- Wenn eine Vorlage interaktive Elemente enthaelt, muessen diese als echte Daten und echte Uebergaenge im Modell erscheinen.

## Arbeitsflaeche

- Die Arbeitsflaeche bearbeitet nur das JSON-Modell.
- Verschieben, Verbinden, Gruppieren, Entgruppieren, Loeschen, Rueckgaengig und Wiederholen muessen dasselbe Modell veraendern wie die Programmierschnittstelle.
- Gruppen und Einklappen duerfen den Ablauf nicht veraendern.
- Die Vorschau verwendet dasselbe Modell und dieselbe Laufzeitlogik wie der Export.
- Datenladen ist ein Effekt beim Betreten eines Zustands und schreibt in konfigurierte Datenbus-Ziele.
- Automatische Vorschlaege duerfen Kandidaten zeigen, aber nichts erraten und speichern.

## Programmierschnittstelle

- API und MCP bearbeiten dasselbe Modell wie das Werkzeug.
- API-Aufrufe klicken nicht die Oberflaeche.
- API-Aufrufe halten keinen zweiten Speicher.
- Jede Nutzeraktion soll als ausdrueckliche Aktion programmatisch ausfuehrbar sein.
- `state_blueprint_apply_actions` normalisiert, prueft und schreibt in Vertragsreihenfolge.
- `state_blueprint_export_html` muss dieselbe HTML-Ausgabe erzeugen wie der Exportknopf.
- Externe Agenten lesen zuerst das Modell, planen dann Aktionen, validieren sie und schreiben erst danach.

## Tests

- Vertragstests haben Vorrang vor alten Momentaufnahmen.
- Tests duerfen nicht abgeschwaecht werden, um Fehler passend zu machen.
- Wenn ein Test alte Markup-Details prueft, wird er auf den oeffentlichen Vertrag umgestellt.
- Geschuetzt bleiben besonders: Verbindungspunkte, Eltern-Kind-Ablauf, Ausgangsregeln, Darstellungsreihenfolge, Datenbus-Schreibpfade, eindeutige IDs, Export und API.

## Richtung

- Visuelles Datenwerkzeug: Datenpfade auf Darstellungsbausteine ziehen und verbinden.
- Datendesign: Typen, erlaubte Werte, Grenzen und harte Pruefung fuer den globalen Datenbaum.
- Abonnement-Werkzeug: Datenkonstellationen einfach auswaehlen, die Zustaende oder Uebergaenge ausloesen.
- Vorlagen-Designer: DaisyUI-Vorlagen bauen, die vollstaendig dem Modellvertrag folgen.
- Vollstaendige API-Steuerung: jede Werkzeugaktion auch programmatisch, nachvollziehbar und testbar.
