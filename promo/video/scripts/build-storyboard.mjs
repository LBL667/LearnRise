#!/usr/bin/env node
/**
 * build-storyboard.mjs — derive `storyboard.json` from `src/content/film.ts`.
 *
 * The JSON is a generated contract, not a second authoring surface: narration
 * and screen copy stay in film.ts. Re-run this after any film.ts edit so the
 * validator, the renderer and the content model cannot drift.
 *
 * Usage: node --import tsx scripts/build-storyboard.mjs [--out=storyboard.json]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '..');

const argv = process.argv.slice(2);
const outputFlag = argv.find((argument) => argument.startsWith('--out='));
const outputPath = path.resolve(
  PROJECT_ROOT,
  outputFlag ? outputFlag.slice('--out='.length) : 'storyboard.json',
);

const filmPath = path.join(PROJECT_ROOT, 'src', 'content', 'film.ts');

const film = await import(pathToFileURL(filmPath).href);
const { SCENES, SCENE_WINDOWS, TOTAL_FRAMES, FPS } = film;

if (SCENES.length !== 11) {
  process.stderr.write(
    `build-storyboard: expected 11 scenes, got ${SCENES.length}\n`,
  );
  process.exit(1);
}

const total = SCENE_WINDOWS.reduce(
  (sum, window) => sum + window.durationInFrames,
  0,
);
if (total !== TOTAL_FRAMES) {
  process.stderr.write(
    `build-storyboard: window sum ${total} != TOTAL_FRAMES ${TOTAL_FRAMES}\n`,
  );
  process.exit(1);
}

const sceneContent = (scene) => ({
  kicker: scene.kicker,
  screenText: scene.screenText,
  subline: scene.subline,
  footnote: scene.footnote,
  dataStrip: scene.dataStrip,
  narration: scene.narration,
  visual: scene.visual,
  minSeconds: scene.minSeconds,
  assetCount: scene.assets.length,
});

const storyboard = {
  meta: {
    slug: 'learnrise-promo-3min',
    width: 1920,
    height: 1080,
    fps: FPS,
    durationInFrames: TOTAL_FRAMES,
  },
  theme: 'dark',
  audio: {
    src: 'audio/bed.wav',
    gain: 0.74131,
    duckTo: 0.35,
  },
  scenes: SCENES.map((scene, index) => ({
    id: scene.id,
    primitive: 'custom',
    from: SCENE_WINDOWS[index].from,
    durationInFrames: SCENE_WINDOWS[index].durationInFrames,
    content: sceneContent(scene),
    assets: scene.assets.map((asset) => ({
      id: asset.id,
      src: asset.src,
      kind: asset.kind,
      nativeWidth: asset.nativeWidth,
      nativeHeight: asset.nativeHeight,
      note: asset.note,
    })),
  })),
  checks: {
    minsFontPx: 20,
    maxUpscale: 1.15,
    maxCharsPerSecond: 14,
  },
};

fs.writeFileSync(outputPath, `${JSON.stringify(storyboard, null, 2)}\n`, 'utf8');
process.stdout.write(
  `build-storyboard: ${path.basename(outputPath)} ` +
    `${storyboard.scenes.length} scenes / ${TOTAL_FRAMES} frames\n`,
);
