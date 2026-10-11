# Model channel announcements

The existing Content Review page now exposes separate Kiikii and Tuuva announcement settings. The shared private review bot posts a short announcement and an Instagram URL button only after a successful approved cloud publication. Review approval alone never triggers a public post.

## Deployment and activation

1. Apply migration `20261011102726_channel_alerts.sql`. It creates the durable outbox, owner-only configuration, service-only commands, and a minutely pg_cron call authenticated with the existing Vault CRON_SECRET. Do not expose that secret.
2. Deploy the web application and the updated `content-publisher` edge function. The latter records the actual Instagram account ID on each successful publication. Its existing custom authentication remains unchanged.
3. Keep `CONTENT_REVIEW_BOT_TOKEN` pointing to bot 8905298936. Do not change FanWake's webhook, rotate its token, or consume getUpdates.
4. Give the bot channel administrator permission to post. This also allows deleting its own channel messages. Use each channel's Bot prüfen button to verify access.
5. Explicitly associate each model with its own active Instagram connection. FollowerStar is not a model account. Both mappings intentionally start empty; no legacy posts are backfilled.

## Behavior and limits

- Maximum one announcement per channel per Europe/Berlin calendar day, including ambiguous sends. A durable reservation precedes the API call; timeouts are never automatically resent.
- Posts must be approved, successfully published within the past two hours, newer than activation, and match the exact recorded publishing account. Stories, comments, invalid links and failed publications are excluded.
- Message ID, channel ID and Telegram's timestamp are saved. Deletion is due twelve hours later and checked every minute. Pausing or removing account mapping does not cancel outstanding deletions.
- Deletion uses idempotent `deleteMessages` and retries after five minutes. Expired leases recover after three minutes. Failures past 47 hours are surfaced for manual attention before Telegram's 48-hour limit.
- If Telegram accepted a send but its response was lost, the message ID is unknown and deletion cannot be scheduled automatically. The UI reports the ambiguous send for manual checking; it does not duplicate it.
- This detects cloud publisher results only. Manually posted Instagram content is not ingested by this feature. Current account connection constraints in the publisher are unchanged.

## Verification

`npm test`, `node tests/channel-alerts-db.mjs`, TypeScript, scoped ESLint and production build. The DB test executes the actual migration against PGlite, with only infrastructure schemas stubbed. It covers account routing, eligibility, per-channel daily limits, uncertain sends, the 12-hour timestamp, paused/unmapped deletion, retries and leases, owner authorization and RLS. No public Instagram or Telegram post is needed for these tests.
