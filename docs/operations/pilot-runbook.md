# Managed-Pilot-Runbook

Status: Arbeits- und Abnahmeverfahren für einen bezahlten V1-Pilot

Stand: 2026-07-15

## 1. Pilot-Steckbrief

Vor Beginn wird genau ein Steckbrief geführt:

```text
Kunde / Organisation:
Prozessname und eindeutige Grenze:
Sponsor:
Prozessowner:
Interner Product Owner:
Technischer Operator + Vertretung:
Supportkanal und Supportfenster:
Pilotnutzer / Rollen:
Start / Ende:
Zulässige Datenklassen:
Explizit ausgeschlossene Daten und Systeme:
Baseline-Zeitraum:
Zielkennzahlen und Schwellen:
Stop-Kriterien:
Export-/Löschtermin nach Ende:
```

## 2. Phasen und Gates

### Phase A – Qualifizierung

- Ein Prozess, ein Owner und ein messbares Problem sind vorhanden.
- Start, Ende, Regelweg und wichtigste Ausnahmen sind benannt.
- Fallvolumen und Baseline sind messbar.
- Keine kritische Fremdsystemänderung wird still vorausgesetzt.
- Budget, Zeitraum und Entscheider sind geklärt.

Ergebnis: unterschriebener Pilot-Scope oder Stop.

### Phase B – Aufnahme und Baseline

- Fünf bis zehn reale, anonymisierte Beispielfälle durchgehen.
- Ist-Zeit, Wartezeit, Übergaben, Nacharbeit und fehlende Nachweise erfassen.
- Rollen und Entscheidungspunkte bestätigen.
- Sollprozess und bewusst nicht gelöste Ausnahmen abnehmen.

Ergebnis: freigegebenes Modell, Testfälle und Baseline-Datensatz.

### Phase C – Build und interne Prüfung

- Prozessmodell ausschließlich im internen Studio erstellen.
- Pure Vertrags-, Export- und relevante Browserfälle ausführen.
- Berechtigungen und Fehlerpfade mit Negativtests prüfen.
- Keine Echtdaten in lokale Demo- oder PR-Umgebungen kopieren.

Ergebnis: releasefähiger Kandidat mit Testprotokoll.

### Phase D – Staging-Abnahme

- Alle Muss-Testfälle mit Prozessowner durchspielen.
- Rollen-/Mandantengrenzen und Export testen.
- Supportalarm, Incident-Eskalation und Restore proben.
- Produktionsreife-Check ohne BLOCKER abschließen.

Ergebnis: dokumentiertes Go, Change oder Stop.

### Phase E – Kontrollierter Live-Pilot

- Nutzer in einer kurzen, rollenbezogenen Einführung schulen.
- Kleinste sinnvolle Kohorte starten; erst danach erweitern.
- In der ersten Woche täglicher Betriebscheck, danach mindestens wöchentlich.
- Fehler, Ausnahmen, Workarounds und Änderungswünsche getrennt erfassen.
- Scope-Änderungen nur nach der Regel in
  [`managed-pilot-v1.md`](../product/managed-pilot-v1.md).

Ergebnis: belastbare Nutzungs- und Ergebnisdaten.

### Phase F – Entscheidung und Exit

- Kennzahlen gegen Baseline und vereinbarte Schwellen auswerten.
- Nutzer- und Ownerfeedback getrennt dokumentieren.
- Offene Risiken, Betriebsaufwand und Folgekosten benennen.
- Entscheidung: skalieren, gezielt ändern, verlängern oder beenden.
- Export, Übergabe, Aufbewahrung und Löschung protokollieren.

## 3. Abnahmefälle

Mindestens folgende Fallklassen sind vor Livegang erfolgreich:

1. vollständiger Regelweg,
2. zulässige alternative Entscheidung,
3. fehlende Pflichtangabe,
4. doppelte oder verspätete Aktion,
5. nicht berechtigter Zugriff,
6. Wechsel zwischen zwei Mandanten/Projekten als Negativtest,
7. Netzwerk-/Integrationsfehler,
8. Wiederaufnahme nach Unterbrechung,
9. Export und kontrollierte Löschung sowie
10. Wiederherstellung eines gesicherten Projektstands.

Jeder Fall enthält Eingabe, erwartetes Ergebnis, tatsächliches Ergebnis,
Release-ID, Browser/Gerät, Prüfer, Datum und Beleg.

## 4. Erfolgskennzahlen

Schwellen werden vor Buildbeginn vertraglich festgelegt. Ohne Baseline ist eine
Verbesserungszahl nur eine Vermutung.

| Kennzahl | Berechnung |
| --- | --- |
| Abschlussquote | abgeschlossene geeignete Fälle / gestartete geeignete Fälle |
| Durchlaufzeit | Median Ende minus Start; Baseline und Pilot getrennt |
| Aktive Bearbeitungszeit | dokumentierte Arbeitszeit je abgeschlossenem Fall |
| Nachweisvollständigkeit | Fälle mit allen Muss-Nachweisen / abgeschlossene Fälle |
| Nacharbeitsquote | Fälle mit vermeidbarer Korrekturschleife / abgeschlossene Fälle |
| Adoption | wöchentlich aktive eingeladene Nutzer / eingeladene Pilotnutzer |
| Ausnahmequote | manuell außerhalb der App gelöste Fälle / geeignete Fälle |
| Zuverlässigkeit | erfolgreiche synthetische Checks / ausgeführte Checks |
| Supportlast | Tickets und Operatorzeit je 100 Fälle |

Zusätzlich gilt als Mindestbedingung: kein ungelöster schwerer Sicherheits-,
Datenschutz- oder Datenintegritätsvorfall. Konkrete Prozent- und Zeitziele
gehören in den Pilot-Steckbrief, nicht als unbelegte allgemeine Werbeaussage in
das Produkt.

## 5. Wöchentlicher Pilotreview

- Fälle, Quote und Datenqualität seit letztem Review,
- technische Fehler und Supportlast,
- Prozessausnahmen versus Softwarefehler,
- Nutzerfeedback nach Rolle,
- Risiken und Stop-Kriterien,
- maximal drei priorisierte Maßnahmen mit Owner und Termin.

## 6. Stop-Kriterien

Der Pilot wird pausiert, wenn unberechtigter Datenzugriff, vermuteter
Datenverlust, falsche Mandantenzuordnung, unkontrollierte Folgeaktionen oder ein
anderer P0/P1-Fall möglich ist. Fortsetzung erst nach Incident-Triage,
Korrektur, erneuter Abnahme und dokumentiertem Go.
