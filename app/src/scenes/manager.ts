import { Group, type Object3D } from 'three';
import type { SceneContext, SceneFactory, SceneModule } from './types';

/** Crossfade length (ARCHITECTURE §11.3: scene transitions 1200 ms). */
const FADE_MS = 1200;

interface Slot {
  scene: SceneModule;
  root: Group;
  hud: HTMLElement;
  fade: number;
  /** +1 fading in, −1 fading out. */
  dir: 1 | -1;
}

/**
 * Owns the active scene and crossfades between scenes: the old one fades out while the new one
 * fades in, both drawn at once (additive materials, so no render targets or black frames).
 * Each scene gets its own 3D group and HUD layer, removed when it has faded out.
 */
export class SceneManager {
  readonly #world: Object3D;
  readonly #hudParent: HTMLElement;
  readonly #base: Omit<SceneContext, 'world' | 'hud' | 'signal' | 'poseFrames'>;
  readonly #signal: (event: 'gesture' | 'finished' | 'continue') => void;
  #slots: Slot[] = [];
  #poseFrames = 0;
  readonly #fadeMs: number;

  constructor(
    world: Object3D,
    hudParent: HTMLElement,
    base: Omit<SceneContext, 'world' | 'hud' | 'signal' | 'poseFrames'>,
    signal: (event: 'gesture' | 'finished' | 'continue') => void,
    fadeMs = FADE_MS,
  ) {
    this.#world = world;
    this.#hudParent = hudParent;
    this.#base = base;
    this.#signal = signal;
    this.#fadeMs = fadeMs;
  }

  get current(): SceneModule | null {
    return this.#slots.find((s) => s.dir === 1)?.scene ?? null;
  }

  countPoseFrame(): void {
    this.#poseFrames++;
  }

  show(factory: SceneFactory): SceneModule {
    for (const slot of this.#slots) this.#leave(slot);
    const root = new Group();
    const hud = document.createElement('div');
    hud.className = 'scene-hud';
    this.#world.add(root);
    this.#hudParent.append(hud);
    const startFrames = this.#poseFrames;
    const scene = factory({
      ...this.#base,
      world: root,
      hud,
      poseFrames: () => this.#poseFrames - startFrames,
      signal: (event) => {
        // Only the active scene speaks to the story.
        if (this.current === scene) this.#signal(event);
      },
    });
    scene.setFade(0);
    this.#slots.push({ scene, root, hud, fade: 0, dir: 1 });
    return scene;
  }

  update(dtMs: number, timeSec: number): void {
    const step = dtMs / this.#fadeMs;
    for (const slot of this.#slots) {
      slot.fade = Math.min(1, Math.max(0, slot.fade + slot.dir * step));
      slot.scene.setFade(ease(slot.fade));
      slot.scene.update(dtMs, timeSec);
    }
    for (const slot of this.#slots.filter((s) => s.dir === -1 && s.fade === 0)) {
      this.#dispose(slot);
    }
  }

  #leave(slot: Slot): void {
    if (slot.dir === -1) return;
    slot.dir = -1;
    // HUD controls must stop being selectable at once, and fade out with the scene.
    slot.hud.classList.add('is-leaving');
    slot.hud.inert = true;
  }

  #dispose(slot: Slot): void {
    slot.scene.dispose();
    slot.root.removeFromParent();
    slot.hud.remove();
    this.#slots = this.#slots.filter((s) => s !== slot);
  }
}

/** Smoothstep: soft start and end for opacity. */
function ease(t: number): number {
  return t * t * (3 - 2 * t);
}
