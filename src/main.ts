import './style.css';
import { MILLS, ADJACENCY, type Mill } from './engine/board';
import {
  EMPTY, X, O, PLACE, NO_REMOVE,
  createGame, legalMoves, applyMove, canFly, opponent,
  type GameState, type Move, type Player,
} from './engine/rules';
import { TIERS, tierById, type Tier } from './engine/difficulty';
import { BoardView } from './ui/board';
import type { MoveRequest, ReviewRequest, Response, Finding } from './worker/ai.worker';

/** Omit over a union collapses it, so spell the unsent shapes out. */
type Ask = Omit<MoveRequest, 'id'> | Omit<ReviewRequest, 'id'>;

const HUMAN: Player = X;
const ENGINE: Player = O;

type Phase =
  | { kind: 'idle' }
  | { kind: 'holding'; from: number }
  | { kind: 'capturing'; from: number; to: number; targets: number[] }
  | { kind: 'thinking' }
  | { kind: 'over' };

interface Step { game: GameState; move: Move }

let game = createGame();
let tier: Tier = tierById('club');
let phase: Phase = { kind: 'idle' };
let hints = true;
let timeline: Step[] = [];
let findings: Finding[] | null = null;
let reviewAt: number | null = null;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const board = new BoardView();
$('board-mount').append(board.el);

const worker = new Worker(new URL('./worker/ai.worker.ts', import.meta.url), { type: 'module' });
let nextId = 1;
const pending = new Map<number, (r: Response) => void>();
worker.onmessage = (e: MessageEvent<Response>) => pending.get(e.data.id)?.(e.data);

function ask(req: Ask): Promise<Response> {
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, (r) => { pending.delete(id); resolve(r); });
    worker.postMessage({ ...req, id });
  });
}

/* ---------------------------------------------------------------- reading the board */

/** Mills currently closed, whoever owns them. */
function closedMills(g: GameState): Mill[] {
  return MILLS.filter((m) => {
    const owner = g.board[m[0]];
    return owner !== EMPTY && g.board[m[1]] === owner && g.board[m[2]] === owner;
  });
}

/**
 * Can `pl` actually put a man on `gap` to close `mill`? A hint that flags
 * lines nobody can reach teaches the wrong lesson, so this checks properly:
 * the man used must come from outside the line, since pulling one of the two
 * already in it just reopens the gap somewhere else.
 */
function canClose(g: GameState, pl: Player, gap: number, mill: Mill): boolean {
  if (g.hand[pl] > 0) return true;
  if (canFly(g, pl)) return true;
  return ADJACENCY[gap].some((q) => g.board[q] === pl && !mill.includes(q));
}

