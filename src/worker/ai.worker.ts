/// <reference lib="webworker" />
import { chooseMove, tierById } from '../engine/difficulty';
import { search } from '../engine/search';
import { KNOWLEDGE } from '../engine/eval';
import { legalMoves } from '../engine/rules';
import type { GameState, Move, Player } from '../engine/types';

export interface MoveRequest {
  id: number;
  kind: 'move';
  game: GameState;
  tierId: string;
}

export interface ReviewRequest {
  id: number;
  kind: 'review';
  /** Every position the game passed through, and the move played from each. */
  timeline: { game: GameState; move: Move }[];
  human: Player;
}

export type Request = MoveRequest | ReviewRequest;

/** One move the player would want back. */
export interface Finding {
  /** Index into the timeline. */
  ply: number;
  played: Move;
  better: Move;
  /** How much the move gave up, in men (100 points = one man). */
  cost: number;
}

export type Response =
  | { id: number; kind: 'move'; move: Move }
  | { id: number; kind: 'review'; findings: Finding[] }
  | { id: number; kind: 'error'; message: string };

const sameMove = (a: Move, b: Move) =>
  a.from === b.from && a.to === b.to && a.remove === b.remove;

/**
 * Grade the human's moves against a strong search. Only moves that gave up
 * real ground are reported — a review that flags everything teaches nothing.
 */
function review(timeline: { game: GameState; move: Move }[], human: Player): Finding[] {
  const REPORT_THRESHOLD = 60; // points; below this it is taste, not error
  const findings: Finding[] = [];

  for (const [ply, step] of timeline.entries()) {
    if (step.game.turn !== human || step.game.result) continue;
    if (legalMoves(step.game).length < 2) continue; // no choice, no blunder

    const r = search(step.game, {
      weights: KNOWLEDGE.expert,
      depth: 4,
      exactRoots: true, // the numbers are the whole point here
    });
    const played = r.roots.find((x) => sameMove(x.move, step.move));
    if (!played) continue;

    const cost = r.roots[0].score - played.score;
    if (cost >= REPORT_THRESHOLD && !sameMove(r.roots[0].move, step.move)) {
      findings.push({ ply, played: step.move, better: r.roots[0].move, cost });
    }
  }

  return findings.sort((a, b) => b.cost - a.cost).slice(0, 4);
}

self.onmessage = (e: MessageEvent<Request>) => {
  const req = e.data;
  try {
    if (req.kind === 'move') {
      const move = chooseMove(req.game, tierById(req.tierId));
      const res: Response = { id: req.id, kind: 'move', move };
      self.postMessage(res);
      return;
    }
    const res: Response = { id: req.id, kind: 'review', findings: review(req.timeline, req.human) };
    self.postMessage(res);
  } catch (err) {
    const res: Response = {
      id: req.id,
      kind: 'error',
      message: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(res);
  }
};
