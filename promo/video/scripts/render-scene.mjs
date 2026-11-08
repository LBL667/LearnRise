#!/usr/bin/env node
/**
 * render-scene.mjs — rebuild exactly one scene composition.
 *
 * Usage:
 *   npm run render:scene -- S05
 *   node --import tsx scripts/render-scene.mjs S05
 *
 * Output: out/scenes/s05.mp4 (master `Film` is never touched).
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '..');
const VENDOR_RENDER = path.join(PROJECT_ROOT, 'scripts', 'vendor', 'render.mjs');
const SKILL_ROOT = path.resolve(
  PROJECT_ROOT,
  '../../skill/remotion-video',
);
const RENDER_SCRIPT = fs.existsSync(VENDOR_RENDER)
  ? VENDOR_RENDER
  : path.join(SKILL_ROOT, 'scripts', 'render.mjs');

const film = await import(
  pathToFileURL(path.join(PROJECT_ROOT, 'src', 'content', 'film.ts')).href
);
const ids = film.SCENES.map((scene) => scene.id);

const raw = process.argv.slice(2).find((argument) => !argument.startsWith('-'));
if (!raw) {
  process.stderr.write(
    `render:scene needs a scene id.\nValid ids: ${ids.join(', ')}\n`,
  );
  process.exit(1);
}

const match = /^s(\d{1,2})$/i.exec(raw);
const id = match
  ? `S${match[1].padStart(2, '0')}`
  : raw.toUpperCase();

if (!ids.includes(id)) {
  process.stderr.write(
    `render:scene unknown scene "${raw}".\nValid ids: ${ids.join(', ')}\n`,
  );
  process.exit(1);
}

if (!fs.existsSync(RENDER_SCRIPT)) {
  process.stderr.write(`render:scene missing skill renderer ${RENDER_SCRIPT}\n`);
  process.exit(1);
}

const output = path.join('out', 'scenes', `${id.toLowerCase()}.mp4`);
fs.mkdirSync(path.join(PROJECT_ROOT, 'out', 'scenes'), { recursive: true });

const result = spawnSync(
  process.execPath,
  [
    RENDER_SCRIPT,
    '--project=.',
    `--composition=${id}`,
    `--output=${output}`,
    '--concurrency=2',
  ],
  { cwd: PROJECT_ROOT, stdio: 'inherit' },
);

if (result.error) {
  process.stderr.write(`render:scene failed: ${result.error.message}\n`);
  process.exit(1);
}
process.exit(result.status ?? 1);
