# WaveSpeed accounting

Accounting runs separately from generation. The VPS systemd timer checks the authenticated
`/api/public/business-report/wavespeed` endpoint every five minutes. The server requests
one daily sync at/after 19:50 Europe/Berlin, or an explicit UI refresh. Ten-minute
claim cooldown prevents repeated provider reads. No generation container is started.

The collector reads existing keys from `docker inspect kiikii-model-worker` in memory.
It calls only `GET /api/v3/balance` and `POST /api/v3/billings/search`, paginates all
records for the current Berlin calendar month, and submits normalized accounting data.
Neither key is logged or sent to the browser. Redirects are refused. The app verifies
the existing worker-token hash, fixed owner, bounded body and strict schema.

Billing UUIDs deduplicate records. Deduct and refund are separate, fractional cents are
preserved until display. Failed predictions are never assumed refunded. Unknown billing
types are flagged and excluded from consumption. Task IDs map only to that owner's jobs;
missing or ambiguous matches remain unassigned. Monthly archives retain collected ledgers;
the first release collects the current month only. They are snapshots as of the displayed
time, not a guarantee that late provider adjustments have finished.

Cash/top-ups and consumption are separate; do not add them. Actual Kiikii costs remain
incomplete until shared expenses and unmatched generation tasks are assigned. No profit
or acquisition-cost assertion is made from mismatched periods.

Deploy: apply migration, deploy app, install `business_analytics.py` and the adjacent
systemd service/timer under `/opt/kiikii-pipeline/cloud/model-worker/` and `/etc/systemd/system/`.
Enable only `kiikii-business-analytics.timer`. Run its oneshot service for verification.
No worker image rebuild or pipeline-enable operation is needed. Report cron remains 20:00
Europe/Berlin. Provider errors preserve the last good report and surface an error.

Checks: `node tests/wavespeed-analytics-db.mjs`; Vitest `wavespeed-analytics.test.ts`;
`python -m unittest discover -s cloud/model-worker -p test_business_analytics.py`.
Live: request refresh, wait for the collector, compare provider balance and row totals,
check timestamp and repeated-read idempotency. Never submit test predictions.

Outstanding: CupidBot scoped account filter is awaiting vendor support; its automatic
sync remains paused. Link.me/Tapclick remain manual, with timestamps, until supported
access is verified. Credentials are never requested in chat.

## Cost allocation and external task evidence (2026-10-28)

`business_cost_allocations` holds versioned monthly allocations per owner and currency.
It is a planning ledger, not a replacement for bank transactions. The latest effective
version per reference is displayed; historic `business_cost_entries` are preserved.
Once an allocation exists, old fixed USD estimates are excluded from current planning.
EUR and USD are kept separate; USD budget percentages exclude EUR and are explicitly
incomplete until an exchange-rate basis exists. No automatic generation stop is added.

`wavespeed_task_attributions` records verified provider IDs from external manifests,
with the evidence path and SHA-256. The collector and read-side status combine these
with pipeline job mappings. Disagreement between models leaves a task unassigned.
The server only returns aggregate totals, never the billing ledger or evidence paths.

Monthly generation planning is explicitly a 30-day run rate: current calendar-month
net charges divided by elapsed calendar days (including the partial current day),
multiplied by 30. Both characters retain their observed workload; the remaining unknown
amount is shown separately and included in the account total. This is not an average
of completed months or a cost per approved video; images and revisions are included.

Checks: `node tests/business-cost-allocation-db.mjs`, the allocation and WaveSpeed
Vitest suites, `tsc --noEmit`, and the production build. No generation jobs required.
