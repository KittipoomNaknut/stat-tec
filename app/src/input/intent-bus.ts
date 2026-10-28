import type { Intent, IntentOf, IntentType } from './intents';

type Handler<T extends IntentType> = (intent: IntentOf<T>) => void;

/** Typed, synchronous pub/sub for intents. One bus per app; scenes subscribe, inputs emit. */
export class IntentBus {
  readonly #handlers = new Map<IntentType, Set<(intent: Intent) => void>>();
  readonly #any = new Set<(intent: Intent) => void>();

  /** Subscribes to one intent type; returns an unsubscribe function. */
  on<T extends IntentType>(type: T, handler: Handler<T>): () => void {
    let set = this.#handlers.get(type);
    if (!set) {
      set = new Set();
      this.#handlers.set(type, set);
    }
    const wrapped = handler as (intent: Intent) => void;
    set.add(wrapped);
    return () => {
      set.delete(wrapped);
    };
  }

  /** Subscribes to every intent, e.g. for debugging or recording. */
  onAny(handler: (intent: Intent) => void): () => void {
    this.#any.add(handler);
    return () => {
      this.#any.delete(handler);
    };
  }

  emit(intent: Intent): void {
    const set = this.#handlers.get(intent.type);
    if (set) for (const h of set) h(intent);
    for (const h of this.#any) h(intent);
  }
}
