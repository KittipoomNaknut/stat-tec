import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  binaryKind,
  decodeDetections,
  parseText,
  previewJpeg,
} from '../../src/perception/server-protocol';

/** Written by perception-server's encoder; its own test checks it byte for byte. */
async function fixture(): Promise<ArrayBuffer> {
  const bytes = await readFile(new URL('../fixtures/server/std1-two-people.bin', import.meta.url));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

describe('perception service protocol', () => {
  it('decodes the shared fixture produced by the Python encoder', async () => {
    const d = decodeDetections(await fixture());
    expect(d).toMatchObject({
      frameId: 42,
      capturedAt: 1761650000123.5,
      inferenceMs: 7.25,
      width: 1280,
      height: 720,
      people: 2,
    });
    expect(d.landmarks).toHaveLength(2 * 33 * 4);
    expect(d.landmarks[0]).toBe(0);
    expect(d.landmarks[263]).toBe(131.5);
  });

  it('rejects truncated and foreign messages', async () => {
    const buf = await fixture();
    expect(() => decodeDetections(buf.slice(0, 100))).toThrow('length');
    expect(() => decodeDetections(new TextEncoder().encode('STJ1....').buffer)).toThrow();
  });

  it('recognizes previews and text messages', () => {
    const preview = new Uint8Array([...new TextEncoder().encode('STJ1'), 0xff, 0xd8]).buffer;
    expect(binaryKind(preview)).toBe('STJ1');
    expect(new Uint8Array(previewJpeg(preview))).toEqual(new Uint8Array([0xff, 0xd8]));
    expect(parseText('{"type":"status","fps":30,"inferenceMs":7}')).toMatchObject({ fps: 30 });
    expect(parseText('{"type":"other"}')).toBeNull();
    expect(parseText('not json')).toBeNull();
  });
});
