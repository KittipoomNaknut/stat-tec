import {
  AdditiveBlending,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  type BufferGeometry,
  type ColorRepresentation,
  type ShaderMaterial,
} from 'three';
import { hologramMaterial } from '../render/hologram';

/** A geometry drawn as a glowing hologram: fresnel surface + crisp edge lines. */
export class HologramObject {
  readonly root = new Group();
  readonly #surface: ShaderMaterial;
  readonly #edges: LineBasicMaterial;
  readonly #geometries: BufferGeometry[] = [];
  #opacity = 1;

  constructor(geometry: BufferGeometry, color: ColorRepresentation, edgeAngle = 20) {
    this.#surface = hologramMaterial(color);
    this.#edges = new LineBasicMaterial({
      color,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    const edges = new EdgesGeometry(geometry, edgeAngle);
    this.#geometries.push(geometry, edges);
    this.root.add(new Mesh(geometry, this.#surface), new LineSegments(edges, this.#edges));
  }

  set opacity(value: number) {
    this.#opacity = value;
    uniform(this.#surface, 'uOpacity').value = value;
    this.#edges.opacity = value * 0.55;
    this.root.visible = value > 0.001;
  }

  get opacity(): number {
    return this.#opacity;
  }

  update(timeSec: number): void {
    uniform(this.#surface, 'uTime').value = timeSec;
  }

  dispose(): void {
    for (const g of this.#geometries) g.dispose();
    this.#surface.dispose();
    this.#edges.dispose();
  }
}

function uniform(material: ShaderMaterial, name: string): { value: number } {
  const u = material.uniforms[name] as { value: number } | undefined;
  if (!u) throw new Error(`uniform ${name} missing`);
  return u;
}
