# Backup- und Restore-Runbook

Status: implementiertes Verfahren; ein dokumentierter erfolgreicher Restore ist vor Echtdaten Pflicht

Stand: 2026-07-15

## Grundsatz

Ein Backup existiert betrieblich erst, wenn es vollständig, geschützt,
überwacht und erfolgreich wiederhergestellt wurde. Git ersetzt kein Backup von
Kunden- oder Laufzeitdaten.

## Technischer Vertrag

- `PILOT_BACKUP_DIR` existiert vor dem Deployment auf einem getrennten,
  restriktiv gemounteten Dateisystemgerät außerhalb von `PILOT_DATA_DIR`. Das
  Deployment legt diesen Pfad niemals ersatzweise auf der Root-Platte an.
- `PILOT_BACKUP_SIGNING_KEY` enthält mindestens 32 zufällige Bytes aus einem
  externen, wiederherstellbaren Secret Store, liegt niemals im Backup und ist
  unabhängig vom Anwendungshost escrowed. Das Deployment erzeugt ihn nicht.
- Jede Sicherung besitzt ein getrenntes HMAC-signiertes Manifest. Auflisten, Prüfen und Wiederherstellen brechen bei Payload-, Digest- oder Manifestmanipulation ab.
- Modellversionen werden beim Datenbankstart und vor Restore erneut gegen ihren SHA-256-Digest geprüft.
- Restore ersetzt ausschließlich den gewählten Mandanten atomar, lässt andere Mandanten unangetastet, protokolliert `backup.restore` und widerruft sämtliche Sitzungen dieses Mandanten.

```bash
# Signiertes Backup
PILOT_BACKUP_ACTION=backup \
PILOT_DATA_DIR=/var/lib/digitalisierungsplanung-pilot \
PILOT_BACKUP_DIR=/mnt/digitalisierungsplanung-pilot-backups \
PILOT_BACKUP_SIGNING_KEY="$PILOT_BACKUP_SIGNING_KEY" \
npm run pilot:backup

# Integritätsprüfung / Dry Run
PILOT_BACKUP_ACTION=inspect PILOT_ORGANIZATION_ID=org_... PILOT_BACKUP_ID=backup_... npm run pilot:backup
PILOT_BACKUP_ACTION=restore PILOT_ORGANIZATION_ID=org_... PILOT_BACKUP_ID=backup_... \
PILOT_RESTORE_CONFIRM="RESTORE backup_..." PILOT_RESTORE_DRY_RUN=true npm run pilot:backup

# Bewusster atomarer Restore; anschließend ist eine neue Anmeldung erforderlich
PILOT_BACKUP_ACTION=restore PILOT_ORGANIZATION_ID=org_... PILOT_BACKUP_ID=backup_... \
PILOT_RESTORE_CONFIRM="RESTORE backup_..." npm run pilot:backup
```

Alle Befehle benötigen zusätzlich dieselben drei Speicher-/Schlüsselvariablen
wie das erste Beispiel und verweigern ein Backupziel auf demselben
Dateisystemgerät. Der Dry Run muss unmittelbar vor dem echten Restore
erfolgreich sein.

## Backupmatrix je Pilot

Für jeden Datenspeicher ausfüllen:

| Speicher | Inhalt/Schutzbedarf | Owner | Methode/Intervall | Aufbewahrung | Verschlüsselung/Schlüssel | Restore-Reihenfolge |
| --- | --- | --- | --- | --- | --- | --- |
| Prozessmodelle/Versionen | festlegen | benennen | festlegen | festlegen | belegen | festlegen |
| Mandanten-/Rollenconfig | festlegen | benennen | festlegen | festlegen | belegen | festlegen |
| Pilot-Falldaten | festlegen | benennen | festlegen | festlegen | belegen | festlegen |
| Audit-/Betriebsnachweise | festlegen | benennen | festlegen | festlegen | belegen | festlegen |
| Secrets | nicht als Klartextbackup | benennen | Secret-Store-Verfahren | festlegen | belegen | Rotation |

Nicht vorhandene persistente Speicher werden als `N/A` mit Begründung geführt;
das macht eine lokale Browserkopie jedoch nicht zu einer belastbaren
Projektablage.

## Mindestkontrollen

- Backups sind von der Produktionsberechtigung getrennt und gegen versehentliche
  Löschung geschützt.
- Verschlüsselung bei Übertragung und Speicherung sowie Schlüsselzugriff sind
  dokumentiert.
- Erfolg, Alter, Größe und Fehler werden überwacht und alarmiert.
- Aufbewahrung entspricht Zweck, Vertrag und Löschkonzept; „für immer“ ist kein
  Standard.
- Export, Backup, Log und Supportkopie werden bei Löschanforderungen gemeinsam
  betrachtet.
- Wiederherstellung erfolgt zuerst isoliert, nie ungeprüft über den laufenden
  Bestand.

## Restore-Probe

1. konkreten Sicherungszeitpunkt und erwartete Release-/Schema-Version wählen,
2. neue isolierte Zielumgebung bereitstellen,
3. Backupintegrität und Entschlüsselungszugriff prüfen,
4. Daten in dokumentierter Reihenfolge wiederherstellen,
5. Migrationen nur nach passendem Runbook ausführen,
6. Objektzahlen, Referenzen, Mandantengrenzen und Stichproben fachlich prüfen,
7. einen vollständigen synthetischen Prozessfall ausführen,
8. gemessenes RPO/RTO sowie Abweichungen protokollieren und
9. Testdaten/temporäre Schlüssel nach Freigabe kontrolliert entfernen.

Die Probe erfolgt vor dem ersten Echtdatenpilot, nach grundlegender
Speicher-/Migrationsänderung und danach in der freigegebenen betrieblichen
Frequenz. Zielwerte sind erst SLA, wenn sie vertraglich vereinbart und durch
Messungen tragfähig sind.

## Restoreprotokoll

```text
Pilot / Umgebung:
Backup-ID und Zeitpunkt:
Anlass (Probe/Incident):
Start / technisch fertig / fachlich freigegeben:
Wiederhergestellter Stand:
RPO gemessen:
RTO gemessen:
Integritätsprüfungen:
Mandantengrenztest:
Abweichungen und Maßnahmen:
Technische Freigabe:
Fachliche Freigabe:
```
