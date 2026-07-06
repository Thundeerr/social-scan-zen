---
name: Discovery self-improvement doctrine
description: Long-term principles — Discovery must get better, not bigger. Anti-entropy, taste learning, diversity, novelty, "I didn't know this existed"
type: feature
---

# Discovery — Self-Improvement Doctrine

Discovery must become **self-improving**, not just self-growing. Bigger graph ≠ better graph. Every iteration is judged against these five principles.

## 1. Fight entropy

As the graph grows, the bar to surface a candidate must rise, not fall.
- Ranking thresholds scale with graph size — more tracked accounts → stricter cutoff for the Inbox.
- Score inflation is a failure mode. If average Inbox quality drops, tighten enrichment budget and raise the score floor.
- Success metric: quality of the *top* of the distribution over time, never candidate volume.

## 2. Every decision is training

Learning weights, applied via `discovery_preferences` EMA:
- **Track** → strong positive. +1 niche, +signal_weight for the source that produced it, +score-axis affinities (luxury/quality/aesthetic/travel/authenticity).
- **Ignore** → weak negative. −0.3 niche, small −signal_weight. Never blacklist the username.
- **Blacklist** → strong negative. −1 niche, username to `discovery_blacklist`, hard suppress future re-surfaces.

Two operators sharing seeds must receive **different Inboxes** after their first ~20 decisions. If Inboxes stay identical, the learning loop is broken.

## 3. Diversity is a first-class ranker

Never let the Inbox be twenty near-duplicates.
- Clusters (Phase 3 `discovery_cooccurrences`) collapse to a single representative by default.
- Ranking must apply a diminishing-returns penalty per niche/cluster already represented in the top N: the 2nd candidate from cluster X ranks lower than the 1st from cluster Y even if raw score is higher.
- The operator should see *branches*, not repetitions.

## 4. Novelty is a ranking factor

A candidate that opens a new branch of the graph is worth more than the Nth reinforcement of an existing cluster.
- Reward candidates whose provenance chain reaches an under-explored seed, niche, or geography.
- Penalize candidates whose peers are already tracked at high density.
- Track a `novelty_score` derived from graph distance to existing tracked mass; feed it into `rank_score`.

## 5. The session goal is "I didn't know this existed"

Every Discovery visit should end with at least one candidate that surprises the operator. If sessions feel like scrolling, Discovery has failed — regardless of numeric metrics.
- Prefer hidden-gem signals (low followers × high tracked-account tag density) over famous accounts.
- Prefer accounts that are **connected to** the network but **not central** to it.

## Feature test for every Discovery change

Before shipping, answer:
1. Does the graph get **better**, or just bigger?
2. Would two operators with different histories see different results here?
3. Does this add diversity, or reinforce existing clusters?
4. Does this reward novelty?
5. Does it move the session closer to "I found something I didn't know existed"?

If any answer is "no" — cut it or rework it.
