# Reel Inbox · Windows

Die vorhandene InstaScanner-Anmeldung schützt `/reel-inbox`. Links werden in derselben Supabase-Datenbank gespeichert. Der Windows-Helfer fragt ausschließlich ausgehend `https://instascanner.app/api/reel-inbox/worker` ab. Kein Routerport, Tunnel, neuer Hostinganbieter oder kostenpflichtiger Downloader.

## Bedienung

1. InstaScanner öffnen und anmelden. Im Menü **Reel Inbox** wählen.
2. Einen oder mehrere Instagram-Links einfügen und **Senden** drücken. Auch `/p/` wird angenommen; nur einzelne unterstützte Videos sind herunterladbar. Trackingparameter werden entfernt, gleiche Shortcodes nur einmal gespeichert.
3. **Auf PC bestätigt** erscheint erst nach Dateiprüfung und abgeschlossener Ablage. **Neu / In Arbeit / Verwendet** bewegt den ganzen Reel-Ordner; bis zur Bestätigung bleibt der letzte bestätigte Zustand sichtbar.

Ziel: `C:\Users\Pumkn\OneDrive\Desktop\kiiikiiii\01 - Workflow\01 Vorlagen SFW\Videos\Neu\<Shortcode>_<Auftrags-ID>`.

Ein Reel-Ordner enthält `video.mp4`, wenn möglich `preview.jpg`, Herkunft, Prüfsumme und Metadaten in `reel.json`, `QUELLE.txt` sowie den Auftragsbeleg. Testmaterial ist ausdrücklich markiert. Die Bestätigung betrifft die lokale Ablage, nicht den Abschluss der OneDrive-Cloudsynchronisierung.

Die ergänzende Galerie unter `Videos\Reel Inbox Galerie\START.html` liest die bestehende `Inventar.json` und ergänzt direkte Verweise auf Inbox-Videos. Die bisherigen `START.html`, `Inventar.json` und `Inventar.csv` bleiben unangetastet. Keine Bestandsmedien werden kopiert. Die ergänzende Ansicht schließt als privat oder NSFW gekennzeichnete Bestandsmedien aus. „SFW“ ist eine Ordnerbezeichnung und keine automatische Inhaltsprüfung.

## Einrichtung

Voraussetzung: Die additive Datenbankmigration und diese App-Version wurden im bestehenden Lovable-Projekt veröffentlicht. In der Inbox **PC-Schlüssel erstellen**; dieser ist 180 Tage gültig und jederzeit widerrufbar. Ein neuer Schlüssel ersetzt den bisherigen. Jeder Schlüssel bindet sich beim ersten Abruf an genau eine Installation.

`Einrichten.ps1 -Python <Python.exe> -Ffmpeg <ffmpeg.exe> -Ffprobe <ffprobe.exe> -Autostart`

Das Skript installiert die festgelegte yt-dlp-Version in einer eigenen Python-Umgebung, kopiert die angegebenen Videowerkzeuge, schützt den lokalen Ordner und speichert den eingegebenen Schlüssel über Windows-DPAPI. Es liest keine vorhandenen Browser-Cookies oder Zugangsdaten. Der Helfer benötigt keinen Supabase-Service-Schlüssel.

`-Autostart` registriert die klar benannte Windows-Aufgabe **InstaScanner Reel Inbox**, für diesen Benutzer ohne Administratorrechte. Sie startet bei Anmeldung auch im Akkubetrieb. Es gibt keine unsichtbare Dienstinstallation. Ohne diese Option erfolgt der Start manuell.

- **Fortsetzen.ps1**: im Hintergrund starten bzw. einen Stopp aufheben.
- **Stoppen.ps1**: dauerhaften Stopp vormerken. Der aktuelle begrenzte Abruf darf noch enden, vor Dateiablage wird abgebrochen. Höchstens ca. 3 Minuten bis zum nächsten Prüfpunkt.
- **Deinstallieren.ps1**: Aufgabe entfernen und lokale Kopplung löschen. Medien und Programmdateien bleiben erhalten. Zusätzlich in der App **PC-Zugriff widerrufen** verwenden.

