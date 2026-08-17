# Transition Watch vereinfachen — ohne Funktionsverlust

Der Live-Test hat funktioniert, aber der Weg dorthin waren sechs Screens und viele Felder. Ziel: von „Account eintragen" bis „Order geht raus" in **einem geführten Ablauf**, während jede bestehende Funktion (Guardrails, Budget, Reconcile, Retry, Katalog, Intervalle) erhalten bleibt — nur nicht mehr ständig sichtbar.

Leitfrage bleibt: Reduziert es kognitive Last? Nichts wird gelöscht, alles wandert entweder in den Standardpfad oder hinter „Advanced".

## 1. Ein geführter Setup-Flow statt verstreuter Formulare

Neuer Dialog **„Monitor hinzufügen"** auf `/monitor` mit drei Schritten in einem Fenster:

1. **Profil** — Benutzername(n) einfügen (der bestehende Bulk-Parser bleibt darunter als „mehrere hinzufügen").
2. **Aktion** — Service über den bestehenden Katalog suchen und anklicken; Menge wird automatisch auf das Provider-Minimum gesetzt und ist editierbar. Ziel-URL wird automatisch aus dem Handle gebaut (nicht mehr manuell eintippbar im Standardfall).
3. **Bestätigen** — eine Klartextzeile: „Wenn @handle öffentlich wird → Service 1234, Menge 50, geschätzte Kosten X USD."

Ergebnis: Account + Action-Template entstehen in einem Zug. Die Detailseite bleibt für Feinarbeit, ist aber nicht mehr Pflichtstation.

## 2. Order-Auslösung entkoppeln von „Run action tick"

Heute: Manual Event → separat Queue-Tick klicken. Künftig:

- Nach einem Event (manuell oder automatisch) wird die Queue direkt einmal mit angestoßen; das Ergebnis steht im selben Toast („Event erzeugt → Order platziert, Referenz #…").
- „Work queue" bleibt als manueller Knopf erhalten (für hängende/blockierte Fälle), rutscht aber unter „Advanced".
- Der Cron-Pfad bleibt unverändert.

## 3. Ein „Test order"-Knopf mit Vorschau

Statt „Manual test event" + Queue-Tick + Statussuche: ein Knopf, der vorher zeigt, was passieren wird (Service, Menge, Ziel, Kosten, verbleibendes Budget) und nach Bestätigung Event + Order in einem Schritt auslöst und die Provider-Referenz anzeigt. Die 5-Minuten-Sperre und alle Guards bleiben serverseitig aktiv.

## 4. Oberfläche verdichten

- Die drei Status-Kacheln (Status source, Cron secret, Order adapter) und die Order-Ops-Kennzahlen verschmelzen zu **einer Systemzeile** oben: „Monitoring aktiv · Orders scharf · heute 3/20 · 0 blockiert". Details per Klick ausklappbar — die vollständige `OrderOpsCard` bleibt als Inhalt erhalten.
- Der Settings-Block (Intervall, Cooldown, Batch, Adapter-Basis-URL, Default-Service, Default-Menge) wandert komplett in einen zusammenklappbaren Abschnitt **„Advanced"**, standardmäßig zu. Kein Feld entfällt.
- Auf der Detailseite: Check-Historie und Events/Actions bleiben, werden aber zu einer Zeitleiste zusammengeführt statt zwei getrennter Tabellen; Retry bleibt pro Zeile.

## 5. Sinnvolle Standardwerte

- Intervall, Cooldown, Batch, Basis-URL sind bereits vorbelegt — sie werden im Standardpfad gar nicht mehr abgefragt.
- Wird ein Service im Setup gewählt, wird er zugleich als Default-Service des Operators gespeichert, sodass der zweite Monitor mit einem Klick fertig ist.

## Was ausdrücklich nicht angefasst wird

Guardrails (Host-Allowlist, Zielvalidierung, Mengenlimit), Budget/Kill-Switch, Idempotenz, Backoff, Reconcile, RLS/Mandantentrennung, Cron-Endpunkte, Quota-Logik. Rein Präsentations- und Ablaufebene, plus eine kleine Server-Ergänzung für Punkt 2/3.

## Technische Details

- Neu: `src/components/monitor/add-monitor-dialog.tsx` (Schritte 1–3), `src/components/monitor/service-picker.tsx` (aus der Detailseite extrahiert, dort weiterverwendet), `src/components/monitor/system-strip.tsx`.
- `monitor.index.tsx` und `monitor.$accountId.tsx` werden entschlackt und auf diese Komponenten umgestellt; Settings in ein `Collapsible`.
- Neue Server-Funktion `triggerTestOrderFn` in `src/lib/monitor.functions.ts`: nutzt bestehendes `createEventWithActions` + `runActionTick` in einem Aufruf; zusätzlich `previewTestOrderFn` (rein lesend: Template, Ziel, Budgetlage) für die Vorschau.
- Keine Migration nötig; keine neuen Secrets.
