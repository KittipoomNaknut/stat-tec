import { baht, CountUp } from '../hud/count-up';
import { setDigits } from '../hud/digits';
import type { Story } from '../narrative/schema';
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
  readonly #count = new CountUp(2600);
  readonly #profit: HTMLElement;
  #counting = false;

  constructor(ctx: SceneContext, story: Story, data: ReportData) {
    this.#ctx = ctx;
    this.#data = data;
    ctx.hud.innerHTML = `
      <section class="report">
        <p class="hud-eyebrow">Mission report</p>
        <h1 class="hud-display report-title"></h1>
        <p class="report-name"></p>
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
    q('.report-title').textContent = story.report.title;
    q('.report-name').textContent = `CEO ${data.codename}`;
    q('.report-style').textContent = data.style.label;
    q('.report-style-note').textContent = data.style.description;
    q('.report-rank').textContent = `#${String(data.rank)}`;
    q('.report-of').textContent = ` / ${String(data.totalPlayers)}`;
    this.#profit = q('.report-profit .hud-number');
    setDigits(this.#profit, baht(0));
  }

  setFade(value: number): void {
    this.#ctx.hud.style.opacity = String(value);
  }

  update(dtMs: number): void {
    if (this.#counting) {
      this.#count.update(dtMs);
      setDigits(this.#profit, baht(this.#count.value));
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
    // Everything lives in the HUD layer; the planet belongs to the shared stage.
  }
}
