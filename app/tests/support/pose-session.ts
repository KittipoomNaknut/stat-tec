import { readFile } from 'node:fs/promises';
import { decodeSession, type PoseClip, type PoseSession } from '../../src/debug/pose-recording';

const FIXTURES = new URL('../fixtures/poses/', import.meta.url);

/** Loads a recorded `*.pose.json.gz` session from tests/fixtures/poses. */
export async function loadSession(file: string): Promise<PoseSession> {
  const bytes = await readFile(new URL(file, FIXTURES));
  return decodeSession(new Blob([bytes]));
}

export function clipById(session: PoseSession, id: string): PoseClip {
  const clip = session.clips.find((c) => c.id === id);
  if (!clip) throw new Error(`Clip "${id}" not found in session`);
  return clip;
}

/** Yields each frame as a Float32Array ready for PoseTracker.process(). */
export function* clipFrames(clip: PoseClip) {
  for (const frame of clip.frames) {
    yield { t: frame.t, poseCount: frame.n, landmarks: Float32Array.from(frame.lm) };
  }
}
