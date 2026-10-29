import { setDigits } from '../../hud/digits';
import { gestureConfig } from '../../config/gestures';
import type { IntentOf } from '../../input/intents';
import type { Beat } from '../../narrative/schema';
import { Animator, ease } from '../../viz/animator';
import type { SceneContext, SceneModule } from '../types';
import {
  atRing,
  AXES,
  bestRing,
  COST,
  density,
  emptySet,
  fillSet,
  fitNormal,
  outcomes,
  playStream,
  ring,
  RING,
  ringAt,
  scoreAll,
  TOTAL,
  type Dataset,
  type Density,
  type Normal,
  type Outcomes,
  type Point,
  type RingResult,
  toPlot,
  type Transaction,
} from './model';
import './fraud.css';

/** Red = fraud (spiky), blue = good customer (round): shape too, never color alone. */
const FRAUD = '#ff5470';
const GOOD = '#3f9be0';
const LASER = '#ffd0e4';
/** The ships fly in this band of the screen, clear of the caption (bottom-left). */
const BAND = { top: 0.27, bottom: 0.7 } as const;
/** Hit radius around the laser path, in screen heights. */
const HIT_RADIUS = 0.075;
/**
 * Ships come out of a hyperspace gate at the side panel's left edge, so they never fly under the
 * scoreboard.
 */
const GATE_X = 0.69;
/** Laser points further apart in time than this are separate strokes. */
const STROKE_GAP_MS = 120;
const TRAIL_MS = 480;
/** Generating the million costs ~240 ms: spread it over frames, this much per frame. */
const FILL_BUDGET_MS = 4;
const GRID = { w: 384, h: 216 } as const;
/** How long the player gets to set the ring (story time). */
const RING_MS = 12_000;
/** "Near the best": damage within this share of the least possible. */
const NEAR_BEST = 0.12;
const PLAY_SEC = 20;

export function fraudScene(chapterId: string) {
  return (ctx: SceneContext): SceneModule => new FraudScene(ctx, chapterId);
}

interface Ship {
  t: Transaction;
  /** Screen position (x across, y down) in [0, 1]. */
  x: number;
  y: number;
  /** Screen widths per second (leftward). */
  speed: number;
  age: number;
  counted: boolean;
  state: 'flying' | 'hit' | 'gone';
}

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
}

interface Ripple {
  x: number;
  y: number;
  age: number;
  color: string;
}

type Mode = 'idle' | 'calm' | 'tutorial' | 'play' | 'over' | 'reveal';

/**
 * EPISODE IV — จับโกงข้ามกาแล็กซี (Anomaly Detection). Play: transactions fly across the screen
 * and the player sweeps a laser through the red ones (a fast sweep of the cursor = slap) while
 * sparing good customers; the stream speeds up past what a person can keep up with. Reveal: a
 * million transactions storm in and the AI scores every one by its distance from normal; a ring
 * flags the outliers; the player sets the ring size with their hand and sees the trade-off
 * between fraud let through and good customers blocked (research 020).
 */
class FraudScene implements SceneModule {
  readonly id = 'f-fraud';
  readonly #ctx: SceneContext;
  readonly #chapterId: string;
  readonly #anim = new Animator();

  readonly #root = document.createElement('div');
  readonly #field: HTMLCanvasElement;
  readonly #side: HTMLElement;
  readonly #plotPanel: HTMLElement;
  readonly #plot: HTMLElement;
  readonly #plotCanvas: HTMLCanvasElement;
  readonly #alert: HTMLElement;

  #mode: Mode = 'idle';
  #now = 0;
  readonly #stream = playStream(160);
  #next = 0;
  #spawnIn = 0;
  #playMs = 0;
  readonly #ships: Ship[] = [];
  readonly #played: Ship[] = [];
  readonly #sparks: Spark[] = [];
  readonly #ripples: Ripple[] = [];
  readonly #trail: { x: number; y: number; t: number }[] = [];
  /** Recent cursor samples (intent time), to lay the laser along the whole sweep. */
  readonly #cursorPath: { x: number; y: number; t: number }[] = [];
  #lastSlap = -1e9;
  #shake = 0;
  #targetAt = -1e9;
  #combo = 0;
  #bestCombo = 0;
  #caught = 0;
  #wrong = 0;
  #missed = 0;

  // The million
  readonly #data: Dataset = emptySet();
  readonly #fill = fillSet(this.#data, 4000);
  #filled = false;
  #normal: Normal | null = null;
  #outcomes: Outcomes | null = null;
  #grid: Density | null = null;
  /** Distance from normal of each grid cell's center. */
  #cellDistance: Float32Array | null = null;
  #image: ImageData | null = null;
  readonly #offscreen = document.createElement('canvas');
  #imageRing = -1;
  #imageReveal = -1;
  #aiSeconds = '0';
  #best: RingResult | null = null;

  // Ring on the plot
  #ringR = 0;
  #reveal = 0;
  #showPlayed = 0;
  #controlling = false;
  #level = 0.5;
  #chosen: RingResult | null = null;
  #showBest = false;
  readonly #storm: { from: Point; to: Point; delay: number }[] = [];
  #stormT = -1;

  readonly #off: (() => void)[] = [];