/** Open circuits: two men on a line, the third point empty and reachable. */
function openCircuits(g: GameState): { point: number; owner: Player }[] {
  const out: { point: number; owner: Player }[] = [];
  for (const mill of MILLS) {
    let gap = -1;
    const held: Record<number, number> = { [X]: 0, [O]: 0 };
    for (const p of mill) {
      if (g.board[p] === EMPTY) gap = p;
      else held[g.board[p]]++;
    }
    if (gap < 0) continue;
    for (const pl of [X, O] as Player[]) {
      if (held[pl] === 2 && held[opponent(pl)] === 0 && canClose(g, pl, gap, mill)) {
        out.push({ point: gap, owner: pl });
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------------ playing */

function movesFrom(from: number): Move[] {
  return legalMoves(game).filter((m) => m.from === from);
}

function commit(move: Move): void {
  timeline.push({ game, move });
  game = applyMove(game, move);
  phase = game.result ? { kind: 'over' } : { kind: 'idle' };
  render();
  if (!game.result && game.turn === ENGINE) void engineTurn();
  if (game.result) $('review').hidden = false;
}

async function engineTurn(): Promise<void> {
  phase = { kind: 'thinking' };
  render();
  const started = Date.now();
  const res = await ask({ kind: 'move', game, tierId: tier.id });
  if (res.kind === 'error') {
    setStatus(`The engine stalled: ${res.message}`);
    phase = { kind: 'idle' };
    render();
    return;
  }
  if (res.kind !== 'move') return;
  // Let a fast tier's move still read as a move rather than a flicker.
  const rest = 260 - (Date.now() - started);
  if (rest > 0) await new Promise((r) => setTimeout(r, rest));
  commit(res.move);
}

function pick(p: number): void {
  if (reviewAt !== null) return;
  if (game.result || game.turn !== HUMAN) return;

  if (phase.kind === 'capturing') {
    if (phase.targets.includes(p)) commit({ from: phase.from, to: phase.to, remove: p });
    return;
  }

  const placing = game.hand[HUMAN] > 0;

  if (placing) {
    if (game.board[p] !== EMPTY) return;
    offer(movesFrom(PLACE).filter((m) => m.to === p));
    return;
  }

  if (phase.kind === 'holding') {
    if (p === phase.from) { phase = { kind: 'idle' }; render(); return; }
    const onward = movesFrom(phase.from).filter((m) => m.to === p);
    if (onward.length > 0) { offer(onward); return; }
  }

  if (game.board[p] === HUMAN && movesFrom(p).length > 0) {
    phase = { kind: 'holding', from: p };
    render();
  }
}

/** One matching move plays at once; several means the mill closed and the
 *  player has to say which man to take. */
function offer(matching: Move[]): void {
  if (matching.length === 0) return;
  if (matching.length === 1 && matching[0].remove === NO_REMOVE) {
    commit(matching[0]);
    return;
  }
  phase = {
    kind: 'capturing',
    from: matching[0].from,
    to: matching[0].to,
    targets: matching.map((m) => m.remove),
  };
  render();
}

/**
 * The board mid-capture.
 *
 * A move is atomic in the engine — the man lands and the capture happens in
 * one step — but a player takes those in two, and between them they must see
 * what they just did. Without this the third man of the mill is never drawn,
 * the mill never lights, and the point just played still wears an "open
 * circuit" ring: the board would be telling you the man you placed is empty
 * air. This is the display-only half-step the model deliberately lacks.
 */
function previewOf(g: GameState, from: number, to: number): GameState {
  const board = [...g.board];
  const hand = { ...g.hand };
  const onBoard = { ...g.onBoard };
  const me = g.turn;

  if (from === PLACE) {
    hand[me]--;
    onBoard[me]++;
  } else {
    board[from] = EMPTY;
  }
  board[to] = me;

  return { ...g, board, hand, onBoard };
}

/* ------------------------------------------------------------------------ drawing */

function setStatus(text: string): void {
  $('status').textContent = text;
}

function statusText(): string {
  if (reviewAt !== null) {
    const f = findings![reviewAt];
    return `Move ${Math.floor(f.ply / 2) + 1}: this cost you ${(f.cost / 100).toFixed(1)} men.`;
  }
  if (game.result) {
    if (game.result.kind === 'draw') {
      return game.result.reason === 'repetition'
        ? 'Drawn — the same position three times over.'
        : 'Drawn — fifty moves with nothing taken.';
    }
    const won = game.result.winner === HUMAN;
    const how = game.result.reason === 'blocked' ? 'nothing left to move' : 'down to two men';
    return won ? `You win — ${how}.` : `${tier.name} wins — ${how}.`;
  }
  if (phase.kind === 'thinking') return `${tier.name} is thinking…`;
  if (phase.kind === 'capturing') return 'Mill closed. Take one of their men.';
  if (phase.kind === 'holding') return 'Now pick where it goes.';

  // Losing a man to the engine is the most important thing that can happen on
  // its turn, and the pip bar alone is easy to miss. Say it.
  const last = timeline.at(-1);
  const struck = last && last.game.turn === ENGINE && last.move.remove !== NO_REMOVE;
  const lead = struck ? `${tier.name} closed a mill and took one of yours. ` : '';

  if (game.hand[HUMAN] > 0) return `${lead}Place a man on any point.`;
  if (canFly(game, HUMAN)) return `${lead}Three men left — you may fly to any empty point.`;
  return `${lead}Pick a man to move.`;
}

function pips(mount: HTMLElement, hand: number, lost: number, side: string): void {
  mount.replaceChildren();
  for (let i = 0; i < 9; i++) {
    const d = document.createElement('i');
    d.className = `pip is-${side}`;
    if (i >= 9 - lost) d.classList.add('is-gone');
    else if (i >= hand) d.classList.add('is-placed');
    mount.append(d);
  }
}

function render(): void {
  const shown =
    reviewAt !== null ? timeline[findings![reviewAt].ply].game
    : phase.kind === 'capturing' ? previewOf(game, phase.from, phase.to)
    : game;

  const live = new Set<number>();
  const ringed = new Set<number>();
  const targets = new Set<number>();
  let selected: number | null = null;
  let trail: number[] = [];

  if (reviewAt !== null) {
    const f = findings![reviewAt];
    trail = [f.played.to, f.better.to].filter((p) => p >= 0);
  } else if (!game.result && game.turn === HUMAN) {
    if (phase.kind === 'capturing') {
      for (const t of phase.targets) targets.add(t);
    } else if (game.hand[HUMAN] > 0) {
      // Placing: every empty point is legal, so a ring on each says nothing —
      // and would drown out the ghosts. Hover carries the affordance instead.
      for (let p = 0; p < 24; p++) if (game.board[p] === EMPTY) live.add(p);
    } else {
      for (let p = 0; p < 24; p++) {
        if (game.board[p] === HUMAN && movesFrom(p).length > 0) { live.add(p); ringed.add(p); }
      }
      if (phase.kind === 'holding') {
        selected = phase.from;
        for (const m of movesFrom(phase.from)) targets.add(m.to);
      }
    }
  }

  if (reviewAt === null) {
    // Mid-capture the trail is the man that just closed the mill, not the
    // move before it.
    if (phase.kind === 'capturing') trail = [phase.to];
    else {
      const last = timeline.at(-1);
      if (last) trail = [last.move.to];
    }
  }

  board.render({
    board: shown.board,
    human: HUMAN,
    live,
    ringed,
    selected,
    targets,
    mills: closedMills(shown),
    ghosts: hints && reviewAt === null && !shown.result ? openCircuits(shown) : [],
    trail,
    capturing: phase.kind === 'capturing',
  });

  const lostBy = (p: Player) => 9 - shown.hand[p] - shown.onBoard[p];
  $('tally-you').textContent = String(shown.hand[HUMAN] + shown.onBoard[HUMAN]);
  $('tally-cpu').textContent = String(shown.hand[ENGINE] + shown.onBoard[ENGINE]);
  pips($('pips-you'), shown.hand[HUMAN], lostBy(HUMAN), 'you');
  pips($('pips-cpu'), shown.hand[ENGINE], lostBy(ENGINE), 'cpu');
  $('note-you').textContent = handNote(shown, HUMAN);
  $('note-cpu').textContent = handNote(shown, ENGINE);

  $('tier-name').textContent = tier.name;
  $('blurb').textContent = tier.blurb;
  document.body.classList.toggle('is-thinking', phase.kind === 'thinking');
  setStatus(statusText());
}

function handNote(g: GameState, p: Player): string {
  const lost = 9 - g.hand[p] - g.onBoard[p];
  const taken = lost > 0 ? ` · ${lost} taken` : '';
  if (g.hand[p] > 0) return `${g.hand[p]} in hand · ${g.onBoard[p]} placed${taken}`;
  if (g.onBoard[p] === 3) return `three left · flying${taken}`;
  return `${g.onBoard[p]} on the board${taken}`;
}

/* ------------------------------------------------------------------------ review */

async function runReview(): Promise<void> {
  const btn = $('review') as HTMLButtonElement;
  btn.disabled = true;
  btn.textContent = 'Reading the game…';

  const res = await ask({ kind: 'review', timeline, human: HUMAN });
  btn.disabled = false;
  btn.textContent = 'Review my moves';

  if (res.kind !== 'review') return;
  findings = res.findings;
  drawFindings();
}

function drawFindings(): void {
  const mount = $('findings');
  mount.hidden = false;
  mount.replaceChildren();

  const head = document.createElement('h2');
  head.textContent = findings!.length ? 'Moves worth another look' : 'Nothing to flag';
  mount.append(head);

  if (!findings!.length) {
    const p = document.createElement('p');
    p.className = 'blurb';
    p.textContent = 'No move gave up more than half a man. Well played.';
    mount.append(p);
    return;
  }

  findings!.forEach((f, i) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'finding';
    row.innerHTML =
      `<span class="finding-no">Move ${Math.floor(f.ply / 2) + 1}</span>` +
      `<span class="finding-cost">−${(f.cost / 100).toFixed(1)}</span>` +
      `<span class="finding-say">${phrase(f)}</span>`;
    row.addEventListener('click', () => {
      reviewAt = reviewAt === i ? null : i;
      mount.querySelectorAll('.finding').forEach((n, j) =>
        n.classList.toggle('is-open', reviewAt === j));
      render();
    });
    mount.append(row);
  });
}

function phrase(f: Finding): string {
  const moved = f.played.from === PLACE ? 'placing there' : 'that slide';
  const took = f.played.remove !== NO_REMOVE ? ' and taking that man' : '';
  return `${moved}${took} let the engine ahead; there was a better line here`;
}

/* ------------------------------------------------------------------------- setup */

function reset(): void {
  game = createGame();
  timeline = [];
  findings = null;
  reviewAt = null;
  phase = { kind: 'idle' };
  $('review').hidden = true;
  $('findings').hidden = true;
  render();
}

const select = $<HTMLSelectElement>('tier');
for (const t of TIERS) {
  const opt = document.createElement('option');
  opt.value = t.id;
  opt.textContent = t.name;
  select.append(opt);
}
select.value = tier.id;
select.addEventListener('change', () => {
  tier = tierById(select.value);
  reset();
});

$<HTMLInputElement>('hints').addEventListener('change', (e) => {
  hints = (e.target as HTMLInputElement).checked;
  render();
});
$('new-game').addEventListener('click', reset);
$('review').addEventListener('click', () => void runReview());
board.onPoint(pick);

render();
