# Managed-Pilot-API

Status: V1-Vertrag für kontrollierte Piloten; kein Ersatz für die
Produktionsfreigabe

Stand: 2026-07-15

Die API ergänzt den Realtime-Transport um serverseitige Anmeldung,
Organisationstrennung, Rollen, Projekte, unveränderliche Projektversionen,
Auditnachweise und organisationseigene Backups. Persistiert wird der kanonische
JSON-Prozessvertrag; die API definiert keine zweite State-Machine-Semantik.

Vor Echtdaten bleiben die Gates in
[`operations/production-readiness.md`](operations/production-readiness.md)
verbindlich. Insbesondere müssen Storage, Secret-Verwaltung, Monitoring,
verschlüsselte externe Sicherung und Restore betrieblich nachgewiesen werden.

## Basis und Authentifizierung

```text
Base path: /api/v1
Authorization: Bearer <session-token>
Content-Type for request bodies: application/json
```

Sessiontokens werden nur beim Login ausgegeben und serverseitig als Hash
gespeichert. Passwörter werden mit scrypt und individuellem Salt
gespeichert. Der Client muss Tokens gegen Scriptzugriff und Weitergabe schützen;
die aktuelle Bearer-API allein beweist noch keine sichere Browserintegration.

`PILOT_BOOTSTRAP_TOKEN` ist ein separates Provisioning-Secret mit mindestens 32
Zeichen. Es darf weder im Client, Repository, normalen Log noch Supportticket
liegen. Nach initialer Provisionierung bleibt es nur verfügbar, wenn weitere
Organisationen kontrolliert angelegt werden sollen.

## Rollen

| Fähigkeit | owner | editor | viewer |
| --- | ---: | ---: | ---: |
| eigene Organisation/Projekte lesen | Ja | Ja | Ja |
| Projekte/Versionen erstellen und ändern | Ja | Ja | Nein |
| Version wiederherstellen | Ja | Ja | Nein |
| Benutzer und Rollen verwalten | Ja | Nein | Nein |
| Organisation ändern | Ja | Nein | Nein |
| Audit lesen, Organisationsbackup erstellen/wiederherstellen | Ja | Nein | Nein |

Jede Projekt-, Versions-, Audit- und Backupoperation wird serverseitig an die
Organisation der authentifizierten Session gebunden. Fremde IDs dürfen keine
Mandantendaten offenlegen.

## Routen

| Methode | Route | Zweck / Rolle |
| --- | --- | --- |
| `GET` | `/readyz` | Speicher- und Provisioning-Readiness |
| `GET` | `/pilot-admin.html` | Bootstrap-/Provisioning-Onboarding; Operator-Zugriffsgate erforderlich |
| `GET` | `/studio.html` | Studio-Einstieg; Zugriffsgate vor Produktion erforderlich |
| `GET` | `/api/v1/health` | gleiche fachliche Readiness unter dem API-Präfix |
| `POST` | `/api/v1/bootstrap` | erste Organisation + Owner; Bootstrap-Token |
| `POST` | `/api/v1/organizations/provision` | weitere Organisation + Owner; Bootstrap-Token |
| `POST` | `/api/v1/auth/login` | Session anlegen |
| `POST` | `/api/v1/auth/logout` | aktuelle Session beenden |
| `GET` | `/api/v1/auth/me` | aktuelle Identität, Organisation und Session |
| `POST` | `/api/v1/auth/password` | eigenes Passwort ändern |
| `GET/PATCH` | `/api/v1/organization` | Organisation lesen / als Owner ändern |
| `GET/POST` | `/api/v1/users` | Benutzer auflisten/anlegen; Owner |
| `PATCH/DELETE` | `/api/v1/users/:userId` | Benutzer ändern/deaktivieren; Owner |
| `GET/POST` | `/api/v1/projects` | Projekte auflisten/anlegen |
| `GET/PATCH/DELETE` | `/api/v1/projects/:projectId` | Projekt lesen/ändern/soft löschen |
| `GET/POST` | `/api/v1/projects/:projectId/versions` | Versionen auflisten/anlegen |
| `GET` | `/api/v1/projects/:projectId/versions/:versionId` | Version mit Modell lesen |
| `POST` | `/api/v1/projects/:projectId/restore` | alte Version als neue Version wiederherstellen |
| `GET` | `/api/v1/projects/:projectId/export` | vollständiger Projekt-JSON-Export |
| `GET` | `/api/v1/audit?after=0&limit=100` | sequenzielles Audit; Owner |
| `GET/POST` | `/api/v1/backups` | Organisationsbackups listen/anlegen; Owner |
| `POST` | `/api/v1/backups/:backupId/restore` | Organisationsbackup prüfen oder atomar wiederherstellen; Owner |

