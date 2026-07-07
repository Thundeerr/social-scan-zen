# InstaScanner – Migration Runbook (Off‑Lovable)

Goal: make this repo independently deployable and maintainable without any Lovable-specific infrastructure. No feature changes, no redesign — only replace platform-specific pieces with standard equivalents.

---

## 0. Portability Contract (ALWAYS FOLLOW)

The app is already wired to be host-agnostic through two thin adapters. Every future change MUST respect this contract; otherwise the migration becomes hard again.

- **AI**: every chat/LLM call goes through `src/lib/ai/chat.ts` → `chatCompletion({ model, messages, response_format })`. Never `fetch("https://ai.gateway.lovable.dev/...")` or an OpenAI/Gemini SDK directly from feature code. Provider is picked by env `AI_PROVIDER` (`lovable` default | `openai` | `gemini`).
- **Telegram**: every Bot API call goes through `src/lib/messaging/telegram-transport.ts` → `telegramApiCall(method, body)`. Never `fetch("https://connector-gateway.lovable.dev/telegram/...")` or `fetch("https://api.telegram.org/bot.../...")` directly from feature code. Provider is picked by env `TELEGRAM_PROVIDER` (`lovable` default | `direct`).
- **Models**: pass generic aliases `"fast"` or `"smart"` — the adapter maps them per provider. Only pin a provider-specific model id when the user asks for a specific one.
- **Migrating off Lovable is now an env flip**, not a code change:
  - `AI_PROVIDER=openai` + `OPENAI_API_KEY=...` (or `gemini` + `GEMINI_API_KEY`)
  - `TELEGRAM_PROVIDER=direct` + `TELEGRAM_BOT_TOKEN=...`

---


## 1. Current Architecture (audit)

- **Framework**: TanStack Start v1 (React 19, Vite 8), SSR entry in `src/server.ts`, start config in `src/start.ts`.
- **Routing**: File-based via `src/routes/`. Protected subtree under `src/routes/_authenticated/` (client-side gate). Public API routes under `src/routes/api/public/*`.
- **Bundler / target**: `@lovable.dev/vite-tanstack-config` wraps Vite + Nitro and defaults the build target to **Cloudflare Workers** (`workerd` runtime, `nodejs_compat`).
- **Database**: Supabase Postgres (project ref `vkudzmoaqskmglfajzkz`). ~19 tables, RLS enabled, `has_role` / `is_operator` security‑definer functions, triggers (`promote_discovery_to_tracked`, `enqueue_publish_on_approve`, `update_updated_at_column`, `handle_new_user`).
- **Auth**: Supabase Auth (email + Google OAuth via Lovable broker `lovable.auth.signInWithOAuth`). Sessions in `localStorage`; bearer attached to server functions by `src/integrations/supabase/auth-attacher.ts`.
- **Server logic**: `createServerFn` handlers (`src/lib/*.functions.ts`) + a few public HTTP routes:
  - `src/routes/api/public/hooks/scanner-tick.ts` (pg_cron → Instagram scanner)
  - `src/routes/api/public/hooks/discovery-tick.ts` (pg_cron → discovery loop)
  - `src/routes/api/public/telegram/webhook.ts` (Telegram bot webhook)
- **Cron**: Supabase `pg_cron` calls the two `/api/public/hooks/*-tick` URLs every minute with header `x-cron-secret: $CRON_SECRET`.
- **Storage**: One private Supabase Storage bucket `ig-publish`.
- **External APIs**: RapidAPI Instagram scraping (`RAPIDAPI_HOST/KEY/PATH/...`).
- **AI**: Lovable AI Gateway (`https://ai.gateway.lovable.dev/v1/chat/completions`) — used by `src/lib/discovery-service.server.ts` for candidate scoring. Auth via `LOVABLE_API_KEY`.
- **Telegram**: Routed through Lovable Connector Gateway (`https://connector-gateway.lovable.dev/telegram`) in `src/lib/telegram.server.ts`. Auth via `LOVABLE_API_KEY` + `TELEGRAM_API_KEY` connector secret.
- **Env**: `.env` with `VITE_SUPABASE_*` + `SUPABASE_*`. Server-only secrets injected by Lovable (see §2).

