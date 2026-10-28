import { playerLockConfig } from '../config/player-lock';
import { Landmark, shoulderWidthPx } from './landmarks';
import { LANDMARK_COUNT, LANDMARK_STRIDE } from './protocol';

export type LockState = 'searching' | 'candidate' | 'locked' | 'lost';

export interface LockResult {
  state: LockState;
  /** Increments every time a new person is locked; 0 before the first lock. */
  playerId: number;
  /** Index of the player's pose in this frame, or −1 when not locked or not visible. */
  playerIndex: number;
  /** Other distinct people in frame — duplicates of one person are merged away. */
  otherIndices: number[];
}

interface Candidate {
  index: number;
  /** Torso center; both axes in frame-width units so distances are isotropic. */
  x: number;
  y: number;
  /** Shoulder width as a fraction of frame width. */
  sw: number;
  confidence: number;
  score: number;
}

const TORSO = [
  Landmark.LEFT_SHOULDER,
  Landmark.RIGHT_SHOULDER,
  Landmark.LEFT_HIP,
  Landmark.RIGHT_HIP,
] as const;

/**
 * Chooses one player and keeps them (docs/ARCHITECTURE.md §5.3):
 * searching → candidate (centered, close, held 500 ms) → locked → lost (missing) → back or forget.
 * Never switches to someone else while a player is locked, even if they score higher.
 */
export class PlayerLock {
  readonly #config: typeof playerLockConfig;
  #state: LockState = 'searching';
  #playerId = 0;
  #since = 0;
  #lastSeen = 0;
  #x = 0;
  #y = 0;

  constructor(config: typeof playerLockConfig = playerLockConfig) {
    this.#config = config;
  }

  update(
    data: Float32Array,
    poseCount: number,
    width: number,
    height: number,
    tMs: number,
  ): LockResult {
    const c = this.#config;
    const candidates = this.#candidates(data, poseCount, width, height);
    let player: Candidate | undefined;

    switch (this.#state) {
      case 'searching': {
        const best = candidates
          .filter((k) => this.#eligible(k))
          .reduce<Candidate | undefined>((a, k) => (a && a.score >= k.score ? a : k), undefined);
        if (best) {
          this.#state = 'candidate';
          this.#since = tMs;
          this.#moveTo(best);
        }
        break;
      }
      case 'candidate': {
        const same = this.#nearest(candidates, c.trackRadius);
        if (!same || !this.#eligible(same)) {
          this.#state = 'searching';
          break;
        }
        this.#moveTo(same);
        if (tMs - this.#since >= c.lockAfterMs) {
          this.#state = 'locked';
          this.#playerId++;
          this.#lastSeen = tMs;
          player = same;
        }
        break;
      }
      case 'locked': {
        player = this.#nearest(candidates, c.trackRadius);
        if (player) {
          this.#moveTo(player);
          this.#lastSeen = tMs;
        } else if (tMs - this.#lastSeen > c.lostAfterMs) {
          this.#state = 'lost';
        }
        break;
      }
      case 'lost': {
        player = this.#nearest(candidates, c.returnRadius);
        if (player) {
          this.#state = 'locked';
          this.#moveTo(player);
          this.#lastSeen = tMs;
        } else if (tMs - this.#lastSeen > c.forgetAfterMs) {
          this.#state = 'searching';
        }
        break;
      }
    }

    return {
      state: this.#state,
      playerId: this.#playerId,
      playerIndex: player?.index ?? -1,
      otherIndices: candidates.filter((k) => k !== player).map((k) => k.index),
    };
  }

  /** Confident poses with one entry per person: overlapping duplicates keep the most confident. */
  #candidates(data: Float32Array, poseCount: number, width: number, height: number): Candidate[] {
    const c = this.#config;
    const all: Candidate[] = [];
    for (let p = 0; p < poseCount; p++) {
      let x = 0;
      let y = 0;
      let confidence = 0;
      for (const i of TORSO) {
        const k = (p * LANDMARK_COUNT + i) * LANDMARK_STRIDE;
        x += data[k] ?? 0;
        y += data[k + 1] ?? 0;
        confidence += data[k + 3] ?? 0;
      }
      confidence /= TORSO.length;
      if (confidence < c.minConfidence) continue;
      x /= TORSO.length;
      y = ((y / TORSO.length) * height) / width;
      const sw = shoulderWidthPx(data, width, height, p) / width;
      const centeredness = 1 - Math.abs(x - 0.5) / 0.5;
      const closeness = Math.min(sw / c.closeShoulderWidth, 1);
      const score = c.centerWeight * centeredness + (1 - c.centerWeight) * closeness;
      all.push({ index: p, x, y, sw, confidence, score });
    }

    all.sort((a, b) => b.confidence - a.confidence);
    const distinct: Candidate[] = [];
    for (const k of all) {
      const duplicate = distinct.some(
        (d) =>
          Math.hypot(d.x - k.x, d.y - k.y) < c.duplicateRadiusSW * Math.max(d.sw, k.sw) &&
          Math.max(d.sw, k.sw) / Math.max(Math.min(d.sw, k.sw), 1e-6) < c.duplicateMaxSizeRatio,
      );
      if (!duplicate) distinct.push(k);
    }
    return distinct;
  }

  #eligible(k: Candidate): boolean {
    const c = this.#config;
    return k.x >= c.zoneMinX && k.x <= c.zoneMaxX && k.score >= c.minScore;
  }

  #nearest(candidates: readonly Candidate[], radius: number): Candidate | undefined {
    let best: Candidate | undefined;
    let bestDistance = radius;
    for (const k of candidates) {
      const d = Math.hypot(k.x - this.#x, k.y - this.#y);
      if (d < bestDistance) {
        best = k;
        bestDistance = d;
      }
    }
    return best;
  }

  #moveTo(k: Candidate): void {
    this.#x = k.x;
    this.#y = k.y;
  }
}
