import { TorusGeometry } from 'three';
import { PosePrompt } from '../hud/pose-prompt';
import type { Beat } from '../narrative/schema';
import { HologramObject } from './hologram-object';
import type { SceneContext, SceneModule } from './types';
import { palette } from '../config/palette';

/**
 * "New CEO detected": scan rings sweep up as the AI greets the player, then the first pose —
 * both hands up to start (research 025).
 */
export function welcomeScene(codename: string) {
  return (ctx: SceneContext): SceneModule => new WelcomeScene(ctx, codename);
}

class WelcomeScene implements SceneModule {
  readonly id = 'welcome';
  readonly #ctx: SceneContext;
  readonly #codename: string;
  readonly #rings = [0, 1, 2].map(
    (i) =>
      new HologramObject(
        new TorusGeometry(1.6 - i * 0.25, 0.015, 6, 128),
        i === 1 ? palette.peach : palette.pink,
        90,
      ),
  );
  #prompt: PosePrompt | null = null;
  #scanT = -1;

  constructor(ctx: SceneContext, codename: string) {
    this.#ctx = ctx;
    this.#codename = codename;
    for (const ring of this.#rings) {
      ring.root.rotation.x = Math.PI / 2;
      ctx.world.add(ring.root);
    }
  }

  setFade(value: number): void {
    for (const ring of this.#rings) ring.opacity = value;
    this.#ctx.hud.style.opacity = String(value);
  }

  update(dtMs: number, timeSec: number): void {
    if (this.#scanT >= 0) this.#scanT += dtMs / 1000;
    this.#rings.forEach((ring, i) => {
      // During the scan the rings sweep from the floor to head height, staggered.
      const phase = this.#scanT >= 0 ? (this.#scanT * 0.6 + i * 0.18) % 1 : 0.5 + i * 0.1;
      ring.root.position.y = -1.4 + phase * 3.6;
      ring.root.scale.setScalar(1 + Math.sin(timeSec * 1.3 + i) * 0.04);
      ring.update(timeSec);
    });
  }

  onBeat(beat: Beat): void {
    if (beat.type === 'tutorial') {
      const stage = document.createElement('div');
      stage.className = 'pose-stage is-entering';
      this.#ctx.hud.append(stage);
      this.#prompt = new PosePrompt(
        stage,
        this.#ctx.bus,
        [{ pose: 'both-up', label: 'ชูสองมือ เพื่อเริ่ม!' }],
        () => {
          this.#ctx.signal('gesture');
          setTimeout(() => {
            stage.remove();
          }, 600);
        },
      );
    }
  }

  onCue(cue: string): boolean {
    if (cue === 'scan') this.#scanT = 0;
    return false;
  }

  vars() {
    return { codename: this.#codename };
  }

  result() {
    return null;
  }

  dispose(): void {
    this.#prompt?.dispose();
    for (const ring of this.#rings) {
      ring.root.removeFromParent();
      ring.dispose();
    }
  }
}
