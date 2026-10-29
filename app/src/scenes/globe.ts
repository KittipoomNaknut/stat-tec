import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  Points,
  ShaderMaterial,
  TorusGeometry,
} from 'three';
import { HologramObject } from './hologram-object';
import { palette } from '../config/palette';

/**
 * A data globe: thousands of points on a sphere that pulse in waves, circled by orbit rings.
 * The attract screen's centerpiece — reads as "the world's data" from across the room.
 */
export class DataGlobe {
  readonly root = new Group();
  readonly #points: Points;
  readonly #material: ShaderMaterial;
  readonly #rings: HologramObject[];

  constructor(count = 4200, radius = 1.7) {
    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    // Fibonacci sphere: even coverage without clumps at the poles.
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < count; i++) {
      const y = 1 - (i / (count - 1)) * 2;
      const r = Math.sqrt(1 - y * y);
      const a = golden * i;
      positions[i * 3] = Math.cos(a) * r * radius;
      positions[i * 3 + 1] = y * radius;
      positions[i * 3 + 2] = Math.sin(a) * r * radius;
      seeds[i] = (Math.sin(i * 12.9898) * 43758.5453) % 1;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setAttribute('aSeed', new BufferAttribute(seeds, 1));
    this.#material = new ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uOpacity: { value: 1 },
        uColor: { value: new Color(palette.pink) },
        uAccent: { value: new Color(palette.peach) },
        uResolution: { value: 1 },
      },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform float uResolution;
        attribute float aSeed;
        varying float vGlow;
        varying float vGold;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          // Waves of light rolling from pole to pole; a few points flare gold ("transactions").
          float wave = sin(position.y * 3.0 - uTime * 1.6) * 0.5 + 0.5;
          vGold = step(0.985, fract(abs(aSeed) * 7.0 + uTime * 0.05));
          vGlow = 0.35 + wave * 0.65;
          // Back of the globe dimmer: depth without depth testing.
          vGlow *= smoothstep(-6.0, -3.5, mv.z) * 0.7 + 0.3;
          gl_PointSize = (2.6 + wave * 2.2 + vGold * 4.0) * (16.0 / -mv.z) * uResolution;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform vec3 uAccent;
        uniform float uOpacity;
        varying float vGlow;
        varying float vGold;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.05, d) * vGlow * 1.5 * uOpacity;
          gl_FragColor = vec4(mix(uColor, uAccent, vGold) * a, a);
        }`,
    });
    this.#points = new Points(geometry, this.#material);
    this.#rings = [
      new HologramObject(new TorusGeometry(radius * 1.35, 0.012, 6, 160), palette.pink, 90),
      new HologramObject(new TorusGeometry(radius * 1.6, 0.008, 6, 160), palette.peach, 90),
    ];
    const [inner, outer] = this.#rings;
    if (inner) inner.root.rotation.set(Math.PI / 2.3, 0, 0.2);
    if (outer) outer.root.rotation.set(Math.PI / 1.8, 0.3, -0.3);
    this.root.add(this.#points, ...this.#rings.map((r) => r.root));
  }

  set opacity(value: number) {
    (this.#material.uniforms['uOpacity'] as { value: number }).value = value;
    for (const r of this.#rings) r.opacity = value * 0.8;
    this.root.visible = value > 0.001;
  }

  /** Drawing-buffer height / 1080 (point sizes in pixels). */
  set resolution(value: number) {
    (this.#material.uniforms['uResolution'] as { value: number }).value = value;
  }

  update(timeSec: number): void {
    (this.#material.uniforms['uTime'] as { value: number }).value = timeSec;
    this.#points.rotation.y = timeSec * 0.12;
    const [inner, outer] = this.#rings;
    if (inner) inner.root.rotation.z = 0.2 + timeSec * 0.15;
    if (outer) outer.root.rotation.z = -0.3 - timeSec * 0.1;
    for (const r of this.#rings) r.update(timeSec);
  }

  dispose(): void {
    this.#points.geometry.dispose();
    this.#material.dispose();
    for (const r of this.#rings) r.dispose();
  }
}
