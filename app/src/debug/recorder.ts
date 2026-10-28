import './recorder.css';
import type { CameraSettings } from '../perception/camera';
import type { PoseDetections } from '../perception/protocol';
import {
  encodeSession,
  POSE_SESSION_VERSION,
  toClipFrame,
  type PoseClip,
  type PoseSession,
} from './pose-recording';
import { RECORD_SCRIPT, type ClipSpec } from './record-script';

const INTRO_S = 5;
const COUNTDOWN_S = 3;

/**
 * `?record` — guided session that records raw pose detections for replay tests.
 * `?record=draw,swipe` records only those clips. Runs on top of the debug overlay.
 */
export class RecorderPanel {
  readonly #panel = document.createElement('div');
  readonly #script: readonly ClipSpec[];
  #camera: CameraSettings | null = null;
  /** Description of the pose source actually in use, e.g. `rtmpose-x/trt-fp16 + yolox-m/cuda`. */
  #model: string | null = null;
  #current: PoseClip | null = null;
  #clipStart = 0;
  #started = false;

  constructor(parent: HTMLElement, search: string) {
    const wanted = (new URLSearchParams(search).get('record') ?? '').split(',');
    const subset = RECORD_SCRIPT.filter((c) => wanted.includes(c.id));
    this.#script = subset.length > 0 ? subset : RECORD_SCRIPT;
    this.#panel.className = 'recorder';
    parent.append(this.#panel);
    this.#show('รอกล้องและโมเดล…');
  }

  setCamera(settings: CameraSettings): void {
    this.#camera = settings;
    this.#maybeStart();
  }

  setModel(model: string): void {
    this.#model = model;
    this.#maybeStart();
  }

  addDetections(d: PoseDetections): void {
    if (!this.#current) return;
    const t = d.receivedAt - this.#clipStart;
    this.#current.frames.push(toClipFrame(t, d.poseCount, d.landmarks));
  }

  #maybeStart(): void {
    if (this.#started || !this.#camera || this.#model === null) return;
    this.#started = true;
    this.#run().catch((error: unknown) => {
      this.#show(`Recording failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  async #run(): Promise<void> {
    const total = this.#script.reduce((s, c) => s + c.seconds + COUNTDOWN_S, 0);
    for (let s = INTRO_S; s > 0; s--) {
      this.#show(
        `จะอัดท่าทาง ${String(this.#script.length)} ท่า รวมประมาณ ${String(Math.ceil(total / 60))} นาที`,
        `ยืนห่างกล้องประมาณ 2 เมตร · เก็บเฉพาะพิกัดจุดบนร่างกาย ไม่บันทึกภาพ · เริ่มใน ${String(s)}`,
      );
      await wait(1000);
    }

    const clips: PoseClip[] = [];
    for (const [i, spec] of this.#script.entries()) {
      const step = `ท่า ${String(i + 1)}/${String(this.#script.length)}`;
      for (let s = COUNTDOWN_S; s > 0; s--) {
        this.#show(spec.instruction, `${step} · เตรียมตัว ${String(s)}`);
        await wait(1000);
      }
      const clip: PoseClip = { id: spec.id, instruction: spec.instruction, frames: [] };
      this.#clipStart = performance.timeOrigin + performance.now();
      this.#current = clip;
      for (let s = spec.seconds; s > 0; s--) {
        this.#show(spec.instruction, `${step} · ● REC ${String(s)}`, true);
        await wait(1000);
      }
      this.#current = null;
      clips.push(clip);
    }

    await this.#finish(clips);
  }

  async #finish(clips: PoseClip[]): Promise<void> {
    const camera = this.#camera;
    const model = this.#model;
    if (!camera || model === null) throw new Error('camera or model missing');
    const session: PoseSession = {
      version: POSE_SESSION_VERSION,
      recordedAt: new Date().toISOString(),
      camera,
      model,
      clips,
    };
    const blob = await encodeSession(session);
    const name = `pose-session-${session.recordedAt.replaceAll(':', '-')}.json.gz`;

    this.#panel.textContent = '';
    this.#panel.classList.remove('recording');
    this.#panel.classList.add('recorder-done');
    const title = document.createElement('p');
    title.className = 'recorder-main';
    title.textContent = `อัดเสร็จ ${String(clips.length)} ท่า (${(blob.size / 1024).toFixed(0)} KB)`;
    const list = document.createElement('ul');
    list.className = 'recorder-summary';
    for (const clip of clips) {
      const withPerson = clip.frames.filter((f) => f.n > 0).length;
      const item = document.createElement('li');
      item.textContent = `${clip.id} · ${String(clip.frames.length)} frames · person in ${String(Math.round((withPerson / Math.max(clip.frames.length, 1)) * 100))}%`;
      list.append(item);
    }
    const link = document.createElement('a');
    link.className = 'recorder-download';
    link.textContent = `Download ${name}`;
    link.download = name;
    link.href = URL.createObjectURL(blob);
    this.#panel.append(title, list, link);
  }

  #show(main: string, sub = '', recording = false): void {
    this.#panel.classList.toggle('recording', recording);
    this.#panel.textContent = '';
    const big = document.createElement('p');
    big.className = 'recorder-main';
    big.textContent = main;
    const small = document.createElement('p');
    small.className = 'recorder-sub';
    small.textContent = sub;
    this.#panel.append(big, small);
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
