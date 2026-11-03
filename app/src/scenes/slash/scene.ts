import { setDigits } from '../../hud/digits';
import { askPose } from '../../hud/pose-prompt';
import { gestureConfig } from '../../config/gestures';
import type { IntentOf } from '../../input/intents';
import type { Beat } from '../../narrative/schema';
import { Animator, ease } from '../../viz/animator';
import type { SceneContext, SceneModule } from '../types';
import {
  busyAt,
  busyByHour,
  classify,
  CUP_COST,
  dynamicPlan,
  flatPlan,
  goldBand,
  HOURS,
  profit,
  seeded,
  slashProfit,
  tagPrice,
  type TagKind,
} from './model';
import './slash.css';

/** Gold = sell at this price · gray = below cost · red = nobody buys. Shape marks too. */
const COLOR: Record<TagKind, string> = {
  gold: '#ffc94d',
  loss: '#9a94a6',
  pricey: '#ff5470',
  cheap: '#ffc94d',
};
const LASER = '#fff1c2';
/** Tags fly in this part of the screen, left of the side panel and above the caption. */
const FIELD = { left: 0.06, right: 0.64, floor: 0.82 } as const;
const HIT_RADIUS = 0.07;
const STROKE_GAP_MS = 120;
const TRAIL_MS = 420;
const GRAVITY = 0.62;
const PLAY_SEC = 20;
/** Busy factor above which the 11.11 rush banner shows. */
const RUSH = 1.12;
/** How long the T-pose prompt waits (story time) before the AI goes anyway. */
const T_POSE_MS = 8000;

export function slashScene(chapterId: string) {
  return (ctx: SceneContext): SceneModule => new SlashScene(ctx, chapterId);
}

interface Tag {
  price: number;
  kind: TagKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  spin: number;
  angle: number;
  state: 'flying' | 'cut' | 'gone';
  /** Time since cut (ms), for the halves flying apart. */
  cutAge: number;
  cutAngle: number;
}

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
  coin: boolean;
}

interface Float {
  x: number;
  y: number;
  text: string;
  color: string;
  age: number;
}

type Mode = 'idle' | 'tutorial' | 'play' | 'over' | 'reveal';

/**
 * EP III — ศึก 11.11 ฟันป้ายราคา (Dynamic Pricing). Play: price tags fly up and the player
 * slashes the gold ones (a fast sweep = slap). A tag's color is computed from EP I's demand at
 * how busy the shop is right now, so in the rush the gold prices are higher. Reveal: the AI
 * prices every hour of the day for its crowd and beats the best single price.
 */
class SlashScene implements SceneModule {
  readonly id = 'p-price-slash';
  readonly #ctx: SceneContext;
  readonly #chapterId: string;
  readonly #anim = new Animator();
  readonly #random = seeded(11_11_2026);

  readonly #root = document.createElement('div');
  readonly #field: HTMLCanvasElement;
  readonly #side: HTMLElement;
  readonly #plotPanel: HTMLElement;
  readonly #rush: HTMLElement;

  #mode: Mode = 'idle';
  #now = 0;
  #playMs = 0;
  #spawnIn = 0;
  readonly #tags: Tag[] = [];
  readonly #sparks: Spark[] = [];
  readonly #floats: Float[] = [];
  readonly #trail: { x: number; y: number; t: number }[] = [];
  readonly #cursorPath: { x: number; y: number; t: number }[] = [];
  #lastSlap = -1e9;
  #targetAt = -1e9;
  #shake = 0;

  #gold = 0;
  #wrong = 0;
  #combo = 0;
  #profit = 0;
  readonly #dynamic = dynamicPlan();
  readonly #flat = flatPlan();

  readonly #off: (() => void)[] = [];

