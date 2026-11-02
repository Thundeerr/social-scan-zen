# SmartLink Studio implementation plan

## Existing architecture (inspected 2026-11-02)

React 19 / TanStack Start, React Query, Tailwind and shadcn components; Recharts already installed. Supabase Auth, PostgreSQL and server-side service client. Cloudflare-targeted Nitro build via Lovable's Vite preset. Existing `ig_connections`, OAuth and signed inbox webhooks; Reel Inbox messaging is scoped to an existing content intake workflow. No existing SmartLink module found. README describes the original frontend prototype and is superseded by the implemented backend and this task.

## MVP

1. Add service-only, transactional PostgreSQL commands following Reel Inbox's pattern, with owner/cofounder checks, per-user data isolation and RLS on every table.
2. Create campaigns, idempotent batches of 1–1,000 opaque random links, activation/target updates and recipient assignment. Domains are an operator-configured allowlist, never arbitrary Host headers.
3. Reuse this application's Cloudflare request entry for `/s/:slug`; transparent 302, no cache, no cookie, no user-agent-dependent target. Track asynchronously with the actual runtime waitUntil; await storage where that capability is unavailable. Fail open on tracking failure, fail closed on unavailable lookup. No new queue subscription for the MVP.
4. SQL aggregates, all requested filters, paginated link table and export, 30-second foreground polling. Human/bot classification and unique visitor figures are explicitly estimates. CTR is unavailable without verified delivery/impression data.
5. Consent/suppression, recipient deduplication, template-based draft generation and message status foundation; no outbound API sender until account permissions and verified inbound messaging windows are wired in.
6. Exercise migrations in isolated PGlite, unit/integration tests, existing suite and build. Keep existing unrelated changes untouched.

## Meta verification

Meta's official Postman collection requires the recipient to have messaged the professional account and `instagram_business_manage_messages`: https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api?entity=request-23987686-3fe78620-2258-44b6-893f-42d76c7200d7
Direct developer documentation returned HTTP 429 during verification: https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/messaging-api
An imported contact or consent record alone does not establish API messaging eligibility. This MVP therefore manages drafts only and cannot send cold/bulk DMs. A later sender must verify official permission, user-initiated conversation, current allowed window and platform responses at send time, pause on restrictions and honor suppression. No filter evasion or link cloaking.

## Privacy and metrics

Do not persist raw IPs or full user agents/referrer paths. Daily, campaign-scoped HMAC pseudonyms from trusted edge IP plus coarse device category produce estimated visitor-days (not exact people). Country uses trusted Cloudflare metadata only; unknown values remain unknown. Retain events for 30 days; schedule the provided service-only purge function daily. Aggregate figures describe retained events only. No fabricated conversion or delivery counts.

## Delivered implementation

- `/smartlinks`, `/smartlinks/campaigns`, `/smartlinks/analytics`, integrated into desktop and mobile navigation.
- Campaign creation/editing/status/templates; transactional batches up to 1,000, request-ID replay protection, pagination, search, sort, CSV with formula escaping, bulk disable/enable, target/account/recipient edits.
- Consent evidence, case-insensitive recipient deduplication, account-wide suppression, serialized opt-outs/drafts and automatic one-to-one assignment of up to 1,000 free links to eligible recipients. Draft generation is idempotent; importing a suppressed recipient never reactivates them.
- Authenticated TanStack server functions reuse existing bearer middleware, additionally verify the live Supabase user, reject anonymous users, and enforce owner/cofounder roles. Database commands independently check ownership. No service key in the browser.
- `/s/:slug` supports GET/HEAD with identical destinations for humans and bots, 302/no-store, 404/410/405/429/503 handling, asynchronous event persistence through Nitro request `waitUntil`, and conservative awaited fallback elsewhere.
- Analytics include total, estimated human, bot/preview, unknown, estimated visitor-days, timeline, countries, devices, referrers, top links and campaigns. Filters: last 1/7/14/30 days, campaign, account, link ID, device and country; 30-second foreground polling.

