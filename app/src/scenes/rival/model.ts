/**
 * EP II — "คู่แข่งบุก": Empire Coffee opens across the street at ฿49. The café's customers are
 * the 600 of the segments model (visits per month × spend); K-means finds the three groups and
 * the player picks how to answer the rival. Every result on screen is computed here.
 */
import { SEGMENTS, type Segment } from '../segments/model';

/** Cost to make one cup (฿): the margin is price − cost. */
export const CUP_COST = 25;
export const RIVAL_PRICE = 49;
/** Our price when the player's own (from EP I) is unknown: the regression's best. */
export const DEFAULT_PRICE = 71;

export type GroupId = Segment['id'];

/** How each group is presented in this story (the data is the segments model's). */
export const PERSONAS: Readonly<
  Record<GroupId, { name: string; description: string; leaves: number }>
> = {
  // Share that walks across the street if we keep our price
  'big-spender': { name: 'สายพรีเมียม', description: 'จ่ายแพงได้ ขอของดี', leaves: 0 },
  regular: { name: 'ขาประจำ', description: 'รักร้านเรา มาทุกวัน', leaves: 0.15 },
  promo: { name: 'สายประหยัด', description: 'ที่ไหนถูกกว่า ไปที่นั่น', leaves: 0.8 },
};

export type StrategyId = 'all' | 'target' | 'none';

export const STRATEGIES: readonly { id: StrategyId; label: string }[] = [
  { id: 'all', label: `ลดทุกคน ฿${String(RIVAL_PRICE)}` },
  { id: 'target', label: 'ลดเฉพาะสายประหยัด' },
  { id: 'none', label: 'ไม่ลดเลย' },
];

/** Visits per month of a segment's typical customer (x axis 0–30). */
function visits(s: Segment): number {
  return s.center.x * 30;
}

export interface StrategyResult {
  id: StrategyId;
  /** Monthly profit (฿). */
  profit: number;
  /** Share of the profit before the rival opened, 0..1. */
  kept: number;
  /** Per group: share of its customers who leave for the rival. */
  leaves: Record<GroupId, number>;
}

/** Monthly profit before Empire Coffee: everyone at our price. */
export function baseline(price: number): number {
  return SEGMENTS.reduce((sum, s) => sum + s.count * visits(s) * (price - CUP_COST), 0);
}

/**
 * A group given the discount stays and pays ฿49; one without it keeps our price and loses the
 * share that prefers the cheaper shop.
 */
export function evaluate(id: StrategyId, price: number): StrategyResult {
  const leaves = {} as Record<GroupId, number>;
  let profit = 0;
  for (const s of SEGMENTS) {
    const discounted = id === 'all' || (id === 'target' && s.id === 'promo');
    const p = discounted ? Math.min(price, RIVAL_PRICE) : price;
    const leave = discounted || price <= RIVAL_PRICE ? 0 : PERSONAS[s.id].leaves;
    leaves[s.id] = leave;
    profit += s.count * (1 - leave) * visits(s) * (p - CUP_COST);
  }
  return { id, profit, kept: profit / baseline(price), leaves };
}

/** The strategy that keeps the most profit. */
export function bestStrategy(price: number): StrategyId {
  let best: StrategyResult = evaluate('none', price);
  for (const { id } of STRATEGIES) {
    const r = evaluate(id, price);
    if (r.profit > best.profit) best = r;
  }
  return best.id;
}
