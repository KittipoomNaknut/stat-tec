// Puts MediaPipe WASM and pose models into public/ so the app runs fully offline.
// Models are downloaded once and verified by SHA-256; WASM is copied from node_modules.
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = join(appDir, 'public');
const wasmSrc = join(appDir, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');

const MODEL_BASE = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker';
const MODELS = {
  lite: '59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a',
  full: '5134a3aad27a58b93da0088d431f366da362b44e3ccfbe3462b3827a839011b1',
  heavy: '64437af838a65d18e5ba7a0d39b465540069bc8aae8308de3e318aad31fcbc7b',
};
const WASM_FILES = [
  'vision_wasm_module_internal.js',
  'vision_wasm_module_internal.wasm',
  'vision_wasm_module_nosimd_internal.js',
  'vision_wasm_module_nosimd_internal.wasm',
];

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

async function readIfExists(path) {
  try {
    return await readFile(path);
  } catch {
    return null;
  }
}

async function fetchModel(name, expected) {
  const dest = join(publicDir, 'models', `pose_landmarker_${name}.task`);
  const existing = await readIfExists(dest);
  if (existing && sha256(existing) === expected) return;

  const url = `${MODEL_BASE}/pose_landmarker_${name}/float16/1/pose_landmarker_${name}.task`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status}): ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const actual = sha256(buf);
  if (actual !== expected) throw new Error(`Checksum mismatch for ${name}: ${actual}`);
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, buf);
  console.log(`[assets] downloaded pose_landmarker_${name}.task`);
}

async function copyWasm() {
  const dest = join(publicDir, 'wasm');
  await mkdir(dest, { recursive: true });
  // Not every release ships a nosimd module build; copy what exists.
  for (const file of WASM_FILES) {
    try {
      await copyFile(join(wasmSrc, file), join(dest, file));
    } catch (error) {
      if (!file.includes('nosimd')) throw error;
    }
  }
}

await Promise.all([copyWasm(), ...Object.entries(MODELS).map(([n, h]) => fetchModel(n, h))]);
