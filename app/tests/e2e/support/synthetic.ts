/** The synthetic body the app exposes with `?player=synthetic` (src/debug/synthetic-player.ts). */
export interface Synthetic {
  enter(): void;
  lose(): void;
  return(): void;
  leave(): void;
  pointAt(x: number, y: number, ms?: number): void;
  rest(): void;
  /** Strike and hold a pose (research 025). */
  pose(name: 'both-up' | 'left-up' | 'right-up' | 'cross' | 't-pose'): void;
  /** Hold both wrists in body space (null = that hand down): steering the 3D chart. */
  hands(right: [number, number] | null, left: [number, number] | null): void;
}

declare global {
  interface Window {
    statTecSynthetic: Synthetic;
    /** Booth-log events so far (src/core/booth-log.ts), names and fields only. */
    statTecBooth: () => readonly { name: string; level: string; fields: Record<string, unknown> }[];
    /** A staff-screen command, as if it came through the pose service (research 035). */
    statTecCommand: (name: 'start' | 'skip' | 'next' | 'pause' | 'reset') => void;
  }
}
