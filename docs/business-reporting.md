# Kiikii reporting

`/business` shows a read-only overview; `An mein Telegram` sends a report through the existing private review bot. `Status Kiikii` or `/status` works after the operator connects the status webhook. Setup refuses to replace any different webhook and preserves pending updates. Review mini-app actions remain unchanged.

The minute tick `/api/public/business-report/tick` authenticates with the existing publisher cron secret. Settings default disabled. Once enabled it sends the first report at/after 20:00 Europe/Berlin each day, including that day's live data to the actual send time. Keys prevent repeated daily reports and threshold alerts. Delivery errors are marked uncertain, never automatically retried, because Telegram sendMessage has no idempotency key. Check business_report_deliveries before any manual resend.

## Evidence and accounting

- business_cost_entries: USD cents; fixed recurring monthly costs, prepaid topups, actual usage separated. Shared costs are not silently attributed. end_day ends recurrence.
- business_metric_snapshots: explicit source, observed time and reporting period. These are historical/manual evidence until a verified adapter updates them. Source values must never silently become today's values.
- business_live_status: owner/model-scoped current queue, reviews, publication counts and reservation estimates. Posts without a linked Kiikii review are excluded, not guessed.
- $400 target is a warning threshold, not a generation cap. 70/85/95/100% are deduplicated by month. Forecast extrapolates payments, not actual consumption. Missing shared allocations produce a separate warning. Report continues to call the cost picture incomplete.

No external analytics connector has been added. Fanvue, Closer, Instagram and Link.me snapshots must be refreshed from verified API/export data or entered by an operator. Tapclick has no verified snapshot. Per-follower/sub acquisition costs stay unknown until costs and outcomes cover the same period with reliable attribution. WaveSpeed reservations are not billing data.

All writes are server-side service-role operations. Authenticated users can only read their own rows. Reports can only be sent to the configured installation owner's private Telegram chat.

## Verify

`npm test -- src/lib/business-report.test.ts src/lib/business-report.server.test.ts`

`node tests/business-report-db.mjs`

`npx tsc --noEmit` and `npm run build`.

No generation jobs, publishing, paid APIs or worker start are required for these checks.
