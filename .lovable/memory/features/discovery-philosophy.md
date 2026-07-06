---
name: Discovery Engine philosophy
description: Operator-first Discovery doctrine — "why track" signals, network graph, continuous expansion, explainability, duplicate prevention, quality over quantity
type: feature
---

# Discovery Engine — Operator Doctrine

Discovery is not a list of accounts. It is an expanding, self-reinforcing intelligence graph of an elite private Instagram network.

## 1. Every candidate answers ONE question in <3 seconds

"Why should I track this account?"

Never show raw score walls first. The card headline is a stack of the strongest concrete signals, in operator language:
- "Appeared with @aman 8 times"
- "Posted from Soneva Jani 5 times"
- "Tagged by 3 tracked accounts"
- "Frequently appears in Monaco"
- "Luxury score 94 · High aesthetic consistency"

Rule: the top of every candidate card is 3–5 signal lines derived from `discovery_signals` aggregates. Sub-scores and AI summary come SECOND, not first. If a candidate has no strong signal line, it should not surface — quality over quantity.

## 2. Build a network, not a list

Every candidate carries a provenance chain — the path through which it entered the network:

```
@aman → tagged photographer → co-appeared with luxury couple → tagged private-jet pilot → hotel owner
```

Every candidate stores its seed lineage (`seed_account_id`, `seed_location_id`, and the accepted parent candidate if promoted from another candidate). The UI must expose this chain — "Discovered via" — so the operator understands WHY someone entered the network. Long-term goal: a relationship graph view, not just a list.

## 3. Discovery never stops — the graph expands

- Every tracked account continuously produces new candidates.
- Every accepted candidate becomes a new seed automatically (Tier B default, but immediately eligible for the next discovery tick).
- The scheduler must sweep both accounts AND recently-promoted candidates.

Static account lists are a failure mode. If new candidates stop appearing, the engine is broken.

## 4. Explainability is non-negotiable

The AI never outputs a bare score. Every score has 3–5 concrete reasons attached:

> Luxury Score 93 because:
> • Frequently posts from Aman properties
> • Multiple private aviation appearances
> • Luxury hotels dominate content
> • High-end restaurants
> • Consistent premium visual style

Schema requirement: each of the 5 sub-scores stores a `reasons: string[]` alongside the number. UI renders score + reasons together, always. A score without reasons must not display.

## 5. Duplicate / cluster prevention (future)

If Discovery finds 25 accounts from the same friend group, they should collapse into a cluster, not flood the inbox. Track co-appearance density between candidates and detect tight cliques; surface the strongest representative and fold the rest behind a "12 similar accounts" affordance. Design the schema now (candidate-to-candidate co-appearance edges) even if the UI collapse ships later.

## 6. Long-term vision

The operator should feel they are exploring an elite private Instagram network — not scrolling Instagram. Surface hidden gems before they are mainstream. Optimize for discovery QUALITY, not volume. Better to show 3 exceptional candidates today than 50 mediocre ones.

## Feature test

Before shipping any Discovery change, ask:
1. Does it make "why track this?" answerable in under 3 seconds?
2. Does it strengthen the graph (provenance, expansion, clustering)?
3. Is every number explained?
4. Does it raise quality, or just volume?

If not — cut it.
