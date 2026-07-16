import { POINTS } from './board';
import { EMPTY, X, O, type Position } from './types';

/**
 * Zobrist hashing.
 *
 * Two independent 32-bit streams are folded into one number: 21 bits of `hi`
 * above 32 bits of `lo`, which lands at 53 bits — exactly what a JS number
 * holds exactly. That keeps hashes usable as Map keys and as array indices
 * without BigInt, at a collision rate that is irrelevant at this game's size.
 */

const HI_BITS = 0x1fffff; // 21 bits

function xorshift32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s >>> 0;
  };
}

const next = xorshift32(0x9e3779b9);

// [point][cell] — index 0 (EMPTY) stays zero so unoccupied points contribute nothing.
const PT_LO: number[][] = [];
const PT_HI: number[][] = [];
for (let p = 0; p < POINTS; p++) {
  PT_LO[p] = [0, next(), next()];
  PT_HI[p] = [0, next() & HI_BITS, next() & HI_BITS];
}

const TURN_LO = next();
const TURN_HI = next() & HI_BITS;

// [player][men still in hand], 0..9
const HAND_LO: number[][] = [[], [], []];
const HAND_HI: number[][] = [[], [], []];
for (const p of [X, O]) {
  for (let n = 0; n <= 9; n++) {
    HAND_LO[p][n] = next();
    HAND_HI[p][n] = next() & HI_BITS;
  }
}

/**
 * Identity of a position: who stands where, whose turn it is, and what is
 * still in hand. Two positions sharing a hash are the same position for
 * repetition and transposition purposes.
 */
export function hashPosition(s: Position): number {
  let lo = 0;
  let hi = 0;

  const b = s.board;
  for (let p = 0; p < POINTS; p++) {
    const cell = b[p];
    if (cell === EMPTY) continue;
    lo ^= PT_LO[p][cell];
    hi ^= PT_HI[p][cell];
  }

  if (s.turn === O) {
    lo ^= TURN_LO;
    hi ^= TURN_HI;
  }

  lo ^= HAND_LO[X][s.hand[X]] ^ HAND_LO[O][s.hand[O]];
  hi ^= HAND_HI[X][s.hand[X]] ^ HAND_HI[O][s.hand[O]];

  return (hi >>> 0) * 4294967296 + (lo >>> 0);
}
