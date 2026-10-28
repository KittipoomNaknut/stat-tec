export type FrameCallback = (dtMs: number, nowMs: number) => void;

/** Runs `onFrame` every animation frame; returns a function that stops the loop. */
export function startLoop(onFrame: FrameCallback): () => void {
  let handle = 0;
  let last = performance.now();
  const frame = (now: number) => {
    onFrame(now - last, now);
    last = now;
    handle = requestAnimationFrame(frame);
  };
  handle = requestAnimationFrame(frame);
  return () => {
    cancelAnimationFrame(handle);
  };
}
