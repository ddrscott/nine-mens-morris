import { COORDS, ADJACENCY, POINTS, type Mill } from '../engine/board';
import { EMPTY, type Player } from '../engine/types';

const NS = 'http://www.w3.org/2000/svg';
const PAD = 9;
const SPAN = 82;

/** Lattice coordinate (0..6) to viewBox coordinate. */
const px = (c: number) => PAD + (c / 6) * SPAN;
const at = (p: number) => ({ x: px(COORDS[p].x), y: px(COORDS[p].y) });

/** The 32 traces, each listed once. */
const EDGES: [number, number][] = [];
for (let p = 0; p < POINTS; p++) {
  for (const q of ADJACENCY[p]) if (p < q) EDGES.push([p, q]);
}

export interface BoardModel {
  board: readonly number[];
  human: Player;
  /** Points the player may click right now. */
  live: ReadonlySet<number>;
  /** Live points worth ringing. Empty during placing, where every point is
   *  legal and ringing all of them is noise the ghosts have to compete with. */
  ringed: ReadonlySet<number>;
  /** The man currently picked up, if any. */
  selected: number | null;
  /** Where a picked-up man may go, or which men may be taken. */
  targets: ReadonlySet<number>;
  /** Closed mills, drawn as live circuit. */
  mills: readonly Mill[];
  /** Open circuits: a mill one move away. */
  ghosts: readonly { point: number; owner: Player }[];
  /** Points touched by the move just played. */
  trail: readonly number[];
  /** Whether the capture step is what we are waiting on. */
  capturing: boolean;
}

function el<K extends keyof SVGElementTagNameMap>(
  tag: K, attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

export class BoardView {
  readonly el: SVGSVGElement;
  private readonly pads: SVGCircleElement[] = [];
  private readonly men: SVGGElement[] = [];
  private readonly halos: SVGCircleElement[] = [];
  private readonly ghostLayer: SVGGElement;
  private readonly millLayer: SVGGElement;
  private onPick: (p: number) => void = () => {};

  constructor() {
    this.el = el('svg', {
      viewBox: '0 0 100 100',
      class: 'board',
      role: 'grid',
      'aria-label': "Nine men's morris board",
    });

    const traces = el('g', { class: 'traces' });
    for (const [p, q] of EDGES) {
      const a = at(p), b = at(q);
      traces.append(el('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'trace' }));
    }
    this.el.append(traces);

    this.millLayer = el('g', { class: 'mills' });
    this.ghostLayer = el('g', { class: 'ghosts' });
    this.el.append(this.millLayer, this.ghostLayer);

    const padLayer = el('g', { class: 'pads' });
    const manLayer = el('g', { class: 'men' });

    for (let p = 0; p < POINTS; p++) {
      const { x, y } = at(p);

      const halo = el('circle', { cx: x, cy: y, r: 4.6, class: 'halo' });
      this.halos.push(halo);
      padLayer.append(halo);

      // The via: an unoccupied node on the circuit.
      padLayer.append(el('circle', { cx: x, cy: y, r: 1.9, class: 'via' }));

      const man = el('g', { class: 'man', transform: `translate(${x} ${y})` });
      man.append(
        el('circle', { r: 3.5, class: 'man-body' }),
        el('circle', { r: 1.5, class: 'man-core' }),
      );
      this.men.push(man);
      manLayer.append(man);

      // One generous hit target per point, above everything.
      const hit = el('circle', { cx: x, cy: y, r: 6, class: 'hit', tabindex: 0, role: 'gridcell' });
      hit.addEventListener('click', () => this.onPick(p));
      // Hover stands in for the ring during placing, when every point is legal
      // and ringing all 24 would say nothing.
      const hover = (on: boolean) => () =>
        halo.classList.toggle('is-hover', on && hit.classList.contains('is-clickable'));
      hit.addEventListener('pointerenter', hover(true));
      hit.addEventListener('pointerleave', hover(false));
      hit.addEventListener('focus', hover(true));
      hit.addEventListener('blur', hover(false));
      hit.addEventListener('keydown', (ev) => {
        const k = (ev as KeyboardEvent).key;
        if (k === 'Enter' || k === ' ') { ev.preventDefault(); this.onPick(p); }
      });
      this.pads.push(hit);
      padLayer.append(hit);
    }

    this.el.append(padLayer, manLayer);
  }

  onPoint(cb: (p: number) => void): void {
    this.onPick = cb;
  }

  render(m: BoardModel): void {
    const owner = (p: number) => (m.board[p] === EMPTY ? null : m.board[p] === m.human ? 'you' : 'cpu');

    for (let p = 0; p < POINTS; p++) {
      const who = owner(p);
      const man = this.men[p];
      man.classList.toggle('is-on', who !== null);
      man.classList.toggle('is-you', who === 'you');
      man.classList.toggle('is-cpu', who === 'cpu');
      man.classList.toggle('is-held', m.selected === p);
      man.classList.toggle('is-doomed', m.capturing && m.targets.has(p));
      man.classList.toggle('is-fresh', m.trail.includes(p));

      const halo = this.halos[p];
      halo.classList.toggle('is-live', m.ringed.has(p));
      halo.classList.toggle('is-target', m.targets.has(p) && !m.capturing);
      halo.classList.toggle('is-strike', m.targets.has(p) && m.capturing);
      if (!m.live.has(p) && !m.targets.has(p)) halo.classList.remove('is-hover');

      const hit = this.pads[p];
      const clickable = m.live.has(p) || m.targets.has(p);
      hit.classList.toggle('is-clickable', clickable);
      hit.setAttribute('aria-label', describe(p, who, clickable, m.capturing));
      if (clickable) hit.setAttribute('tabindex', '0');
      else hit.removeAttribute('tabindex');
    }

    // Closed circuits.
    this.millLayer.replaceChildren();
    for (const mill of m.mills) {
      const pts = mill.map((p) => { const c = at(p); return `${c.x},${c.y}`; }).join(' ');
      const side = m.board[mill[0]] === m.human ? 'you' : 'cpu';
      this.millLayer.append(el('polyline', { points: pts, class: `mill is-${side}` }));
    }

    // Open circuits: the gap in a line of three.
    this.ghostLayer.replaceChildren();
    for (const g of m.ghosts) {
      const { x, y } = at(g.point);
      const side = g.owner === m.human ? 'you' : 'cpu';
      this.ghostLayer.append(el('circle', { cx: x, cy: y, r: 3.5, class: `ghost is-${side}` }));
    }
  }
}

function describe(p: number, who: string | null, clickable: boolean, capturing: boolean): string {
  const where = `point ${p + 1}`;
  const held = who === 'you' ? 'your man' : who === 'cpu' ? 'opponent man' : 'empty';
  if (!clickable) return `${where}, ${held}`;
  if (capturing) return `${where}, take this ${held}`;
  return `${where}, ${held}, playable`;
}
