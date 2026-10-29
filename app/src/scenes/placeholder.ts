import type { BufferGeometry } from 'three';
import { IcosahedronGeometry, TorusGeometry } from 'three';
import { DwellButton } from '../hud/dwell-button';
import type { Beat, CeoStyle } from '../narrative/schema';
import type { TemplateVars } from '../narrative/template';
import { HologramObject } from './hologram-object';
import type { SceneContext, SceneModule } from './types';
import { palette } from '../config/palette';

/**
 * Stand-in chapters (ROADMAP 3.10) so the whole visit can be played with the body before the
 * real scenes exist (Phase 4). Only chapter A is still a stand-in; II–V are real scenes. Each shows a hologram and, during play, a few choices; a choice
 * sets the vars the story needs and the outcome scoring needs.
 */
interface Choice {
  label: string;
  vars: TemplateVars;
  score: number;
  style: Partial<Record<CeoStyle, number>>;
}

interface PlaceholderSpec {
  color: string;
  geometry: () => BufferGeometry;
  /** Shown in the play beat; picking one ends play. Empty = play runs its full time. */
  choices: Choice[];
  /** Vars before the player chooses (hints may use them). */
  initial: TemplateVars;
  /** Unscored chapters (A) return score null. */
  scored: boolean;
}

export const PLACEHOLDERS: Record<string, PlaceholderSpec> = {
  'a-you-are-data': {
    color: palette.pink,
    geometry: () => new IcosahedronGeometry(1.3, 2),
    choices: [],
    initial: { numbersCollected: 0 },
    scored: false,
  },
};

/** Fallback for a scene id without a spec (keeps the flow playable). */
const DEFAULT_SPEC: PlaceholderSpec = {
  color: palette.pink,
  geometry: () => new TorusGeometry(1, 0.3, 16, 64),
  choices: [],
  initial: {},
  scored: false,
};

export function placeholderScene(sceneId: string, chapterId: string) {
  return (ctx: SceneContext): SceneModule => new PlaceholderScene(ctx, sceneId, chapterId);
}

class PlaceholderScene implements SceneModule {
  readonly id: string;
  readonly #ctx: SceneContext;
  readonly #spec: PlaceholderSpec;
  readonly #chapterId: string;
  readonly #holo: HologramObject;
  #vars: Record<string, string | number | boolean>;
  #picked: Choice | null = null;
  #buttons: DwellButton[] = [];
  #row: HTMLElement | null = null;
  #playStartFrames = -1;
  #spin = 0;

  constructor(ctx: SceneContext, sceneId: string, chapterId: string) {
    this.id = sceneId;
    this.#ctx = ctx;
    this.#chapterId = chapterId;
    this.#spec = PLACEHOLDERS[sceneId] ?? DEFAULT_SPEC;
    this.#vars = { ...this.#spec.initial };
    this.#holo = new HologramObject(this.#spec.geometry(), this.#spec.color);
    this.#holo.root.position.set(0, 0.95, -0.5);
    ctx.world.add(this.#holo.root);
  }

  setFade(value: number): void {
    this.#holo.opacity = value;
    this.#holo.root.scale.setScalar(0.62 + 0.13 * value);
    this.#ctx.hud.style.opacity = String(value);
  }

  update(dtMs: number, timeSec: number): void {
    // Spin faster while the player is choosing: the object reacts to the moment.
    this.#spin += (dtMs / 1000) * (this.#buttons.length > 0 ? 0.6 : 0.25);
    this.#holo.root.rotation.set(Math.sin(timeSec * 0.3) * 0.25, this.#spin, 0);
    this.#holo.root.position.y = 0.95 + Math.sin(timeSec * 0.8) * 0.06;
    this.#holo.update(timeSec);
    if (this.#playStartFrames >= 0 && this.id === 'a-you-are-data') {
      // 33 joints × x, y, z per frame with a tracked body: the honest count of numbers sent.
      this.#vars['numbersCollected'] = (this.#ctx.poseFrames() - this.#playStartFrames) * 99;
    }
  }

  onBeat(beat: Beat): void {
    this.#clearChoices();
    if (beat.type === 'play') {
      this.#playStartFrames = this.#ctx.poseFrames();
      if (this.#spec.choices.length > 0) {
        this.#showChoices('play', this.#spec.choices, () => {
          this.#ctx.signal('finished');
        });
      }
    } else if (this.#playStartFrames >= 0 && this.id === 'a-you-are-data') {
      this.#playStartFrames = -1; // freeze the count at the end of play
    }
  }

  vars() {
    return this.#vars;
  }

  result() {
    return {
      chapterId: this.#chapterId,
      score: this.#spec.scored ? (this.#picked?.score ?? 0.5) : null,
      style: this.#picked?.style ?? {},
    };
  }

  dispose(): void {
    this.#clearChoices();
    this.#holo.root.removeFromParent();
    this.#holo.dispose();
  }

  /** `set` keeps target ids unique: a reused id would inherit the last select's cooldown. */
  #showChoices(set: string, choices: Choice[], then: () => void): void {
    const row = document.createElement('div');
    row.className = 'hud-choices is-entering';
    this.#ctx.hud.append(row);
    this.#row = row;
    this.#buttons = choices.map(
      (choice, i) =>
        new DwellButton(
          row,
          this.#ctx.bus,
          this.#ctx.targets,
          `${this.id}-${set}-${String(i)}`,
          choice.label,
          () => {
            this.#picked = choice;
            Object.assign(this.#vars, choice.vars);
            this.#clearChoices();
            then();
          },
        ),
    );
  }

  #clearChoices(): void {
    for (const b of this.#buttons) b.dispose();
    this.#buttons = [];
    this.#row?.remove();
    this.#row = null;
  }
}
