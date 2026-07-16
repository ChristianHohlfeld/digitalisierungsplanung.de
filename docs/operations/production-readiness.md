# Produktionsreife: Sicherheits-, Datenschutz- und Betriebscheck

Status: Gate-Checkliste; **keine Rechtsberatung und kein Compliance-Zertifikat**

Stand: 2026-07-16

Diese Datei trennt vorhandenen Code von noch zu erbringendem Betriebsnachweis.
Ein Dokument oder ein grüner Test beweist allein weder DSGVO-Konformität noch
Informationssicherheit.

## Statusregeln

- `PASS`: Nachweis liegt verlinkt und aktuell vor.
- `OPEN`: Umsetzung oder belastbarer Nachweis fehlt, aber kein unmittelbarer
  Startblocker für anonymisierte Testdaten.
- `BLOCKER`: Vor Echtdaten oder Produktionsfreigabe zwingend zu schließen.
- `N/A`: begründet nicht anwendbar; Begründung und Freigebender sind dokumentiert.

Ein Punkt darf nur mit Beleg, Datum und Verantwortlichem auf `PASS` wechseln.

## Gate A – Produkt- und Datenfreigabe

| Status | Kontrolle | Erforderlicher Nachweis |
| --- | --- | --- |
| BLOCKER | Verantwortlicher, Auftragsverarbeiter und Rollen sind geklärt | unterschriebene Rollen-/Vertragsmatrix |
| BLOCKER | Datenarten und Schutzbedarf sind vollständig klassifiziert | Dateninventar je Feld und Quelle |
| BLOCKER | Rechtsgrundlage, Zweckbindung und Betroffenenrechte sind geprüft | Freigabe Datenschutzbeauftragter/Rechtsberatung |
| BLOCKER | AVV/DPA und Unterauftragnehmer sind geklärt, falls erforderlich | Verträge und aktuelle Subprozessorenliste |
| BLOCKER | Lösch-, Berichtigungs-, Auskunfts- und Exportweg sind getestet | Testprotokolle mit Fristen und Owner |
| OPEN | Datenschutz-Folgenabschätzung ist bewertet | dokumentierte Entscheidung; ggf. abgeschlossene DSFA |
| BLOCKER | Produktivdaten sind von Demo-, Test- und Supportdaten getrennt | Umgebungs- und Zugriffsbeleg |
| BLOCKER | Besondere Kategorien und Geheimnisse sind ausgeschlossen oder gesondert freigegeben | Datenklassifikation und technische Sperre |

Bis Gate A geschlossen ist, dürfen nur synthetische oder wirksam anonymisierte
Daten verwendet werden. Pseudonymisierte Daten bleiben grundsätzlich
schutzbedürftig und sind nicht automatisch Testdaten.

## Gate B – Identität, Mandanten und Geheimnisse

| Status | Kontrolle | Erforderlicher Nachweis |
| --- | --- | --- |
| BLOCKER | Echte Benutzeranmeldung und Sitzungsbeendigung | positive und negative Authentifizierungstests |
| BLOCKER | Rollen `Owner`, `Bearbeiter`, `Betrachter` oder projektspezifische Entsprechungen | Autorisierungsmatrix und Browser-/API-Tests |
| BLOCKER | Mandanten- und Projektgrenzen sind serverseitig erzwungen | Cross-Tenant-Negativtests |
| BLOCKER | Adminoberflächen sind nicht allein durch Unauffindbarkeit geschützt | Zugriffstest ohne/mit falscher Rolle |
| BLOCKER | Secrets liegen außerhalb von Git, Logs, Exporten und Browserpersistenz | Secret-Inventar und Scanbeleg |
| OPEN | MFA für privilegierte Konten | IdP-/Zugriffsbeleg |
| OPEN | Joiner/Mover/Leaver-Prozess | Entzugstest und dokumentierter Owner |

Der aktuelle Repositorystand enthält eine V1-Implementierung für Anmeldung,
Rollen und Mandantentrennung. Ein grüner Modultest ist aber noch kein
Produktionsnachweis für Browser-Tokenhandling, Secret Store, Deployment und
Cross-Tenant-Betrieb. Diese Punkte bleiben deshalb bis zum Staging- und
Betriebsbeleg BLOCKER.

## Gate C – Anwendungssicherheit

| Status | Kontrolle | Erforderlicher Nachweis |
| --- | --- | --- |
| OPEN | Produktionsabhängigkeiten ohne bekannte hohe/kritische Findings | grünes CI-Audit plus dokumentierte Ausnahmen |
| BLOCKER | Eingaben, Importe, URLs und Events werden fail-closed validiert | Contract-/Missbrauchstests |
| BLOCKER | Rate Limits und Größenlimits an öffentlichen Endpunkten | Last-/Negativtest |
| BLOCKER | TLS, Security Header, CORS und WebSocket-Origin produktiv geprüft | externer Scan aus Produktion |
| BLOCKER | Logs enthalten keine Tokens, Secrets oder unnötige Inhaltsdaten | Stichprobe und Redaction-Test |
| OPEN | Bedrohungsmodell für Studio, Runtime, Realtime und Export | freigegebene Threat-Model-Version |
| OPEN | Unabhängiger Security Review/Pentest vor breitem Rollout | Bericht und geschlossene kritische Findings |
| OPEN | Abhängigkeiten und Actions werden regelmäßig aktualisiert | Dependabot/Updateprotokoll |

