import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CatmullRomCurve3,
  Color,
  DoubleSide,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  SRGBColorSpace,
  ShaderMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  TubeGeometry,
  Vector3,
  Material,
} from 'three';
import { bestPrice, busyByHour, CUP_COST, HOURS, profit } from './model';

/** Price axis of the surface (฿). */
const PRICE = { min: CUP_COST, max: 135 } as const;
/** World size: price across, hours in depth, profit up. */
const SIZE = { x: 4.2, z: 2.8, y: 1.5 } as const;
const COLS = 56;
/** Rows per hour: the crowd changes smoothly between the hours the AI prices. */
const SUB = 4;
const GOLD = '#ffc94d';

/**
 * EP II's last word in 3D (research 030): profit for every hour × price as a surface. The AI's
 * price each hour sits on the ridge; the single all-day price is a flat path across it. The
 * player turns and zooms it with their hands. Everything is computed from the slash model.
 */
export class ProfitSurface {
  readonly root = new Group();
  readonly #pivot = new Group();
  readonly #materials: Material[] = [];
  readonly #surfaceMat: ShaderMaterial;
  readonly #disposables: { dispose(): void }[] = [];
  #rise = 0;
  #opacity = 1;

  constructor(aiPrices: readonly number[], flatPrice: number) {
    const first = HOURS[0] ?? 7;
    const last = HOURS.at(-1) ?? 21;
    const hourAt = (row: number, rows: number) => first + ((last - first) * row) / (rows - 1);
    const rows = (HOURS.length - 1) * SUB + 1;
    let top = 0;
    for (const h of HOURS) top = Math.max(top, profit(bestPrice(busyByHour(h)), busyByHour(h)));
    const px = (p: number) => ((p - PRICE.min) / (PRICE.max - PRICE.min) - 0.5) * SIZE.x;
    const hz = (h: number) => ((h - first) / (last - first) - 0.5) * SIZE.z;
    const py = (p: number, h: number) => (Math.max(0, profit(p, busyByHour(h))) / top) * SIZE.y;

    // The surface: one vertex per (price, hour), height = profit
    const positions = new Float32Array(COLS * rows * 3);
    const heights = new Float32Array(COLS * rows);
    const uvs = new Float32Array(COLS * rows * 2);
    for (let r = 0; r < rows; r++) {
      const h = hourAt(r, rows);
      for (let c = 0; c < COLS; c++) {
        const p = PRICE.min + ((PRICE.max - PRICE.min) * c) / (COLS - 1);
        const i = r * COLS + c;
        positions.set([px(p), py(p, h), hz(h)], i * 3);
        heights[i] = py(p, h) / SIZE.y;
        uvs.set([c / (COLS - 1), r / (rows - 1)], i * 2);
      }
    }
    const index: number[] = [];
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < COLS - 1; c++) {
        const a = r * COLS + c;
        index.push(a, a + COLS, a + 1, a + 1, a + COLS, a + COLS + 1);
      }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setAttribute('aHeight', new BufferAttribute(heights, 1));
    geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
    geometry.setIndex(index);
    this.#surfaceMat = surfaceMaterial(HOURS.length - 1);
    this.#keep(geometry, this.#surfaceMat);
    this.#pivot.add(new Mesh(geometry, this.#surfaceMat));

    // The AI's price every hour: a gold path along the ridge, a bead per hour
    const ridge = HOURS.map((h, i) => {
      const p = aiPrices[i] ?? bestPrice(busyByHour(h));
      return new Vector3(px(p), py(p, h) + 0.02, hz(h));
    });
    const gold = new MeshBasicMaterial({ color: GOLD, transparent: true });
    const ridgeGeo = new TubeGeometry(new CatmullRomCurve3(ridge), 120, 0.028, 6, false);
    const bead = new SphereGeometry(0.06, 12, 8);
    this.#keep(gold, ridgeGeo, bead);
    this.#pivot.add(new Mesh(ridgeGeo, gold));
    for (const v of ridge) {
      const m = new Mesh(bead, gold);
      m.position.copy(v);
      this.#pivot.add(m);
    }

    // One price all day: a pale path at the same price through every hour
    const flat = [];
    for (let r = 0; r < rows; r += 2) {
      const h = hourAt(r, rows);
      flat.push(new Vector3(px(flatPrice), py(flatPrice, h) + 0.02, hz(h)));
    }
    const pale = new MeshBasicMaterial({ color: '#d9c9d6', transparent: true, opacity: 0.85 });
    const flatGeo = new TubeGeometry(new CatmullRomCurve3(flat), 80, 0.016, 5, false);
    this.#keep(pale, flatGeo);
    this.#pivot.add(new Mesh(flatGeo, pale));

    // Floor frame and axes
    const x0 = -SIZE.x / 2;
    const x1 = SIZE.x / 2;
    const z0 = -SIZE.z / 2;
    const z1 = SIZE.z / 2;
    const frame = new BufferGeometry().setFromPoints(
      [
        [x0, 0, z1, x1, 0, z1],
        [x0, 0, z0, x0, 0, z1],
        [x0, 0, z0, x1, 0, z0],
        [x1, 0, z0, x1, 0, z1],
        [x0, 0, z1, x0, SIZE.y, z1],
      ].flatMap(([a = 0, b = 0, c = 0, d = 0, e = 0, f = 0]) => [
        new Vector3(a, b, c),
        new Vector3(d, e, f),
      ]),
    );
    const lineMat = new LineBasicMaterial({ color: '#b98fb0', transparent: true, opacity: 0.7 });
    this.#keep(frame, lineMat);
    this.#pivot.add(new LineSegments(frame, lineMat));

