/** Staff screen drawing: the mirrored camera, zone, dropped boxes and every skeleton, raw. */

export interface Scene {
  zone: [number, number] | null;
  /** Boxes the filters dropped before pose: outside the zone or too small. [0, 1] units. */
  dropped: { box: [number, number, number, number]; why: string }[];
  /** COCO-17 keypoints [0, 1], scores, and why the pose is not a player (null = it is). */
  poses: { kp: [number, number][]; sc: number[]; why: string | null }[];
}
/** Who the game follows: torso center in image [0, 1] coordinates. */
export interface Lock {
  state: string;
  x: number | null;
  y: number | null;
}

const WHY: Record<string, string> = {
  zone: 'ZONE นอกโซน',
  small: 'SMALL ตัวเล็ก/ไกล',
  unseen: 'UNSEEN หัว-ไหล่ไม่ชัด',
  head: 'HEAD หัวไม่อยู่ระหว่างไหล่',
  torso: 'TORSO ลำตัวผิดสัดส่วน',
  edge: 'EDGE ชิดขอบ',
};
const BONES: [number, number][] = [
  [5, 6],
  [5, 7],
  [7, 9],
  [6, 8],
  [8, 10],
  [5, 11],
  [6, 12],
  [11, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [0, 5],
  [0, 6],
];
const PASS = '#00ff66';
const PLAYER = '#ff2bd6';
const NO = '#7a7a7a';
const DROP = '#ffb000';

interface Fit {
  ox: number;
  oy: number;
  w: number;
  h: number;
}

function fit(canvas: HTMLCanvasElement, image: ImageBitmap | null): Fit {
  const aspect = image ? image.width / image.height : 16 / 9;
  let w = canvas.width;
  let h = w / aspect;
  if (h > canvas.height) {
    h = canvas.height;
    w = h * aspect;
  }
  return { ox: (canvas.width - w) / 2, oy: (canvas.height - h) / 2, w, h };
}

/** A click on the canvas → image [0, 1] coordinates (not mirrored), or null outside the image. */
export function imagePoint(
  canvas: HTMLCanvasElement,
  image: ImageBitmap | null,
  px: number,
  py: number,
): { x: number; y: number } | null {
  const scale = canvas.width / canvas.getBoundingClientRect().width;
  const { ox, oy, w, h } = fit(canvas, image);
  const u = (px * scale - ox) / w;
  const v = (py * scale - oy) / h;
  if (u < 0 || u > 1 || v < 0 || v > 1) return null;
  return { x: 1 - u, y: v };
}

export function draw(
  canvas: HTMLCanvasElement,
  image: ImageBitmap | null,
  scene: Scene | null,
  lock: Lock | null,
): void {
  const { width: cw, height: ch } = canvas.getBoundingClientRect();
  if (canvas.width !== Math.round(cw) || canvas.height !== Math.round(ch)) {
    canvas.width = Math.round(cw);
    canvas.height = Math.round(ch);
  }
  const g = canvas.getContext('2d');
  if (!g) return;
  g.fillStyle = '#000';
  g.fillRect(0, 0, canvas.width, canvas.height);
  const { ox, oy, w, h } = fit(canvas, image);
  // Mirrored, like the game: the player's right hand is on the right
  const X = (x: number) => ox + (1 - x) * w;
  const Y = (y: number) => oy + y * h;
  if (image) {
    g.save();
    g.translate(ox + w, oy);
    g.scale(-1, 1);
    g.globalAlpha = 0.75;
    g.drawImage(image, 0, 0, w, h);
    g.restore();
  }
  if (!scene) return;
  const size = Math.max(12, Math.round(h / 40));
  g.font = `${String(size)}px ui-monospace, 'DejaVu Sans Mono', monospace`;
  g.textBaseline = 'bottom';
  const label = (text: string, x: number, y: number, color: string) => {
    const tw = g.measureText(text).width;
    g.fillStyle = 'rgba(0,0,0,0.85)';
    g.fillRect(x - 3, y - size - 3, tw + 6, size + 5);
    g.fillStyle = color;
    g.fillText(text, x, y);
  };

  // The player: the passing pose nearest the game's lock
  let playerIndex = -1;
  if (lock?.x != null && lock.y != null) {
    let best = 0.15;
    scene.poses.forEach((p, i) => {
      if (p.why) return;
      const t = [5, 6, 11, 12].map((k) => p.kp[k] ?? [0, 0]);
      const tx = t.reduce((s, q) => s + (q[0] ?? 0), 0) / 4;
      const ty = t.reduce((s, q) => s + (q[1] ?? 0), 0) / 4;
      const d = Math.hypot(tx - (lock.x ?? 0), ty - (lock.y ?? 0));
      if (d < best) {
        best = d;
        playerIndex = i;
      }
    });
  }

  scene.dropped.forEach((d, i) => {
    const [x0, y0, x1, y1] = d.box;
    g.strokeStyle = DROP;
    g.lineWidth = 1;
    g.setLineDash([6, 4]);
    g.strokeRect(X(x1), Y(y0), X(x0) - X(x1), Y(y1) - Y(y0));
    g.setLineDash([]);
    label(
      `d${String(i)} ${WHY[d.why] ?? d.why} h=${(y1 - y0).toFixed(2)}`,
      X(x1) + 2,
      Y(y0) - 2,
      DROP,
    );
  });

  scene.poses.forEach((p, i) => {
    const color = i === playerIndex ? PLAYER : p.why ? NO : PASS;
    g.strokeStyle = color;
    g.lineWidth = i === playerIndex ? 4 : 2;
    for (const [a, b] of BONES) {
      const pa = p.kp[a];
      const pb = p.kp[b];
      if (!pa || !pb || (p.sc[a] ?? 0) < 0.3 || (p.sc[b] ?? 0) < 0.3) continue;
      g.beginPath();
      g.moveTo(X(pa[0]), Y(pa[1]));
      g.lineTo(X(pb[0]), Y(pb[1]));
      g.stroke();
    }
    g.fillStyle = color;
    p.kp.forEach(([x, y], k) => {
      if ((p.sc[k] ?? 0) < 0.3) return;
      g.fillRect(X(x) - 2, Y(y) - 2, 4, 4);
    });
    const xs = p.kp.map(([x]) => x);
    const ys = p.kp.map(([, y]) => y);
    const head = Math.min(p.sc[0] ?? 0, p.sc[5] ?? 0, p.sc[6] ?? 0);
    const tag =
      i === playerIndex
        ? `p${String(i)} PLAYER`
        : p.why
          ? `p${String(i)} ✕ ${WHY[p.why] ?? p.why}`
          : `p${String(i)} PASS (click = pick)`;
    label(
      `${tag}  head/sh ${head.toFixed(2)}  x=${((Math.min(...xs) + Math.max(...xs)) / 2).toFixed(2)}`,
      X(Math.max(...xs)),
      Y(Math.min(...ys)) - 4,
      color,
    );
  });

  if (scene.zone) {
    g.strokeStyle = PLAYER;
    g.lineWidth = 1;
    for (const z of scene.zone) {
      g.beginPath();
      g.moveTo(X(z), oy);
      g.lineTo(X(z), oy + h);
      g.stroke();
    }
  }
}
