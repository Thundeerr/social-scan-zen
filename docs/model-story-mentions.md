# Model Story mentions — staged, not deployed

Status on 11 November 2026: implementation and offline verification are ready. No migration, Edge deployment, policy activation, backfill or Story publication was performed by this implementation task. The user approved 11 supplied photos and the handwritten overlay preview. The root task reports that test Story `17941667190393710` went live and its mention successfully opened `kiikiilink`; rotation is still not deployed or activated. The previously generated image was rejected and must not be used.

The intended source is `kiikii.bat` (`17841416918437774`), mentioning public `kiikiilink`. Each normal, approved Reel can receive one subsequent static image Story, eligible at a random 5–20 minutes after the actual Reel publication. Trial Reels, historical posts, other accounts and other owners remain excluded. A confirmed primary Reel receipt is required. Existing publish leases and ambiguous-send recovery prevent repeated external sends. Native clickable “Add to Story” Reel reposting is a separate task; this implementation adds no video Story or new publication channel.

## Approved image rotation

`model_posting_policies` stores the opt-in `story_enabled`, exact `story_source_ig_user_id`, `story_mention_username`, approved `story_template_storage_paths` array and `story_template_next_index`. Paths must be distinct, nonempty and under the owner's storage prefix. Use immutable JPEG files in `ig-publish`, e.g. `<owner UUID>/content/story-templates/<unique name>.jpg`, with `image/jpeg` MIME. The `content/` component is required by the existing upload policy.

An enabled policy rotates under a row lock whenever a new normal model Reel is prepared. The chosen image and mention are snapshotted on that post; repeat preparation does not advance rotation. Existing snapshots are preserved if the template pool changes. One approved image works as a one-item pool; actual visual rotation requires at least two approved images. Trials and unrelated destinations do not consume rotation slots.

Story type is independent of primary media type. The new static template uses `story_media_type='image'` and `story_media_reusable=true`. The latter permanently excludes that shared template from the publisher's 48-hour temporary-media cleanup, including after policy changes. One-off legacy media keeps its existing cleanup behavior. `user_tags` adds a real mention at `x=0.5, y=0.8`.

Preparation samples `story_link_delay_seconds` once as an integer from 300 through 1200. After a confirmed primary Reel receipt, `ensure_model_story_time` requires the current unexpired publisher lease, an unpaused owner and a valid primary `published_at` with no recovery hold. It anchors `story_link_not_before` once to that timestamp plus the saved delay. Both snapshots are immutable: preparation retries, policy changes, worker crashes and later receipt metadata updates cannot move them. Missing timestamps fail closed rather than substituting the schedule or retry time.

Before this due time, the worker returns without fetching media or creating a Story container. It persists the exact due time as its next attempt, leaves the workflow `publishing` and releases the lease. The existing minute cron later resumes it; processing and provider latency can make actual delivery later than the due time. Cleanup is enabled only when the complete workflow finishes. Reconciliation holds take priority over waiting. Legacy one-off/image/video Stories retain their existing behavior; this delay applies to the new reusable static model Story policy.

If Meta returns a published media ID together with `config_issue` (including `USER_TAGGING_FAILURE` or `CAPTION_NOT_ATTACHED`), the valid receipt, issue detail and reconciliation hold are saved atomically. The publication stays `published`; the parent workflow requires review and cannot silently complete or automatically republish. Optional metadata failures cannot discard this receipt. Existing recovery events expose the issue; this change adds no separate Telegram delivery route.

## Deployment and activation order

1. The root task has verified all eleven final approved JPEG assets and completed the requested first live mention test. Retain their exact storage paths and hashes from `cloud-pool-verified.json`.
2. Apply `20261111173408_model_story_mentions.sql`. It defaults disabled and publishes/schedules nothing.
3. Deploy `content-publisher` with the new `_shared/instagram-story.ts` dependency. Existing `_shared/instagram-reel.ts` and `_shared/instagram-feed.ts` remain required. Preserve its existing self-authentication / JWT setting. Migration precedes code because cleanup selects the new reusable-media column.
4. Only after the first live test succeeds, enable the exact owner's Kiikii policy with approved image paths. Backfill only the seven explicitly selected untouched future posts via `configure_model_post_story(uuid)`, within one transaction that locks/revalidates those rows first. Do not call the publisher or move their schedules forward.
5. Read back the seven image/mention/delay snapshots, one pending Story child each, null due times until actual Reel receipts exist, unchanged schedules and primary rows, and the persisted policy. The initial live Story remains distinct from this future queue.

Future posts selected on 11 November (all 03:00 Europe/Berlin):

| Date | Post ID |
| --- | --- |
| 12 November | `26518c12-104d-459a-a316-74ab1883bd02` |
| 13 November | `0165598d-6b8f-426a-b8e7-5e8aa2145526` |
| 14 November | `acc964e2-b241-4416-adef-cd6824a962ac` |
| 15 November | `cca13803-8f46-415f-8d11-77407888ee5b` |
| 16 November | `472553bb-0425-4276-81a5-53b474077d59` |
| 17 November | `76de048e-5c20-49e7-8ee1-134eedb555d8` |
| 18 November | `5e1b3af5-033f-40ed-9ed6-3d2b9de24f2c` |

## Verification completed offline

- `node tests/content-publisher-story.mjs`: 19 checks, including static Story after confirmed Reel, before/exact/late due boundaries, actual cron backoff and lease release, actual `user_tags`, replay/ambiguity/configuration-issue fencing, exact source-account check and shared-image cleanup protection.
- `node tests/model-source-dedupe-db.mjs`: 87 existing duplicate-guard assertions plus 56 new policy/rotation/timing assertions using actual PostgreSQL migrations and model preparation RPCs in PGlite.
- `node tests/content-publisher-recovery.mjs`: 22 checks, including Edge TypeScript validation, partial-success receipt retention and all existing recovery protections.

No paid media or live Instagram requests are part of these tests.

Meta reference verified on 11 November 2026: https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media/ documents `user_tags` for image and video Stories (added 9 July 2025), with optional `x`/`y` coordinates. The stored API version is unchanged.

The corresponding https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media_publish/ documents partial-success `config_issue` responses with valid published media IDs.
