import './benchmark.css';
import { perceptionDefaults } from '../config/perception';
import { RateMeter, RollingWindow } from '../core/rolling-stats';
import type { CameraSettings } from '../perception/camera';
import { PerceptionClient } from '../perception/client';
import type { PerceptionOptions, PoseDetections, PoseModel } from '../perception/protocol';
import { barChart } from './bench-chart';
import { JitterMeter } from './jitter';

const MODELS: readonly PoseModel[] = ['lite', 'full', 'heavy'];
const COUNTDOWN_S = 5;
const WARMUP_S = 3;
const COLOR_FILTERED = '#3987e5';
const COLOR_RAW = '#d95926';

export interface BenchResult {
  model: PoseModel;
  delegate: PerceptionOptions['delegate'];
  frames: number;
  inference: { mean: number; p50: number; p95: number };
  fps: number;
  /** Worker receiving a frame → its detections arriving on the main thread. */
  latency: { mean: number; p95: number };
  jitter: { raw: number; filtered: number };
  /** Share of frames with at least one person detected. */
  coverage: number;
}

export interface BenchReport {
  createdAt: string;
  userAgent: string;
  camera: CameraSettings;
  filter: PerceptionOptions['filter'];
  seconds: number;
  results: BenchResult[];
}

/**
 * `?bench` — runs each pose model in turn on the live camera and charts the results.
 * `?bench=full,heavy&benchSeconds=20` limits models and changes the measuring time.
 */
export class BenchmarkView {
  readonly #root = document.createElement('div');
  readonly #video = document.createElement('video');
  readonly #status = document.createElement('div');
  readonly #models: readonly PoseModel[];
  readonly #seconds: number;
  #track: MediaStreamTrack | null = null;
  #settings: CameraSettings | null = null;
  #started = false;