## Files

| Area         | Files                                                                                                                                               |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| UI           | `src/components/smartlink-studio.tsx`, four `src/routes/_authenticated/smartlinks*.tsx` routes                                                      |
| Navigation   | `src/components/layout/AppSidebar.tsx`, `MobileNav.tsx`, generated `src/routeTree.gen.ts`                                                           |
| Backend      | `src/lib/smartlinks.ts`, `smartlinks.server.ts`, `smartlinks.functions.ts`, `src/server.ts`                                                         |
| Database     | `supabase/migrations/20261102120000_smartlink_studio.sql`, `20261102120100_smartlink_retention.sql`                                                 |
| Verification | `src/lib/smartlinks.test.ts`, `smartlinks-auth.test.ts`, `tests/smartlinks-db.mjs`, `tests/smartlinks.vitest.config.ts`, `tests/smartlink-preview/` |
| Supporting   | `package.json` test scripts, `.gitignore` temporary test directory, this document and PNG previews                                                  |

The pre-existing modification in `supabase/functions/_shared/instagram-reel.ts` is unrelated and intentionally untouched.

## Database migrations and deployment

The schema migration adds eight `sl_*` tables and service-only command, analytics, rate and purge functions. The second migration schedules `sl_purge()` daily at 03:17 UTC using the existing pg_cron infrastructure. Events older than 30 days disappear from analytics immediately and are physically removed at the next daily run (up to 24 hours later). The migrations were prepared directly because this environment has no Supabase CLI and CLI installation failed due to DNS restrictions; the schema was executed against isolated PostgreSQL via PGlite.

Production has **not** been changed. The repository targets Supabase project `vkudzmoaqskmglfajzkz`; this project is absent from the connected Supabase account's project list. Do not apply this schema to another project.

Deployment sequence for an environment with access to the existing project:

1. Review pending migrations against the existing database and take the normal database backup. Link Supabase CLI to `vkudzmoaqskmglfajzkz`, run `supabase db push --dry-run`, then apply the reviewed pending migrations. Avoid blindly pushing unrelated pending migrations.
2. Configure server-only `SMARTLINK_DOMAINS`, a comma-separated list of verified HTTPS origins, e.g. `https://go.your-domain.com`. Configure `SMARTLINK_HASH_SECRET` with a cryptographically random secret of at least 32 characters. Reuse the existing Supabase server credentials and authentication configuration. Do not prefix secrets with `VITE_`.
3. Route each selected domain, including `/s/*`, to this same Cloudflare-targeted application with TLS. Adding a domain to the environment is an allowlist operation; it does not provision DNS or certificates. Retain old domains while their links exist. No new Worker service or paid queue is required.
4. Build and deploy the existing application through its normal deployment pipeline. This branch does not change hosting infrastructure.
5. Confirm the named `smartlink-retention-daily` job exists and succeeds. Verify a signed-out request cannot call management functions; test one owned link on its real public domain with GET/HEAD, disabled state and its analytics result. Confirm trusted country metadata and visitor hashing on Cloudflare. Then generate/export 1,000 links and sample redirects.

If reverting the frontend, retain redirect handling and database tables for already distributed links; disable affected links explicitly instead of dropping data.

## Tests and reproducibility

```sh
npm run test:smartlinks
npm run test:smartlinks-db
npm run test:reel-inbox-db
npx vitest run --config tests/smartlinks.vitest.config.ts
npx tsc --noEmit
npm run build
```

The dedicated test config avoids running the production Cloudflare bundler during Node unit tests. On this Windows sandbox, TEMP and TMP were set to the ignored `.smartlink-temp` directory to avoid temporary-file rename restrictions.

UI verification uses the **real React component with synthetic API fixtures**, never an authentication bypass in the app. Build it with `npx vite build --config tests/smartlink-preview/config.ts`; run `node tests/smartlink-preview/check.mjs` with Playwright available, or `PLAYWRIGHT_MODULE` pointing to its installed `index.mjs`. The script fulfills compiled assets directly from disk, uses an installed Chrome browser, exercises generation/export/bulk actions and checks mobile overflow. It makes no production API calls. The PNG files are fixture previews, not screenshots of live campaign results.

