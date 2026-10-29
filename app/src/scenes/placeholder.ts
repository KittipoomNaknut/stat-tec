import type { BufferGeometry } from 'three';
import {
  BoxGeometry,
  IcosahedronGeometry,
  OctahedronGeometry,
  TorusGeometry,
  TorusKnotGeometry,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { DwellButton } from '../hud/dwell-button';
import type { Beat, CeoStyle } from '../narrative/schema';
import type { TemplateVars } from '../narrative/template';
import { HologramObject } from './hologram-object';
import type { SceneContext, SceneModule } from './types';

/**
 * Stand-in chapters (ROADMAP 3.10) so the whole visit can be played with the body before the
 * real scenes exist (Phase 4). Each shows a hologram and, during play, a few choices; a choice
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
  /** Shown when the reveal hits this blocking cue. */
  cueChoices?: { cue: string; choices: Choice[] };
  /** Vars before the player chooses (hints may use them). */
  initial: TemplateVars;
  /** Unscored chapters (A) return score null. */
  scored: boolean;
}

const bars = () =>
  mergeGeometries(
    Array.from({ length: 7 }, (_, i) => {
      const h = 0.5 + Math.abs(Math.sin(i * 0.9)) * 1.6 + (i === 5 ? 1 : 0);
      return new BoxGeometry(0.32, h, 0.32).translate((i - 3) * 0.5, h / 2 - 1, 0);
    }),
  );

const clusters = () =>
  mergeGeometries([
    new IcosahedronGeometry(0.55, 1).translate(-1.2, 0.3, 0),
    new IcosahedronGeometry(0.45, 1).translate(0.9, 0.7, -0.3),
    new IcosahedronGeometry(0.4, 1).translate(0.4, -0.7, 0.4),
  ]);

export const PLACEHOLDERS: Record<string, PlaceholderSpec> = {
  'a-you-are-data': {
    color: '#3fe0ff',
    geometry: () => new IcosahedronGeometry(1.3, 2),
    choices: [],
    initial: { numbersCollected: 0 },
    scored: false,
  },
  'c-coffee-pricing': {
    color: '#ffc857',
    geometry: () => new TorusKnotGeometry(0.9, 0.28, 140, 18),
    choices: [
      {
        label: '฿45',
        vars: { price: 45, revenue: 13_500, optimalPrice: 72, close: false },
        score: 0.55,
        style: { 'risk-taker': 1 },
      },
      {
        label: '฿75',
        vars: { price: 75, revenue: 18_400, optimalPrice: 72, close: true },
        score: 0.95,
        style: { analyst: 1 },
      },
      {
        label: '฿110',
        vars: { price: 110, revenue: 11_000, optimalPrice: 72, close: false },
        score: 0.35,
        style: { 'risk-taker': 1 },
      },
    ],
    initial: {},
    scored: true,
  },
  'd-segmentation': {
    color: '#b18cff',
    geometry: clusters,
    choices: [
      { label: 'ขว้าง 3 ลูก', vars: { magnetsLeft: 0 }, score: 0, style: { intuitive: 0.5 } },
    ],
    cueChoices: {
      cue: 'choose-segment',
      choices: [
        { label: 'สายเปย์', vars: { lift: 18 }, score: 0.9, style: { analyst: 1 } },
        { label: 'ขาประจำ', vars: { lift: 9 }, score: 0.6, style: { intuitive: 1 } },
        { label: 'สายโปร', vars: { lift: 4 }, score: 0.35, style: { 'risk-taker': 1 } },
      ],
    },
    initial: { magnetsLeft: 3 },
    scored: true,
  },
  'f-fraud': {
    color: '#ff4d6d',
    geometry: () => new OctahedronGeometry(1.2, 0),
    choices: [
      {
        label: 'เข้มงวด',
        vars: { caught: 14, aiSeconds: 0.4, falsePositives: 3 },
        score: 0.7,
        style: { 'risk-taker': 1 },
      },
      {
        label: 'สมดุล',
        vars: { caught: 11, aiSeconds: 0.4, falsePositives: 3 },
        score: 0.85,
        style: { analyst: 1 },
      },
      {
        label: 'ปล่อยผ่าน',
        vars: { caught: 5, aiSeconds: 0.4, falsePositives: 3 },
        score: 0.3,
        style: { intuitive: 1 },
      },
    ],
    initial: {},
    scored: true,
  },
  'h-forecast': {
    color: '#3dffa2',
    geometry: bars,
    choices: [
      {
        label: 'ยอดลดลง',
        vars: { playerAcc: 41, aiAcc: 92, beatAi: false },
        score: 0.3,
        style: { 'risk-taker': 1 },
      },
      {
        label: 'พุ่งช่วง 11.11',
        vars: { playerAcc: 94, aiAcc: 92, beatAi: true },
        score: 1,
        style: { analyst: 1 },
      },
      {
        label: 'เท่าเดิม',
        vars: { playerAcc: 68, aiAcc: 92, beatAi: false },
        score: 0.6,
        style: { intuitive: 1 },
      },
    ],
    initial: {},
    scored: true,
  },
};

/** Fallback for a scene id without a spec (keeps the flow playable). */
const DEFAULT_SPEC: PlaceholderSpec = {
  color: '#3fe0ff',
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

  onCue(cue: string): boolean {
    const cueChoices = this.#spec.cueChoices;
    if (cueChoices?.cue !== cue) return false;
    this.#showChoices(cue, cueChoices.choices, () => {
      this.#clearChoices();
      this.#ctx.signal('continue');
    });
    return true;
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
