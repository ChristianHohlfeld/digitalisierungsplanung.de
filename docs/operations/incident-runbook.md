# Incident-Runbook

Status: verbindliches Verfahren; Kontakte und Meldepflichten werden je Pilot
ergänzt

Stand: 2026-07-15

## Schweregrade

| Grad | Beispiel | Reaktion |
| --- | --- | --- |
| P0 Kritisch | bestätigter unberechtigter Zugriff, aktiver Angriff, umfassender Datenverlust | sofort stoppen/eindämmen und Krisenteam aktivieren |
| P1 Hoch | mögliche Mandantenverletzung, erhebliche Datenkorruption, Kernprozess nicht nutzbar | sofortige Triage, Pilot ggf. pausieren |
| P2 Mittel | Teilfunktion gestört, kontrollierter Workaround vorhanden | priorisiert im Supportfenster bearbeiten |
| P3 Niedrig | kosmetisch, Frage oder Verbesserung | Backlog/normaler Support |

Reaktionszeiten sind operative Ziele, noch keine vertraglichen SLA. Vertragliche
Zusagen werden nur gemacht, wenn Besetzung und Messung nachgewiesen sind.

## Pflichtrollen

Vor Livegang mit Name, sicherem Kontaktweg und Vertretung befüllen:

- Incident Lead,
- technischer Operator,
- Product Owner,
- Informationssicherheit,
- Datenschutzbeauftragter/Rechtsberatung,
- kundenseitiger Sponsor/Prozessowner,
- Hosting-/Infrastrukturkontakt und
- Kommunikationsverantwortlicher.

## Ablauf

1. **Erkennen und protokollieren:** Zeitpunkt, Melder, Symptome, betroffene
   Umgebung, Release-ID und erste Datenklassen festhalten.
2. **Einstufen:** P0–P3, Unsicherheit ausdrücklich notieren; im Zweifel höher.
3. **Eindämmen:** gefährliche Verarbeitung stoppen, Zugang/Token sperren oder
   Pilot pausieren. Beweise nicht durch hektische Bereinigung zerstören.
4. **Sichern:** relevante Logs, Konfiguration, Hashes und Zeitleiste
   zugriffsgeschützt erfassen. Nur notwendige personenbezogene Daten kopieren.
5. **Untersuchen:** Ursache, Reichweite, betroffene Personen/Mandanten,
   Datenintegrität und fortbestehendes Risiko bestimmen.
6. **Melden/kommunizieren:** Datenschutz und Recht entscheiden über anwendbare
   gesetzliche oder vertragliche Meldungen und Fristen. Keine pauschale
   Entwarnung ohne belastbare Fakten.
7. **Beheben und wiederherstellen:** kleinste sichere Korrektur, vollständige
   Prüfung, ggf. Restore, fachliche Datenkontrolle.
8. **Freigeben:** Incident Lead, Technik und zuständige Fach-/Datenschutzrollen
   bestätigen die Wiederaufnahme.
9. **Nachbereiten:** innerhalb des vereinbarten Zeitfensters ursachenorientiertes
   Postmortem, Maßnahmen mit Owner/Termin und Wirksamkeitsprüfung.

## Mindestprotokoll

```text
Incident-ID / Schweregrad:
Start / erkannt / eingedämmt / behoben / geschlossen:
Betroffene Releases, Umgebungen, Mandanten und Datenklassen:
Bekannte Fakten:
Noch unbestätigte Annahmen:
Sofortmaßnahmen:
Entscheidungen mit Entscheider und Zeitpunkt:
Externe/interne Kommunikation:
Rechtliche Bewertung durch:
Wiederherstellungs- und Datenintegritätsnachweis:
Root Cause:
Korrektur- und Präventionsmaßnahmen:
```

## Kommunikationsregel

- Fakten, Auswirkung, aktuelle Maßnahme und nächstes Update nennen.
- Keine Schuldzuweisung, Spekulation oder unnötigen personenbezogenen Details.
- Keine Sicherheitsdetails öffentlich machen, die laufende Eindämmung gefährden.
- Interne und kundenseitige Zeitlinie konsistent halten.

Sicherheitsmeldungen von außen folgen zusätzlich [`SECURITY.md`](../../SECURITY.md).
