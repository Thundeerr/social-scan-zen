# Kiikii website replies

An incoming Instagram DM to `kiikii.bat` receives one short English reply directing
the visitor to `https://chat.kiiki.info`. Every variant explicitly says conversations
do not happen in IG DMs. The 30 approved variants live in `src/lib/kiikii-dm-replies.json`.
No AI provider or Inro subscription is used by this responder. The destination
website is a separate Cupid-hosted product; its availability is independent of this code.

## Setup

1. Apply `20261102180531_kiikii_dm_redirect.sql` before deploying the app.
2. Open `https://instascanner.app/reel-inbox#kiikii-dm-redirect` as owner/cofounder.
3. Select **Connect Kiikii messaging**, sign in as `kiikii.bat`, and approve
   `instagram_business_manage_messages` along with existing publishing/insights permissions.
   Missing/declined scopes or the wrong account leave the existing publishing token intact.
4. Select **Enable test for user_diary01**. This checks the token identity, adds
   `messages` to the account subscription while retaining existing fields, then reads
   it back. No reply is sent by enabling the test.
5. Send a fresh DM from `user_diary01`. Confirm one reply actually arrives and
   its link opens the website. Meta accepting a send is not delivery confirmation.
6. Select **Enable for all visitors** after that test. Keep other IG responders
   paused to prevent parallel replies. Inro's AI was paused before this rollout.

The existing signed webhook at `/api/public/instagram/inbox-webhook` is shared
with the FollowerStar reel collector. Its URL, signature key and collector sender
allowlist are unchanged. FollowerStar received a real DM on 2026-11-02 before this
change, so its app-level webhook already had a working path. Kiikii delivery and
Meta access eligibility must still be tested with the actual connected account.

## Delivery and safety behavior

- Incoming messages only, from the exact Kiikii receiver ID. Echoes, deletions,
  read receipts, unsupported/empty events and stale events are ignored.
- At most one HTTP send attempt per contact per 24 hours, even on failures.
  The next eligible day is triggered by a NEW incoming message, never a timer.
- Reservations are serialized and durable before contacting Meta. Replayed
  message IDs and concurrent messages cannot trigger another attempt.
- A random variant excludes the contact's previous variant. No message text is
  stored; private receipts store sender ID, message-ID hash, times and outcome.
- Explicit `stop`, `unsubscribe`, `don't message me` and the documented German
  equivalents suppress future replies. Stop is processed during cooldown too.
- If Meta times out, returns an ambiguous response, or the process dies after a
  reservation, do not automatically resend. `reserved`/`uncertain` requires review.
  This favors preventing duplicates over guaranteed delivery after a crash.
- Failed sends retain the 24-hour cooldown. Do not clear a reservation or cooldown
  to retry an uncertain send. Pause stops new reservations; an already in-flight
  HTTP request cannot be recalled.
- New tables use RLS plus server-only grants; authenticated clients have no direct
  table or RPC access. Server actions revalidate the user and owner/cofounder role.

## Validation

`npx vitest run src/lib/kiikii-dm-redirect.test.ts src/lib/reel-inbox-dm.test.ts src/lib/instagram-oauth.test.ts src/lib/model-oauth.test.ts`

`node tests/kiikii-dm-redirect-db.mjs`

The schema test checks real SQL role restrictions, dedupe, competing reservations,
cooldown, opt-out persistence, test sender restriction and random no-repeat selection.
The HTTP tests simulate Meta; they do not send DMs to real users.

Reference: [Meta's official Instagram Send API collection](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api?entity=request-23987686-3fe78620-2258-44b6-893f-42d76c7200d7).
