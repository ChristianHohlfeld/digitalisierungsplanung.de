# Umgebungs- und Promotionmodell

Status: verbindliches Sollmodell; fehlende Umgebungen sind in der
Produktionsreife als BLOCKER geführt

Stand: 2026-07-15

## Umgebungen

| Umgebung | Zweck | Daten | Zugriff | Veröffentlichung |
| --- | --- | --- | --- | --- |
| Lokal | Entwicklung und schnelle Tests | synthetisch | Entwicklergerät | nie |
| PR Preview | Review eines konkreten Changes | synthetisch, kurzlebig | PR-Team | automatisch, kurzlebig |
| Staging | Abnahme, Migration, Restore- und Integrationsprobe | synthetisch oder gesondert freigegebene Testkopie | Operator + Abnahmerollen | aus grünem Commit |
| Produktion | freigegebener Pilotbetrieb | vertraglich freigegebene Daten | Least Privilege | nur manueller Release |

Staging und Produktion brauchen getrennte Secrets, Tokens, Datenspeicher,
Realtime-Räume, Logs und Backups. Eine andere URL auf demselben ungetrennten
Datenbestand ist keine eigenständige Umgebung.

## Aktueller Nachweisstand

- Lokale Ausführung und automatisierte Testumgebung sind im Repository vorhanden.
- Die öffentliche Root-Domain und der Realtime-Server sind als produktive Ziele
  dokumentiert.
- Eine vollständig getrennte, nachgewiesene Staging-Umgebung ist im Repository
  derzeit nicht belegt und bleibt vor Echtdaten ein BLOCKER.
- Der Workflow für ein geprüftes GitHub-Pages-Artefakt ist vorhanden; die
  Repository-Einstellung „Pages source = GitHub Actions“ bleibt als externer
  Betriebsnachweis offen.
- PR Preview, Identitätsprovider, persistente Projektdatenbank und Secret Store
  sind hier nicht als betriebsfertige Infrastruktur nachgewiesen.

## Konfigurationsregeln

- Keine Produktions-URL als stiller lokaler Fallback.
- Keine Secrets im Git-Repository, in Client-JavaScript, Screenshots, Exporten
  oder CI-Ausgaben.
- Jede Variable hat Name, Zweck, Owner, Umgebung, Rotationsweg und zulässige
  Verbraucher im Secret-Inventar.
- Test- und Produktionskonten sind getrennt; privilegierte Konten sind
  personenbezogen und nicht geteilt.
- Datenexporte aus Produktion werden wie Produktivdaten behandelt, befristet
  gespeichert und nach Zweckende gelöscht.
- Änderungen an Datenvertrag oder Persistenz enthalten Vorwärtsmigration,
  Rückwärts-/Rollbackplan und eine Stagingprobe.

## Promotion

```text
Branch/PR
  -> Repository- und Security-Checks
  -> vollständige Chromium-Verträge
  -> WebKit-Smoke
  -> Staging-Deployment desselben Artefakts
  -> fachliche und betriebliche Freigabe
  -> manueller sequenzieller Release
  -> Produktionsprüfung und Beobachtungsfenster
```

Es wird dasselbe geprüfte Artefakt promotet; ein Produktions-Build aus anderem
Quellstand ist unzulässig. `release-version.js` wird genau einmal bei der
bewussten Veröffentlichung erzeugt. Details:
[`release-policy.md`](release-policy.md).

## Produktionsprüfung

Nach Veröffentlichung werden mindestens geprüft und protokolliert:

1. erwartete Release-ID und Source-Commit,
2. Root-App und vereinbarter Pilotpfad,
3. Anmeldung, Rollen- und Mandantengrenze,
4. ein synthetischer End-to-End-Fall,
5. Monitoring und Alarmzustand,
6. keine neue hohe Fehlerrate und
7. Rollbackfähigkeit des vorherigen Releases.

Die Freigabe gilt erst nach diesem Smoke als abgeschlossen. Fehler führen nach
Auswirkung zum Rollback oder zum Incident-Verfahren.
