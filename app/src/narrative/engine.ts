import { narrativeConfig } from '../config/narrative';
import type { Beat, Line } from './schema';
import {
  fill,
  isShown,
  lineCue,
  lineText,
  plain,
  type Segment,
  type TemplateVars,
} from './template';

/** What the engine needs from whoever runs it (the chapter: scene + app vars). */
export interface NarrativeHost {
  /** Vars for templates and `when`, read when each line starts. */
  vars(): TemplateVars;
  onBeat?(beat: Beat, index: number): void;
  /**
   * A line's cue. Return true to block: the engine waits for `continue()`
   * (e.g. the player choosing a customer segment).
   */
  onCue?(cue: string): boolean;
  /** A line could not be shown (missing var); the engine skips it. */
  onError?(error: Error): void;
  onDone?(): void;
}

/** One caption line as typed so far. */
export interface CaptionLine {
  segments: Segment[];
  /** Graphemes visible so far, out of `length`. */
  shown: number;
  length: number;
}

export interface NarrativeState {
  beat: Beat | null;
  beatIndex: number;
  /** Up to two lines: the previous (dimmed by the HUD) and the current one. */
  lines: CaptionLine[];
  /** True while the skip button should be offered. */
  skippable: boolean;
  /** Seconds left in a play beat, else null. */
  remainingSec: number | null;
  /** Waiting on the player: a tutorial gesture or a blocking cue. */
  waiting: 'gesture' | 'cue' | null;
  done: boolean;
}

const graphemes = new Intl.Segmenter('th', { granularity: 'grapheme' });

function graphemeCount(text: string): number {
  return [...graphemes.segment(text)].length;
}

type Step =
  | { kind: 'line'; line: Line }
  | { kind: 'gesture'; timeoutMs: number }
  | { kind: 'success'; text: string }
  | { kind: 'play'; durationMs: number; hints: { atMs: number; text: string }[] };

/**
 * Runs a list of beats (ARCHITECTURE §9.1): types lines out, holds them, fires cues, waits for
 * the tutorial gesture, counts down play time with timed hints. Advanced by `update(dt)` from the
 * frame loop, so pausing the app pauses the story and tests run instantly.
 */
export class NarrativeEngine {
  readonly #beats: readonly Beat[];
  readonly #host: NarrativeHost;
  readonly #config: typeof narrativeConfig;
  #steps: Step[] = [];
  #step = 0;
  /** Time spent in the current step. */
  #stepMs = 0;
  /** Time since the beat started (tutorial timeout, play clock). */
  #beatMs = 0;
  #hintIndex = 0;
  #current: CaptionLine | null = null;
  #holdMs = 0;
  #gestureDone = false;
  #sceneDone = false;
  #blocked = false;
  readonly state: NarrativeState = {
    beat: null,
    beatIndex: -1,
    lines: [],
    skippable: false,
    remainingSec: null,
    waiting: null,
    done: false,
  };

  constructor(beats: readonly Beat[], host: NarrativeHost, config = narrativeConfig) {
    this.#beats = beats;
    this.#host = host;
    this.#config = config;
    this.#startBeat(0);
  }

