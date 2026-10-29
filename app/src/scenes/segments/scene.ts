import { setDigits } from '../../hud/digits';
import { DwellButton } from '../../hud/dwell-button';
import type { Beat } from '../../narrative/schema';
import { Animator, ease } from '../../viz/animator';
import type { SceneContext, SceneModule } from '../types';
import {
  assign,
  AXES,
  BLIND_START,
  bestKmeans,
  customers,
  elbow,
  kmeans,
  matchSegment,
  SSE_SCALE,
  sse,
  type Point,
  type Segment,
} from './model';
import './segments.css';

/** Cluster colors, validated for color-vision deficiency on the dark panel (research 018). */
const COLORS = ['#e0428a', '#c07a26', '#3f9be0'] as const;
const NEUTRAL: RGB = [217, 201, 214];
const MAGNETS = 3;
/** Holding the cursor this still (screen units) for `DROP_MS` drops a magnet. */
const STILL_RADIUS = 0.03;
const DROP_MS = 900;

type RGB = [number, number, number];

const hex = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
const PALETTE = COLORS.map(hex);

export function segmentsScene(chapterId: string) {
  return (ctx: SceneContext): SceneModule => new SegmentsScene(ctx, chapterId);
}

interface Magnet {
  at: Point;
  /** 0..1 drop-in animation */
  pop: number;
}

/**
 * EPISODE III — สามกลุ่มแห่งลูกค้า (K-means). Play: hold the cursor in the crowd to drop three
 * magnets; every customer takes the color of the nearest one and the player sees the error of
 * their grouping. Reveal: the AI starts from a blind guess and iterates (assign, move, repeat)
 * while the error falls; the elbow chart asks how many groups; the groups get names and the
 * player chooses where the ads go (research 018).
 */
class SegmentsScene implements SceneModule {
  readonly id = 'd-segmentation';
  readonly #ctx: SceneContext;
  readonly #chapterId: string;
  readonly #anim = new Animator();
  readonly #points: Point[];
  readonly #best = bestKmeans(customers().points, 3);

  readonly #root = document.createElement('div');
  readonly #plot: HTMLElement;
  readonly #canvas: HTMLCanvasElement;
  readonly #side: HTMLElement;
  readonly #tags: HTMLElement;

  /** Per point: shown color, target color, appear progress. */
  readonly #color: RGB[];
  readonly #target: RGB[];
  readonly #appear: Float32Array;
  #centers: Point[] = [];
  /** Lines from points to their center, fading (0..1). */
  #links = 0;
  readonly #magnets: Magnet[] = [];
  #dropping: { at: Point; since: number; screen: Point } | null = null;
  #placing = false;
  #now = 0;
  #playerSse: number | null = null;
  #lift = 0;
  #choice: Segment | null = null;
  readonly #buttons: DwellButton[] = [];
  readonly #off: (() => void)[] = [];

