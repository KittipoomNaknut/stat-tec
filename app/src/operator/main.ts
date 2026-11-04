/**
 * Staff screen (research 034, 035): raw numbers, the camera with every skeleton the pose service
 * saw and why it was or was not taken, the live booth log, and controls: start, skip a line,
 * skip a chapter, pause, reset, and click a person to make them the player. A light 2D page for
 * a second monitor; camera images stay on this machine.
 */
import './operator.css';
import { perceptionDefaults } from '../config/perception';
import { draw, imagePoint, type Lock, type Scene } from './draw';

interface Health {
  fps?: number;
  inferenceMs?: number;
  appFps?: number | null;
  gpuC?: number;
  gpuLoad?: number;
  cpuC?: number;
  people?: number;
  clients?: number;
  mains?: boolean;
}
interface Ops {
  health: Health;
  problems: { title: string; todo: string; sinceS: number }[];
  today: Record<string, number | null>;
}
type Command = 'start' | 'skip' | 'next' | 'pause' | 'reset';

const KEYS: Record<string, [Command, string]> = {
  s: ['start', 'start    เริ่มเกม / ข้ามชูสองมือ'],
  n: ['skip', 'skip     ข้ามบทพูด'],
  b: ['next', 'next     ข้ามทั้งบท'],
  p: ['pause', 'pause    พัก / เล่นต่อ'],
  r: ['reset', 'reset    กลับหน้าแรก'],
};

const root = document.getElementById('operator') as HTMLElement;
root.innerHTML = `
  <section class="op-cam"><canvas></canvas><pre class="op-wait">waiting for pose service on :8765 …</pre></section>
  <aside class="op-side">
    <pre class="op-stat"></pre>
    <pre class="op-problems"></pre>
    <div class="op-keys">${Object.entries(KEYS)
      .map(([k, [, label]]) => `<button data-key="${k}">[${k.toUpperCase()}] ${label}</button>`)
      .join('')}<p>click a skeleton = make them the player</p></div>
    <pre class="op-ack"></pre>
    <ol class="op-log"></ol>
  </aside>`;
const canvas = root.querySelector('canvas') as HTMLCanvasElement;
const wait = root.querySelector('.op-wait') as HTMLElement;
const stat = root.querySelector('.op-stat') as HTMLElement;
const problems = root.querySelector('.op-problems') as HTMLElement;
const ack = root.querySelector('.op-ack') as HTMLElement;
const feed = root.querySelector('.op-log') as HTMLOListElement;

let socket: WebSocket | null = null;
let image: ImageBitmap | null = null;
let scene: Scene | null = null;
let lock: Lock | null = null;
let health: Health = {};
let dirty = false;
let drawnAt = 0;
/** At most this often: plenty to watch skeletons, half the preview rate (research 034). */
const DRAW_EVERY_MS = 1000 / 12;

function connect(): void {
  // ?server=ws://… like the game (a second pose service, or a test one)
  const base = new URLSearchParams(location.search).get('server') ?? perceptionDefaults.serverUrl;
  const ws = new WebSocket(`${base}/operator`);
  ws.binaryType = 'arraybuffer';
  ws.onopen = () => {
    socket = ws;
    wait.hidden = true;
  };
  ws.onclose = () => {
    socket = null;
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
    } else if (msg.type === 'lock') {
      lock = msg as unknown as Lock;
      showStat();
    } else if (msg.type === 'log') {
      addLine(msg['t'] as number, msg['cls'] as string, msg['text'] as string);
    } else if (msg.type === 'ops') {
      showOps(msg as unknown as Ops);
    }
  };
}

function send(command: Record<string, unknown>, label: string): void {
  if (socket?.readyState !== WebSocket.OPEN) {
    ack.textContent = `! not connected — "${label}" not sent`;
    return;
  }
  socket.send(JSON.stringify({ type: 'command', ...command }));
  const at = new Date().toLocaleTimeString('en-GB');
  ack.textContent = `> ${at}  sent ${label}${health.clients ? '' : '   (! game not connected)'}`;
}

function frame(now: number): void {
  if (dirty && now - drawnAt >= DRAW_EVERY_MS) {
    dirty = false;
    drawnAt = now;
    draw(canvas, image, scene, lock);
  }
  requestAnimationFrame(frame);
}

function addLine(t: number, cls: string, text: string): void {
  // Follow new lines only while at the bottom: scrolling up to read stays put
  const atBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 24;
  const li = document.createElement('li');
  if (cls) li.className = `is-${cls}`;
  li.textContent = `${new Date(t * 1000).toLocaleTimeString('en-GB')}  ${text}`;
  li.title = li.textContent;
  feed.append(li);
  while (feed.children.length > 200) feed.firstElementChild?.remove();
  if (atBottom) feed.scrollTop = feed.scrollHeight;
}

const n = (v: number | null | undefined, unit = '') => (v == null ? '   -' : `${String(v)}${unit}`);

function showStat(): void {
  const h = health;
  const where =
    lock?.x == null || lock.y == null ? '' : ` @ ${lock.x.toFixed(2)},${lock.y.toFixed(2)}`;
  stat.textContent = [
    `CAM   ${n(h.fps, ' fps').padEnd(12)}POSE ${n(h.inferenceMs, ' ms').padEnd(11)}GAME ${h.clients ? n(h.appFps, ' fps') : 'NOT CONNECTED'}`,
    `GPU   ${n(h.gpuC, '°C').padEnd(7)}${n(h.gpuLoad, '%').padEnd(5)}CPU  ${n(h.cpuC, '°C').padEnd(11)}POWER ${h.mains === false ? 'BATTERY' : 'mains'}`,
    `SEEN  ${String(h.people ?? 0)} people     LOCK ${lock?.state ?? '-'}${where}`,
  ].join('\n');
  stat.classList.toggle('is-bad', !h.clients || (h.fps ?? 30) < 20 || (h.inferenceMs ?? 0) > 40);
}

function showOps(o: Ops): void {
  health = o.health;
  showStat();
  const d = o.today;
  const today = `TODAY visits ${String(d['visits'])} done ${String(d['finished'])} left ${String(d['abandoned'])} avg ${d['avgMin'] == null ? '-' : `${String(d['avgMin'])}m`} timeouts ${String(d['poseTimeouts'])}/${String(d['poses'])} problems ${String(d['problems'])} errors ${String(d['errors'])}`;
  problems.textContent = o.problems.length
    ? `${o.problems.map((p) => `!! ${p.title}  ${String(p.sinceS)}s\n   → ${p.todo}`).join('\n')}\n${today}`
    : `OK no problems\n${today}`;
  problems.classList.toggle('is-bad', o.problems.length > 0);
}

window.addEventListener('keydown', (e) => {
  const key = KEYS[e.key.toLowerCase()];
  if (!key || e.ctrlKey || e.altKey || e.metaKey) return;
  e.preventDefault();
  send({ name: key[0] }, key[0]);
});
root.querySelector('.op-keys')?.addEventListener('click', (e) => {
  const key = (e.target as HTMLElement).closest('button')?.dataset['key'];
  const entry = key ? KEYS[key] : undefined;
  if (entry) send({ name: entry[0] }, entry[0]);
});
canvas.addEventListener('click', (e) => {
  const p = imagePoint(canvas, image, e.offsetX, e.offsetY);
  if (!p) return;
  send({ name: 'pick', x: p.x, y: p.y }, `pick @ ${p.x.toFixed(2)},${p.y.toFixed(2)}`);
});

connect();
requestAnimationFrame(frame);
