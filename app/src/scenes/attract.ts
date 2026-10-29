import type { Story } from '../narrative/schema';
import { DataGlobe } from './globe';
import type { SceneContext, SceneModule } from './types';

/**
 * Nobody playing: a slowly turning data globe, the promise ("CEO in 5 minutes") and where to
 * stand. Taglines rotate every few seconds to catch people walking past.
 */
export function attractScene(story: Story) {
  return (ctx: SceneContext): SceneModule => new AttractScene(ctx, story);
}

class AttractScene implements SceneModule {
  readonly id = 'attract';
  readonly #ctx: SceneContext;
  readonly #globe = new DataGlobe();
  readonly #tagline: HTMLElement;
  readonly #taglines: readonly string[];
  readonly #rotateMs: number;
  #elapsed = 0;
  #index = 0;

  constructor(ctx: SceneContext, story: Story) {
    this.#ctx = ctx;
    this.#taglines = story.attract.taglines;
    this.#rotateMs = story.attract.rotateSec * 1000;
    this.#globe.root.position.set(0, 0.45, 0);
    this.#globe.root.scale.setScalar(0.85);
    ctx.world.add(this.#globe.root);
    ctx.hud.innerHTML = `
      <section class="attract">
        <p class="hud-label hud-label-accent">STAT_TEC · Data Science Experience</p>
        <h1 class="hud-display attract-title"></h1>
        <p class="attract-tagline"></p>
        <div class="attract-prompt">
          <p class="attract-prompt-text"></p>
          <div class="attract-marker" aria-hidden="true"><i></i><i></i><i></i></div>
        </div>
      </section>`;
    const q = (sel: string) => ctx.hud.querySelector(sel) as HTMLElement;
    q('.attract-title').textContent = story.attract.title;
    q('.attract-prompt-text').textContent = story.attract.prompt;
    this.#tagline = q('.attract-tagline');
    this.#showTagline();
  }

  setFade(value: number): void {
    this.#globe.opacity = value;
    this.#ctx.hud.style.opacity = String(value);
  }

  update(dtMs: number, timeSec: number): void {
    this.#globe.update(timeSec);
    this.#globe.resolution = window.innerHeight / 1080;
    this.#elapsed += dtMs;
    if (this.#elapsed >= this.#rotateMs) {
      this.#elapsed = 0;
      this.#index = (this.#index + 1) % this.#taglines.length;
      this.#showTagline();
    }
  }

  vars() {
    return {};
  }

  result() {
    return null;
  }

  dispose(): void {
    this.#globe.root.removeFromParent();
    this.#globe.dispose();
  }

  #showTagline(): void {
    this.#tagline.textContent = this.#taglines[this.#index] ?? '';
    this.#tagline.classList.remove('is-entering');
    this.#tagline.getBoundingClientRect();
    this.#tagline.classList.add('is-entering');
  }
}
