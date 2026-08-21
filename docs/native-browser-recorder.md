# Native Browser Recorder Product Note

Der Recorder soll sich nicht wie Screenshot-Fernsteuerung anfühlen.

Zielzustand:

1. Benutzer startet den lokalen nativen Recorder.
2. Echtes Chromium-Fenster öffnet die Zielseite im Kundennetz.
3. Benutzer bedient die Website normal.
4. Recorder sammelt im Hintergrund Actions, Selector, Timings und Snapshots.
5. Export erzeugt State-Chart + replaybares Recording-Package.

Damit sind Intranet-Anwendungen wie Yuneo/Aareon erreichbar, ohne dass der Cloud-Server privaten IP-Raum sehen muss.
