import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  Mesh,
  PlaneGeometry,
  Points,
  ShaderMaterial,
} from 'three';

const PRIMARY = new Color('#3fe0ff');
const DUST_COUNT = 2200;
/** Dust lives in this box (world units) and wraps vertically as it drifts up. */
const DUST_BOX = { x: 16, yMin: -2, yMax: 9, zMin: -22, zMax: 4 };

/**
 * The holographic environment every scene plays in front of: a perspective grid floor that
 * slowly scrolls toward the viewer, drifting dust and a horizon glow. All motion runs in the
 * shaders from one time uniform, so a frame costs no allocation and no buffer upload.
 */
export class Stage {
  readonly root = new Group();
  readonly #uniforms = {
    uTime: { value: 0 },
    uColor: { value: PRIMARY },
    /** 0..1 — scenes dim the stage when they need the attention. */
    uIntensity: { value: 1 },
    /** Drawing-buffer height / 1080, so point sizes look the same at any render scale. */
    uResolution: { value: 1 },
  };
  readonly #disposables: { dispose: () => void }[] = [];

  constructor(random: () => number = Math.random) {
    this.root.name = 'stage';
    this.root.add(this.#floor(), this.#horizon(), this.#backlight(), this.#dust(random));
  }

  set intensity(value: number) {
    this.#uniforms.uIntensity.value = value;
  }

  /** Height of the drawing buffer in device pixels. */
  setResolution(height: number): void {
    this.#uniforms.uResolution.value = height / 1080;
  }

  update(timeSec: number): void {
    this.#uniforms.uTime.value = timeSec;
  }

  dispose(): void {
    for (const d of this.#disposables) d.dispose();
  }

  #track<T extends { dispose: () => void }>(resource: T): T {
    this.#disposables.push(resource);
    return resource;
  }

  #floor(): Mesh {
    const geometry = this.#track(new PlaneGeometry(120, 120));
    geometry.rotateX(-Math.PI / 2);
    const material = this.#track(
      new ShaderMaterial({
        uniforms: this.#uniforms,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        vertexShader: /* glsl */ `
          varying vec3 vWorld;
          void main() {
            vec4 world = modelMatrix * vec4(position, 1.0);
            vWorld = world.xyz;
            gl_Position = projectionMatrix * viewMatrix * world;
          }`,
        fragmentShader: /* glsl */ `
          uniform float uTime;
          uniform vec3 uColor;
          uniform float uIntensity;
          varying vec3 vWorld;

          // Anti-aliased grid line intensity for cells of the given size.
          float grid(vec2 p, float size, float width) {
            vec2 g = abs(fract(p / size - 0.5) - 0.5) / fwidth(p / size);
            return 1.0 - min(min(g.x, g.y) / width, 1.0);
          }

          void main() {
            vec2 p = vWorld.xz + vec2(0.0, uTime * 0.35);
            float minor = grid(p, 1.0, 1.0) * 0.45;
            float major = grid(p, 5.0, 1.4) * 1.6;
            float dist = length(vWorld.xz - vec2(0.0, 4.0));
            float fade = exp(-dist * 0.06) * smoothstep(60.0, 18.0, dist);
            // A scan pulse that sweeps toward the viewer every 7 s.
            float wave = vWorld.z - (mod(uTime, 7.0) * 9.0 - 45.0);
            float scan = exp(-wave * wave * 0.08) * 1.4;
            float lines = max(minor, major);
            float a = (lines * (1.0 + scan) + scan * 0.05) * fade * uIntensity;
            gl_FragColor = vec4(uColor * a, min(a, 1.0));
          }`,
      }),
    );
    const mesh = new Mesh(geometry, material);
    mesh.position.y = -1.6;
    mesh.renderOrder = -2;
    return mesh;
  }

  #horizon(): Mesh {
    const geometry = this.#track(new PlaneGeometry(90, 26));
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
          uniform vec3 uColor;
          uniform float uIntensity;
          varying vec2 vUv;
          void main() {
            // A thin bright band where the floor meets the sky, falling off upward.
            float band = exp(-abs(vUv.y - 0.22) * 9.0);
            float spread = smoothstep(0.5, 0.0, abs(vUv.x - 0.5));
            float a = band * spread * 0.45 * uIntensity;
            gl_FragColor = vec4(uColor * a, a);
          }`,
      }),
    );
    const mesh = new Mesh(geometry, material);
    mesh.position.set(0, 2.2, -40);
    mesh.renderOrder = -3;
    return mesh;
  }

  /** Soft glow behind the center of the screen, where scenes put their main object. */
  #backlight(): Mesh {
    const geometry = this.#track(new PlaneGeometry(40, 40));
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
          uniform vec3 uColor;
          uniform float uTime;
          uniform float uIntensity;
          varying vec2 vUv;
          void main() {
            float d = length(vUv - 0.5) * 2.0;
            float breathe = 0.85 + 0.15 * sin(uTime * 0.4);
            float a = exp(-d * d * 5.0) * 0.12 * breathe * uIntensity;
            gl_FragColor = vec4(uColor * a, a);
          }`,
      }),
    );
    const mesh = new Mesh(geometry, material);
    mesh.position.set(0, 2.5, -14);
    mesh.renderOrder = -3;
    return mesh;
  }

  #dust(random: () => number): Points {
    const positions = new Float32Array(DUST_COUNT * 3);
    const seeds = new Float32Array(DUST_COUNT);
    for (let i = 0; i < DUST_COUNT; i++) {
      positions[i * 3] = (random() * 2 - 1) * DUST_BOX.x;
      positions[i * 3 + 1] = DUST_BOX.yMin + random() * (DUST_BOX.yMax - DUST_BOX.yMin);
      positions[i * 3 + 2] = DUST_BOX.zMin + random() * (DUST_BOX.zMax - DUST_BOX.zMin);
      seeds[i] = random();
    }
    const geometry = this.#track(new BufferGeometry());
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setAttribute('aSeed', new BufferAttribute(seeds, 1));
    const material = this.#track(
      new ShaderMaterial({
        uniforms: {
          ...this.#uniforms,
          uRange: { value: [DUST_BOX.yMin, DUST_BOX.yMax] },
        },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        vertexShader: /* glsl */ `
          uniform float uTime;
          uniform vec2 uRange;
          uniform float uResolution;
          attribute float aSeed;
          varying float vAlpha;
          void main() {
            vec3 p = position;
            float span = uRange.y - uRange.x;
            p.y = uRange.x + mod(p.y - uRange.x + uTime * (0.05 + aSeed * 0.12), span);
            p.x += sin(uTime * 0.2 + aSeed * 40.0) * 0.3;
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            gl_Position = projectionMatrix * mv;
            float twinkle = 0.55 + 0.45 * sin(uTime * (0.6 + aSeed) + aSeed * 90.0);
            // Fade in/out at the wrap edges so particles never pop.
            float edge = smoothstep(0.0, 1.0, p.y - uRange.x) * smoothstep(0.0, 1.5, uRange.y - p.y);
            vAlpha = twinkle * edge;
            gl_PointSize = (2.0 + aSeed * 3.0) * (16.0 / -mv.z) * uResolution;
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor;
          uniform float uIntensity;
          varying float vAlpha;
          void main() {
            float d = length(gl_PointCoord - 0.5);
            float a = smoothstep(0.5, 0.0, d) * vAlpha * 0.9 * uIntensity;
            gl_FragColor = vec4(uColor * a, a);
          }`,
      }),
    );
    const points = new Points(geometry, material);
    points.frustumCulled = false;
    points.renderOrder = -1;
    return points;
  }
}
