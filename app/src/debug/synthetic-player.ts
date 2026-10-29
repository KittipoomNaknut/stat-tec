import { gestureConfig } from '../config/gestures';
import type { LockState } from '../perception/player-lock';
import { LANDMARK_COUNT, LANDMARK_STRIDE } from '../perception/protocol';
import { Landmark } from '../perception/landmarks';

/** What a synthetic player sends each tick (the same shape the gesture engine takes). */
export interface SyntheticFrame {
  lock: LockState;
  playerId: number;
  body: Float32Array | null;
}

type Point = readonly [number, number];

const RATE_HZ = 30;
const SHOULDER: Point = [0.5, 0];
const HIP_Y = 1.55; // torso ≈ shoulder width / 0.65 (TORSO_TO_SHOULDER_WIDTH)
const REST_WRIST: Point = [0.65, 1.5];
/** Arm raised out to the side: extended, straight and high, so the cursor activates. */
const RAISED_WRIST: Point = [1.5, -0.3];
const RAISE_MS = 150;
const GLIDE_MS = 300;
/**
 * Hold the raised arm before aiming, like a person does. The cursor needs 100 ms of steady
 * pointing to activate; 150 ms left too little margin on a loaded CI machine (research 015).
 */
const AIM_DELAY_MS = 400;

/**
 * A scripted body for end-to-end tests (`?player=synthetic`): no camera, but the real gesture
 * engine — presence, cursor activation and dwell — sees a standing person in body space.
 * Playwright drives it through `window.statTecSynthetic`.
 *
 * Pointing works like a person would: raise the right arm out to the side, then glide the
 * wrist to where the cursor should be, inside the side interaction zone (config/gestures.ts).
 */
export class SyntheticPlayer {
  #lock: LockState = 'searching';
  #playerId = 0;
  #wrist: Point = REST_WRIST;
  #path: { from: Point; to: Point; start: number; ms: number }[] = [];
  readonly #body = new Float32Array(LANDMARK_COUNT * LANDMARK_STRIDE);

  constructor(emit: (frame: SyntheticFrame, nowMs: number) => void) {
    setInterval(() => {
      const now = performance.now();
      emit(this.#frame(now), now);
    }, 1000 / RATE_HZ);
  }

  /** A new person steps in and is locked on. */
  enter(): void {
    this.#playerId++;
    this.#lock = 'locked';
    this.#wrist = REST_WRIST;
    this.#path = [];
  }

  /** Steps out of view (the lock is lost but remembered). */
  lose(): void {
    this.#lock = 'lost';
  }

  /** Comes back into view as the same person. */
  return(): void {
    this.#lock = 'locked';
  }

  /** Gone for good. */
  leave(): void {
    this.#lock = 'searching';
  }

  /**
   * Points the cursor at screen position (x, y) in [0, 1], gliding there in `ms` (a short glide
   * across the screen is a sweep fast enough to slap).
   */
  pointAt(x: number, y: number, ms = GLIDE_MS): void {
    const { box } = gestureConfig.cursor;
    const target: Point = [box.x0 + x * (box.x1 - box.x0), box.y0 + y * (box.y1 - box.y0)];
    const now = performance.now();
    const raised = this.#wrist[1] < HIP_Y - 1; // already pointing: just glide
    this.#path = raised
      ? [{ from: this.#wrist, to: target, start: now, ms }]
      : [
          { from: this.#wrist, to: RAISED_WRIST, start: now, ms: RAISE_MS },
          { from: RAISED_WRIST, to: target, start: now + RAISE_MS + AIM_DELAY_MS, ms },
        ];
  }

  /** Lowers the arm (no cursor). */
  rest(): void {
    this.#path = [{ from: this.#wrist, to: REST_WRIST, start: performance.now(), ms: RAISE_MS }];
  }

  #frame(now: number): SyntheticFrame {
    for (const leg of this.#path) {
      if (now < leg.start) break;
      const t = Math.min(1, (now - leg.start) / leg.ms);
      this.#wrist = [lerp(leg.from[0], leg.to[0], t), lerp(leg.from[1], leg.to[1], t)];
    }
    if (this.#lock !== 'locked') return { lock: this.#lock, playerId: this.#playerId, body: null };
    const b = this.#body;
    const set = (i: number, [x, y]: Point) => {
      b[i * LANDMARK_STRIDE] = x;
      b[i * LANDMARK_STRIDE + 1] = y;
      b[i * LANDMARK_STRIDE + 3] = 1;
    };
    const mirror = ([x, y]: Point): Point => [-x, y];
    const [wx, wy] = this.#wrist;
    set(Landmark.NOSE, [0, -0.6]);
    set(Landmark.RIGHT_SHOULDER, SHOULDER);
    set(Landmark.LEFT_SHOULDER, mirror(SHOULDER));
    // A straight arm: the elbow halfway between shoulder and wrist.
    set(Landmark.RIGHT_ELBOW, [(SHOULDER[0] + wx) / 2, (SHOULDER[1] + wy) / 2]);
    set(Landmark.RIGHT_WRIST, this.#wrist);
    set(Landmark.LEFT_ELBOW, mirror([0.6, 0.8]));
    set(Landmark.LEFT_WRIST, mirror(REST_WRIST));
    set(Landmark.RIGHT_HIP, [0.35, HIP_Y]);
    set(Landmark.LEFT_HIP, [-0.35, HIP_Y]);
    return { lock: 'locked', playerId: this.#playerId, body: b };
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
