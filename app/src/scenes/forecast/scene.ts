import { setDigits } from '../../hud/digits';
import type { IntentOf } from '../../input/intents';
import type { Beat } from '../../narrative/schema';
import { Animator, ease } from '../../viz/animator';
import type { SceneContext, SceneModule } from '../types';
import {
  accuracy,
  AHEAD,
  BOX,
  completeGuess,
  FIRST_YEAR,
  forecast,
  HISTORY,
  MONEY,
  MONTHS,
  orderAt,
  saleDay,
  sales,
  trendAt,
  type SaleDay,
} from './model';
import './forecast.css';

const PLAYER = '#f6629e';
const AI = '#febb97';
const ACTUAL = '#fff6fa';
const YEARS = ['#e0428a', '#c07a26', '#3f9be0'] as const;
/**
 * Share of the chart width for the three years of history; the future gets the rest (38%), wide
 * enough to draw in and to label every month (an even split left 25%, research 021).
 */
const HISTORY_W = 0.62;
/** Top of the value axis (pieces) and its gridlines. */
const Y_MAX = 40_000;
const Y_TICKS = [10_000, 20_000, 30_000, 40_000] as const;
/** The play ends early this long after the last stroke once every month is drawn. */
const DONE_AFTER_MS = 2500;
const ORDER_MS = 10_000;
/** "Just right": within this much of demand, either way. */
const JUST_RIGHT = 2 * BOX;

export function forecastScene(chapterId: string) {
  return (ctx: SceneContext): SceneModule => new ForecastScene(ctx, chapterId);
}

type Mode = 'idle' | 'history' | 'draw' | 'reveal' | 'order' | 'sale';

/**
 * EPISODE V — พยากรณ์ 11.11 (Time-Series Forecasting). Play: three years of sales stream in; the
 * player draws the next twelve months with their arm (the pen is the cursor) and watches their
 * 11.11 stock pile up. Reveal: the AI builds its forecast layer by layer in front of them — the
 * trend, then the three years folded on top of each other to find the season, then trend ×
 * season with an uncertainty band — and the real year draws in slowly, gaps glowing red. Play
 * again: the player sizes the 11.11 order with their hand, and the sale day runs: customers
 * take boxes until the shelves run dry or boxes are left over (research 021).
 */
class ForecastScene implements SceneModule {
  readonly id = 'h-forecast';
  readonly #ctx: SceneContext;
  readonly #chapterId: string;
  readonly #anim = new Animator();
  readonly #series = sales();
  readonly #ai = forecast(this.#series.history);

  readonly #root = document.createElement('div');
  readonly #plot: HTMLElement;
  readonly #canvas: HTMLCanvasElement;
  readonly #side: HTMLElement;
  readonly #eyebrow: HTMLElement;

  #mode: Mode = 'idle';
  #now = 0;
  /** History points shown, 0..HISTORY (fractional while streaming in). */
  #shown = 0;
  /** 0..1: the future zone opens. */
  #future = 0;
  readonly #drawn: (number | null)[] = new Array<number | null>(AHEAD).fill(null);
  #lastDraw: { mf: number; value: number } | null = null;
  #lastStrokeAt = -1e9;
  #doneSignalled = false;
  #tutorialMonths = new Set<number>();
  #inTutorial = false;
  #guess: number[] | null = null;

  // Reveal layers (0..1 each)
  #playerGlow = 0;
  #trend = 0;
  #fold = 0;
  #foldMark = 0;
  #aiShape = 0;
  #band = 0;
  #actual = 0;
  #playerAcc = 0;
  #aiAcc = 0;

  // Order and sale day
  #controlling = false;
  #level = 0.4;
  #order = 0;
  #sale: SaleDay | null = null;
  #saleT = -1;
  #warehouse = 0;

  readonly #off: (() => void)[] = [];

