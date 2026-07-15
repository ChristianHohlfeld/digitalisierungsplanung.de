# Managed Pilot V1

Status: verbindliche Produktgrenze für den ersten Verkauf

Stand: 2026-07-15

## Produktversprechen

Digitalisierungsplanung verkauft in V1 **nicht den universellen Editor als
Self-Service-SaaS**. Verkauft wird ein überprüfbares Ergebnis:

> Ein gemeinsam abgegrenzter Unternehmensprozess wird innerhalb eines
> Managed Pilots als bedienbare, testbare Web-Anwendung umgesetzt und anhand
> vorher vereinbarter Kennzahlen im echten Arbeitsablauf bewertet.

Das Studio (`state.html`) ist die interne Produktionsmaschine. Kunden arbeiten
mit der veröffentlichten Prozess-App und erhalten Ergebnis, Dokumentation und
einen vollständigen Export ihres Prozessmodells. Studio-, Admin- und
Integrationsoberflächen sind keine regulären Kundenoberflächen.

## Kommerzieller Rahmen

Das öffentliche V1-Angebot hat genau eine Form:

| Merkmal | Rahmen |
| --- | --- |
| Angebot | Managed Pilot für einen abgegrenzten Prozess |
| Preis | einmalig **2.500–7.500 €** |
| Dauer | typischerweise **6–12 Wochen** |
| Beauftragung | erst nach Qualifizierung von Ziel, Umfang, Mitwirkung und Abnahme |
| Abrechnung | vertraglich vereinbarter Festpreis; keine automatische Zahlung |

Der Rahmen ist kein Online-Checkout und kein automatisch aktivierbares Abo.
Der verbindliche Festpreis und die verbindliche Dauer werden aus dem
qualifizierten Prozessumfang abgeleitet und im Pilotvertrag festgehalten.

## Idealer erster Anwendungsfall

Ein wiederkehrender, heute über E-Mail, Telefon, Papier oder Excel koordinierter
Prozess mit:

- einem benannten Prozessverantwortlichen,
- klar erkennbarem Start und Ende,
- wenigen beteiligten Rollen,
- regelmäßigem Nachweis-, Status- oder Eskalationsbedarf,
- ausreichendem Fallvolumen für einen Vorher-/Nachher-Vergleich und
- keinem unkontrollierbaren Eingriff in sicherheitskritische Systeme.

Für den Markteintritt wird ein Prozess aus Wohnungswirtschaft,
Objektbetreuung, Reinigung oder Dienstleistersteuerung bevorzugt. Ein Pilot
digitalisiert genau **einen** abgegrenzten Prozess, nicht eine ganze Organisation.

## Lieferumfang

| Ergebnis | V1-Lieferung |
| --- | --- |
| Prozessaufnahme | Ist-Ablauf, Ziel, Rollen, Ausnahmen und Messbasis |
| Prozessmodell | Versioniertes, validiertes Zustandsmodell |
| Prozess-App | Responsive Web-Anwendung für den vereinbarten Ablauf |
| Abnahme | Testfälle, Testprotokoll und dokumentierte Restpunkte |
| Pilotbetrieb | Kontrollierter Nutzerkreis, Support und Betriebsbeobachtung |
| Auswertung | Kennzahlen, Nutzerfeedback und Go/Change/Stop-Entscheidung |
| Datenhoheit | Export des Prozessmodells und der vereinbarten Kundendaten |
| Übergabe | Bedien-, Betriebs- und Änderungsdokumentation im vereinbarten Umfang |

Der konkrete Vertrag legt Laufzeit, Nutzerkreis, Datenarten, Umgebungen,
Supportfenster, Integrationen und Änderungsbudget fest. Ohne diese Festlegung
gibt es keinen Start mit Echtdaten.

## Kundenoberfläche und interne Werkzeuge

| Fähigkeit | Pilotnutzer | Kunden-Prozessowner | Interner Operator |
| --- | ---: | ---: | ---: |
| Veröffentlichte Prozess-App bedienen | Ja | Ja | Ja |
| Pilotkennzahlen und vereinbarte Exporte | nach Rolle | Ja | Ja |
| Prozessänderung beauftragen/freigeben | Nein | Ja | Ja |
| Studio/Canvas bearbeiten | Nein | Nein in V1 | Ja |
| Composite-/Boundary-Interna | Nein | Nein | Ja |
| Realtime-Event-Designer | Nein | Nein | Ja |
| Preset-Import und Preset-Admin | Nein | Nein | Ja |
| MCP/API-Entwicklerwerkzeuge | Nein | Nein | Ja |
| Deployment und Secrets | Nein | Nein | Ja, Least Privilege |

„Nicht kunden-facing“ bedeutet: `state.html` wird nicht mit der öffentlichen
Pages-Site ausgeliefert, nicht in der öffentlichen Runtime verlinkt und nicht
durch eine bloß versteckte Schaltfläche geschützt. Der operative Studio-Einstieg
zeigt ohne gültige Sitzung keine Projekt- oder Kundendaten; jede Datenaktion
wird zusätzlich serverseitig autorisiert.

## Bewusst nicht Teil von V1

- freier Self-Service-Sign-up,
- visueller Universal-App-Builder für Endkunden,
- Marketplace oder öffentliche Pluginplattform,
- gleichzeitige Mehrbenutzerbearbeitung,
- freie Kundenerstellung eigener Trigger- oder Contract-Dialekte,
- unbeschränkte Individualentwicklung innerhalb der Pilotpauschale,
- Zahlungsabwicklung per Kreditkarte,
- Verfügbarkeits- oder Compliance-Zusagen ohne nachweisbaren Betrieb und
- Verarbeitung besonderer Kategorien personenbezogener Daten ohne gesonderte
  Freigabe durch Datenschutz und Informationssicherheit.

## Änderungsregel

Neue Wünsche landen zunächst im Pilot-Backlog. Sie kommen nur in die laufende
Lieferung, wenn sie für die vereinbarte Erfolgskennzahl erforderlich sind, das
Risiko bewertet ist und eine andere Aufgabe mit vergleichbarem Aufwand ersetzt
oder ein Change vereinbart wurde. Das Studio darf mehr können als das Produkt;
seine gesamte Funktionsmenge definiert nicht automatisch den Vertragsumfang.

## Eintrittskriterien für einen bezahlten Pilot

- Sponsor, Prozessowner und operativer Ansprechpartner sind benannt.
- Prozessgrenze, Nutzergruppe und Ausschlüsse sind schriftlich bestätigt.
- Baseline und Zielkennzahlen sind messbar festgelegt.
- Datenklassifikation, Rechtsgrundlage und Löschweg sind freigegeben.
- Die relevanten BLOCKER aus
  [`production-readiness.md`](../operations/production-readiness.md) sind
  geschlossen oder Echtdaten bleiben ausdrücklich ausgeschlossen.
- Abnahmefälle, Supportweg, Stop-Kriterien und Exit-/Exportweg sind bestätigt.
- Staging-Dry-Run und Wiederherstellungsnachweis sind erfolgreich.

## Definition of Done für V1

V1 ist nicht fertig, weil der Editor viele Funktionen besitzt. V1 ist fertig,
wenn ein Pilotprozess ohne Operator-Tricks reproduzierbar gebaut, geprüft,
freigegeben, betrieben, unterstützt, exportiert und kontrolliert beendet werden
kann. Der Nachweis erfolgt mit dem
[`pilot-runbook.md`](../operations/pilot-runbook.md), nicht durch eine Demo allein.
