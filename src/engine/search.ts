import { hashPosition } from './zobrist';
import { legalMoves } from './rules';
import { evaluate, type Weights } from './eval';
import {
  EMPTY, PLACE, NO_REMOVE, opponent,
  type Move, type Player, type Position, type GameState,
} from './types';

/** A decisive score. Mate distance is subtracted so a win found sooner beats
 *  the same win found later, and a loss delayed beats one taken now. */
export const WIN = 1_000_000;

export interface SearchOpts {
  weights: Weights;
  /** Fixed depth in plies. Ignored when `timeMs` is set. */
  depth?: number;
  /** Iterative deepening budget. Takes precedence over `depth`. */
  timeMs?: number;
  /** Ceiling for iterative deepening. */
  maxDepth?: number;
  /**
   * Search every root move on a full window so `roots` carries true scores.
   *
   * Alpha-beta only ever proves the best move's score; the rest fail low and
   * come back as upper bounds. That is fine when all you do is play the top
   * move, and wrong for anything that reads the numbers — sampling a move by
   * score, or telling a player what their move cost. Costs root pruning.
   */
  exactRoots?: boolean;
}

export interface RootScore {
  readonly move: Move;
  readonly score: number;
}

export interface SearchResult {
  readonly best: Move;
  readonly score: number;
  readonly depth: number;
  readonly nodes: number;
  readonly ms: number;
  /** Every root move with its score, best first. Drives both the difficulty
   *  wobble and the post-game review. */
  readonly roots: readonly RootScore[];
}

/** A position the search can mutate. Structurally a `Position`, so it shares
 *  one move generator with the rest of the engine. */
interface Mut {
  board: number[];
  turn: Player;
  hand: Record<Player, number>;
  onBoard: Record<Player, number>;
}

const EXACT = 0, LOWER = 1, UPPER = 2;

interface Entry {
  depth: number;
  score: number;
  flag: number;
  move: Move | null;
}

class Timeout extends Error {}

interface Ctx {
  w: Weights;
  nodes: number;
  deadline: number;
  tt: Map<number, Entry>;
  /** Positions on the path from the game's opening to the current node. */
  seen: Map<number, number>;
  killers: (Move | null)[][];
}

function make(p: Mut, m: Move): void {
  const me = p.turn;
  if (m.from === PLACE) {
    p.hand[me]--;
    p.onBoard[me]++;
  } else {
    p.board[m.from] = EMPTY;
  }
  p.board[m.to] = me;
  if (m.remove !== NO_REMOVE) {
    p.board[m.remove] = EMPTY;
    p.onBoard[opponent(me)]--;
  }
  p.turn = opponent(me);
}

function unmake(p: Mut, m: Move): void {
  const me = opponent(p.turn);
  p.turn = me;
  if (m.remove !== NO_REMOVE) {
    p.board[m.remove] = opponent(me);
    p.onBoard[opponent(me)]++;
  }
  p.board[m.to] = EMPTY;
  if (m.from === PLACE) {
    p.hand[me]++;
    p.onBoard[me]--;
  } else {
    p.board[m.from] = me;
  }
}

const sameMove = (a: Move, b: Move) =>
  a.from === b.from && a.to === b.to && a.remove === b.remove;

/**
 * Cheap ordering, best guesses first, so alpha-beta prunes hard:
 * the transposition move, then captures, then killers, then the rest.
 */
