/**
 * Booth events for the live log (research 026): what happens in a visit and what goes wrong,
 * sent to the perception service, which writes them next to its own health and problems
 * (`stat-tec-log`). Names and numbers only — never images or body coordinates (ARCHITECTURE §17).
 *
 * Without a service (MediaPipe fallback, E2E) events only stay in a short in-memory history.
 */

export type BoothLevel = 'info' | 'warn' | 'error';
export type BoothFields = Record<string, string | number | boolean | null>;

export interface BoothEvent {
  name: string;
  level: BoothLevel;
  fields: BoothFields;
}

type Sink = (event: BoothEvent) => void;

/** Events kept before a sink is attached (the service connects after the page starts). */
const MAX_PENDING = 50;
const MAX_RECENT = 100;

let sink: Sink | null = null;
let pending: BoothEvent[] = [];
let recent: BoothEvent[] = [];
/** Added to every event: the visit and chapter it happened in. */
let context: BoothFields = {};

export function setBoothSink(next: Sink | null): void {
  sink = next;
  if (!next) return;
  const queued = pending;
  pending = [];
  for (const event of queued) next(event);
}

export function setBoothContext(fields: BoothFields): void {
  context = { ...fields };
}

export function boothLog(name: string, fields: BoothFields = {}, level: BoothLevel = 'info'): void {
  const event: BoothEvent = { name, level, fields: { ...context, ...fields } };
  recent = [...recent.slice(-(MAX_RECENT - 1)), event];
  if (sink) sink(event);
  else pending = [...pending.slice(-(MAX_PENDING - 1)), event];
}

/** The latest events (tests, the debug overlay). */
export function recentBoothEvents(): readonly BoothEvent[] {
  return recent;
}

/** For tests: forget everything. */
export function resetBoothLog(): void {
  sink = null;
  pending = [];
  recent = [];
  context = {};
}