  constructor(parent: HTMLElement, search: string) {
    const params = new URLSearchParams(search);
    const requested = (params.get('bench') ?? '').split(',');
    const models = MODELS.filter((m) => requested.includes(m));
    this.#models = models.length > 0 ? models : MODELS;
    const seconds = Number(params.get('benchSeconds'));
    this.#seconds = Number.isFinite(seconds) && seconds >= 5 ? seconds : 15;

    this.#root.className = 'bench';
    this.#video.muted = true;
    this.#video.playsInline = true;
    this.#status.className = 'bench-status';
    this.#root.append(this.#video, this.#status);
    parent.append(this.#root);
    this.#say('รอกล้อง…');
  }

  setTrack(track: MediaStreamTrack, settings: CameraSettings): void {
    this.#track = track;
    this.#settings = settings;
    this.#video.srcObject = new MediaStream([track.clone()]);
    void this.#video.play();
    if (!this.#started) {
      this.#started = true;
      this.#run().catch((error: unknown) => {
        this.#say(`Benchmark failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    }
  }

  setError(message: string): void {
    this.#say(message);
  }

  async #run(): Promise<void> {
    for (let s = COUNTDOWN_S; s > 0; s--) {
      this.#say(
        `ยืนนิ่ง ๆ ห่างกล้องประมาณ 2 เมตร ให้กล้องเห็นถึงสะโพก\nเริ่มวัดใน ${String(s)}…`,
        `จะวัด ${this.#models.join(' → ')} รุ่นละ ${String(this.#seconds)} วินาที`,
      );
      await wait(1000);
    }
    const results: BenchResult[] = [];
    for (const model of this.#models) results.push(await this.#measure(model));

    const report: BenchReport = {
      createdAt: new Date().toISOString(),
      userAgent: navigator.userAgent,
      camera: this.#requireSettings(),
      filter: perceptionDefaults.filter,
      seconds: this.#seconds,
      results,
    };
    console.info('[bench] report', report);
    this.#showReport(report);
  }

  async #measure(model: PoseModel): Promise<BenchResult> {
    const capacity = Math.ceil(this.#seconds * 120);
    const inference = new RollingWindow(capacity);
    const latency = new RollingWindow(capacity);
    const rate = new RateMeter(capacity);
    const raw = new JitterMeter(capacity);
    const filtered = new JitterMeter(capacity);
    let frames = 0;
    let withPerson = 0;
    let measuring = false;

    this.#say(`กำลังโหลดโมเดล ${model}…`);
    let delegate: PerceptionOptions['delegate'] = 'GPU';
    const record = (d: PoseDetections) => {
      if (!measuring) return;
      frames++;
      inference.push(d.inferenceMs);
      latency.push(performance.timeOrigin + performance.now() - d.receivedAt);
      rate.tick(performance.now());
      if (d.player) {
        withPerson++;
        raw.add(d.landmarks, d.width, d.height);
        filtered.add(d.player, d.width, d.height);
      } else {
        raw.reset();
        filtered.reset();
      }
    };

    const client = await new Promise<PerceptionClient>((resolve, reject) => {
      const c: PerceptionClient = new PerceptionClient(
        { ...perceptionDefaults, model },
        {
          onReady: (options) => {
            delegate = options.delegate;
            resolve(c);
          },
          onDetections: record,
          onError: (message) => {
            reject(new Error(message));
          },
        },
      );
    });

    try {
      client.attachTrack(this.#requireTrack().clone());
      this.#say(`${model}: วอร์มอัพ…`);
      await wait(WARMUP_S * 1000);
      measuring = true;
      for (let s = this.#seconds; s > 0; s--) {
        this.#say(`กำลังวัด ${model} — ยืนนิ่ง ๆ`, `เหลือ ${String(s)} วินาที`);
        await wait(1000);
      }
      measuring = false;
    } finally {
      client.dispose();
    }

    return {
      model,
      delegate,
      frames,
      inference: {
        mean: inference.mean(),
        p50: inference.percentile(50),
        p95: inference.percentile(95),
      },
      fps: rate.rate(performance.now()),
      latency: { mean: latency.mean(), p95: latency.percentile(95) },
      jitter: { raw: raw.mean(), filtered: filtered.mean() },
      coverage: frames > 0 ? withPerson / frames : 0,
    };
  }

  #showReport(report: BenchReport): void {
    this.#video.remove();
    this.#status.remove();
    const { results } = report;
    const categories = results.map((r) => r.model);
    const cam = report.camera;

    const page = document.createElement('section');
    page.className = 'bench-report';
    page.innerHTML = `
      <h1>Pose model benchmark</h1>
      <p class="bench-meta"></p>`;
    const meta = page.querySelector('.bench-meta');
    if (meta) {
      meta.textContent = `${cam.label} · ${String(cam.width)}×${String(cam.height)} @ ${cam.frameRate.toFixed(0)} fps · ${String(report.seconds)} s per model · ${report.createdAt}`;
    }

    const section = (title: string, note: string, chart: HTMLElement) => {
      const h = document.createElement('h2');
      h.textContent = title;
      const p = document.createElement('p');
      p.className = 'bench-note';
      p.textContent = note;
      page.append(h, p, chart);
    };

    const frameBudget = 1000 / (cam.frameRate || 30);
    section(
      'Inference time per frame',
      'Bar = average, tick = p95. Must stay under the camera frame budget or frames are dropped.',
      barChart({
        categories,
        series: [
          { name: 'average', color: COLOR_FILTERED, values: results.map((r) => r.inference.mean) },
        ],
        markers: { name: 'p95', values: results.map((r) => r.inference.p95) },
        references: [{ value: frameBudget, label: `budget ${frameBudget.toFixed(1)} ms` }],
        unit: 'ms',
      }),
    );
    section(
      'Throughput',
      `Detections per second. The camera delivers ${cam.frameRate.toFixed(0)} fps.`,
      barChart({
        categories,
        series: [{ name: 'fps', color: COLOR_FILTERED, values: results.map((r) => r.fps) }],
        references: [{ value: cam.frameRate, label: 'camera' }],
        unit: 'fps',
      }),
    );
    section(
      'Jitter while standing still',
      'Mean frame-to-frame movement of nose, shoulders and wrists (source pixels). Lower is steadier.',
      barChart({
        categories,
        series: [
          { name: 'raw model output', color: COLOR_RAW, values: results.map((r) => r.jitter.raw) },
          {
            name: 'after One Euro filter',
            color: COLOR_FILTERED,
            values: results.map((r) => r.jitter.filtered),
          },
        ],
        unit: 'px',
        digits: 2,
      }),
    );

    page.append(resultsTable(results), downloadButton(report));
    this.#root.append(page);
  }

  #say(main: string, sub = ''): void {
    this.#status.textContent = '';
    const big = document.createElement('p');
    big.className = 'bench-main';
    big.textContent = main;
    const small = document.createElement('p');
    small.className = 'bench-sub';
    small.textContent = sub;
    this.#status.append(big, small);
  }

  #requireTrack(): MediaStreamTrack {
    if (!this.#track) throw new Error('camera not ready');
    return this.#track;
  }

  #requireSettings(): CameraSettings {
    if (!this.#settings) throw new Error('camera not ready');
    return this.#settings;
  }
}

function resultsTable(results: readonly BenchResult[]): HTMLElement {
  const table = document.createElement('table');
  table.className = 'bench-table';
  const head = [
    'model',
    'delegate',
    'frames',
    'inference avg',
    'p95',
    'fps',
    'latency avg',
    'jitter raw',
    'jitter filtered',
    'person in frame',
  ];
  const rows = results.map((r) => [
    r.model,
    r.delegate,
    String(r.frames),
    `${r.inference.mean.toFixed(1)} ms`,
    `${r.inference.p95.toFixed(1)} ms`,
    r.fps.toFixed(1),
    `${r.latency.mean.toFixed(1)} ms`,
    `${r.jitter.raw.toFixed(2)} px`,
    `${r.jitter.filtered.toFixed(2)} px`,
    `${(r.coverage * 100).toFixed(0)}%`,
  ]);
  for (const [i, cells] of [head, ...rows].entries()) {
    const tr = table.insertRow();
    for (const cell of cells) {
      const td = document.createElement(i === 0 ? 'th' : 'td');
      td.textContent = cell;
      tr.append(td);
    }
  }
  return table;
}

function downloadButton(report: BenchReport): HTMLElement {
  const link = document.createElement('a');
  link.className = 'bench-download';
  link.textContent = 'Download JSON';
  link.download = `bench-${report.createdAt.replaceAll(':', '-')}.json`;
  link.href = URL.createObjectURL(
    new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }),
  );
  return link;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