Im Installationsordner gibt es auch **Stoppen.cmd**, **Fortsetzen.cmd** und **Deinstallieren.cmd** zum Doppelklicken.

Lokaler Betriebszustand: `%USERPROFILE%\.local\share\InstaScanner\ReelInbox\status.json`. Dieser Pfad vermeidet die AppData-Umleitung paketierter Windows-Apps. Installationszustand und Schlüssel liegen außerhalb OneDrive und Git. Unvollständige Versuche bleiben unter `Videos\.staging` zur Prüfung erhalten; es gibt keine automatische Löschung.

## Sicherheits- und Fehlerverhalten

- Ausschließlich feste lokale Zielpfade; keine vom Server gelieferten beliebigen Dateipfade. Keine Symlinks/Junctions, kein Überschreiben bestehender Reel-Ordner, keine Copy/Delete-Ausweichroutine bei Ordnerwechseln.
- Nur HTTPS-Instagram-Links, öffentliche yt-dlp-Extraktion ohne Cookies, Downloads nur von öffentlichen Instagram-/Facebook-CDN-Adressen. Kein DMs-/WhatsApp-Zugriff, keine Zugriffsumgehung, keine WaveSpeed-Nutzung.
- Maximal 50 Links pro Eingabe, 512 MiB und eine Stunde je Video. MP4 muss lesbar und mit FFmpeg vollständig dekodierbar sein. Einzelne progressive MP4s und echte stumme Videos werden unterstützt; Carousels, Playlists und nur getrennt angebotene Audio-/Videospuren gelten als nicht unterstützt.
- Aufträge überleben PC-Ausfälle. Fünf-Minuten-Leases verhindern doppelte Bestätigungen; abgelaufene Aufträge werden erneut angeboten. Nach erfolgreicher Ablage mit verlorener Rückmeldung erkennt der Helfer sein bestehendes Paket an ID und SHA-256.
- Temporär unterbrochene Downloads werden begrenzt mit Wartezeit wiederholt. Nicht verfügbare Inhalte benötigen einen bewussten erneuten Versuch. Original-Link und Fehlerstatus bleiben gespeichert.
- Ordnerwechsel prüfen alle Dateien vor und nach dem Umbenennen. Bei Dateikonflikten oder veränderten Originalen wird gestoppt. Medien-Duplikate aus bestehenden Inventaren oder anderen Inbox-Ordnern werden nicht als neue abgeschlossene Kopie abgelegt.
- Nutzer können nur eigene Inbox-Zeilen lesen. Direkte Änderungen und Zugriff auf Geräte-Hashes sind gesperrt. Der Server prüft bestehende Owner-/Cofounder-Rollen. Geräte können weder Benutzeraktionen noch Publishing auslösen.

## Prüfung und Veröffentlichung

`bun install --frozen-lockfile`, `bun run test`, `bun run test:reel-inbox-db`, `python windows/reel-inbox/test_helper.py`, `bunx tsc --noEmit`, `bun run build`.

Der Datenbanktest nutzt isoliertes PostgreSQL/PGlite mit Rollen/RLS. Er verändert die Produktionsdatenbank nicht. Die Python-Tests nutzen temporäre Ordner und klar synthetische Dateien; diese ersetzen keinen echten Videotest.

Migration: `supabase/migrations/20261006020101_reel_inbox.sql`. Bestehender Prozess: Feature-Branch → geprüfter PR → additive Migration mit Migrationshistorie → Merge ohne History-Rewrite → Lovable veröffentlicht denselben Projektstand. DNS ist bereits auf die vorhandene App gerichtet und benötigt keine Änderung.

Rollback bei App-Problemen: vorherigen App-Stand erneut veröffentlichen; neue Inbox-Tabellen und Dateien zur Wiederaufnahme erhalten, Helfer stoppen. Niemals bestehende Publisher-Tabellen oder Einstellungen verändern.

Kosten: keine neuen Abos oder bezahlten APIs. Bestehende Lovable-/Supabase-Kontingente und mobile Daten werden genutzt; Videos bleiben lokal, nur kleine JPEG-Vorschauen/Metadaten liegen in der Inbox-Datenbank. Keine Zusicherung, dass bestehende Verbrauchskontingente unbegrenzt kostenlos sind.