---

## 2. Lovable‑Specific Dependencies

| # | Item | Where | Type |
|---|---|---|---|
| 1 | `@lovable.dev/vite-tanstack-config` (+ transitive `@lovable.dev/*` plugins) | `vite.config.ts`, `package.json` (dev) | Build tooling |
| 2 | Cloudflare Workers build target baked into the Lovable config | `vite.config.ts` (nitro preset) | Hosting assumption |
| 3 | Lovable AI Gateway (chat completions) | `src/lib/discovery-service.server.ts` | AI |
| 4 | Lovable Connector Gateway (Telegram) | `src/lib/telegram.server.ts` | Messaging |
| 5 | `LOVABLE_API_KEY` secret | Supabase project secrets | Auth for #3/#4 |
| 6 | `TELEGRAM_API_KEY` (managed by Lovable Connector) | Supabase secrets | Telegram token holder |
| 7 | `lovable.auth.signInWithOAuth` broker for Google | `src/integrations/lovable` (import site in login) | OAuth flow |
| 8 | Auto‑generated Supabase helpers (`client.ts`, `client.server.ts`, `auth-middleware.ts`, `auth-attacher.ts`, `types.ts`) | `src/integrations/supabase/*` | Codegen — safe to keep, just stop treating as auto‑gen |
| 9 | `.lovable/` folder (memory, plan, docs) | repo root | Non‑runtime, delete or keep as docs |
| 10 | `bunfig.toml` `minimumReleaseAgeExcludes` for `@lovable.dev/*` | `bunfig.toml` | Remove once #1 is gone |
| 11 | `supabase/config.toml` (only holds `project_id`) | repo root | Replace with local Supabase CLI project |
| 12 | Lovable published domains (`*.lovable.app`, `instascanner.app` via Lovable DNS) | Hosting | Reissue via new host |
| 13 | Lovable "project memory" (`.lovable/memory/*`, `mem://…`) | Non‑runtime | Move to `docs/` or discard |
| 14 | Sandbox detection + dev-server bridge plugins in the Lovable Vite config | dev only | Replaced by plain Vite |

Nothing else in the app is Lovable‑bound: Supabase (DB/Auth/Storage/Cron), RapidAPI, and Telegram Bot API are all standard.

---

## 3. Replacement Plan

| Concern | Today | Replacement |
|---|---|---|
| Hosting / SSR runtime | Cloudflare Workers via Lovable | **Vercel** (recommended: TanStack Start has first‑class Nitro `vercel` preset). Alternatives: Netlify, Cloudflare Workers direct (`wrangler`), Railway (Node). |
| Vite config | `@lovable.dev/vite-tanstack-config` | Vanilla `vite.config.ts` using `@tanstack/react-start/plugin/vite` + `@vitejs/plugin-react` + `@tailwindcss/vite` + `vite-tsconfig-paths` + `nitro` preset for target host. |
| Database | Supabase (Lovable Cloud) | Same Supabase project, but managed directly through your own Supabase account (transfer project or dump+restore into a new project). |
| Auth | Supabase Auth via Lovable broker for Google | Native `supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } })`. Configure Google OAuth client + Supabase provider directly in Supabase dashboard. |
| App‑internal server logic | `createServerFn` | Unchanged — portable. |
| Public HTTP endpoints | TanStack server routes (`/api/public/**`) | Unchanged — portable. |
| Cron | Supabase `pg_cron` → HTTPS to `/api/public/hooks/*-tick` | Keep (works from any Postgres). Or GitHub Actions scheduled workflow / Vercel Cron / Railway cron hitting the same URLs with `x-cron-secret`. |
| Storage | Supabase Storage bucket `ig-publish` | Keep, or migrate to S3/R2 (change client + signed URL code). |
| AI (discovery scoring) | `ai.gateway.lovable.dev` w/ `LOVABLE_API_KEY` | **Google Gemini API** (drop‑in, same JSON model prompt) or **OpenAI**. Provide `GEMINI_API_KEY` / `OPENAI_API_KEY`. Small adapter in `src/lib/discovery-service.server.ts`. |
| Telegram | Lovable Connector Gateway | **Native Telegram Bot API** — replace fetches in `src/lib/telegram.server.ts` with `https://api.telegram.org/bot<TOKEN>/<method>`. Store bot token in `TELEGRAM_BOT_TOKEN` env. |
| Secrets | Supabase Edge Functions secrets + Lovable-managed | Host env vars (Vercel/Netlify/Railway project settings). Supabase Vault only for values needed inside `pg_cron` requests (already the case for `CRON_SECRET`). |
| OAuth broker | `lovable.auth.signInWithOAuth` | `supabase.auth.signInWithOAuth` directly. |

