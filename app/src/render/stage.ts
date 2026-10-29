import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  Mesh,
  PlaneGeometry,
  Points,
  ShaderMaterial,
  SphereGeometry,
} from 'three';
import { palette } from '../config/palette';

/** Star layers: count, spread (world units), depth range, size. Far layers drift slower. */
const STAR_LAYERS = [
  { count: 2600, spread: 70, z: [-60, -35], size: 2.2, drift: 0.004 },
  { count: 1200, spread: 45, z: [-35, -15], size: 2.8, drift: 0.009 },
  { count: 260, spread: 30, z: [-15, -4], size: 3.2, drift: 0.018 },
] as const;
const PLANET_RADIUS = 40;

/**
 * Deep space every scene plays in front of (STAT WARS, research 016): three star layers with
 * parallax drift and twinkle, a slowly churning pink–violet nebula, and a planet whose glowing
 * horizon rises for the attract screen and sinks out of the way during play. All motion runs
 * in shaders from shared uniforms: no allocation and no buffer upload per frame.
 */
export class Stage {
  readonly root = new Group();
  readonly #uniforms = {
    uTime: { value: 0 },
    /** 0..1 — scenes dim the stage when they need the attention. */
    uIntensity: { value: 1 },
    /** Drawing-buffer height / 1080, so point sizes look the same at any render scale. */
    uResolution: { value: 1 },
    uPink: { value: new Color(palette.pink) },
    uPeach: { value: new Color(palette.peach) },
    uViolet: { value: new Color(palette.violet) },
  };
  readonly #layers: Points[] = [];
  readonly #planet = new Group();
  /** Planet rise 0..1 and where it is heading. */
  #rise = 0;
  #riseTarget = 0;
  readonly #disposables: { dispose: () => void }[] = [];

  constructor(random: () => number = Math.random) {
    this.root.name = 'stage';
    this.root.add(this.#nebula());
    for (const layer of STAR_LAYERS) {
      const points = this.#stars(layer, random);
      this.#layers.push(points);
      this.root.add(points);
    }
    this.#buildPlanet();
    this.root.add(this.#planet);
    this.#placePlanet();
  }

  set intensity(value: number) {
    this.#uniforms.uIntensity.value = value;
  }

  /** Raise the planet's horizon into view (attract) or lower it (play). Animated. */
  set planet(visible: boolean) {
    this.#riseTarget = visible ? 1 : 0;
  }

  /** Height of the drawing buffer in device pixels. */
  setResolution(height: number): void {
    this.#uniforms.uResolution.value = height / 1080;
  }

  update(timeSec: number, dtSec = 1 / 60): void {
    this.#uniforms.uTime.value = timeSec;
    this.#layers.forEach((layer, i) => {
      const drift = STAR_LAYERS[i]?.drift ?? 0;
      layer.rotation.z = timeSec * drift * 0.4;
      layer.position.x = Math.sin(timeSec * 0.05) * drift * 40;
    });
    // Ease the planet toward its target (about 2 s).
    const k = 1 - Math.exp(-dtSec * 1.6);
    this.#rise += (this.#riseTarget - this.#rise) * k;
    this.#placePlanet();
    this.#planet.rotation.y = timeSec * 0.01;
  }

  dispose(): void {
    for (const d of this.#disposables) d.dispose();
  }

  #track<T extends { dispose: () => void }>(resource: T): T {
    this.#disposables.push(resource);
    return resource;
  }

  #placePlanet(): void {
    const ease = this.#rise * this.#rise * (3 - 2 * this.#rise);
    // Horizon at the bottom fifth of the screen when risen, below the frame when lowered.
    this.#planet.position.set(0, -PLANET_RADIUS - 3.1 - (1 - ease) * 3.2, -16);
    this.#planet.visible = this.#rise > 0.01 || this.#riseTarget > 0;
  }

  #nebula(): Mesh {
    const geometry = this.#track(new PlaneGeometry(220, 120));
    const material = this.#track(
      new ShaderMaterial({
        uniforms: this.#uniforms,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          precision highp float;
          uniform float uTime;
          uniform float uIntensity;
          uniform vec3 uPink;
          uniform vec3 uPeach;
          uniform vec3 uViolet;
          varying vec2 vUv;

          // Soft clouds: a few wide gaussian glows drifting slowly. (A value-noise nebula showed
          // hard-edged blotches once bloom picked it up — research 016.)
          float blob(vec2 uv, vec2 c, vec2 r) {
            vec2 d = (uv - c) / r;
            return exp(-dot(d, d));
          }

          void main() {
            float t = uTime * 0.03;
            vec2 uv = vUv;
            float pink = blob(uv, vec2(0.80 + 0.03 * sin(t), 0.88), vec2(0.30, 0.26))
                       + 0.6 * blob(uv, vec2(0.62, 0.95 + 0.02 * cos(t * 1.3)), vec2(0.22, 0.12));
            float peach = blob(uv, vec2(0.93, 0.70 + 0.03 * sin(t * 0.7)), vec2(0.14, 0.18));
            float violet = blob(uv, vec2(0.16 + 0.03 * cos(t * 0.8), 0.18), vec2(0.30, 0.22))
                         + 0.5 * blob(uv, vec2(0.42, 0.50), vec2(0.25, 0.10));
            vec3 c = uPink * pink * 0.16 + uPeach * peach * 0.08 + uViolet * violet * 0.13;
            gl_FragColor = vec4(c * uIntensity, 1.0);
          }`,
      }),
    );
    const mesh = new Mesh(geometry, material);
    mesh.position.set(0, 4, -70);
    mesh.renderOrder = -10;
    return mesh;
  }

  #stars(layer: (typeof STAR_LAYERS)[number], random: () => number): Points {
    const positions = new Float32Array(layer.count * 3);
    const seeds = new Float32Array(layer.count);
    for (let i = 0; i < layer.count; i++) {
      positions[i * 3] = (random() * 2 - 1) * layer.spread;
      positions[i * 3 + 1] = (random() * 2 - 1) * layer.spread * 0.55 + 3;
      positions[i * 3 + 2] = layer.z[0] + random() * (layer.z[1] - layer.z[0]);
      seeds[i] = random();
    }
    const geometry = this.#track(new BufferGeometry());
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setAttribute('aSeed', new BufferAttribute(seeds, 1));
    const material = this.#track(
      new ShaderMaterial({
        uniforms: { ...this.#uniforms, uSize: { value: layer.size } },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        vertexShader: /* glsl */ `
          uniform float uTime;
          uniform float uResolution;
          uniform float uSize;
          attribute float aSeed;
          varying float vAlpha;
          varying float vWarm;
          void main() {
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_Position = projectionMatrix * mv;
            // Most stars are faint; a few are bright. Each twinkles at its own pace.
            float bright = pow(aSeed, 6.0);
            float twinkle = 0.7 + 0.3 * sin(uTime * (0.8 + aSeed * 2.0) + aSeed * 60.0);
            vAlpha = (0.45 + bright * 0.55) * twinkle;
            vWarm = step(0.7, fract(aSeed * 13.0));
            gl_PointSize = uSize * (0.6 + bright * 2.4) * uResolution;
          }`,
        fragmentShader: /* glsl */ `
          uniform float uIntensity;
          uniform vec3 uPink;
          varying float vAlpha;
          varying float vWarm;
          void main() {
            float d = length(gl_PointCoord - 0.5);
            float a = smoothstep(0.5, 0.0, d) * vAlpha * uIntensity;
            vec3 c = mix(vec3(1.0), mix(vec3(1.0), uPink, 0.35), vWarm);
            gl_FragColor = vec4(c * a, a);
          }`,
      }),
    );
    const points = new Points(geometry, material);
    points.frustumCulled = false;
    points.renderOrder = -9;
    return points;
  }

  #buildPlanet(): void {
    const sphere = this.#track(new SphereGeometry(PLANET_RADIUS, 96, 48));
    const body = this.#track(
      new ShaderMaterial({
        uniforms: this.#uniforms,
        vertexShader: /* glsl */ `
          varying vec3 vNormal;
          varying vec3 vView;
          void main() {
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vNormal = normalize(normalMatrix * normal);
            vView = normalize(-mv.xyz);
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uPink;
          uniform vec3 uPeach;
          uniform float uIntensity;
          varying vec3 vNormal;
          varying vec3 vView;
          void main() {
            // Seen from above at a grazing angle: only the very limb catches the light.
            float rim = pow(1.0 - max(dot(vNormal, vView), 0.0), 14.0);
            vec3 night = vec3(0.028, 0.014, 0.036);
            vec3 c = night + mix(uPink, uPeach, rim) * rim * 1.2;
            gl_FragColor = vec4(c * uIntensity, 1.0);
          }`,
      }),
    );
    // Atmosphere: a slightly larger back-facing shell that glows at the limb.
    const shell = this.#track(new SphereGeometry(PLANET_RADIUS * 1.035, 96, 48));
    const atmosphere = this.#track(
      new ShaderMaterial({
        uniforms: this.#uniforms,
        side: BackSide,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        vertexShader: /* glsl */ `
          varying vec3 vNormal;
          varying vec3 vView;
          void main() {
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vNormal = normalize(normalMatrix * normal);
            vView = normalize(-mv.xyz);
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uPink;
          uniform float uIntensity;
          varying vec3 vNormal;
          varying vec3 vView;
          void main() {
            float glow = pow(max(dot(vNormal, vView), 0.0), 5.0);
            gl_FragColor = vec4(uPink * glow * 1.4 * uIntensity, glow);
          }`,
      }),
    );
    const planet = new Mesh(sphere, body);
    planet.renderOrder = -5;
    const air = new Mesh(shell, atmosphere);
    air.renderOrder = -4;
    this.#planet.add(planet, air);
  }
}
