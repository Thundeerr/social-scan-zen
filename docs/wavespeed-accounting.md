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
