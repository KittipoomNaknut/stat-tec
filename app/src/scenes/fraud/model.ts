/**
 * EPISODE IV — "จับโกงข้ามกาแล็กซี": card transactions and the anomaly detector the AI runs on
 * them. A transaction is a point in (distance from the cardholder's home, amount), both on a log
 * scale mapped to [0, 1]. The AI scores how far each point lies from "normal" (Mahalanobis
 * distance from the mean and spread of all transactions); a ring of radius r flags everything
 * outside it. Every number on screen comes from here (research 020).
 */

export interface Point {
  x: number;
  y: number;
}

export interface Transaction extends Point {
  fraud: boolean;
  km: number;
  baht: number;
}

/** Log axes: 0.3–10,000 km → x, ฿20–200,000 → y. */
export const AXES = {
  x: { label: 'ระยะจากบ้านเจ้าของบัตร (กม.)', min: 0.3, max: 10_000 },
  y: { label: 'ยอดเงิน (฿)', min: 20, max: 200_000 },
} as const;

export const TOTAL = 1_000_000;
/** Share of transactions that are fraud in the big set (real card fraud is far rarer; 1% shows). */
export const FRAUD_RATE = 0.01;
/** What a mistake costs (simulated): a fraud let through, a good customer's card blocked. */
export const COST = { missed: 6_000, blocked: 150 } as const;
/** The ring sizes the player can choose (in standard deviations). */
export const RING = { min: 1.2, max: 5 } as const;

const LOG_X = { lo: Math.log10(AXES.x.min), hi: Math.log10(AXES.x.max) };
const LOG_Y = { lo: Math.log10(AXES.y.min), hi: Math.log10(AXES.y.max) };

export const toPlot = (km: number, baht: number): Point => ({
  x: (Math.log10(km) - LOG_X.lo) / (LOG_X.hi - LOG_X.lo),
  y: (Math.log10(baht) - LOG_Y.lo) / (LOG_Y.hi - LOG_Y.lo),
});

/** Plot y back to baht (for axis ticks). */
export const bahtAt = (y: number) => 10 ** (LOG_Y.lo + y * (LOG_Y.hi - LOG_Y.lo));
export const kmAt = (x: number) => 10 ** (LOG_X.lo + x * (LOG_X.hi - LOG_X.lo));

