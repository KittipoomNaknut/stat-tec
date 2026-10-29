import { assign, setup } from 'xstate';

/**
 * The visit, from an empty screen to the CEO report and back (ARCHITECTURE §8).
 *
 *   boot → attract ⇄ session[welcome → chapter × N → report]
 *   presence lost mid-session → paused → back where they were (≤ 8 s) or attract
 *
 * The machine only decides *where* the visit is. What happens inside a chapter (beats, scene,
 * captions) is the narrative engine's job; it reports back with WELCOME_DONE / CHAPTER_DONE /
 * REPORT_DONE. Timers are named delays so tests and `?speed` can shorten them.
 */

export type AppEvent =
  | { type: 'READY' }
  | { type: 'PRESENCE_ENTER' }
  | { type: 'PRESENCE_LOST' }
  | { type: 'PRESENCE_RETURN' }
  | { type: 'PRESENCE_LEAVE' }
  | { type: 'WELCOME_DONE' }
  | { type: 'CHAPTER_DONE' }
  | { type: 'REPORT_DONE' }
  /** Staff F5, or the watchdog after an unexpected error. */
  | { type: 'RESET' };

export interface AppContext {
  chapterCount: number;
  chapterIndex: number;
  /** Increments per visit; scenes and the HUD key their state on it. */
  sessionId: number;
  /** Why the last session ended, for stats (`null` while one is running). */
  lastEnd: 'completed' | 'abandoned' | 'reset' | null;
}

export const APP_DELAYS = {
  /** Paused this long without the player coming back → the visit is over. */
  pauseTimeout: 8000,
  /** The report stays up this long after its last line (QR code time). */
  reportLinger: 20000,
};

export const appMachine = setup({
  types: {
    context: {} as AppContext,
    events: {} as AppEvent,
    input: {} as { chapterCount: number },
  },
  actions: {
    startSession: assign({
      chapterIndex: 0,
      sessionId: ({ context }) => context.sessionId + 1,
      lastEnd: null,
    }),
    nextChapter: assign({ chapterIndex: ({ context }) => context.chapterIndex + 1 }),
    endCompleted: assign({ lastEnd: 'completed' as const }),
    endAbandoned: assign({ lastEnd: 'abandoned' as const }),
    endReset: assign({ lastEnd: 'reset' as const }),
  },
  guards: {
    hasNextChapter: ({ context }) => context.chapterIndex + 1 < context.chapterCount,
  },
  delays: {
    pauseTimeout: APP_DELAYS.pauseTimeout,
    reportLinger: APP_DELAYS.reportLinger,
  },
}).createMachine({
  id: 'app',
  context: ({ input }) => ({
    chapterCount: input.chapterCount,
    chapterIndex: 0,
    sessionId: 0,
    lastEnd: null,
  }),
  initial: 'boot',
  states: {
    boot: {
      on: { READY: 'attract' },
    },
    attract: {
      on: {
        PRESENCE_ENTER: { target: 'session', actions: 'startSession' },
      },
    },
    session: {
      initial: 'welcome',
      on: {
        PRESENCE_LOST: 'paused',
        PRESENCE_LEAVE: { target: 'attract', actions: 'endAbandoned' },
        RESET: { target: 'attract', actions: 'endReset' },
      },
      states: {
        welcome: {
          on: { WELCOME_DONE: 'chapter' },
        },
        chapter: {
          on: {
            CHAPTER_DONE: [
              // reenter: the next chapter starts fresh (entry actions, child state)
              { guard: 'hasNextChapter', target: 'chapter', reenter: true, actions: 'nextChapter' },
              { target: 'report' },
            ],
          },
        },
        report: {
          initial: 'presenting',
          // The result is already saved: someone leaving now just ends the visit.
          on: {
            PRESENCE_LOST: { target: '#app.attract', actions: 'endCompleted' },
            PRESENCE_LEAVE: { target: '#app.attract', actions: 'endCompleted' },
          },
          states: {
            presenting: {
              on: { REPORT_DONE: 'lingering' },
            },
            lingering: {
              after: { reportLinger: { target: '#app.attract', actions: 'endCompleted' } },
            },
          },
        },
        history: { type: 'history', history: 'deep' },
      },
    },
    paused: {
      on: {
        PRESENCE_RETURN: 'session.history',
        // A new person locking on is a new visit, not the old one resuming.
        PRESENCE_ENTER: { target: 'session', actions: ['endAbandoned', 'startSession'] },
        RESET: { target: 'attract', actions: 'endReset' },
      },
      after: { pauseTimeout: { target: 'attract', actions: 'endAbandoned' } },
    },
  },
});

/** Where the visit is, flattened for the app: `'attract'`, `'chapter'`, `'paused'`… */
export type AppPhase = 'boot' | 'attract' | 'welcome' | 'chapter' | 'report' | 'paused';

export function phaseOf(value: unknown): AppPhase {
  if (typeof value === 'string') return value as AppPhase;
  const session = (value as { session?: unknown }).session;
  if (typeof session === 'string') return session as AppPhase;
  return 'report';
}
