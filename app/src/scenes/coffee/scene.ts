import { baht } from '../../hud/count-up';
import { setDigits } from '../../hud/digits';
import type { Beat } from '../../narrative/schema';
import { Animator } from '../../viz/animator';
import type { SceneContext, SceneModule } from '../types';
import { CoffeeChart } from './chart';
import {
  bestPrice,
  cupsAt,
  fit,
  pastDays,
  PRICE_RANGE,
  revenueAt,
  searchAttempts,
  START_PRICE,
  TRUE_DEMAND,
} from './model';
import './coffee.css';

/** A visitor counts as "close to the AI" within this many baht. */
const CLOSE_BAHT = 6;
/** Moving the hand through this much of its range completes the tutorial. */
const TUTORIAL_SWEEP = 0.3;
/** Customers drawn per second at 100 cups/day. */
const CUSTOMER_RATE = 2.2;

export function coffeeScene(chapterId: string) {
  return (ctx: SceneContext): SceneModule => new CoffeeScene(ctx, chapterId);
}

interface Customer {
  x: number;
  y: number;
  speed: number;
  /** Turns back at the door (did not buy at this price). */
  leaves: boolean;
  life: number;
}

/**
 * EPISODE II — ศึกราคากาแฟ (Regression). Play: the player's raised hand sets the price;
 * customers walk into Data Café at the rate demand allows and the revenue at every price tried
 * is traced. Reveal: the regression storyboard (research 017), driven by the story's cues.
 */
class CoffeeScene implements SceneModule {
  readonly id = 'c-coffee-pricing';
  readonly #ctx: SceneContext;
  readonly #chapterId: string;
  readonly #anim = new Animator();
  readonly #days = pastDays();
  readonly #model = fit(this.#days);
  readonly #best = bestPrice(this.#model);

  readonly #play = document.createElement('div');
  readonly #priceEl: HTMLElement;
  readonly #gaugeFill: HTMLElement;
  readonly #cupsEl: HTMLElement;
  readonly #revenueEl: HTMLElement;
  readonly #canvas: HTMLCanvasElement;
  readonly #trace: SVGPathElement;
  readonly #traceDot: SVGCircleElement;
  #chart: CoffeeChart | null = null;

  #level = (START_PRICE - PRICE_RANGE.min) / (PRICE_RANGE.max - PRICE_RANGE.min);
  #price = START_PRICE;
  #controlling = false;
  #tutorial: { min: number; max: number } | null = null;
  /** Best revenue seen per tried price (the trace). */
  readonly #tried = new Map<number, number>();
  readonly #customers: Customer[] = [];
  #spawn = 0;
  #vars: Record<string, string | number | boolean> = {};
  readonly #off: (() => void)[] = [];

