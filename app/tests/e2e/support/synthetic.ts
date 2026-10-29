/** The synthetic body the app exposes with `?player=synthetic` (src/debug/synthetic-player.ts). */
export interface Synthetic {
  enter(): void;
  lose(): void;
  return(): void;
  leave(): void;
  pointAt(x: number, y: number, ms?: number): void;
  rest(): void;
}

declare global {
  interface Window {
    statTecSynthetic: Synthetic;
  }
}
