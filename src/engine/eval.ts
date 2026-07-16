import { POINTS, MILLS, MILLS_THROUGH, ADJACENCY } from './board';
import { EMPTY, opponent, type Player, type Position } from './rules';

/**
 * What a player understands about a position. Every term is scored as
 * (mine - theirs), so the whole evaluation is antisymmetric: what is good for
 * me is exactly as bad for you.
 *
 * Difficulty is built out of these rather than out of search depth alone. A
 * zero weight is not a small weight — it makes the tier structurally unable to
 * perceive that feature, so it plays plausible moves and misses the point,
 * which is what a human beginner actually looks like. Turning depth down
 * instead just produces noise, and noise reads as broken rather than weak.
 */
export interface Weights {
  /** A man, in hand or on the board. The anchor: everything else is priced
   *  against this. */
  material: number;
  /** A closed line of three. Modest, because the capture it already earned is
   *  counted in material — the mill itself is only worth what it can do next. */
  mills: number;
  /** Two on a line with the third point empty: a mill one move away. This is
   *  the whole forward-looking game. */
  threats: number;
  /** Points a man can slide to. Being boxed in loses games outright. */
  mobility: number;
  /** A man doing duty in two mills at once — the seed of a running mill. */
  doubleMills: number;
}

export const KNOWLEDGE: Record<string, Weights> = {
  // Counts men. Will still take a mill, because the capture shows up as
  // material — but never builds toward one and never sees yours coming.
  learner: { material: 100, mills: 0, threats: 0, mobility: 0, doubleMills: 0 },
  // Takes mills that are there; does not construct them or defend against them.
  casual: { material: 100, mills: 30, threats: 0, mobility: 0, doubleMills: 0 },
  // Reads threats and space. Will block you and punish loose play.
  club: { material: 100, mills: 30, threats: 10, mobility: 2, doubleMills: 0 },
  // Everything, including the structures that win endgames.
  expert: { material: 100, mills: 32, threats: 12, mobility: 3, doubleMills: 25 },
  // Same understanding as the expert; the difference is how far it looks.
  impossible: { material: 100, mills: 32, threats: 12, mobility: 3, doubleMills: 25 },
};

/** Score `s` from `me`'s point of view. Higher is better for `me`. */
export function evaluate(s: Position, me: Player, w: Weights): number {
  const them = opponent(me);
  const b = s.board;
  let score = 0;

  if (w.material !== 0) {
    const mine = s.onBoard[me] + s.hand[me];
    const theirs = s.onBoard[them] + s.hand[them];
    score += w.material * (mine - theirs);
  }

  if (w.mills !== 0 || w.threats !== 0) {
    let myMills = 0, theirMills = 0, myThreats = 0, theirThreats = 0;
    for (const [p, q, r] of MILLS) {
      let mine = 0, theirs = 0, empty = 0;
      for (const cell of [b[p], b[q], b[r]]) {
        if (cell === me) mine++;
        else if (cell === them) theirs++;
        else empty++;
      }
      if (mine === 3) myMills++;
      else if (theirs === 3) theirMills++;
      else if (mine === 2 && empty === 1) myThreats++;
      else if (theirs === 2 && empty === 1) theirThreats++;
    }
    score += w.mills * (myMills - theirMills);
    score += w.threats * (myThreats - theirThreats);
  }

  if (w.mobility !== 0) {
    let mine = 0, theirs = 0;
    for (let p = 0; p < POINTS; p++) {
      const owner = b[p];
      if (owner === EMPTY) continue;
      let free = 0;
      for (const q of ADJACENCY[p]) if (b[q] === EMPTY) free++;
      if (owner === me) mine += free;
      else theirs += free;
    }
    score += w.mobility * (mine - theirs);
  }

  if (w.doubleMills !== 0) {
    let mine = 0, theirs = 0;
    for (let p = 0; p < POINTS; p++) {
      const owner = b[p];
      if (owner === EMPTY) continue;
      let closed = 0;
      for (const [q, r, t] of MILLS_THROUGH[p]) {
        if (b[q] === owner && b[r] === owner && b[t] === owner) closed++;
      }
      if (closed === 2) {
        if (owner === me) mine++;
        else theirs++;
      }
    }
    score += w.doubleMills * (mine - theirs);
  }

  return score;
}
