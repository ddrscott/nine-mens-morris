/**
 * Only the adjacent rungs matter for how the ladder feels: each should beat
 * the one below it clearly but not perfectly. Target ~70-85% score rate.
 */
import { TIERS, chooseMove, type Tier } from '../src/engine/difficulty';
import { createGame, applyMove, legalMoves, X } from '../src/engine/rules';

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

const FIELD: Tier[] = TIERS.map((t) => (t.id === 'impossible' ? { ...t, timeMs: 150 } : t));
const GAMES = Number(process.env.GAMES ?? 24);

function play(xs: Tier, os: Tier, seed: number): 'x' | 'o' | 'draw' {
  const rand = seeded(seed);
  let g = createGame();
  let plies = 0;
  while (!g.result && plies < 300) {
    const moves = legalMoves(g);
    if (moves.length === 0) break;
    const m = plies < 4 ? moves[Math.floor(rand() * moves.length)] : chooseMove(g, g.turn === X ? xs : os, rand);
    g = applyMove(g, m);
    plies++;
  }
  if (!g.result || g.result.kind === 'draw') return 'draw';
  return g.result.winner === X ? 'x' : 'o';
}

console.log(`${GAMES} games per rung, colours alternating\n`);
for (let i = 0; i < FIELD.length - 1; i++) {
  const lower = FIELD[i], upper = FIELD[i + 1];
  let w = 0, l = 0, d = 0;
  for (let n = 0; n < GAMES; n++) {
    const upIsX = n % 2 === 0;
    const r = play(upIsX ? upper : lower, upIsX ? lower : upper, i * 977 + n);
    if (r === 'draw') d++;
    else if ((r === 'x') === upIsX) w++;
    else l++;
  }
  const rate = (w + d * 0.5) / GAMES;
  const verdict = rate >= 0.7 && rate <= 0.9 ? 'ok' : rate < 0.7 ? 'TOO CLOSE' : 'TOO WIDE';
  console.log(
    `${upper.name.padEnd(11)} over ${lower.name.padEnd(11)} ${w}W ${l}L ${d}D` +
    `   score ${(rate * 100).toFixed(0)}%   ${verdict}`,
  );
}