export function seeded(seed: number): () => number {
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

/**
 * Kinds of fraud, as (log10 km, log10 ฿) means and spreads, with their share. Near-but-big and
 * far-but-small overlap the tail of normal spending on purpose: no ring catches everything
 * without blocking someone.
 */
const FRAUD_KINDS = [
  { share: 0.5, km: [3.2, 0.45], baht: [3.9, 0.45] }, // overseas, big
  { share: 0.3, km: [1.0, 0.45], baht: [3.55, 0.3] }, // stolen card used nearby, big
  { share: 0.2, km: [2.6, 0.5], baht: [1.7, 0.3] }, // far away, tiny "test" charges
] as const;

/** One transaction (log10 km, log10 ฿), normal or fraud. */
function draw(random: () => number, fraud: boolean): [number, number] {
  if (!fraud) {
    const a = gaussian(random);
    const b = gaussian(random);
    // Typical spending: ~5 km from home, ~฿320, a bit more when farther (a trip)
    return [0.7 + 0.42 * a, 2.5 + 0.38 * (0.3 * a + 0.954 * b)];
  }
  let pick = random();
  for (const kind of FRAUD_KINDS) {
    pick -= kind.share;
    if (pick <= 0 || kind === FRAUD_KINDS.at(-1)) {
      return [
        kind.km[0] + kind.km[1] * gaussian(random),
        kind.baht[0] + kind.baht[1] * gaussian(random),
      ];
    }
  }
  return [0, 0];
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function transaction(random: () => number, fraud: boolean): Transaction {
  const [lk, lb] = draw(random, fraud);
  const km = 10 ** clamp(lk, LOG_X.lo + 0.02, LOG_X.hi - 0.02);
  const baht = 10 ** clamp(lb, LOG_Y.lo + 0.02, LOG_Y.hi - 0.02);
  return { ...toPlot(km, baht), fraud, km, baht };
}

/** The live stream the player slaps at: far more fraud than real life so there is a game. */
export function playStream(count: number, seed = 4_11_2026, fraudShare = 0.38): Transaction[] {
  const random = seeded(seed);
  return Array.from({ length: count }, () => transaction(random, random() < fraudShare));
}

/** The big set, as flat arrays in plot space (1M objects would cost ~100 MB). */
export interface Dataset {
  x: Float32Array;
  y: Float32Array;
  fraud: Uint8Array;
  frauds: number;
}

export function emptySet(n = TOTAL): Dataset {
  return { x: new Float32Array(n), y: new Float32Array(n), fraud: new Uint8Array(n), frauds: 0 };
}

/**
 * Fills the big set a slice at a time (generating a million takes ~240 ms: one long freeze if
 * done at once). Each `next()` adds up to `chunk` transactions and returns how many are done.
 */
export function* fillSet(d: Dataset, chunk = 20_000, seed = 11_11_2026): Generator<number> {
  const random = seeded(seed);
  const n = d.x.length;
  for (let i = 0; i < n; i++) {
    const isFraud = random() < FRAUD_RATE;
    const t = transaction(random, isFraud);
    d.x[i] = t.x;
    d.y[i] = t.y;
    if (isFraud) {
      d.fraud[i] = 1;
      d.frauds++;
    }
    if ((i + 1) % chunk === 0 && i + 1 < n) yield i + 1;
  }
  return n;
}

export function bigSet(n = TOTAL, seed = 11_11_2026): Dataset {
  const d = emptySet(n);
  const job = fillSet(d, n, seed);
  while (!job.next().done);
  return d;
}

/** "Normal": mean and covariance of every transaction (the AI is not told which are fraud). */
export interface Normal {
  mx: number;
  my: number;
  sxx: number;
  sxy: number;
  syy: number;
}

export function fitNormal(d: Dataset): Normal {
  const n = d.x.length;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += d.x[i] ?? 0;
    my += d.y[i] ?? 0;
  }
  mx /= n;
  my /= n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = (d.x[i] ?? 0) - mx;
    const dy = (d.y[i] ?? 0) - my;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  return { mx, my, sxx: sxx / n, sxy: sxy / n, syy: syy / n };
}

/** How many standard deviations a point is from normal (Mahalanobis distance). */
export function distance(n: Normal, x: number, y: number): number {
  const det = n.sxx * n.syy - n.sxy * n.sxy;
  const dx = x - n.mx;
  const dy = y - n.my;
  return Math.sqrt((n.syy * dx * dx - 2 * n.sxy * dx * dy + n.sxx * dy * dy) / det);
}

/** Scores the whole set; the scene times this call for "AI checks 1,000,000 in … s". */
export function scoreAll(d: Dataset, n: Normal): Float32Array {
  const out = new Float32Array(d.x.length);
  const det = n.sxx * n.syy - n.sxy * n.sxy;
  const a = n.syy / det;
  const b = (-2 * n.sxy) / det;
  const c = n.sxx / det;
  for (let i = 0; i < out.length; i++) {
    const dx = (d.x[i] ?? 0) - n.mx;
    const dy = (d.y[i] ?? 0) - n.my;
    out[i] = Math.sqrt(a * dx * dx + b * dx * dy + c * dy * dy);
  }
  return out;
}

/** Points on the ring of radius r (in standard deviations), for drawing. */
export function ring(n: Normal, r: number, steps = 96): Point[] {
  // Cholesky of the covariance maps the unit circle onto the ellipse
  const l11 = Math.sqrt(n.sxx);
  const l21 = n.sxy / l11;
  const l22 = Math.sqrt(Math.max(n.syy - l21 * l21, 1e-12));
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = (i / steps) * Math.PI * 2;
    const u = Math.cos(t) * r;
    const v = Math.sin(t) * r;
    return { x: n.mx + l11 * u, y: n.my + l21 * u + l22 * v };
  });
}

