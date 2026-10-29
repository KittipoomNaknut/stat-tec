import { setDigits } from '../../hud/digits';
import { ease, type Animator } from '../../viz/animator';
import { revenueAt, type Attempt, type Day, type Line } from './model';

const NS = 'http://www.w3.org/2000/svg';

/** One SVG for the whole analysis: chart on the left, the data table / revenue on the right. */
const VIEW = { w: 1800, h: 600 };
const PLOT = { x0: 120, x1: 1150, y0: 60, y1: 500 };
const X = { min: 30, max: 120 };
const Y = { min: 100, max: 400 };
const TABLE = { x: 1260, y: 58, row: 37 };

const sx = (price: number) => PLOT.x0 + ((price - X.min) / (X.max - X.min)) * (PLOT.x1 - PLOT.x0);
const sy = (cups: number) => PLOT.y1 - ((cups - Y.min) / (Y.max - Y.min)) * (PLOT.y1 - PLOT.y0);

function el<K extends keyof SVGElementTagNameMap>(
  name: K,
  attrs: Record<string, string | number> = {},
  parent?: Element,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  parent?.append(node);
  return node;
}

function text(content: string, attrs: Record<string, string | number>, parent: Element) {
  const t = el('text', attrs, parent);
  t.textContent = content;
  return t;
}

/**
 * The regression, shown step by step (research 017): every past day flies out of the table as
 * an X (price) and a Y (cups) and becomes a star; the AI's line tries again and again while the
 * error it makes (SSE) counts down; then revenue = price × cups is drawn and its peak found.
 */
export class CoffeeChart {
  readonly root = document.createElement('section');
  readonly #svg: SVGSVGElement;
  readonly #anim: Animator;
  readonly #days: readonly Day[];
  readonly #layers: Record<
    'grid' | 'guides' | 'resid' | 'line' | 'points' | 'chips' | 'side',
    SVGGElement
  >;
  readonly #rows: SVGGElement[] = [];
  #laser: SVGLineElement | null = null;
  #glow: SVGLineElement | null = null;
  #resid: SVGLineElement[] = [];
  readonly #sse: HTMLElement;
  readonly #sseBox: HTMLElement;
  readonly #sseBars: HTMLElement;
  readonly #title: HTMLElement;
  readonly #note: HTMLElement;

