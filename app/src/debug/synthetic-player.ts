import { gestureConfig } from '../config/gestures';
import type { LockState } from '../perception/player-lock';
import { LANDMARK_COUNT, LANDMARK_STRIDE } from '../perception/protocol';
import { Landmark } from '../perception/landmarks';
import type { PoseName } from '../gestures/pose';

/** What a synthetic player sends each tick (the same shape the gesture engine takes). */
export interface SyntheticFrame {
  lock: LockState;
  playerId: number;
  body: Float32Array | null;
}

type Point = readonly [number, number];

const RATE_HZ = 30;
/** Wrists for each pose, right then left (body space, the player's right is +x). */
const POSE_WRISTS: Record<PoseName, readonly [Point, Point]> = {
  'both-up': [
    [0.6, -1.3],
    [-0.6, -1.3],
  ],
  'left-up': [
    [0.65, 1.5],
    [-0.6, -1.3],
  ],
  'right-up': [
    [0.6, -1.3],
    [-0.65, 1.5],
  ],
  't-pose': [
    [1.9, 0],
    [-1.9, 0],
  ],
  cross: [
    [-0.35, 0.6],
    [0.35, 0.6],
  ],
};
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
  /** A held pose overrides both arms until `rest()` or `pointAt()`. */
  #pose: PoseName | null = null;
  #path: { from: Point; to: Point; start: number; ms: number }[] = [];
  /** Both wrists held by `hands()`, right then left; cleared by any other move. */
  #held: readonly [Point, Point] | null = null;
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
  /** Strikes and holds a pose with both arms (research 025). */
  pose(name: PoseName): void {
    this.#pose = name;
    this.#held = null;
  }

  pointAt(x: number, y: number, ms = GLIDE_MS): void {
    this.#pose = null;
    this.#held = null;
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

  /** Holds both wrists where given (body space, the player's right is +x): steering a chart. */
  hands(right: Point | null, left: Point | null): void {
    this.#pose = null;
    this.#held = [right ?? REST_WRIST, left ?? mirror(REST_WRIST)];
  }

  /** Lowers the arm (no cursor). */
  rest(): void {
    this.#pose = null;
    this.#held = null;
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
    const posed = this.#pose ? POSE_WRISTS[this.#pose] : this.#held;
    const rightWrist = posed ? posed[0] : this.#wrist;
    const leftWrist = posed ? posed[1] : mirror(REST_WRIST);
    const [wx, wy] = rightWrist;
    set(Landmark.NOSE, [0, -0.6]);
    set(Landmark.RIGHT_SHOULDER, SHOULDER);
    set(Landmark.LEFT_SHOULDER, mirror(SHOULDER));
    // A straight arm: the elbow halfway between shoulder and wrist.
    set(Landmark.RIGHT_ELBOW, [(SHOULDER[0] + wx) / 2, (SHOULDER[1] + wy) / 2]);
    set(Landmark.RIGHT_WRIST, rightWrist);
    set(
      Landmark.LEFT_ELBOW,
      posed ? [(-SHOULDER[0] + leftWrist[0]) / 2, leftWrist[1] / 2] : mirror([0.6, 0.8]),
    );
    set(Landmark.LEFT_WRIST, leftWrist);
    set(Landmark.RIGHT_HIP, [0.35, HIP_Y]);
    set(Landmark.LEFT_HIP, [-0.35, HIP_Y]);
    return { lock: 'locked', playerId: this.#playerId, body: b };
  }
}

function mirror([x, y]: Point): Point {
  return [-x, y];
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
