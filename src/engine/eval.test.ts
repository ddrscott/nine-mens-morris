import { describe, test, expect } from 'vitest';
import { evaluate, KNOWLEDGE, type Weights } from './eval';
import { X, O } from './rules';
import { position } from './fixtures';

const FULL = KNOWLEDGE.expert;
const only = (f: keyof Weights): Weights =>
  ({ material: 0, mills: 0, threats: 0, mobility: 0, doubleMills: 0, [f]: 1 });

describe('evaluation is a difference, not a tally', () => {
  test('a position mirrored about the centre scores zero', () => {
    // X on 0,1,9 maps onto O's 23,22,14 under a half-turn of the board.
    expect(evaluate(position('XX.......X....O.......OO'), X, FULL)).toBe(0);
  });

  test('the score flips sign when read from the other side', () => {
    const g = position('XXX..O...X..O.O.O....O..');
    expect(evaluate(g, X, FULL)).toBe(-evaluate(g, O, FULL));
  });

  test('an extra man is worth something to whoever holds it', () => {
    const even = position('XX.......X....O.......OO');
    const up = position('XXX......X....O.......OO');
    expect(evaluate(up, X, FULL)).toBeGreaterThan(evaluate(even, X, FULL));
  });

  test('men still in hand count as material', () => {
    const g = position('XX.......X....O.......OO', { hand: { [X]: 3, [O]: 0 } });
    expect(evaluate(g, X, KNOWLEDGE.learner)).toBeGreaterThan(0);
  });
});

describe('knowledge tiers see different boards', () => {
  // Identical material either way: X's three men are a closed mill in one and
  // scattered in the other. Only a tier that knows mills can tell them apart.
  const milled = position('XXX......O....O.......O.');
  const loose = position('X.X..X...O....O.......O.');

  test('the learner cannot tell a mill from three scattered men', () => {
    expect(evaluate(milled, X, KNOWLEDGE.learner))
      .toBe(evaluate(loose, X, KNOWLEDGE.learner));
  });

  test('the casual player prefers the mill', () => {
    expect(evaluate(milled, X, KNOWLEDGE.casual))
      .toBeGreaterThan(evaluate(loose, X, KNOWLEDGE.casual));
  });

  // Same men, same count: 0+1 is one move from closing the top row, 0+5 is not.
  const threat = position('XX.......O....O.......O.');
  const idle = position('X....X...O....O.......O.');

  test('the learner is blind to a mill one move away', () => {
    expect(evaluate(threat, X, KNOWLEDGE.learner))
      .toBe(evaluate(idle, X, KNOWLEDGE.learner));
  });

  test('the casual player is blind to a mill one move away', () => {
    // Casual takes mills that are there; it does not build toward them.
    expect(evaluate(threat, X, KNOWLEDGE.casual))
      .toBe(evaluate(idle, X, KNOWLEDGE.casual));
  });

  test('the club player reads a mill one move away', () => {
    expect(evaluate(threat, X, KNOWLEDGE.club))
      .toBeGreaterThan(evaluate(idle, X, KNOWLEDGE.club));
  });

  test('an enemy threat reads as a negative', () => {
    // Material identical; only O's 21+22 pointing at 23 differs.
    const safe = position('X....X...O....O.....OO..');
    const danger = position('X....X...O....O......OO.');
    expect(evaluate(danger, X, only('threats')))
      .toBeLessThan(evaluate(safe, X, only('threats')));
  });

  test('only the expert values a man doing duty in two mills', () => {
    // X closes 0,1,2 and 0,9,21 at once, so point 0 sits in both.
    const doubled = position('XXX......X...........X.O');
    const blind: Weights = { ...KNOWLEDGE.expert, doubleMills: 0 };
    expect(evaluate(doubled, X, KNOWLEDGE.expert))
      .toBeGreaterThan(evaluate(doubled, X, blind));
    expect(KNOWLEDGE.club.doubleMills).toBe(0);
  });
});

describe('mobility', () => {
  // X holds the four corners; O holds the midpoints and X cannot move at all.
  const boxed = position('XOX......O....O......XOX', { turn: O });

  test('boxing the opponent in scores well', () => {
    expect(evaluate(boxed, O, KNOWLEDGE.club)).toBeGreaterThan(0);
  });

  test('the casual player sees nothing wrong with being boxed in', () => {
    // Equal material, no mills, no threats — and it cannot read mobility.
    expect(evaluate(boxed, O, KNOWLEDGE.casual)).toBe(0);
  });
});
