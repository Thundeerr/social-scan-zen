# Provider-Adapter (Bestellpfad) auf dasselbe Niveau bringen

Der Monitoring-Pfad ist gehärtet und live verifiziert. Der ausgehende Aktionspfad ist funktional, aber ungeprüft: er kann Geld ausgeben, ohne dass Guthaben, Ausgabenlimit, Zielvalidierung oder Nachverfolgung eines unklaren Ergebnisses existieren. Dieser Plan bringt ihn auf denselben Stand — mit Kostenkontrolle, Nachvollziehbarkeit und einem kontrollierten Live-Test am Ende.

## 1. Sicherheit und Zielvalidierung

- Die Basis-URL des Anbieters ist heute frei durch Operatoren editierbar und wird direkt vom Server aufgerufen. Sie wird künftig gegen eine Allowlist erlaubter Hosts geprüft (HTTPS, kein privates Netz), sonst wird die Aktion als `not_configured` beendet statt abgeschickt.
- Das Bestellziel (Link) wird vor dem Versand validiert: nur `instagram.com`-URLs mit dem erwarteten Benutzernamen. Ein Template mit kaputtem Platzhalter darf keine Bestellung an eine fremde URL auslösen.
- Menge wird gegen eine harte Obergrenze pro Aktion geprüft.

## 2. Kostenkontrolle vor jedem Versand

- Neues Ausgabenbudget analog zum geteilten API-Kontingent: Obergrenze pro Tag und pro Monat (Anzahl Aktionen und Menge), workspaceweit geteilt, serverseitig erzwungen. Überschreitung → Aktion bleibt in `blocked` statt zu bestellen.
- Guthabenabfrage beim Anbieter (`balance`) vor dem ersten Versand eines Laufs; bei zu niedrigem Guthaben wird nicht bestellt, sondern blockiert und im Monitor sichtbar gemacht.
- Globaler Kill-Switch „Bestellungen pausiert" in den Monitor-Einstellungen — sofort wirksam für Scheduler und manuelle Auslösung.

## 3. Zuverlässigkeit

- Wiederholungen mit exponentiellem Backoff und Obergrenze statt sofortigem Endstatus; nur netzwerkbedingte Fehler werden wiederholt, Anbieterfehler nie.
- Der Scheduler ruft den Anbieter heute innerhalb der Prüfschleife auf. Der Versand wird davon entkoppelt: Aktionen werden nur eingereiht, ein separater Bestell-Tick arbeitet sie ab. Ein hängender Anbieter blockiert dann keine Statusprüfungen mehr.
- Steckengebliebene `processing`-Aktionen (Absturz mitten im Versand) werden nach einer Karenzzeit automatisch als `unknown_outcome` freigegeben.

## 4. Abgleich unklarer Ergebnisse

- Aktionen mit Anbieterreferenz werden regelmäßig gegen die Statusabfrage des Anbieters abgeglichen (`status`), damit `unknown_outcome` sich zu abgeschlossen/fehlgeschlagen auflöst und keine Doppelbestellung entsteht.
- Vor jedem erneuten Versand wird geprüft, ob für dieses Ereignis bereits eine Anbieterreferenz existiert — Schutz gegen doppelte Bestellung derselben Aktion.

## 5. Transparenz in der Oberfläche

- Aktionsdetails zeigen: Status, Versuche, nächster Versuch, Anbieterreferenz, redigierter Request/Response-Auszug, Blockadegrund.
- Neues Panel unter `/monitor`: Anbieter-Guthaben, heutige/monatliche Ausgaben gegen Limit, pausiert ja/nein, Anzahl blockierter und unklarer Aktionen.
- Verbindungstest-Knopf: fragt nur Guthaben ab, bestellt nichts.
- Jede Bestellung, Blockade und Auflösung wird ins Aktivitätsprotokoll geschrieben.

## 6. Tests und Abnahme

- Unit-Tests mit gemocktem Anbieter: Erfolg, Anbieterfehler, unparsebare Antwort, Netzwerkfehler, doppelter Versand, Budgetblockade, Hostblockade, Zielvalidierung, Backoff, Abgleich.
- Typecheck, ESLint, Unit-Tests, Produktionsbuild.
- Abschließend genau **ein** kontrollierter Live-Test mit kleinstmöglicher Menge auf dem Testmonitor, danach Statusabgleich der Bestellung. Erst dann gilt der Anbieterpfad als live verifiziert; die Readiness-Doku wird entsprechend aktualisiert.

## Technische Details

- Anpassungen konzentriert in `src/lib/monitor/external-action-adapter.server.ts` (Portabilitätsvertrag bleibt: nur diese Datei kennt den Anbieter), plus neue Helfer `action-budget.server.ts` und `action-targets.ts` (browser-sicher, damit die UI dieselben Regeln anzeigen kann).
- Migration: neue Spalten für Backoff (`next_attempt_at`), Blockadegrund und Statusabgleich auf `monitor_actions`, Ausgaben-/Pausierungsfelder auf `monitor_settings`; Statuswert `blocked` ergänzen. GRANTs und RLS wie bei den bestehenden Monitor-Tabellen (operator-gebunden).
- Bestell-Tick als eigener Endpunkt unter `src/routes/api/public/cron/` mit demselben Secret-Schutz wie der bestehende Check-Endpunkt.
- Keine neuen Secrets nötig; `JAP_API_KEY` bleibt serverseitig und wird nie geloggt oder zurückgegeben.

&nbsp;

Wichtig hier ist das das uns nicht im Alltag behindert sondern nur vor dummen menschlichen Versagen schützt