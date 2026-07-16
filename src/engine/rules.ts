import { POINTS, ADJACENCY, MILLS_THROUGH } from './board';
import { hashPosition } from './zobrist';
import {
  EMPTY, PLACE, NO_REMOVE,
  opponent,
  type Player, type Move, type Result, type Position, type GameState,
} from './types';

// rules.ts is the engine's public face: callers get the vocabulary and the
// rules from one place.
export * from './types';

/** Identity of a position for repetition and transposition purposes. */
export { hashPosition as positionKey } from './zobrist';

export function createGame(): GameState {
  const base: GameState = {
    board: new Array(POINTS).fill(EMPTY),
    turn: 1,
    hand: { 1: 9, 2: 9 },
    onBoard: { 1: 0, 2: 0 },
    result: null,
    ply: 0,
    sinceCapture: 0,
    history: [],
  };
  return { ...base, history: [hashPosition(base)] };
}

/** Is the man on `p` part of a closed line? */
export function isMill(board: readonly number[], p: number): boolean {
  const owner = board[p];
  if (owner === EMPTY) return false;
  for (const [a, b, c] of MILLS_THROUGH[p]) {
    if (board[a] === owner && board[b] === owner && board[c] === owner) return true;
  }
  return false;
}

/**
 * Which of `victim`'s men may be taken: the loose ones, or — when every last
 * man is walled up inside a mill — any of them.
 */
export function removableTargets(board: readonly number[], victim: Player): number[] {
  const all: number[] = [];
  const loose: number[] = [];
  for (let p = 0; p < POINTS; p++) {
    if (board[p] !== victim) continue;
    all.push(p);
    if (!isMill(board, p)) loose.push(p);
  }
  return loose.length > 0 ? loose : all;
}

/** Down to three men with an empty hand: this player moves anywhere. */
export function canFly(s: Position, p: Player): boolean {
  return s.hand[p] === 0 && s.onBoard[p] === 3;
}

export function legalMoves(s: Position): Move[] {
  const me = s.turn;
  const them = opponent(me);
  const moves: Move[] = [];

  // Scratch copy so each candidate can be tested in place and rolled back.
  const b = s.board.slice();

  // A move never touches an enemy man, so it cannot change which enemy men sit
  // in mills. The target list is therefore identical for every move here.
  let targets: number[] | null = null;

  const emit = (from: number, to: number) => {
    if (from !== PLACE) b[from] = EMPTY;
    b[to] = me;
    const closes = isMill(b, to);
    b[to] = EMPTY;
    if (from !== PLACE) b[from] = me;

    if (!closes) {
      moves.push({ from, to, remove: NO_REMOVE });
      return;
    }
    targets ??= removableTargets(s.board, them);
    if (targets.length === 0) {
      // A mill with nothing to take is still a legal move.
      moves.push({ from, to, remove: NO_REMOVE });
      return;
    }
    for (const r of targets) moves.push({ from, to, remove: r });
  };

  if (s.hand[me] > 0) {
    for (let to = 0; to < POINTS; to++) if (b[to] === EMPTY) emit(PLACE, to);
    return moves;
  }

  const flying = canFly(s, me);
  for (let from = 0; from < POINTS; from++) {
    if (b[from] !== me) continue;
    if (flying) {
      for (let to = 0; to < POINTS; to++) if (b[to] === EMPTY) emit(from, to);
    } else {
      for (const to of ADJACENCY[from]) if (b[to] === EMPTY) emit(from, to);
    }
  }
  return moves;
}

function outcome(s: GameState, history: readonly number[], k: number): Result | null {
  const mover = s.turn; // s.turn is already the *next* player to act
  const justMoved = opponent(mover);

  // Checked before blocking: two men can still shuffle, but the game is over.
  if (s.hand[mover] === 0 && s.onBoard[mover] < 3) {
    return { kind: 'win', winner: justMoved, reason: 'annihilation' };
  }
  if (legalMoves(s).length === 0) {
    return { kind: 'win', winner: justMoved, reason: 'blocked' };
  }
  if (s.sinceCapture >= 100) return { kind: 'draw', reason: 'fifty-move' };

  let seen = 0;
  for (const h of history) if (h === k) seen++;
  if (seen >= 3) return { kind: 'draw', reason: 'repetition' };

  return null;
}

export function applyMove(s: GameState, m: Move): GameState {
  const me = s.turn;
  const them = opponent(me);

  const board = s.board.slice();
  const hand = { ...s.hand };
  const onBoard = { ...s.onBoard };

  if (m.from === PLACE) {
    hand[me]--;
    onBoard[me]++;
  } else {
    board[m.from] = EMPTY;
  }
  board[m.to] = me;

  if (m.remove !== NO_REMOVE) {
    board[m.remove] = EMPTY;
    onBoard[them]--;
  }

  const next: GameState = {
    board,
    turn: them,
    hand,
    onBoard,
    result: null,
    ply: s.ply + 1,
    sinceCapture: m.remove === NO_REMOVE ? s.sinceCapture + 1 : 0,
    history: s.history,
  };

  const k = hashPosition(next);
  const history = [...s.history, k];
  return { ...next, history, result: outcome(next, history, k) };
}
