## Auto-publish Approved Assets to Instagram

Turn the review pipeline's terminal **Approved** state into a publishing trigger. One IG destination, AI-drafted caption, zero decisions after the operator hits Approve.

### End-to-end flow

```text
Asset detected → AI verdict → Priority queue
       ↓ operator approves (A key)
State → 'approved'   ─────▶  publish_jobs row inserted (queued)
                                      ↓
                          Publisher worker (pg_cron, 1/min)
                                      ↓
              1. Rehost media (IG CDN → Lovable Storage → public URL)
              2. AI-draft caption via Lovable AI Gateway
              3. Create Meta media container
              4. Poll container status until FINISHED
              5. Publish container
              6. Write ig_post_id + permalink back on the asset
                                      ↓
       Success → activity_log + Telegram signal (reuses smart notifier)
       Failure → job.error surfaces in Priority queue with real Meta message
```

Nothing here is autonomous *content* selection — the operator still decides what gets Approved. The system only removes the mechanical steps between Approve and Published.

### Meta setup (walkthrough shown once in Settings)

A new **Publishing → Instagram** panel in Settings hosts the entire connection lifecycle. Copy walks through:

1. Convert target IG account to **Business** or **Creator** (free, in the IG app).
2. Link that account to a Facebook Page you own.
3. In developers.facebook.com, create an app → add **Instagram Graph API** + **Facebook Login** products.
4. Grant permissions: `instagram_basic`, `instagram_content_publish`, `pages_show_list`, `pages_read_engagement`, `business_management`.
5. Paste **App ID** + **App Secret** into the panel (stored as secrets), click **Connect Instagram**, complete Meta OAuth.
6. System exchanges the short-lived user token for a long-lived Page token (60d), auto-refreshes every 45d via pg_cron, and stores the resulting IG Business Account ID.

The panel shows connection state (Connected / Token expiring in X days / Disconnected) with a single **Reconnect** action. No app review needed for publishing to your own accounts.

### Schema changes

```sql
CREATE TABLE public.ig_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ig_user_id text not null,           -- Instagram Business Account ID
  ig_username text not null,
  page_id text not null,
  page_access_token text not null,    -- long-lived, rotated by cron
  token_expires_at timestamptz not null,
  status text not null default 'active',    -- active | expired | revoked
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id)                     -- one IG destination per operator (matches "one account, fixed")
);

CREATE TABLE public.publish_jobs (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets(id) on delete cascade,
  user_id uuid not null,
  status text not null default 'queued',    -- queued | rehosting | drafting | uploading | publishing | published | failed
  caption text,                             -- AI draft; operator can override before it runs
  rehosted_url text,
  ig_container_id text,
  ig_post_id text,
  ig_permalink text,
  attempts int not null default 0,
  error text,
  scheduled_for timestamptz default now(),  -- future-dated = scheduled publish
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- assets gains lightweight publish state for the UI
ALTER TABLE public.assets
  ADD COLUMN publish_status text,       -- null | queued | published | failed
  ADD COLUMN ig_post_id text,
  ADD COLUMN ig_permalink text;
```

