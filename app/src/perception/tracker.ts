import { toBodySpace } from './body-normalizer';
import { shoulderWidthPx } from './landmarks';
import { OneEuroFilterBank, type OneEuroParams } from './one-euro';
import { PlayerLock, type LockResult } from './player-lock';
import { LANDMARK_COUNT, LANDMARK_STRIDE } from './protocol';

/** A gap this long means the player left; start the filter fresh. */
const FILTER_RESET_GAP_MS = 500;

export interface TrackedFrame extends LockResult {
  /** The player's filtered landmarks in image coordinates, or `null` when not visible. */
  player: Float32Array | null;
  /** `player` in body space, or `null` when it cannot be measured. */
  body: Float32Array | null;
}

/**
 * Everything that happens after inference: PlayerLock → One Euro filter → body space.
 * Free of DOM and worker APIs so tests can replay recorded poses through the real pipeline.
 */
export class PoseTracker {
  readonly #lock = new PlayerLock();
  /** One bank per axis (x, y, z), each with one channel per landmark. */
  readonly #filters: OneEuroFilterBank[];
  #lastPlayerAt = -Infinity;
  #filteredPlayerId = 0;

  constructor(filter: OneEuroParams | null) {
    this.#filters = filter
      ? [0, 1, 2].map(() => new OneEuroFilterBank(LANDMARK_COUNT, filter))
      : [];
  }

  process(
    landmarks: Float32Array,
    poseCount: number,
    width: number,
    height: number,
    tMs: number,
  ): TrackedFrame {
    const locked = this.#lock.update(landmarks, poseCount, width, height, tMs);
    if (locked.playerIndex < 0) return { ...locked, player: null, body: null };

    const player = this.#filterPlayer(landmarks, locked, tMs, width, height);
    let body: Float32Array | null = new Float32Array(player.length);
    if (!toBodySpace(player, width, height, body)) body = null;
    return { ...locked, player, body };
  }

  /** Smoothed copy of the player's pose. Speeds are measured in shoulder widths per second. */
  #filterPlayer(
    landmarks: Float32Array,
    locked: LockResult,
    tMs: number,
    w: number,
    h: number,
  ): Float32Array {
    const size = LANDMARK_COUNT * LANDMARK_STRIDE;
    const player = landmarks.slice(locked.playerIndex * size, (locked.playerIndex + 1) * size);
    if (this.#filters.length === 0) return player;
    // A new person must not inherit the previous player's motion history.
    if (
      locked.playerId !== this.#filteredPlayerId ||
      tMs - this.#lastPlayerAt > FILTER_RESET_GAP_MS
    ) {
      for (const f of this.#filters) f.reset();
      this.#filteredPlayerId = locked.playerId;
    }
    this.#lastPlayerAt = tMs;

    const shoulderPx = Math.max(shoulderWidthPx(player, w, h), 1);
    // x and z are normalized by width, y by height.
    const scales = [shoulderPx / w, shoulderPx / h, shoulderPx / w];
    this.#filters.forEach((f, axis) => {
      f.filter(player, tMs, LANDMARK_STRIDE, axis, scales[axis]);
    });
    return player;
  }
}
