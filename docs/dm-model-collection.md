# Reels vom privaten Account sammeln

Von @thundeerr999 oder @kiikii.bat direkt an @followerstarteam teilen.
Ohne Zusatz wird Kiikii ausgewählt. Das eigenständige Wort „Tuuva“ im eigenen
Begleittext wählt Tuuva (Groß-/Kleinschreibung egal). Original-Captions und URLs
werden nicht als Modellanweisung ausgewertet. Es gibt keinen dauerhaften
Modellwechsel: Jedes Reel ohne eigene Zuordnung bleibt Kiikii.

Instagram kann eine geteilte Reel-Karte und ihren Begleittext als zwei Nachrichten
liefern. Ein einzelner Modellhinweis wird deshalb mit genau einer vorausgehenden,
noch nicht ausdrücklich zugeordneten Reel-Nachricht desselben verifizierten
Absenders verbunden, wenn die Meta-Zeitstempel höchstens 30 Sekunden auseinanderliegen.
Der Hinweis darf auch direkt nach dem Teilen geschickt werden. Umgekehrte
Zustellreihenfolge funktioniert; maßgeblich ist die Sendezeit, nicht die Ankunftszeit.

Bei mehreren möglichen Reels oder konkurrierenden Hinweisen wird nicht geraten.
Die Inbox zeigt den Hinweis als mehrdeutig bzw. ohne passenden Treffer. In
„Collected reels“ kann der Besitzer das Modell jeder Zeile direkt auswählen,
ohne das Reel erneut zu schicken oder den Instagram-Account zu wechseln.
Auch verspätete Ereignisse können eine vorher eindeutige Zuordnung mehrdeutig
machen; manuelle Korrekturen bleiben dagegen gesperrt für weitere Auto-Zuordnung.

Der signierte Webhook prüft weiterhin Empfänger, erlaubten Absender und dessen
gebundene Meta-ID. V4 sammelt in reel_inbox_dm_candidates, erzeugt aber keine
model_pipeline_jobs. Gleiche Vorlage und gleiches Modell werden nur einmal gesammelt.
Dieselbe Vorlage kann getrennt für beide Modelle gesammelt werden. Herkunftseinträge
pro Nachricht bewahren diese unabhängigen Sammlungen bei einer Korrektur.
Bestehende Einträge werden konservativ als Altbestand übernommen; sie werden nicht
anhand zeitlicher Vermutungen automatisch umgedeutet.

Gespeichert werden nur die ausgewählte Modellkennung, Meta-Zeitstempel,
Nachrichten-Hash, Zuordnungsstatus und Referenzen auf gesammelte Vorlagen.
Rohtext, Original-Captions und signierte Medien-URLs werden nicht gespeichert.
Die bestehende Reel Inbox lädt weiterhin Vorlagen herunter; das ist kein
Generierungsauftrag. Manuelle Modelländerungen bearbeiten ausschließlich die
Sammlung, nicht vorhandene Dateien, Generierungsjobs oder Veröffentlichungen.

Fehlt Meta ein nutzbarer Permalink, den kopierten Reel-Link als Text schicken
(bei Tuuva zusammen mit „Tuuva“). Hinweise ohne Meta-Zeitstempel werden nicht
zeitlich zugeordnet; dafür die Modellauswahl in der Inbox verwenden.

## Veröffentlichung und Tests

Zuerst Migration `20261103172132_reel_dm_split_model_notes.sql`, danach App.
Der Worker wird dafür nicht gestartet oder geändert.

- `npx vitest run src/lib/reel-inbox-dm.test.ts`
- `node tests/dm-model-collection-db.mjs`
- `node tests/dm-model-notes-db.mjs`

Echter Empfangstest nach Freigabe: ein Reel ohne Zusatz und ein Reel mit
Begleittext „Tuuva“ senden; Zuordnung und Hinweisstatus in der Inbox prüfen.
Bei mehreren schnellen Shares kann die Modellauswahl direkt korrigiert werden.
Sicherstellen, dass dadurch keine neuen Generierungsjobs entstehen.
