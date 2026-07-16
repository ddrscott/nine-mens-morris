/**
 * Board topology for Nine Men's Morris.
 *
 * Points are numbered left-to-right, top-to-bottom. The middle row splits
 * around the empty centre, which is why 11 and 12 are not adjacent:
 *
 *   0--------1--------2
 *   |        |        |
 *   |  3-----4-----5  |
 *   |  |     |     |  |
 *   |  |  6--7--8  |  |
 *   |  |  |     |  |  |
 *   9--10-11    12-13-14
 *   |  |  |     |  |  |
 *   |  |  15-16-17 |  |
 *   |  |     |     |  |
 *   |  18----19----20 |
 *   |        |        |
 *   21-------22-------23
 */

export const POINTS = 24;

/** Layout coordinates on a 7x7 lattice. Rendering scales these; the engine
 *  only uses them to reason about lines. */
export const COORDS: ReadonlyArray<{ x: number; y: number }> = [
  { x: 0, y: 0 }, { x: 3, y: 0 }, { x: 6, y: 0 },
  { x: 1, y: 1 }, { x: 3, y: 1 }, { x: 5, y: 1 },
  { x: 2, y: 2 }, { x: 3, y: 2 }, { x: 4, y: 2 },
  { x: 0, y: 3 }, { x: 1, y: 3 }, { x: 2, y: 3 },
  { x: 4, y: 3 }, { x: 5, y: 3 }, { x: 6, y: 3 },
  { x: 2, y: 4 }, { x: 3, y: 4 }, { x: 4, y: 4 },
  { x: 1, y: 5 }, { x: 3, y: 5 }, { x: 5, y: 5 },
  { x: 0, y: 6 }, { x: 3, y: 6 }, { x: 6, y: 6 },
];

export type Mill = readonly [number, number, number];

/** The 16 lines of three: 8 across the rings, 8 along the columns. */
export const MILLS: ReadonlyArray<Mill> = [
  // horizontal
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [9, 10, 11], [12, 13, 14],
  [15, 16, 17], [18, 19, 20], [21, 22, 23],
  // vertical
  [0, 9, 21], [3, 10, 18], [6, 11, 15], [1, 4, 7],
  [16, 19, 22], [8, 12, 17], [5, 13, 20], [2, 14, 23],
];

export const ADJACENCY: ReadonlyArray<readonly number[]> = [
  /*  0 */ [1, 9],
  /*  1 */ [0, 2, 4],
  /*  2 */ [1, 14],
  /*  3 */ [4, 10],
  /*  4 */ [1, 3, 5, 7],
  /*  5 */ [4, 13],
  /*  6 */ [7, 11],
  /*  7 */ [4, 6, 8],
  /*  8 */ [7, 12],
  /*  9 */ [0, 10, 21],
  /* 10 */ [3, 9, 11, 18],
  /* 11 */ [6, 10, 15],
  /* 12 */ [8, 13, 17],
  /* 13 */ [5, 12, 14, 20],
  /* 14 */ [2, 13, 23],
  /* 15 */ [11, 16],
  /* 16 */ [15, 17, 19],
  /* 17 */ [12, 16],
  /* 18 */ [10, 19],
  /* 19 */ [16, 18, 20, 22],
  /* 20 */ [13, 19],
  /* 21 */ [9, 22],
  /* 22 */ [19, 21, 23],
  /* 23 */ [14, 22],
];

/** The two mills (one horizontal, one vertical) running through each point.
 *  Derived, not hand-written: hand-written would drift from MILLS. */
export const MILLS_THROUGH: ReadonlyArray<ReadonlyArray<Mill>> = Array.from(
  { length: POINTS },
  (_, p) => MILLS.filter((m) => m.includes(p)),
);
