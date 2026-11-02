# SmartLink provider rollout

## Implemented
- Separate studio canvas: responsive 16/24/32px inset and capped width.
- Default selection Bitly + TinyURL, arbitrary integer count 1–1000; deterministic equal split with remainder. Quick amounts 10/100/500/1000. InstaScanner native links remain selectable.
- Official server-only API adapters. Bitly POST /v4/shorten; TinyURL POST /create. Each external link points to a distinct central SmartLink for common analytics, deactivation and target edits.
- Additive link fields: provider, provider_state, short_url, provider_error, provider_started_at. Existing links remain ready/native.
- Persisted pending queue, explicit resume/pause while browser is open, globally serialized provider calls, local 20 requests/min/provider budget plus existing auth/rate limits.
- Failed responses stop that provider. User can release confirmed failures after fixing the provider account. Unconfirmed responses and stale in-flight requests are never automatically retried; they require reconciliation against the provider account before an operator clears them.
- Per-provider clicks, heuristic human clicks, ready/pending/failed/unconfirmed counts; top 10 links; common campaign/account/date/device/country/link filters. Clicks have 30-day retention; creation statuses are lifetime for the selected links. No fabricated revenue or provider uptime.
- CSV includes provider, state and public URL only when ready. Draft generation only uses ready links and prefers the external short URL.

## Configuration still required
Server secrets: BITLY_ACCESS_TOKEN, BITLY_GROUP_GUID, TINYURL_API_TOKEN. Use provider accounts with suitable creation permissions and quotas. Do not put credentials in chat, source code or browser storage. No new subscription purchased.

## Validation
314 unit tests passed, TypeScript and production build passed. PostgreSQL tests cover 1,000 unique links, provider 51/50 allocation for 101 links, idempotency including provider order, cross-user isolation, concurrent claims, provider circuit stop and existing authorization/consent/retention checks. Adapters tested with mocked HTTP responses (success, missing credentials, 429, lost response, unexpected domain). External live calls require credentials; no external links created in these tests.

## Limitations
Only Bitly, TinyURL and native InstaScanner are implemented options. The allocation helper supports N providers (including 4-way 25/25/25/25, tested), but adding another real provider needs its own adapter. Pending work survives closing the page; execution resumes on demand, not in an autonomous background worker. Provider errors reflect creation calls rather than a continuous outage monitor. Revenue and conversions are not yet connected.

## Sources
https://dev.bitly.com/api-reference/
https://dev.bitly.com/docs/getting-started/rate-limits/
https://tinyurl.com/blog/create-tinyurl-links-google-sheets/
