import { describe, test, expect } from 'vitest';
import {
  EMPTY, X, O,
  PLACE, NO_REMOVE,
  createGame, legalMoves, applyMove, opponent,
  isMill, removableTargets, canFly, positionKey,
  type GameState, type Move,
} from './rules';

/** Build a board from a 24-char sketch: 'X', 'O', '.' by point index. */
function board(sketch: string): number[] {
  const cells = sketch.replace(/\s/g, '');
  if (cells.length !== 24) throw new Error(`sketch has ${cells.length} cells, need 24`);
  return [...cells].map((c) => (c === 'X' ? X : c === 'O' ? O : EMPTY));
}

/** A position with both hands empty (the moving phase) unless overridden.
 *  History is seeded with the starting position, as a real game's would be. */
function position(sketch: string, over: Partial<GameState> = {}): GameState {
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

const find = (moves: readonly Move[], m: Partial<Move>) =>
  moves.filter((x) =>
    (m.from === undefined || x.from === m.from) &&
    (m.to === undefined || x.to === m.to) &&
    (m.remove === undefined || x.remove === m.remove));

const asc = (a: number, b: number) => a - b;

describe('opening', () => {
  test('starts with nine men in hand each and an empty board', () => {
    const g = createGame();
    expect(g.hand[X]).toBe(9);
    expect(g.hand[O]).toBe(9);
    expect(g.board.every((c) => c === EMPTY)).toBe(true);
    expect(g.turn).toBe(X);
    expect(g.result).toBeNull();
  });

  test('first player may place on any of the 24 points', () => {
    const moves = legalMoves(createGame());
    expect(moves).toHaveLength(24);
    expect(moves.every((m) => m.from === PLACE && m.remove === NO_REMOVE)).toBe(true);
    expect(new Set(moves.map((m) => m.to)).size).toBe(24);
  });

  test('cannot place onto an occupied point', () => {
    const g = applyMove(createGame(), { from: PLACE, to: 4, remove: NO_REMOVE });
    expect(find(legalMoves(g), { to: 4 })).toHaveLength(0);
    expect(legalMoves(g)).toHaveLength(23);
  });
});

describe('mills', () => {
  test('three of a player in a line is a mill', () => {
    const b = board('XXX.....................');
    expect(isMill(b, 0)).toBe(true);
    expect(isMill(b, 1)).toBe(true);
  });

  test('a line of mixed owners is not a mill', () => {
    expect(isMill(board('XXO.....................'), 0)).toBe(false);
  });

  test('points across the empty centre belong to separate lines', () => {
    // 9,10,11 and 12,13,14 look like one row but 11 and 12 never connect.
    const b = board('.........XXXXXX.........');
    expect(isMill(b, 11)).toBe(true); // 9,10,11
    expect(isMill(b, 12)).toBe(true); // 12,13,14
  });

  test('completing a mill while placing offers a capture per removable enemy', () => {
    // X holds 0,1 and places 2 to close the top row. O sits loose on 21,22.
    const g = position('XX...................OO.', {
      hand: { [X]: 7, [O]: 7 },
      turn: X,
    });
    expect(find(legalMoves(g), { to: 2 }).map((m) => m.remove).sort(asc)).toEqual([21, 22]);
  });

  test('a mill still forms when the opponent has nothing to take', () => {
    // O has yet to put a man down. X closes the top row and simply gets no capture;
    // the move must not vanish from the move list for want of a target.
    const g = position('XX......................', {
      hand: { [X]: 7, [O]: 9 },
      turn: X,
    });
    expect(find(legalMoves(g), { to: 2 })).toEqual([{ from: PLACE, to: 2, remove: NO_REMOVE }]);
  });

  test('a placement that forms no mill offers no capture', () => {
    const g = position('X....................OO.', {
      hand: { [X]: 8, [O]: 7 },
      turn: X,
    });
    expect(find(legalMoves(g), { to: 5 })).toEqual([{ from: PLACE, to: 5, remove: NO_REMOVE }]);
  });

  test('a man sliding along its own line does not close a mill behind itself', () => {
    // X holds 0,1 and slides 1 -> 2, so the top row ends up holding 0 and 2 only.
    // A generator that forgets to lift the man off 1 first sees three in a row
    // and hands out a phantom capture.
    const g = position('XX...O...X..O..X....O..O', { turn: X });
    expect(find(legalMoves(g), { from: 1, to: 2 }))
      .toEqual([{ from: 1, to: 2, remove: NO_REMOVE }]);
  });

  test('sliding out of a mill is quiet; sliding back in re-fires the capture', () => {
    // The running mill. X owns the top row 0,1,2 plus a spare on 15.
    const open = position('XXX...O........X.....OO.', { turn: X });
    const shut = position('XX....O.......XX.....OO.', { turn: X });
    expect(find(legalMoves(open), { from: 2, to: 14 })[0].remove).toBe(NO_REMOVE);
    expect(find(legalMoves(shut), { from: 14, to: 2 }).map((m) => m.remove).sort(asc))
      .toEqual([6, 21, 22]);
  });
});

describe('capture restrictions', () => {
  test('a man inside a mill is protected while a loose man exists', () => {
    // O has a mill on 21,22,23 and a loose man on 5.
    expect(removableTargets(board('.....O...............OOO'), O)).toEqual([5]);
  });

  test('when every enemy man sits in a mill, mills lose protection', () => {
    expect(removableTargets(board('.....................OOO'), O)).toEqual([21, 22, 23]);
  });

  test('a man in two mills at once is still protected by the loose-man rule', () => {
    // O closes 0,1,2 and 0,9,21, so point 0 sits in two mills. Loose man on 5.
    expect(removableTargets(board('OOO..O...O...........O..'), O)).toEqual([5]);
  });
});

describe('placing to moving', () => {
  test('the phase turns over only after all eighteen men are down', () => {
    let g = createGame();
    const spots = [0, 21, 3, 18, 6, 15, 9, 12, 2, 23, 5, 20, 8, 17, 11, 14, 1, 22];
    for (let i = 0; i < 17; i++) {
      g = applyMove(g, { from: PLACE, to: spots[i], remove: NO_REMOVE });
      expect(legalMoves(g).every((m) => m.from === PLACE), `ply ${i}`).toBe(true);
    }
    g = applyMove(g, { from: PLACE, to: spots[17], remove: NO_REMOVE });
    expect(g.hand[X]).toBe(0);
    expect(g.hand[O]).toBe(0);
    expect(legalMoves(g).every((m) => m.from !== PLACE)).toBe(true);
  });
});

describe('moving', () => {
  test('a man slides only to an adjacent empty point', () => {
    // X on 4, the degree-4 midpoint. Neighbours 1,3,5,7 all empty.
    const g = position('....X....X..OO.X....OX.O', { turn: X });
    expect(find(legalMoves(g), { from: 4 }).map((m) => m.to).sort(asc)).toEqual([1, 3, 5, 7]);
  });

  test('a man cannot slide onto an occupied neighbour', () => {
    // X on 4 with a friend on 3 and an enemy on 5. Only 1 and 7 remain.
    const g = position('...XXO...X..OO.......X.O', { turn: X });
    expect(find(legalMoves(g), { from: 4 }).map((m) => m.to).sort(asc)).toEqual([1, 7]);
  });

  test('a man cannot jump across the empty centre', () => {
    const g = position('X.X..O..OX.X.....O.O.X..', { turn: X });
    expect(find(legalMoves(g), { from: 11, to: 12 })).toHaveLength(0);
  });
});

describe('flying', () => {
  // X on 0,4,23: no two share a mill line, so no single move can close one.
  const threeMen = 'X...X.O.....O....O.O...X';

  test('a player down to three men may fly once their hand is empty', () => {
    const g = position(threeMen, { turn: X });
    expect(canFly(g, X)).toBe(true);
    expect(g.onBoard[X]).toBe(3);
    // 3 men x 17 empty points, and no mill is reachable from here.
    expect(legalMoves(g)).toHaveLength(3 * 17);
  });

  test('three on the board does not grant flight while men remain in hand', () => {
    const g = position(threeMen, { turn: X, hand: { [X]: 4, [O]: 2 } });
    expect(canFly(g, X)).toBe(false);
    expect(legalMoves(g).every((m) => m.from === PLACE)).toBe(true);
  });

  test('flight is lost again at four men', () => {
    const g = position('X...X.O.....O....O.O..XX', { turn: X });
    expect(g.onBoard[X]).toBe(4);
    expect(canFly(g, X)).toBe(false);
  });

  test('a flying player still captures on closing a mill', () => {
    // X holds 0,1 and flies its last man 15 -> 2. O has a mill plus a loose man on 18.
    const g = position('XX.............X..O..OOO', { turn: X });
    expect(canFly(g, X)).toBe(true);
    expect(find(legalMoves(g), { from: 15, to: 2 }).map((m) => m.remove)).toEqual([18]);
  });
});

describe('endings', () => {
  test('reducing an opponent to two men wins', () => {
    // X slides 14 -> 2 to close the top row and takes O's third man.
    const g = position('XX...OX.......X..O..O...', { turn: X });
    const kill = find(legalMoves(g), { from: 14, to: 2, remove: 5 })[0];
    expect(kill).toBeDefined();
    const after = applyMove(g, kill);
    expect(after.onBoard[O]).toBe(2);
    expect(after.result).toEqual({ kind: 'win', winner: X, reason: 'annihilation' });
  });

  test('taking an opponent down to three men leaves them alive, and flying', () => {
    // Three men is the flying threshold, not the losing one. Only the fall to
    // two ends it.
    const g = position('XX...OX.......X..O..O..O', { turn: X });
    expect(g.onBoard[O]).toBe(4);
    const after = applyMove(g, find(legalMoves(g), { from: 14, to: 2, remove: 5 })[0]);
    expect(after.onBoard[O]).toBe(3);
    expect(after.result).toBeNull();
    expect(canFly(after, O)).toBe(true);
  });

  test('two men on the board during placing is not yet a loss', () => {
    const g = position('XX...............O...O..', {
      turn: X,
      hand: { [X]: 6, [O]: 5 },
    });
    expect(g.result).toBeNull();
    expect(legalMoves(g).length).toBeGreaterThan(0);
  });

  test('a fully boxed-in player has no legal move', () => {
    // X holds the four outer corners; O holds the four outer midpoints.
    const g = position('XOX......O....O......XOX', { turn: X });
    expect(g.onBoard[X]).toBe(4); // four men, so no escape by flying
    expect(legalMoves(g)).toEqual([]);
  });

  test('sealing the last free point wins by blocking', () => {
    // O slides 19 -> 22 and X, on the four corners, has nowhere left to go.
    const g = position('XOX......O....O....O.X.X', { turn: O });
    const seal = find(legalMoves(g), { from: 19, to: 22 })[0];
    expect(seal).toBeDefined();
    const after = applyMove(g, seal);
    expect(after.result).toEqual({ kind: 'win', winner: O, reason: 'blocked' });
  });
});

describe('turn order and immutability', () => {
  test('applying a move does not mutate the prior state', () => {
    const g = createGame();
    const snapshot = [...g.board];
    applyMove(g, { from: PLACE, to: 4, remove: NO_REMOVE });
    expect(g.board).toEqual(snapshot);
    expect(g.hand[X]).toBe(9);
  });

  test('the turn passes to the opponent', () => {
    const g = applyMove(createGame(), { from: PLACE, to: 4, remove: NO_REMOVE });
    expect(g.turn).toBe(O);
    expect(opponent(X)).toBe(O);
    expect(opponent(O)).toBe(X);
  });

  test('a slide vacates the point it came from', () => {
    const g = position('XX...OX.......X..O..O..O', { turn: X });
    const after = applyMove(g, { from: 6, to: 7, remove: NO_REMOVE });
    expect(after.board[6]).toBe(EMPTY);
    expect(after.board[7]).toBe(X);
    expect(after.onBoard[X]).toBe(4); // moved, not cloned
  });

  test('a capture clears the point and decrements the victim', () => {
    const g = position('XX...O..................', { hand: { [X]: 7, [O]: 8 }, turn: X });
    const after = applyMove(g, { from: PLACE, to: 2, remove: 5 });
    expect(after.board[2]).toBe(X);
    expect(after.board[5]).toBe(EMPTY);
    expect(after.onBoard[O]).toBe(0);
    expect(after.result).toBeNull(); // O still has men in hand
  });
});

describe('draws', () => {
  test('a hundred plies without a capture is a draw', () => {
    const g = position('XX.XX....O..O.O.O.......', { turn: X, sinceCapture: 99 });
    const quiet = legalMoves(g).find((m) => m.remove === NO_REMOVE)!;
    expect(applyMove(g, quiet).result).toEqual({ kind: 'draw', reason: 'fifty-move' });
  });

  test('a capture resets the counter', () => {
    const g = position('XX...O..................', {
      hand: { [X]: 7, [O]: 8 }, turn: X, sinceCapture: 80,
    });
    expect(applyMove(g, { from: PLACE, to: 2, remove: 5 }).sinceCapture).toBe(0);
  });

  test('a position seen twice stands; the third sighting is a draw', () => {
    // Both sides shuffle one man back and forth: X 0<->1, O 8<->7. Each lap of
    // four plies brings the opening position back around.
    let g = position('X.XX..O.O....O.X.O......', { turn: X });
    const lap: Move[] = [
      { from: 0, to: 1, remove: NO_REMOVE },
      { from: 8, to: 7, remove: NO_REMOVE },
      { from: 1, to: 0, remove: NO_REMOVE },
      { from: 7, to: 8, remove: NO_REMOVE },
    ];
    for (const m of lap) g = applyMove(g, m);
    expect(g.result, 'second sighting is not yet a draw').toBeNull();
    for (const m of lap) g = applyMove(g, m);
    expect(g.result).toEqual({ kind: 'draw', reason: 'repetition' });
  });
});
