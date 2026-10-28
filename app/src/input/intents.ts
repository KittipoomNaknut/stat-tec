/**
 * What the player means, independent of how it was produced (body, mouse or a recording).
 * Scenes only ever see these — see docs/adr/0003-intent-bus.md. Screen positions are in [0, 1].
 */

export type IntentSource = 'pose' | 'mouse' | 'replay';
export type Hand = 'left' | 'right';

interface Base {
  /** `performance.now()` milliseconds. */
  t: number;
  source: IntentSource;
}

export type Intent = Base &
  (
    | { type: 'presence'; state: 'enter' | 'lost' | 'return' | 'leave' }
    | { type: 'cursor'; x: number; y: number; hand: Hand; visible: boolean }
    | { type: 'dwell'; targetId: string; progress: number }
    | { type: 'select'; targetId: string }
    | { type: 'swipe'; dir: 'left' | 'right' | 'up' | 'down'; speed: number }
    | { type: 'raise'; hand: Hand | 'both'; level: number }
    | { type: 'lean'; value: number }
    | { type: 'zoom'; scale: number }
    | { type: 'throw'; x: number; y: number; vx: number; vy: number }
    | { type: 'slap'; x: number; y: number; speed: number }
    | { type: 'draw'; phase: 'start' | 'move' | 'end'; x: number; y: number }
  );

export type IntentType = Intent['type'];
export type IntentOf<T extends IntentType> = Extract<Intent, { type: T }>;
