/**
 * Test-only helpers for building positions by hand. Imported by *.test.ts
 * only, so it never reaches the app bundle.
 */
import { EMPTY, X, O, positionKey, type GameState } from './rules';

/** Build a board from a 24-char sketch: 'X', 'O', '.' by point index. */
export function board(sketch: string): number[] {
  const cells = sketch.replace(/\s/g, '');
  if (cells.length !== 24) throw new Error(`sketch has ${cells.length} cells, need 24`);
  return [...cells].map((c) => (c === 'X' ? X : c === 'O' ? O : EMPTY));
}

/** A position with both hands empty (the moving phase) unless overridden.
 *  History is seeded with the starting position, as a real game's would be. */
export function position(sketch: string, over: Partial<GameState> = {}): GameState {
  const b = board(sketch);
  const base: GameState = {
    board: b,
    turn: X,
    hand: { [X]: 0, [O]: 0 },
    onBoard: { [X]: b.filter((c) => c === X).length, [O]: b.filter((c) => c === O).length },
    result: null,
    ply: 0,
    sinceCapture: 0,
    history: [],
    ...over,
  };
  return over.history ? base : { ...base, history: [positionKey(base)] };
}
