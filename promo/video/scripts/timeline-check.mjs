#!/usr/bin/env node
/**
 * timeline-check.mjs — prove the 11 windows still sum to 6720 frames and that
 * every narration budget fits its window.
 *
 * Constraint per scene: `audioDuration + 0.8 s <= windowSeconds`.
 *
 * The duration is the ffprobe measurement written by `npm run tts:all`. When
 * no measurement exists, the static budget of 5.0 Chinese characters/second
 * (the production script's measured edge-tts rate) is used and flagged as
 * `estimated`. A measurement whose text no longer matches `film.ts` is stale
 * and fails loudly: re-run `npm run tts:all` rather than trusting old audio.
 *
 * Overflow is reported in seconds and in Chinese characters to delete, using
 * that scene's measured chars/second rate. Audio is never sped up and scene
 * windows are never moved — shortening the copy is the only accepted fix.
 *
 * Usage: node --import tsx scripts/timeline-check.mjs [--json]
 * Exit: 0 fits, 1 overflow, stale audio or invalid timeline.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '..');
const argv = process.argv.slice(2);
const asJson = argv.includes('--json');

const film = await import(
  pathToFileURL(path.join(PROJECT_ROOT, 'src', 'content', 'film.ts')).href
);
const voice = await import(
  pathToFileURL(path.join(PROJECT_ROOT, 'src', 'content', 'voice.ts')).href
);

const { SCENES, SCENE_WINDOWS, TOTAL_FRAMES, TOTAL_SECONDS, FPS } = film;
const CHARS_PER_SECOND = 5;
const TAIL_SECONDS = 0.8;

const nonWhitespaceLength = (value) =>
  Array.from(value).filter((character) => !/\s/.test(character)).length;

const normalize = (value) => value.replace(/\s+/g, '').trim();

const narrationPath = path.join(
  PROJECT_ROOT,
  'out',
  'audio',
  voice.ACTIVE_VOICE,
  'narration.json',
);

const readMeasured = (file) => {
  const map = new Map();
  if (!file || !fs.existsSync(file)) return map;
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    return map;
  }
  const rows = Array.isArray(raw) ? raw : raw.scenes;
  if (!Array.isArray(rows)) return map;
  for (const row of rows) {
    const id = String(row.scene ?? row.id ?? row.sceneId ?? '').toUpperCase();
    const duration = Number(
      row.duration ?? row.durationSeconds ?? row.narrationSeconds ?? NaN,
    );
    if (id && Number.isFinite(duration) && duration > 0) {
      map.set(id, { duration, text: typeof row.text === 'string' ? row.text : null });
    }
  }
  return map;
};

const errors = [];
const warnings = [];
const rows = [];

if (SCENES.length !== 11) {
  errors.push(`expected 11 scenes, got ${SCENES.length}`);
}
if (TOTAL_FRAMES !== 6720) {
  errors.push(`expected 6720 frames, got ${TOTAL_FRAMES}`);
}

let expectedFrom = 0;
for (const [index, window] of SCENE_WINDOWS.entries()) {
  const scene = SCENES[index];
  if (window.from !== expectedFrom) {
    errors.push(
      `${scene.id}: from ${window.from}, expected ${expectedFrom} (not contiguous)`,
    );
  }
  expectedFrom += window.durationInFrames;

  if (scene.minSeconds * FPS !== window.durationInFrames) {
    errors.push(
      `${scene.id}: minSeconds ${scene.minSeconds} != ${window.durationInFrames} frames`,
    );
  }
}

const measuredFile = fs.existsSync(narrationPath) ? narrationPath : null;
const measured = readMeasured(measuredFile);

let totalSpeechSeconds = 0;
let totalCharacters = 0;

for (const [index, window] of SCENE_WINDOWS.entries()) {
  const scene = SCENES[index];
  const windowSeconds = window.durationInFrames / FPS;
  const characters = nonWhitespaceLength(scene.narration);
  const entry = measured.get(scene.id);

  let used;
  let source;
  let charsPerSecond;

  if (entry) {
    if (entry.text !== null && normalize(entry.text) !== normalize(scene.narration)) {
      // The clip is from an older wording: its duration is not a measurement of
      // the current sentence. Refuse to guess silently.
      errors.push(
        `${scene.id}: narration.json is stale for ${voice.ACTIVE_VOICE} ` +
          `(film.ts changed after TTS); run npm run tts:all`,
      );
      used = characters / CHARS_PER_SECOND;
      source = 'estimated (stale clip)';
      charsPerSecond = CHARS_PER_SECOND;
    } else {
      used = entry.duration;
      source = 'measured';
      charsPerSecond = characters / entry.duration;
    }
  } else {
    used = characters / CHARS_PER_SECOND;
    source = 'estimated';
    charsPerSecond = CHARS_PER_SECOND;
    if (measuredFile) {
      warnings.push(`${scene.id}: no measured clip in narration.json, using 5 chars/s`);
    }
  }

  totalSpeechSeconds += used;
  totalCharacters += characters;

  const required = used + TAIL_SECONDS;
  const fits = required <= windowSeconds + 1e-9;
  if (!fits) {
    const excess = required - windowSeconds;
    const cutCharacters = Math.max(1, Math.ceil(excess * charsPerSecond));
    errors.push(
      `${scene.id}: overflow ${excess.toFixed(2)}s — needs ${required.toFixed(
        2,
      )}s (${used.toFixed(2)}s audio + ${TAIL_SECONDS}s tail) in a ${windowSeconds.toFixed(
        1,
      )}s window; delete about ${cutCharacters} Chinese character(s) ` +
        `at ${charsPerSecond.toFixed(2)} chars/s`,
    );
  }

  rows.push({
    id: scene.id,
    characters,
    windowSeconds,
    narrationSeconds: Number(used.toFixed(2)),
    source,
    charsPerSecond: Number(charsPerSecond.toFixed(2)),
    requiredSeconds: Number(required.toFixed(2)),
    overflowSeconds: fits ? 0 : Number((required - windowSeconds).toFixed(2)),
    fits,
  });
}

const result = {
  pass: errors.length === 0,
  fps: FPS,
  totalFrames: TOTAL_FRAMES,
  totalSeconds: TOTAL_SECONDS,
  voice: voice.ACTIVE_VOICE,
  voiceId: voice.VOICE.voice,
  measuredFile,
  totals: {
    speechSeconds: Number(totalSpeechSeconds.toFixed(2)),
    characters: totalCharacters,
    avgCharsPerSecond: Number(
      (totalCharacters / (totalSpeechSeconds || 1)).toFixed(2),
    ),
  },
  rows,
  warnings,
  errors,
};

if (asJson) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} else {
  process.stdout.write('timeline-check\n');
  process.stdout.write(
    `  voice: ${voice.ACTIVE_VOICE} (${voice.VOICE.voice})  ` +
      `total: ${TOTAL_FRAMES} frames / ${TOTAL_SECONDS}s @ ${FPS}fps\n`,
  );
  for (const row of rows) {
    const margin = row.windowSeconds - row.requiredSeconds;
    process.stdout.write(
      `  ${row.fits ? 'PASS' : 'FAIL'} ${row.id}: ${row.characters} chars / ` +
        `${row.narrationSeconds}s ${row.source} in ${row.windowSeconds}s window ` +
        `(margin ${margin.toFixed(2)}s)\n`,
    );
  }
  process.stdout.write(
    `  speech: ${result.totals.speechSeconds}s total, ` +
      `${result.totals.avgCharsPerSecond} chars/s average\n`,
  );
  for (const warning of warnings) process.stderr.write(`  WARN ${warning}\n`);
  for (const error of errors) process.stderr.write(`  ${error}\n`);
  process.stdout.write(result.pass ? 'PASS\n' : 'FAIL\n');
}

process.exit(result.pass ? 0 : 1);