  constructor(ctx: SceneContext, chapterId: string) {
    this.#ctx = ctx;
    this.#chapterId = chapterId;
    this.#root.className = 'ps';
    this.#root.innerHTML = `
      <canvas class="ps-field"></canvas>
      <div class="ps-rush" aria-hidden="true"><b>11.11</b><span>ลูกค้าแห่เข้าร้าน!</span></div>
      <div class="hud-panel ps-plot"></div>
      <aside class="hud-panel ps-side"></aside>`;
    const q = (sel: string) => this.#root.querySelector(sel) as HTMLElement;
    this.#field = q('.ps-field') as HTMLCanvasElement;
    this.#side = q('.ps-side');
    this.#plotPanel = q('.ps-plot');
    this.#rush = q('.ps-rush');
    ctx.hud.append(this.#root);
    this.#scoreboard();

    this.#off.push(
      ctx.bus.on('cursor', (c) => {
        this.#onCursor(c);
      }),
      ctx.bus.on('slap', (s) => {
        this.#onSlap(s);
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
    return {
      hits: this.#gold,
      profit: this.#profit.toLocaleString('en-US'),
      aiProfit: Math.round(this.#dynamic.profit).toLocaleString('en-US'),
      flatProfit: Math.round(this.#flat.profit).toLocaleString('en-US'),
      gain: Math.round((this.#dynamic.profit / this.#flat.profit - 1) * 100),
    };
  }

  result() {
    const accuracy = this.#gold / Math.max(1, this.#gold + this.#wrong);
    const volume = Math.min(1, this.#gold / 10);
    const style =
      this.#wrong > this.#gold
        ? { 'risk-taker': 1 }
        : accuracy >= 0.8
          ? { analyst: 1 }
          : { intuitive: 1 };
    return { chapterId: this.#chapterId, score: 0.5 * accuracy + 0.5 * volume, style };
  }

  dispose(): void {
    this.#anim.cancel();
    delete document.body.dataset['slashTarget'];
    delete document.body.dataset['slashGold'];
    for (const off of this.#off) off();
  }

  update(dtMs: number): void {
    this.#now += dtMs;
    this.#anim.update(dtMs);
    if (this.#mode === 'play') this.#playMs += dtMs;
    this.#publishTarget();
    this.#spawn(dtMs);
    this.#move(dtMs);
    if (this.#mode === 'play') this.#liveBusy();
    this.#draw();
  }

  onBeat(beat: Beat): void {
    switch (beat.type) {
      case 'tutorial':
        this.#mode = 'tutorial';
        this.#spawnIn = 0;
        break;
      case 'play':
        this.#mode = 'play';
        this.#combo = 0;
        this.#spawnIn = 0;
        break;
      case 'reveal':
        this.#mode = 'over';
        this.#rush.classList.remove('is-on');
        this.#scoreboard();
        break;
      case 'lesson':
        this.#plotPanel.querySelector('.hud-eyebrow')?.replaceChildren('Lesson · Dynamic Pricing');
        break;
      default:
        break;
    }
  }

  onCue(cue: string): boolean {
    if (cue === 't-pose') {
      // The player hands over to the AI with a T-pose (research 025); it goes on by itself after
      // a while so nobody gets stuck
      void askPose(
        this.#ctx.hud,
        this.#ctx.bus,
        [{ pose: 't-pose', label: 'กางแขน ปล่อยพลัง AI!' }],
        (ms, step) => this.#anim.tween(ms, step, { ease: ease.linear }),
        T_POSE_MS,
      ).then(() => {
        this.#ctx.signal('continue');
      });
      return true;
    }
    if (cue !== 'ai-day') return false;
    void this.#runDay().then(() => {
      this.#ctx.signal('continue');
    });
    return true;
  }

  // ---------- Tags ----------

  #busy(): number {
    return this.#mode === 'play' ? busyAt(Math.min(1, this.#playMs / (PLAY_SEC * 1000))) : 0.7;
  }

  #launch(price: number, x: number, vy: number, vx: number): void {
    this.#tags.push({
      price,
      kind: classify(price, this.#busy()),
      x,
      y: FIELD.floor,
      vx,
      vy,
      spin: (this.#random() - 0.5) * 0.5,
      angle: (this.#random() - 0.5) * 0.3,
      state: 'flying',
      cutAge: 0,
      cutAngle: 0,
    });
  }

  #spawn(dtMs: number): void {
    this.#spawnIn -= dtMs;
    if (this.#spawnIn > 0) return;
    const r = this.#random;
    switch (this.#mode) {
      case 'tutorial': {
        // One slow gold tag at a time, peaking mid-field: practise until the first cut
        if (!this.#tags.some((t) => t.state === 'flying')) {
          const { low, high } = goldBand(this.#busy());
          this.#launch(Math.round((low + high) / 2), 0.34, -0.8, 0.02);
        }
        this.#spawnIn = 300;
        break;
      }
      case 'play': {
        const t = this.#playMs / 1000;
        const rate = 1.1 + 0.11 * t;
        const x = FIELD.left + 0.05 + r() * (FIELD.right - FIELD.left - 0.1);
        // Toss toward the middle, high enough to peak in the top half
        const vx = (0.35 - x) * 0.35 + (r() - 0.5) * 0.08;
        this.#launch(tagPrice(this.#busy(), r), x, -(0.72 + r() * 0.14), vx);
        this.#spawnIn = 1000 / rate;
        break;
      }
      default:
        this.#spawnIn = 1e9;
    }
  }

  #move(dtMs: number): void {
    const dt = dtMs / 1000;
    for (const t of this.#tags) {
      if (t.state === 'cut') t.cutAge += dtMs;
      if (t.state === 'gone') continue;
      t.vy += GRAVITY * dt;
      t.x += t.vx * dt;
      t.y += t.vy * dt;
      t.angle += t.spin * dt;
      if (t.y > FIELD.floor + 0.08 && t.vy > 0) {
        if (t.state === 'flying' && t.kind === 'gold' && this.#mode === 'play') this.#combo = 0;
        t.state = 'gone';
      }
      if (t.state === 'cut' && t.cutAge > 900) t.state = 'gone';
    }
    for (let i = this.#tags.length - 1; i >= 0; i--) {
      if (this.#tags[i]?.state === 'gone') this.#tags.splice(i, 1);
    }
    for (const p of this.#sparks) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= Math.exp(-dt * 2.5);
      p.vy = p.vy * Math.exp(-dt * 2.5) + (p.coin ? 0.9 : 0.3) * dt;
      p.life -= dt * 1.4;
    }
    for (let i = this.#sparks.length - 1; i >= 0; i--) {
      if ((this.#sparks[i]?.life ?? 0) <= 0) this.#sparks.splice(i, 1);
    }
    for (const f of this.#floats) f.age += dtMs;
    for (let i = this.#floats.length - 1; i >= 0; i--) {
      if ((this.#floats[i]?.age ?? 0) > 1100) this.#floats.splice(i, 1);
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

  /** The blade covers the whole sweep, as in the old fraud scene (research 020). */
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
      for (const tag of this.#tags) {
        if (tag.state === 'flying' && segmentDistance(tag, from, p) <= HIT_RADIUS) {
          this.#cut(tag, Math.atan2(p.y - from.y, (p.x - from.x) * (16 / 9)));
        }
      }
      const point = { x: p.x, y: p.y, t: this.#now };
      this.#trail.push(point);
      from = point;
    }
  }

  #cut(tag: Tag, angle: number): void {
    tag.state = 'cut';
    tag.cutAge = 0;
    tag.cutAngle = angle;
    const counts = this.#mode === 'play';
    const earned = slashProfit(tag.price, this.#busy());
    if (tag.kind === 'gold') {
      this.#burst(tag.x, tag.y, COLOR.gold, 18, true);
      this.#shake = Math.max(this.#shake, 0.4);
      this.#float(tag, `+฿${earned.toLocaleString('en-US')}`, COLOR.gold);
      if (counts) {
        this.#gold++;
        this.#combo++;
      }
      if (this.#mode === 'tutorial') this.#ctx.signal('gesture');
    } else {
      const loss = tag.kind === 'loss';
      this.#burst(tag.x, tag.y, COLOR[tag.kind], 10, false);
      this.#float(
        tag,
        loss ? `−฿${Math.abs(earned).toLocaleString('en-US')}` : 'ลูกค้าหนี!',
        COLOR[tag.kind],
      );
      if (counts) {
        this.#wrong++;
        this.#combo = 0;
      }
    }
    if (counts) {
      this.#profit += earned;
      this.#scoreboard();
    }
  }

  #burst(x: number, y: number, color: string, n: number, coin: boolean): void {
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.4;
      const v = 0.2 + Math.random() * 0.5;
      this.#sparks.push({
        x,
        y,
        vx: (Math.cos(a) * v) / (16 / 9),
        vy: Math.sin(a) * v,
        life: 0.8 + Math.random() * 0.4,
        color,
        coin,
      });
    }
  }

  #float(tag: Tag, text: string, color: string): void {
    this.#floats.push({ x: tag.x, y: tag.y - 0.05, text, color, age: 0 });
  }

  /** The highest gold tag on screen as "x,y" on `body[data-slash-target]`, for the E2E player. */
  #publishTarget(): void {
    if (this.#now - this.#targetAt < 100) return;
    this.#targetAt = this.#now;
    let best: Tag | null = null;
    for (const t of this.#tags) {
      if (t.state === 'flying' && t.kind === 'gold' && t.y < 0.7 && (!best || t.y < best.y))
        best = t;
    }
    const value = best ? `${best.x.toFixed(3)},${best.y.toFixed(3)}` : '';
    if (document.body.dataset['slashTarget'] !== value)
      document.body.dataset['slashTarget'] = value;
  }

  // ---------- Side panel ----------

  #liveBusy(): void {
    const busy = this.#busy();
    this.#rush.classList.toggle('is-on', busy > RUSH);
    const meter = this.#side.querySelector<HTMLElement>('.ps-busy i');
    if (meter) meter.style.transform = `scaleX(${String(Math.min(1, (busy - 0.5) / 0.9))})`;
    const band = this.#side.querySelector<HTMLElement>('.ps-band');
    if (band) {
      const { low, high } = goldBand(busy);
      band.textContent = `฿${String(Math.round(low))}–${String(Math.round(high))}`;
    }
  }

  #scoreboard(): void {
    const combo = this.#combo >= 2 ? `<p class="ps-combo">COMBO ×${String(this.#combo)}</p>` : '';
    this.#side.innerHTML = `
      <p class="hud-eyebrow">11.11 · Price slash</p>
      <p class="hud-label-th">กำไรของท่าน</p>
      <span class="hud-number ps-profit"></span>
      <div class="ps-stat"><i class="is-gold" aria-hidden="true"></i><p class="hud-label-th">ฟันป้ายทอง</p><span class="hud-number">${String(this.#gold)}</span></div>
      <div class="ps-stat"><i class="is-wrong" aria-hidden="true"></i><p class="hud-label-th">ฟันผิดป้าย</p><span class="hud-number">${String(this.#wrong)}</span></div>
      ${combo}
      <div class="ps-busy"><p class="hud-label-th">ลูกค้าตอนนี้</p><div><i></i></div></div>
      <p class="ps-help">ราคาทองตอนนี้ <b class="ps-band"></b></p>
      <ul class="ps-legend">
        <li><i class="is-gold"></i>ทอง = ขายราคานี้</li>
        <li><i class="is-loss"></i>เทา = ต่ำกว่าทุน ฿${String(CUP_COST)}</li>
        <li><i class="is-pricey"></i>แดง = แพงจนไม่มีใครซื้อ</li>
      </ul>`;
    const n = this.#side.querySelector('.ps-profit') as HTMLElement;
    setDigits(
      n,
      `${this.#profit < 0 ? '−' : ''}฿${Math.abs(this.#profit).toLocaleString('en-US')}`,
    );
    document.body.dataset['slashGold'] = String(this.#gold);
    this.#liveBusy();
  }

  // ---------- Reveal: the AI prices the whole day ----------

  async #runDay(): Promise<void> {
    this.#mode = 'reveal';
    this.#tags.length = 0;
    const W = 1500;
    const H = 640;
    const left = 120;
    const right = 60;
    const top = 50;
    const base = H - 90;
    const n = HOURS.length;
    const slot = (W - left - right) / n;
    const cx = (i: number) => left + slot * (i + 0.5);
    const maxBusy = Math.max(...HOURS.map(busyByHour));
    const barH = (b: number) => (b / maxBusy) * (base - top) * 0.55;
    const priceMax = 140;
    const py = (p: number) => base - (p / priceMax) * (base - top);
    const flatPrice = this.#flat.prices[0] ?? 0;
    const dyn = this.#dynamic.prices;
    const path = dyn
      .map((p, i) => `${i ? 'L' : 'M'}${cx(i).toFixed(1)},${py(p).toFixed(1)}`)
      .join(' ');
    this.#plotPanel.innerHTML = `
      <p class="hud-eyebrow">AI · ราคาทุกชั่วโมง วัน 11.11</p>
      <svg class="ps-day" viewBox="0 0 ${String(W)} ${String(H)}">
        <line x1="${String(left)}" y1="${String(base)}" x2="${String(W - right)}" y2="${String(base)}" class="ps-axis" />
        ${HOURS.map((h, i) => `<rect class="ps-bar" x="${(cx(i) - slot * 0.36).toFixed(1)}" width="${(slot * 0.72).toFixed(1)}" y="${(base - barH(busyByHour(h))).toFixed(1)}" height="${barH(busyByHour(h)).toFixed(1)}" />`).join('')}
        ${HOURS.map((h, i) => (i % 2 === 0 ? `<text class="ps-tick" x="${cx(i).toFixed(1)}" y="${String(base + 44)}" text-anchor="middle">${String(h).padStart(2, '0')}:00</text>` : '')).join('')}
        <line class="ps-flat" x1="${String(left)}" x2="${String(W - right)}" y1="${py(flatPrice).toFixed(1)}" y2="${py(flatPrice).toFixed(1)}" />
        <text class="ps-flat-label" x="${cx(9).toFixed(1)}" y="${(py(flatPrice) - 18).toFixed(1)}" text-anchor="middle">ราคาเดียวทั้งวัน ฿${String(flatPrice)}</text>
        <path class="ps-ai" d="${path}" />
        ${dyn.map((p, i) => `<g class="ps-ai-dot" transform="translate(${cx(i).toFixed(1)} ${py(p).toFixed(1)})"><circle r="10" /><text y="-22" text-anchor="middle">฿${String(p)}</text></g>`).join('')}
        <text class="ps-legend-bars" x="${String(left)}" y="${String(top)}">เส้นทอง = ราคาที่ AI ตั้ง · แท่ง = จำนวนลูกค้า</text>
      </svg>`;
    this.#plotPanel.classList.add('is-shown');
    this.#side.innerHTML = `
      <p class="hud-eyebrow">AI · Dynamic pricing</p>
      <p class="hud-label-th">ราคาเดียวทั้งวัน</p>
      <span class="hud-number ps-flat-sum"></span>
      <p class="hud-label-th">AI ปรับทุกชั่วโมง</p>
      <span class="hud-number ps-ai-sum"></span>
      <p class="ps-gain" hidden></p>`;
    const flatSum = this.#side.querySelector('.ps-flat-sum') as HTMLElement;
    const aiSum = this.#side.querySelector('.ps-ai-sum') as HTMLElement;
    const money = (v: number) => `฿${Math.round(v).toLocaleString('en-US')}`;
    setDigits(flatSum, money(this.#flat.profit));
    setDigits(aiSum, '฿0');

    const bars = [...this.#plotPanel.querySelectorAll<SVGRectElement>('.ps-bar')];
    const dots = [...this.#plotPanel.querySelectorAll<SVGGElement>('.ps-ai-dot')];
    const line = this.#plotPanel.querySelector('.ps-ai') as SVGPathElement;
    const length = line.getTotalLength();
    line.style.strokeDasharray = String(length);
    line.style.strokeDashoffset = String(length);
    for (const d of dots) d.style.opacity = '0';
    for (const b of bars) {
      b.style.transformOrigin = `0 ${String(base)}px`;
      b.style.transform = 'scaleY(0)';
    }
    // Customers by hour grow in, then the AI's price follows them hour by hour
    await this.#anim.tween(
      900,
      (t) => {
        bars.forEach((b, i) => {
          const k = Math.min(1, Math.max(0, t * 1.6 - i * 0.04));
          b.style.transform = `scaleY(${String(ease.outExpo(k))})`;
        });
      },
      { ease: ease.linear },
    );
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const hour = HOURS[i] ?? 0;
      sum += profit(dyn[i] ?? 0, busyByHour(hour));
      const dot = dots[i];
      await this.#anim.tween(170, (t) => {
        line.style.strokeDashoffset = String(length * (1 - (i + t) / Math.max(1, n - 1)));
        if (dot) dot.style.opacity = String(t);
      });
      setDigits(aiSum, money(sum));
    }
    const gain = this.#side.querySelector('.ps-gain') as HTMLElement;
    gain.textContent = `+${String(this.vars().gain)}% จากราคาเดียว`;
    gain.hidden = false;
    await this.#anim.wait(500);
  }

  // ---------- Drawing ----------

  #draw(): void {
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
    const unit = h / 100;

    for (const t of this.#tags) drawTag(g, t, w, h, unit);

    g.globalCompositeOperation = 'lighter';
    for (const p of this.#sparks) {
      g.fillStyle = withAlpha(p.color, Math.max(0, Math.min(1, p.life)));
      g.beginPath();
      if (p.coin) {
        g.ellipse(
          p.x * w,
          p.y * h,
          0.9 * unit,
          0.9 * unit * Math.abs(Math.sin(p.life * 9)) + 0.15 * unit,
          0,
          0,
          Math.PI * 2,
        );
      } else {
        g.arc(p.x * w, p.y * h, 0.4 * unit * (0.5 + p.life), 0, Math.PI * 2);
      }
      g.fill();
    }

    // Blade trail
    for (let i = 1; i < this.#trail.length; i++) {
      const a = this.#trail[i - 1];
      const b = this.#trail[i];
      if (!a || !b || b.t - a.t > STROKE_GAP_MS) continue;
      const life = 1 - (this.#now - b.t) / TRAIL_MS;
      if (life <= 0) continue;
      for (const [width, color] of [
        [3.6 * life, withAlpha('#ffb648', 0.25 * life)],
        [1.5 * life, withAlpha('#ffd98a', 0.6 * life)],
        [0.5 + 0.4 * life, withAlpha(LASER, life)],
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
    g.globalCompositeOperation = 'source-over';

    // Floating "+฿1,070" / "ลูกค้าหนี!"
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const f of this.#floats) {
      const t = f.age / 1100;
      g.globalAlpha = 1 - t * t;
      g.font = `800 ${String(Math.round(4.4 * unit))}px 'Bai Jamjuree', sans-serif`;
      g.lineWidth = 0.5 * unit;
      g.strokeStyle = 'rgba(10,4,14,0.85)';
      g.fillStyle = f.color;
      const y = (f.y - 0.08 * ease.outExpo(t)) * h;
      g.strokeText(f.text, f.x * w, y);
      g.fillText(f.text, f.x * w, y);
    }
    g.globalAlpha = 1;
  }
}

/** A price tag: rounded card with a string hole; gold has a star, gray a minus, red a cross. */
function drawTag(g: CanvasRenderingContext2D, t: Tag, w: number, h: number, unit: number): void {
  const tw = 16 * unit;
  const th = 8.6 * unit;
  const color = COLOR[t.kind];
  const drawHalf = (side: -1 | 1 | 0) => {
    g.save();
    g.translate(t.x * w, t.y * h);
    if (side !== 0) {
      const k = t.cutAge / 900;
      const n = t.cutAngle + Math.PI / 2;
      g.translate(Math.cos(n) * side * k * 6 * unit, Math.sin(n) * side * k * 6 * unit);
      g.globalAlpha = Math.max(0, 1 - k);
    }
    g.rotate(t.angle + (side !== 0 ? side * (t.cutAge / 900) * 0.6 : 0));
    if (side !== 0) {
      // Keep one side of the cut line
      g.beginPath();
      const a = t.cutAngle - t.angle;
      const nx = Math.cos(a + Math.PI / 2) * side;
      const ny = Math.sin(a + Math.PI / 2) * side;
      const R = tw * 2;
      g.moveTo(Math.cos(a) * R, Math.sin(a) * R);
      g.lineTo(Math.cos(a) * R + nx * R, Math.sin(a) * R + ny * R);
      g.lineTo(-Math.cos(a) * R + nx * R, -Math.sin(a) * R + ny * R);
      g.lineTo(-Math.cos(a) * R, -Math.sin(a) * R);
      g.closePath();
      g.clip();
    }
    g.shadowColor = color;
    g.shadowBlur = (t.kind === 'gold' ? 3 : 1.4) * unit;
    g.fillStyle = 'rgba(20,8,24,0.92)';
    g.strokeStyle = color;
    g.lineWidth = 0.55 * unit;
    roundRect(g, -tw / 2, -th / 2, tw, th, 1.6 * unit);
    g.fill();
    g.stroke();
    g.shadowBlur = 0;
    // String hole
    g.beginPath();
    g.arc(-tw / 2 + 2 * unit, 0, 0.8 * unit, 0, Math.PI * 2);
    g.stroke();
    // Mark
    const mx = -tw / 2 + 4.6 * unit;
    g.fillStyle = color;
    g.strokeStyle = color;
    g.lineWidth = 0.6 * unit;
    if (t.kind === 'gold' || t.kind === 'cheap') star(g, mx, 0, 1.5 * unit);
    else if (t.kind === 'loss') {
      g.beginPath();
      g.moveTo(mx - 1.2 * unit, 0);
      g.lineTo(mx + 1.2 * unit, 0);
      g.stroke();
    } else {
      g.beginPath();
      g.moveTo(mx - 1.1 * unit, -1.1 * unit);
      g.lineTo(mx + 1.1 * unit, 1.1 * unit);
      g.moveTo(mx + 1.1 * unit, -1.1 * unit);
      g.lineTo(mx - 1.1 * unit, 1.1 * unit);
      g.stroke();
    }
    g.font = `800 ${String(Math.round(3.8 * unit))}px Orbitron, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = t.kind === 'loss' ? '#d8d2e2' : '#fff';
    g.fillText(`฿${String(t.price)}`, 2.2 * unit, 0.3 * unit);
    g.restore();
  };
  if (t.state === 'cut') {
    drawHalf(-1);
    drawHalf(1);
  } else {
    drawHalf(0);
  }
}

function roundRect(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function star(g: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r : r * 0.45;
    g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  g.closePath();
  g.fill();
}

function withAlpha(hex: string, a: number): string {
  const v = parseInt(hex.slice(1), 16);
  return `rgba(${String((v >> 16) & 255)},${String((v >> 8) & 255)},${String(v & 255)},${a.toFixed(3)})`;
}

function segmentDistance(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
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
