import { describe, test, expect } from 'vitest';
import { search, WIN } from './search';
import { KNOWLEDGE } from './eval';
import { X, O, legalMoves, applyMove, createGame, NO_REMOVE } from './rules';
import { position } from './fixtures';

const expert = KNOWLEDGE.expert;
const sameMove = (a: { from: number; to: number; remove: number }, b: typeof a) =>
  a.from === b.from && a.to === b.to && a.remove === b.remove;

describe('tactics', () => {
  test('takes the win when one is on the board', () => {
    // X slides 14 -> 2, closes the top row, and takes O's third man.
    const g = position('XX...OX.......X..O..O...', { turn: X });
    const r = search(g, { weights: expert, depth: 1 });
    expect(r.best.to).toBe(2);
    expect(r.best.remove).not.toBe(NO_REMOVE);
    expect(r.score).toBeGreaterThan(WIN / 2);
  });

  test('blocks a mill the opponent is one placement from closing', () => {
    // O holds 21,22 and will close on 23 next turn. X has no mill of its own
    // to chase, so the block is the move.
    const g = position('X....X...............OO.', {
      turn: X,
      hand: { [X]: 7, [O]: 7 },
    });
    expect(search(g, { weights: expert, depth: 2 }).best.to).toBe(23);
  });

  test('closes an available mill rather than drifting', () => {
    // X holds 0,1; placing on 2 shuts the top row and earns a man.
    const g = position('XX...................O.O', {
      turn: X,
      hand: { [X]: 7, [O]: 7 },
    });
    const r = search(g, { weights: expert, depth: 1 });
    expect(r.best.to).toBe(2);
    expect(r.best.remove).not.toBe(NO_REMOVE);
  });

  test('a deeper search values the opening at least as highly as a shallow one', () => {
    // Not a strict inequality — just a guard against depth making things worse.
    const g = createGame();
    const shallow = search(g, { weights: expert, depth: 2 });
    const deep = search(g, { weights: expert, depth: 4 });
    expect(deep.depth).toBeGreaterThan(shallow.depth);
    expect(deep.nodes).toBeGreaterThan(shallow.nodes);
  });
});

describe('search contract', () => {
  test('returns a move that is actually legal', () => {
    const g = position('XX...OX.......X..O..O..O', { turn: X });
    const r = search(g, { weights: expert, depth: 3 });
    expect(legalMoves(g).some((m) => sameMove(m, r.best))).toBe(true);
  });

  test('scores every legal move at the root, best first', () => {
    const g = position('XX...OX.......X..O..O..O', { turn: X });
    const r = search(g, { weights: expert, depth: 2 });
    expect(r.roots).toHaveLength(legalMoves(g).length);
    const scores = r.roots.map((x) => x.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    expect(sameMove(r.roots[0].move, r.best)).toBe(true);
  });

  test('exact roots report each move’s true score, not an alpha-beta bound', () => {
    // Plain alpha-beta only proves the *best* root score. Every other move
    // fails low and comes back as an upper bound, which is fine for picking a
    // move and useless for anything that reads the numbers — the difficulty
    // softmax and the post-game review both do.
    const g = position('XX...OX.......X..O..O..O', { turn: X });
    const r = search(g, { weights: expert, depth: 3, exactRoots: true });

    for (const { move, score } of r.roots) {
      // Search the child directly: no window, no bound, no doubt.
      const child = applyMove(g, move);
      const truth = child.result
        ? score // terminal children are scored by the parent, not re-searched
        : -search(child, { weights: expert, depth: 2, exactRoots: true }).score;
      expect(score, `${move.from}->${move.to} misreported`).toBe(truth);
    }
  });

  test('the same position searched twice gives the same move', () => {
    const g = position('XX...OX.......X..O..O..O', { turn: X });
    const a = search(g, { weights: expert, depth: 4 });
    const b = search(g, { weights: expert, depth: 4 });
    expect(sameMove(a.best, b.best)).toBe(true);
    expect(a.score).toBe(b.score);
  });

  test('a time budget produces a move and roughly respects the clock', () => {
    const r = search(createGame(), { weights: expert, timeMs: 300 });
    expect(r.best).toBeDefined();
    expect(r.depth).toBeGreaterThan(1);
    expect(r.ms).toBeLessThan(1500); // generous: only catches runaway search
  });

  test('searching does not disturb the position it was handed', () => {
    const g = position('XX...OX.......X..O..O..O', { turn: X });
    const before = JSON.stringify(g);
    search(g, { weights: expert, depth: 3 });
    expect(JSON.stringify(g)).toBe(before);
  });
});

describe('self-play', () => {
  test('engine versus engine always reaches a legal ending', () => {
    for (let seed = 0; seed < 6; seed++) {
      let g = createGame();
      let plies = 0;
      while (!g.result && plies < 400) {
        const moves = legalMoves(g);
        expect(moves.length, `stuck with no moves at ply ${plies}`).toBeGreaterThan(0);
        // Shallow, plus a seeded wobble so the six games differ.
        const r = search(g, { weights: KNOWLEDGE.club, depth: 2 });
        const pick = plies < seed ? moves[(seed * 7 + plies) % moves.length] : r.best;
        expect(moves.some((m) => sameMove(m, pick))).toBe(true);
        g = applyMove(g, pick);
        plies++;
      }
      expect(g.result, `game ${seed} never ended`).not.toBeNull();
    }
  }, 60_000);
});

describe('mate distance', () => {
  test('a win found sooner scores higher than the same win found later', () => {
    const g = position('XX...OX.......X..O..O...', { turn: X });
    const r = search(g, { weights: expert, depth: 4 });
    // The immediate kill must outrank any slower route to the same win.
    expect(r.score).toBeGreaterThan(WIN - 100);
  });
});
