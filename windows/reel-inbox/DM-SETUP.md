# Instagram-DMs → Reel Inbox

Empfänger: **@followerstarteam**. Erlaubte Absender: **@kiikii.bat** und **@thundeerr999**. Direkte Einzelchats, keine Gruppe. Andere Absender erzeugen keine Aufträge, Nachrichten werden nicht automatisch beantwortet oder an Instagram-Accounts weitergeschickt.

Der öffentliche HTTPS-Eingang läuft im bestehenden Lovable-Projekt, nicht auf dem PC. Er bestätigt Meta erst nach erfolgreicher Speicherung in Supabase. Der Windows-Helfer verwendet unverändert dieselbe Queue und kann nach einem Offline-Zeitraum weiterarbeiten. Wiederholte Webhooks sind idempotent. Die dauerhafte Queue speichert kanonische Reel-Links, keine ablaufenden CDN-Adressen.

## Einmalige Einrichtung

1. Additive Migration `20261006025347_reel_inbox_dm.sql` anwenden und geprüften App-Stand veröffentlichen.
2. Bestehende Meta-App prüfen: professionelle Instagram-Verbindung `followerstarteam`, `instagram_business_basic` und `instagram_business_manage_messages`, passende Testrollen oder genehmigter Live-Zugriff für die beiden Absender. Der vorhandene Publisher bleibt verbunden.
3. In der Inbox unter „Einmalige Meta-Einrichtung“ die Webhook-Adresse und das Verify-Token kopieren. Vor einer Änderung eine eventuell bestehende Instagram-Webhook-Adresse und deren Abonnements prüfen und erhalten bzw. integrieren; nicht blind überschreiben. Adresse: `https://instascanner.app/api/public/instagram/inbox-webhook`, Feld `messages`.
4. HMAC-Signaturen werden mit `INSTAGRAM_WEBHOOK_APP_SECRET` geprüft, falls gesetzt, sonst mit dem vorhandenen `INSTAGRAM_APP_SECRET`. Bei abweichendem Meta-App-Geheimnis ausschließlich die separate Servervariable konfigurieren, niemals den Publisher-Schlüssel ersetzen. Keine Geheimnisse in Git/Chat/Browser-URLs oder Logs.
5. „DM-Empfang aktivieren“ prüft den Tokeninhaber und ergänzt `messages` unter Erhalt vorhandener Account-Abonnements. Bei mehreren unklaren App-Abonnements wird abgebrochen. Aktiviert bedeutet noch nicht, dass die Meta-Zustellung funktioniert: Erst eine echte zugelassene DM bestätigt den Eingang.
6. Von jedem erlaubten Absender einen kopierten Reel-Link an @followerstarteam senden. Dann auch die native Teilen-Funktion separat prüfen. Meta muss die Absenderidentität über die User Profile API liefern; zunächst wird nur der Username abgefragt und nur bei Übereinstimmung die zugehörige Instagram-scoped ID gespeichert. Danach bleibt die Bindung an die ID bestehen. Fremde Nachrichteninhalte werden nicht gespeichert.

## Grenzen und Betrieb

- Meta liefert bei Shares je nach Ereignis keinen kanonischen Reel-Link. Dann wird „Kein nutzbarer Reel-Link“ protokolliert. Der Benutzer kann den kopierten Link als Text schicken. CDN-only Shares werden nicht als fertige Downloads ausgegeben: deren URL könnte bis zum nächsten PC-Start ablaufen. Kein ungeprüfter Abruf beliebiger Anhang-URLs.
- Linkempfang erweitert keine Downloadberechtigungen. Nicht öffentlich abrufbare Reels bleiben als Fehler in der normalen Inbox sichtbar. Keine Cookies werden gelesen.
- „DM-Empfang pausieren“ verhindert weitere Übernahmen; gespeicherte Aufträge bleiben erhalten. Die App-weite Meta-Verbindung und andere Webhooks werden nicht abgemeldet. Bestehende Kontingente werden genutzt, keine neuen Abos.
- Tokenablauf wird angezeigt. Die vorhandene Instagram-Verbindung muss gültig bleiben. Keine Garantie für permanente Meta-Zustellung oder 40 Sekunden bis zum fertigen Download.
- Die Webhook-Receipts speichern ausschließlich zugelassene Absenderbezeichnung, Hash der Nachrichten-ID, Eingangszeit, Linkanzahl und Ergebnis, keine Chattexte. Maximal 50.000 Belege und 10.000 Inbox-Einträge; bei ausgeschöpftem Limit wird nicht stillschweigend bestätigt.

## Nachweis vor Betriebsfreigabe

Automatisiert: Signatur/Challenge, manipulierte und große Requests, Empfänger-/Absenderfilter, Echo-/Löschereignisse, Linknormalisierung, keine CDN-Fetches, ID-Bindung, Replay-Dedupe, transaktionaler Rollback, Offline-Queue, Pause und Datenbankzugriffsschutz.

Live noch gesondert zu bestätigen: Meta-App-Webhook, Nachrichten beider echter Absender, Abweisung eines fremden Absenders, native Shares und Empfang bei gestopptem PC-Helfer. Keine Live-Zustellung behaupten, bevor diese Ereignisse beobachtet wurden.