Full GRANTs + RLS on each table. `ig_connections.page_access_token` is server-read-only (no `TO anon`, no client SELECT — server functions with `requireSupabaseAuth` pull it under the operator's own row).

### Storage bucket

New **`ig-publish`** private bucket. The rehoster fetches the asset's `media_url`, uploads under `{user_id}/{asset_id}.{ext}`, and generates a short-lived signed URL (1h — Meta only needs it during container creation, ~seconds). Bucket policies scoped to `service_role` writes + owner reads.

### The publisher worker

`pg_cron` fires `/api/public/hooks/run-publisher` every 60s (auth via `apikey` header, standard pattern). Handler:

- Picks up to 5 jobs where `status='queued'` and `scheduled_for <= now()`, respecting Meta's 25-posts/24h cap per connection (query recent successes and skip if at limit).
- Runs each job through the state machine, updates the row after every step (so the UI streams progress via realtime, matching the scanner's phase UX).
- On failure: retry with exponential backoff up to 3 attempts, then `status='failed'` and the error surfaces on the Priority queue's failed publishes panel.
- Token refresh is a separate cron (daily) that renews any Page token within 15 days of expiry.

### AI caption drafter

Uses the existing Lovable AI Gateway. Prompt inputs: asset caption (if any), source handle, media type, top AI reasons. Output: a caption ≤2200 chars, tone-matched to the platform's calm/analytical voice, no hashtag spam. Draft is written to `publish_jobs.caption` at approval time — operator can edit it in a small inline field in the Priority queue **before** the worker picks it up (a 60s edit window). If the job has already moved past `drafting`, the field goes read-only.

### UI changes

- **Priority queue** gains a `Publishing` chip on rows in flight (queued / rehosting / drafting / uploading / publishing) and a `Published` chip with permalink link on completed rows.
- **Settings → Publishing → Instagram**: connection panel described above + a "Recent publishes" list (last 20, with permalinks + errors).
- **Approve action** (A key) is the sole trigger — no separate Publish button, matching the "auto-publish on approve" answer.
- Kill switch: a **Pause auto-publish** toggle in Settings that flips `publish_jobs.status='queued'` picks off without disconnecting Meta.

### Trigger wiring

A database trigger on `asset_status` (`AFTER UPDATE OF state`) inserts a `publish_jobs` row whenever `state` transitions to `approved`, provided the operator has an active `ig_connections` row and auto-publish isn't paused. Direct insert (not application code) so the trigger fires no matter how the state changes — keyboard, mouse, batch action, API. Idempotent on `(asset_id)` — approving twice doesn't publish twice.

### Files this touches

- `supabase/migrations/<ts>_ig_publishing.sql` — tables, storage bucket, RLS, GRANTs, trigger, cron jobs
- `src/lib/instagram-publisher.server.ts` — Meta Graph API client + state machine
- `src/lib/instagram-oauth.functions.ts` — connect / disconnect / status server fns
- `src/lib/publish-jobs.functions.ts` — list recent, edit caption, cancel, pause toggle
- `src/routes/api/public/hooks/run-publisher.ts` — cron endpoint
- `src/routes/api/public/hooks/refresh-ig-tokens.ts` — token refresh cron endpoint
- `src/routes/api/public/ig/callback.ts` — Meta OAuth redirect handler
- `src/routes/_authenticated/settings.tsx` — new Publishing section
- `src/routes/_authenticated/assets.tsx` — publish state chips + inline caption editor
- `src/lib/telegram.server.ts` — one extra digest variant for "N published to @handle"

### Secrets

- `META_APP_ID` (public-safe but treated as secret for parity)
- `META_APP_SECRET` (server-only, added via `add_secret` after user creates the Meta app)

The Page access token is per-operator and lives in `ig_connections`, not project secrets.

### Out of scope for this build

- Multi-account routing / tier-based destinations (answered: one account, fixed).
- Hybrid auto-publish rules (S-tier only). Auto-publish-on-approve is enough — approval already gates it.
- Stories, reels-specific tooling, carousels, first-comment hashtag posting (can be layered in later; V1 is single image/video posts).
- Rescheduling UI beyond "queued + scheduled_for". Rich calendar view is a later addition.
- Public web hook for Meta account deauthorization (added when app review is needed).

### Build order (each step verifiable before the next)

1. Migration + storage bucket + trigger (schema is the load-bearing part).
2. Meta OAuth flow + Settings connection panel — verify with a real Meta app, no publishing yet.
3. Publisher server module + cron route — publish a fixed test asset manually before wiring the trigger.
4. Approve → auto-publish end-to-end with AI caption.
5. UI chips + edit window + pause toggle.
6. Telegram publish-success digest variant.

I stop after each step and confirm it works against your real IG account before moving on. When you approve this plan I'll start with step 1 and pause after step 2 so you can wire the Meta app.