    const label = (text: string, at: Vector3, color = '#f4e6f0', height = 0.2) => {
      const sprite = textSprite(text, color, height);
      sprite.position.copy(at);
      this.#keep(sprite.material, sprite.material.map as CanvasTexture);
      this.#pivot.add(sprite);
    };
    for (const p of [40, 80, 120]) label(`฿${String(p)}`, new Vector3(px(p), -0.12, z1 + 0.28));
    label('ราคา →', new Vector3(x1 - 0.2, -0.12, z1 + 0.62), '#ff9ec7', 0.22);
    for (const h of [8, 14, 20]) {
      label(`${String(h).padStart(2, '0')}:00`, new Vector3(x1 + 0.45, -0.05, hz(h)));
    }
    label('กำไร', new Vector3(x0 - 0.05, SIZE.y + 0.22, z1), '#ff9ec7', 0.22);
    label(
      'ราคา AI',
      ridge[ridge.length - 3]?.clone().add(new Vector3(0.1, 0.35, 0)) ?? new Vector3(),
      GOLD,
      0.24,
    );

    this.root.add(this.#pivot);
    this.#pivot.position.y = -SIZE.y / 3;
    this.update(0);
  }

  /** 0..1: the surface grows up out of the floor. */
  set rise(value: number) {
    this.#rise = value;
  }

  set opacity(value: number) {
    this.#opacity = value;
  }

  /** Turn (radians about the vertical), tilt (radians, toward the viewer) and zoom (scale). */
  setView(yaw: number, tilt: number, zoom: number): void {
    this.#pivot.rotation.set(0, yaw, 0);
    this.root.rotation.set(tilt, 0, 0);
    this.root.scale.setScalar(zoom);
  }

  update(timeSec: number): void {
    const u = this.#surfaceMat.uniforms;
    if (u['uRise']) u['uRise'].value = this.#rise;
    if (u['uTime']) u['uTime'].value = timeSec;
    if (u['uOpacity']) u['uOpacity'].value = this.#opacity;
    // Everything but the surface fades in once it has risen
    const rest = this.#opacity * Math.max(0, (this.#rise - 0.6) / 0.4);
    for (const m of this.#materials) {
      if (m === this.#surfaceMat) continue;
      m.opacity = rest * (m.userData['base'] as number);
    }
  }

  dispose(): void {
    this.root.removeFromParent();
    for (const d of this.#disposables) d.dispose();
  }

  #keep(...items: { dispose(): void }[]): void {
    for (const item of items) {
      this.#disposables.push(item);
      if (item instanceof Material) {
        item.userData['base'] = item.opacity;
        this.#materials.push(item as Material);
      }
    }
  }
}

/** Height-colored surface (violet → pink → gold) with a grid of hours and prices drawn on it. */
function surfaceMaterial(hours: number): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uRise: { value: 0 },
      uTime: { value: 0 },
      uOpacity: { value: 1 },
      uLow: { value: new Color('#3a1550') },
      uMid: { value: new Color('#e0428a') },
      uHigh: { value: new Color(GOLD) },
      uGrid: { value: [12, hours] },
    },
    transparent: true,
    side: DoubleSide,
    depthWrite: false,
    vertexShader: /* glsl */ `
      attribute float aHeight;
      uniform float uRise;
      varying float vH;
      varying vec2 vUv;
      void main() {
        vH = aHeight;
        vUv = uv;
        vec3 p = position;
        p.y *= uRise;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uLow;
      uniform vec3 uMid;
      uniform vec3 uHigh;
      uniform vec2 uGrid;
      uniform float uOpacity;
      varying float vH;
      varying vec2 vUv;
      void main() {
        vec3 col = vH < 0.55 ? mix(uLow, uMid, vH / 0.55) : mix(uMid, uHigh, (vH - 0.55) / 0.45);
        vec2 g = abs(fract(vUv * uGrid - 0.5) - 0.5) / fwidth(vUv * uGrid);
        float line = 1.0 - min(min(g.x, g.y), 1.0);
        col += line * 0.35;
        gl_FragColor = vec4(col, (0.55 + 0.35 * vH + 0.25 * line) * uOpacity);
      }`,
  });
}

/** A camera-facing text label, `height` world units tall. */
function textSprite(text: string, color: string, height: number): Sprite {
  const px = 64;
  const canvas = document.createElement('canvas');
  const g = canvas.getContext('2d');
  const font = `700 ${String(px)}px 'Bai Jamjuree', 'Orbitron', sans-serif`;
  let width = px * text.length;
  if (g) {
    g.font = font;
    width = Math.ceil(g.measureText(text).width) + 16;
  }
  canvas.width = width;
  canvas.height = Math.ceil(px * 1.4);
  if (g) {
    g.font = font;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 8;
    g.strokeStyle = 'rgba(10,4,14,0.9)';
    g.strokeText(text, width / 2, canvas.height / 2);
    g.fillStyle = color;
    g.fillText(text, width / 2, canvas.height / 2);
  }
  const map = new CanvasTexture(canvas);
  map.colorSpace = SRGBColorSpace;
  const material = new SpriteMaterial({
    map,
    transparent: true,
    depthTest: false,
  });
  const sprite = new Sprite(material);
  sprite.scale.set((height * canvas.width) / canvas.height, height, 1);
  return sprite;
}
