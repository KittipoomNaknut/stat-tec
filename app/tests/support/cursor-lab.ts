/**
 * Cursor lab (research 022): replays a recorded playground session through the real pipeline and
 * measures how the cursor behaves, so every change to the cursor is judged on the same numbers.
 *
 * - shake: frame-to-frame jitter (RMS second difference, px at 1080p) while the hand is nearly
 *   still — what the eye sees as trembling (research 015)
 * - holdSpread: RMS distance from the mean while dwelling on a button (px) — how well the
 *   cursor stays put while the player holds
 * - selects / leftTarget: dwell outcomes on the session's own buttons; leftTarget = a dwell that
 *   got past 25% and was abandoned
 * - lag: mean distance (px) from the unsmoothed baseline cursor during fast moves (> 800 px/s)
 * - steady: RMS distance from the mean over the last 600 ms before each select (px) — the
 *   player certainly meant to hold still there (research 022: most "left-target" dwells were
 *   the hand passing over a button on its way to the next)
 * - offset: mean distance from the baseline cursor over all visible frames (px) — how far the
 *   cursor strays from where the hand points
 * - edge: share of frames with the baseline at a screen edge (< 2% from it) where the variant
 *   is also within 4% of that edge — can the cursor still reach the edges
 *
 * The variant under test gets each tracked frame and returns the cursor; the baseline (the
 * shipped tracker without smoothing) always runs alongside as the reference for lag.
 */
import { readFileSync } from 'node:fs';
import { cursorConfigFor } from '../../src/config/gestures';
import { perceptionDefaults } from '../../src/config/perception';
import { CursorTracker, type CursorState } from '../../src/gestures/cursor';
import { DwellDetector } from '../../src/gestures/dwell';
import { TargetRegistry, type Rect } from '../../src/input/targets';
import { PoseTracker, type TrackedFrame } from '../../src/perception/tracker';
import { clipFrames, loadSession } from './pose-session';

export const W = 1920;
export const H = 1080;

export interface CursorMetrics {
  shake: number;
  holdSpread: number;
  selects: number;
  leftTarget: number;
  lag: number;
  steady: number;
  offset: number;
  edge: number;
  /** When each select happened (ms) and on which target, to compare timing between variants. */
  selectLog: { t: number; id: string }[];
  /** Share of frames with a visible cursor. */
  visible: number;
}

/** Turns a tracked frame into a cursor; created fresh for each replay. */
export type CursorVariant = () => (frame: TrackedFrame, tMs: number) => CursorState;

export const SESSIONS = [
  {
    pose: '2026-10-29-adult1-playground-sidezone.pose.json.gz',
    log: '2026-10-29-adult1-sidezone.attempts.json',
  },
  {
    pose: '2026-10-28-adult1-playground-rtmpose.pose.json.gz',
    log: '2026-10-28-adult1-rtmpose.attempts.json',
  },
] as const;

function targetsOf(logFile: string): TargetRegistry {
  const url = new URL(`../fixtures/playground/${logFile}`, import.meta.url);
  const log = JSON.parse(readFileSync(url, 'utf8')) as { targets: Record<string, Rect> };
  const targets = new TargetRegistry();
  for (const [id, rect] of Object.entries(log.targets)) targets.register(id, () => rect);
  return targets;
}

