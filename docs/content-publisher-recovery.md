# Publisher leases and uncertain Instagram outcomes

The fenced publisher and migration `20261106181755_content_publisher_fenced_recovery.sql` must be deployed together. This change does not publish, retry, or repair historical posts by itself.

## Behavior

- A claim returns a post ID and a unique lease token. Every publication state write, parent completion/failure and publishing event checks that token and its expiry while holding the parent row lock.
- Renewals happen before every Instagram POST, including carousel children. They also check the publishing pause switch. A stale worker cannot extend or release a newer lease.
- Before `media_publish` or first-comment POST, a durable action reservation is stored. The returned media/comment ID and event are saved together before optional permalink retrieval.
- An interrupted reserved action, or provider `PUBLISHED` without a saved media ID, requires reconciliation. The publication becomes `failed` with `recovery_required=true`; it is not automatically resent. Normal scheduling cannot clear this hold.
- Container polling waits at least 60 seconds between claims. A container still processing after 30 minutes is stopped for review. Queue ordering lets other due posts progress.
- Existing status values remain unchanged. Review the saved error to distinguish a processing timeout from an uncertain external action. These changes prioritize avoiding duplicate posts/comments; an action reserved immediately before a crash may need review even when nothing was actually sent.
- The migration quarantines legacy containers lacking media receipts and potentially interrupted first comments. This includes the four historical failed-parent/publishing-child cases; it does not infer that any of them were delivered. Some old containers that were never published will also require review because the old worker stored no durable send reservation.

## Deployment and rollback

1. Record the existing pause state, deployed publisher version and relevant function definitions. Pause publishing for the affected operators and stop new publisher invocations. Wait for prior invocations to finish, not merely for their two-minute lease to expire. Do not restart a still-running old worker during the transition.
2. Apply the migration and deploy the matching Edge Function. The old claim/release RPCs fail closed after migration, so an accidental old invocation cannot start new work. An old invocation already in progress is why draining is mandatory.
3. Verify the new RPCs, grants and Edge Function version. An idle/paused smoke check must create no provider POST. Run `node tests/content-publisher-recovery.mjs` and the existing publisher tests before release.
4. Restore only the previously enabled publishing state. Verify a separately approved normal post when one is available; do not use any of the four historical uncertain posts as a smoke test.

To roll back, pause and drain again. Do not deploy the old publisher alone: its unfenced RPCs intentionally reject calls. Keep the new reservation/receipt fields and evidence intact. Prefer rolling forward; any rollback must restore a compatible function pair and retain holds for all uncertain actions.

The repository has no GitHub deployment workflow. A Lovable web deployment alone is not evidence that the Edge Function was updated. Once authenticated with the required `edge_functions_write` scope, the installed CLI's verified deployment syntax is:

```powershell
npx --no-install supabase functions deploy content-publisher --remote=vkudzmoaqskmglfajzkz --use-api --no-verify-jwt
```

The existing `verify_jwt=false` setting is retained because the handler authenticates cron secrets/operator sessions itself. Do not apply the publisher migration while Edge deployment access is unavailable. Other independent, backward-compatible migrations do not require this publisher upgrade.

## Reconciliation

Use read-only Instagram access first. Match the exact account and content against provider media/comment IDs, timestamps and permalink; a matching caption alone is insufficient. `PUBLISHED` proves the container was used, but does not supply the missing media ID. A missing item in a short/paginated account listing does not prove non-delivery.

For a positively identified delivery, an authorized operator can record its verified ID, account, permalink and timestamp in a transaction that locks the parent and child, asserts the expected IDs/current state and absence of a live lease, and appends an evidence event. Clear `recovery_required` only in that same transaction. Mark the parent complete only when all its automatic channels are complete; do not mark unsent comments/stories delivered.

If non-delivery cannot be established, retain the hold. Do not reset `external_action_started_at`, create a replacement container or manually requeue solely because a request timed out. This migration deliberately does not guess the outcomes of the four historical failures or expose a general browser-side bypass.
