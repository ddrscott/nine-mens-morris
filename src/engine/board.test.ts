import { describe, test, expect } from 'vitest';
import { POINTS, ADJACENCY, MILLS, MILLS_THROUGH, COORDS } from './board';

describe('board topology', () => {
  test('has 24 points', () => {
    expect(POINTS).toBe(24);
  });

  test('has 16 mills', () => {
    expect(MILLS).toHaveLength(16);
  });

  test('every mill names three distinct points on the board', () => {
    for (const mill of MILLS) {
      expect(mill).toHaveLength(3);
      expect(new Set(mill).size).toBe(3);
      for (const p of mill) {
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThan(POINTS);
      }
    }
  });

  test('every point belongs to exactly two mills', () => {
    // One horizontal, one vertical. This is what makes the board work:
    // no point is a dead end, every point is a double-mill candidate.
    for (let p = 0; p < POINTS; p++) {
      const owning = MILLS.filter((m) => m.includes(p));
      expect(owning, `point ${p}`).toHaveLength(2);
    }
  });

  test('adjacency is symmetric', () => {
    for (let p = 0; p < POINTS; p++) {
      for (const q of ADJACENCY[p]) {
        expect(ADJACENCY[q], `${p}->${q} not mirrored`).toContain(p);
      }
    }
  });

  test('no point is adjacent to itself', () => {
    for (let p = 0; p < POINTS; p++) {
      expect(ADJACENCY[p]).not.toContain(p);
    }
  });

  test('has 32 edges', () => {
    const degrees = ADJACENCY.reduce((sum, a) => sum + a.length, 0);
    expect(degrees % 2).toBe(0);
    expect(degrees / 2).toBe(32);
  });

  test('every point has 2, 3, or 4 neighbours', () => {
    for (let p = 0; p < POINTS; p++) {
      expect(ADJACENCY[p].length, `point ${p}`).toBeGreaterThanOrEqual(2);
      expect(ADJACENCY[p].length, `point ${p}`).toBeLessThanOrEqual(4);
    }
  });

  test('the four cross-line midpoints are the only degree-4 points', () => {
    // 4, 10, 13, 19 are the middle-ring midpoints where a cross line
    // meets the ring. They are the most valuable squares on the board.
    const degree4 = [...Array(POINTS).keys()].filter((p) => ADJACENCY[p].length === 4);
    expect(degree4.sort((a, b) => a - b)).toEqual([4, 10, 13, 19]);
  });

  test('the board graph is connected', () => {
    const seen = new Set<number>([0]);
    const stack = [0];
    while (stack.length) {
      for (const q of ADJACENCY[stack.pop()!]) {
        if (!seen.has(q)) {
          seen.add(q);
          stack.push(q);
        }
      }
    }
    expect(seen.size).toBe(POINTS);
  });

  test('MILLS_THROUGH indexes the same mills as MILLS', () => {
    for (let p = 0; p < POINTS; p++) {
      const expected = MILLS.filter((m) => m.includes(p));
      expect(MILLS_THROUGH[p]).toHaveLength(2);
      for (const mill of MILLS_THROUGH[p]) {
        expect(expected).toContainEqual(mill);
      }
    }
  });

  test('adjacent points always share a mill line', () => {
    // Two points are only connected if a line runs through both, so any
    // edge must live inside some mill. Catches edges invented by typo.
    for (let p = 0; p < POINTS; p++) {
      for (const q of ADJACENCY[p]) {
        const shared = MILLS.some((m) => m.includes(p) && m.includes(q));
        expect(shared, `edge ${p}-${q} lies on no mill line`).toBe(true);
      }
    }
  });

  test('every point has a distinct coordinate', () => {
    expect(COORDS).toHaveLength(POINTS);
    const keys = COORDS.map(({ x, y }) => `${x},${y}`);
    expect(new Set(keys).size).toBe(POINTS);
  });

  test('there is no point at the board centre', () => {
    expect(COORDS.some(({ x, y }) => x === 3 && y === 3)).toBe(false);
  });

  test('mills are straight lines in board coordinates', () => {
    // Every mill is three collinear points, and they are consecutive
    // along that line (no mill jumps the centre).
    for (const mill of MILLS) {
      const cs = mill.map((p) => COORDS[p]);
      const sameRow = cs.every((c) => c.y === cs[0].y);
      const sameCol = cs.every((c) => c.x === cs[0].x);
      expect(sameRow || sameCol, `mill ${mill} is not collinear`).toBe(true);
    }
  });
});
