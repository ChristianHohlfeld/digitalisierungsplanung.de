# Managed Pilot V1

Status: verbindliche Produktgrenze für den ersten Verkauf

Stand: 2026-07-16

## Produktversprechen

Digitalisierungsplanung stellt den Editor in V1 als öffentliche, lokale Sandbox
bereit. Verkauft wird nicht der bloße Zugang zum Editor, sondern ein
überprüfbares Ergebnis:

> Ein gemeinsam abgegrenzter Unternehmensprozess wird innerhalb eines
> Managed Pilots als bedienbare, testbare Web-Anwendung umgesetzt und anhand
> vorher vereinbarter Kennzahlen im echten Arbeitsablauf bewertet.

`state.html` ist der öffentliche Editor für lokale Modelle und synthetische
Demos. Kunden arbeiten zusätzlich mit der veröffentlichten Prozess-App und
erhalten Ergebnis, Dokumentation und einen vollständigen Export ihres
Prozessmodells. Verwaltete Kundenprojekte, Admin- und Integrationsoberflächen
bleiben an Anmeldung, Rolle und Mandantengrenze gebunden.

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

Die folgende Matrix regelt verwaltete Kundenprojekte und deren Daten. Im
öffentlichen lokalen Editor können Modellierungsfunktionen einschließlich
Composite-/Boundary-Bausteinen ausprobiert werden; daraus entsteht keinerlei
Zugriff auf ein verwaltetes Projekt.

| Fähigkeit | Pilotnutzer | Kunden-Prozessowner | Interner Operator |
| --- | ---: | ---: | ---: |
| Veröffentlichte Prozess-App bedienen | Ja | Ja | Ja |
| Öffentlichen Editor lokal verwenden | Ja | Ja | Ja |
| Pilotkennzahlen und vereinbarte Exporte | nach Rolle | Ja | Ja |
| Prozessänderung beauftragen/freigeben | Nein | Ja | Ja |
| Verwaltetes Projekt im Studio bearbeiten | Nein | nach Rolle | Ja |
| Composite-/Boundary-Interna im Managed-Projekt | Nein | Nein | Ja |
| Realtime-Event-Designer | Nein | Nein | Ja |
| Preset-Import und Preset-Admin | Nein | Nein | Ja |
| MCP/API-Entwicklerwerkzeuge | Nein | Nein | Ja |
| Deployment und Secrets | Nein | Nein | Ja, Least Privilege |

Der öffentliche Editor speichert nur lokale Browsermodelle und erhält durch
seine URL weder Sitzung noch Zugriff auf ein verwaltetes Projekt. Der operative
Studio-Einstieg zeigt ohne gültige Sitzung keine Projekt- oder Kundendaten;
jede Managed-Datenaktion wird zusätzlich serverseitig autorisiert. Öffentliche
Erreichbarkeit der Editor-Shell ist ausdrücklich keine Autorisierung.

## Bewusst nicht Teil von V1

- freier Self-Service-Sign-up,
- gehosteter Multi-Tenant-Self-Service mit Echtdaten ohne Pilotvertrag,
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
