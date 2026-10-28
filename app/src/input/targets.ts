/** Screen-space rectangle in [0, 1] coordinates. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Things the player can select (buttons, choices). Both the dwell gesture and the mouse
 * hit-test against this registry, so a target behaves the same for body and mouse.
 */
export class TargetRegistry {
  readonly #targets = new Map<string, () => Rect | null>();

  /** `rect` is read on every hit-test so moving or resizing targets just work. */
  register(id: string, rect: () => Rect | null): () => void {
    this.#targets.set(id, rect);
    return () => {
      this.#targets.delete(id);
    };
  }

  /** Current rect of a target, or `null` if unknown or hidden. */
  rectOf(id: string): Rect | null {
    return this.#targets.get(id)?.() ?? null;
  }

  /** Snapshot of every visible target's rect. */
  snapshot(): Record<string, Rect> {
    const out: Record<string, Rect> = {};
    for (const [id, rect] of this.#targets) {
      const r = rect();
      if (r) out[id] = r;
    }
    return out;
  }

  /** Target under the point, preferring the most recently registered (topmost). */
  hitTest(x: number, y: number, padding = 0): string | null {
    const entries = [...this.#targets.entries()];
    for (let i = entries.length - 1; i >= 0; i--) {
      const [id, rect] = entries[i] ?? ['', () => null];
      const r = rect();
      if (!r) continue;
      if (
        x >= r.x - padding &&
        x <= r.x + r.w + padding &&
        y >= r.y - padding &&
        y <= r.y + r.h + padding
      ) {
        return id;
      }
    }
    return null;
  }
}

/** Rect of a DOM element in [0, 1] viewport coordinates, or `null` when it is not displayed. */
export function elementRect(el: Element): Rect | null {
  const box = el.getBoundingClientRect();
  if (box.width === 0 || box.height === 0) return null;
  return {
    x: box.left / window.innerWidth,
    y: box.top / window.innerHeight,
    w: box.width / window.innerWidth,
    h: box.height / window.innerHeight,
  };
}