/** Score histograms of fraud and normal transactions (sorting a million froze ~80 ms). */
export interface Outcomes {
  /** Count of scores at or above each bin's lower edge (cumulative from the top). */
  fraudAbove: Uint32Array;
  normalAbove: Uint32Array;
  frauds: number;
}

const HIST = { max: 10, bins: 5000 } as const;

export function outcomes(d: Dataset, scores: Float32Array): Outcomes {
  const fraud = new Uint32Array(HIST.bins + 1);
  const normal = new Uint32Array(HIST.bins + 1);
  const scale = HIST.bins / HIST.max;
  for (let i = 0; i < scores.length; i++) {
    const b = Math.min(HIST.bins - 1, Math.floor((scores[i] ?? 0) * scale));
    if (d.fraud[i]) fraud[b] = (fraud[b] ?? 0) + 1;
    else normal[b] = (normal[b] ?? 0) + 1;
  }
  for (let b = HIST.bins - 1; b >= 0; b--) {
    fraud[b] = (fraud[b] ?? 0) + (fraud[b + 1] ?? 0);
    normal[b] = (normal[b] ?? 0) + (normal[b + 1] ?? 0);
  }
  return { fraudAbove: fraud, normalAbove: normal, frauds: d.frauds };
}

/** How many scores are above r (to within 0.002 standard deviations). */
function above(cumulative: Uint32Array, r: number): number {
  const b = Math.ceil((r / HIST.max) * HIST.bins);
  return cumulative[Math.min(Math.max(b, 0), HIST.bins)] ?? 0;
}

export interface RingResult {
  r: number;
  caught: number;
  missed: number;
  /** Good customers flagged (false positives). */
  blocked: number;
  /** Share of fraud caught, 0..1. */
  recall: number;
  /** Damage in baht: missed fraud plus blocked customers. */
  damage: number;
}

export function atRing(o: Outcomes, r: number): RingResult {
  const caught = above(o.fraudAbove, r);
  const missed = o.frauds - caught;
  const blocked = above(o.normalAbove, r);
  return {
    r,
    caught,
    missed,
    blocked,
    recall: o.frauds ? caught / o.frauds : 0,
    damage: missed * COST.missed + blocked * COST.blocked,
  };
}

/** The ring with the least damage, searched over the player's range. */
export function bestRing(o: Outcomes, steps = 200): RingResult {
  let best = atRing(o, RING.min);
  for (let i = 1; i <= steps; i++) {
    const res = atRing(o, RING.min + ((RING.max - RING.min) * i) / steps);
    if (res.damage < best.damage) best = res;
  }
  return best;
}

/** Ring radius for a raise level 0..1 (hand down = tight ring, overhead = loose). */
export const ringAt = (level: number) => RING.min + clamp(level, 0, 1) * (RING.max - RING.min);

/**
 * Density grid of the big set for drawing a million points cheaply: counts per cell of normal and
 * fraud transactions, and each cell center's distance from normal.
 */
export interface Density {
  w: number;
  h: number;
  normal: Uint32Array;
  fraud: Uint32Array;
  /** Largest cell count, for scaling brightness. */
  max: number;
}

export function density(d: Dataset, w: number, h: number): Density {
  const normal = new Uint32Array(w * h);
  const fraud = new Uint32Array(w * h);
  for (let i = 0; i < d.x.length; i++) {
    const cx = Math.min(w - 1, Math.floor((d.x[i] ?? 0) * w));
    const cy = Math.min(h - 1, Math.floor((1 - (d.y[i] ?? 0)) * h));
    const k = cy * w + cx;
    if (d.fraud[i]) fraud[k] = (fraud[k] ?? 0) + 1;
    else normal[k] = (normal[k] ?? 0) + 1;
  }
  let max = 1;
  for (let k = 0; k < normal.length; k++) max = Math.max(max, (normal[k] ?? 0) + (fraud[k] ?? 0));
  return { w, h, normal, fraud, max };
}