  constructor(ctx: SceneContext, chapterId: string) {
    this.#ctx = ctx;
    this.#chapterId = chapterId;
    this.#root.className = 'fr';
    this.#root.innerHTML = `
      <canvas class="fr-field"></canvas>
      <div class="fr-alert" aria-hidden="true"><b>ALERT</b><span>ตรวจพบรายการผิดปกติ</span></div>
      <div class="hud-panel fr-plot">
        <p class="hud-eyebrow">AI · Anomaly scan</p>
        <p class="fr-axis fr-axis-y"></p>
        <p class="fr-axis fr-axis-x"></p>
        <div class="fr-area"><canvas></canvas></div>
      </div>
      <aside class="hud-panel fr-side"></aside>`;
    const q = (sel: string) => this.#root.querySelector(sel) as HTMLElement;
    this.#field = q('.fr-field') as HTMLCanvasElement;
    this.#alert = q('.fr-alert');
    this.#plotPanel = q('.fr-plot');
    this.#plot = q('.fr-area');
    this.#plotCanvas = this.#plot.querySelector('canvas') as HTMLCanvasElement;
    this.#side = q('.fr-side');
    q('.fr-axis-y').textContent = `↑ ${AXES.y.label} · log`;
    q('.fr-axis-x').textContent = `${AXES.x.label} · log →`;
    ctx.hud.append(this.#root);
    this.#scoreboard();

    this.#off.push(
      ctx.bus.on('cursor', (c) => {
        this.#onCursor(c);
      }),
      ctx.bus.on('slap', (s) => {
        this.#onSlap(s);
      }),
      ctx.bus.on('raise', (r) => {
        if (this.#controlling) this.#level = r.level;
      }),
    );
  }

  ownsLesson(): boolean {
    return true;
  }

  /** The hand sets the ring size while it is the player's turn: no pointing cursor then. */
  showCursor(): boolean {
    return !this.#controlling;
  }

  setFade(value: number): void {
    this.#ctx.hud.style.opacity = String(value);
  }

  vars() {
    const chosen = this.#chosen;
    const best = this.#best;
    return {
      caught: this.#caught,
      wrong: this.#wrong,
      aiSeconds: this.#aiSeconds,
      aiRecall: best ? Math.round(best.recall * 100) : 0,
      recall: chosen ? Math.round(chosen.recall * 100) : 0,
      blocked: chosen?.blocked ?? 0,
      nearBest: chosen !== null && best !== null && this.#nearBest(chosen, best),
    };
  }

  result() {
    const seen = this.#caught + this.#missed;
    const precision = this.#caught / Math.max(1, this.#caught + this.#wrong);
    const recall = this.#caught / Math.max(1, seen);
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
    const chosen = this.#chosen;
    const best = this.#best;
    const ringScore = chosen && best ? best.damage / Math.max(chosen.damage, 1) : 0.5;
    const style =
      !chosen || !best
        ? { intuitive: 0.6 }
        : this.#nearBest(chosen, best)
          ? { analyst: 1 }
          : chosen.r < best.r
            ? { 'risk-taker': 1 }
            : { intuitive: 1 };
    return { chapterId: this.#chapterId, score: 0.4 * f1 + 0.6 * ringScore, style };
  }

  dispose(): void {
    this.#anim.cancel();
    delete document.body.dataset['fraudTarget'];
    delete document.body.dataset['fraudCaught'];
    for (const off of this.#off) off();
  }

  update(dtMs: number): void {
    this.#now += dtMs;
    this.#publishTarget();
    this.#anim.update(dtMs);
    this.#pumpFill();
    if (this.#mode === 'play') this.#playMs += dtMs;
    this.#spawn(dtMs);
    this.#move(dtMs);
    if (this.#controlling) {
      const target = ringAt(this.#level);
      this.#ringR += (target - this.#ringR) * (1 - Math.exp(-dtMs / 90));
      this.#liveRing();
    }
    this.#drawField();
    if (this.#reveal > 0) this.#drawPlot();
  }

  onBeat(beat: Beat): void {
    switch (beat.type) {
      case 'mission':
        this.#mode = 'calm';
        break;
      case 'tutorial':
        this.#mode = 'tutorial';
        this.#spawnIn = 0;
        break;
      case 'play':
        this.#mode = 'play';
        this.#combo = 0;
        break;
      case 'reveal':
        this.#endPlay();
        break;
      case 'lesson':
        this.#root
          .querySelector('.fr-plot .hud-eyebrow')
          ?.replaceChildren('Lesson · Anomaly Detection');
        this.#showBest = true;
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
      case 'alert':
        this.#raiseAlert();
        return false;
      case 'ai-storm':
        return run(this.#runStorm());
      case 'ai-ring':
        return run(this.#runAiRing());
      case 'set-ring':
        return run(this.#letPlayerSetRing());
      default:
        return false;
    }
  }

  // ---------- Mission ----------

  #raiseAlert(): void {
    this.#alert.classList.add('is-on');
    this.#shake = 1;
    // A few red ones among the calm stream, slow, so the player sees what to look for
    for (let i = 0; i < 3; i++) this.#launch(this.#nextOf(true), 0.08, 0.35 + i * 0.12);
    void this.#anim.wait(2600).then(() => {
      this.#alert.classList.remove('is-on');
    });
  }

  // ---------- Play: the stream ----------

  /** Next transaction from the stream, optionally forcing fraud or good. */
  #nextOf(fraud?: boolean): Transaction {
    for (let tries = 0; tries < this.#stream.length; tries++) {
      const t = this.#stream[this.#next % this.#stream.length];
      this.#next++;
      if (t && (fraud === undefined || t.fraud === fraud)) return t;
    }
    return this.#stream[0] as Transaction;
  }

  #launch(t: Transaction, speed: number, y?: number): void {
    const lane = y ?? BAND.top + ((this.#next * 0.6180339) % 1) * (BAND.bottom - BAND.top);
    this.#ships.push({ t, x: GATE_X, y: lane, speed, age: 0, counted: false, state: 'flying' });
  }

  /** Spawn rate and speed ramp up through play until it is more than a person can handle. */
  #spawn(dtMs: number): void {
    this.#spawnIn -= dtMs;
    if (this.#spawnIn > 0) return;
    switch (this.#mode) {
      case 'calm':
        this.#launch(this.#nextOf(false), 0.07);
        this.#spawnIn = 900;
        break;
      case 'tutorial':
        // One slow red target at a time, mid-band: practise until the first hit
        if (!this.#ships.some((s) => s.state === 'flying' && s.t.fraud)) {
          this.#launch(this.#nextOf(true), 0.08, 0.42);
        }
        this.#spawnIn = 400;
        break;
      case 'play': {
        const t = this.#playMs / 1000;
        const storm = t > PLAY_SEC - 5;
        const rate = storm ? 7 : 1.2 + 0.2 * t;
        const speed = storm ? 0.3 : 0.12 + 0.009 * t;
        this.#launch(this.#nextOf(), speed);
        this.#spawnIn = 1000 / rate;
        break;
      }
      default:
        this.#spawnIn = 1e9;
    }
  }

  #move(dtMs: number): void {
    const dt = dtMs / 1000;
    for (const s of this.#ships) {
      s.age += dtMs;
      if (s.state !== 'flying') continue;
      s.x -= s.speed * dt * (this.#mode === 'over' ? 4 : 1);
      if (s.x < -0.06) {
        s.state = 'gone';
        if (this.#mode === 'play' && s.t.fraud && !s.counted) {
          s.counted = true;
          this.#missed++;
          this.#combo = 0;
          this.#played.push(s);
          this.#ripples.push({ x: 0.01, y: s.y, age: 0, color: FRAUD });
          this.#scoreboard();
        }
      }
    }
    for (let i = this.#ships.length - 1; i >= 0; i--) {
      const s = this.#ships[i];
      if (s && s.state !== 'flying' && s.age > 0) this.#ships.splice(i, 1);
    }
    for (const p of this.#sparks) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= Math.exp(-dt * 3);
      p.vy = p.vy * Math.exp(-dt * 3) + 0.25 * dt;
      p.life -= dt * 1.6;
    }
    for (let i = this.#sparks.length - 1; i >= 0; i--) {
      if ((this.#sparks[i]?.life ?? 0) <= 0) this.#sparks.splice(i, 1);
    }
    for (const r of this.#ripples) r.age += dtMs;
    for (let i = this.#ripples.length - 1; i >= 0; i--) {
      if ((this.#ripples[i]?.age ?? 0) > 700) this.#ripples.splice(i, 1);
    }
    while (this.#trail.length > 0 && this.#now - (this.#trail[0]?.t ?? 0) > TRAIL_MS) {
      this.#trail.shift();
    }
    this.#shake *= Math.exp(-dtMs / 140);
  }

  #onCursor(c: IntentOf<'cursor'>): void {
    const h = this.#cursorPath;
    if (!c.visible) {
      h.length = 0;
      return;
    }
    h.push({ x: c.x, y: c.y, t: c.t });
    while (h.length > 1 && c.t - (h[0]?.t ?? c.t) > 250) h.shift();
  }

  /**
   * A slap fires once the sweep is already fast, a frame or two in. The laser covers the whole
   * sweep: the cursor's path over the slap window before the first event, then frame by frame.
   * Hit-testing only the slap events left gaps a ship could slip through (research 020).
   */
  #onSlap(s: IntentOf<'slap'>): void {
    if (this.#mode !== 'tutorial' && this.#mode !== 'play') return;
    const since =
      s.t - this.#lastSlap < STROKE_GAP_MS ? this.#lastSlap : s.t - gestureConfig.slap.windowMs;
    this.#lastSlap = s.t;
    const path = this.#cursorPath.filter((p) => p.t >= since && p.t <= s.t);
    if (path.length === 0 || path.at(-1)?.t !== s.t) path.push({ x: s.x, y: s.y, t: s.t });
    const last = this.#trail.at(-1);
    let from = last && this.#now - last.t < STROKE_GAP_MS ? last : path[0];
    for (const p of path) {
      if (!from) break;
      for (const ship of this.#ships) {
        if (ship.state === 'flying' && segmentDistance(ship, from, p) <= HIT_RADIUS)
          this.#hit(ship);
      }
      const point = { x: p.x, y: p.y, t: this.#now };
      this.#trail.push(point);
      from = point;
    }
  }

  #hit(ship: Ship): void {
    ship.state = 'hit';
    ship.age = 0;
    const counts = this.#mode === 'play';
    if (ship.t.fraud) {
      this.#burst(ship.x, ship.y, FRAUD, 26);
      this.#shake = Math.max(this.#shake, 0.5);
      if (counts) {
        this.#caught++;
        this.#combo++;
        this.#bestCombo = Math.max(this.#bestCombo, this.#combo);
      }
      if (this.#mode === 'tutorial') this.#ctx.signal('gesture');
    } else {
      this.#ripples.push({ x: ship.x, y: ship.y, age: 0, color: GOOD });
      this.#burst(ship.x, ship.y, GOOD, 10);
      if (counts) {
        this.#wrong++;
        this.#combo = 0;
      }
    }
    if (counts) {
      ship.counted = true;
      this.#played.push(ship);
      this.#scoreboard();
    }
  }

  #burst(x: number, y: number, color: string, n: number): void {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.4;
      const v = 0.25 + Math.random() * 0.55;
      this.#sparks.push({
        x,
        y,
        vx: (Math.cos(a) * v) / (16 / 9),
        vy: Math.sin(a) * v,
        life: 0.7 + Math.random() * 0.4,
        color,
      });
    }
  }

  /**
   * The newest red ship out of the gate, as "x,y" on `body[data-fraud-target]`, so the E2E player
   * can aim like a person does. Written at most every 100 ms.
   */
  #publishTarget(): void {
    if (this.#now - this.#targetAt < 100) return;
    this.#targetAt = this.#now;
    let best: Ship | null = null;
    for (const s of this.#ships) {
      if (s.state === 'flying' && s.t.fraud && s.age > 250 && (!best || s.x > best.x)) best = s;
    }
    const value = best ? `${best.x.toFixed(3)},${best.y.toFixed(3)}` : '';
    if (document.body.dataset['fraudTarget'] !== value)
      document.body.dataset['fraudTarget'] = value;
  }

  #endPlay(): void {
    this.#mode = 'over';
    this.#trail.length = 0;
    // Frauds still on screen got away
    for (const s of this.#ships) {
      if (s.state === 'flying' && s.t.fraud && !s.counted) {
        s.counted = true;
        this.#missed++;
        this.#played.push(s);
      }
    }
    this.#scoreboard();
  }

  #scoreboard(): void {
    const combo = this.#combo >= 2 ? `<p class="fr-combo">COMBO ×${String(this.#combo)}</p>` : '';
    this.#side.innerHTML = `
      <p class="hud-eyebrow">Fraud patrol</p>
      <div class="fr-stat is-fraud"><i aria-hidden="true"></i><p class="hud-label-th">ยิงโกงได้</p><span class="hud-number">${String(this.#caught)}</span></div>
      <div class="fr-stat is-good"><i aria-hidden="true"></i><p class="hud-label-th">ยิงโดนลูกค้าดี</p><span class="hud-number">${String(this.#wrong)}</span></div>
      <div class="fr-stat is-missed"><i aria-hidden="true"></i><p class="hud-label-th">โกงหลุดไป</p><span class="hud-number">${String(this.#missed)}</span></div>
      ${combo}
      <p class="fr-help">ปัดมือเร็ว ๆ ผ่านรายการ<b>สีแดง</b><br />= ยิงเลเซอร์</p>`;
    document.body.dataset['fraudCaught'] = String(this.#caught);
  }

  // ---------- The million ----------

  #pumpFill(): void {
    if (this.#filled || this.#mode === 'idle') return;
    const start = performance.now();
    while (performance.now() - start < FILL_BUDGET_MS) {
      if (this.#fill.next().done) {
        this.#filled = true;
        return;
      }
    }
  }

  #finishFill(): void {
    while (!this.#filled) if (this.#fill.next().done) this.#filled = true;
  }

  /** The AI's actual work, timed: fit "normal" and score all million. */
  #scoreMillion(): void {
    this.#finishFill();
    const t0 = performance.now();
    const normal = fitNormal(this.#data);
    const scores = scoreAll(this.#data, normal);
    const seconds = (performance.now() - t0) / 1000;
    this.#aiSeconds = seconds < 0.01 ? seconds.toFixed(3) : seconds.toFixed(2);
    this.#normal = normal;
    this.#outcomes = outcomes(this.#data, scores);
    this.#best = bestRing(this.#outcomes);
    this.#grid = density(this.#data, GRID.w, GRID.h);
    const cells = new Float32Array(GRID.w * GRID.h);
    const det = normal.sxx * normal.syy - normal.sxy * normal.sxy;
    for (let cy = 0; cy < GRID.h; cy++) {
      for (let cx = 0; cx < GRID.w; cx++) {
        const dx = (cx + 0.5) / GRID.w - normal.mx;
        const dy = 1 - (cy + 0.5) / GRID.h - normal.my;
        cells[cy * GRID.w + cx] = Math.sqrt(
          (normal.syy * dx * dx - 2 * normal.sxy * dx * dy + normal.sxx * dy * dy) / det,
        );
      }
    }
    this.#cellDistance = cells;
  }

  async #runStorm(): Promise<void> {
    this.#mode = 'reveal';
    this.#ships.length = 0;
    this.#scoreMillion();
    this.#side.innerHTML = `
      <p class="hud-eyebrow">AI · Scanning</p>
      <p class="hud-label-th">ตรวจแล้ว</p>
      <span class="hud-number fr-count"></span>
      <p class="fr-sub">รายการ จาก ${TOTAL.toLocaleString('en-US')}</p>
      <p class="fr-time" hidden></p>`;
    const counter = this.#side.querySelector('.fr-count') as HTMLElement;
    setDigits(counter, '0');
    this.#plotPanel.classList.add('is-shown');
    await this.#anim.wait(300);
    // Streaks fly from the right edge into where each transaction belongs on the map
    const plot = this.#plot.getBoundingClientRect();
    const sx = (p: Point) => (plot.left + p.x * plot.width) / window.innerWidth;
    const sy = (p: Point) => (plot.top + (1 - p.y) * plot.height) / window.innerHeight;
    this.#storm.length = 0;
    for (let i = 0; i < 900; i++) {
      const k = Math.floor(((i * 7919) % 1000) * (TOTAL / 1000)) + (i % 997);
      const at = { x: this.#data.x[k] ?? 0.5, y: this.#data.y[k] ?? 0.5 };
      this.#storm.push({
        from: { x: 1.05 + Math.random() * 0.25, y: 0.1 + Math.random() * 0.8 },
        to: { x: sx(at), y: sy(at) },
        delay: Math.random() * 0.75,
      });
    }
    this.#stormT = 0;
    await this.#anim.tween(
      3200,
      (t) => {
        this.#stormT = t;
        this.#reveal = Math.min(1, t * 1.15);
        setDigits(counter, Math.round(TOTAL * t).toLocaleString('en-US'));
      },
      { ease: ease.inOutCubic },
    );
    this.#stormT = -1;
    this.#reveal = 1;
    const time = this.#side.querySelector('.fr-time') as HTMLElement;
    time.hidden = false;
    time.innerHTML = `ใช้เวลา <b>${this.#aiSeconds}</b> วินาที`;
    await this.#anim.wait(700);
  }

  async #runAiRing(): Promise<void> {
    const best = this.#best;
    if (!best) return;
    this.#side.innerHTML = `
      <p class="hud-eyebrow">AI · Outlier ring</p>
      <p class="fr-sub">ยิ่งห่างจากกลุ่มปกติ ยิ่งน่าสงสัย</p>
      ${this.#legend()}
      <div class="fr-meter"><p class="hud-label-th">AI จับโกงได้</p><span class="hud-number"><span class="fr-recall"></span><small>%</small></span></div>
      <div class="fr-meter"><p class="hud-label-th">ลูกค้าดีโดนบล็อก</p><span class="hud-number fr-blocked"></span></div>`;
    await this.#anim.tween(
      2200,
      (t) => {
        this.#ringR = best.r * t;
        this.#liveRing();
      },
      { ease: ease.inOutCubic },
    );
    // The player's own shots, placed on the map: what they caught and what slipped past
    await this.#anim.tween(700, (t) => {
      this.#showPlayed = t;
    });
    await this.#anim.wait(600);
  }

  async #letPlayerSetRing(): Promise<void> {
    const best = this.#best;
    if (!best) return;
    this.#side.innerHTML = `
      <p class="hud-eyebrow">Your call · ring size</p>
      <p class="fr-cost">โกงหลุด ฿${COST.missed.toLocaleString('en-US')} / รายการ · บล็อกผิด ฿${String(COST.blocked)} / คน</p>
      <div class="fr-meter is-row"><p class="hud-label-th">จับโกงได้</p><span class="hud-number"><span class="fr-recall"></span><small>%</small></span></div>
      <div class="fr-meter is-row"><p class="hud-label-th">ลูกค้าดีโดนบล็อก</p><span class="hud-number fr-blocked"></span></div>
      <div class="fr-meter is-row is-damage"><p class="hud-label-th">ความเสียหายรวม</p><span class="hud-number fr-damage"></span></div>
      <svg class="fr-curve" viewBox="0 0 400 150" aria-hidden="true"></svg>
      <div class="fr-timer"><i></i></div>`;
    this.#drawCurve();
    this.#level = (best.r - RING.min) / (RING.max - RING.min) + 0.3;
    this.#controlling = true;
    const bar = this.#side.querySelector('.fr-timer i') as HTMLElement;
    await this.#anim.tween(RING_MS, (t) => (bar.style.transform = `scaleX(${String(1 - t)})`), {
      ease: ease.linear,
    });
    this.#controlling = false;
    const outcomesNow = this.#outcomes;
    if (outcomesNow) this.#chosen = atRing(outcomesNow, this.#ringR);
    this.#liveRing();
    this.#showBest = true;
    this.#drawCurve();
    await this.#anim.wait(500);
  }

  #nearBest(chosen: RingResult, best: RingResult): boolean {
    return chosen.damage <= best.damage * (1 + NEAR_BEST);
  }

  #legend(): string {
    return `<ul class="fr-legend">
      <li><i class="is-normal"></i>ปกติ</li>
      <li><i class="is-blocked"></i>ลูกค้าดีโดนบล็อก</li>
      <li><i class="is-fraud"></i>โกง</li>
      <li><i class="is-shot"></i>ที่ท่านยิง</li>
    </ul>`;
  }

  /** Updates the side counters for the current ring. */
  #liveRing(): void {
    const o = this.#outcomes;
    if (!o) return;
    const res = atRing(o, this.#ringR);
    const set = (sel: string, text: string) => {
      const el = this.#side.querySelector<HTMLElement>(sel);
      if (el) setDigits(el, text);
    };
    set('.fr-recall', String(Math.round(res.recall * 100)));
    set('.fr-blocked', res.blocked.toLocaleString('en-US'));
    set('.fr-damage', `฿${(res.damage / 1e6).toFixed(1)}M`);
    const dot = this.#side.querySelector<SVGCircleElement>('.fr-curve-you');
    if (dot) {
      const [x, y] = this.#curveAt(res);
      dot.setAttribute('cx', x.toFixed(1));
      dot.setAttribute('cy', y.toFixed(1));
    }
  }

  /** Damage vs ring size: the U the player is searching along. */
  #drawCurve(): void {
    const o = this.#outcomes;
    const svg = this.#side.querySelector('.fr-curve');
    if (!o || !svg) return;
    const pts: string[] = [];
    for (let i = 0; i <= 60; i++) {
      const [x, y] = this.#curveAt(atRing(o, RING.min + ((RING.max - RING.min) * i) / 60));
      pts.push(`${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`);
    }
    const best = this.#best;
    const [bx, by] = best ? this.#curveAt(best) : [0, 0];
    const you = atRing(o, this.#ringR);
    const [yx, yy] = this.#curveAt(you);
    svg.innerHTML = `
      <text x="0" y="12" class="fr-curve-name">ความเสียหาย</text>
      <text x="400" y="146" text-anchor="end" class="fr-curve-name">วงใหญ่ขึ้น →</text>
      <path d="${pts.join(' ')}" class="fr-curve-line" />
      ${this.#showBest && best ? `<g class="fr-curve-best"><circle cx="${bx.toFixed(1)}" cy="${by.toFixed(1)}" r="9" /><text x="${bx.toFixed(1)}" y="${(by + 30).toFixed(1)}" text-anchor="middle">ต่ำสุด</text></g>` : ''}
      <circle cx="${yx.toFixed(1)}" cy="${yy.toFixed(1)}" r="11" class="fr-curve-you" />`;
  }

  #curveAt(res: RingResult): [number, number] {
    const top = atRing(this.#outcomes as Outcomes, RING.min).damage;
    const x = 10 + ((res.r - RING.min) / (RING.max - RING.min)) * 380;
    const y = 128 - Math.min(1, res.damage / top) * 108;
    return [x, y];
  }

  // ---------- Drawing ----------

  #drawField(): void {
    const c = this.#field;
    const dpr = Math.min(devicePixelRatio, 2);
    const w = Math.round(window.innerWidth * dpr);
    const h = Math.round(window.innerHeight * dpr);
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    const g = c.getContext('2d');
    if (!g) return;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, w, h);
    const shake = this.#shake * 0.006 * h;
    g.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    const unit = h / 100; // 1vh

    if (this.#mode !== 'idle' && this.#mode !== 'reveal') this.#drawGate(g, w, h, unit);
    for (const s of this.#ships) this.#drawShip(g, s, w, h, unit);

    // Ripples: blue shield when a good customer is hit, red flash when fraud escapes
    for (const r of this.#ripples) {
      const t = r.age / 700;
      g.strokeStyle = withAlpha(r.color, 1 - t);
      g.lineWidth = 0.5 * unit;
      g.beginPath();
      g.arc(r.x * w, r.y * h, (3 + 9 * t) * unit, 0, Math.PI * 2);
      g.stroke();
    }

    // Sparks
    g.globalCompositeOperation = 'lighter';
    for (const p of this.#sparks) {
      g.fillStyle = withAlpha(p.color, Math.max(0, p.life));
      g.beginPath();
      g.arc(p.x * w, p.y * h, 0.45 * unit * (0.5 + p.life), 0, Math.PI * 2);
      g.fill();
    }

    // Laser trail: the sweep as a beam (wide glow, hot core), thinning and fading with age
    for (let i = 1; i < this.#trail.length; i++) {
      const a = this.#trail[i - 1];
      const b = this.#trail[i];
      if (!a || !b || b.t - a.t > STROKE_GAP_MS) continue;
      const life = 1 - (this.#now - b.t) / TRAIL_MS;
      if (life <= 0) continue;
      for (const [width, color] of [
        [4.2 * life, withAlpha('#f6629e', 0.28 * life)],
        [1.8 * life, withAlpha('#ff8fc0', 0.6 * life)],
        [0.6 + 0.4 * life, withAlpha(LASER, life)],
      ] as const) {
        g.strokeStyle = color;
        g.lineWidth = width * unit;
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(a.x * w, a.y * h);
        g.lineTo(b.x * w, b.y * h);
        g.stroke();
      }
    }
    // A hot spark at the tip while the beam is live
    const tip = this.#trail.at(-1);
    if (tip && this.#now - tip.t < 90) {
      const glow = g.createRadialGradient(tip.x * w, tip.y * h, 0, tip.x * w, tip.y * h, 4 * unit);
      glow.addColorStop(0, withAlpha('#ffffff', 0.95));
      glow.addColorStop(0.3, withAlpha('#ff8fc0', 0.6));
      glow.addColorStop(1, withAlpha('#f6629e', 0));
      g.fillStyle = glow;
      g.beginPath();
      g.arc(tip.x * w, tip.y * h, 4 * unit, 0, Math.PI * 2);
      g.fill();
    }

    // Storm: streaks racing into the map
    if (this.#stormT >= 0) {
      for (const s of this.#storm) {
        const t = Math.min(1, Math.max(0, (this.#stormT - s.delay) / 0.25));
        if (t <= 0 || t >= 1) continue;
        const e = t * t;
        const x = s.from.x + (s.to.x - s.from.x) * e;
        const y = s.from.y + (s.to.y - s.from.y) * e;
        const tail = Math.max(0, e - 0.08);
        g.strokeStyle = withAlpha(LASER, 0.6 * (1 - t) + 0.2);
        g.lineWidth = 0.25 * unit;
        g.beginPath();
        g.moveTo(
          (s.from.x + (s.to.x - s.from.x) * tail) * w,
          (s.from.y + (s.to.y - s.from.y) * tail) * h,
        );
        g.lineTo(x * w, y * h);
        g.stroke();
      }
    }
    g.globalCompositeOperation = 'source-over';
  }

  /** The hyperspace gate the stream pours out of: a shimmering seam, brighter as it speeds up. */
  #drawGate(g: CanvasRenderingContext2D, w: number, h: number, unit: number): void {
    const x = GATE_X * w;
    const top = (BAND.top - 0.05) * h;
    const bottom = (BAND.bottom + 0.05) * h;
    const heat = this.#mode === 'play' ? Math.min(1, this.#playMs / (PLAY_SEC * 1000)) : 0.3;
    const glow = g.createLinearGradient(0, top, 0, bottom);
    glow.addColorStop(0, withAlpha('#f6629e', 0));
    glow.addColorStop(0.5, withAlpha('#f6629e', 0.35 + 0.4 * heat));
    glow.addColorStop(1, withAlpha('#f6629e', 0));
    g.fillStyle = glow;
    g.fillRect(x - (1.2 + 2 * heat) * unit, top, (2.4 + 4 * heat) * unit, bottom - top);
    g.strokeStyle = withAlpha(LASER, 0.5 + 0.3 * Math.sin(this.#now / 90));
    g.lineWidth = 0.3 * unit;
    g.beginPath();
    for (let i = 0; i <= 40; i++) {
      const yy = top + ((bottom - top) * i) / 40;
      const xx = x + Math.sin(i * 1.7 + this.#now / 160) * (0.4 + heat) * unit;
      g[i ? 'lineTo' : 'moveTo'](xx, yy);
    }
    g.stroke();
  }

  #drawShip(g: CanvasRenderingContext2D, s: Ship, w: number, h: number, unit: number): void {
    const x = s.x * w;
    const y = (s.y + Math.sin(s.age / 420 + s.t.x * 9) * 0.006) * h;
    const fraud = s.t.fraud;
    const color = fraud ? FRAUD : GOOD;
    const fade = s.state === 'hit' ? Math.max(0, 1 - s.age / 160) : 1;
    if (fade <= 0) return;
    // Emerging from the gate: grow in over the first 250 ms
    const R = 2.6 * unit * Math.min(1, 0.3 + s.age / 250);
    g.save();
    g.globalAlpha = fade;
    // Hyperspace streak while entering
    if (s.age < 450) {
      const k = 1 - s.age / 450;
      g.strokeStyle = withAlpha(color, 0.5 * k);
      g.lineWidth = 0.4 * unit;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(Math.min(x + k * 20 * unit, GATE_X * w), y);
      g.stroke();
    }
    g.shadowColor = color;
    g.shadowBlur = (fraud ? 3 + 1.5 * Math.sin(this.#now / 120) : 2) * unit;
    g.fillStyle = withAlpha(color, 0.22);
    g.strokeStyle = color;
    g.lineWidth = 0.35 * unit;
    g.beginPath();
    if (fraud) {
      // Spiky: an 8-point star
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2 + this.#now / 900;
        const r = i % 2 ? R * 0.62 : R * 1.12;
        g[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * r, y + Math.sin(a) * r);
      }
      g.closePath();
    } else {
      g.arc(x, y, R * 0.9, 0, Math.PI * 2);
    }
    g.fill();
    g.stroke();
    g.shadowBlur = 0;
    g.fillStyle = '#fff6fa';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `800 ${String(1.9 * unit)}px Orbitron, sans-serif`;
    g.fillText(fraud ? '!' : '✓', x, y + 0.1 * unit);
    g.font = `700 ${String(1.7 * unit)}px 'Bai Jamjuree', sans-serif`;
    g.fillStyle = withAlpha('#fff6fa', 0.9);
    g.fillText(`฿${Math.round(s.t.baht).toLocaleString('en-US')}`, x, y + R + 1.6 * unit);
    g.restore();
  }

  #drawPlot(): void {
    const c = this.#plotCanvas;
    const { width, height } = this.#plot.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio, 2);
    const w = Math.round(width * dpr);
    const h = Math.round(height * dpr);
    if (w === 0 || h === 0) return;
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    const g = c.getContext('2d');
    const grid = this.#grid;
    const normal = this.#normal;
    if (!g || !grid || !normal) return;
    g.clearRect(0, 0, w, h);

    this.#paintDensity(grid);
    g.imageSmoothingEnabled = true;
    g.globalAlpha = this.#reveal;
    g.drawImage(this.#offscreen, 0, 0, w, h);
    g.globalAlpha = 1;

    const px = (p: Point) => p.x * w;
    const py = (p: Point) => (1 - p.y) * h;
    const unit = h / 60;
    this.#drawTicks(g, w, h, unit);

    // The ring
    if (this.#ringR > 0.05) {
      const pts = ring(normal, this.#ringR);
      g.save();
      g.shadowColor = '#febb97';
      g.shadowBlur = 1.6 * unit;
      g.strokeStyle = '#febb97';
      g.lineWidth = 0.45 * unit;
      g.setLineDash([1.6 * unit, 0.9 * unit]);
      g.lineDashOffset = -this.#now / 40;
      g.beginPath();
      pts.forEach((p, i) => {
        g[i ? 'lineTo' : 'moveTo'](px(p), py(p));
      });
      g.stroke();
      g.restore();
      const top = pts.reduce((a, b) => (b.y > a.y ? b : a));
      g.fillStyle = '#febb97';
      g.font = `700 ${String(2.6 * unit)}px 'Bai Jamjuree', sans-serif`;
      g.textAlign = 'center';
      g.fillText(`วง ${this.#ringR.toFixed(1)}σ`, px(top), Math.max(2.6 * unit, py(top) - unit));
    }
    if (this.#showBest && this.#best && this.#chosen) {
      const pts = ring(normal, this.#best.r);
      g.strokeStyle = withAlpha('#4fe3b0', 0.8);
      g.lineWidth = 0.3 * unit;
      g.beginPath();
      pts.forEach((p, i) => {
        g[i ? 'lineTo' : 'moveTo'](px(p), py(p));
      });
      g.stroke();
    }

    // The player's shots, on the map
    if (this.#showPlayed > 0) {
      g.globalAlpha = this.#showPlayed;
      for (const s of this.#played) {
        const x = px(s.t);
        const y = py(s.t);
        const r = 0.9 * unit;
        g.lineWidth = 0.3 * unit;
        if (s.state === 'hit') {
          g.strokeStyle = s.t.fraud ? FRAUD : GOOD;
          g.beginPath();
          g.moveTo(x - r, y - r);
          g.lineTo(x + r, y + r);
          g.moveTo(x + r, y - r);
          g.lineTo(x - r, y + r);
          g.stroke();
        } else {
          g.strokeStyle = FRAUD;
          g.beginPath();
          g.arc(x, y, r, 0, Math.PI * 2);
          g.stroke();
        }
      }
      g.globalAlpha = 1;
    }
  }

  /** Real values along the log axes, so "far" and "big" have numbers. */
  #drawTicks(g: CanvasRenderingContext2D, w: number, h: number, unit: number): void {
    // Dark halo so the labels read on top of the densest part of the cloud
    g.fillStyle = 'rgba(232,214,228,0.95)';
    g.strokeStyle = 'rgba(18,7,20,0.85)';
    g.lineWidth = 0.5 * unit;
    g.lineJoin = 'round';
    g.font = `600 ${String(1.9 * unit)}px 'Bai Jamjuree', sans-serif`;
    g.textBaseline = 'bottom';
    g.textAlign = 'left';
    for (const km of [1, 10, 100, 1000]) {
      const x = toPlot(km, 100).x * w;
      g.fillRect(x, h - 0.8 * unit, 1, 0.8 * unit);
      g.strokeText(`${km.toLocaleString('en-US')} กม.`, x + 0.4 * unit, h - unit);
      g.fillText(`${km.toLocaleString('en-US')} กม.`, x + 0.4 * unit, h - unit);
    }
    for (const baht of [100, 1000, 10_000, 100_000]) {
      const y = (1 - toPlot(1, baht).y) * h;
      g.fillRect(0, y, 0.8 * unit, 1);
      g.strokeText(`฿${baht.toLocaleString('en-US')}`, unit, y - 0.2 * unit);
      g.fillText(`฿${baht.toLocaleString('en-US')}`, unit, y - 0.2 * unit);
    }
  }

  /**
   * A million points as a density image: normal pink-white inside the ring, blue outside (good
   * customers blocked), fraud red (bright when flagged, dim when let through).
   */
  #paintDensity(grid: Density): void {
    const cells = this.#cellDistance;
    if (!cells) return;
    const r = Math.round(this.#ringR * 100);
    const reveal = Math.round(this.#reveal * 20);
    if (r === this.#imageRing && reveal === this.#imageReveal && this.#image) return;
    this.#imageRing = r;
    this.#imageReveal = reveal;
    if (!this.#image) {
      this.#offscreen.width = grid.w;
      this.#offscreen.height = grid.h;
      this.#image = new ImageData(grid.w, grid.h);
    }
    const px = this.#image.data;
    const logMax = Math.log1p(grid.max);
    const ringR = this.#ringR > 0.05 ? this.#ringR : Infinity;
    for (let k = 0; k < grid.w * grid.h; k++) {
      const n = grid.normal[k] ?? 0;
      const f = grid.fraud[k] ?? 0;
      const o = k * 4;
      if (n + f === 0) {
        px[o + 3] = 0;
        continue;
      }
      const out = (cells[k] ?? 0) > ringR;
      // Bright enough that a single transaction still shows
      const a = 0.35 + 0.65 * (Math.log1p(n + f) / logMax);
      let rgb: [number, number, number];
      if (f > n) rgb = out ? [255, 84, 112] : [150, 60, 80];
      else if (out) rgb = [63, 155, 224];
      else rgb = [255, 190, 220];
      px[o] = rgb[0];
      px[o + 1] = rgb[1];
      px[o + 2] = rgb[2];
      px[o + 3] = Math.round(255 * a);
    }
    this.#offscreen.getContext('2d')?.putImageData(this.#image, 0, 0);
  }
}

/** Distance (screen heights, aspect-corrected) from a ship to the laser segment a→b. */
function segmentDistance(p: Point, a: Point, b: Point): number {
  const k = 16 / 9;
  const ax = a.x * k;
  const bx = b.x * k;
  const qx = p.x * k;
  const dx = bx - ax;
  const dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  const t = len > 0 ? Math.min(1, Math.max(0, ((qx - ax) * dx + (p.y - a.y) * dy) / len)) : 0;
  return Math.hypot(qx - (ax + dx * t), p.y - (a.y + dy * t));
}

function withAlpha(hex: string, a: number): string {
  const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgba(${String(v[0])},${String(v[1])},${String(v[2])},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
}
