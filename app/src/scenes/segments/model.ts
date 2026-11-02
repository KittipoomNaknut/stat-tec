/**
 * EPISODE III — "สามกลุ่มแห่งลูกค้า": 600 customers of Data Café and the K-means the AI runs on
 * them. Customers are points in (visits per month, spend per visit), scaled to [0, 1] so both
 * axes count equally. Every number on screen comes from here.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Segment {
  id: 'big-spender' | 'regular' | 'promo';
  name: string;
  description: string;
  /** Center and spread in the [0, 1] feature space. */
  center: Point;
  spread: Point;
  count: number;
  /** Extra sales if the ad budget goes to this group (simulated, %). */
  lift: number;
}

/** Axes: visits per month 0–30 → x, spend per visit ฿0–500 → y. */
export const AXES = {
  x: { label: 'มาร้าน (ครั้ง / เดือน)', max: 30 },
  y: { label: 'ใช้จ่ายต่อครั้ง (฿)', max: 500 },
} as const;

/** The three groups hidden in the data — the AI does not know these. */
export const SEGMENTS: readonly Segment[] = [
  {
    id: 'big-spender',
    name: 'สายเปย์',
    description: 'มาไม่บ่อย แต่จ่ายหนัก',
    center: { x: 0.14, y: 0.74 },
    spread: { x: 0.06, y: 0.09 },
    count: 150,
    lift: 18,
  },
  {
    id: 'regular',
    name: 'ขาประจำ',
    description: 'มาทุกวัน ซื้อแก้วเดิม',
    center: { x: 0.74, y: 0.28 },
    spread: { x: 0.09, y: 0.07 },
    count: 250,
    lift: 9,
  },
  {
    id: 'promo',
    name: 'สายโปร',
    description: 'มาเฉพาะวันลดราคา',
    center: { x: 0.36, y: 0.16 },
    spread: { x: 0.07, y: 0.05 },
    count: 200,
    lift: 4,
  },
];

function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

/** Standard normal (Box–Muller). */
function gaussian(random: () => number): number {
  const u = Math.max(random(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
}

const clamp01 = (v: number) => Math.min(0.99, Math.max(0.01, v));

/** The customers, with the group each truly belongs to (for checks only). */
export function customers(seed = 31_10_2026): { points: Point[]; truth: number[] } {
  const random = seeded(seed);
  const points: Point[] = [];
  const truth: number[] = [];
  SEGMENTS.forEach((s, g) => {
    for (let i = 0; i < s.count; i++) {
      points.push({
        x: clamp01(s.center.x + gaussian(random) * s.spread.x),
        y: clamp01(s.center.y + gaussian(random) * s.spread.y),
      });
      truth.push(g);
    }
  });
  // Shuffle so the groups are not drawn one after another
  for (let i = points.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [points[i], points[j]] = [points[j] as Point, points[i] as Point];
    [truth[i], truth[j]] = [truth[j] as number, truth[i] as number];
  }
  return { points, truth };
}

const dist2 = (a: Point, b: Point) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

/** Index of the nearest center for every point. */
export function assign(points: readonly Point[], centers: readonly Point[]): number[] {
  return points.map((p) => {
    let best = 0;
    let bestD = Infinity;
    centers.forEach((c, k) => {
      const d = dist2(p, c);
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    });
    return best;
  });
}

/** Sum of squared distances from every point to its center. */
export function sse(
  points: readonly Point[],
  centers: readonly Point[],
  labels = assign(points, centers),
): number {
  return points.reduce((s, p, i) => s + dist2(p, centers[labels[i] ?? 0] ?? p), 0);
}

export interface Iteration {
  centers: Point[];
  labels: number[];
  sse: number;
}

/**
 * Lloyd's K-means from given starting centers: assign → move each center to the mean of its
 * points → repeat until nothing changes. Returns every step (for the animation).
 */
export function kmeans(
  points: readonly Point[],
  start: readonly Point[],
  maxSteps = 20,
): Iteration[] {
  let centers = start.map((c) => ({ ...c }));
  let labels = assign(points, centers);
  const steps: Iteration[] = [{ centers, labels, sse: sse(points, centers, labels) }];
  for (let step = 0; step < maxSteps; step++) {
    const moved = centers.map((c, k) => {
      let sx = 0;
      let sy = 0;
      let n = 0;
      points.forEach((p, i) => {
        if (labels[i] === k) {
          sx += p.x;
          sy += p.y;
          n++;
        }
      });
      return n > 0 ? { x: sx / n, y: sy / n } : c;
    });
    const next = assign(points, moved);
    centers = moved;
    const same = next.every((l, i) => l === labels[i]);
    labels = next;
    steps.push({ centers, labels, sse: sse(points, centers, labels) });
    if (same) break;
  }
  return steps;
}

/** k-means++ start (deterministic), then Lloyd; best of a few restarts. For the elbow chart. */
export function bestKmeans(points: readonly Point[], k: number, seed = 7, restarts = 4): Iteration {
  const random = seeded(seed + k * 101);
  let best: Iteration | null = null;
  for (let r = 0; r < restarts; r++) {
    const start: Point[] = [points[Math.floor(random() * points.length)] as Point];
    while (start.length < k) {
      const d = points.map((p) => Math.min(...start.map((c) => dist2(p, c))));
      const total = d.reduce((a, b) => a + b, 0);
      let pick = random() * total;
      let i = 0;
      while (i < d.length - 1 && pick > (d[i] ?? 0)) pick -= d[i++] ?? 0;
      start.push(points[i] as Point);
    }
    const end = kmeans(points, start).at(-1);
    if (end && (!best || end.sse < best.sse)) best = end;
  }
  if (!best) throw new Error('no k-means result');
  return best;
}

/**
 * SSE for k = 1 … maxK, and the elbow by the Kneedle rule: on the normalized curve, the k
 * farthest below the straight line from the first point to the last. (A second-difference
 * rule picked k = 2 when the first drop dwarfed the rest — research 018.)
 */
export function elbow(points: readonly Point[], maxK = 6): { sse: number[]; k: number } {
  const curve = Array.from({ length: maxK }, (_, i) => bestKmeans(points, i + 1).sse);
  const first = curve[0] ?? 1;
  const last = curve[maxK - 1] ?? 0;
  let k = 1;
  let gap = -Infinity;
  curve.forEach((v, i) => {
    const x = i / (maxK - 1);
    const y = (v - last) / (first - last);
    const below = 1 - x - y; // chord from (0, 1) to (1, 0)
    if (below > gap) {
      gap = below;
      k = i + 1;
    }
  });
  return { sse: curve, k };
}

/**
 * The AI's blind guess: three centers stacked along the right edge, where few customers are.
 * Clearly wrong, yet it settles on the true groups in steps that each look better (research
 * 018 — a guess bunched in one corner got stuck splitting one group in two).
 */
export const BLIND_START: readonly Point[] = [
  { x: 0.92, y: 0.2 },
  { x: 0.92, y: 0.5 },
  { x: 0.92, y: 0.8 },
];

/** SSE in the [0, 1] feature space is small; shown ×1000 so the counter reads as a number. */
export const SSE_SCALE = 1000;

/** Which true segment a found cluster matches (by its center). */
export function matchSegment(center: Point): Segment {
  let best = SEGMENTS[0] as Segment;
  for (const s of SEGMENTS) if (dist2(center, s.center) < dist2(center, best.center)) best = s;
  return best;
}