  /** Player held the skip button: jump to the next blocking cue or the end of the beat. */
  skip(): void {
    if (!this.state.skippable) return;
    const next = this.#steps.findIndex(
      (s, i) => i > this.#step && s.kind === 'line' && this.#blocks(s.line),
    );
    if (next < 0) {
      this.#startBeat(this.state.beatIndex + 1);
    } else {
      this.#enterStep(next);
    }
  }

  /** The tutorial gesture happened. */
  gestureSucceeded(): void {
    this.#gestureDone = true;
  }

  /** The scene finished play early (e.g. the player made the choice). */
  sceneFinished(): void {
    this.#sceneDone = true;
  }

  /** Release a blocking cue. */
  continue(): void {
    if (!this.#blocked) return;
    this.#blocked = false;
    this.state.waiting = null;
    this.#enterStep(this.#step + 1);
  }

  update(dtMs: number): void {
    if (this.state.done) return;
    this.#stepMs += dtMs;
    this.#beatMs += dtMs;
    if (this.#blocked) {
      // Waiting on the scene: keep typing the cue's text, but do not move on.
      this.#type();
      return;
    }
    const step = this.#steps[this.#step];
    if (!step) {
      this.#startBeat(this.state.beatIndex + 1);
      return;
    }
    switch (step.kind) {
      case 'line':
      case 'success':
        this.#updateLine();
        break;
      case 'gesture':
        if (this.#gestureDone || this.#beatMs >= step.timeoutMs) this.#enterStep(this.#step + 1);
        break;
      case 'play':
        this.#updatePlay(step);
        break;
    }
  }

  #startBeat(index: number): void {
    const beat = this.#beats[index];
    this.state.beatIndex = index;
    this.state.lines = [];
    this.state.remainingSec = null;
    this.state.waiting = null;
    this.#current = null;
    this.#beatMs = 0;
    this.#gestureDone = false;
    this.#sceneDone = false;
    this.#hintIndex = 0;
    if (!beat) {
      this.state.beat = null;
      this.state.skippable = false;
      this.state.done = true;
      this.#host.onDone?.();
      return;
    }
    this.state.beat = beat;
    this.state.skippable =
      beat.type === 'mission' || beat.type === 'reveal' || beat.type === 'lesson';
    this.#steps = stepsOf(beat);
    this.#host.onBeat?.(beat, index);
    this.#enterStep(0);
  }

  #enterStep(index: number): void {
    this.#step = index;
    this.#stepMs = 0;
    const step = this.#steps[index];
    if (!step) return; // the next update() moves to the next beat
    this.state.waiting = step.kind === 'gesture' ? 'gesture' : null;
    if (step.kind === 'play') this.state.remainingSec = step.durationMs / 1000;
    if (step.kind === 'success') {
      // Praise only if the player actually did it (the tutorial may have timed out).
      if (this.#gestureDone) this.#show([{ text: step.text, strong: false }]);
      else this.#enterStep(index + 1);
      return;
    }
    if (step.kind !== 'line') return;

    const { line } = step;
    try {
      const vars = this.#host.vars();
      if (!isShown(line, vars)) {
        this.#enterStep(index + 1);
        return;
      }
      const text = lineText(line);
      const segments = text === undefined ? null : fill(text, vars);
      const cue = lineCue(line);
      if (segments) this.#show(segments);
      else this.#current = null;
      if (cue !== undefined && this.#host.onCue?.(cue) === true) {
        this.#blocked = true;
        this.state.waiting = 'cue';
      }
    } catch (error) {
      this.#host.onError?.(error as Error);
      this.#enterStep(index + 1);
    }
  }

  #show(segments: Segment[]): void {
    const text = plain(segments);
    const length = graphemeCount(text);
    this.#current = { segments, shown: 0, length };
    this.#holdMs = Math.max(this.#config.holdMinMs, length * this.#config.holdPerCharMs);
    this.state.lines = [...this.state.lines.slice(-1), this.#current];
  }

  /** Types the current line, then holds it; a cue-only line just waits `cueMs`. */
  #updateLine(): void {
    const line = this.#current;
    if (!line) {
      if (this.#stepMs >= this.#config.cueMs) this.#enterStep(this.#step + 1);
      return;
    }
    const typingMs = (line.length * 1000) / this.#config.charsPerSec;
    this.#type();
    if (this.#stepMs >= typingMs + this.#holdMs) this.#enterStep(this.#step + 1);
  }

  #type(): void {
    const line = this.#current;
    if (!line) return;
    line.shown = Math.min(
      line.length,
      Math.floor((this.#stepMs * this.#config.charsPerSec) / 1000),
    );
  }

  #updatePlay(step: Extract<Step, { kind: 'play' }>): void {
    this.state.remainingSec = Math.max(0, (step.durationMs - this.#beatMs) / 1000);
    const hint = step.hints[this.#hintIndex];
    if (hint && this.#beatMs >= hint.atMs) {
      this.#hintIndex++;
      try {
        this.#show(fill(hint.text, this.#host.vars()));
      } catch (error) {
        this.#host.onError?.(error as Error);
      }
    }
    if (this.#current) {
      const since = this.#beatMs - (step.hints[this.#hintIndex - 1]?.atMs ?? 0);
      this.#current.shown = Math.min(
        this.#current.length,
        Math.floor((since * this.#config.charsPerSec) / 1000),
      );
    }
    if (this.#sceneDone || this.#beatMs >= step.durationMs)
      this.#startBeat(this.state.beatIndex + 1);
  }

  #blocks(line: Line): boolean {
    // Only cues can block; whether one does is the host's call, so ask without firing it:
    // a cue-only line is treated as a checkpoint skipping must not jump over.
    return typeof line !== 'string' && line.cue !== undefined && line.text === undefined;
  }
}

function stepsOf(beat: Beat): Step[] {
  switch (beat.type) {
    case 'mission':
    case 'reveal':
    case 'lesson':
      return beat.lines.map((line) => ({ kind: 'line', line }));
    case 'tutorial': {
      const steps: Step[] = beat.lines.map((line) => ({ kind: 'line', line }));
      steps.push({ kind: 'gesture', timeoutMs: beat.timeoutSec * 1000 });
      if (beat.success !== undefined) steps.push({ kind: 'success', text: beat.success });
      return steps;
    }
    case 'play':
      return [
        {
          kind: 'play',
          durationMs: beat.durationSec * 1000,
          hints: beat.hints.map((h) => ({ atMs: h.afterSec * 1000, text: h.text })),
        },
      ];
  }
}
