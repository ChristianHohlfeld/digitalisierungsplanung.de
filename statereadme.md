# UI- und Interaktionsvertrag

Die Produktoberfläche ist der fokussierte Recorder/Render-Stand aus Release 206. Cleanup darf Server, Altformate und nicht sichtbare Produktflächen entfernen, aber diese Oberfläche nicht neu erfinden.

## Feste Struktur

```text
Topbar: Projektname · Neu · Öffnen · Projekt JSON · App exportieren

Links:  State Chart
        Inspector

Rechts: App Recorder · Input
        App Render · Output
```

Desktop bleibt zweispaltig. Unter 980 px stehen Authoring und Preview untereinander; unter 620 px brechen Topbar, URL-Zeile, Regeln und Metriken kontrolliert um. Es gibt keinen fünften Arbeitsbereich, kein Agent-Overlay und kein Pop-up für den Cloud-Recorder.

## State Chart

- State-Klick selektiert.
- Drag beginnt am Node-Header und nutzt Pointer Events für Maus, Stift und Touch.
- Positionen rasten auf 12 px ein.
- Pointer Capture hält den Drag bis `pointerup` stabil.
- Kanten bleiben während des Drags sichtbar und werden danach vollständig neu gezeichnet.
- Klick auf die Kante öffnet den Transition-Inspector.

## Inspector

- State: Titel, Trigger-Kontext, erkannte Felder, ausgehende Transition, Löschen.
- Transition: Label, Listener, Listener-Detail, UND/ODER-Regeln, Löschen.
- Eingaben speichern verzögert in IndexedDB und behalten native Fokus-/Tastatursemantik.

## Recorder-Tab

- URL, Start, Fertig und Abbrechen bleiben die primären Controls.
- Der Browser erscheint innerhalb des bestehenden Tabs.
- Die Zielseite selbst wird nicht raw eingebettet; der Iframe zeigt den same-origin Recorder mit sicheren Screenshots.
- Klick-, Text-, Tasten- und Scrollaktionen werden an Chromium gesendet.
- Fortschritt aktualisiert Actions, States und Status.
- Fertig importiert genau ein Projekt und wechselt in den Render-Tab.

## Render-Tab

- Vorheriger/nächster State bleibt manuell klickbar.
- Echter Replay verwendet das transportable Recording-Paket, nicht die alte Session.
- Geschwindigkeit 0,5× bis 4× bleibt wählbar.
- State-Auswahl folgt nur verifizierten Replay-Schritten.
- Stop beendet den echten Browserlauf.

## Persistenz und Export

- `zustand-project` Version 1 ist das einzige UI-Projektformat.
- IndexedDB speichert Projekte; Local Storage hält nur die letzte Projekt-ID.
- Projekt-JSON enthält keine Session-ID oder Passwortwerte.
- HTML-Export ist selbstständig und registriert keinen Service Worker.

## Release-Schutzmatrix

- Desktop- und Mobile-Struktur
- Topbar und beide Tabs
- Maus- und Touch-Drag mit Raster
- State-/Transition-Inspector und Regeln
- State hinzufügen/löschen
- Projekt- und HTML-Export
- eingebetteter Recorder ohne Pop-up
- Recording-zu-Chart-Bijektion
- transportabler echter Replay und Mismatch-Stopp
- 13-Basic-Contract
- SSRF-, Secret- und Session-Grenzen
- Green-Release-Gate und Rollback
