/**
 * Phase 4 — transparent self-improvement weights.
 *
 * Tiny, editable constants shared between the server-only Discovery service
 * and the client-visible server-function types. Each modifier is surfaced
 * per candidate in `rank_breakdown` so the operator can see WHY a candidate
 * scores what it scores.
 */

export const DISCOVERY_WEIGHTS = {
  DIVERSITY_STEP: 0.1, // penalty per prior candidate sharing niche/cluster
  DIVERSITY_MAX: 0.3,
  NOVELTY_MAX: 0.15,
  NOVELTY_NEUTRAL: 0.05, // when we have no peer data at all
  ENTROPY_BASE: 0.3,
  ENTROPY_PER_TRACKED: 0.005,
  ENTROPY_CEIL: 0.55,
  SIGNAL_WEIGHT_CLAMP: 3,
} as const;
