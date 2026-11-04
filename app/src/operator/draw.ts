/** Drawing for the staff screen: the mirrored camera, zone, dropped boxes and every skeleton. */

export interface Scene {
  zone: [number, number] | null;
  /** Boxes the filters dropped before pose: outside the zone or too small. [0, 1] units. */
  dropped: { box: [number, number, number, number]; why: string }[];
  /** COCO-17 keypoints [0, 1], scores, and why the pose is not a player (null = it is). */
  poses: { kp: [number, number][]; sc: number[]; why: string | null }[];
}

const WHY: Record<string, string> = {
  zone: 'นอกโซน',
  small: 'ตัวเล็ก / อยู่ไกล',
  unseen: 'เห็นหัว-ไหล่ไม่ชัด',
  head: 'หัวไม่อยู่ระหว่างไหล่',
  torso: 'ลำตัวผิดสัดส่วน',
  edge: 'ชิดขอบภาพ',
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
const OK = '#4ade80';
const NO = '#9a8a99';
const DROP = '#f59e0b';

export function draw(
  canvas: HTMLCanvasElement,
  image: ImageBitmap | null,
  scene: Scene | null,
): void {
  const { width: cw, height: ch } = canvas.getBoundingClientRect();
  if (canvas.width !== Math.round(cw) || canvas.height !== Math.round(ch)) {
    canvas.width = Math.round(cw);
    canvas.height = Math.round(ch);
  }
  const g = canvas.getContext('2d');
  if (!g) return;
  g.clearRect(0, 0, canvas.width, canvas.height);
  const aspect = image ? image.width / image.height : 16 / 9;
  // Fit the camera into the canvas
  let w = canvas.width;
  let h = w / aspect;
  if (h > canvas.height) {
    h = canvas.height;
    w = h * aspect;
  }
  const ox = (canvas.width - w) / 2;
  const oy = (canvas.height - h) / 2;
  // Mirrored, like the game: the player's right hand is on the right
  const X = (x: number) => ox + (1 - x) * w;
  const Y = (y: number) => oy + y * h;
  if (image) {
    g.save();
    g.translate(ox + w, oy);
    g.scale(-1, 1);
    g.drawImage(image, 0, 0, w, h);
    g.restore();
  }
  if (!scene) return;
  g.font = `600 ${String(Math.max(14, Math.round(h / 34)))}px 'Bai Jamjuree', sans-serif`;
  g.textBaseline = 'bottom';
  const label = (text: string, x: number, y: number, color: string) => {
    const pad = 6;
    const tw = g.measureText(text).width;
    g.fillStyle = 'rgba(10,4,14,0.8)';
    g.fillRect(x - pad, y - h / 26 - pad, tw + 2 * pad, h / 26 + pad);
    g.fillStyle = color;
    g.fillText(text, x, y);
  };

  for (const d of scene.dropped) {
    const [x0, y0, x1, y1] = d.box;
    g.strokeStyle = DROP;
    g.lineWidth = 2;
    g.setLineDash([8, 6]);
    g.strokeRect(X(x1), Y(y0), X(x0) - X(x1), Y(y1) - Y(y0));
    g.setLineDash([]);
    label(WHY[d.why] ?? d.why, X(x1) + 4, Y(y0) - 2, DROP);
  }

  for (const p of scene.poses) {
    const color = p.why ? NO : OK;
    g.strokeStyle = color;
    g.lineWidth = p.why ? 3 : 5;
    g.lineCap = 'round';
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
    p.kp.forEach(([x, y], i) => {
      if ((p.sc[i] ?? 0) < 0.3) return;
      g.beginPath();
      g.arc(X(x), Y(y), p.why ? 3 : 5, 0, Math.PI * 2);
      g.fill();
    });
    const head = p.kp[0] ?? [0.5, 0.5];
    const top = Math.min(...p.kp.map(([, y]) => y));
    label(p.why ? `✕ ${WHY[p.why] ?? p.why}` : '✓ ผ่าน', X(head[0]) - 40, Y(top) - 10, color);
  }
}