## Gate D – Betrieb, Backup und Wiederanlauf

| Status | Kontrolle | Erforderlicher Nachweis |
| --- | --- | --- |
| BLOCKER | Getrennte Staging- und Produktionsumgebung | Deployment- und Datenflussnachweis |
| BLOCKER | GitHub Pages veröffentlicht ausschließlich das geprüfte Actions-Artefakt, nicht direkt `main` | Screenshot/Settings-Nachweis plus Release-Run |
| BLOCKER | Pages-Artefakt enthält nur Root-Runtime, öffentlichen lokalen Editor und deren statische Assets; kein Server-, Test-, Admin- oder Betriebsartefakt | Artefaktliste, Negativproben und Root-/Editor-Smoke |
| BLOCKER | `main`, `release-*` und `production` sind durch Ruleset/Environment geschützt; nur Releaseworkflow hat engen Stamp-Bypass | Settings-Export und negativer Push-Test |
| BLOCKER | Persistierte Kundendaten sind inventarisiert und gesichert | Backupmatrix je Datenspeicher |
| BLOCKER | Verschlüsselung und Schlüsselverantwortung für Backups | Konfigurations-/Providerbeleg |
| BLOCKER | Restore in isolierter Umgebung erfolgreich | datiertes Restore-Protokoll |
| BLOCKER | Monitoring für Verfügbarkeit, Fehler, Kapazität und Zertifikate | Dashboard und Testalarm |
| BLOCKER | Alarmwege und Rufbereitschaft/Vertretung sind benannt | Eskalationsliste |
| OPEN | RPO/RTO sind vertraglich oder intern freigegeben | Serviceziel und Restore-Messung |
| OPEN | Notfallbetrieb und kontrollierte Abschaltung sind geprobt | Übungsprotokoll |

Ein Health-Endpunkt ist hilfreich, ersetzt aber weder externes Monitoring noch
Alarmierung oder einen Wiederherstellungstest. Das verbindliche Verfahren steht
in [`backup-restore-runbook.md`](backup-restore-runbook.md).

Der Repositorystand erzwingt bereits nicht verschachtelte Daten-/Backuppfade,
ein vorab vorhandenes Backupziel auf einem anderen Dateisystemgerät, einen aus
einem externen wiederherstellbaren Secret Store bereitgestellten mindestens 32
Zeichen langen Signaturschlüssel, signierte Manifeste,
Digestprüfung aller unveränderlichen Versionen, mandantenisolierten atomaren
Restore und Sessionwiderruf. Diese technische Umsetzung schließt die
betrieblichen BLOCKER nicht automatisch: externer verschlüsselter Speicher,
Schlüsselverantwortung und ein datiertes Restore-Protokoll aus Staging müssen
weiterhin als reale Nachweise vorliegen.

## Gate E – Support und Incident Response

| Status | Kontrolle | Erforderlicher Nachweis |
| --- | --- | --- |
| BLOCKER | Supportowner, Vertretung und Kontaktkanal sind benannt | Pilot-Steckbrief |
| BLOCKER | Schweregrade und Eskalationsweg sind mit dem Kunden abgestimmt | Abnahme des Supportplans |
| BLOCKER | Security-/Datenschutzvorfälle erreichen sofort die richtigen Rollen | Testalarm mit Zeitstempeln |
| BLOCKER | Kontakt zu Datenschutz, Recht, Hosting und Kunde ist aktuell | Kontaktliste, quartalsweise bestätigt |
| OPEN | Statuskommunikation und Vorlagen sind vorbereitet | freigegebene Vorlagen |
| OPEN | Postmortem-Prozess und Maßnahmenverfolgung | Beispiel-/Übungsprotokoll |

Verfahren: [`support-runbook.md`](support-runbook.md) und
[`incident-runbook.md`](incident-runbook.md).

## Freigabeprotokoll

Vor jedem Pilot mit Echtdaten wird eine Kopie dieser Tabelle mit folgenden
Angaben abgelegt:

```text
Pilot / Release:
Prüfdatum:
Freigegebene Datenklassen:
Offene OPEN-Punkte mit Risikoentscheidung:
BLOCKER: 0
Produktverantwortung:
Technische Betriebsverantwortung:
Informationssicherheit:
Datenschutz/Recht:
Kundenseitiger Sponsor:
Nächster Reviewtermin:
```

Ein BLOCKER kann nicht durch eine pauschale Risikoakzeptanz des Entwicklungsteams
geschlossen werden. Die jeweils zuständige Rolle muss die konkrete Kontrolle
nachweisbar freigeben.
