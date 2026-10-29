import type { Group } from 'three';
import type { IntentBus } from '../input/intent-bus';
import type { TargetRegistry } from '../input/targets';
import type { Beat } from '../narrative/schema';
import type { TemplateVars } from '../narrative/template';
import type { ChapterOutcome } from '../scoring/profit';

/** What a scene gets from the app (ARCHITECTURE §5.10). */
export interface SceneContext {
  /** 3D objects go here (inside the renderer's world). */
  world: Group;
  /** Scene-owned HUD elements (choices, labels) go here; cleared on exit. */
  hud: HTMLElement;
  bus: IntentBus;
  targets: TargetRegistry;
  /** Pose frames with a tracked player since the scene started (for "you are data"). */
  poseFrames(): number;
  /** Tell the narrative something happened. */
  signal(event: 'gesture' | 'finished' | 'continue'): void;
}

/**
 * A chapter's visuals and interaction. The narrative engine drives the story; the scene reacts
 * to beats and cues, shows what the player does, and reports vars and the outcome.
 */
export interface SceneModule {
  readonly id: string;
  /** 0..1 visibility, animated by the scene manager for crossfades. */
  setFade(value: number): void;
  update(dtMs: number, timeSec: number): void;
  onBeat?(beat: Beat): void;
  /** Return true to hold the story until the scene signals `continue`. */
  onCue?(cue: string): boolean;
  vars(): TemplateVars;
  /** Chapters only; welcome/attract/report return null. */
  result(): ChapterOutcome | null;
  dispose(): void;
}

export type SceneFactory = (ctx: SceneContext) => SceneModule;
