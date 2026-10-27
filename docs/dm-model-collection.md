# Reels vom privaten Account sammeln

Von @thundeerr999 oder @kiikii.bat direkt an @followerstarteam teilen.
Ohne Zusatz wird Kiikii ausgewählt. Das eigenständige Wort „Tuuva“ im Begleittext
derselben Nachricht wählt Tuuva (Groß-/Kleinschreibung egal). Original-Captions und
URLs werden nicht als Modellanweisung ausgewertet. Separate Textnachrichten ändern
keine vorherigen oder späteren Reels.

Der signierte Webhook prüft weiterhin Empfänger, erlaubten Absender und dessen
gebundene Meta-ID. V3 sammelt in reel_inbox_dm_candidates, erzeugt aber keine
model_pipeline_jobs. Gleiche Vorlage und gleiches Modell werden nur einmal gesammelt.
Dieselbe Vorlage kann getrennt für beide Modelle gesammelt werden. Die bestehende
Reel Inbox lädt weiterhin Vorlagen herunter; das ist kein Generierungsauftrag.

Die Liste steht im Instagram-DM-Bereich der Reel Inbox. Alte Einträge werden nicht
automatisch umgedeutet. Fehlt Meta ein nutzbarer Permalink, den kopierten Reel-Link
als Text schicken (bei Tuuva zusammen mit „Tuuva“).

Deployment: Migration 20261027180000_dm_model_collection.sql zuerst, danach App.
Der Worker wird dafür nicht gestartet oder geändert. Tests:
`node tests/dm-model-collection-db.mjs` und `npx vitest run src/lib/reel-inbox-dm.test.ts`.
Echter Empfangstest: je einen Link ohne Zusatz und mit Begleittext „Tuuva“ senden;
Modell in der Inbox prüfen und sicherstellen, dass keine neuen Pipeline-Jobs entstehen.
