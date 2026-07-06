## Ziel

Neben Accounts sollen auch **Instagram-Locations** (Orts-IDs) autonom gescraped werden — parallele Sektion, eigener Sidebar-Eintrag, gleicher Score/Tier-Mechanismus wie Accounts. Assets aus Locations landen in derselben Inbox wie Account-Assets, tragen aber ihre Herkunft (`location_id`).

## Datenmodell (Migration)

Neue Tabelle `tracked_locations`, parallel zu `tracked_accounts`:

- `location_id` (text, IG numeric location id, unique per user)
- `name` (text, z. B. „Berghain, Berlin")
- `slug` (text, optional — für source_url)
- `tier` (S/A/B/C, default B)
- `status` (active/paused)
- `last_scan_at`, `next_scan_at`, `consecutive_failures`, `last_error`
- `created_by` (uuid → auth.users)
- Standard: id, created_at, updated_at

Ergänzung `assets`:
- Neue Spalte `location_id uuid NULL` (FK → tracked_locations)
- `account_id` wird `NULL`-fähig
- Neuer Composite-Unique-Index `(location_id, external_id)` analog zum bestehenden `(account_id, external_id)`
- CHECK: genau einer von `account_id` / `location_id` gesetzt

Ergänzung `scanner_runs`:
- Neue Spalte `location_id uuid NULL` (FK)
- `account_id` bleibt NULL-fähig

RLS: identisch zu tracked_accounts (Owner via `created_by`, Operator-Rolle sieht alles). GRANTs für `authenticated` + `service_role`.

## Provider (server-only)

`src/lib/instagram-provider.server.ts` wird um `fetchLocation(locationId)` erweitert. Konfiguration erfolgt **flexibel über ENV**, analog zu den bestehenden Account-Variablen:

- `RAPIDAPI_LOCATION_PATH` — z. B. `/location-feeds`
- `RAPIDAPI_LOCATION_ID_PARAM` — z. B. `id` oder `location_id`
- `RAPIDAPI_LOCATION_EXTRA_PARAMS` — optional, wie beim Account

Die Response wird durch denselben `normalisePost`-Mapper geführt (die Post-Struktur ist bei IG-Endpoints praktisch identisch). Rückgabe: `{ location_id, name, posts[] }`.

Bis die ENV-Variablen gesetzt sind, wirft `fetchLocation` eine klare Fehlermeldung — genau wie der Account-Provider ohne `RAPIDAPI_HOST`.

## Scanner-Service

`src/lib/scanner-service.server.ts` bekommt Location-Zwilling-Funktionen:

- `executeLocationScan(db, runId, locationId, name, attempt)` — analog zu `executeScan`, aber upsert auf `(location_id, external_id)`
- `scanLocationNow(db, locationId)` — manueller Trigger
- `tickQueue` scannt in einem Tick **beide** Quellen (Accounts + Locations), gemeinsam gedeckelt durch dasselbe Provider-Budget und dieselbe 6h-Kadenz (4×/Tag)
- Telegram-Detection-Cards werden auch für Location-Assets verschickt (S/A-Tier)

## UI — parallele Sektion

Neuer Sidebar-Eintrag **„Locations"** (Icon `MapPin`) unter „Accounts" in `AppSidebar.tsx` + `MobileNav.tsx`.

Neue Route `src/routes/_authenticated/locations.tsx`, aufgebaut wie die bestehende Accounts-Seite:
- Liste getrackter Locations mit Tier-Chip, letztem Scan, Status, „Scan Now"-Aktion
- „Add Location"-Dialog: Numeric Location-ID + optionaler Anzeigename
- Detail-Panel: letzte Assets, Scan-History, Priorität ändern

Bestehende Asset-Inbox (`/assets`) zeigt Herkunft-Badge: entweder `@handle` (Account) oder `📍 Ortsname` (Location). Filter „Source type: Accounts / Locations / All" in Toolbar.

Command-Palette bekommt Aktionen `Add Location`, `Go to Locations` (Shortcut `G L`).

## Server-Functions

Neue `src/lib/locations.functions.ts`:
- `listLocationsFn` (owner-scoped)
- `addLocationFn` (input: location_id, name?, tier?)
- `updateLocationFn` (tier, status, name)
- `deleteLocationFn`
- `scanLocationNowFn`

Alle mit `requireSupabaseAuth`.

## Burn-Rate

`burnForecastFn` zählt künftig `active_accounts + active_locations` als Scan-Quellen (beide erzeugen je 4 Requests/Tag). Anzeige im Burn-Screen wird um Zeile „Active locations" ergänzt.

## Offene ENV-Werte

Nach Merge muss der User die drei `RAPIDAPI_LOCATION_*`-ENV-Werte im Backend eintragen (welchen Location-Endpoint sein RapidAPI-Host bietet, weiß er selbst am besten — analog zum bestehenden Account-Setup). Bis dahin bleibt die UI nutzbar, aber Scans für Locations schlagen mit klarer Meldung fehl.

## Reihenfolge

1. Migration (Tabelle + Spalten + RLS + GRANTs)
2. Provider + Scanner-Service erweitern
3. Server-Functions
4. UI (Route, Sidebar, Command-Palette)
5. Burn-Rate anpassen
