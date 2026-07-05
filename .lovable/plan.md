## Smart Notification System

Replace the "notify on any new asset" trigger with a strict signal filter, and reshape the Telegram payload into a scan-cycle digest with a top-3 preview. No new UI surfaces — the existing Telegram row in Settings remains the single control (on/off + chat id + test).

### Trigger rules (ALL must be true for an asset to count as a signal)

1. Source account tier is **S** or **A** (from `tracked_accounts.tier`).
2. AI verdict is **KEEP** (from `asset_status.ai_verdict`).
3. AI confidence ≥ **0.80** (from `asset_status.ai_confidence`).
4. Asset currently lives in the **Priority** review state (i.e. is in the operator's Priority queue after AI ranking, not Later/Reviewed/Dismissed/Archived).

If zero assets in the just-finished scan meet all four rules → **stay silent**. No "scan complete" message, no summary. Silence is the default — the operator sees a filled Priority queue in-app when they return.

### Cadence

- One message per scan cycle, sent immediately when the scan finishes.
- No quiet hours, no rate limiting beyond "one per scan".
- If two scans run back-to-back and both qualify, they send two messages — that matches how the operator already thinks about scan cycles.

### Message shape

```text
🛰 <N> priority signals — <scan window>

1. S · @handle — <verdict conf%> · <2–4 word gist>
2. A · @handle — <verdict conf%> · <2–4 word gist>
3. S · @handle — <verdict conf%> · <2–4 word gist>

+<N-3> more in Priority queue     ← only if N > 3
Open Inbox → <deep link to /inbox?filter=priority>
```

- HTML parse mode, tier chip as a single letter (S/A), handle as `@username`.
- "gist" = first ~40 chars of the AI's top reason, or asset caption fallback.
- Deep link uses the published origin from `project_urls`.

### Where the logic lives

All filtering happens server-side in the scan-completion hook that already calls Telegram — the client never decides what's a signal.

### Technical details

**File: `src/lib/scanner-service.server.ts`**
- Replace the current `inserted > 0` gate with a query that joins the newly-inserted asset ids against `tracked_accounts` (for tier) and `asset_status` (for verdict/confidence/state), filtered to the scan's owner and this run's inserted rows.
- Select at most 3 rows for the preview, plus a `count(*)` for the overflow line.
- If zero rows qualify → return without calling Telegram. If ≥1 → build the message and call `sendTelegramMessage`.

**File: `src/lib/telegram.server.ts`**
- Add a `sendPrioritySignalDigest({ chatId, signals, totalCount, inboxUrl, scanLabel })` helper that formats the HTML message above. Keep the existing `sendMessage` primitive; the new helper wraps it.

**File: `src/lib/telegram.functions.ts`**
- Update `sendTelegramTestFn` to render a sample digest (same formatter, 2 fake rows) so the "Send test" button previews the real format instead of a generic "test message".

**No schema migration.** Everything needed is already on `tracked_accounts.tier`, `asset_status.ai_verdict`, `asset_status.ai_confidence`, and the Priority state flag.

**No settings-page changes.** Filter thresholds are fixed by product philosophy (S/A · KEEP · ≥80% · Priority) — exposing them as knobs would re-introduce the cognitive load this feature is meant to remove.

### Out of scope

- Per-user threshold tuning, quiet hours, daily digests, email fallback, in-app notification center changes, mobile push. Can be added later if the operator asks; today's fix is: **fewer, sharper Telegram messages**.
