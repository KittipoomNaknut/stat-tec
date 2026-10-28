import { describe, expect, it } from 'vitest';
import {
  decodeSession,
  encodeSession,
  POSE_SESSION_VERSION,
  toClipFrame,
  type PoseSession,
} from '../../src/debug/pose-recording';
import { syntheticPoses } from './pose-fixtures';

describe('pose recording format', () => {
  it('rounds landmarks and keeps only the detected poses', () => {
    const landmarks = new Float32Array(33 * 4 * 3).fill(0.123456);
    const frame = toClipFrame(12.345, 2, landmarks);
    expect(frame).toMatchObject({ t: 12.3, n: 2 });
    expect(frame.lm).toHaveLength(2 * 33 * 4);
    expect(frame.lm[0]).toBe(0.1235);
  });

  it('round-trips a session through gzip', async () => {
    const { data } = syntheticPoses([{ cx: 0.5, cy: 0.5, sw: 0.14 }]);
    const session: PoseSession = {
      version: POSE_SESSION_VERSION,
      recordedAt: '2026-10-28T00:00:00.000Z',
      camera: { label: 'test', width: 1280, height: 720, frameRate: 30 },
      model: 'heavy/GPU',
      clips: [{ id: 'idle-stand', instruction: '-', frames: [toClipFrame(0, 1, data)] }],
    };
    const decoded = await decodeSession(await encodeSession(session));
    expect(decoded).toEqual(session);
  });

  it('rejects an unknown version', async () => {
    const bad = new Blob([JSON.stringify({ version: 99 })])
      .stream()
      .pipeThrough(new CompressionStream('gzip'));
    await expect(decodeSession(await new Response(bad).blob())).rejects.toThrow('version 99');
  });
});
