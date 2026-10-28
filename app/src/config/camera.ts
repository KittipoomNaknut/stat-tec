export const cameraConfig = {
  /** Requested capture size; cameras that cannot reach it fall back to their best mode. */
  idealWidth: 1920,
  idealHeight: 1080,
  idealFrameRate: 60,
  /** Delay between reconnect attempts after the camera disappears. */
  reconnectIntervalMs: 2000,
} as const;
