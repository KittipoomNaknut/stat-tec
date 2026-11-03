import { setDigits } from '../../hud/digits';
import { askPose } from '../../hud/pose-prompt';
import type { Beat } from '../../narrative/schema';
import type { TemplateVars } from '../../narrative/template';
import { Animator, ease } from '../../viz/animator';
import {
  AXES,
  BLIND_START,
  customers,
  kmeans,
  matchSegment,
  type Iteration,
  type Point,
} from './segments';
import type { SceneContext, SceneModule } from '../types';
import {
  bestStrategy,
  DEFAULT_PRICE,
  evaluate,
  PERSONAS,
  RIVAL_PRICE,
  STRATEGIES,
  type GroupId,
  type StrategyId,
  type StrategyResult,
} from './model';
import './rival.css';

/** Cluster colors from EPISODE III (validated for color-vision deficiency, research 018). */
const COLORS = ['#e0428a', '#c07a26', '#3f9be0'] as const;
const EMPIRE = '#ff3b4e';
const NEUTRAL: RGB = [217, 201, 214];
/** The player gets this long (story time) to choose; then the café keeps its price. */
const CHOICE_MS = 14_000;

type RGB = [number, number, number];
const hex = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
const PALETTE = COLORS.map(hex);
const RED = hex(EMPIRE);

export function rivalScene(chapterId: string, carry: Readonly<TemplateVars> = {}) {
  return (ctx: SceneContext): SceneModule => new RivalScene(ctx, chapterId, carry);
}

/**
 * EP II — คู่แข่งบุก (Clustering → pricing by group). Empire Coffee opens across the street at
 * ฿49. The AI groups the café's 600 customers with K-means (a quick run from a blind guess),
 * names the groups, and the player picks how to answer: discount everyone, only the group that
 * would leave, or nobody. The customers who leave walk off the map to the rival.
 */
class RivalScene implements SceneModule {
  readonly id = 'r-rival';
  readonly #ctx: SceneContext;
  readonly #chapterId: string;
  readonly #anim = new Animator();
  readonly #points: Point[] = customers().points;
  /** The AI's run from a blind guess; it settles on the three true groups (research 018). */
  readonly #steps = kmeans(this.#points, BLIND_START);
  readonly #best = this.#steps.at(-1) as Iteration;
  /** Each found cluster's group. */
  readonly #groups: GroupId[] = this.#best.centers.map((c) => matchSegment(c).id);
  readonly #price: number;

  readonly #root = document.createElement('div');
  readonly #plot: HTMLElement;
  readonly #canvas: HTMLCanvasElement;
  readonly #side: HTMLElement;
  readonly #tags: HTMLElement;
  readonly #empire: HTMLElement;

  readonly #color: RGB[];
  readonly #target: RGB[];
  readonly #appear: Float32Array;
  /** Per point: 0 at home, 1 gone to the rival. */
  readonly #away: Float32Array;
  #centers: Point[] = [];
  #links = 0;
  #labels: number[] = [];
  #choice: StrategyResult | null = null;
  readonly #off: (() => void)[] = [];