---

## 4. Export Checklist

Export everything except Lovable‑only assets:

**Code / repo (keep)**
- `src/**`, `public/**`, `supabase/migrations/**`, `supabase/config.toml`
- `package.json`, `bun.lockb` / `package-lock.json`, `tsconfig.json`, `eslint.config.js`, `.prettierrc`, `components.json`, `.gitignore`
- `README.md`, `AGENTS.md`

**Rewrite / replace**
- `vite.config.ts` (drop `@lovable.dev/vite-tanstack-config`)
- `bunfig.toml` (drop `minimumReleaseAgeExcludes`)
- `src/lib/telegram.server.ts` (Telegram Bot API direct)
- `src/lib/discovery-service.server.ts` (AI call → Gemini/OpenAI)
- Login screen (`src/routes/login.tsx`) — swap Lovable OAuth helper for Supabase native
- `src/routes/__root.tsx` — remove any `<script>`/head references to Lovable

**Drop**
- `@lovable.dev/*` deps (`package.json` devDependencies)
- `.lovable/` (or move to `docs/`)
- Any `mem://` references in code comments (non‑functional)

**Database export (via Supabase CLI or dashboard)**
```
supabase db dump --db-url "$SUPABASE_DB_URL" -f dump.sql
# includes: schema, RLS policies, functions, triggers, cron jobs, storage buckets
```
Also export storage bucket contents: `supabase storage download --recursive ig-publish ./ig-publish-backup`.

**Secrets to migrate**
Runtime (put in new host env): `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `RAPIDAPI_HOST`, `RAPIDAPI_KEY`, `RAPIDAPI_PATH`, `RAPIDAPI_USERNAME_PARAM`, `RAPIDAPI_PROFILE_PATH`, `RAPIDAPI_EXTRA_PARAMS`, `RAPIDAPI_LOCATION_EXTRA_PARAMS`, `TELEGRAM_BOT_TOKEN` (new), `GEMINI_API_KEY` or `OPENAI_API_KEY` (new).
Client‑visible: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID`.

---

## 5. Deployment Checklist (Vercel example)

1. **Own the Supabase project.** In Supabase dashboard → Settings → transfer to your org (or create new project + restore dump). Note new URL and keys.
2. **Rotate keys.** Regenerate `service_role`, `publishable`, and choose a new `CRON_SECRET` (`openssl rand -hex 32`).
3. **Reconfigure auth.**
   - Create Google OAuth Client (Google Cloud Console) → add `https://<supabase>.co/auth/v1/callback` as authorized redirect.
   - Supabase → Authentication → Providers → Google → paste client id/secret.
   - Site URL + Redirect URLs → your production domain + `http://localhost:3000` for dev.
