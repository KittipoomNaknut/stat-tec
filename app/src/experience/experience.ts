import { createActor } from 'xstate';
import { APP_DELAYS, appMachine, phaseOf, type AppPhase } from '../core/app-machine';
import { Watchdog } from '../core/watchdog';
import { GestureEngine } from '../gestures/engine';
import { Caption } from '../hud/caption';
import { ChapterHeader } from '../hud/chapter-header';
import { Countdown } from '../hud/countdown';
import { HudCursor } from '../hud/cursor';
import { DwellButton } from '../hud/dwell-button';
import { MiniSkeleton } from '../hud/mini-skeleton';
import { Notice } from '../hud/notice';
import { TopBar } from '../hud/top-bar';
import { IntentBus } from '../input/intent-bus';
import { MouseAdapter } from '../input/mouse-adapter';
import { TargetRegistry } from '../input/targets';
import { NarrativeEngine } from '../narrative/engine';
import type { Beat, Story } from '../narrative/schema';
import type { PerceptionSource, PoseDetections } from '../perception/protocol';
import { Renderer } from '../render/renderer';
import { attractScene } from '../scenes/attract';
import { SceneManager } from '../scenes/manager';
import { coffeeScene } from '../scenes/coffee/scene';
import { fraudScene } from '../scenes/fraud/scene';
import { segmentsScene } from '../scenes/segments/scene';
import { placeholderScene } from '../scenes/placeholder';
import { reportScene } from '../scenes/report';
import type { SceneFactory, SceneModule } from '../scenes/types';
import { welcomeScene } from '../scenes/welcome';
import { codename } from '../scoring/codename';
import { chapterProfit, totalProfit, type ChapterOutcome } from '../scoring/profit';
import { ceoStyle } from '../scoring/style';
import { Leaderboard } from '../storage/leaderboard';
import './experience.css';

export interface ExperienceOptions {
  story: Story;
  /** Time multiplier for the story, scenes and timers (E2E runs at `?speed=6`). */
  speed?: number;
  /** Render scale cap (see config/render.ts). */
  maxInternalHeight?: number;
  /** Dev/review: jump straight to this chapter id once a visit starts (`?chapter=segments`). */
  startChapter?: string;
  /** Where the leaderboard lives (localStorage in the kiosk). */
  storage?: Storage;
}

/**
 * The visitor experience: one place that wires the app machine, narrative, scenes, HUD and
 * input together. Each state of the visit gets a scene and (except attract) a narrative; pausing
 * freezes both, so resuming continues mid-sentence.
 */
export class Experience {
  readonly bus = new IntentBus();
  readonly #targets = new TargetRegistry();
  readonly #story: Story;
  readonly #speed: number;
  readonly #startChapter: number;
  readonly #renderer: Renderer;
  readonly #scenes: SceneManager;
  readonly #gestures: GestureEngine;
  readonly #mouse: MouseAdapter;
  readonly #leaderboard: Leaderboard;
  readonly #actor;

  // HUD
  readonly #topBar: TopBar;
  readonly #header: ChapterHeader;
  readonly #caption: Caption;
  readonly #countdown: Countdown;
  readonly #skipRow: HTMLElement;
  readonly #skeleton: MiniSkeleton;
  readonly #notice: Notice;
  readonly #cursor: HudCursor;
  readonly #watchdog: Watchdog;

  #phase: AppPhase = 'boot';
  /** Identifies what is on screen (session + chapter); pausing does not change it. */
  #activeKey = '';
  #narrative: NarrativeEngine | null = null;
  #scene: SceneModule | null = null;
  #codename = '';
  #outcomes: ChapterOutcome[] = [];
  #pausedMs = 0;

