/**
 * Round-robin between the tiers. The ladder's whole promise is that each rung
 * beats the one below it; that is a claim about behaviour, so measure it.
 *
 * Impossible's clock is cut to 150ms here purely so the tournament finishes —
 * it still out-searches Expert's fixed depth 6 in the midgame.
 */
import { TIERS, chooseMove, type Tier } from '../src/engine/difficulty';
import { createGame, applyMove, legalMoves, X, O } from '../src/engine/rules';

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

const FIELD: Tier[] = TIERS.map((t) =>
  t.id === 'impossible' ? { ...t, timeMs: 150 } : t);

const GAMES_PER_PAIR = 8;
const OPENING_RANDOM_PLIES = 4;

type Outcome = 'x' | 'o' | 'draw';

function play(xs: Tier, os: Tier, seed: number): Outcome {
  const rand = seeded(seed);
  let g = createGame();
  let plies = 0;
  while (!g.result && plies < 300) {
    const moves = legalMoves(g);
    if (moves.length === 0) break;
    // Random opening so two silent tiers do not replay one identical game.
    const m = plies < OPENING_RANDOM_PLIES
      ? moves[Math.floor(rand() * moves.length)]
      : chooseMove(g, g.turn === X ? xs : os, rand);
    g = applyMove(g, m);
    plies++;
  }
  if (!g.result) return 'draw'; // hit the ply cap: nobody won
  if (g.result.kind === 'draw') return 'draw';
  return g.result.winner === X ? 'x' : 'o';
}

interface Rec { w: number; l: number; d: number }
const table = new Map<string, Map<string, Rec>>();
for (const a of FIELD) {
  table.set(a.id, new Map());
  for (const b of FIELD) table.get(a.id)!.set(b.id, { w: 0, l: 0, d: 0 });
}

const started = Date.now();
for (let i = 0; i < FIELD.length; i++) {
  for (let j = i + 1; j < FIELD.length; j++) {
    const a = FIELD[i], b = FIELD[j];
    for (let n = 0; n < GAMES_PER_PAIR; n++) {
      // Alternate colours so first-move advantage cancels out.
      const aIsX = n % 2 === 0;
      const seed = (i + 1) * 1000 + (j + 1) * 100 + n;
      const r = play(aIsX ? a : b, aIsX ? b : a, seed);
      const aWon = (r === 'x' && aIsX) || (r === 'o' && !aIsX);
      const bWon = (r === 'x' && !aIsX) || (r === 'o' && aIsX);
      const ra = table.get(a.id)!.get(b.id)!;
      const rb = table.get(b.id)!.get(a.id)!;
      if (r === 'draw') { ra.d++; rb.d++; }
      else if (aWon) { ra.w++; rb.l++; }
      else if (bWon) { ra.l++; rb.w++; }
    }
    const ra = table.get(a.id)!.get(b.id)!;
    console.log(`${a.name.padEnd(11)} vs ${b.name.padEnd(11)}  ${ra.w}W ${ra.l}L ${ra.d}D`);
  }
}

console.log('\n' + ' '.repeat(12) + FIELD.map((t) => t.name.slice(0, 5).padStart(8)).join('') + '     points');
for (const a of FIELD) {
  let pts = 0, games = 0;
  const cells = FIELD.map((b) => {
    if (a.id === b.id) return '       —';
    const r = table.get(a.id)!.get(b.id)!;
    pts += r.w + r.d * 0.5;
    games += r.w + r.l + r.d;
    return `${r.w}/${r.l}/${r.d}`.padStart(8);
  });
  console.log(a.name.padEnd(12) + cells.join('') + `     ${pts}/${games}`);
}
console.log(`\n(W/L/D from the row player's side, ${GAMES_PER_PAIR} games per pair, ${Math.round((Date.now() - started) / 1000)}s)`);