4. **Rewrite Lovable-bound code** (see §4 "Rewrite / replace").
5. **Swap Vite config** to vanilla TanStack Start + Nitro `vercel` preset. Verify `bun run build` produces `.output/`.
6. **Create Vercel project** from the Git repo. Framework preset: "Other" (Vite/Nitro output).
7. **Set env vars** in Vercel (all from §4). Deploy.
8. **Point DNS.** Move `instascanner.app` / `www.instascanner.app` from Lovable to Vercel (A/CNAME per Vercel docs).
9. **Recreate cron.** In Supabase SQL editor:
   ```sql
   select cron.schedule('scanner-tick','* * * * *', $$
     select net.http_post(
       url:='https://instascanner.app/api/public/hooks/scanner-tick',
       headers:=jsonb_build_object('x-cron-secret', current_setting('app.cron_secret')));
   $$);
   ```
   Repeat for `discovery-tick`. Store `CRON_SECRET` via `alter database ... set app.cron_secret = '...'` or Supabase Vault.
10. **Reconfigure Telegram webhook** to `https://instascanner.app/api/public/telegram/webhook` (`curl https://api.telegram.org/bot<TOKEN>/setWebhook?url=...`).
11. **Smoke test** (see §6).

Alternate hosts:
- **Netlify**: Nitro `netlify` preset, same env vars, Netlify Scheduled Functions for cron.
- **Railway**: Nitro `node-server` preset, deploy as Node service, Railway cron for the two tick URLs.
- **Cloudflare Workers direct**: Nitro `cloudflare-module` preset + `wrangler deploy`; keep `nodejs_compat`.

---

## 6. Risk / Break Checklist

| Area | Likely break | Test |
|---|---|---|
| Google OAuth | Redirect mismatch after broker swap | Sign in end‑to‑end; verify session persists. |
| AI discovery scoring | JSON schema drift from Gemini/OpenAI vs. Lovable Gateway | Trigger a manual discovery tick, verify candidates enriched. |
| Telegram | Webhook signature/route changes | `getWebhookInfo` returns new URL, send `/start` to bot. |
| Cron | Wrong secret / URL after DNS switch | `curl -X POST -H "x-cron-secret: …" https://…/hooks/scanner-tick`. |
| Vite build | Missing plugins after removing Lovable config | `bun run build` locally, then `bun run preview`. |
| Storage | Signed URLs after project move | Download a known asset. |
| RLS | Roles missing in restored DB | Re-run `supabase/migrations/*` or verify `user_roles`. |
| SSR runtime | Node vs Workers differences (`sharp`, `child_process` etc.) | Not currently used — safe. |
| Env leakage | `VITE_` vs server-only | `bun run build` and grep `.output/public` for `SERVICE_ROLE`. |

---

## 7. Migration Runbook (step-by-step)

**Phase A — Freeze & Snapshot (30 min)**
1. Tag current git commit `pre-migration`.
2. `supabase db dump` → `dump.sql`. Download storage bucket.
3. Export secrets list from Lovable (write values into a password manager).
4. Disable pg_cron jobs: `select cron.unschedule('scanner-tick'); select cron.unschedule('discovery-tick');`

**Phase B — Code Decoupling (½–1 day)**
5. Branch `chore/de-lovable`.
6. Remove `@lovable.dev/*` deps; replace `vite.config.ts` with vanilla TanStack Start config.
7. Replace `lovable.auth.signInWithOAuth` with `supabase.auth.signInWithOAuth`.
8. Replace Lovable AI Gateway call with Gemini (or OpenAI) client (adapter kept in `discovery-service.server.ts`).
9. Replace Lovable Telegram Gateway with direct Telegram Bot API calls.
10. `bun install && bun run build && bun run preview` → verify locally against staging Supabase.
11. Run `tsgo` typecheck + `eslint`.

