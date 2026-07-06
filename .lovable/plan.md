# Discovery Engine

Zweite autonome Pipeline neben dem Scanner. Ziel: aus getrackten Accounts + Locations kontinuierlich neue Kandidaten ableiten, per AI bewerten und dem Operator in einer eigenen Inbox zur Ein-Klick-Entscheidung vorlegen. Kein Auto-Tracking.

## 1. Datenmodell (Migration)

Neue Tabellen unter `public`, alle mit `GRANT authenticated + service_role` und RLS scoped auf `created_by`/`user_id`.

- `discovery_candidates` — ein Datensatz je Operator+Username
  - `id`, `user_id`, `username` (unique per user), `full_name`, `avatar_url`
  - `followers`, `following`, `posts_count`, `is_private`, `is_verified`
  - `estimated_niche` (text), `ai_summary` (text)
  - Scores 0–100: `luxury_score`, `quality_score`, `aesthetic_score`, `travel_score`, `authenticity_score`
  - `p_private_individual`, `p_commercial_brand` (numeric 0–1)
  - `estimated_post_frequency` (text: „~4/Woche" o.Ä.)
  - `confidence` (0–1), `state` (`new` | `tracked` | `ignored` | `blacklisted`)
  - `first_seen_at`, `last_seen_at`, `last_ai_at`, `signal_count` (int)
- `discovery_signals` — jedes Auftauchen eines Kandidaten
  - `id`, `user_id`, `candidate_id` (fk), `username`
  - `source_type` enum: `tagged_collaborator | tagged_user | co_appearance | location_cooccurrence | hashtag_cooccurrence | account_mention | provider_recommendation`
  - `seed_account_id` (nullable fk), `seed_location_id` (nullable fk), `seed_hashtag` (nullable text)
  - `weight` (numeric), `created_at`
- `discovery_blacklist` — schneller Lookup: `user_id + username unique`
- `discovery_preferences` — Lernvektor je Operator
  - `user_id` (pk), gewichtete Aggregate: `avg_luxury`, `avg_quality`, `avg_aesthetic`, `avg_travel`, `avg_authenticity`, `pref_private`, `pref_commercial`, `niche_weights jsonb`, `signal_weights jsonb`, `sample_size int`
- Enum `discovery_state` (`new/tracked/ignored/blacklisted`) + `discovery_source_type`.

Trigger: bei `discovery_candidates.state → 'tracked'` wird der Kandidat als Seed in `tracked_accounts` eingefügt (idempotent via `handle` unique), Tier default `B`. Bei `ignored`/`blacklisted` → Preferences-Update anstoßen.

## 2. Signal-Extraktion (server-only)

`src/lib/discovery-extract.server.ts` — pure Funktion, keine Netzwerk-Aufrufe. Bekommt einen `ProviderPost`-Batch und liefert Signale:
- Caption/Comment-Regex `@[a-zA-Z0-9._]{2,30}` → `account_mention`
- `usertags`/`coauthor_producers`/`tagged_users` aus dem rohen Post-JSON → `tagged_user` / `tagged_collaborator`
- Location-Referenzen im Post → `location_cooccurrence` (Seed = Location, falls in tracked_locations)
- Hashtags → `hashtag_cooccurrence` (nur wenn Hashtag im späteren „Watchlist Hashtags"-Feature; vorerst nur Signal, nicht Seed)

`normalisePost` behält dazu einen `raw` Payload-Ausschnitt (`usertags`, `coauthor_producers`, `location`, `caption.tags`). Dafür bekommt `ProviderPost` optional `signals?: { mentions: string[]; tagged: string[]; collaborators: string[]; location_id?: string; hashtags: string[] }`.

## 3. Discovery-Service

`src/lib/discovery-service.server.ts`:
- `runDiscoveryForSeedAccount(db, accountId)` — nimmt die letzten N Assets dieses Seeds (aus `assets`, kein Extra-Fetch), extrahiert Signale, upsertet Kandidaten (`signal_count += 1`, `last_seen_at = now`), schreibt `discovery_signals`.
- `runDiscoveryForSeedLocation(db, locationId)` — analog.
- `enrichPendingCandidates(db, limit)` — für Kandidaten ohne `last_ai_at` bzw. mit `signal_count >= threshold` und `state = 'new'`:
  1. Provider-Profil-Lookup (nur `profilePath` — kein Feed) → Follower/Following/Posts/Avatar/Verified/Private
  2. Wenige Posts (falls günstig) für AI-Kontext
  3. AI-Call an Lovable AI (`google/gemini-3.5-flash`) via `structured_output` → JSON mit den 5 Scores + Probabilities + niche + summary + confidence
  4. Update `discovery_candidates.*`, `last_ai_at = now`
- `applyOperatorDecision(db, candidateId, decision)` — schreibt state, aktualisiert `discovery_preferences` (exponentieller gleitender Mittelwert, Sample-Size cap 200).
- Provider-Budget respektiert: Enrichment nur wenn `provider_budget.remaining >= reserve`.

Ranking-Formel für die Inbox:
```
score =
  0.35 * niche_match(candidate.niche, prefs.niche_weights)
+ 0.15 * normalised(luxury_score,  prefs.avg_luxury)
+ 0.15 * normalised(quality_score, prefs.avg_quality)
+ 0.10 * normalised(aesthetic_score, prefs.avg_aesthetic)
+ 0.10 * normalised(travel_score, prefs.avg_travel)
+ 0.05 * normalised(authenticity_score, prefs.avg_authenticity)
+ 0.10 * signal_weight(signals, prefs.signal_weights)
```
Confidence = min(1, 0.2 + 0.15 * signal_count) × AI-self-confidence.

## 4. Orchestrierung

- Bestehender `tickQueue` bleibt unverändert. **Neuer** öffentlicher Endpoint `POST /api/public/hooks/discovery-tick` (mit `apikey`-Header, wie scanner-tick).
- Tick-Logik: pro Aufruf max. K Seeds (Accounts+Locations) mit ältestem `last_discovery_at` → `runDiscoveryForSeed*`; anschließend `enrichPendingCandidates(limit=E)`.
- `pg_cron` Job „discovery-tick" alle 30 Min (SQL-Migration mit `net.http_post`, Anon-Key-Header — Muster identisch zu bestehendem Scanner-Cron falls vorhanden, sonst neu).
- `tracked_accounts` bekommt `last_discovery_at timestamptz null`; ebenso `tracked_locations`.

## 5. Server-Functions (`src/lib/discovery.functions.ts`)

Alle mit `requireSupabaseAuth`.
- `listDiscoveryCandidatesFn({ state, limit, cursor })` — Ranked Feed (default `state='new'`).
- `getDiscoveryCandidateFn({ id })` — inkl. jüngste Signale + Seed-Namen.
- `decideDiscoveryCandidateFn({ id, decision: 'track'|'ignore'|'blacklist' })` — ruft `applyOperatorDecision`; bei `track` wird zusätzlich `tracked_accounts` befüllt (via Trigger).
- `runDiscoveryNowFn({ seedType, seedId })` — manueller Trigger für einen Seed (Enqueue + Sofort-Tick begrenzt).
- `getDiscoveryStatsFn()` — Zahlen für Dashboard: candidates_new, tracked_via_discovery, ignored, blacklisted, avg_confidence.

## 6. UI

Sidebar-Eintrag **„Discovery"** (Icon `Sparkles`) direkt unter „Assets". Shortcut `G D`. Command-Palette: `Go to Discovery`, `Run discovery now`.

Neue Route `src/routes/_authenticated/discovery.tsx`:
- Top: KPI-Reihe (New candidates, Tracked this week, Ignored, Avg confidence) + „Run discovery now"-Button.
- Filterleiste: `state` (New / Tracked / Ignored / Blacklisted), Sort (Rank / Newest / Highest luxury), Niche-Chips.
- Kandidatenkarte (analog `asset-card`):
  - Avatar, `@username`, verified/private badge
  - Follower · Following · Posts · geschätzte Post-Frequenz
  - Score-Ring (Composite) + kleine Sub-Score-Bars für Luxury/Quality/Aesthetic/Travel/Authenticity
  - „Why discovered" — Liste bis zu 3 Signale mit Seed-Chip (`@seed_account` oder `📍 location`)
  - AI Summary (2 Zeilen, `line-clamp-2`, expandable)
  - Confidence-Chip
  - Aktionen als Icon-Buttons mit Tooltip + Shortcut:
    - **Track** (`T`) — grün
    - **Ignore** (`I`) — neutral
    - **Blacklist** (`B`) — rot
    - **View profile** — öffnet Detail-Sheet
    - **Open on Instagram** — externer Link
- Detail-Sheet: alle Sub-Scores, komplette AI-Analyse, komplette Signalhistorie, letzte 6 Posts als Vorschau (falls im Enrichment geladen).
- Empty-State im InstaScanner-Ton: „Discovery running. New candidates surface as the network expands."

Asset-Card + Accounts-Liste bekommen kleinen „via Discovery"-Chip, wenn `tracked_accounts.source = 'discovery'` (neue nullable Spalte).

## 7. Lernschleife

- Nach jedem Track/Ignore/Blacklist: `discovery_preferences` aktualisieren (EMA α = 1/min(50, sample_size+1)).
- Niche-Weights: bei `track` +1 auf niche, bei `ignore` −0.3, bei `blacklist` −1 und Username → `discovery_blacklist`.
- Signal-Weights (welche `source_type` führt zu Tracks) analog.
- Ranking und `enrichPendingCandidates`-Priorität lesen `discovery_preferences` bei jedem Aufruf.

## 8. Reihenfolge der Umsetzung

1. Migration (Tabellen, Enums, Trigger, GRANTs, RLS, Cron)
2. Signal-Extraktion + `ProviderPost.signals`
3. Discovery-Service + AI-Enrichment (structured output)
4. Public Tick-Endpoint + `pg_cron`
5. Server-Functions
6. UI-Route, Sidebar, Command-Palette
7. „via Discovery"-Chip in Accounts/Assets

## Offen / bewusst weggelassen

- **Provider-Recommendations & Creator-Suggestions**: nur wenn dein RapidAPI-Host so einen Endpoint anbietet. Skelett dafür in `discovery-service.server.ts` als optionaler Signal-Provider, standardmäßig deaktiviert.
- Kein Auto-Add zu Tracking (per Spec).
- Kein Hashtag-Seed-Tracking (bleibt später „Watchlist Hashtags").

Sag Bescheid, ob du das so umgesetzt haben willst, oder ob ich Teile davon streichen/schlanker halten soll — insbesondere ob wir für den ersten Wurf **ohne** AI-Enrichment starten (Kandidaten + Signale + Inbox + Track/Ignore/Blacklist), und AI-Scoring in einem zweiten Schritt draufsetzen.