  constructor(parent: HTMLElement, options: ExperienceOptions) {
    this.#story = options.story;
    this.#speed = options.speed ?? 1;
    this.#startChapter = this.#story.chapters.findIndex((c) => c.id === options.startChapter);
    this.#leaderboard = new Leaderboard(options.storage ?? window.localStorage);
    this.#renderer = new Renderer(parent, {
      ...(options.maxInternalHeight === undefined
        ? {}
        : { maxInternalHeight: options.maxInternalHeight }),
      onFatal: () => {
        location.reload();
      },
    });

    const hud = document.createElement('div');
    hud.className = 'hud-root';
    parent.append(hud);
    const sceneHud = document.createElement('div');
    sceneHud.className = 'scene-hud-layer';
    hud.append(sceneHud);

    this.#topBar = new TopBar(hud, this.#story.chapters.length);
    this.#header = new ChapterHeader(hud);
    this.#countdown = new Countdown(hud);
    this.#skeleton = new MiniSkeleton(hud);
    this.#caption = new Caption(hud, this.#story.meta.aiName);
    this.#skipRow = document.createElement('div');
    this.#skipRow.className = 'hud-skip';
    this.#skipRow.hidden = true;
    hud.append(this.#skipRow);
    new DwellButton(
      this.#skipRow,
      this.bus,
      this.#targets,
      'skip',
      this.#story.system.skip,
      () => {
        this.#narrative?.skip();
      },
      'SKIP',
    );
    this.#notice = new Notice(hud);
    this.#watchdog = new Watchdog({
      reset: () => {
        this.#actor.send({ type: 'RESET' });
      },
      reload: (reason) => {
        console.error('[watchdog] reload:', reason);
        location.reload();
      },
      onStall: () => undefined, // shown by frame() from `stalled`
      log: (message) => {
        console.warn('[watchdog]', message);
      },
    });
    window.addEventListener('error', (e) => {
      this.#watchdog.error(e.message, performance.now());
    });
    window.addEventListener('unhandledrejection', (e) => {
      this.#watchdog.error(String(e.reason), performance.now());
    });

    const cursor = new HudCursor(hud);
    this.#cursor = cursor;
    this.bus.on('cursor', (c) => {
      cursor.move(c);
    });
    this.bus.on('dwell', (d) => {
      cursor.setProgress(d.progress);
      cursor.setMagnet(d.progress > 0 ? this.#targets.rectOf(d.targetId) : null, d.progress);
      // Mid-selection on a scene's button: time-outs wait (skip does not count).
      this.#narrative?.setEngaged(d.targetId !== 'skip' && d.progress > 0 && d.progress < 1);
    });
    this.bus.on('select', (s) => {
      cursor.setProgress(0);
      cursor.setMagnet(null);
      this.#narrative?.setEngaged(false);
      // For tests and the debug overlay: what the player last selected.
      document.body.dataset['lastSelect'] = s.targetId;
    });

    this.#scenes = new SceneManager(
      this.#renderer.world,
      sceneHud,
      { bus: this.bus, targets: this.#targets },
      (event) => {
        if (event === 'gesture') this.#narrative?.gestureSucceeded();
        else if (event === 'finished') this.#narrative?.sceneFinished();
        else this.#narrative?.continue();
      },
      1200 / this.#speed,
    );
    this.#gestures = new GestureEngine(this.bus, this.#targets);
    this.#mouse = new MouseAdapter(window, this.bus, this.#targets);

    const actor = createActor(
      appMachine.provide({
        delays: {
          pauseTimeout: APP_DELAYS.pauseTimeout / this.#speed,
          reportLinger: APP_DELAYS.reportLinger / this.#speed,
        },
      }),
      { input: { chapterCount: this.#story.chapters.length } },
    );
    this.#actor = actor;
    this.bus.on('presence', (p) => {
      const type = {
        enter: 'PRESENCE_ENTER',
        lost: 'PRESENCE_LOST',
        return: 'PRESENCE_RETURN',
        leave: 'PRESENCE_LEAVE',
      } as const;
      actor.send({ type: type[p.state] });
    });
    actor.subscribe((snapshot) => {
      this.#onState(
        phaseOf(snapshot.value),
        snapshot.context.sessionId,
        snapshot.context.chapterIndex,
      );
    });
    actor.start();
    window.addEventListener('keydown', this.#onKey);
    actor.send({ type: 'READY' });
  }

  /** Uses thresholds calibrated for the pose source in use. */
  setPoseSource(source: PerceptionSource): void {
    this.#gestures.setPoseSource(source);
  }

  onDetections(d: PoseDetections, nowMs = performance.now()): void {
    this.#watchdog.frame(nowMs);
    this.#gestures.update(d, nowMs);
    this.#skeleton.setPose(d.lock === 'locked' ? d.player : null, d.playerShown);
    if (d.lock === 'locked' && d.player) this.#scenes.countPoseFrame();
  }

  /** Feeds the gesture engine directly (synthetic players in E2E). */
  onBody(
    input: { lock: PoseDetections['lock']; playerId: number; body: Float32Array | null },
    nowMs: number,
  ): void {
    this.#watchdog.frame(nowMs);
    this.#gestures.update(input, nowMs);
    if (input.lock === 'locked' && input.body) this.#scenes.countPoseFrame();
  }

  frame(dtMs: number, nowMs: number): void {
    const dt = dtMs * this.#speed;
    const paused = this.#phase === 'paused';
    if (!paused) this.#narrative?.update(dt);
    this.#scenes.update(dt, (nowMs * this.#speed) / 1000);
    this.#topBar.update(dt);

    const state = this.#narrative?.state ?? null;
    this.#caption.update(paused ? null : state);
    this.#countdown.update(paused ? null : (state?.remainingSec ?? null));
    this.#skipRow.hidden = paused || !state?.skippable;
    this.#watchdog.check(nowMs);
    if (paused) this.#pausedMs += dt;
    if (this.#watchdog.stalled) {
      this.#notice.show('Reconnecting', this.#story.system.reconnecting);
    } else if (paused) {
      this.#notice.show(
        'Signal lost',
        this.#story.system.paused,
        this.#pausedMs / APP_DELAYS.pauseTimeout,
      );
    } else {
      this.#notice.hide();
    }
    this.#skeleton.draw();
    this.#cursor.suppressed = this.#scene?.showCursor?.() === false;
    this.#cursor.frame(dtMs);
    document.body.dataset['beat'] = state?.beat?.type ?? '';
    this.#renderer.frame(dtMs, nowMs);
  }

  #onState(phase: AppPhase, sessionId: number, chapterIndex: number): void {
    const was = this.#phase;
    this.#phase = phase;
    document.body.dataset['phase'] = phase;
    if (phase === 'paused') {
      if (was !== 'paused') this.#pausedMs = 0;
      return;
    }
    const key = `${phase}:${String(sessionId)}:${String(chapterIndex)}`;
    if (key === this.#activeKey) return; // resumed where we were
    this.#activeKey = key;

    switch (phase) {
      case 'boot':
        break;
      case 'attract':
        this.#enterAttract();
        break;
      case 'welcome':
        this.#enterWelcome();
        if (this.#startChapter > 0) this.#skipTo();
        break;
      case 'chapter':
        if (chapterIndex < this.#startChapter) this.#skipTo();
        else this.#enterChapter(chapterIndex);
        break;
      case 'report':
        this.#enterReport();
        break;
    }
  }

  /** Dev jump (`?chapter=`): leave the welcome / earlier chapters at once. */
  #skipTo(): void {
    queueMicrotask(() => {
      this.#actor.send({ type: this.#phase === 'welcome' ? 'WELCOME_DONE' : 'CHAPTER_DONE' });
    });
  }

  #enterAttract(): void {
    this.#renderer.stage.planet = true;
    // A quiet moment: reload now if memory has crept up over the day.
    const memory = (performance as { memory?: { usedJSHeapSize: number } }).memory;
    this.#watchdog.idle(memory?.usedJSHeapSize ?? null);
    this.#narrative = null;
    this.#scene = this.#scenes.show(attractScene(this.#story));
    this.#topBar.visible = false;
    this.#header.hide();
    this.#skeleton.visible = false;
    document.body.dataset['chapter'] = '';
  }

  #enterWelcome(): void {
    this.#renderer.stage.planet = false;
    const today = new Set(this.#leaderboard.today().map((e) => e.codename));
    this.#codename = codename(this.#story.codename, Math.random, today);
    this.#outcomes = [];
    this.#topBar.setProfit(0, false);
    this.#topBar.setChapter(-1, this.#story.chapters.length);
    this.#topBar.visible = true;
    this.#skeleton.visible = true;
    this.#header.hide();
    this.#scene = this.#scenes.show(welcomeScene(this.#codename));
    this.#run(this.#story.welcome.beats, () => {
      this.#actor.send({ type: 'WELCOME_DONE' });
    });
  }

  #enterChapter(index: number): void {
    const chapter = this.#story.chapters[index];
    if (!chapter) return;
    document.body.dataset['chapter'] = chapter.id;
    this.#topBar.setChapter(index, this.#story.chapters.length, chapter.concept, chapter.title);
    this.#header.hide();
    // Real scenes replace placeholders one by one (Phase 4).
    const real: Record<string, (id: string) => SceneFactory> = {
      'c-coffee-pricing': coffeeScene,
      'd-segmentation': segmentsScene,
      'f-fraud': fraudScene,
    };
    const factory =
      real[chapter.scene]?.(chapter.id) ?? placeholderScene(chapter.scene, chapter.id);
    this.#scene = this.#scenes.show(factory);
    this.#run(
      chapter.beats,
      () => {
        const outcome = this.#scene?.result();
        if (outcome) {
          this.#outcomes.push(outcome);
          this.#topBar.setProfit(this.#profitSoFar());
        }
        this.#actor.send({ type: 'CHAPTER_DONE' });
      },
      chapter.concept,
      chapter.title,
    );
  }

  #enterReport(): void {
    this.#renderer.stage.planet = true;
    document.body.dataset['chapter'] = 'report';
    this.#topBar.visible = false;
    this.#header.hide();
    const total = totalProfit(this.#outcomes);
    const { rank, total: players } = this.#leaderboard.add(this.#codename, total);
    const style = this.#story.styles[ceoStyle(this.#outcomes)];
    this.#scene = this.#scenes.show(
      reportScene(this.#story, {
        codename: this.#codename,
        totalProfit: total,
        style,
        rank,
        totalPlayers: players,
      }),
    );
    this.#run([{ type: 'reveal', lines: this.#story.report.lines }], () => {
      this.#actor.send({ type: 'REPORT_DONE' });
    });
  }

  #profitSoFar(): number {
    return this.#outcomes.reduce((sum, o) => sum + chapterProfit(o), 0);
  }

  /** Starts a narrative over the current scene; the lesson beat swaps the header to its term. */
  #run(beats: readonly Beat[], onDone: () => void, concept?: string, title?: string): void {
    const scene = this.#scene;
    this.#narrative = new NarrativeEngine(beats, {
      vars: () => ({
        aiName: this.#story.meta.aiName,
        codename: this.#codename,
        ...scene?.vars(),
      }),
      onBeat: (beat) => {
        document.body.dataset['beat'] = beat.type;
        if (concept !== undefined && title !== undefined) {
          // The episode title lives in the top bar; the lesson names the idea center stage.
          if (beat.type === 'lesson' && !scene?.ownsLesson?.()) {
            this.#header.show('Lesson', concept, 'lesson');
          } else if (title) this.#header.hide();
        }
        scene?.onBeat?.(beat);
      },
      onCue: (cue) => scene?.onCue?.(cue) ?? false,
      onError: (error) => {
        console.warn('[narrative]', error.message);
      },
      onDone,
    });
  }

  readonly #onKey = (e: KeyboardEvent): void => {
    if (e.key === 'F5') {
      // Staff reset: back to attract, not a page reload.
      e.preventDefault();
      this.#actor.send({ type: 'RESET' });
    } else if (e.key === 'F2') {
      e.preventDefault();
      this.#mouse.enabled = !this.#mouse.enabled;
      this.#gestures.enabled = !this.#mouse.enabled;
      // With the mouse there is no body to detect: toggling it acts as arriving / leaving.
      this.bus.emit({
        type: 'presence',
        state: this.#mouse.enabled ? 'enter' : 'leave',
        t: performance.now(),
        source: 'mouse',
      });
    }
  };
}
