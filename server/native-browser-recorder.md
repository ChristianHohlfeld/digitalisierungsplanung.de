# Native Browser Recorder

Einfachster Intranet-Recorder:

```bash
npm ci
npm run recorder:native -- https://wob-app15.wobak.de/de/cockpit --out=yuneo-recording.json
```

Danach öffnet sich ein echtes Chromium-Fenster. Die Zielseite wird normal benutzt:

- klicken
- tippen
- E-Mail-Felder ausfüllen
- Dropdowns/Checkboxen bedienen
- scrollen

Im Hintergrund werden echte Aktionen, Selector, Timings und Snapshots aufgezeichnet. Beim Drücken von Enter im Terminal wird ein Recording-Package erzeugt. Passwortfelder werden redacted und nicht als Replay-Wert gespeichert.

Ziel: kein Screenshot-Fernsteuerungsgefühl, sondern normale Browser-Nutzung plus replaybarer State-Chart-Export.