  constructor(parent: HTMLElement, anim: Animator, days: readonly Day[]) {
    this.#anim = anim;
    this.#days = days;
    this.root.className = 'hud-panel cf-analysis';
    this.root.innerHTML = `
      <header class="cf-analysis-head">
        <p class="hud-eyebrow cf-analysis-title">Holo-analysis</p>
        <div class="cf-sse" hidden>
          <p class="hud-label-th">ความผิดพลาดรวม (SSE)</p>
          <span class="hud-number"></span>
          <div class="cf-sse-bars"></div>
        </div>
      </header>
      <p class="cf-note"></p>`;
    this.#title = this.root.querySelector('.cf-analysis-title') as HTMLElement;
    this.#sseBox = this.root.querySelector('.cf-sse') as HTMLElement;
    this.#sse = this.root.querySelector('.cf-sse .hud-number') as HTMLElement;
    this.#sseBars = this.root.querySelector('.cf-sse-bars') as HTMLElement;
    this.#note = this.root.querySelector('.cf-note') as HTMLElement;
    this.#svg = el('svg', { viewBox: `0 0 ${String(VIEW.w)} ${String(VIEW.h)}`, class: 'cf-svg' });
    this.root.append(this.#svg);
    const g = (cls: string) => el('g', { class: cls }, this.#svg);
    this.#layers = {
      grid: g('cf-grid'),
      guides: g('cf-guides'),
      resid: g('cf-resid'),
      line: g('cf-line'),
      points: g('cf-points'),
      side: g('cf-side'),
      chips: g('cf-chips'),
    };
    parent.append(this.root);
  }

  /** Renames the panel (e.g. for the lesson) and clears the attempt note beside it. */
  set title(value: string) {
    this.#title.textContent = value;
    this.#note.textContent = '';
  }

  /** Axes draw out from the corner, then the table of past days slides in. */
  async open(): Promise<void> {
    const grid = this.#layers.grid;
    const xAxis = el(
      'line',
      { x1: PLOT.x0, y1: PLOT.y1, x2: PLOT.x0, y2: PLOT.y1, class: 'cf-axis' },
      grid,
    );
    const yAxis = el(
      'line',
      { x1: PLOT.x0, y1: PLOT.y1, x2: PLOT.x0, y2: PLOT.y1, class: 'cf-axis' },
      grid,
    );
    text(
      'แก้วที่ขายได้ / วัน (Y)',
      { x: PLOT.x0 - 100, y: PLOT.y0 - 24, class: 'cf-axis-name' },
      grid,
    );
    text(
      'ราคาต่อแก้ว (X) →',
      { x: PLOT.x1, y: PLOT.y1 + 86, class: 'cf-axis-name', 'text-anchor': 'end' },
      grid,
    );
    const ticks: SVGElement[] = [];
    for (let c = 100; c <= 400; c += 100) {
      ticks.push(
        el('line', { x1: PLOT.x0, x2: PLOT.x1, y1: sy(c), y2: sy(c), class: 'cf-gridline' }, grid),
      );
      ticks.push(
        text(
          String(c),
          { x: PLOT.x0 - 18, y: sy(c) + 10, class: 'cf-tick', 'text-anchor': 'end' },
          grid,
        ),
      );
    }
    for (let p = 40; p <= 110; p += 10) {
      ticks.push(
        text(
          `฿${String(p)}`,
          { x: sx(p), y: PLOT.y1 + 44, class: 'cf-tick', 'text-anchor': 'middle' },
          grid,
        ),
      );
    }
    for (const t of ticks) t.style.opacity = '0';
    await this.#anim.tween(700, (t) => {
      xAxis.setAttribute('x2', String(PLOT.x0 + (PLOT.x1 - PLOT.x0) * t));
      yAxis.setAttribute('y2', String(PLOT.y1 - (PLOT.y1 - PLOT.y0) * t));
    });
    void this.#anim.tween(500, (t) => {
      for (const tk of ticks) tk.style.opacity = String(t);
    });
    await this.#table();
  }

  async #table(): Promise<void> {
    const side = this.#layers.side;
    const head = el('g', { class: 'cf-table-head' }, side);
    text('วัน', { x: TABLE.x, y: TABLE.y - 30 }, head);
    text('ราคา (X)', { x: TABLE.x + 230, y: TABLE.y - 30, 'text-anchor': 'end' }, head);
    text('แก้ว (Y)', { x: TABLE.x + 450, y: TABLE.y - 30, 'text-anchor': 'end' }, head);
    head.style.opacity = '0';
    this.#days.forEach((d, i) => {
      const row = el(
        'g',
        { class: 'cf-row', transform: `translate(0 ${String(TABLE.y + i * TABLE.row)})` },
        side,
      );
      el(
        'rect',
        { x: TABLE.x - 16, y: -27, width: 490, height: TABLE.row - 3, rx: 8, class: 'cf-row-bg' },
        row,
      );
      text(String(i + 1), { x: TABLE.x, y: 0, class: 'cf-row-day' }, row);
      text(
        `฿${String(d.price)}`,
        { x: TABLE.x + 230, y: 0, 'text-anchor': 'end', class: 'cf-row-x' },
        row,
      );
      text(
        String(d.cups),
        { x: TABLE.x + 450, y: 0, 'text-anchor': 'end', class: 'cf-row-y' },
        row,
      );
      row.style.opacity = '0';
      this.#rows.push(row);
    });
    await this.#anim.tween(400, (t) => (head.style.opacity = String(t)));
    await Promise.all(
      this.#rows.map((row, i) =>
        this.#anim.tween(
          380,
          (t) => {
            row.style.opacity = String(t);
            row.setAttribute(
              'transform',
              `translate(${String((1 - t) * 40)} ${String(TABLE.y + i * TABLE.row)})`,
            );
          },
          { delay: i * 45 },
        ),
      ),
    );
  }

  /**
   * Every day becomes a point: its X flies to the price axis, its Y to the cups axis, guides meet
   * and a star lights up. The first few go slowly so the idea lands; the rest speed up.
   */
  async plotDays(slow = 3): Promise<void> {
    for (const [i, d] of this.#days.entries()) {
      const pace = i < slow ? 1 : 0.32;
      await this.#plotDay(i, d, pace);
    }
    await this.#anim.tween(500, (t) => {
      for (const row of this.#rows) row.style.opacity = String(1 - 0.6 * t);
    });
  }

  async #plotDay(i: number, d: Day, pace: number): Promise<void> {
    const row = this.#rows[i];
    row?.classList.add('is-active');
    const rowY = TABLE.y + i * TABLE.row;
    const chips = this.#layers.chips;
    const chip = (label: string, cls: string) => {
      const c = el('g', { class: `cf-chip ${cls}` }, chips);
      el('rect', { x: -62, y: -30, width: 124, height: 46, rx: 23 }, c);
      text(label, { x: 0, y: 4, 'text-anchor': 'middle' }, c);
      return c;
    };
    const xChip = chip(`฿${String(d.price)}`, 'is-x');
    const yChip = chip(String(d.cups), 'is-y');
    const fly = (c: SVGGElement, from: [number, number], to: [number, number], lift: number) =>
      this.#anim.tween(
        900 * pace,
        (t) => {
          const x = from[0] + (to[0] - from[0]) * t;
          // An arc: rises first, then lands
          const y = from[1] + (to[1] - from[1]) * t - Math.sin(t * Math.PI) * lift;
          c.setAttribute('transform', `translate(${String(x)} ${String(y)})`);
        },
        { ease: ease.inOutCubic },
      );
    await Promise.all([
      fly(xChip, [TABLE.x + 180, rowY - 8], [sx(d.price), PLOT.y1 + 36], 120),
      fly(yChip, [TABLE.x + 410, rowY - 8], [PLOT.x0 - 66, sy(d.cups)], 80),
    ]);
    // Guides grow from both axes and meet at the point
    const gv = el(
      'line',
      { x1: sx(d.price), x2: sx(d.price), y1: PLOT.y1, y2: PLOT.y1, class: 'cf-guide' },
      this.#layers.guides,
    );
    const gh = el(
      'line',
      { x1: PLOT.x0, x2: PLOT.x0, y1: sy(d.cups), y2: sy(d.cups), class: 'cf-guide' },
      this.#layers.guides,
    );
    await this.#anim.tween(500 * pace, (t) => {
      gv.setAttribute('y2', String(PLOT.y1 + (sy(d.cups) - PLOT.y1) * t));
      gh.setAttribute('x2', String(PLOT.x0 + (sx(d.price) - PLOT.x0) * t));
    });
    const star = el(
      'circle',
      { cx: sx(d.price), cy: sy(d.cups), r: 0, class: 'cf-point' },
      this.#layers.points,
    );
    const flash = el(
      'circle',
      { cx: sx(d.price), cy: sy(d.cups), r: 0, class: 'cf-flash' },
      this.#layers.points,
    );
    await this.#anim.tween(
      420 * pace,
      (t) => {
        star.setAttribute('r', String(9 * ease.outBack(t)));
        flash.setAttribute('r', String(10 + 34 * t));
        flash.style.opacity = String(1 - t);
      },
      { ease: ease.linear },
    );
    flash.remove();
    row?.classList.remove('is-active');
    void this.#anim
      .tween(400 * pace, (t) => {
        for (const n of [xChip, yChip, gv, gh]) n.style.opacity = String(1 - t);
      })
      .then(() => {
        for (const n of [xChip, yChip, gv, gh]) n.remove();
      });
  }

  /**
   * The AI's search: each attempt slides the line into place, residuals stretch from every star
   * to the line, and the SSE counter falls. Ends locked on the least-squares line.
   */
  async fitLine(attempts: readonly Attempt[]): Promise<void> {
    const first = attempts[0];
    if (!first) return;
    // The table has done its job: clear the right side for the error counter.
    await this.#anim.tween(400, (t) => {
      for (const row of this.#rows) row.style.opacity = String(0.4 * (1 - t));
      const head = this.#layers.side.querySelector<SVGGElement>('.cf-table-head');
      if (head) head.style.opacity = String(1 - t);
    });
    this.#layers.side.replaceChildren();
    this.#rows.length = 0;
    this.#makeLine(first.line);
    this.#sseBox.hidden = false;
    let current = first.line;
    let currentSse = first.sse;
    this.#setLine(current);
    setDigits(this.#sse, Math.round(currentSse).toLocaleString('en-US'));
    await this.#anim.tween(600, (t) => {
      if (this.#laser) this.#laser.style.opacity = String(t);
      for (const r of this.#resid) r.style.opacity = String(t);
    });
    // One bar per attempt (log scale: the error falls by ~100×), each appears as it is tried.
    const top = Math.log10(first.sse);
    const bottom = Math.log10(attempts.at(-1)?.sse ?? 1) - 0.4;
    const bars = attempts.map((a) => {
      const bar = document.createElement('i');
      bar.style.setProperty('--h', String((Math.log10(a.sse) - bottom) / (top - bottom)));
      this.#sseBars.append(bar);
      return bar;
    });
    for (const [n, attempt] of attempts.entries()) {
      bars[n]?.classList.add('is-shown');
      this.#note.textContent =
        n === attempts.length - 1 ? 'เส้นที่ดีที่สุด' : `ลองครั้งที่ ${String(n + 1)}`;
      if (n === 0) {
        await this.#anim.wait(1100);
        continue;
      }
      const from = current;
      const fromSse = currentSse;
      await this.#anim.tween(
        1000,
        (t) => {
          this.#setLine({
            intercept: from.intercept + (attempt.line.intercept - from.intercept) * t,
            slope: from.slope + (attempt.line.slope - from.slope) * t,
          });
          setDigits(
            this.#sse,
            Math.round(fromSse + (attempt.sse - fromSse) * t).toLocaleString('en-US'),
          );
        },
        { ease: ease.inOutCubic },
      );
      current = attempt.line;
      currentSse = attempt.sse;
      await this.#anim.wait(n === attempts.length - 1 ? 200 : 450);
    }
    // Lock: a flash along the laser, residuals fade
    this.root.classList.add('is-locked');
    await this.#anim.tween(700, (t) => {
      for (const r of this.#resid) r.style.opacity = String(1 - t * 0.7);
    });
  }

  #makeLine(line: Line): void {
    this.#resid = this.#days.map(() => el('line', { class: 'cf-residual' }, this.#layers.resid));
    this.#glow = el('line', { class: 'cf-laser-glow' }, this.#layers.line);
    this.#laser = el('line', { class: 'cf-laser' }, this.#layers.line);
    this.#setLine(line);
  }

  #setLine(line: Line): void {
    const x1 = 32;
    const x2 = 118;
    const clampY = (v: number) => Math.min(Y.max + 40, Math.max(Y.min - 60, v));
    for (const node of [this.#glow, this.#laser]) {
      if (!node) continue;
      node.setAttribute('x1', String(sx(x1)));
      node.setAttribute('x2', String(sx(x2)));
      node.setAttribute('y1', String(sy(clampY(line.intercept + line.slope * x1))));
      node.setAttribute('y2', String(sy(clampY(line.intercept + line.slope * x2))));
    }
    this.#days.forEach((d, i) => {
      const r = this.#resid[i];
      if (!r) return;
      r.setAttribute('x1', String(sx(d.price)));
      r.setAttribute('x2', String(sx(d.price)));
      r.setAttribute('y1', String(sy(d.cups)));
      r.setAttribute('y2', String(sy(clampY(line.intercept + line.slope * d.price))));
    });
  }

  /**
   * Revenue = price × cups under the fitted line, drawn in its own panel (never a second y-axis
   * on the demand chart), with the peak and the player's price marked.
   */
  async revenue(line: Line, best: number, player: number): Promise<void> {
    await this.#anim.tween(400, (t) => {
      for (const row of this.#rows) row.style.opacity = String(0.4 * (1 - t));
      const head = this.#layers.side.querySelector<SVGGElement>('.cf-table-head');
      if (head) head.style.opacity = String(1 - t);
    });
    for (const row of this.#rows) row.remove();
    this.#layers.side.replaceChildren();
    const box = { x0: 1290, x1: 1740, y0: 230, y1: 480 };
    const prices: number[] = [];
    for (let p = 35; p <= 115; p += 1) prices.push(p);
    const maxRev = Math.max(...prices.map((p) => revenueAt(line, p)));
    const rx = (p: number) => box.x0 + ((p - 35) / 80) * (box.x1 - box.x0);
    const ry = (r: number) => box.y1 - (r / (maxRev * 1.12)) * (box.y1 - box.y0);
    const side = this.#layers.side;
    text('รายได้ / วัน = ราคา × แก้ว', { x: box.x0, y: box.y0 - 56, class: 'cf-axis-name' }, side);
    el('line', { x1: box.x0, x2: box.x1, y1: box.y1, y2: box.y1, class: 'cf-axis' }, side);
    for (const p of [40, 60, 80, 100]) {
      text(
        `฿${String(p)}`,
        { x: rx(p), y: box.y1 + 44, 'text-anchor': 'middle', class: 'cf-tick' },
        side,
      );
    }
    const d = prices
      .map((p, i) => `${i ? 'L' : 'M'}${rx(p).toFixed(1)},${ry(revenueAt(line, p)).toFixed(1)}`)
      .join(' ');
    const curve = el('path', { d, class: 'cf-revenue' }, side);
    const length = curve.getTotalLength();
    curve.style.strokeDasharray = String(length);
    curve.style.strokeDashoffset = String(length);
    await this.#anim.tween(1400, (t) => (curve.style.strokeDashoffset = String(length * (1 - t))), {
      ease: ease.inOutCubic,
    });
    // Peak (the model) and the player's price
    const mark = (p: number, label: string, cls: string, dy: number) => {
      const g = el(
        'g',
        {
          class: `cf-mark ${cls}`,
          transform: `translate(${String(rx(p))} ${String(ry(revenueAt(line, p)))})`,
        },
        side,
      );
      el(
        'line',
        { x1: 0, x2: 0, y1: 0, y2: box.y1 - ry(revenueAt(line, p)), class: 'cf-mark-drop' },
        g,
      );
      el('circle', { r: 11 }, g);
      text(label, { x: 0, y: dy, 'text-anchor': 'middle' }, g);
      g.style.opacity = '0';
      return g;
    };
    // The peak's label sits above the curve, the player's below it: they never collide.
    const you = mark(player, `ท่าน ฿${String(player)}`, 'is-player', 58);
    const peak = mark(best, `สูงสุด ฿${String(best)}`, 'is-best', -30);
    await this.#anim.tween(500, (t) => (you.style.opacity = String(t)));
    await this.#anim.tween(
      600,
      (t) => {
        peak.style.opacity = String(t);
        peak.setAttribute(
          'transform',
          `translate(${String(rx(best))} ${String(ry(revenueAt(line, best)) - 30 * (1 - t))})`,
        );
      },
      { ease: ease.outBack },
    );
  }

  /** Lesson: name the line. */
  label(name: string): void {
    // In the empty lower-left, under the line, clear of every point.
    const p = 40;
    const g = el(
      'g',
      {
        class: 'cf-line-label',
        transform: `translate(${String(sx(p))} ${String(sy(215))})`,
      },
      this.#layers.chips,
    );
    text(name, { x: 0, y: 0, 'text-anchor': 'start' }, g);
    void this.#anim.tween(600, (t) => (g.style.opacity = String(t)));
  }
}
