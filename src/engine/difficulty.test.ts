import { describe, test, expect } from 'vitest';
import { TIERS, tierById, chooseMove } from './difficulty';
import { search } from './search';
import { X, legalMoves, createGame } from './rules';
import { position } from './fixtures';

/**
 * Deterministic stand-in for Math.random. splitmix32, because a plain xorshift
 * seeded with a small integer dribbles out near-zero for its first few draws —
 * which quietly pins every sample to the first bucket and makes a working
 * sampler look broken.
 */
function seeded(seed: number): () => number {
  let s = (seed + 0x9e3779b9) >>> 0;
  return () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
    return ((z ^ (z >>> 15)) >>> 0) / 4294967296;
  };
}

describe('the ladder', () => {
  test('runs from learner to impossible', () => {
    expect(TIERS.map((t) => t.id))
      .toEqual(['learner', 'casual', 'club', 'expert', 'impossible']);
  });

  test('gets quieter as it gets stronger', () => {
    const temps = TIERS.map((t) => t.temperature);
    expect([...temps].sort((a, b) => b - a)).toEqual(temps);
    expect(TIERS.at(-1)!.temperature).toBe(0);
  });

  test('every tier is reachable by id', () => {
    for (const t of TIERS) expect(tierById(t.id)).toBe(t);
  });

  test('an unknown id is rejected rather than silently defaulted', () => {
    expect(() => tierById('grandmaster')).toThrow(/grandmaster/);
  });
});

describe('move selection', () => {
  const g = position('XX...OX.......X..O..O..O', { turn: X });

  test('a silent tier always plays the search’s best move', () => {
    const expert = tierById('expert');
    const best = search(g, { weights: expert.knowledge, depth: expert.depth }).best;
    for (let i = 0; i < 8; i++) {
      expect(chooseMove(g, expert, seeded(i + 1))).toEqual(best);
    }
  });

  test('a noisy tier does not always play its own best move', () => {
    const learner = tierById('learner');
    const best = search(g, { weights: learner.knowledge, depth: learner.depth }).best;
    const picks = Array.from({ length: 40 }, (_, i) => chooseMove(g, learner, seeded(i + 1)));
    expect(picks.some((m) => JSON.stringify(m) !== JSON.stringify(best))).toBe(true);
  });

  test('but it still leans toward the moves it rates highest', () => {
    // Noise, not chaos. Several moves may tie for best — here four different
    // captures do — so the honest measure is how often it lands on the
    // top-scoring class at all, against what blind chance would give.
    const learner = tierById('learner');
    const { roots } = search(g, { weights: learner.knowledge, depth: learner.depth });
    const top = roots[0].score;
    const scoreOf = (m: { from: number; to: number; remove: number }) =>
      roots.find((r) => r.move.from === m.from && r.move.to === m.to && r.move.remove === m.remove)!.score;

    const picks = Array.from({ length: 300 }, (_, i) => chooseMove(g, learner, seeded(i + 1)));
    const good = picks.filter((m) => scoreOf(m) === top).length;
    const blindChance = roots.filter((r) => r.score === top).length / roots.length;

    expect(good / 300).toBeGreaterThan(blindChance * 1.4);
  });

  test('every tier returns a legal move from the opening', () => {
    const opening = createGame();
    for (const t of TIERS) {
      const m = chooseMove(opening, t, seeded(7));
      expect(legalMoves(opening).some((x) => x.from === m.from && x.to === m.to && x.remove === m.remove))
        .toBe(true);
    }
  }, 30_000);

  test('the same seed picks the same move', () => {
    const casual = tierById('casual');
    expect(chooseMove(g, casual, seeded(42))).toEqual(chooseMove(g, casual, seeded(42)));
  });
});

describe('what each tier can perceive', () => {
  test('the learner counts men and nothing else', () => {
    const k = tierById('learner').knowledge;
    expect(k.material).toBeGreaterThan(0);
    expect([k.mills, k.threats, k.mobility, k.doubleMills]).toEqual([0, 0, 0, 0]);
  });

  test('the casual player learns mills but not threats', () => {
    const k = tierById('casual').knowledge;
    expect(k.mills).toBeGreaterThan(0);
    expect(k.threats).toBe(0);
  });

  test('the club player learns threats and space', () => {
    const k = tierById('club').knowledge;
    expect(k.threats).toBeGreaterThan(0);
    expect(k.mobility).toBeGreaterThan(0);
  });

  test('only the top of the ladder searches on a clock', () => {
    expect(tierById('impossible').timeMs).toBeGreaterThan(0);
    expect(tierById('club').timeMs).toBeUndefined();
  });
});
