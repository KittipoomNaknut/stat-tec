import { playerLockConfig } from '../config/player-lock';
import { bodyScalePx, Landmark } from './landmarks';
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

/** Axis-aligned box of visible landmarks; both axes in frame-width units. */
interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface Candidate {
  index: number;
  /** Torso center; both axes in frame-width units so distances are isotropic. */
  x: number;
  y: number;
  /** Body scale (≈ shoulder width, robust to turning) as a fraction of frame width. */
  scale: number;
  box: Box;
  confidence: number;
  score: number;
}

const TORSO = [
  Landmark.LEFT_SHOULDER,
  Landmark.RIGHT_SHOULDER,
  Landmark.LEFT_HIP,
  Landmark.RIGHT_HIP,
] as const;
const MIN_VISIBILITY = 0.5;
/** A staff pick waits this long for someone to be there, then is dropped. */
const PICK_WAIT_MS = 1000;
/** With no box under the click, the nearest torso this close (frame widths) is taken. */
const PICK_RADIUS = 0.2;

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
  /** Last known player (or candidate): where they were and how big. */
  #tracked: Candidate | null = null;
  /** A staff pick waiting for a frame (image [0, 1] coordinates) and until when it is valid. */
  #pick: { x: number; y: number; until: number } | null = null;

  constructor(config: typeof playerLockConfig = playerLockConfig) {
    this.#config = config;
  }

  /**
   * The staff screen picked whoever is at (x, y) in the image ([0, 1], not mirrored): lock onto
   * them on the next frames (research 035). A visit already running carries on with them (same
   * player id: the game resumes rather than restarting); otherwise they start a new one.
   */
  pick(x: number, y: number, nowMs: number): void {
    this.#pick = { x, y, until: nowMs + PICK_WAIT_MS };
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
    let candidate: Candidate | undefined;

    const picked = this.#takePick(candidates, height / width, tMs);
    if (picked) {
      const running = this.#state === 'locked' || this.#state === 'lost';
      if (!running) this.#playerId++;
      this.#state = 'locked';
      this.#tracked = picked;
      this.#lastSeen = tMs;
      return this.#result(candidates, picked, undefined);
    }

    switch (this.#state) {
      case 'searching': {
        candidate = candidates
          .filter((k) => this.#eligible(k))
          .reduce<Candidate | undefined>((a, k) => (a && a.score >= k.score ? a : k), undefined);
        if (candidate) {
          this.#state = 'candidate';
          this.#since = tMs;
          this.#tracked = candidate;
        }
        break;
      }
      case 'candidate': {
        candidate = this.#match(candidates, c.trackRadius);
        if (!candidate || !this.#eligible(candidate)) {
          this.#state = 'searching';
          this.#tracked = null;
          candidate = undefined;
          break;
        }
        this.#follow(candidate);
        if (tMs - this.#since >= c.lockAfterMs) {
          this.#state = 'locked';
          this.#playerId++;
          this.#lastSeen = tMs;
          player = candidate;
        }
        break;
      }
      case 'locked': {
        player = this.#match(candidates, c.trackRadius);
        if (player) {
          this.#follow(player);
          this.#lastSeen = tMs;
        } else if (candidates.some((k) => this.#isGhost(k))) {
          // Only a broken fit of the player this frame: they are still here, just not usable.
          this.#lastSeen = tMs;
        } else if (tMs - this.#lastSeen > c.lostAfterMs) {
          this.#state = 'lost';
        }
        break;
      }
      case 'lost': {
        player = this.#match(candidates, c.returnRadius);
        if (player) {
          this.#state = 'locked';
          this.#follow(player);
          this.#lastSeen = tMs;
        } else if (tMs - this.#lastSeen > c.forgetAfterMs) {
          this.#state = 'searching';
          this.#tracked = null;
        }
        break;
      }
    }

    return this.#result(candidates, player, candidate);
  }

  #result(
    candidates: readonly Candidate[],
    player: Candidate | undefined,
    candidate: Candidate | undefined,
  ): LockResult {
    const self = player ?? candidate;
    return {
      state: this.#state,
      playerId: this.#playerId,
      playerIndex: player?.index ?? -1,
      otherIndices: candidates.filter((k) => k !== self && !this.#isGhost(k)).map((k) => k.index),
    };
  }

  /** The candidate the staff picked: the one whose box holds the point, else the nearest torso. */
  #takePick(candidates: readonly Candidate[], aspect: number, tMs: number): Candidate | null {
    const p = this.#pick;
    if (!p) return null;
    if (tMs > p.until) {
      this.#pick = null;
      return null;
    }
    const x = p.x;
    const y = p.y * aspect;
    const pad = 0.03;
    const inside = candidates.filter(
      (k) =>
        x >= k.box.x0 - pad && x <= k.box.x1 + pad && y >= k.box.y0 - pad && y <= k.box.y1 + pad,
    );
    const pool = inside.length > 0 ? inside : candidates;
    let best: Candidate | null = null;
    let bestD = inside.length > 0 ? Infinity : PICK_RADIUS;
    for (const k of pool) {
      const d = Math.hypot(k.x - x, k.y - y);
      if (d < bestD) {
        best = k;
        bestD = d;
      }
    }
    if (best) this.#pick = null;
    return best;
  }

  /** Moves the tracked reference to `k`, smoothing its scale. */
  #follow(k: Candidate): void {
    const prev = this.#tracked;
    const a = this.#config.scaleSmoothing;
    this.#tracked = prev ? { ...k, scale: prev.scale + (k.scale - prev.scale) * a } : k;
  }

  /**
   * A broken fit of the tracked player: torso inside the player's last box (padded by one
   * shoulder width for fast moves) and clearly smaller than the player. Seen in recordings when
   * the player turns, swipes or raises both arms.
   */
  #isGhost(k: Candidate): boolean {
    const t = this.#tracked;
    if (!t || this.#state === 'searching') return false;
    const m = t.scale;
    const inside =
      k.x >= t.box.x0 - m && k.x <= t.box.x1 + m && k.y >= t.box.y0 - m && k.y <= t.box.y1 + m;
    return inside && k.scale < t.scale / this.#config.maxScaleChange;
  }

  /** Confident poses, one per person: a fit lying inside a larger one is dropped. */
  #candidates(data: Float32Array, poseCount: number, width: number, height: number): Candidate[] {
    const c = this.#config;
    const aspect = height / width;
    const all: Candidate[] = [];
    for (let p = 0; p < poseCount; p++) {
      const base = p * LANDMARK_COUNT * LANDMARK_STRIDE;
      let x = 0;
      let y = 0;
      let confidence = 0;
      for (const i of TORSO) {
        const k = base + i * LANDMARK_STRIDE;
        x += data[k] ?? 0;
        y += data[k + 1] ?? 0;
        confidence += data[k + 3] ?? 0;
      }
      confidence /= TORSO.length;
      if (confidence < c.minConfidence) continue;

      const box: Box = { x0: 1, y0: aspect, x1: 0, y1: 0 };
      for (let i = 0; i < LANDMARK_COUNT; i++) {
        const k = base + i * LANDMARK_STRIDE;
        if ((data[k + 3] ?? 0) < MIN_VISIBILITY) continue;
        const lx = data[k] ?? 0;
        const ly = (data[k + 1] ?? 0) * aspect;
        box.x0 = Math.min(box.x0, lx);
        box.x1 = Math.max(box.x1, lx);
        box.y0 = Math.min(box.y0, ly);
        box.y1 = Math.max(box.y1, ly);
      }

      x /= TORSO.length;
      y = (y / TORSO.length) * aspect;
      const scale = bodyScalePx(data, width, height, p) / width;
      const centeredness = 1 - Math.abs(x - 0.5) / 0.5;
      const closeness = Math.min(scale / c.closeShoulderWidth, 1);
      const score = c.centerWeight * centeredness + (1 - c.centerWeight) * closeness;
      all.push({ index: p, x, y, scale, box, confidence, score });
    }

    // Largest (most complete) fits first, so a degenerate duplicate is the one dropped.
    all.sort((a, b) => area(b.box) - area(a.box));
    const distinct: Candidate[] = [];
    for (const k of all) {
      if (!distinct.some((d) => containment(k.box, d.box) >= c.duplicateContainment)) {
        distinct.push(k);
      }
    }
    return distinct;
  }

  #eligible(k: Candidate): boolean {
    const c = this.#config;
    return k.x >= c.zoneMinX && k.x <= c.zoneMaxX && k.score >= c.minScore;
  }

  /** Nearest candidate within `radius` of the tracked person and of a similar size. */
  #match(candidates: readonly Candidate[], radius: number): Candidate | undefined {
    const tracked = this.#tracked;
    if (!tracked) return undefined;
    let best: Candidate | undefined;
    let bestDistance = radius;
    for (const k of candidates) {
      const ratio = k.scale / tracked.scale;
      if (ratio > this.#config.maxScaleChange || ratio < 1 / this.#config.maxScaleChange) continue;
      const d = Math.hypot(k.x - tracked.x, k.y - tracked.y);
      if (d < bestDistance) {
        best = k;
        bestDistance = d;
      }
    }
    return best;
  }
}

function area(b: Box): number {
  return Math.max(b.x1 - b.x0, 0) * Math.max(b.y1 - b.y0, 0);
}

/** Share of the smaller box that lies inside the other one. */
function containment(a: Box, b: Box): number {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  if (w <= 0 || h <= 0) return 0;
  return (w * h) / Math.max(Math.min(area(a), area(b)), 1e-9);
}
