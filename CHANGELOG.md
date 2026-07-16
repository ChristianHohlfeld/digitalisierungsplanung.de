# Changelog

Dieses Changelog dokumentiert Nutzer- und Operatorwirkung veröffentlichter
Releases. Einzelne Entwicklungscommits erhalten keinen künstlichen Releaseeintrag.

## Unreleased

- Der lokale Editor zeigt den Speicherhinweis kompakt in der Werkzeugleiste,
  ohne Arbeitsinhalte zu verdecken. Exakt unveränderte ältere Website-Beispiele
  werden auf die aktuelle Fassung migriert; bearbeitete Kundenmodelle bleiben
  unverändert. Die texttragende Share Card bleibt Social-Media-Metadatum und
  wird nicht mehr hinter dem Live-Hero-Text doppelt gerendert.
- Der visuelle Editor ist wieder direkt über die öffentliche Produktseite und
  unter `/state.html` erreichbar. Er arbeitet lokal im Browser, kennzeichnet
  fehlende Cloud-Sicherung sichtbar und überträgt keine Managed-Projektdaten.
- Der bisherige branchbasierte Pages-Pfad schließt Repository-Interna als
  zusätzliche Absicherung aus; Releases verwenden weiterhin die Datei-Allowlist.
- Managed-Pilot-V1 und klare Trennung zwischen Kunden-App und internem Studio.
- Öffentliche Demo und Product Contract auf ein einmaliges Managed-Pilot-Angebot
  von 2.500–7.500 € bei typischerweise 6–12 Wochen vereinheitlicht; die alten
  Monatsabos, Checkout- und Konto-Simulationen wurden entfernt.
- Betriebs-, Datenschutz-, Backup-, Support- und Incident-Gates.
- Manuelle, vollständig CI-geprüfte Releases statt Stamp nach jedem `main`-Push.
- Reproduzierbare, auf Veralterung geprüfte `index.html`.
- WebKit-Smoke als verpflichtendes Release-Gate.

Beim nächsten echten Release werden diese Punkte unter dessen unveränderlicher
`release-N`-ID eingeordnet.
