import {
  BlendFunction,
  BloomEffect,
  EffectComposer,
  EffectPass,
  NoiseEffect,
  RenderPass,
  SMAAEffect,
  VignetteEffect,
} from 'postprocessing';
import { Color, HalfFloatType, PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import { renderConfig } from '../config/render';
import { AdaptiveResolution } from './adaptive-resolution';
import { Stage } from './stage';
import { palette } from '../config/palette';

/** A lost context that is not restored within this long needs a page reload (§14). */
const CONTEXT_RESTORE_TIMEOUT_MS = 3000;

export interface RendererOptions {
  /** Scale the render resolution with the frame rate (default true). */
  adaptive?: boolean;
  /** Called when the GPU context is lost and not restored in time. */
  onFatal?: (reason: string) => void;
  /** Internal resolution cap in device pixels (see config/render.ts). */
  maxInternalHeight?: number;
}

/**
 * One WebGL canvas behind the HUD: the stage plus whatever the active scene adds to `world`,
 * through bloom, SMAA, vignette and film noise (ARCHITECTURE §11.1).
 */
export class Renderer {
  readonly canvas = document.createElement('canvas');
  readonly scene = new Scene();
  /** Scenes add their objects here; the stage sits beside it. */
  readonly world = new Scene();
  readonly camera = new PerspectiveCamera(45, 16 / 9, 0.1, 200);
  readonly stage: Stage;
  readonly #gl: WebGLRenderer;
  readonly #composer: EffectComposer;
  readonly #adaptive: AdaptiveResolution | null;
  readonly #onFatal: (reason: string) => void;
  readonly #maxInternalHeight: number;
  #lost = false;
  #lostTimer = 0;

  constructor(parent: HTMLElement, options: RendererOptions = {}) {
    this.canvas.className = 'render-canvas';
    parent.prepend(this.canvas);
    this.#onFatal = options.onFatal ?? (() => undefined);
    this.#maxInternalHeight = options.maxInternalHeight ?? renderConfig.maxInternalHeight;
    this.#adaptive = options.adaptive === false ? null : new AdaptiveResolution();

    this.#gl = new WebGLRenderer({
      canvas: this.canvas,
      // SMAA in post replaces MSAA; depth is still needed for 3D scenes
      antialias: false,
      stencil: false,
      powerPreference: 'high-performance',
    });
    this.scene.background = new Color(palette.space);
    this.camera.position.set(0, 1.1, 7);
    this.camera.lookAt(0, 0.8, 0);
    this.stage = new Stage();
    this.scene.add(this.stage.root, this.world);

    this.#composer = new EffectComposer(this.#gl, { frameBufferType: HalfFloatType });
    this.#composer.addPass(new RenderPass(this.scene, this.camera));
    this.#composer.addPass(new EffectPass(this.camera, new SMAAEffect()));
    const noise = new NoiseEffect({ blendFunction: BlendFunction.OVERLAY, premultiply: true });
    noise.blendMode.opacity.value = 0.35;
    this.#composer.addPass(
      new EffectPass(
        this.camera,
        new BloomEffect({
          mipmapBlur: true,
          luminanceThreshold: 0.18,
          luminanceSmoothing: 0.3,
          intensity: 1.4,
          radius: 0.7,
        }),
        new VignetteEffect({ offset: 0.3, darkness: 0.65 }),
        noise,
      ),
    );

    this.canvas.addEventListener('webglcontextlost', this.#onLost);
    this.canvas.addEventListener('webglcontextrestored', this.#onRestored);
    window.addEventListener('resize', this.#resize);
    this.#resize();
  }

  /** Current render scale (1 = full internal resolution). */
  get scale(): number {
    return this.#adaptive?.scale ?? 1;
  }

  frame(dtMs: number, nowMs: number): void {
    if (this.#lost) return;
    if (this.#adaptive?.update(dtMs, nowMs)) this.#resize();
    this.stage.update(nowMs / 1000, dtMs / 1000);
    this.#composer.render(dtMs / 1000);
  }

  dispose(): void {
    window.removeEventListener('resize', this.#resize);
    this.canvas.removeEventListener('webglcontextlost', this.#onLost);
    this.canvas.removeEventListener('webglcontextrestored', this.#onRestored);
    window.clearTimeout(this.#lostTimer);
    this.stage.dispose();
    this.#composer.dispose();
    this.#gl.dispose();
    this.canvas.remove();
  }

  readonly #resize = (): void => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const ratio = Math.min(window.devicePixelRatio, this.#maxInternalHeight / height) * this.scale;
    this.#gl.setPixelRatio(ratio);
    this.#composer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.stage.setResolution(height * ratio);
  };

  readonly #onLost = (e: Event): void => {
    // Without preventDefault the browser never tries to restore the context.
    e.preventDefault();
    this.#lost = true;
    this.#lostTimer = window.setTimeout(() => {
      this.#onFatal('webgl context lost and not restored');
    }, CONTEXT_RESTORE_TIMEOUT_MS);
  };

  readonly #onRestored = (): void => {
    window.clearTimeout(this.#lostTimer);
    this.#lost = false;
    this.#resize();
  };
}