function order(moves: Move[], ttMove: Move | null, killers: (Move | null)[]): Move[] {
  const rank = (m: Move): number => {
    if (ttMove && sameMove(m, ttMove)) return 0;
    if (m.remove !== NO_REMOVE) return 1;
    for (const k of killers) if (k && sameMove(m, k)) return 2;
    return 3;
  };
  return moves
    .map((m, i) => ({ m, r: rank(m), i }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.m);
}

function negamax(p: Mut, depth: number, alpha: number, beta: number, ply: number, ctx: Ctx): number {
  ctx.nodes++;
  if ((ctx.nodes & 1023) === 0 && Date.now() > ctx.deadline) throw new Timeout();

  const me = p.turn;

  // Wiped out: nothing left to play with.
  if (p.hand[me] === 0 && p.onBoard[me] < 3) return -WIN + ply;

  const hash = hashPosition(p);

  // Any repeat inside the search is treated as the draw it is heading toward.
  // Cheaper than counting to three, and the verdict is the same.
  if (ply > 0 && (ctx.seen.get(hash) ?? 0) > 0) return 0;

  const alphaOrig = alpha;
  const hit = ctx.tt.get(hash);
  if (hit && hit.depth >= depth && ply > 0) {
    if (hit.flag === EXACT) return hit.score;
    if (hit.flag === LOWER && hit.score > alpha) alpha = hit.score;
    else if (hit.flag === UPPER && hit.score < beta) beta = hit.score;
    if (alpha >= beta) return hit.score;
  }

  const moves = legalMoves(p);
  if (moves.length === 0) return -WIN + ply; // boxed in with nowhere to go
  if (depth <= 0) return evaluate(p, me, ctx.w);

  ctx.seen.set(hash, (ctx.seen.get(hash) ?? 0) + 1);
  let best = -Infinity;
  let bestMove: Move | null = null;

  try {
    for (const m of order(moves, hit?.move ?? null, ctx.killers[ply] ?? [])) {
      make(p, m);
      let score: number;
      try {
        score = -negamax(p, depth - 1, -beta, -alpha, ply + 1, ctx);
      } finally {
        unmake(p, m);
      }
      if (score > best) {
        best = score;
        bestMove = m;
      }
      if (best > alpha) alpha = best;
      if (alpha >= beta) {
        // A quiet move good enough to cut is worth trying first elsewhere.
        if (m.remove === NO_REMOVE) {
          ctx.killers[ply] ??= [null, null];
          if (!ctx.killers[ply][0] || !sameMove(ctx.killers[ply][0]!, m)) {
            ctx.killers[ply][1] = ctx.killers[ply][0];
            ctx.killers[ply][0] = m;
          }
        }
        break;
      }
    }
  } finally {
    const n = ctx.seen.get(hash)!;
    if (n <= 1) ctx.seen.delete(hash);
    else ctx.seen.set(hash, n - 1);
  }

  const flag = best <= alphaOrig ? UPPER : best >= beta ? LOWER : EXACT;
  const prev = ctx.tt.get(hash);
  if (!prev || prev.depth <= depth) ctx.tt.set(hash, { depth, score: best, flag, move: bestMove });

  return best;
}

function toMut(s: Position): Mut {
  return {
    board: [...s.board],
    turn: s.turn,
    hand: { 1: s.hand[1], 2: s.hand[2] },
    onBoard: { 1: s.onBoard[1], 2: s.onBoard[2] },
  };
}

/** Score every root move at a fixed depth. Throws `Timeout` if the clock runs out. */
function searchRoot(
  p: Mut, depth: number, ctx: Ctx, prior: readonly RootScore[], exact: boolean,
): RootScore[] {
  // Last iteration's ordering is the best guess available.
  const moves = prior.length > 0
    ? prior.map((r) => r.move)
    : order(legalMoves(p), null, []);

  const scored: RootScore[] = [];
  let alpha = -Infinity;
  for (const m of moves) {
    make(p, m);
    let score: number;
    try {
      // Narrowing to -alpha prunes hard but reduces also-rans to bounds.
      score = -negamax(p, depth - 1, -Infinity, exact ? Infinity : -alpha, 1, ctx);
    } finally {
      unmake(p, m);
    }
    scored.push({ move: m, score });
    if (score > alpha) alpha = score;
  }
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

/**
 * Pick a move. With `depth`, searches exactly that far; with `timeMs`,
 * deepens until the clock runs out and keeps the last completed iteration —
 * a half-searched depth is worse than no depth at all.
 */
export function search(g: GameState, opts: SearchOpts): SearchResult {
  const started = Date.now();
  const p = toMut(g);

  const ctx: Ctx = {
    w: opts.weights,
    nodes: 0,
    deadline: opts.timeMs ? started + opts.timeMs : Number.POSITIVE_INFINITY,
    tt: new Map(),
    // Everything already played counts toward repetition, minus the current
    // position: it is the root, not a repeat of itself.
    seen: new Map(),
    killers: [],
  };
  const rootHash = hashPosition(g);
  for (const h of g.history) {
    if (h === rootHash) continue;
    ctx.seen.set(h, (ctx.seen.get(h) ?? 0) + 1);
  }

  const maxDepth = opts.maxDepth ?? 64;
  const exact = opts.exactRoots ?? false;
  let roots: RootScore[] = [];
  let depth = 0;

  if (opts.timeMs) {
    for (let d = 1; d <= maxDepth; d++) {
      try {
        roots = searchRoot(p, d, ctx, roots, exact);
        depth = d;
      } catch (e) {
        if (e instanceof Timeout) break;
        throw e;
      }
      if (Math.abs(roots[0].score) > WIN / 2) break; // decided; no point deepening
      if (Date.now() > ctx.deadline) break;
    }
  } else {
    depth = Math.max(1, opts.depth ?? 1);
    roots = searchRoot(p, depth, ctx, [], exact);
  }

  return {
    best: roots[0].move,
    score: roots[0].score,
    depth,
    nodes: ctx.nodes,
    ms: Date.now() - started,
    roots,
  };
}
