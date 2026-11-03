#!/usr/bin/env node
/**
 * render-scene.mjs — rebuild exactly one scene composition.
 *
 * Usage:
 *   npm run render:scene -- S05
 *   node --import tsx scripts/render-scene.mjs S05
 *
 * Output: out/scenes/s05.mp4 (master `Film` is never touched).
 * Renders via the local Remotion CLI (remotion.config.ts supplies
 * pixel-format / color-space / concurrency / browser settings).
 */

import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '..');

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

const output = path.join('out', 'scenes', `${id.toLowerCase()}.mp4`);

const result = spawnSync(
  'npx',
  [
    '--no-install',
    'remotion',
    'render',
    id,
    output,
    '--gl=angle',
    '--concurrency=2',
  ],
  { cwd: PROJECT_ROOT, stdio: 'inherit' },
);

if (result.error) {
  process.stderr.write(
    `render:scene failed: ${result.error.message}\n` +
      'hint: run "npm ci" in promo/video first so the local remotion CLI exists\n',
  );
  process.exit(1);
}
process.exit(result.status ?? 1);