  constructor(ctx: SceneContext, chapterId: string) {
    this.#ctx = ctx;
    this.#chapterId = chapterId;
    this.#root.className = 'fc';
    this.#root.innerHTML = `
      <div class="hud-panel fc-plot">
        <p class="hud-eyebrow">Sales · 3 years</p>
        <p class="fc-axis fc-axis-y">↑ ยอดขาย (ชิ้น / เดือน)</p>
        <div class="fc-area"><canvas></canvas></div>
      </div>
      <aside class="hud-panel fc-side"></aside>`;
    const q = (sel: string) => this.#root.querySelector(sel) as HTMLElement;
    this.#plot = q('.fc-area');
    this.#canvas = this.#plot.querySelector('canvas') as HTMLCanvasElement;
    this.#side = q('.fc-side');
    this.#eyebrow = q('.fc-plot .hud-eyebrow');
    ctx.hud.append(this.#root);
    this.#sideHistory();

    this.#off.push(
      ctx.bus.on('draw', (d) => {
        this.#onDraw(d);
      }),
      ctx.bus.on('raise', (r) => {
        if (this.#controlling) this.#level = r.level;
      }),
    );
  }

  ownsLesson(): boolean {
    return true;
  }

  /** The hand sets the order size: no pointing cursor then. While drawing, the cursor is the pen. */
  showCursor(): boolean {
    return !this.#controlling && this.#mode !== 'sale';
  }

  setFade(value: number): void {
    this.#ctx.hud.style.opacity = String(value);
  }

  vars() {
    const sale = this.#sale;
    return {
      playerAcc: Math.round(this.#playerAcc),
      aiAcc: Math.round(this.#aiAcc),
      beatAi: this.#playerAcc > this.#aiAcc,
      sold: sale?.sold ?? 0,
      short: sale?.short ?? 0,
      leftover: sale?.leftover ?? 0,
      stockout: sale !== null && sale.short > JUST_RIGHT,
      overstock: sale !== null && sale.leftover > JUST_RIGHT,
      justRight: sale !== null && sale.short <= JUST_RIGHT && sale.leftover <= JUST_RIGHT,
    };
  }

  result() {
    const sale = this.#sale;
    const orderScore = sale ? Math.max(0, sale.profit / sale.best) : 0.5;
    const style =
      this.#playerAcc > this.#aiAcc
        ? { analyst: 1 }
        : sale && sale.leftover > JUST_RIGHT
          ? { 'risk-taker': 1 }
          : { intuitive: 1 };
    return {
      chapterId: this.#chapterId,
      score: 0.5 * (this.#playerAcc / 100) + 0.5 * orderScore,
      style,
    };
  }

  dispose(): void {
    this.#anim.cancel();
    for (const off of this.#off) off();
    delete document.body.dataset['forecastDrawn'];
  }

  update(dtMs: number): void {
    this.#now += dtMs;
    this.#anim.update(dtMs);
    if (this.#controlling) {
      const order = orderAt(this.#level, this.#ai.mean[0] ?? 0);
      if (order !== this.#order) {
        this.#order = order;
        this.#sideOrder();
      }
    }
    if (
      this.#mode === 'draw' &&
      !this.#inTutorial &&
      !this.#doneSignalled &&
      this.#drawn.every((v) => v !== null) &&
      this.#now - this.#lastStrokeAt > DONE_AFTER_MS
    ) {
      this.#doneSignalled = true;
      this.#ctx.signal('finished');
    }
    this.#draw();
  }

  onBeat(beat: Beat): void {
    switch (beat.type) {
      case 'tutorial':
        this.#mode = 'draw';
        this.#inTutorial = true;
        this.#shown = HISTORY;
        void this.#anim.tween(900, (t) => (this.#future = t));
        this.#sideDraw();
        break;
      case 'play':
        this.#mode = 'draw';
        this.#inTutorial = false;
        this.#shown = HISTORY;
        this.#future = 1;
        this.#sideDraw();
        break;
      case 'reveal':
        this.#mode = 'reveal';
        this.#guess = completeGuess(this.#drawn, this.#series.history.at(-1) ?? 0);
        this.#future = 1;
        break;
      case 'lesson':
        this.#eyebrow.textContent = 'Lesson · Time-Series Forecasting';
        this.#saleT = -1;
        this.#warehouse = 0;
        this.#root.classList.remove('is-sale');
        this.#sideLesson();
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
      case 'history':
        return run(this.#streamHistory());
      case 'player-line':
        return run(this.#showPlayer());
      case 'ai-trend':
        return run(this.#showTrend());
      case 'ai-fold':
        return run(this.#foldYears());
      case 'ai-line':
        return run(this.#showAi());
      case 'actual-line':
        return run(this.#showActual());
      case 'order':
        return run(this.#letPlayerOrder());
      case 'sale-day':
        return run(this.#runSaleDay());
      default:
        return false;
    }
  }

  // ---------- Mission: three years stream in ----------

  async #streamHistory(): Promise<void> {
    this.#mode = 'history';
    await this.#anim.tween(
      4200,
      (t) => {
        this.#shown = t * HISTORY;
        this.#sideHistory();
      },
      { ease: ease.linear },
    );
    this.#shown = HISTORY;
    this.#sideHistory();
    await this.#anim.wait(500);
  }

  #sideHistory(): void {
    const i = Math.max(0, Math.min(HISTORY - 1, Math.floor(this.#shown - 0.001)));
    const total = this.#series.history.slice(0, Math.ceil(this.#shown)).reduce((s, v) => s + v, 0);
    if (!this.#side.querySelector('.fc-month')) {
      this.#side.innerHTML = `
        <p class="hud-eyebrow">Sales log</p>
        <p class="fc-month"></p>
        <p class="hud-label-th">ขายไปแล้วรวม</p>
        <span class="hud-number fc-total"></span>
        <p class="fc-sub">ชิ้น</p>`;
    }
    const m = this.#side.querySelector('.fc-month') as HTMLElement;
    m.textContent = this.#shown > 0 ? monthLabel(i) : '';
    setDigits(this.#side.querySelector('.fc-total') as HTMLElement, total.toLocaleString('en-US'));
  }

  // ---------- Play: draw the next twelve months ----------

  /**
   * The stroke is read where it crosses each month's center, so a spike drawn up and straight
   * back down keeps its peak (reading the last value inside each column flattened it to half,
   * research 021). Holding the pen still near a center also sets that month.
   */
  #onDraw(d: IntentOf<'draw'>): void {
    if (this.#mode !== 'draw') return;
    const at = this.#toChart(d.x, d.y);
    if (d.phase === 'end' || !at) {
      this.#lastDraw = null;
      return;
    }
    const mf = futureMonthAt(at.x);
    const value = Math.max(0, Math.min(Y_MAX, at.y * Y_MAX));
    const prev = d.phase === 'move' ? this.#lastDraw : null;
    if (prev && prev.mf !== mf) {
      const lo = Math.max(0, Math.ceil(Math.min(prev.mf, mf)));
      const hi = Math.min(AHEAD - 1, Math.floor(Math.max(prev.mf, mf)));
      for (let m = lo; m <= hi; m++) {
        this.#setMonth(m, prev.value + ((value - prev.value) * (m - prev.mf)) / (mf - prev.mf));
      }
    }
    const near = Math.round(mf);
    if (near >= 0 && near < AHEAD && Math.abs(mf - near) < 0.3) this.#setMonth(near, value);
    this.#lastDraw = { mf, value };
    if (mf > -0.5) this.#lastStrokeAt = this.#now;
  }

  #setMonth(month: number, value: number): void {
    this.#drawn[month] = value;
    if (this.#inTutorial) {
      this.#tutorialMonths.add(month);
      if (this.#tutorialMonths.size >= 2) this.#ctx.signal('gesture');
    }
    const count = this.#drawn.filter((v) => v !== null).length;
    document.body.dataset['forecastDrawn'] = String(count);
    this.#sideDraw();
  }

  #sideDraw(): void {
    const count = this.#drawn.filter((v) => v !== null).length;
    const nov = this.#drawn[0];
    if (!this.#side.querySelector('.fc-stock')) {
      this.#side.innerHTML = `
        <p class="hud-eyebrow">Your forecast</p>
        <p class="fc-help">ยกแขนชี้ = ปากกา<br />ลากในช่อง <b>อนาคต</b> · ทับใหม่ได้</p>
        <div class="fc-filled"><i></i></div>
        <p class="fc-sub fc-filled-text"></p>
        <p class="hud-label-th">ท่านทาย 11.11</p>
        <span class="hud-number fc-nov"></span>
        <div class="fc-stock" aria-hidden="true"></div>`;
    }
    (this.#side.querySelector('.fc-filled i') as HTMLElement).style.transform =
      `scaleX(${String(count / AHEAD)})`;
    (this.#side.querySelector('.fc-filled-text') as HTMLElement).textContent =
      `วาดแล้ว ${String(count)} / ${String(AHEAD)} เดือน`;
    setDigits(
      this.#side.querySelector('.fc-nov') as HTMLElement,
      nov === null || nov === undefined ? '—' : roundTo(nov, 100).toLocaleString('en-US'),
    );
    this.#stack(this.#side.querySelector('.fc-stock') as HTMLElement, nov ?? 0);
  }

  /** The warehouse as stacked boxes, one per `BOX` pieces. */
  #stack(el: HTMLElement, pieces: number, mark?: { low: number; high: number }): void {
    const boxes = Math.round(pieces / BOX);
    if (el.dataset['boxes'] === String(boxes)) return;
    el.dataset['boxes'] = String(boxes);
    const cells: string[] = [];
    for (let i = 0; i < boxes; i++) cells.push('<i></i>');
    const band = mark
      ? `<b class="fc-band-mark" style="--lo:${String(mark.low / BOX)};--hi:${String(mark.high / BOX)}"></b>`
      : '';
    el.innerHTML = `${cells.join('')}${band}`;
  }

  // ---------- Reveal ----------

  async #showPlayer(): Promise<void> {
    this.#eyebrow.textContent = 'Your forecast vs AI';
    await this.#anim.tween(900, (t) => (this.#playerGlow = t));
    this.#sideStep('ท่านทาย', 'เส้นชมพูคือคำทายของท่าน เดือนที่ไม่ได้วาด ใช้ค่าข้างเคียง');
    await this.#anim.wait(700);
  }

  async #showTrend(): Promise<void> {
    const perMonth = Math.round(this.#ai.trend.b);
    this.#sideStep(
      'AI · ขั้นที่ 1 · แนวโน้ม',
      `ยอดโตขึ้นราว <b>${perMonth.toLocaleString('en-US')}</b> ชิ้นทุกเดือน`,
    );
    await this.#anim.tween(1800, (t) => (this.#trend = t), { ease: ease.inOutCubic });
    await this.#anim.wait(500);
  }

  async #foldYears(): Promise<void> {
    this.#sideStep('AI · ขั้นที่ 2 · ฤดูกาล', 'พับ 3 ปีมาซ้อนกัน แล้วดูว่าเดือนไหนสูงกว่าแนวโน้ม');
    await this.#anim.tween(1600, (t) => (this.#fold = t), { ease: ease.inOutCubic });
    this.#sideSeason();
    await this.#anim.tween(700, (t) => (this.#foldMark = t));
    await this.#anim.wait(1800);
    await this.#anim.tween(1200, (t) => (this.#fold = 1 - t), { ease: ease.inOutCubic });
    this.#foldMark = 0;
  }

  #sideSeason(): void {
    const max = Math.max(...this.#ai.season);
    const bars = this.#ai.season
      .map(
        (s, m) =>
          `<i class="${m === 0 ? 'is-peak' : ''}" style="--h:${(s / max).toFixed(3)}"><span>${MONTHS[m] ?? ''}</span></i>`,
      )
      .join('');
    this.#side.innerHTML = `
      <p class="hud-eyebrow">AI · ขั้นที่ 2 · ฤดูกาล</p>
      <p class="fc-sub">เทียบกับแนวโน้ม: เดือน 11 สูงกว่า <b>${this.#ai.season[0]?.toFixed(1) ?? ''}×</b></p>
      <div class="fc-season">${bars}</div>`;
    requestAnimationFrame(() => {
      this.#side.querySelector('.fc-season')?.classList.add('is-shown');
    });
  }

  async #showAi(): Promise<void> {
    this.#sideStep(
      'AI · ขั้นที่ 3',
      'แนวโน้ม × ฤดูกาล = คำทาย<br />แถบจาง = ช่วงที่น่าจะเป็น (90%)',
    );
    await this.#anim.tween(1600, (t) => (this.#aiShape = t), { ease: ease.inOutCubic });
    await this.#anim.tween(800, (t) => (this.#band = t));
    await this.#anim.wait(400);
  }

  async #showActual(): Promise<void> {
    this.#side.innerHTML = `
      <p class="hud-eyebrow">The real year</p>
      <div class="fc-acc is-player"><p class="hud-label-th">ท่านแม่นยำ</p><span class="hud-number"><span class="fc-acc-player"></span><small>%</small></span></div>
      <div class="fc-acc is-ai"><p class="hud-label-th">AI แม่นยำ</p><span class="hud-number"><span class="fc-acc-ai"></span><small>%</small></span></div>
      <p class="fc-sub">สีแดง = ระยะที่ท่านพลาดจากของจริง</p>`;
    const guess = this.#guess ?? [];
    const actual = this.#series.actual;
    const playerEl = this.#side.querySelector('.fc-acc-player') as HTMLElement;
    const aiEl = this.#side.querySelector('.fc-acc-ai') as HTMLElement;
    // Slowly, month by month: the accuracy so far follows the line as it draws
    await this.#anim.tween(
      4800,
      (t) => {
        this.#actual = t;
        const n = Math.max(1, Math.ceil(t * AHEAD));
        this.#playerAcc = accuracy(guess.slice(0, n), actual.slice(0, n));
        this.#aiAcc = accuracy(this.#ai.mean.slice(0, n), actual.slice(0, n));
        setDigits(playerEl, String(Math.round(this.#playerAcc)));
        setDigits(aiEl, String(Math.round(this.#aiAcc)));
      },
      { ease: ease.linear },
    );
    this.#playerAcc = accuracy(guess, actual);
    this.#aiAcc = accuracy(this.#ai.mean, actual);
    setDigits(playerEl, String(Math.round(this.#playerAcc)));
    setDigits(aiEl, String(Math.round(this.#aiAcc)));
    const winner = this.#playerAcc > this.#aiAcc ? '.is-player' : '.is-ai';
    this.#side.querySelector(winner)?.classList.add('is-winner');
    await this.#anim.wait(600);
  }

  #sideStep(title: string, text: string): void {
    this.#side.innerHTML = `
      <p class="hud-eyebrow"></p>
      <p class="fc-step">${text}</p>
      ${this.#legend()}`;
    (this.#side.querySelector('.hud-eyebrow') as HTMLElement).textContent = title;
  }

  #legend(): string {
    const items = [
      [PLAYER, 'ท่าน'],
      ...(this.#trend > 0 || this.#aiShape > 0 ? [[AI, 'AI']] : []),
      ...(this.#actual > 0 ? [[ACTUAL, 'ของจริง']] : []),
    ];
    return `<ul class="fc-legend">${items
      .map(([c, t]) => `<li><i style="--c:${c ?? ''}"></i>${t ?? ''}</li>`)
      .join('')}</ul>`;
  }

  // ---------- Play again: the 11.11 order ----------

  async #letPlayerOrder(): Promise<void> {
    this.#mode = 'order';
    this.#order = orderAt(this.#level, this.#ai.mean[0] ?? 0);
    this.#side.innerHTML = `
      <p class="hud-eyebrow">11.11 · Stock order</p>
      <p class="fc-sub">ยกมือ = สั่งเพิ่ม · ลดมือ = สั่งน้อยลง</p>
      <p class="hud-label-th">สั่งเข้าโกดัง</p>
      <span class="hud-number fc-order"></span>
      <p class="fc-sub fc-band-text">AI: น่าจะขาย ${roundTo(this.#ai.low[0] ?? 0, 100).toLocaleString('en-US')}–${roundTo(this.#ai.high[0] ?? 0, 100).toLocaleString('en-US')} ชิ้น</p>
      <div class="fc-stock is-order" aria-hidden="true"></div>
      <div class="fc-timer"><i></i></div>`;
    this.#sideOrder();
    this.#controlling = true;
    const bar = this.#side.querySelector('.fc-timer i') as HTMLElement;
    await this.#anim.tween(
      ORDER_MS,
      (t) => {
        bar.style.transform = `scaleX(${String(1 - t)})`;
      },
      { ease: ease.linear },
    );
    this.#controlling = false;
  }

  #sideOrder(): void {
    const el = this.#side.querySelector<HTMLElement>('.fc-order');
    if (el) setDigits(el, this.#order.toLocaleString('en-US'));
    const stock = this.#side.querySelector<HTMLElement>('.fc-stock');
    if (stock) {
      this.#stack(stock, this.#order, { low: this.#ai.low[0] ?? 0, high: this.#ai.high[0] ?? 0 });
    }
  }

  async #runSaleDay(): Promise<void> {
    this.#mode = 'sale';
    this.#root.classList.add('is-sale');
    const demand = this.#series.actual[0] ?? 0;
    this.#sale = saleDay(this.#order, demand);
    const sale = this.#sale;
    this.#eyebrow.textContent = '11.11 · Sale day';
    this.#side.innerHTML = `
      <p class="hud-eyebrow">11.11 · Sale day</p>
      <div class="fc-tally"><p class="hud-label-th">ขายได้</p><span class="hud-number fc-sold"></span></div>
      <div class="fc-tally is-short"><p class="hud-label-th">ของขาด</p><span class="hud-number fc-short"></span></div>
      <div class="fc-tally is-left"><p class="hud-label-th">ของค้าง</p><span class="hud-number fc-left"></span></div>
      <div class="fc-tally is-profit"><p class="hud-label-th">กำไร</p><span class="hud-number fc-profit"></span></div>
      <p class="fc-sub">ขาย 1 ชิ้นได้ ฿${String(MONEY.margin)} · ค้าง 1 ชิ้นเสีย ฿${String(MONEY.leftover)}</p>`;
    const set = (sel: string, v: number, money = false) => {
      const el = this.#side.querySelector<HTMLElement>(sel);
      if (el) setDigits(el, `${money ? '฿' : ''}${Math.round(v).toLocaleString('en-US')}`);
    };
    await this.#anim.tween(700, (t) => (this.#warehouse = t));
    await this.#anim.tween(
      5200,
      (t) => {
        this.#saleT = t;
        const served = Math.min(demand * t, sale.sold);
        set('.fc-sold', served);
        set('.fc-short', Math.max(0, demand * t - sale.order));
        set('.fc-left', t >= 1 ? sale.leftover : Math.max(0, sale.order - demand * t));
        set('.fc-profit', served * MONEY.margin, true);
      },
      { ease: ease.linear },
    );
    set('.fc-sold', sale.sold);
    set('.fc-short', sale.short);
    set('.fc-left', sale.leftover);
    await this.#anim.tween(600, (t) => {
      set(
        '.fc-profit',
        sale.sold * MONEY.margin - t * (sale.leftover * MONEY.leftover + sale.short * MONEY.short),
        true,
      );
    });
    await this.#anim.wait(500);
  }

  #sideLesson(): void {
    this.#side.innerHTML = `
      <p class="hud-eyebrow">Forecast = 3 layers</p>
      <ol class="fc-layers">
        <li><b>แนวโน้ม</b> ยอดโตขึ้นเรื่อย ๆ</li>
        <li><b>ฤดูกาล</b> รูปแบบที่ซ้ำทุกปี</li>
        <li><b>ความไม่แน่นอน</b> ช่วงที่น่าจะเป็น</li>
      </ol>`;
  }

  // ---------- Drawing ----------

  /** Screen [0, 1] → chart [0, 1] (y up), or null outside the chart. */
  #toChart(x: number, y: number): { x: number; y: number } | null {
    const r = this.#plot.getBoundingClientRect();
    const cx = (x * window.innerWidth - r.left) / r.width;
    const cy = 1 - (y * window.innerHeight - r.top) / r.height;
    return cx >= 0 && cx <= 1 && cy >= -0.05 && cy <= 1.05 ? { x: cx, y: cy } : null;
  }

  #draw(): void {
    const c = this.#canvas;
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
    if (!g) return;
    g.clearRect(0, 0, w, h);
    const unit = h / 60;
    const chart = 1 - this.#warehouse;
    if (chart > 0) {
      g.globalAlpha = chart;
      this.#drawChart(g, w, h, unit);
      g.globalAlpha = 1;
    }
    if (this.#warehouse > 0 && this.#sale) this.#drawSale(g, w, h, unit, this.#sale);
  }

  #drawChart(g: CanvasRenderingContext2D, w: number, h: number, unit: number): void {
    // Timeline x for month t; folded x for month-of-year m (the three years stacked)
    const xLine = (t: number) => xAt(t) * w;
    const xFold = (t: number) => (((t % 12) + 0.5) / 12) * HISTORY_W * w;
    const xh = (t: number) => xLine(t) + (xFold(t) - xLine(t)) * this.#fold;
    const y = (v: number) => h - (v / Y_MAX) * h;
    const futureX = xLine(HISTORY - 0.5);

    // Gridlines and labels
    g.font = `600 ${String(1.9 * unit)}px 'Bai Jamjuree', sans-serif`;
    g.textBaseline = 'bottom';
    for (const v of Y_TICKS) {
      g.fillStyle = 'rgba(255,150,195,0.12)';
      g.fillRect(0, y(v), w, 1);
      g.fillStyle = 'rgba(169,147,167,0.9)';
      g.textAlign = 'left';
      g.fillText(v.toLocaleString('en-US'), 0.6 * unit, y(v) - 0.3 * unit);
    }
    g.textBaseline = 'top';
    g.textAlign = 'center';
    if (this.#fold < 0.5) {
      for (let k = 0; k < 4; k++) {
        const t = k * 12;
        g.fillStyle = 'rgba(255,150,195,0.25)';
        g.fillRect(xLine(t - 0.5), 0, 1, h);
        g.fillStyle = 'rgba(169,147,167,0.9)';
        g.fillText(
          k < 3
            ? `ปี ${String(k + 1)} · ${String(FIRST_YEAR + k)}–${String((FIRST_YEAR + k + 1) % 100)}`
            : '',
          xLine(t + 5.5),
          0.4 * unit,
        );
      }
    } else {
      for (let m = 0; m < 12; m++) {
        g.fillStyle = m === 0 ? AI : 'rgba(169,147,167,0.9)';
        g.fillText(MONTHS[m] ?? '', xFold(m), h - 2.6 * unit);
      }
    }

    // The future zone: twelve columns, 11.11 first
    if (this.#future > 0 && this.#fold < 0.5) {
      g.save();
      g.globalAlpha *= this.#future * (1 - this.#fold * 2);
      const grad = g.createLinearGradient(futureX, 0, w, 0);
      grad.addColorStop(0, 'rgba(246,98,158,0.16)');
      grad.addColorStop(1, 'rgba(246,98,158,0.04)');
      g.fillStyle = grad;
      g.fillRect(futureX, 0, w - futureX, h);
      g.fillStyle = 'rgba(246,98,158,0.9)';
      g.fillRect(futureX, 0, 2, h);
      g.font = `800 ${String(2.4 * unit)}px Orbitron, sans-serif`;
      g.fillStyle = '#ff8fc0';
      g.fillText('อนาคต ?', (futureX + w) / 2, 0.4 * unit);
      g.font = `600 ${String(1.7 * unit)}px 'Bai Jamjuree', sans-serif`;
      for (let j = 0; j < AHEAD; j++) {
        const x = xLine(HISTORY + j);
        const nov = j === 0;
        g.fillStyle = nov ? AI : 'rgba(169,147,167,0.85)';
        g.fillText(nov ? '11.11' : (MONTHS[j] ?? ''), x, h - 2.6 * unit);
        if (nov && this.#mode === 'draw') {
          g.fillStyle = `rgba(254,187,151,${String(0.08 + 0.06 * Math.sin(this.#now / 300))})`;
          const col = ((1 - HISTORY_W) / AHEAD) * w;
          g.fillRect(x - col / 2, 0, col, h);
        }
      }
      g.restore();
    }

    // Trend line (step 1): across the history, then on into the future
    if (this.#trend > 0) {
      const t1 = (HISTORY + AHEAD - 1) * this.#trend;
      g.save();
      g.strokeStyle = AI;
      g.lineWidth = 0.35 * unit;
      g.setLineDash([1.4 * unit, 0.9 * unit]);
      // Fades back once the forecast is built on it
      g.globalAlpha *= (1 - this.#fold) * (1 - 0.65 * this.#aiShape);
      g.beginPath();
      g.moveTo(xLine(0), y(trendAt(this.#ai.trend, 0)));
      g.lineTo(xLine(t1), y(trendAt(this.#ai.trend, t1)));
      g.stroke();
      g.restore();
    }

    // History: one line per year so they can fold onto each other
    const shown = Math.min(HISTORY, this.#shown);
    for (let k = 0; k < 3; k++) {
      const color = this.#fold > 0 ? (YEARS[k] ?? ACTUAL) : 'rgba(255,214,232,0.95)';
      const from = k * 12;
      const to = Math.min(from + 11, Math.floor(shown - 0.001));
      if (to < from) continue;
      g.strokeStyle = color;
      g.lineWidth = 0.4 * unit;
      g.lineJoin = 'round';
      g.beginPath();
      // Join to the previous year's last point while unfolded
      const start = k > 0 && this.#fold === 0 ? from - 1 : from;
      for (let t = start; t <= to; t++) {
        const v = this.#series.history[t] ?? 0;
        g[t === start ? 'moveTo' : 'lineTo'](xh(t), y(v));
      }
      g.stroke();
    }
    for (let t = 0; t < Math.ceil(shown); t++) {
      const v = this.#series.history[t] ?? 0;
      const appear = Math.min(1, shown - t);
      const spike = t % 12 === 0;
      const r = (spike ? 0.9 : 0.55) * unit * (0.4 + 0.6 * appear);
      g.fillStyle = this.#fold > 0 ? (YEARS[Math.floor(t / 12)] ?? ACTUAL) : spike ? AI : ACTUAL;
      g.beginPath();
      g.arc(xh(t), y(v), r, 0, Math.PI * 2);
      g.fill();
      // Each 11.11 flashes as it lands
      if (spike && appear < 1 && this.#mode === 'history') {
        g.strokeStyle = `rgba(254,187,151,${String(1 - appear)})`;
        g.lineWidth = 0.3 * unit;
        g.beginPath();
        g.arc(xh(t), y(v), (1 + 4 * appear) * unit, 0, Math.PI * 2);
        g.stroke();
      }
    }
    if (this.#foldMark > 0) {
      const top = Math.max(...[0, 12, 24].map((t) => this.#series.history[t] ?? 0));
      g.globalAlpha = this.#foldMark;
      g.strokeStyle = AI;
      g.lineWidth = 0.35 * unit;
      g.beginPath();
      g.ellipse(xFold(0), y(top * 0.93), 2.4 * unit, 6 * unit, 0, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = AI;
      g.font = `800 ${String(2.6 * unit)}px 'Bai Jamjuree', sans-serif`;
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      g.fillText('11.11 พุ่งทุกปี!', xFold(0) + 3.4 * unit, y(top * 0.93));
      g.globalAlpha = 1;
    }
    if (this.#fold > 0.02) return;

    // AI forecast (step 3): grows out of the trend into trend × season, with its band
    if (this.#aiShape > 0) {
      const at = (j: number) => {
        const base = trendAt(this.#ai.trend, HISTORY + j);
        return base + ((this.#ai.mean[j] ?? base) - base) * this.#aiShape;
      };
      if (this.#band > 0) {
        g.fillStyle = `rgba(254,187,151,${String(0.16 * this.#band)})`;
        g.beginPath();
        for (let j = 0; j < AHEAD; j++) g.lineTo(xLine(HISTORY + j), y(this.#ai.high[j] ?? 0));
        for (let j = AHEAD - 1; j >= 0; j--) g.lineTo(xLine(HISTORY + j), y(this.#ai.low[j] ?? 0));
        g.closePath();
        g.fill();
      }
      this.#line(
        g,
        AHEAD,
        (j) => xLine(HISTORY + j),
        (j) => y(at(j)),
        AI,
        unit,
        0.45,
      );
    }

    // The real year, drawn slowly; the player's misses glow red
    const guess = this.#guess;
    if (this.#actual > 0 && guess) {
      const n = this.#actual * (AHEAD - 1);
      g.fillStyle = 'rgba(255,84,112,0.3)';
      for (let j = 0; j < Math.ceil(n + 0.001) && j < AHEAD; j++) {
        const x0 = xLine(HISTORY + j - 0.5);
        const x1 = xLine(HISTORY + Math.min(j + 0.5, n + 0.5));
        const a = y(this.#series.actual[j] ?? 0);
        const b = y(guess[j] ?? 0);
        g.fillRect(x0, Math.min(a, b), Math.max(0, x1 - x0), Math.abs(a - b));
      }
      this.#line(
        g,
        Math.floor(n) + 1,
        (j) => xLine(HISTORY + Math.min(j, n)),
        (j) => {
          const lo = Math.floor(Math.min(j, n));
          const k = Math.min(j, n) - lo;
          const a = this.#series.actual[lo] ?? 0;
          const b = this.#series.actual[Math.min(lo + 1, AHEAD - 1)] ?? a;
          return y(a + (b - a) * k);
        },
        ACTUAL,
        unit,
        0.5,
        Math.ceil(n) + 1,
      );
    }

    // The player's line: a laser while drawing, then a pink line in the reveal
    const pts: [number, number][] = [];
    const values = guess ?? this.#drawn;
    values.forEach((v, j) => {
      if (v !== null) pts.push([xLine(HISTORY + j), y(v)]);
    });
    if (pts.length > 0) {
      g.save();
      g.shadowColor = PLAYER;
      g.shadowBlur = (1.2 + 1.5 * this.#playerGlow) * unit;
      g.strokeStyle = PLAYER;
      g.lineWidth = (0.5 + 0.2 * this.#playerGlow) * unit;
      g.lineJoin = 'round';
      g.beginPath();
      pts.forEach(([px, py], i) => {
        g[i ? 'lineTo' : 'moveTo'](px, py);
      });
      g.stroke();
      g.restore();
      g.fillStyle = '#fff';
      for (const [px, py] of pts) {
        g.beginPath();
        g.arc(px, py, 0.6 * unit, 0, Math.PI * 2);
        g.fill();
      }
    }
  }

  #line(
    g: CanvasRenderingContext2D,
    n: number,
    x: (j: number) => number,
    y: (j: number) => number,
    color: string,
    unit: number,
    width: number,
    points = n,
  ): void {
    g.save();
    g.shadowColor = color;
    g.shadowBlur = 1.2 * unit;
    g.strokeStyle = color;
    g.lineWidth = width * unit;
    g.lineJoin = 'round';
    g.beginPath();
    for (let j = 0; j < points; j++) g[j ? 'lineTo' : 'moveTo'](x(j), y(j));
    g.stroke();
    g.restore();
  }

  /**
   * The sale day: boxes in the warehouse on the right, a crowd streaming in from the left (one
   * dot per 100 pieces; one dot per 500 left the screen nearly empty). Each served customer
   * carries a piece away and every fifth empties a box; once the boxes run out the rest turn red
   * and leave; boxes nobody took glow orange.
   */
  #drawSale(g: CanvasRenderingContext2D, w: number, h: number, unit: number, sale: SaleDay): void {
    g.globalAlpha = this.#warehouse;
    const PER_DOT = 100;
    const boxes = Math.round(sale.order / BOX);
    const crowd = Math.round(sale.demand / PER_DOT);
    const stock = Math.round(sale.order / PER_DOT);
    const cols = 10;
    const rows = Math.max(1, Math.ceil(boxes / cols));
    const size = Math.min((w * 0.4) / cols, (h * 0.78) / rows);
    const left = w * 0.56;
    const bottom = h * 0.96;
    const door = { x: left - size * 0.6, y: bottom - (rows * size) / 2 };
    const t = Math.max(0, this.#saleT);
    const WALK = 0.14;

    // Warehouse
    g.fillStyle = 'rgba(255,150,195,0.08)';
    g.fillRect(
      left - size * 0.3,
      bottom - rows * size - size * 0.3,
      size * cols + size * 0.6,
      rows * size + size * 0.6,
    );
    g.font = `700 ${String(2 * unit)}px 'Bai Jamjuree', sans-serif`;
    g.fillStyle = 'rgba(232,214,228,0.95)';
    g.textAlign = 'left';
    g.textBaseline = 'bottom';
    g.fillText(
      `โกดัง · ${String(boxes)} กล่อง (กล่องละ ${String(BOX)} ชิ้น)`,
      left,
      bottom - rows * size - size * 0.5,
    );

    // How many customers have reached the door so far, and how many boxes they emptied
    const reached = Math.max(0, Math.min(crowd, Math.floor(((t - WALK) / (1 - WALK)) * crowd)));
    const served = Math.min(reached, stock);
    const emptied = Math.min(boxes, Math.floor((served * PER_DOT) / BOX));
    for (let i = 0; i < boxes; i++) {
      if (i >= boxes - emptied) continue; // boxes leave from the top of the pile
      const x = left + (i % cols) * size;
      const yy = bottom - (Math.floor(i / cols) + 1) * size;
      const leftover = t >= 1;
      g.fillStyle = leftover ? (Math.sin(this.#now / 160) > 0 ? '#e8a25a' : '#c07a26') : '#febb97';
      g.fillRect(x + 1, yy + 1, size - 2, size - 2);
      g.fillStyle = 'rgba(18,7,20,0.35)';
      g.fillRect(x + size * 0.44, yy + 1, size * 0.12, size - 2);
    }

    // The crowd
    for (let i = 0; i < crowd; i++) {
      const start = (i / crowd) * (1 - WALK);
      const age = (t - start) / WALK; // 0 = setting off, 1 = at the door
      if (age <= 0) continue;
      const lane = h * 0.1 + ((i * 0.618034) % 1) * h * 0.8;
      const from = { x: -unit * 2, y: lane };
      const ok = i < stock;
      let x: number;
      let yy: number;
      if (age < 1) {
        x = from.x + (door.x - from.x) * age;
        yy = from.y + (door.y - from.y) * age * age;
      } else if (ok) {
        // served: off the top with a piece
        const k = age - 1;
        x = door.x - k * w * (0.05 + ((i * 0.37) % 1) * 0.35);
        yy = door.y - k * h * (0.5 + ((i * 0.53) % 1) * 0.5);
      } else {
        // turned away: back out to the left, red
        const k = age - 1;
        x = door.x - k * w * 0.6;
        yy = door.y + Math.sin(i) * k * h * 0.2;
      }
      if (x < -unit * 3 || yy < -unit * 3) continue;
      g.fillStyle = age < 1 ? '#fff6fa' : ok ? '#4fe3b0' : '#ff5470';
      g.beginPath();
      g.arc(x, yy, 0.55 * unit, 0, Math.PI * 2);
      g.fill();
    }

    if (t >= 1) {
      const [text, color] =
        sale.short > JUST_RIGHT
          ? ['ของหมด!', '#ff5470']
          : sale.leftover > JUST_RIGHT
            ? ['ของค้าง!', '#e8a25a']
            : ['พอดีเป๊ะ!', '#4fe3b0'];
      g.fillStyle = color;
      g.font = `900 ${String(5 * unit)}px 'Bai Jamjuree', sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(text, w * 0.28, h * 0.42);
    }
    g.globalAlpha = 1;
  }
}

/** Chart x in [0, 1] for month t (fractional): history then future, each at its own scale. */
function xAt(t: number): number {
  return t <= HISTORY - 0.5
    ? ((t + 0.5) / HISTORY) * HISTORY_W
    : HISTORY_W + ((t - HISTORY + 0.5) / AHEAD) * (1 - HISTORY_W);
}

/** Inverse of `xAt` for the future: month ahead (fractional, < −0.5 inside the history). */
function futureMonthAt(x: number): number {
  return x < HISTORY_W
    ? -0.5 - ((HISTORY_W - x) / HISTORY_W) * HISTORY
    : ((x - HISTORY_W) / (1 - HISTORY_W)) * AHEAD - 0.5;
}

function monthLabel(t: number): string {
  const m = t % 12;
  // Nov and Dec belong to the first calendar year of each block
  const year = FIRST_YEAR + Math.floor(t / 12) + (m >= 2 ? 1 : 0);
  return `${MONTHS[m] ?? ''} ${String(year + 543)}`;
}

function roundTo(v: number, step: number): number {
  return Math.round(v / step) * step;
}
