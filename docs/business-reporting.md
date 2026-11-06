# Kiikii reporting

`/business` shows a read-only overview; `An mein Telegram` sends a report through the existing private review bot. Each report has a `Status Kiikii` button opening the authenticated existing Telegram mini-app, which also has its own status button. No text command or new webhook is installed: the bot already has an active receiver, which must remain untouched. Review actions remain unchanged.

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


## Audit repairs (2026-11-06, prepared locally)

Profit estimates carry confirmed recurring costs across month boundaries instead of requiring old manual snapshots to have the same period as current Fanvue revenue. The UI and private report label estimates, cost dates, missing sources and stale exchange rates. Weekly tariffs use seven days; monthly costs use the actual number of calendar days, including leap years. Dated tariff cancellations and allocation versions are integrated over the revenue period. A newly confirmed fixed-cost start is not backdated. Missing earlier coverage is disclosed. Forecasts use current confirmed rates.

The calculation accepts the full snapshot history and allocation history; passing only one latest snapshot per source loses tariff changes. The server returns its computed `profit` to the UI. Recent API imports must not age manual costs out of the bounded query window. The latest dated valid ECB rate wins over a later import of an older rate; future rates are ignored. Missing revenue/FX is unavailable, not zero. Historical invoices and conversation values are not added again on top of prorated recurring rates.

The 2026-11-05 Cupid purchase is a separate cash transaction. After matching its receipt, insert exactly one owner-scoped `business_cost_entries` row with a stable invoice-based reference, `scope=kiikii`, `kind=topup`, `cents=1200`, `day=2026-11-05`, and a note explaining the 100 prepaid conversations and evidence. The table stores USD cents and has a unique `(user_id,reference)` constraint. Use conflict-do-nothing and then compare all returned fields; a conflicting amount/date is an error, not permission to overwrite history. This cash purchase must not be entered as another recurring monthly tariff or duplicated as consumption. No transaction was inserted by the code fix.

Reporting and visitor-display changes need an application build/deployment. They do not require a paid API call, generation worker start or posting retry. Worker-health changes elsewhere in this repair have their own database migration dependencies.
