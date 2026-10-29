import { baht, CountUp } from '../hud/count-up';
import type { Story } from '../narrative/schema';
import { DataGlobe } from './globe';
import type { SceneContext, SceneModule } from './types';

export interface ReportData {
  codename: string;
  totalProfit: number;
  style: { label: string; description: string };
  rank: number;
  totalPlayers: number;
}

/**
 * The CEO report: total profit counting up, the player's style and today's rank, then the QR
 * code. Cards appear on the narrator's cues so the screen builds with the story.
 */
export function reportScene(story: Story, data: ReportData) {
  return (ctx: SceneContext): SceneModule => new ReportScene(ctx, story, data);
}

class ReportScene implements SceneModule {
  readonly id = 'report';
  readonly #ctx: SceneContext;
  readonly #data: ReportData;
  readonly #globe = new DataGlobe(2400, 1.1);
  readonly #count = new CountUp(2600);
  readonly #profit: HTMLElement;
  #counting = false;

  constructor(ctx: SceneContext, _story: Story, data: ReportData) {
    this.#ctx = ctx;
    this.#data = data;
    this.#globe.root.position.set(0, 2.6, -3);
    ctx.world.add(this.#globe.root);
    ctx.hud.innerHTML = `
      <section class="report">
        <p class="hud-label hud-label-accent">CEO Report</p>
        <h1 class="hud-headline report-name"></h1>
        <div class="report-cards">
          <div class="hud-panel report-card report-profit" data-cue="profit-count">
            <p class="hud-label-th">กำไรรวม</p>
            <span class="hud-number"></span>
          </div>
          <div class="hud-panel report-card" data-reveal="style">
            <p class="hud-label-th">สไตล์ CEO</p>
            <p class="report-value report-style"></p>
            <p class="report-note report-style-note"></p>
          </div>
          <div class="hud-panel report-card" data-reveal="rank">
            <p class="hud-label-th">อันดับวันนี้</p>
            <p class="report-value"><span class="hud-number report-rank"></span><span class="report-of"></span></p>
          </div>
          <div class="hud-panel report-card report-qr" data-cue="qr">
            <div class="report-qr-code" aria-label="QR"></div>
            <p class="report-note">สแกนดูเส้นทางสาย Data Science</p>
          </div>
        </div>
      </section>`;
    const q = (sel: string) => ctx.hud.querySelector(sel) as HTMLElement;
    q('.report-name').textContent = `CEO ${data.codename}`;
    q('.report-style').textContent = data.style.label;
    q('.report-style-note').textContent = data.style.description;
    q('.report-rank').textContent = `#${String(data.rank)}`;
    q('.report-of').textContent = ` / ${String(data.totalPlayers)}`;
    this.#profit = q('.report-profit .hud-number');
    this.#profit.textContent = baht(0);
  }

  setFade(value: number): void {
    this.#globe.opacity = value * 0.6;
    this.#ctx.hud.style.opacity = String(value);
  }

  update(dtMs: number, timeSec: number): void {
    this.#globe.update(timeSec);
    this.#globe.resolution = window.innerHeight / 1080;
    if (this.#counting) {
      this.#count.update(dtMs);
      this.#profit.textContent = baht(this.#count.value);
    }
  }

  onCue(cue: string): boolean {
    const card = this.#ctx.hud.querySelector<HTMLElement>(`[data-cue="${cue}"]`);
    card?.classList.add('is-shown');
    if (cue === 'profit-count') {
      this.#counting = true;
      this.#count.set(this.#data.totalProfit);
      // style and rank arrive with the next lines; show them as the count settles
      for (const el of this.#ctx.hud.querySelectorAll<HTMLElement>('[data-reveal]')) {
        el.classList.add('is-shown');
      }
    }
    return false;
  }

  vars() {
    return {
      codename: this.#data.codename,
      totalProfit: this.#data.totalProfit,
      ceoStyle: this.#data.style.label,
      rank: this.#data.rank,
      totalPlayers: this.#data.totalPlayers,
    };
  }

  result() {
    return null;
  }

  dispose(): void {
    this.#globe.root.removeFromParent();
    this.#globe.dispose();
  }
}
