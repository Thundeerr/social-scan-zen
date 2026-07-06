## Phase 4 — Self-improving Discovery

Ship four transparent ranking modifiers on top of Phase 3. All weights live in ONE constant block near the top of `discovery-service.server.ts` so they are trivial to tune. No black boxes: every candidate returns a `rank_breakdown` the UI renders.

### Priorities

1. **Learning loop completion** (already partly wired) — must be verifiable in the UI.
2. **Diversity + novelty** — visible modifiers on the score.
3. **Entropy floor** — conservative, pass/fail, non-destructive.
4. **Debug panel** — every candidate card exposes the numbers.

---

### 1. Learning loop — finish what's wired

Current state: `applyOperatorDecision → updatePreferences` already updates `avg_*`, `niche_weights`, `pref_private/commercial` via EMA. What's missing:

- **`signal_weights`** is written back unchanged. Fix: read the candidate's `discovery_signals`, group by `source_type`, apply the same directional EMA (`+1 / -0.3 / -1`) per source type, cap between −3 and +3.
- **Blacklist strengthening**: on `blacklist`, additionally decay `niche_weights[k]` by an extra −0.5 (already −1 direction + the extra), and de-duplicate the blacklist insert (already `.then(()=>...,()=>...)`).
- **Sample size**: keep the current `sample_size + 1` cap at 200 (already implicit via α = 1/min(50, …)).

No new tables. Just a real `signal_weights` update.

### 2. Ranking modifiers — computed live in `listDiscoveryCandidatesFn`

Move from a single frozen `rank_score` (baked at enrichment) to a **live composite** computed at list time. The stored `rank_score` becomes `base_score`; diversity/novelty/entropy are applied on top per request, because they depend on the current batch and current graph state.

Composite:

```text
final = base + learning + novelty − diversity
pass  = final ≥ entropy_floor
```

Component definitions — small, simple, editable:

```text
DISCOVERY_WEIGHTS = {
  DIVERSITY_STEP:      0.10,   // penalty per repeat of same niche OR cluster
  DIVERSITY_MAX:       0.30,   // cap on total diversity penalty
  NOVELTY_MAX:         0.15,   // max novelty boost
  NOVELTY_NEUTRAL:     0.05,   // when no peer data
  ENTROPY_BASE:        0.30,
  ENTROPY_PER_TRACKED: 0.005,
  ENTROPY_CEIL:        0.55,
}
```

- **base**: existing `rank_score` at enrichment time (niche match + axes vs prefs + confidence).
- **learning**: `base − base_without_prefs`. Recomputed cheaply from stored scores + current prefs, so we always see the delta the operator's decisions produced. (No stored value; derived at list time.)
- **diversity penalty**: walk the ranked list top→bottom; for each candidate, `−DIVERSITY_STEP` per prior candidate sharing the same `estimated_niche` OR the same cluster root, capped at `DIVERSITY_MAX`. This runs after cluster folding, so it mainly punishes repeated niches across clusters.
- **novelty boost**: from `cluster_peers` — `tracked_density = tracked_peers / total_peers` where `tracked_peers` = peers whose `username` exists in `tracked_accounts` for this user. Boost = `NOVELTY_MAX × (1 − tracked_density)`. If no peers, use `NOVELTY_NEUTRAL`.
- **entropy floor**: `min(ENTROPY_CEIL, ENTROPY_BASE + ENTROPY_PER_TRACKED × tracked_count)`. Conservative: with 20 tracked accounts, floor = 0.40; with 50, floor = 0.55 (ceiling).

Sort key stays `final` (desc), then `signal_count`, then `last_seen_at`.

### 3. Transparent debug data per candidate

Extend `DiscoveryCandidateRow`:

```ts
rank_breakdown: {
  base:      number;
  learning:  number;  // signed
  diversity: number;  // negative or 0
  novelty:   number;  // positive or 0
  final:     number;
  entropy_floor: number;
  passes_entropy: boolean;
  novelty_detail: { tracked_peers: number; total_peers: number };
  diversity_detail: { niche_repeats: number; cluster_repeats: number };
}
```

Populated in `listDiscoveryCandidatesFn` after cluster folding.

### 4. UI

In `discovery.tsx` `CandidateCard`:

- Small `<Ranking>` collapsible strip under the score chips: "Ranking · 0.62" with a chevron. Expanded rows show:
  - `Base 0.48`
  - `Learning +0.09` (green if positive, muted if negative)
  - `Novelty +0.12` (with tooltip: "3 of 8 peers already tracked")
  - `Diversity −0.07` (with tooltip: "2 similar niche · 1 same cluster higher up")
  - `Final 0.62`
  - `Entropy floor 0.35 · PASS` (or `BELOW` in warning tone)
- Below the tab bar, add a small toggle `Hide below entropy floor` (default: off, so nothing disappears silently).

Keep it terse — this is operator debug, not a chart.

### 5. What we're NOT doing (yet)

- No new tables, no migration. All new state is derived.
- No auto-hiding — entropy floor is visual/optional at first.
- No cross-user normalization. Weights are per-operator via existing `discovery_preferences`.
- No signal-weight display in the card yet — it feeds base but is visible in future settings.

### Files touched

- `src/lib/discovery-service.server.ts` — finish `signal_weights` EMA in `updatePreferences`; constants block.
- `src/lib/discovery.functions.ts` — extend row type; compute modifiers in `listDiscoveryCandidatesFn`; count tracked usernames once per request.
- `src/routes/_authenticated/discovery.tsx` — add `<Ranking>` panel + entropy-floor toggle.

### Verification

- `bunx tsgo --noEmit` clean.
- Manually: track one candidate → next list refresh shows Learning value moves; card with tracked peers gets lower Novelty; second candidate in the same niche after a same-niche one shows Diversity −0.10.

Confirm and I'll implement.
