# Kiikii comment private replies

Extends the existing [website DM responder](kiikii-dm-redirect.md). A new matching
top-level comment on Kiikii's own post or reel receives one private reply containing
`https://chat.kiiki.info`. Uses the same 30 approved variants; no public comment is posted.

## Triggers and captions

All heart colors/shapes, heart hands (with skin tones), heart-on-fire/healing-heart,
and `<3`/`<33` match. Decorative non-heart emojis do not match automatically.
The current media caption is read on each new eligible event. Explicit instructions
such as `comment "CHAT"`, `comment CHAT`, `drop a 🦇`, and `comment “<3”` add a
post-specific trigger. Quoted words/phrases and direct emoji instructions work;
common unquoted keywords CHAT, LINK, INFO, MORE, YES, ME and DM are supported.
This is a deterministic parser, not an understanding of arbitrary prose. Keyword
matching is case-insensitive and uses word boundaries (CHAT does not match chatbot).

Stored-caption audit, 2026-11-03: published posts included `comment “<3” and i’ll send
u a dm` (Oct 23) and `Drop a Heart in the Comments <3` (Oct 13). The three scheduled
captions at audit time contained decorative crying/blushing emojis but no comment
CTA. No captions or publishing schedules were changed.

## Rollout

1. Apply `20261103150628_kiikii_comment_private_replies.sql`; default is off.
2. Deploy code. The existing signed shared webhook URL and secret stay unchanged.
3. In the existing Meta app's Instagram webhook settings, subscribe the **comments**
   field alongside messages. Account-level subscription alone is insufficient.
4. Open Reel Inbox as owner/cofounder; keep the main DM responder enabled. The token
   requires `instagram_business_manage_comments`, already present in the checked
   Kiikii connection. “Test heart comments” adds comments to account subscriptions
   while retaining existing fields and reads the subscription back.
5. Leave a NEW heart comment as `user_diary01`. A prior DM or comment reply within
   24 hours still counts toward the shared limit. Do not clear a reservation to retry.
6. Verify the private reply in the receiving account and open the link. Only after
   actual delivery verification enable comment replies for everyone.

## Delivery boundaries

- Comment webhook signature is verified before processing. Exact account, author,
  comment/media binding, own media and creation timestamp are checked against Meta.
- No historical backlog: only comments created after activation, less than 24 hours
  old. Meta allows one private reply per comment within seven days; this app uses
  a deliberately narrower fresh-comment window. Live, stories, ads, replies to
  other comments, hidden/deleted/inaccessible comments and own comments are ignored.
- Caption reads and network delivery happen outside database transactions. Both DM
  and comment reservations use the same first lock and contact cooldown. At most
  one send attempt per person per 24 hours across both entry points, including failed
  or uncertain attempts. Comment-ID hashes prevent replay. No automatic send retry.
- An owner-authorized extra test can be granted server-side with
  `test_reply_once_until` after applying `20261103160246_kiikii_comment_test_reply.sql`.
  It only applies in comment test mode to the exact configured test username. A single
  fresh comment consumes it atomically before the send, even if delivery fails.
  It does not replay previous comments, clear cooldown/history or affect live visitors.
  The Nov 3 extra test was explicitly requested by the account owner.
- DM opt-outs apply to both. Pausing the main DM responder pauses comments; pausing
  comments alone leaves DMs running. Main test mode also restricts comment sends.
- RLS and service-only grants protect settings, contacts, receipts and reserve RPCs.
  No raw comments/captions or access tokens are returned to the browser or persisted.
- The follow-up DM window only opens after a recipient replies; receiving a comment
  is not treated as authorization to start an ongoing DM conversation.

## Verification

`npx vitest run src/lib/kiikii-comment-replies.test.ts src/lib/kiikii-dm-redirect.test.ts src/lib/reel-inbox-dm.test.ts`

`node tests/kiikii-comment-replies-db.mjs`

Official references, checked 2026-11-03:
- [Meta Private Replies](https://developers.facebook.com/documentation/instagram-platform/private-replies)
- [Meta IG Comment fields](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-comment)
- [Meta Webhooks](https://developers.facebook.com/documentation/instagram-platform/webhooks)
- [Meta webhook examples](https://developers.facebook.com/documentation/instagram-platform/webhooks/examples)