export async function measure(
  session: (typeof SESSIONS)[number],
  variant: CursorVariant,
): Promise<CursorMetrics> {
  const recording = await loadSession(session.pose);
  const clip = recording.clips[0];
  if (!clip) throw new Error('empty session');
  const targets = targetsOf(session.log);
  const tracker = new PoseTracker(perceptionDefaults.filter);
  const baseline = new CursorTracker(cursorConfigFor('server'));
  const cursorOf = variant();
  const dwell = new DwellDetector();
  dwell.update({ visible: false, hand: 'right', x: 0, y: 0 }, targets, -1);

  let frames = 0;
  let visible = 0;
  let selects = 0;
  let leftTarget = 0;
  // Shake on frames where the baseline hand is nearly still (same frames for every variant)
  const raws: CursorState[] = [];
  const outs: CursorState[] = [];
  let shakeSum = 0;
  let shakeN = 0;
  // Lag on fast baseline moves
  let lagSum = 0;
  let lagN = 0;
  let prevRaw: { x: number; y: number; t: number } | null = null;
  let offSum = 0;
  let offN = 0;
  let edgeAt = 0;
  let edgeOk = 0;
  const recent: { x: number; y: number; t: number }[] = [];
  let steadySum = 0;
  let steadyN = 0;
  const selectLog: { t: number; id: string }[] = [];
  // Dwell segments
  let progress = 0;
  let hold: { x: number; y: number }[] = [];
  let spreadSum = 0;
  let spreadN = 0;
  const closeHold = () => {
    if (hold.length >= 18) {
      const mx = hold.reduce((s, p) => s + p.x, 0) / hold.length;
      const my = hold.reduce((s, p) => s + p.y, 0) / hold.length;
      const ms =
        hold.reduce((s, p) => s + ((p.x - mx) * W) ** 2 + ((p.y - my) * H) ** 2, 0) / hold.length;
      spreadSum += Math.sqrt(ms);
      spreadN++;
    }
    hold = [];
  };

  for (const f of clipFrames(clip)) {
    frames++;
    const r = tracker.process(
      f.landmarks,
      f.poseCount,
      recording.camera.width,
      recording.camera.height,
      f.t,
    );
    const raw = { ...baseline.update(r.state === 'locked' ? r.body : null, f.t) };
    const c = cursorOf(r, f.t);
    if (c.visible) visible++;

    if (c.visible) {
      recent.push({ x: c.x, y: c.y, t: f.t });
      while (recent.length > 1 && f.t - (recent[0]?.t ?? f.t) > 600) recent.shift();
    } else recent.length = 0;
    if (raw.visible && c.visible) {
      offSum += Math.hypot((c.x - raw.x) * W, (c.y - raw.y) * H);
      offN++;
      const atEdge = (v: number) => (v < 0.02 ? -1 : v > 0.98 ? 1 : 0);
      for (const [rv, cv] of [
        [raw.x, c.x],
        [raw.y, c.y],
      ] as const) {
        const side = atEdge(rv);
        if (side !== 0) {
          edgeAt++;
          if (side < 0 ? cv < 0.04 : cv > 0.96) edgeOk++;
        }
      }
    }

    for (const e of dwell.update(c, targets, f.t)) {
      if (e.type === 'select') {
        if (recent.length >= 15) {
          const mx = recent.reduce((q, p) => q + p.x, 0) / recent.length;
          const my = recent.reduce((q, p) => q + p.y, 0) / recent.length;
          const ms =
            recent.reduce((q, p) => q + ((p.x - mx) * W) ** 2 + ((p.y - my) * H) ** 2, 0) /
            recent.length;
          steadySum += Math.sqrt(ms);
          steadyN++;
        }
        selects++;
        selectLog.push({ t: f.t, id: e.targetId });
        progress = 0;
        closeHold();
      } else if (e.progress === 0) {
        if (progress >= 0.25) leftTarget++;
        progress = 0;
        closeHold();
      } else {
        progress = Math.max(progress, e.progress);
        hold.push({ x: c.x, y: c.y });
      }
    }

    if (raw.visible && prevRaw) {
      const dt = (f.t - prevRaw.t) / 1000;
      const speed = Math.hypot((raw.x - prevRaw.x) * W, (raw.y - prevRaw.y) * H) / dt;
      if (speed > 800 && c.visible) {
        lagSum += Math.hypot((c.x - raw.x) * W, (c.y - raw.y) * H);
        lagN++;
      }
    }
    prevRaw = raw.visible ? { x: raw.x, y: raw.y, t: f.t } : null;

    if (!raw.visible || !c.visible) {
      raws.length = 0;
      outs.length = 0;
      continue;
    }
    raws.push(raw);
    outs.push({ ...c });
    if (raws.length > 9) {
      raws.shift();
      outs.shift();
    }
    if (raws.length < 9) continue;
    const first = raws[0] as CursorState;
    const last = raws[8] as CursorState;
    if (Math.hypot(last.x - first.x, last.y - first.y) > 0.04) continue;
    const [a, b, d] = outs.slice(-3) as [CursorState, CursorState, CursorState];
    shakeSum += ((d.x - 2 * b.x + a.x) * W) ** 2 + ((d.y - 2 * b.y + a.y) * H) ** 2;
    shakeN++;
  }
  return {
    shake: Math.sqrt(shakeSum / Math.max(shakeN, 1)),
    holdSpread: spreadSum / Math.max(spreadN, 1),
    selects,
    leftTarget,
    lag: lagSum / Math.max(lagN, 1),
    steady: steadySum / Math.max(steadyN, 1),
    offset: offSum / Math.max(offN, 1),
    edge: edgeAt ? edgeOk / edgeAt : 1,
    selectLog,
    visible: visible / Math.max(frames, 1),
  };
}

/**
 * Mean delay (ms) of the variant's selects against a reference run: each reference select is
 * matched to the variant's first select of the same target within 3 s after it (or before it).
 */
export function selectDelay(variant: CursorMetrics, reference: CursorMetrics): number {
  const used = new Set<number>();
  let sum = 0;
  let n = 0;
  for (const r of reference.selectLog) {
    const i = variant.selectLog.findIndex(
      (v, k) => !used.has(k) && v.id === r.id && Math.abs(v.t - r.t) < 3000,
    );
    if (i < 0) continue;
    used.add(i);
    sum += (variant.selectLog[i]?.t ?? r.t) - r.t;
    n++;
  }
  return n ? sum / n : 0;
}

export function format(name: string, m: CursorMetrics): string {
  return [
    name.padEnd(34),
    `shake ${m.shake.toFixed(2).padStart(5)}`,
    `hold ${m.holdSpread.toFixed(1).padStart(5)}`,
    `sel ${String(m.selects).padStart(2)}`,
    `left ${String(m.leftTarget).padStart(2)}`,
    `lag ${m.lag.toFixed(0).padStart(3)}`,
    `steady ${m.steady.toFixed(1).padStart(5)}`,
    `off ${m.offset.toFixed(0).padStart(3)}`,
    `edge ${(m.edge * 100).toFixed(0).padStart(3)}%`,
    `vis ${(m.visible * 100).toFixed(0)}%`,
  ].join('  ');
}