  constructor(ctx: SceneContext, chapterId: string) {
    this.#ctx = ctx;
    this.#chapterId = chapterId;
    this.#points = customers().points;
    const n = this.#points.length;
    this.#color = this.#points.map(() => [...NEUTRAL] as RGB);
    this.#target = this.#points.map(() => [...NEUTRAL] as RGB);
    this.#appear = new Float32Array(n);

    this.#root.className = 'sg';
    this.#root.innerHTML = `
      <div class="hud-panel sg-plot">
        <p class="hud-eyebrow">Customer map · 600</p>
        <p class="sg-axis sg-axis-y"></p>
        <p class="sg-axis sg-axis-x"></p>
        <div class="sg-area"><canvas></canvas><div class="sg-tags"></div></div>
      </div>
      <aside class="hud-panel sg-side"></aside>`;
    const q = (sel: string) => this.#root.querySelector(sel) as HTMLElement;
    q('.sg-axis-y').textContent = `↑ ${AXES.y.label}`;
    q('.sg-axis-x').textContent = `${AXES.x.label} →`;
    this.#plot = q('.sg-area');
    this.#canvas = this.#root.querySelector('canvas') as HTMLCanvasElement;
    this.#tags = q('.sg-tags');
    this.#side = q('.sg-side');
    ctx.hud.append(this.#root);
    this.#sideMagnets();

    this.#off.push(
      ctx.bus.on('cursor', (c) => {
        this.#onCursor(c.visible ? { x: c.x, y: c.y } : null);
      }),
    );
  }

  ownsLesson(): boolean {
    return true;
  }

  setFade(value: number): void {
    this.#ctx.hud.style.opacity = String(value);
  }

  vars() {
    return { magnetsLeft: MAGNETS - this.#magnets.length, lift: this.#lift };
  }

  result() {
    // How close the player's own grouping got to the best one, and the ad choice
    const placement = this.#playerSse === null ? 0 : Math.min(1, this.#best.sse / this.#playerSse);
    const choice = this.#choice ? this.#choice.lift / 18 : 0.5;
    return {
      chapterId: this.#chapterId,
      score: 0.5 * placement + 0.5 * choice,
      style:
        this.#choice?.id === 'big-spender'
          ? { analyst: 1 }
          : this.#choice?.id === 'promo'
            ? { 'risk-taker': 1 }
            : { intuitive: 0.6 },
    };
  }

  dispose(): void {
    this.#anim.cancel();
    for (const off of this.#off) off();
    for (const b of this.#buttons) b.dispose();
  }

  update(dtMs: number): void {
    this.#now += dtMs;
    this.#anim.update(dtMs);
    this.#checkDrop();
    this.#draw(dtMs);
  }

  onBeat(beat: Beat): void {
    switch (beat.type) {
      case 'mission':
        void this.#streamIn();
        break;
      case 'tutorial':
      case 'play':
        this.#placing = true;
        break;
      case 'reveal':
        this.#placing = false;
        this.#dropping = null;
        this.#fillMagnets();
        break;
      case 'lesson':
        this.#root.querySelector('.sg-plot .hud-eyebrow')?.replaceChildren('Lesson · K-means');
        break;
    }
  }

  onCue(cue: string): boolean {
    const run = (job: Promise<void>) => {
      void job.then(() => {
        this.#ctx.signal('continue');
      });
      return true;
    };
    switch (cue) {
      case 'kmeans-run':
        return run(this.#runAi());
      case 'elbow':
        return run(this.#elbow());
      case 'clusters':
        this.#nameClusters();
        return false;
      case 'choose-segment':
        this.#offerChoice();
        return true;
      default:
        return false;
    }
  }

  // ---------- Mission: customers appear ----------

  async #streamIn(): Promise<void> {
    await this.#anim.tween(
      2600,
      (t) => {
        this.#points.forEach((p, i) => {
          // sweep in from the left, with a little jitter so it reads as a crowd arriving
          const start = p.x * 0.75 + (((i * 37) % 100) / 100) * 0.2;
          this.#appear[i] = Math.min(1, Math.max(0, (t - start) / 0.12));
        });
      },
      { ease: ease.linear },
    );
    this.#appear.fill(1);
  }

  // ---------- Play: drop magnets by holding still ----------

  #onCursor(at: Point | null): void {
    if (!this.#placing || this.#magnets.length >= MAGNETS || !at) {
      this.#dropping = null;
      return;
    }
    const local = this.#toPlot(at);
    if (!local) {
      this.#dropping = null;
      return;
    }
    const d = this.#dropping;
    if (!d || Math.hypot(at.x - d.screen.x, at.y - d.screen.y) > STILL_RADIUS) {
      this.#dropping = { at: local, since: this.#now, screen: at };
    }
  }

  #checkDrop(): void {
    const d = this.#dropping;
    if (!d || this.#now - d.since < DROP_MS) return;
    this.#dropping = null;
    this.#drop(d.at);
  }

  #drop(at: Point): void {
    const magnet: Magnet = { at, pop: 0 };
    this.#magnets.push(magnet);
    void this.#anim.tween(500, (t) => (magnet.pop = t), { ease: ease.outBack });
    this.#centers = this.#magnets.map((m) => m.at);
    this.#recolor(assign(this.#points, this.#centers));
    this.#links = 1;
    this.#playerSse = sse(this.#points, this.#centers);
    this.#sideMagnets();
    if (this.#magnets.length === 1) this.#ctx.signal('gesture');
    if (this.#magnets.length === MAGNETS) {
      void this.#anim.wait(1800).then(() => {
        this.#ctx.signal('finished');
      });
    }
  }

  /** Time ran out: place the rest where nobody is likely to look (spread, seeded). */
  #fillMagnets(): void {
    const spots: Point[] = [
      { x: 0.5, y: 0.5 },
      { x: 0.25, y: 0.3 },
      { x: 0.75, y: 0.7 },
    ];
    while (this.#magnets.length < MAGNETS)
      this.#drop(spots[this.#magnets.length] ?? { x: 0.5, y: 0.5 });
  }

  #sideMagnets(): void {
    const placed = this.#magnets.length;
    const icons = COLORS.map(
      (c, i) =>
        `<i class="sg-magnet ${i < placed ? 'is-placed' : ''}" style="--c:${c}">${String(i + 1)}</i>`,
    ).join('');
    this.#side.innerHTML = `
      <p class="hud-eyebrow">Your magnets</p>
      <div class="sg-magnets">${icons}</div>
      <p class="sg-help">ชี้ไปกลางฝูงลูกค้า แล้วค้างไว้<br />= วางแม่เหล็ก</p>
      <div class="sg-score" ${this.#playerSse === null ? 'hidden' : ''}>
        <p class="hud-label-th">ความกระจายในกลุ่มของท่าน (SSE)</p>
        <span class="hud-number"></span>
      </div>`;
    const n = this.#side.querySelector<HTMLElement>('.hud-number');
    if (n && this.#playerSse !== null)
      setDigits(n, Math.round(this.#playerSse * SSE_SCALE).toLocaleString('en-US'));
  }

  // ---------- Reveal: the AI's K-means ----------

  async #runAi(): Promise<void> {
    const steps = kmeans(this.#points, BLIND_START);
    this.#magnets.length = 0;
    this.#side.innerHTML = `
      <p class="hud-eyebrow">AI · K-means</p>
      <p class="sg-round"></p>
      <p class="hud-label-th">ความกระจายในกลุ่ม (SSE)</p>
      <span class="hud-number sg-sse"></span>
      <div class="sg-bars"></div>
      <p class="sg-compare"></p>`;
    const round = this.#side.querySelector('.sg-round') as HTMLElement;
    const counter = this.#side.querySelector('.sg-sse') as HTMLElement;
    const bars = this.#side.querySelector('.sg-bars') as HTMLElement;
    const first = steps[0];
    if (!first) return;
    const top = first.sse;
    const show = (v: number) => {
      setDigits(counter, Math.round(v * SSE_SCALE).toLocaleString('en-US'));
    };
    // The blind guess: centers jump to the right edge, everyone recolors
    await this.#moveCenters(this.#centers, first.centers, 900);
    this.#recolor(first.labels);
    this.#links = 1;
    show(first.sse);
    round.textContent = 'เดาสุ่ม';
    const bar = (v: number) => {
      const b = document.createElement('i');
      b.style.setProperty('--h', String(v / top));
      bars.append(b);
      requestAnimationFrame(() => {
        b.classList.add('is-shown');
      });
    };
    bar(first.sse);
    await this.#anim.wait(1300);
    for (let i = 1; i < steps.length; i++) {
      const prev = steps[i - 1];
      const step = steps[i];
      if (!prev || !step) continue;
      round.textContent = `รอบที่ ${String(i)}: ย้ายแม่เหล็กไปกลางกลุ่ม`;
      await this.#moveCenters(prev.centers, step.centers, 800, (t) => {
        show(prev.sse + (sse(this.#points, step.centers, prev.labels) - prev.sse) * t);
      });
      round.textContent = `รอบที่ ${String(i)}: จัดกลุ่มใหม่`;
      this.#recolor(step.labels);
      this.#links = 1;
      show(step.sse);
      bar(step.sse);
      await this.#anim.wait(i === steps.length - 1 ? 500 : 900);
    }
    round.textContent = 'นิ่งแล้ว — ไม่มีใครย้ายกลุ่ม';
    const compare = this.#side.querySelector('.sg-compare') as HTMLElement;
    if (this.#playerSse !== null) {
      compare.textContent = `ของท่าน ${Math.round(this.#playerSse * SSE_SCALE).toLocaleString('en-US')} · AI ${Math.round((steps.at(-1)?.sse ?? 0) * SSE_SCALE).toLocaleString('en-US')}`;
    }
    await this.#anim.wait(800);
  }

  #moveCenters(from: Point[], to: Point[], ms: number, onT?: (t: number) => void): Promise<void> {
    return this.#anim.tween(
      ms,
      (t) => {
        this.#centers = to.map((c, k) => {
          const f = from[k] ?? c;
          return { x: f.x + (c.x - f.x) * t, y: f.y + (c.y - f.y) * t };
        });
        onT?.(t);
      },
      { ease: ease.inOutCubic },
    );
  }

  // ---------- Reveal: how many groups? ----------

  async #elbow(): Promise<void> {
    const { sse: curve, k } = elbow(this.#points);
    const top = curve[0] ?? 1;
    const W = 520;
    const H = 360;
    const x = (i: number) => 70 + (i / (curve.length - 1)) * (W - 100);
    const y = (v: number) => 40 + (1 - v / top) * (H - 110);
    const path = curve
      .map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`)
      .join(' ');
    this.#side.innerHTML = `
      <p class="hud-eyebrow">Elbow method</p>
      <p class="sg-round">ลองแบ่ง 1 ถึง ${String(curve.length)} กลุ่ม</p>
      <svg class="sg-elbow" viewBox="0 0 ${String(W)} ${String(H)}">
        <line x1="70" y1="${String(H - 70)}" x2="${String(W - 20)}" y2="${String(H - 70)}" class="sg-elbow-axis" />
        <line x1="70" y1="30" x2="70" y2="${String(H - 70)}" class="sg-elbow-axis" />
        <text x="30" y="${String((H - 70) / 2 + 20)}" class="sg-elbow-name" transform="rotate(-90 30 ${String((H - 70) / 2 + 20)})" text-anchor="middle">SSE</text>
        ${curve.map((_, i) => `<text x="${x(i).toFixed(1)}" y="${String(H - 34)}" text-anchor="middle" class="sg-elbow-tick">${String(i + 1)}</text>`).join('')}
        <text x="${String(W / 2 + 30)}" y="${String(H - 2)}" text-anchor="middle" class="sg-elbow-name">จำนวนกลุ่ม (k)</text>
        <path d="${path}" class="sg-elbow-line" />
        ${curve.map((v, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="9" class="sg-elbow-dot" />`).join('')}
        <g class="sg-elbow-mark" transform="translate(${x(k - 1).toFixed(1)} ${y(curve[k - 1] ?? 0).toFixed(1)})">
          <circle r="22" /><text x="34" y="-30" text-anchor="start">ข้อศอก k = ${String(k)}</text>
        </g>
      </svg>`;
    const line = this.#side.querySelector('.sg-elbow-line') as SVGPathElement;
    const dots = [...this.#side.querySelectorAll<SVGCircleElement>('.sg-elbow-dot')];
    const mark = this.#side.querySelector('.sg-elbow-mark') as SVGGElement;
    const length = line.getTotalLength();
    line.style.strokeDasharray = String(length);
    line.style.strokeDashoffset = String(length);
    for (const d of dots) d.style.opacity = '0';
    mark.style.opacity = '0';
    // Each k: the map regroups into k colors while the curve reaches its point
    for (let i = 0; i < curve.length; i++) {
      const fit = bestKmeans(this.#points, i + 1);
      this.#centers = fit.centers;
      this.#recolor(
        fit.labels.map((l) => l % COLORS.length),
        i + 1 > COLORS.length,
      );
      const dot = dots[i];
      if (dot) dot.style.opacity = '1';
      await this.#anim.tween(650, (t) => {
        line.style.strokeDashoffset = String(
          length * Math.max(0, 1 - (i + t) / (curve.length - 1)),
        );
      });
    }
    // Back to k = 3 and mark the elbow
    this.#centers = this.#best.centers;
    this.#recolor(this.#best.labels);
    await this.#anim.tween(600, (t) => (mark.style.opacity = String(t)));
    await this.#anim.wait(600);
  }

  // ---------- Reveal: name the groups, offer the choice ----------

  #nameClusters(): void {
    this.#centers = this.#best.centers;
    this.#tags.replaceChildren();
    // The elbow chart stays on the side: it is the reason there are three.
    this.#best.centers.forEach((c, k) => {
      const seg = matchSegment(c);
      const count = this.#best.labels.filter((l) => l === k).length;
      const tag = document.createElement('div');
      tag.className = 'sg-tag';
      tag.style.setProperty('--c', COLORS[k] ?? '#fff');
      tag.style.left = `${String(c.x * 100)}%`;
      tag.style.top = `${String((1 - c.y) * 100)}%`;
      // Groups near the top get their tag to the side, clear of the panel title and of the
      // groups below
      if (c.y > 0.6) tag.classList.add('is-side');
      tag.innerHTML = `<b></b><span></span>`;
      (tag.querySelector('b') as HTMLElement).textContent = seg.name;
      (tag.querySelector('span') as HTMLElement).textContent =
        `${seg.description} · ${String(count)} คน`;
      this.#tags.append(tag);
      void this.#anim.tween(
        500,
        (t) => {
          tag.style.opacity = String(t);
        },
        { delay: k * 250 },
      );
    });
  }

  #offerChoice(): void {
    this.#tags.replaceChildren();
    this.#best.centers.forEach((c, k) => {
      const seg = matchSegment(c);
      const holder = document.createElement('div');
      holder.className = 'sg-choice';
      holder.style.setProperty('--c', COLORS[k] ?? '#fff');
      holder.style.left = `${String(c.x * 100)}%`;
      holder.style.top = `${String((1 - c.y) * 100)}%`;
      this.#tags.append(holder);
      const button = new DwellButton(
        holder,
        this.#ctx.bus,
        this.#ctx.targets,
        `${this.id}-ad-${seg.id}`,
        seg.name,
        () => {
          this.#choice = seg;
          this.#lift = seg.lift;
          for (const b of this.#buttons) b.dispose();
          this.#buttons.length = 0;
          this.#nameClusters();
          this.#ctx.signal('continue');
        },
        'HOLD',
      );
      this.#buttons.push(button);
    });
  }

  // ---------- Drawing ----------

  #recolor(labels: number[], muted = false): void {
    labels.forEach((l, i) => {
      const c = PALETTE[l] ?? NEUTRAL;
      this.#target[i] = muted ? [...NEUTRAL] : [...c];
    });
  }

  /** Screen [0, 1] → plot [0, 1] (y up), or null outside the plot. */
  #toPlot(at: Point): Point | null {
    const r = this.#plot.getBoundingClientRect();
    const x = (at.x * window.innerWidth - r.left) / r.width;
    const y = 1 - (at.y * window.innerHeight - r.top) / r.height;
    return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : null;
  }

  #draw(dtMs: number): void {
    const c = this.#canvas;
    const { width, height } = this.#plot.getBoundingClientRect();
    const dpr = devicePixelRatio;
    const w = Math.round(width * dpr);
    const h = Math.round(height * dpr);
    if (w === 0 || h === 0) return;
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    const g = c.getContext('2d');
    if (!g) return;
    g.clearRect(0, 0, w, h);
    const px = (p: Point) => p.x * w;
    const py = (p: Point) => (1 - p.y) * h;

    // Colors ease toward their targets (a soft wave of regrouping)
    const k = 1 - Math.exp(-dtMs / 180);
    for (let i = 0; i < this.#color.length; i++) {
      const cur = this.#color[i];
      const tgt = this.#target[i];
      if (!cur || !tgt) continue;
      cur[0] += (tgt[0] - cur[0]) * k;
      cur[1] += (tgt[1] - cur[1]) * k;
      cur[2] += (tgt[2] - cur[2]) * k;
    }

    // Links: who belongs to which center (fade after each regroup)
    if (this.#links > 0.01 && this.#centers.length > 0) {
      const labels = assign(this.#points, this.#centers);
      g.lineWidth = 1 * dpr;
      this.#points.forEach((p, i) => {
        if (i % 3 !== 0) return; // a third is enough to read, and cheap
        const center = this.#centers[labels[i] ?? 0];
        const col = PALETTE[labels[i] ?? 0];
        if (!center || !col) return;
        g.strokeStyle = `rgba(${String(col[0])},${String(col[1])},${String(col[2])},${String(0.28 * this.#links)})`;
        g.beginPath();
        g.moveTo(px(p), py(p));
        g.lineTo(px(center), py(center));
        g.stroke();
      });
      this.#links *= Math.exp(-dtMs / 700);
    }

    // Customers
    const r = 4.2 * dpr;
    this.#points.forEach((p, i) => {
      const a = this.#appear[i] ?? 0;
      if (a <= 0) return;
      const col = this.#color[i] ?? NEUTRAL;
      g.fillStyle = `rgba(${String(Math.round(col[0]))},${String(Math.round(col[1]))},${String(Math.round(col[2]))},${String(0.85 * a)})`;
      g.beginPath();
      g.arc(px(p), py(p), r * (0.4 + 0.6 * a), 0, Math.PI * 2);
      g.fill();
    });

    // Centers / magnets
    this.#centers.forEach((center, idx) => {
      const pop = this.#magnets[idx]?.pop ?? 1;
      const col = COLORS[idx] ?? '#fff';
      const R = (16 + 6 * pop) * dpr * pop;
      g.save();
      g.shadowColor = col;
      g.shadowBlur = 24 * dpr;
      g.lineWidth = 4 * dpr;
      g.strokeStyle = '#fff';
      g.fillStyle = col;
      g.beginPath();
      g.arc(px(center), py(center), R, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.restore();
    });

    // Drop progress where the cursor rests
    const d = this.#dropping;
    if (d) {
      const t = Math.min(1, (this.#now - d.since) / DROP_MS);
      const col = COLORS[this.#magnets.length] ?? '#fff';
      g.lineWidth = 5 * dpr;
      g.strokeStyle = col;
      g.beginPath();
      g.arc(px(d.at), py(d.at), 30 * dpr, -Math.PI / 2, -Math.PI / 2 + t * Math.PI * 2);
      g.stroke();
    }
  }
}
