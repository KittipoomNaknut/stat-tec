import type { Story } from '../narrative/schema';
import type { SceneContext, SceneModule } from './types';

/**
 * Nobody playing: the STAT WARS title over a rising planet, an opening crawl drifting into
 * space, and a ring of light on the floor that says where to stand (research 016). The 3D is
 * the shared stage (stars, nebula, planet); this scene is the HUD layer on top.
 */
export function attractScene(story: Story) {
  return (ctx: SceneContext): SceneModule => new AttractScene(ctx, story);
}

class AttractScene implements SceneModule {
  readonly id = 'attract';
  readonly #ctx: SceneContext;

  constructor(ctx: SceneContext, story: Story) {
    this.#ctx = ctx;
    const a = story.attract;
    ctx.hud.innerHTML = `
      <section class="attract">
        <p class="hud-eyebrow attract-corner is-left">Applied Statistics · KMUTNB</p>
        <p class="hud-eyebrow attract-corner is-right">Open House</p>
        <p class="attract-kicker"></p>
        <h1 class="attract-title"></h1>
        <div class="attract-subtitle"><i></i><span></span><i></i></div>
        <div class="attract-crawl"><div class="attract-crawl-text"></div></div>
        <div class="attract-prompt">
          <p></p>
          <div class="attract-pad" aria-hidden="true"><i></i><i></i><i></i></div>
        </div>
      </section>`;
    const q = (sel: string) => ctx.hud.querySelector(sel) as HTMLElement;
    q('.attract-kicker').textContent = a.kicker;
    q('.attract-title').textContent = a.title;
    q('.attract-subtitle span').textContent = a.subtitle;
    q('.attract-prompt p').textContent = a.prompt;
    const crawl = q('.attract-crawl-text');
    crawl.style.animationDuration = `${String(a.crawlSec)}s`;
    for (const line of a.crawl) {
      const p = document.createElement('p');
      p.textContent = line;
      crawl.append(p);
    }
  }

  setFade(value: number): void {
    this.#ctx.hud.style.opacity = String(value);
  }

  update(): void {
    // All motion is CSS (crawl, pad) and the shared stage (stars, planet).
  }

  vars() {
    return {};
  }

  result() {
    return null;
  }

  dispose(): void {
    // Nothing outside the HUD layer, which the scene manager removes.
  }
}
