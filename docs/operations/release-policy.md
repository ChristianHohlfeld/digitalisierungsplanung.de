# Release Policy

Status: verbindlich für `main` und Produktion

Stand: 2026-07-15

## Grundsatz

Ein Commit ist eine Änderung, kein Release. Jeder PR und jeder Push nach `main`
wird vollständig geprüft; veröffentlicht wird ausschließlich durch den
manuellen Workflow **Publish managed release**. Damit entstehen keine
Release-Stamp-Commits nach jeder kleinen Änderung.

## Pflichtprüfungen

Der wiederverwendbare Workflow `.github/workflows/ci.yml` besteht aus:

- Repository- und Betriebsvertragsprüfung,
- reproduzierbarem Neuaufbau von `index.html`,
- Audit produktiver npm-Abhängigkeiten auf hohe/kritische Findings,
- Serververträgen,
- vollständigen Chromium-Tests in vier Shards und
- einer dedizierten WebKit-Produktsuite für öffentlichen Pilot-Funnel,
  Studio-Boot und konfliktgesichertes Managed-Save.

Der manuelle Release ruft denselben Workflow erneut auf. Erst wenn alle Jobs
grün sind, darf der Releasejob schreiben.

Die statische Website wird aus einer expliziten Allowlist nach `dist/` gebaut
und als GitHub-Pages-Artefakt veröffentlicht. `server/`, `mcp/`, Tests,
Repositorymetadaten, Betriebsdokumente und insbesondere `state.html` gelangen
dadurch nicht ins Webroot. Die öffentliche Seite enthält nur die exportierte
Runtime und Produkt-CTA. Die Repository-Einstellung **Pages source** muss auf
„GitHub Actions“ stehen; direkte Branch-Veröffentlichung aus `main` ist
unzulässig.

## Versionsregel

- IDs sind streng fortlaufend: `release-N`.
- Der angeforderte Wert muss exakt aktuelle Sequenz plus eins sein.
- `release-version.js` ändert sich nur in einem echten Release.
- Der Stamp enthält Zeitpunkt und den vollständig geprüften Source-Commit.
- Der Releasejob verweigert die Veröffentlichung, wenn sich `main` nach der
  Prüfung bewegt hat.
- Release-Commit, annotierter Git-Tag und GitHub-Release besitzen dieselbe ID.
- Tags werden nicht verschoben oder wiederverwendet.

## Erforderliche Repository-Einstellungen

Diese Einstellungen liegen außerhalb des Codes und müssen vor dem ersten
Produktionsrelease mit Screenshot/Export belegt werden:

- Ruleset für `main`: Änderungen grundsätzlich nur per PR, keine Force-Pushes
  oder Löschung, alle Jobs aus `ci.yml` als Pflichtchecks.
- Ein eng begrenzter Bypass darf ausschließlich dem manuellen Releaseworkflow
  erlauben, nach erfolgreicher Prüfung den reinen `release-version.js`-Commit
  zu schreiben. Personen und normale Tokens erhalten keinen Bypass.
- GitHub-Environment `production`: benannter Freigebender, Schutz vor
  Selbstfreigabe und nur `main` als zulässiger Deployment-Branch.
- Tagregel für `release-*`: keine Aktualisierung oder Löschung.
- Pages source: `GitHub Actions`, niemals Root/`main` als direkte Branchquelle.
- Workflow-Berechtigungen standardmäßig read-only; Schreibrechte nur in den
  beiden expliziten Release-/Pages-Jobs.

Wenn der Releasebot den Ruleset-Bypass nicht nachweisbar und eng begrenzt
besitzt, darf der Workflow nicht durch pauschale Freigabe aller Actions oder
einen persönlichen Dauer-Token „repariert“ werden.

## Generierte Startseite

`index.html` ist ein Buildartefakt aus dem Demo-Modell in `state.html`:

```bash
npm run build:index
npm run check:index
```

Der Builder entfernt die Wall-Clock-Zeit aus dem Export, schreibt einen Hash des
normalisierten Artefakts in den Generated-Header und erzeugt bei identischem
fachlichem Export identische Bytes. CI baut die Datei separat neu und vergleicht
sie bytegenau. Direkte Änderungen an `index.html` sind unzulässig.

## Normaler Release

1. Zielumfang und Nutzerwirkung im PR festhalten.
2. Generierte Artefakte aktualisieren und alle Checks grün bekommen.
3. Staging mit dem geprüften Quellstand testen.
4. Produkt-, Betriebs- und ggf. Datenschutzfreigabe dokumentieren.
5. In GitHub Actions **Publish managed release** auf `main` starten.
6. Exakt nächste Sequenz und kurze Operator-Release-Note eingeben.
7. Nach Release den Produktions-Smoke aus
   [`environments.md`](environments.md) durchführen.
8. Release, Prüfer, Ergebnis und Auffälligkeiten im Betriebsjournal vermerken.

## Hotfix

Ein Hotfix überspringt keine Verträge. Er wird vom letzten produktiven Tag als
kleiner, isolierter Fix vorbereitet, geprüft und als nächste reguläre Sequenz
veröffentlicht. Falls ein Test nachweislich fehlerhaft ist, wird zuerst der Test
mit dokumentierter Begründung korrigiert; er wird nicht nur im Workflow
deaktiviert.

## Rollback

- Bei Nutzer-, Daten- oder Sicherheitsrisiko Pilotverkehr kontrolliert stoppen.
- Den bekannten guten Quellstand erneut durch alle Gates führen und als neue,
  höhere `releaseSequence` veröffentlichen; Clients lehnen niedrigere Sequenzen
  absichtlich ab.
- Alte Tags bleiben unverändert. Ein operativer Rollback verschiebt keinen Tag
  und setzt keine Release-Sequenz zurück.
- Datenmigrationen nur mit dem vorab getesteten Rückwärts- oder Restoreweg
  zurücknehmen.
- Rollback als Incident/Betriebsereignis dokumentieren.
- Der fehlerhafte Release bleibt unverändert nachvollziehbar; die Korrektur
  erhält eine neue Sequenz.

Ein Code-Rollback stellt nicht automatisch Daten wieder her. Bei möglicher
Datenkorruption gilt zusätzlich
[`backup-restore-runbook.md`](backup-restore-runbook.md).
