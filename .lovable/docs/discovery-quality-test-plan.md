# Discovery Quality Test Plan

**Goal.** Before adding new Discovery features, prove that the current loop
(learning + diversity + novelty + entropy floor) actually improves candidate
quality — not just candidate volume.

The Discovery Inbox has a **Debug** toggle (top-right of the toolbar). Turn it
on before running this plan. It exposes: per-seed candidate counts, enrichment
tallies, entropy-hidden count, and the current top-10 with a full rank
breakdown. `Snapshot top 10` freezes the current ranking into localStorage and
mirrors it to the browser console (`console.table`) so you can diff runs.

---

## Setup

1. Track **5 root seed accounts** covering at least 2 distinct niches (so
   diversity has something to compress and novelty has room to reward
   under-connected branches). Suggested split: 3 in one niche, 2 in another.
2. Ensure Discovery preferences are effectively empty
   (`discovery_preferences.sample_size` ≈ 0 for the operator). A fresh operator
   is the cleanest baseline.
3. Open `/discovery`, enable **Debug**, and confirm:
   - `Total`, `New`, `Enriched`, `Unenriched`, `Below floor` all read as
     expected zeros / low numbers.
   - Per-seed table lists all 5 accounts with `0` candidates.

## Step 1 — One discovery tick

1. Click **Run discovery now**.
2. Wait for the sweep to finish. Expected: **20–50 new candidates** total,
   spread across the 5 seeds (not concentrated on one).
3. In the Debug panel confirm:
   - **Candidates per seed** — every seed contributes something. A seed with
     `0` after a tick is a provider/enrichment problem, not a ranking problem.
   - **Enriched vs Unenriched** — some fraction is enriched (5 per tick is
     the default budget). The rest sit unenriched and rank lower, which is
     expected.
   - **Below floor** — should be a small minority for a fresh graph
     (entropy floor scales with tracked count; with only 5 tracked it is near
     the `ENTROPY_BASE` of 0.30).

## Step 2 — Snapshot baseline

1. Click **Snapshot top 10**. This writes the current top-10 to localStorage
   and to the browser console (`[discovery] snapshot … — top 10`).
2. Sanity-check the console table: `base`, `learning`, `novelty`,
   `diversity`, `final`. On a fresh operator, `learning` should be ~0 across
   the board — the loop hasn't been trained yet.

## Step 3 — Operator decisions

Make deliberate decisions that will exercise all three learning paths:

- **Track** 3–5 candidates from **one niche** (the niche you want to reward).
- **Ignore** 3–5 candidates from a **different niche** (soft negative).
- **Blacklist** 1–2 candidates you want permanently silenced.

## Step 4 — Verify learning shifts ranking

1. Refresh the Inbox (`Run discovery now` OR wait for the auto-refetch).
2. In the Debug panel the **top-10 table** now shows `Δ rank` next to each
   row, comparing to the snapshot.
3. Expected outcomes:
   - Candidates in the **tracked niche** should show `↑` movement and a
     visibly positive `Learn +…` column.
   - Candidates in the **ignored niche** should show `↓` movement or drop out
     of the top 10 entirely, with a negative or muted `Learn`.
   - Blacklisted usernames must not reappear anywhere in the Inbox.
4. If the top-10 is identical to the snapshot, the learning loop is broken —
   check that `decideDiscoveryCandidateFn` is actually updating
   `discovery_preferences.niche_weights` / `signal_weights`.

## Step 5 — Cluster folding

1. In the toolbar toggle **Clusters folded** off, then on.
2. Expected: with folding **on**, near-duplicates from the same friend group
   collapse to a single representative — the `⋯ N` chip on the card shows the
   folded size. The count below the toolbar reports how many candidates were
   hidden by cluster / entropy filters.
3. Turn folding off: the peers should reappear as independent cards with the
   same cluster peers list, confirming detection is real (not just a UI
   coincidence).

## Step 6 — Novelty brings new branches up

1. In the top-10 table look at the `Nov +` column.
2. Expected: candidates whose cluster peers are **not already tracked** score
   a higher novelty boost. The tooltip on a card's Ranking → Novelty row
   shows `X/Y peers already tracked`.
3. A candidate with `0/8 tracked` peers should sit higher than an otherwise
   identical candidate with `6/8 tracked` — even if the second has slightly
   higher `base`. If it does not, the novelty weight is too low; tune
   `DISCOVERY_WEIGHTS.NOVELTY_MAX` in `src/lib/discovery-weights.ts`.

## Step 7 — Entropy floor hides low-value candidates

1. Toggle **Show all scores / Hiding below floor** in the toolbar.
2. Expected:
   - The candidates that disappear are the ones with `final < entropy_floor`
     (visible as `↓floor` in the debug table and `below floor` chip on the
     card).
   - No **obvious gems** should be hidden. An "obvious gem" = high `base`
     plus enriched, plus at least one elite (`≥ 90`) axis score. If one
     disappears, the floor is too aggressive; drop
     `DISCOVERY_WEIGHTS.ENTROPY_BASE` or
     `DISCOVERY_WEIGHTS.ENTROPY_PER_TRACKED`.

## Pass / fail criteria

The loop is **working** if all of the following hold:

- [x] Every seed produced at least one candidate.
- [x] Snapshot → decisions → refetch changes the top-10 order visibly.
- [x] Tracked-niche candidates trend up, ignored-niche candidates trend down.
- [x] Blacklisted usernames never reappear.
- [x] Clusters fold and unfold consistently.
- [x] Under-connected candidates get a novelty boost.
- [x] The entropy floor hides low-value noise **without** hiding any obvious
      gem.

If any box is unchecked, **do not add more features**. Fix the loop first —
either the learning path, the ranking modifier, or the floor calibration.

## Where to tune

- Weights: `src/lib/discovery-weights.ts` — every modifier is a single number.
- Learning EMA + blacklist decay: `updatePreferences` in
  `src/lib/discovery-service.server.ts`.
- Live ranking + entropy floor: `listDiscoveryCandidatesFn` in
  `src/lib/discovery.functions.ts`.
- Debug view: `DebugPanel` in `src/routes/_authenticated/discovery.tsx`.

## Console snapshot format

Each `Snapshot top 10` click also prints to the browser console — useful for
diffing across sessions or pasting into a bug report:

```
[discovery] snapshot 2026-07-06T… — top 10
┌─────────┬───────┬────────────┬───────┬──────────┬─────────┬───────────┬───────┬────────┐
│ (index) │ rank  │ username   │ base  │ learning │ novelty │ diversity │ final │ passes │
├─────────┼───────┼────────────┼───────┼──────────┼─────────┼───────────┼───────┼────────┤
│    0    │   1   │ 'account_a'│ '0.62'│  '+0.09' │ '+0.12' │  '-0.00'  │ '0.83'│  true  │
└─────────┴───────┴────────────┴───────┴──────────┴─────────┴───────────┴───────┴────────┘
```