Unbekannte JSON-Felder, falscher Content-Type, übergroße Payloads, zu tiefe
Modelle und nicht erlaubte Origins werden abgelehnt. Login/Provisioning und
übrige API-Aufrufe besitzen getrennte Rate-Limits.

## Versionen und konkurrierende Änderungen

Eine Projektänderung überschreibt kein bestehendes Modell. `POST .../versions`
erzeugt eine neue unveränderliche Version. Schreibende Clients senden
`expectedCurrentVersionId`; wenn zwischen Lesen und Speichern eine andere
Version aktuell wurde, antwortet der Server mit einem Konflikt statt still zu
überschreiben.

Restore ist ebenfalls additiv: Eine alte Version wird als Quelle einer neuen
Version verwendet. Dadurch bleibt die Historie nachvollziehbar.

## Speicher und Backup

Der V1-Store liegt in `PILOT_DATA_DIR`; Produktion muss dafür einen expliziten,
persistenten Pfad verwenden. Backups liegen getrennt in `PILOT_BACKUP_DIR` und
werden mit `PILOT_BACKUP_SIGNING_KEY` durch ein HMAC-signiertes Manifest
geschützt. Datenbank, Backup und Manifest werden atomar mit restriktiven
Dateirechten geschrieben. Der operative Backupjob:

```bash
PILOT_DATA_DIR=/var/lib/digitalisierungsplanung-pilot \
PILOT_BACKUP_DIR=/mnt/pilot-backups \
PILOT_BACKUP_SIGNING_KEY='<mindestens-32-stelliges-secret>' \
npm run pilot:backup
```

Optional begrenzt `PILOT_ORGANIZATION_ID` den Lauf auf eine Organisation. Die
Sicherung enthält nur den ausgewählten Mandanten. Listen, Inspektion und
Restore verifizieren Manifest, Nutzdaten-Hash und den vollständigen
Versions-Digest-Vertrag. Ein Restore ersetzt atomar ausschließlich den
ausgewählten Mandanten, erhält andere Mandanten, beendet dessen vorhandene
Sessions und dokumentiert die Wiederherstellung im Audit. Vor dem echten Lauf
sind `expectedDatabaseRevision` und die exakte Bestätigung
`RESTORE <backup-id>` erforderlich; `dryRun: true` prüft denselben Vertrag ohne
Mutation.

Ein signiertes lokales Backup ist noch kein ausreichender Offsite-Schutz.
Physische Trennung, Verschlüsselung, Aufbewahrung, Löschung, Alarmierung und der
isolierte Restore-Nachweis folgen dem
[`operations/backup-restore-runbook.md`](operations/backup-restore-runbook.md).

## Wesentliche Konfiguration

| Variable | Zweck |
| --- | --- |
| `PILOT_ENABLED` | API kontrolliert ein-/ausschalten |
| `PILOT_API_PREFIX` | Standard `/api/v1` |
| `PILOT_ADMIN_PATH` | Pfad der internen Provisioning-Oberfläche |
| `PILOT_STUDIO_PATH` | Pfad des kontrollierten Studio-Einstiegs |
| `PILOT_DATA_DIR` | expliziter persistenter Speicherpfad |
| `PILOT_BACKUP_DIR` | vorab gemountetes Sicherungsdateisystem auf einem anderen Gerät als `PILOT_DATA_DIR` |
| `PILOT_REQUIRE_EXTERNAL_BACKUP` | in Produktion `true`; verhindert Start ohne externes Sicherungsdateisystem |
| `PILOT_BACKUP_SIGNING_KEY` | HMAC-Schlüssel für Backupmanifeste; mindestens 32 Zeichen |
| `PILOT_BOOTSTRAP_TOKEN` | Provisioning-Secret |
| `PILOT_SESSION_TTL_MS` | Sessionlebensdauer |
| `PILOT_MAX_JSON_BYTES` | Requestgrößenlimit |
| `PILOT_MAX_PROJECTS_PER_ORGANIZATION` | harte Projektobergrenze je Organisation |
| `PILOT_MAX_VERSIONS_PER_PROJECT` | harte Versionsobergrenze je Projekt |
| `PILOT_MAX_TENANT_BYTES` | harte Obergrenze der gespeicherten Mandantendaten |
| `PILOT_RATE_WINDOW_MS` | Rate-Limit-Zeitfenster |
| `PILOT_RATE_LIMIT` | allgemeines Requestlimit |
| `PILOT_LOGIN_RATE_LIMIT` | strengeres Login-/Provisioninglimit |

Änderungen an Schema, Rollen oder Mandantengrenzen brauchen Migration,
Negativtests, Staging-Restore und einen normalen vollständig geprüften Release.