**Phase C — Infra Provision (½ day)**
12. Provision Supabase project you own (or transfer). Load `dump.sql`. Restore storage.
13. Create Google OAuth credentials; wire Supabase provider.
14. Create Vercel project; set env vars; deploy preview.
15. Point staging DNS (e.g. `staging.instascanner.app`) → Vercel; smoke test.

**Phase D — Cutover (2 h window)**
16. Put Lovable app in "read‑only" (disable writes by pausing cron on old project).
17. Take final Supabase dump; diff against Phase A dump; apply delta to new project.
18. Switch DNS `instascanner.app` + `www` → Vercel.
19. Recreate pg_cron jobs on new project pointing to production URL.
20. `setWebhook` for Telegram bot → production URL.
21. Run smoke tests (below).

**Phase E — Post‑cutover**
22. Monitor Vercel logs + Supabase logs for 24 h.
23. Rotate any credentials that briefly overlapped both platforms.
24. Delete Lovable project after 7 days of stable operation.

---

### Required Environment Variables (final)

Server (host secret store):
```
SUPABASE_URL
SUPABASE_PUBLISHABLE_KEY
SUPABASE_SERVICE_ROLE_KEY
CRON_SECRET
RAPIDAPI_HOST
RAPIDAPI_KEY
RAPIDAPI_PATH
RAPIDAPI_USERNAME_PARAM
RAPIDAPI_PROFILE_PATH
RAPIDAPI_EXTRA_PARAMS
RAPIDAPI_LOCATION_EXTRA_PARAMS
TELEGRAM_BOT_TOKEN
GEMINI_API_KEY            # or OPENAI_API_KEY
```
Client:
```
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
VITE_SUPABASE_PROJECT_ID
```

### Deployment Targets
- **Recommended**: Vercel (SSR) + Supabase (DB/Auth/Storage/Cron).
- Alternates: Netlify + Supabase, Cloudflare Workers (wrangler) + Supabase, Railway (Node) + Supabase.

### Database Migration Order
1. Schema + functions + triggers (`supabase db push` of all files in `supabase/migrations/` in filename order).
2. Storage bucket `ig-publish` (create + set `public=false`).
3. Data restore from `dump.sql` (data-only rows).
4. Recreate pg_cron jobs.
5. Set Vault / `app.cron_secret` GUC.

### Smoke Tests
1. `GET /` → landing OK.
2. Sign in with Google → land in `/` authenticated.
3. Navigate `/scanner`, `/discovery`, `/assets`, `/downloads`, `/telegram` → no 500s.
4. Trigger scanner: `curl -X POST -H "x-cron-secret: $CRON_SECRET" https://<domain>/api/public/hooks/scanner-tick` → `{ ok: true }`.
5. Trigger discovery tick likewise.
6. Approve an asset → check `publish_jobs` row appears.
7. Telegram `/start` → bot replies.
8. Download an asset → signed URL resolves.

### Rollback Plan
- DNS: revert `instascanner.app` CNAME/A back to Lovable (TTL 300 s recommended during cutover).
- Supabase: keep old project alive read‑only for 7 days; re-enable its pg_cron jobs to resume.
- Telegram: `setWebhook` back to Lovable URL.
- Code: `git revert` the `chore/de-lovable` branch or redeploy `pre-migration` tag on Lovable.
- Data delta since cutover: replay from new Supabase → old via `pg_dump --data-only` on tables written during the window.

---

## Notes
- Auto-generated Supabase helpers (`client.ts`, `client.server.ts`, `auth-middleware.ts`, `auth-attacher.ts`, `types.ts`) are portable — after export, just delete the "auto-generated" comment and treat them as regular source files. Regenerate `types.ts` with `supabase gen types typescript --project-id <ref> > src/integrations/supabase/types.ts`.
- No payment/checkout integration exists in the project today — nothing to migrate there.
- No Supabase Edge Functions are used; all server logic is TanStack `createServerFn` + server routes, which is host‑agnostic.
