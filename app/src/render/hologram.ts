import { AdditiveBlending, Color, ShaderMaterial, type ColorRepresentation } from 'three';

/**
 * Glowing "hologram" surface: bright fresnel rim, faint fill and horizontal scan bands.
 * `opacity` is driven by scene transitions; additive blending lets objects crossfade with no
 * render targets (the stage and both scenes simply add up while one fades out).
 */
export function hologramMaterial(color: ColorRepresentation): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uColor: { value: new Color(color) },
      uOpacity: { value: 1 },
      uTime: { value: 0 },
    },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    vertexShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vView;
      varying float vY;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vView = normalize(-mv.xyz);
        vY = (modelMatrix * vec4(position, 1.0)).y;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uTime;
      varying vec3 vNormal;
      varying vec3 vView;
      varying float vY;
      void main() {
        float rim = pow(1.0 - abs(dot(normalize(vNormal), vView)), 2.2);
        float scan = 0.65 + 0.35 * smoothstep(0.3, 1.0, sin(vY * 22.0 - uTime * 2.4));
        float a = (0.06 + rim * 1.3) * scan * uOpacity;
        gl_FragColor = vec4(uColor * a, a);
      }`,
  });
}

/** Plain additive line material settings shared by wireframe overlays. */
export function lineUniforms(color: ColorRepresentation) {
  return { uColor: { value: new Color(color) }, uOpacity: { value: 1 } };
}