  constructor(ctx: SceneContext, chapterId: string) {
    this.#ctx = ctx;
    this.#chapterId = chapterId;
    this.#play.className = 'cf-play';
    this.#play.innerHTML = `
      <div class="hud-panel cf-price">
        <p class="hud-eyebrow">Price per cup</p>
        <div class="cf-price-row">
          <span class="hud-number cf-price-value"></span>
          <div class="cf-gauge"><i></i><b></b></div>
        </div>
        <p class="cf-price-hint">ยกมือสูง = แพงขึ้น · ลดมือ = ถูกลง</p>
      </div>
      <div class="hud-panel cf-cafe">
        <p class="hud-eyebrow">Data Café · live</p>
        <canvas class="cf-canvas"></canvas>
        <div class="cf-stats">
          <div><p class="hud-label-th">ลูกค้า / วัน</p><span class="hud-number cf-cups"></span></div>
          <div><p class="hud-label-th">รายได้ / วัน</p><span class="hud-number cf-revenue-now"></span></div>
        </div>
        <svg class="cf-trace" viewBox="0 0 600 170" preserveAspectRatio="none">
          <line x1="0" y1="168" x2="600" y2="168" class="cf-trace-axis" />
          <path class="cf-trace-line" d="" />
          <circle class="cf-trace-dot" r="7" cx="-20" cy="-20" />
        </svg>
        <p class="cf-trace-label">รายได้ที่แต่ละราคาที่ท่านลอง</p>
      </div>`;
    const q = (sel: string) => this.#play.querySelector(sel) as HTMLElement;
    this.#priceEl = q('.cf-price-value');
    this.#gaugeFill = q('.cf-gauge b');
    this.#cupsEl = q('.cf-cups');
    this.#revenueEl = q('.cf-revenue-now');
    this.#canvas = this.#play.querySelector('.cf-canvas') as HTMLCanvasElement;
    this.#trace = this.#play.querySelector('.cf-trace-line') as SVGPathElement;
    this.#traceDot = this.#play.querySelector('.cf-trace-dot') as SVGCircleElement;
    ctx.hud.append(this.#play);
    this.#setPrice(START_PRICE);

    this.#off.push(
      ctx.bus.on('raise', (r) => {
        if (!this.#controlling) return;
        this.#level = r.level;
        if (this.#tutorial) {
          this.#tutorial.min = Math.min(this.#tutorial.min, r.level);
          this.#tutorial.max = Math.max(this.#tutorial.max, r.level);
          if (this.#tutorial.max - this.#tutorial.min >= TUTORIAL_SWEEP) {
            this.#tutorial = null;
            ctx.signal('gesture');
          }
        }
      }),
    );
  }

  /** The hand is busy setting the price: no pointing cursor during the tutorial and play. */
  showCursor(): boolean {
    return !this.#controlling;
  }

  ownsLesson(): boolean {
    return true;
  }

  setFade(value: number): void {
    this.#ctx.hud.style.opacity = String(value);
  }

  update(dtMs: number): void {
    this.#anim.update(dtMs);
    if (this.#controlling) {
      const price = Math.round(PRICE_RANGE.min + this.#level * (PRICE_RANGE.max - PRICE_RANGE.min));
      if (price !== this.#price) this.#setPrice(price);
    }
    this.#gaugeFill.style.transform = `scaleY(${String(this.#level)})`;
    if (!this.#play.hidden) this.#drawCafe(dtMs);
  }

  onBeat(beat: Beat): void {
    switch (beat.type) {
      case 'mission':
        this.#play.classList.add('is-preview');
        break;
      case 'tutorial':
        this.#play.classList.remove('is-preview');
        this.#controlling = true;
        this.#tutorial = { min: this.#level, max: this.#level };
        break;
      case 'play':
        this.#controlling = true;
        this.#tutorial = null;
        break;
      case 'reveal':
        this.#finishPlay();
        break;
      case 'lesson':
        if (this.#chart) {
          this.#chart.title = 'Lesson · Regression';
          this.#chart.label('Demand Curve');
        }
        break;
    }
  }

  onCue(cue: string): boolean {
    const chart = this.#chart;
    if (!chart) return false;
    const run = (job: Promise<void>) => {
      void job.then(() => {
        this.#ctx.signal('continue');
      });
      return true;
    };
    switch (cue) {
      case 'data-points':
        return run(chart.open().then(() => chart.plotDays()));
      case 'fit-line':
        return run(chart.fitLine(searchAttempts(this.#days)));
      case 'revenue-curve':
        return run(chart.revenue(this.#model, this.#best, this.#price));
      default:
        return false;
    }
  }

  vars() {
    return this.#vars;
  }

  result() {
    const price = this.#price;
    const gap = Math.abs(price - this.#best);
    const extreme = price <= 40 || price >= 105;
    return {
      chapterId: this.#chapterId,
      // ARCHITECTURE §10: 1 − |price − optimal| / range
      score: Math.max(0, 1 - gap / (PRICE_RANGE.max - PRICE_RANGE.min)),
      style:
        gap <= CLOSE_BAHT ? { analyst: 1 } : extreme ? { 'risk-taker': 1 } : { intuitive: 0.6 },
    };
  }

  dispose(): void {
    this.#anim.cancel();
    for (const off of this.#off) off();
  }

  #setPrice(price: number): void {
    this.#price = price;
    const cups = Math.round(cupsAt(TRUE_DEMAND, price));
    const revenue = Math.round(revenueAt(TRUE_DEMAND, price));
    setDigits(this.#priceEl, `฿${String(price)}`);
    setDigits(this.#cupsEl, String(cups));
    setDigits(this.#revenueEl, baht(revenue));
    this.#vars = {
      price,
      revenue,
      optimalPrice: this.#best,
      close: Math.abs(price - this.#best) <= CLOSE_BAHT,
    };
    if (this.#controlling && !this.#tutorial) this.#tried.set(price, revenue);
    this.#drawTrace();
  }

  /** Revenue at each price the player has tried: the hump appears as they explore. */
  #drawTrace(): void {
    // Zoomed on the range revenue actually spans, so the hump is easy to see.
    const top = revenueAt(TRUE_DEMAND, -TRUE_DEMAND.intercept / (2 * TRUE_DEMAND.slope));
    const low = Math.min(
      revenueAt(TRUE_DEMAND, PRICE_RANGE.min),
      revenueAt(TRUE_DEMAND, PRICE_RANGE.max),
    );
    const x = (p: number) => ((p - PRICE_RANGE.min) / (PRICE_RANGE.max - PRICE_RANGE.min)) * 600;
    const y = (r: number) => 164 - ((r - low) / (top - low)) * 150;
    const pts = [...this.#tried.entries()].sort((a, b) => a[0] - b[0]);
    this.#trace.setAttribute(
      'd',
      pts.map(([p, r], i) => `${i ? 'L' : 'M'}${x(p).toFixed(1)},${y(r).toFixed(1)}`).join(' '),
    );
    this.#traceDot.setAttribute('cx', String(x(this.#price)));
    this.#traceDot.setAttribute('cy', String(y(revenueAt(TRUE_DEMAND, this.#price))));
  }

  /** Customers walk in from the left; at a high price more of them turn back at the door. */
  #drawCafe(dtMs: number): void {
    const c = this.#canvas;
    const { width, height } = c.getBoundingClientRect();
    const w = Math.round(width * devicePixelRatio);
    const h = Math.round(height * devicePixelRatio);
    if (w === 0 || h === 0) return;
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    const g = c.getContext('2d');
    if (!g) return;
    const dt = dtMs / 1000;
    const buyShare = cupsAt(TRUE_DEMAND, this.#price) / TRUE_DEMAND.intercept;
    this.#spawn += dt * CUSTOMER_RATE * 4 * (0.35 + 0.65 * buyShare);
    while (this.#spawn >= 1 && this.#customers.length < 120) {
      this.#spawn -= 1;
      this.#customers.push({
        x: -0.02,
        y: 0.25 + Math.random() * 0.6,
        speed: 0.12 + Math.random() * 0.08,
        leaves: Math.random() > buyShare,
        life: 0,
      });
    }
    g.clearRect(0, 0, w, h);
    const door = 0.8;
    // The café: a glowing doorway on the right
    const grad = g.createLinearGradient(door * w, 0, w, 0);
    grad.addColorStop(0, 'rgba(255, 61, 143, 0.0)');
    grad.addColorStop(1, 'rgba(255, 61, 143, 0.28)');
    g.fillStyle = grad;
    g.fillRect(door * w, h * 0.12, w * (1 - door), h * 0.8);
    g.strokeStyle = 'rgba(255, 190, 220, 0.8)';
    g.lineWidth = 2 * devicePixelRatio;
    g.beginPath();
    g.moveTo(door * w, h * 0.12);
    g.lineTo(door * w, h * 0.92);
    g.stroke();
    for (let i = this.#customers.length - 1; i >= 0; i--) {
      const p = this.#customers[i];
      if (!p) continue;
      p.life += dt;
      if (p.leaves && p.x > door - 0.12) {
        p.speed = -Math.abs(p.speed) * 1.2; // turns away
        p.leaves = false;
      }
      p.x += p.speed * dt;
      if (p.x > 1 || p.x < -0.05) {
        this.#customers.splice(i, 1);
        continue;
      }
      const away = p.speed < 0;
      const r = (away ? 4 : 5) * devicePixelRatio;
      g.fillStyle = away ? 'rgba(169, 147, 167, 0.55)' : '#fff';
      g.shadowColor = away ? 'transparent' : 'rgba(255, 61, 143, 0.9)';
      g.shadowBlur = away ? 0 : 10 * devicePixelRatio;
      g.beginPath();
      g.arc(p.x * w, p.y * h, r, 0, Math.PI * 2);
      g.fill();
    }
    g.shadowBlur = 0;
  }

  #finishPlay(): void {
    this.#controlling = false;
    this.#setPrice(this.#price);
    void this.#anim
      .tween(500, (t) => {
        this.#play.style.opacity = String(1 - t);
        this.#play.style.transform = `translateY(${String(-3 * t)}vh)`;
      })
      .then(() => {
        this.#play.hidden = true;
      });
    this.#chart = new CoffeeChart(this.#ctx.hud, this.#anim, this.#days);
  }
}
