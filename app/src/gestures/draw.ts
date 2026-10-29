import type { CursorState } from './cursor';

export interface DrawEvent {
  type: 'draw';
  phase: 'start' | 'move' | 'end';
  x: number;
  y: number;
}

/**
 * Drawing with the body (EPISODE V: draw the forecast): the pen is down while the cursor shows,
 * so raising and pointing the arm draws and dropping it lifts the pen. The cursor already
 * filters out fidgets (activation hold, straightness) and is smoothed, so strokes come out clean
 * without a second set of rules. Switching hands ends the stroke. The mouse draws by dragging.
 */
export class DrawDetector {
  #down = false;
  #hand = '';
  #x = 0;
  #y = 0;

  update(cursor: CursorState): DrawEvent[] {
    const events: DrawEvent[] = [];
    if (this.#down && (!cursor.visible || cursor.hand !== this.#hand)) {
      events.push({ type: 'draw', phase: 'end', x: this.#x, y: this.#y });
      this.#down = false;
    }
    if (!cursor.visible) return events;
    if (!this.#down) {
      this.#down = true;
      this.#hand = cursor.hand;
      events.push({ type: 'draw', phase: 'start', x: cursor.x, y: cursor.y });
    }
    this.#x = cursor.x;
    this.#y = cursor.y;
    events.push({ type: 'draw', phase: 'move', x: cursor.x, y: cursor.y });
    return events;
  }
}
