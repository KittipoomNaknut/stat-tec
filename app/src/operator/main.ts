/**
 * The staff screen (research 034): the camera with every skeleton the pose service saw, why each
 * one was or was not taken as a player, and the live booth log. A second, light page for a second
 * monitor: it only draws a 2D canvas when new data arrives, and the pose service sends it the
 * same preview JPEG it already makes for the player-cam. Camera images stay on this machine.
 */
import '../styles/fonts.css';
import '../styles/tokens.css';
import './operator.css';
import { perceptionDefaults } from '../config/perception';
import { draw, type Scene } from './draw';

interface Health {
  fps?: number;
  inferenceMs?: number;
  appFps?: number | null;
  gpuC?: number;
  cpuC?: number;
  people?: number;
  clients?: number;
  mains?: boolean;
}
interface Ops {
  health: Health;
  problems: { title: string; todo: string; sinceS: number }[];
  today: {
    visits: number;
    finished: number;
    abandoned: number;
    avgMin: number | null;
    poseTimeouts: number;
    poses: number;
    problems: number;
    errors: number;
  };
}

const root = document.getElementById('operator') as HTMLElement;
root.innerHTML = `
  <section class="op-cam">
    <canvas></canvas>
    <p class="op-wait">รอตัวจับท่า… (./scripts/demo.sh start)</p>
    <ul class="op-legend">
      <li class="is-ok">✓ ผ่าน: ส่งให้เกม (เกมเลือกคนที่อยู่กลางและใกล้สุด 1 คน)</li>
      <li class="is-no">✕ ถูกตัด + เหตุผล</li><li class="is-drop">กรอบส้ม = ไม่ถูกจับท่า</li>
    </ul>
  </section>
  <aside class="op-side">
    <div class="op-tiles"></div>
    <div class="op-problems"></div>
    <p class="op-today"></p>
    <ol class="op-log"></ol>
  </aside>`;
const canvas = root.querySelector('canvas') as HTMLCanvasElement;
const wait = root.querySelector('.op-wait') as HTMLElement;
const tiles = root.querySelector('.op-tiles') as HTMLElement;
const problems = root.querySelector('.op-problems') as HTMLElement;
const today = root.querySelector('.op-today') as HTMLElement;
const feed = root.querySelector('.op-log') as HTMLOListElement;

let image: ImageBitmap | null = null;
let scene: Scene | null = null;
let dirty = false;
let drawnAt = 0;
/** At most this often: plenty to watch skeletons, and half the preview rate (research 034). */
const DRAW_EVERY_MS = 1000 / 12;

function connect(): void {
  // ?server=ws://… like the game (a second pose service, or a test one)
  const base = new URLSearchParams(location.search).get('server') ?? perceptionDefaults.serverUrl;
  const ws = new WebSocket(`${base}/operator`);
  ws.binaryType = 'arraybuffer';
  ws.onopen = () => {
    wait.hidden = true;
  };
  ws.onclose = () => {
    wait.hidden = false;
    setTimeout(connect, 2000);
  };
  ws.onmessage = (event: MessageEvent<ArrayBuffer | string>) => {
    const { data } = event;
    if (typeof data !== 'string') {
      // "STJ1" + JPEG: the camera preview
      void createImageBitmap(new Blob([data.slice(4)], { type: 'image/jpeg' })).then((b) => {
        image?.close();
        image = b;
        dirty = true;
      });
      return;
    }
    const msg = JSON.parse(data) as { type: string } & Record<string, unknown>;
    if (msg.type === 'scene') {
      scene = msg as unknown as Scene;
      dirty = true;
    } else if (msg.type === 'log') {
      addLine(msg['t'] as number, msg['cls'] as string, msg['text'] as string);
    } else if (msg.type === 'ops') {
      showOps(msg as unknown as Ops);
    }
  };
}

function frame(now: number): void {
  if (dirty && now - drawnAt >= DRAW_EVERY_MS) {
    dirty = false;
    drawnAt = now;
    draw(canvas, image, scene);
  }
  requestAnimationFrame(frame);
}

function addLine(t: number, cls: string, text: string): void {
  const li = document.createElement('li');
  if (cls) li.className = `is-${cls}`;
  const time = document.createElement('time');
  time.textContent = new Date(t * 1000).toLocaleTimeString('th-TH', { hour12: false });
  li.append(time, document.createTextNode(text));
  feed.append(li);
  while (feed.children.length > 60) feed.firstElementChild?.remove();
  feed.scrollTop = feed.scrollHeight;
}

function showOps({ health: h, problems: open, today: d }: Ops): void {
  const tile = (label: string, value: string, state: 'ok' | 'warn' | 'bad' | 'off') =>
    `<div class="op-tile is-${state}"><span>${label}</span><b>${value}</b></div>`;
  const grade = (
    v: number | null | undefined,
    bad: (n: number) => boolean,
    warn: (n: number) => boolean,
  ) => (v == null ? 'off' : bad(v) ? 'bad' : warn(v) ? 'warn' : 'ok');
  tiles.innerHTML = [
    tile(
      'กล้อง',
      h.fps == null ? '-' : `${String(h.fps)} fps`,
      grade(
        h.fps,
        (n) => n < 20,
        (n) => n < 24,
      ),
    ),
    tile(
      'จับท่า',
      h.inferenceMs == null ? '-' : `${String(h.inferenceMs)} ms`,
      grade(
        h.inferenceMs,
        (n) => n > 40,
        (n) => n > 30,
      ),
    ),
    tile(
      'เกม',
      h.appFps == null ? 'ไม่ได้เปิด' : `${String(h.appFps)} fps`,
      h.clients
        ? grade(
            h.appFps,
            (n) => n < 30,
            (n) => n < 45,
          )
        : 'bad',
    ),
    tile(
      'GPU',
      h.gpuC == null ? '-' : `${String(h.gpuC)}°C`,
      grade(
        h.gpuC,
        (n) => n >= 85,
        (n) => n >= 78,
      ),
    ),
    tile(
      'CPU',
      h.cpuC == null ? '-' : `${String(h.cpuC)}°C`,
      grade(
        h.cpuC,
        (n) => n >= 95,
        (n) => n >= 85,
      ),
    ),
    tile('ผู้เล่นในภาพ', String(h.people ?? 0), h.people ? 'ok' : 'off'),
  ].join('');
  if (h.mains === false) tiles.insertAdjacentHTML('beforeend', tile('ไฟ', 'ใช้แบต', 'bad'));
  problems.innerHTML = open.length
    ? open
        .map(
          (p) =>
            `<div class="op-problem"><b>█ ${p.title}</b> <small>${String(p.sinceS)} s</small>${p.todo ? `<p>→ ${p.todo}</p>` : ''}</div>`,
        )
        .join('')
    : '<div class="op-fine">✓ ไม่มีปัญหา</div>';
  today.textContent =
    `วันนี้ ${String(d.visits)} รอบ (จบ ${String(d.finished)} · ออกกลางคัน ${String(d.abandoned)})` +
    ` · เฉลี่ย ${d.avgMin == null ? '-' : `${String(d.avgMin)} นาที`}` +
    ` · ท่าหมดเวลา ${String(d.poseTimeouts)}/${String(d.poses)} · ปัญหา ${String(d.problems)}`;
}

connect();
requestAnimationFrame(frame);
