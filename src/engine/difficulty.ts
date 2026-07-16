import { search } from './search';
import { KNOWLEDGE, type Weights } from './eval';
import type { GameState, Move } from './types';

/**
 * A rung on the ladder.
 *
 * Strength is built from three independent knobs, not from depth alone:
 *
 *   knowledge   what the tier can perceive at all (see eval.ts)
 *   depth       how far ahead it looks
 *   temperature how often it settles for a move that is merely good
 *
 * Depth alone makes a bad ladder. A one-ply bot is not a beginner — it plays
 * arbitrarily in quiet positions yet perfectly whenever a capture is on offer,
 * which reads as broken rather than weak. Taking away *understanding* produces
 * something that plays sensible-looking moves and misses the point, which is
 * what a human beginner actually looks like and what you can learn against.
 */
export interface Tier {
  readonly id: string;
  readonly name: string;
  /** One line, shown next to the difficulty picker. Promise only what it does. */
  readonly blurb: string;
  readonly knowledge: Weights;
  readonly depth?: number;
  readonly timeMs?: number;
  /**
   * Spread of the softmax over root moves, in men: 1.0 means moves about a man
   * worse than best still get picked reasonably often. 0 is always-best.
   */
  readonly temperature: number;
}

export const TIERS: readonly Tier[] = [
  {
    id: 'learner',
    name: 'Learner',
    blurb: 'Counts men. Will not see your mill coming.',
    knowledge: KNOWLEDGE.learner,
    depth: 1,
    temperature: 1.0,
  },
  {
    id: 'casual',
    name: 'Casual',
    blurb: 'Takes mills it is handed. Does not build toward them.',
    knowledge: KNOWLEDGE.casual,
    depth: 2,
    temperature: 0.4,
  },
  {
    id: 'club',
    name: 'Club',
    blurb: 'Reads threats and space. Punishes loose play.',
    knowledge: KNOWLEDGE.club,
    depth: 5,
    temperature: 0.1,
  },
  {
    id: 'expert',
    name: 'Expert',
    blurb: 'Sees everything, six moves out. You will have to earn a draw.',
    knowledge: KNOWLEDGE.expert,
    depth: 6,
    temperature: 0,
  },
  {
    id: 'impossible',
    name: 'Impossible',
    blurb: 'Thinks for a second and does not lose. A draw is a win.',
    knowledge: KNOWLEDGE.impossible,
    timeMs: 1500,
    temperature: 0,
  },
];

export function tierById(id: string): Tier {
  const t = TIERS.find((x) => x.id === id);
  if (!t) throw new Error(`no such difficulty: ${id}`);
  return t;
}

/**
 * Pick a move for `tier`. Root moves are sampled from a softmax over their
 * scores, so a noisy tier drifts toward *plausible* mistakes rather than
 * random ones — it will pick the second-best move far more often than the
 * worst one on the board.
 */
export function chooseMove(g: GameState, tier: Tier, rand: () => number = Math.random): Move {
  const noisy = tier.temperature > 0;
  const { roots } = search(g, {
    weights: tier.knowledge,
    depth: tier.depth,
    timeMs: tier.timeMs,
    // Sampling by score is only meaningful if the scores are real. Silent
    // tiers never look past the top move, so they keep the faster search.
    exactRoots: noisy,
  });

  if (!noisy || roots.length === 1) return roots[0].move;

  // A man is 100 points; temperature is expressed in men.
  const scale = tier.temperature * 100;
  const best = roots[0].score;
  const weights = roots.map((r) => Math.exp((r.score - best) / scale));
  const total = weights.reduce((a, b) => a + b, 0);

  let ticket = rand() * total;
  for (let i = 0; i < roots.length; i++) {
    ticket -= weights[i];
    if (ticket <= 0) return roots[i].move;
  }
  return roots[0].move;
}
