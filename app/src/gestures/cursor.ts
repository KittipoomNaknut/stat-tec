import { gestureConfig, type CursorConfig } from '../config/gestures';
import type { Hand } from '../input/intents';
import { Landmark } from '../perception/landmarks';
import { LANDMARK_STRIDE } from '../perception/protocol';

export interface CursorState {
  /** The player is tracked and the hand is seen: the cursor is drawn. */
  visible: boolean;
  /** The hand points: dwell, slap and draw respond. Otherwise the cursor is shown but inert. */
  active: boolean;
  hand: Hand;
  /** Screen position in [0, 1]. */
  x: number;
  y: number;
}

const HANDS = {
  right: {
    wrist: Landmark.RIGHT_WRIST,
    elbow: Landmark.RIGHT_ELBOW,
    shoulder: Landmark.RIGHT_SHOULDER,
  },
  left: {
    wrist: Landmark.LEFT_WRIST,
    elbow: Landmark.LEFT_ELBOW,
    shoulder: Landmark.LEFT_SHOULDER,
  },
} as const;

/** What dwell, slap and draw act on: an inert cursor (hand not pointing) counts as absent. */
export function liveCursor(cursor: CursorState): CursorState {
  return cursor.active || !cursor.visible ? cursor : { ...cursor, visible: false };
}

const otherOf = (h: Hand): Hand => (h === 'right' ? 'left' : 'right');

/**
 * Maps a hand to a screen position. The cursor is always on while the player is tracked
 * (research 024): it follows the pointing hand, or without one the higher hand, and is
 * *active* only while that hand points — raised above the waist with the arm extended — so
 * touching the face or scratching the head never selects, slaps or draws. Pointing must hold
 * `activateAfterMs` first; the followed hand changes only when the other one points, or is
 * clearly higher for a moment (no ping-pong between two hands at the same height).
 */
export class CursorTracker {
  readonly #config: CursorConfig;
  #hand: Hand = 'right';
  #active = false;
  /** Hand that started pointing but has not held long enough yet, and since when. */
  #pending: { hand: Hand; since: number } | null = null;
  /** When the other hand became clearly higher (no hand pointing), or −1. */
  #higherSince = -1;
  #state: CursorState = { visible: false, active: false, hand: 'right', x: 0.5, y: 0.5 };

  constructor(config: CursorConfig = gestureConfig.cursor) {
    this.#config = config;
  }