  constructor(ctx: SceneContext, chapterId: string, carry: Readonly<TemplateVars>) {
    this.#ctx = ctx;
    this.#chapterId = chapterId;
    const played = typeof carry['price'] === 'number' ? carry['price'] : DEFAULT_PRICE;
    // A price at or under the rival's leaves nothing to fight over: start from a fair one
    this.#price = Math.min(120, Math.max(59, Math.round(played)));
    const n = this.#points.length;
    this.#color = this.#points.map(() => [...NEUTRAL] as RGB);
    this.#target = this.#points.map(() => [...NEUTRAL] as RGB);
    this.#appear = new Float32Array(n);
    this.#away = new Float32Array(n);

    this.#root.className = 'rv';
    this.#root.innerHTML = `
      <div class="hud-panel rv-plot">
        <p class="hud-eyebrow">ลูกค้าดาต้าคาเฟ่ · 600 คน</p>
        <p class="rv-axis rv-axis-y"></p>
        <p class="rv-axis rv-axis-x"></p>
        <div class="rv-area"><canvas></canvas><div class="rv-tags"></div></div>
      </div>
      <div class="rv-empire" aria-hidden="true"><b>EMPIRE COFFEE</b><span>฿${String(RIVAL_PRICE)}</span></div>
      <aside class="hud-panel rv-side"></aside>`;
    const q = (sel: string) => this.#root.querySelector(sel) as HTMLElement;
    q('.rv-axis-y').textContent = `↑ ${AXES.y.label}`;
    q('.rv-axis-x').textContent = `${AXES.x.label} →`;
    this.#plot = q('.rv-area');
    this.#canvas = this.#plot.querySelector('canvas') as HTMLCanvasElement;
    this.#tags = q('.rv-tags');
    this.#side = q('.rv-side');
    this.#empire = q('.rv-empire');
    ctx.hud.append(this.#root);
    this.#sidePrices();
  }

  ownsLesson(): boolean {
    return true;
  }

  setFade(value: number): void {
    this.#ctx.hud.style.opacity = String(value);
  }

  vars() {
    const choice = this.#choice;
    return {
      ourPrice: this.#price,
      gap: this.#price - RIVAL_PRICE,
      kept: choice ? Math.round(choice.kept * 100) : 0,
      chosenBest: choice?.id === bestStrategy(this.#price),
    };
  }

  result() {
    const choice = this.#choice ?? evaluate('none', this.#price);
    const best = evaluate(bestStrategy(this.#price), this.#price);
    const style =
      choice.id === best.id
        ? { analyst: 1 }
        : choice.id === 'all'
          ? { 'risk-taker': 1 }
          : { intuitive: 1 };
    return { chapterId: this.#chapterId, score: choice.profit / best.profit, style };
  }

  dispose(): void {
    this.#anim.cancel();
    for (const off of this.#off) off();
  }

  update(dtMs: number): void {
    this.#anim.update(dtMs);
    this.#draw(dtMs);
  }

  onBeat(beat: Beat): void {
    if (beat.type === 'mission') void this.#streamIn();
    if (beat.type === 'lesson') {
      this.#root.querySelector('.rv-plot .hud-eyebrow')?.replaceChildren('Lesson · Clustering');
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
      case 'rival':
        this.#empire.classList.add('is-on');
        return false;
      case 'drift':
        this.#drift();
        return false;
      case 'kmeans-run':
        return run(this.#runAi());
      case 'clusters':
        this.#nameClusters();
        return false;
      case 'choose-strategy':
        this.#offerChoice();
        return true;
      case 'outcome':
        return run(this.#outcome());
      default:
        return false;
    }
  }

  // ---------- Mission ----------

  async #streamIn(): Promise<void> {
    await this.#anim.tween(
      2200,
      (t) => {
        this.#points.forEach((p, i) => {
          const start = p.x * 0.75 + (((i * 37) % 100) / 100) * 0.2;
          this.#appear[i] = Math.min(1, Math.max(0, (t - start) / 0.12));
        });
      },
      { ease: ease.linear },
    );
    this.#appear.fill(1);
  }

  /** A few customers flash red and lean toward the rival: the threat, before any analysis. */
  #drift(): void {
    this.#points.forEach((_, i) => {
      if (hash(i) < 0.18) this.#target[i] = [...RED];
    });
    void this.#anim.tween(1600, (t) => {
      this.#points.forEach((_, i) => {
        if (hash(i) < 0.18) this.#away[i] = 0.12 * Math.sin(t * Math.PI);
      });
    });
    void this.#anim.wait(1800).then(() => {
      this.#points.forEach((_, i) => {
        if (hash(i) < 0.18) this.#target[i] = [...NEUTRAL];
      });
    });
  }

  // ---------- The AI groups them ----------

  async #runAi(): Promise<void> {
    const steps = this.#steps;
    this.#side.innerHTML = `
      <p class="hud-eyebrow">AI · K-means</p>
      <p class="rv-round"></p>`;
    const round = this.#side.querySelector('.rv-round') as HTMLElement;
    const first = steps[0];
    if (!first) return;
    this.#centers = first.centers.map((c) => ({ ...c }));
    this.#recolor(first.labels);
    this.#links = 1;
    round.textContent = 'เดาสุ่ม 3 กลุ่ม';
    await this.#anim.wait(700);
    for (let i = 1; i < steps.length; i++) {
      const prev = steps[i - 1];
      const step = steps[i];
      if (!prev || !step) continue;
      round.textContent = `รอบที่ ${String(i)}: ย้ายไปกลางกลุ่ม แล้วจัดใหม่`;
      await this.#anim.tween(
        420,
        (t) => {
          this.#centers = step.centers.map((c, k) => {
            const f = prev.centers[k] ?? c;
            return { x: f.x + (c.x - f.x) * t, y: f.y + (c.y - f.y) * t };
          });
        },
        { ease: ease.inOutCubic },
      );
      this.#recolor(step.labels);
      this.#links = 1;
      await this.#anim.wait(260);
    }
    round.textContent = 'นิ่งแล้ว — ได้ 3 กลุ่ม';
    await this.#anim.wait(400);
  }

  #nameClusters(): void {
    this.#tags.replaceChildren();
    this.#best.centers.forEach((c, k) => {
      const persona = PERSONAS[this.#groups[k] ?? 'regular'];
      const count = this.#best.labels.filter((l) => l === k).length;
      const tag = document.createElement('div');
      tag.className = 'rv-tag';
      tag.style.setProperty('--c', COLORS[k] ?? '#fff');
      tag.style.left = `${String(c.x * 100)}%`;
      tag.style.top = `${String((1 - c.y) * 100)}%`;
      if (c.y > 0.6) tag.classList.add('is-side');
      tag.innerHTML = `<b></b><span></span>`;
      (tag.querySelector('b') as HTMLElement).textContent = persona.name;
      (tag.querySelector('span') as HTMLElement).textContent =
        `${persona.description} · ${String(count)} คน`;
      this.#tags.append(tag);
      void this.#anim.tween(
        450,
        (t) => {
          tag.style.opacity = String(t);
        },
        { delay: k * 1400 },
      );
    });
  }

  // ---------- The choice ----------

  /** The answer is a pose (research 025): left hand, right hand, or arms crossed for "no". */
  #offerChoice(): void {
    this.#side.innerHTML = `
      <p class="hud-eyebrow">ท่านจะสู้ยังไง?</p>
      <p class="rv-note">ร้านเรา ฿${String(this.#price)} · Empire ฿${String(RIVAL_PRICE)}</p>`;
    const label = (id: StrategyId) => STRATEGIES.find((s) => s.id === id)?.label ?? id;
    void askPose(
      this.#side,
      this.#ctx.bus,
      [
        { pose: 'left-up', label: label('all') },
        { pose: 'right-up', label: label('target') },
        { pose: 'cross', label: label('none') },
      ],
      (ms, step) => this.#anim.tween(ms, step, { ease: ease.linear }),
      CHOICE_MS,
      'list',
    ).then((pose) => {
      // No answer in time: the café keeps its price
      this.#choose(pose === 'left-up' ? 'all' : pose === 'right-up' ? 'target' : 'none');
    });
  }

  #choose(id: StrategyId): void {
    if (this.#choice) return;
    this.#choice = evaluate(id, this.#price);
    this.#ctx.signal('continue');
  }

  /** Who leaves walks off the map to the rival; then every option's result, side by side. */
  async #outcome(): Promise<void> {
    const choice = this.#choice ?? evaluate('none', this.#price);
    this.#tags.replaceChildren();
    const leaving = this.#points.map((_, i) => {
      const group = this.#groups[this.#best.labels[i] ?? 0] ?? 'regular';
      return hash(i) < choice.leaves[group];
    });
    leaving.forEach((gone, i) => {
      if (gone) this.#target[i] = [...RED];
    });
    await this.#anim.tween(
      1800,
      (t) => {
        leaving.forEach((gone, i) => {
          if (gone) this.#away[i] = t;
        });
      },
      { ease: ease.inOutCubic },
    );
    const best = bestStrategy(this.#price);
    const rows = STRATEGIES.map((s) => {
      const r = evaluate(s.id, this.#price);
      const cls = [s.id === choice.id ? 'is-chosen' : '', s.id === best ? 'is-best' : ''].join(' ');
      return `<li class="${cls}"><span>${s.label}</span><div><i style="--w:${r.kept.toFixed(3)}"></i></div><b>${String(Math.round(r.kept * 100))}%</b></li>`;
    }).join('');
    this.#side.innerHTML = `
      <p class="hud-eyebrow">กำไรที่เหลือ</p>
      <span class="hud-number rv-kept"></span>
      <p class="rv-note">ของกำไรก่อน Empire มาเปิด</p>
      <ul class="rv-compare">${rows}</ul>`;
    setDigits(
      this.#side.querySelector('.rv-kept') as HTMLElement,
      `${String(Math.round(choice.kept * 100))}%`,
    );
    await this.#anim.wait(900);
  }

  #sidePrices(): void {
    this.#side.innerHTML = `
      <p class="hud-eyebrow">ราคาวันนี้</p>
      <div class="rv-price"><p class="hud-label-th">ดาต้าคาเฟ่</p><span class="hud-number">฿${String(this.#price)}</span></div>
      <p class="rv-note">ราคาจากศึกแรกของท่าน</p>`;
  }

  // ---------- Drawing ----------

  #recolor(labels: number[]): void {
    this.#labels = labels;
    labels.forEach((l, i) => {
      this.#target[i] = [...(PALETTE[l] ?? NEUTRAL)];
    });
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
    // Leaving customers head right, past the plot edge toward Empire Coffee
    const px = (p: Point, i = -1) => (p.x + (i >= 0 ? (this.#away[i] ?? 0) * (1.25 - p.x) : 0)) * w;
    const py = (p: Point) => (1 - p.y) * h;

    const k = 1 - Math.exp(-dtMs / 180);
    for (let i = 0; i < this.#color.length; i++) {
      const cur = this.#color[i];
      const tgt = this.#target[i];
      if (!cur || !tgt) continue;
      cur[0] += (tgt[0] - cur[0]) * k;
      cur[1] += (tgt[1] - cur[1]) * k;
      cur[2] += (tgt[2] - cur[2]) * k;
    }

    if (this.#links > 0.01 && this.#centers.length > 0) {
      g.lineWidth = dpr;
      this.#points.forEach((p, i) => {
        if (i % 3 !== 0) return;
        const l = this.#labels[i] ?? 0;
        const center = this.#centers[l];
        const col = PALETTE[l];
        if (!center || !col) return;
        g.strokeStyle = `rgba(${String(col[0])},${String(col[1])},${String(col[2])},${String(0.28 * this.#links)})`;
        g.beginPath();
        g.moveTo(px(p), py(p));
        g.lineTo(px(center), py(center));
        g.stroke();
      });
      this.#links *= Math.exp(-dtMs / 700);
    }

    const r = 4.2 * dpr;
    this.#points.forEach((p, i) => {
      const a = (this.#appear[i] ?? 0) * (1 - Math.max(0, (this.#away[i] ?? 0) - 0.6) / 0.4);
      if (a <= 0) return;
      const col = this.#color[i] ?? NEUTRAL;
      g.fillStyle = `rgba(${String(Math.round(col[0]))},${String(Math.round(col[1]))},${String(Math.round(col[2]))},${String(0.85 * a)})`;
      g.beginPath();
      g.arc(px(p, i), py(p), r * (0.4 + 0.6 * Math.min(1, this.#appear[i] ?? 0)), 0, Math.PI * 2);
      g.fill();
    });

    if (!this.#choice) {
      this.#centers.forEach((center, idx) => {
        const col = COLORS[idx] ?? '#fff';
        g.save();
        g.shadowColor = col;
        g.shadowBlur = 24 * dpr;
        g.lineWidth = 4 * dpr;
        g.strokeStyle = '#fff';
        g.fillStyle = col;
        g.beginPath();
        g.arc(px(center), py(center), 18 * dpr, 0, Math.PI * 2);
        g.fill();
        g.stroke();
        g.restore();
      });
    }
  }
}

/** A stable 0..1 per customer, so the same people leave every visit. */
function hash(i: number): number {
  const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}