## Known MVP limits and next stage

### Verification results (2026-11-02)

- 26 SmartLink validation, redirect/tracking and live-session authorization tests: passed.
- Isolated PostgreSQL migration/command test: passed, including 1,000 unique links, replay/conflict handling, cross-user denial, 1,000-recipient import and automatic assignment, suppression, drafts, filtered aggregates, role grants, rate limits and event expiry.
- Existing Reel Inbox PostgreSQL regression suites: all three passed.
- Full unit run before adding the five session tests: 191 passed, two failed in `src/lib/model-trial.test.ts`. Both failures assert `is_ai_generated: true`, while the pre-existing uncommitted edit in `supabase/functions/_shared/instagram-reel.ts` sets it to false. This change and its tests were not modified by this work.
- TypeScript `--noEmit`, targeted ESLint and production Cloudflare build: passed. Existing deprecation and chunk-size warnings remain.
- Browser UI test using synthetic fixtures: passed for a 1,000-link generation, 1,000-row CSV export, bulk deactivation, analytics rendering and 390px mobile overflow check. Screenshots: `smartlink-analytics.png`, `smartlink-generator.png`, `smartlink-mobile.png`.

### Remaining limits

- No outbound Instagram sender, API message window verification, delivery receipts, conversions or account-warning ingestion in this module. Status/error fields are prepared; they do not imply a working sender. Next stage: approved messaging permissions, verified inbound-conversation eligibility, queue state machine, webhook receipts and automatic pause on platform restrictions.
- CTR is intentionally unavailable without a verified denominator. Visitors are daily campaign-scoped estimates; they may double-count across days/campaigns and merge users sharing an IP/device category. Bot classification is heuristic. Outside trusted Cloudflare execution, country and visitor identity remain unknown.
- Event delivery is best-effort. Tracking failure does not block a successful redirect and events may be lost. A durable queue and aggregates are a later scaling step if observed load warrants them.
- Limits: 1,000 links/batch, 5,000 links/operator/hour, 100,000 links/operator, 500 campaigns/operator, 120 management calls/operator/minute, 3,000 redirect attempts/minute globally, 60 stored events/trusted IP/minute. These are internal safeguards, not Meta limits. One 1,000-link CSV export requires ten paginated requests; very large exports can hit management limits and need a background export later.
- Account filters reflect current link assignments, not historical account snapshots. Search/sort currently cover slug/target and creation date. Date filters are rolling presets, not arbitrary start/end dates.
- Consent/evidence, suppression, campaign and link records are retained until explicit lifecycle cleanup; only click events and transient rate counters have scheduled expiry. Recipient deletion/access requests require operator handling in this MVP.
- Custom-domain DNS/TLS, real Cloudflare metadata, production credentials, cron execution and public-domain end-to-end behavior still require deployment verification. No live or high-load production test was possible without access to the correct project.


## Deployment follow-up (2026-11-02)

The implementation was integrated with all 43 newer main-branch commits through e3080188a056751e2e7a1ad54046f5a82d9f8f76, including the newer shared navigation. The full merged unit suite now passes 307 tests; the previous Reel flag failures are resolved in upstream. TypeScript, production build, PostgreSQL batch tests and the fixture browser test pass. Local build tools use the available installed dependencies; the hosting build uses the unchanged upstream lockfile.

Production database access was recovered via the direct Lovable database connector. Both SmartLink migrations and the daily cron job have been applied and recorded. A 1,000-link production database test verified isolation, RLS and aggregation in a rolled-back transaction. SMARTLINK_DOMAINS is configured to https://instascanner.app; SMARTLINK_HASH_SECRET was generated into project secrets without logging its value. The original section above records the initial handoff state; it is superseded by this follow-up.

Design changes and exact external-asset provenance are documented in design-finish.md. Publication and public redirect verification are the final deployment steps.