  /** `body` is the player in body space, or `null` when no player is visible. */
  update(body: Float32Array | null, tMs: number): CursorState {
    const c = this.#config;
    if (!body) {
      this.#active = false;
      this.#pending = null;
      this.#higherSince = -1;
      return this.#hide();
    }

    if (this.#active && !this.#pointing(body, this.#hand, false)) this.#active = false;
    if (!this.#active) {
      const candidates = (['right', 'left'] as const).filter((h) => this.#pointing(body, h, true));
      // Prefer the higher hand when both point.
      candidates.sort((a, b) => y(body, HANDS[a].wrist) - y(body, HANDS[b].wrist));
      const hand = candidates[0];
      if (!hand) {
        this.#pending = null;
      } else if (this.#pending?.hand !== hand) {
        this.#pending = { hand, since: tMs };
      } else if (tMs - this.#pending.since >= c.activateAfterMs) {
        this.#hand = hand;
        this.#active = true;
        this.#pending = null;
        this.#higherSince = -1;
      }
    }
    if (!this.#active) this.#followHigher(body, tMs);

    const hand = this.#hand;
    if (!this.#seen(body, hand)) {
      // A wrist the model briefly cannot see (hanging hands often): the cursor stays where it was,
      // inert, rather than blinking out — the player is still tracked.
      this.#active = false;
      this.#state = { ...this.#state, visible: this.#state.visible, active: false };
      return this.#state;
    }
    const { box } = c;
    const mirror = hand === 'left' ? -1 : 1;
    let sx = (x(body, HANDS[hand].wrist) * mirror - box.x0) / (box.x1 - box.x0);
    if (mirror < 0) sx = 1 - sx;
    const sy = (y(body, HANDS[hand].wrist) - box.y0) / (box.y1 - box.y0);
    this.#state = { visible: true, active: this.#active, hand, x: clamp01(sx), y: clamp01(sy) };
    return this.#state;
  }

  /** No hand points: stay on the current hand unless the other is clearly higher for a moment. */
  #followHigher(body: Float32Array, tMs: number): void {
    const c = this.#config;
    const other = otherOf(this.#hand);
    if (!this.#seen(body, other)) {
      this.#higherSince = -1;
      return;
    }
    if (!this.#seen(body, this.#hand)) {
      this.#hand = other;
      this.#higherSince = -1;
      return;
    }
    // Higher = smaller y (body space, +y down)
    const lead = y(body, HANDS[this.#hand].wrist) - y(body, HANDS[other].wrist);
    if (lead < c.switchMargin) {
      this.#higherSince = -1;
    } else if (this.#higherSince < 0) {
      this.#higherSince = tMs;
    } else if (tMs - this.#higherSince >= c.switchAfterMs) {
      this.#hand = other;
      this.#higherSince = -1;
    }
  }

  #seen(body: Float32Array, hand: Hand): boolean {
    return vis(body, HANDS[hand].wrist) >= this.#config.minVisibility;
  }

  #pointing(body: Float32Array, hand: Hand, activating: boolean): boolean {
    const c = this.#config;
    const { wrist, elbow, shoulder } = HANDS[hand];
    if (vis(body, wrist) < c.minVisibility) return false;
    const hipY = (y(body, Landmark.LEFT_HIP) + y(body, Landmark.RIGHT_HIP)) / 2;
    const above = hipY - y(body, wrist);
    const extension = dist(body, wrist, shoulder);
    // Straight arm: shoulder–wrist distance over the arm's length along the elbow. Unchanged by
    // pointing toward the camera (a straight arm stays a straight line); low for crossed arms.
    const elbowSeen = vis(body, elbow) >= c.minVisibility;
    const straightness = elbowSeen
      ? extension / Math.max(dist(body, shoulder, elbow) + dist(body, elbow, wrist), 1e-6)
      : null;
    // In the zone (research 027): a raised wrist out to the side of the body is pointing even
    // when the arm is not straight — the Kinect idea of engaging by raising the hand into the
    // interaction zone. A folded arm (scratching the head, touching the face) is still out.
    const zone = c.zoneActivate;
    const out = x(body, wrist) * (hand === 'right' ? 1 : -1);
    const inZone =
      zone !== null &&
      above >= c.activateAboveHips &&
      out >= zone.minOut &&
      straightness !== null &&
      straightness >= zone.minStraightness;
    return activating
      ? inZone ||
          (above >= c.activateAboveHips &&
            extension >= c.activateExtension &&
            straightness !== null &&
            straightness >= c.activateStraightness)
      : (c.keepWhileAboveHips !== null && above >= c.keepWhileAboveHips) ||
          (above >= c.releaseAboveHips &&
            (straightness === null || straightness >= c.releaseStraightness) &&
            (extension >= c.deactivateExtension ||
              // Pointing straight at the camera: the arm looks short but stays a straight line.
              (straightness !== null &&
                straightness >= c.foreshortenedStraightness &&
                extension >= c.foreshortenedMinExtension)));
  }

  #hide(): CursorState {
    this.#state = { ...this.#state, visible: false, active: false };
    return this.#state;
  }
}

function x(body: Float32Array, i: number): number {
  return body[i * LANDMARK_STRIDE] ?? 0;
}

function y(body: Float32Array, i: number): number {
  return body[i * LANDMARK_STRIDE + 1] ?? 0;
}

function vis(body: Float32Array, i: number): number {
  return body[i * LANDMARK_STRIDE + 3] ?? 0;
}

function dist(body: Float32Array, a: number, b: number): number {
  return Math.hypot(x(body, a) - x(body, b), y(body, a) - y(body, b));
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}
