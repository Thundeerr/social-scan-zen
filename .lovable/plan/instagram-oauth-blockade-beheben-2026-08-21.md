# Instagram OAuth-Blockade beheben

## Ziel
Den offiziellen Instagram-Login ohne eingebettete Darstellung oder Redirect-Abweichung öffnen und zuverlässig zum Publisher zurückführen. Publishing bleibt pausiert; es werden keine Inhalte erstellt oder veröffentlicht.

## Bestätigter Ist-Zustand
- Instagram öffnet bereits in einem separaten Browser-Popup; das ursprüngliche Iframe-Problem ist damit nicht mehr die aktuelle Ursache.
- Der OAuth-Request nutzt `https://www.instascanner.app/api/public/instagram/callback`.
- `www.instascanner.app` antwortet mit einem 302-Redirect auf `https://instascanner.app/...`.
- Instagram landet bei der angemeldeten Sitzung auf `/oauth/authorize/third_party/error/`, bevor der App-Callback erreicht wird.
- OAuth-Redirect-URIs müssen exakt übereinstimmen; ein Domain-Redirect im Callback-Pfad ist daher zu vermeiden.

## Umsetzung
1. **Eine kanonische OAuth-Origin erzwingen**
   - Ausschließlich `https://instascanner.app/api/public/instagram/callback` für Authorization, gespeicherten OAuth-State und Code-Austausch verwenden.
   - Preview-, localhost- und `www`-Origins dürfen keine abweichende Callback-URI mehr erzeugen.
   - Die bestehende optional konfigurierbare Origin nur akzeptieren, wenn sie HTTPS nutzt und auf einer erlaubten InstaScanner-Domain liegt.

2. **Login als echte Top-Level-Navigation starten**
   - Das künstliche `about:blank`-Popup entfernen.
   - Nach Erzeugung des sicheren States einen normalen neuen Browser-Tab ohne Opener-Beziehung öffnen; falls der Browser ihn blockiert, einen sichtbaren „Instagram öffnen“-Link als sicheren Fallback anzeigen.
   - Die Publisher-Seite pollt weiterhin nur den nicht geheimen Connection-Status und zeigt Erfolg erst nach dem gespeicherten Connection-Datensatz.

3. **Callback-Rückkehr robust machen**
   - Nach Erfolg oder Abbruch immer zur kanonischen `/publisher`-URL zurückleiten.
   - Providerfehler weiterhin redigieren; keine Codes, Tokens oder Secrets an Browser oder Logs geben.
   - Publishing bleibt unverändert pausiert.

4. **Konfiguration klar absichern**
   - In der UI bei einem Providerfehler eine kurze, konkrete Meldung anzeigen, dass in der bestehenden Meta-App exakt diese URI eingetragen sein muss:
     `https://instascanner.app/api/public/instagram/callback`
   - Keine Meta-App-Einstellungen automatisch ändern.

## Verifikation
- Tests für kanonische Origin, `www`-/Preview-Normalisierung und unzulässige Origins ergänzen.
- Authorization-URL auf exakt den Apex-Callback prüfen.
- Callback-Erfolg, Abbruch, Replay und abgelaufenen State erneut testen.
- Produktions-Build und vorhandene OAuth-Tests ausführen.
- Live prüfen, dass der Klick nicht mehr auf `www` zeigt und Instagram als Top-Level-Tab geöffnet wird; kein echter Publish-Test.

## Erforderlicher manueller Meta-Schritt
In **FS Content Publisher-IG** muss exakt folgende Valid OAuth Redirect URI hinterlegt sein:

`https://instascanner.app/api/public/instagram/callback`

`www.instascanner.app` sollte dort nicht als Ersatz verwendet werden, da es weiterleitet.
