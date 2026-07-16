/**
 * Core vocabulary. Depends on nothing, so every other engine module can import
 * it without tangling: board -> types -> zobrist -> rules -> eval -> search.
 */

export const EMPTY = 0;
export const X = 1;
export const O = 2;

export type Player = typeof X | typeof O;

/** `from` sentinel for dropping a new man during the placing phase. */
export const PLACE = -1;
/** `remove` sentinel for a move that closes no mill. */
export const NO_REMOVE = -1;

/**
 * A move is atomic: the capture a mill earns is part of the move rather than a
 * follow-up state. That keeps the game tree strictly alternating, so search
 * never has to model the same player acting twice.
 */
export interface Move {
  readonly from: number;
  readonly to: number;
  readonly remove: number;
}

export type Result =
  | { kind: 'win'; winner: Player; reason: 'annihilation' | 'blocked' }
  | { kind: 'draw'; reason: 'fifty-move' | 'repetition' };

/** Everything move generation needs. Search passes a mutable object shaped
 *  like this, so both it and the UI share one generator. */
export interface Position {
  readonly board: readonly number[];
  readonly turn: Player;
  readonly hand: Readonly<Record<Player, number>>;
  readonly onBoard: Readonly<Record<Player, number>>;
}

export interface GameState extends Position {
  readonly result: Result | null;
  readonly ply: number;
  /** Plies since the last capture. 100 (fifty moves each) is a draw. */
  readonly sinceCapture: number;
  /** Zobrist hashes of every position reached, the opening included. */
  readonly history: readonly number[];
}

export const opponent = (p: Player): Player => (p === X ? O : X);
