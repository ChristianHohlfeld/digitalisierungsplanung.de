## Ergebnis

<!-- Welches konkrete Nutzer- oder Betriebsproblem ist nach diesem PR gelöst? -->

## Umfang

- [ ] Der PR hat einen klar abgegrenzten fachlichen Zweck.
- [ ] Nicht zusammengehörige Refactorings oder generierte Release-Stamps sind nicht enthalten.
- [ ] Kundenoberfläche und interne Studio-/Adminfunktionen bleiben getrennt.

## Nachweis

- [ ] `npm run check`
- [ ] `npm run test:server`
- [ ] Relevante Browserfälle; bei Interaktionsänderungen mindestens Chromium und WebKit
- [ ] `index.html` wurde nur über `npm run build:index` geändert.

## Produkt- und Betriebsrisiko

- [ ] Datenmodell, Migration und Rückwärtskompatibilität geprüft
- [ ] Berechtigungen, Mandantengrenzen und personenbezogene Daten geprüft
- [ ] Logging enthält keine Secrets oder unnötigen personenbezogenen Daten
- [ ] Rollbackweg und betroffene Betriebsdokumentation geprüft

## Releasehinweis

<!-- Nutzer-/Operatorwirkung, Konfigurationsänderung, Migration oder „keine“. -->
