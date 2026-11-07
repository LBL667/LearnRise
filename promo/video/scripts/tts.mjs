#!/usr/bin/env node
/**
 * tts.mjs — narration synthesis, measurement, SRT and the 15-second audition pack.
 *
 * The voice comes from `src/content/voice.ts` only. `ACTIVE_VOICE` (or the
 * profile stored in that file) selects the timbre; scenes never mention a
 * voice, so A/B switching is one environment variable.
 *
 *   node --import tsx scripts/tts.mjs --all
 *   node --import tsx scripts/tts.mjs --scene=S05
 *   node --import tsx scripts/tts.mjs --samples-only
 *   node --import tsx scripts/tts.mjs --all --force     # ignore the clip cache
 *
 * Outputs, for `ACTIVE_VOICE`:
 *   out/audio/<profile>/sNN.mp3          one clip per scene
 *   out/audio/<profile>/narration.json   measured ffprobe durations + totals
 *   out/audio/<profile>/narration.srt    sentence-level subtitles
 *   out/learnrise-promo.srt              the same SRT for the active cut
 * and, independent of `ACTIVE_VOICE`:
 *   out/audio/samples/{yunyang,yunjian,xiaoxiao}.mp3   15.000 s each
 *   out/audio/samples/manifest.json
 *
 * Idempotency: a clip is reused when the SHA-256 of (voice params + text)
 * matches `narration.json` and the existing MP3 still probes as a positive
 * duration. Regeneration writes to a temp file and renames only after ffprobe
 * succeeds, so a failed TTS call can never truncate a good clip. There is no
 * fallback engine: any edge-tts failure exits non-zero.
 *
 * The fixed 6720-frame timeline is never modified here. `npm run
 * timeline:check` is the gate that reports overflow.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '..');

const TAIL_SECONDS = 0.8;
const MAX_SRT_CHARS_PER_SECOND = 14;
const SAMPLE_SECONDS = 15;
const SAMPLE_TEXT =
  '智学闭环 LearnRise，把建赛、资料、知识库、笔记、出题、复习、助手和排行榜，串成一条完整的学习流水线。八个环节，共用同一份数据。';

const voice = await import(
  pathToFileURL(path.join(PROJECT_ROOT, 'src', 'content', 'voice.ts')).href
);
const film = await import(
  pathToFileURL(path.join(PROJECT_ROOT, 'src', 'content', 'film.ts')).href
);

const argv = process.argv.slice(2);
const hasFlag = (name) => argv.includes(name);
const flagValue = (name) => {
  const prefix = `${name}=`;
  const hit = argv.find((argument) => argument.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
};

const force = hasFlag('--force');
const samplesOnly = hasFlag('--samples-only');

const normalizeSceneId = (raw) => {
  const value = raw.trim().toUpperCase();
  const match = value.match(/^S?(\d+)$/);
  return match ? `S${match[1].padStart(2, '0')}` : value;
};

const only = flagValue('--scene') ? normalizeSceneId(flagValue('--scene')) : null;
const scenes = only
  ? film.SCENES.filter((scene) => scene.id === only)
  : film.SCENES;

if (scenes.length === 0) {
  process.stderr.write(`tts: unknown scene ${only}\n`);
  process.exit(1);
}

const EDGE_TTS_CANDIDATES = [
  process.env.EDGE_TTS,
  // Persistent venv under ~/.local/share; /tmp was cleared on reboot.
  '/home/sky/.local/share/remotion-video/ttsvenv/bin/edge-tts',
  'edge-tts',
].filter(Boolean);

const findExecutable = (candidates) => {
  for (const candidate of candidates) {
    if (candidate.includes('/')) {
      if (fs.existsSync(candidate)) return candidate;
      continue;
    }
    const probe = spawnSync('sh', ['-c', `command -v '${candidate}'`], {
      encoding: 'utf8',
    });
    if (probe.status === 0 && probe.stdout.trim()) return probe.stdout.trim();
  }
  return null;
};

const edgeTts = findExecutable(EDGE_TTS_CANDIDATES);
if (!edgeTts) {
  process.stderr.write(
    'tts: edge-tts not found. Install 7.3.1 in ~/.local/share/remotion-video/ttsvenv or set EDGE_TTS.\n',
  );
  process.exit(2);
}
const ffmpeg = findExecutable([process.env.FFMPEG, 'ffmpeg'].filter(Boolean));
if (!ffmpeg) {
  process.stderr.write('tts: ffmpeg not found (needed for the audition pad).\n');
  process.exit(2);
}

const outRoot = path.join(PROJECT_ROOT, 'out');
const outDir = path.join(outRoot, 'audio', voice.ACTIVE_VOICE);
const samplesDir = path.join(outRoot, 'audio', 'samples');
const narrationPath = path.join(outDir, 'narration.json');
const profileSrtPath = path.join(outDir, 'narration.srt');
const rootSrtPath = path.join(outRoot, 'learnrise-promo.srt');

const rel = (file) => path.relative(PROJECT_ROOT, file).split(path.sep).join('/');

const run = (command, args, label) => {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.error) {
    throw new Error(`${label}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(
      `${label}: exited ${result.status}: ${(result.stderr || '').trim()}`,
    );
  }
  return result.stdout;
};

/** Real measurement — never an estimate. Throws on an empty/invalid file. */
const probeDuration = (file) => {
  if (!fs.existsSync(file)) throw new Error(`missing audio ${file}`);
  const size = fs.statSync(file).size;
  if (size <= 0) throw new Error(`empty audio ${file}`);
  const output = run(
    'ffprobe',
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'csv=p=0',
      file,
    ],
    `ffprobe ${path.basename(file)}`,
  );
  const duration = Number.parseFloat(output.trim());
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(`ffprobe returned no positive duration for ${file}`);
  }
  return duration;
};

const textHash = (profile, text) =>
  crypto
    .createHash('sha256')
    .update(
      [profile.voice, profile.rate, profile.pitch, profile.volume, text].join(
        '\u0000',
      ),
    )
    .digest('hex')
    .slice(0, 16);

const nonWhitespace = (value) =>
  Array.from(value).filter((character) => !/\s/.test(character)).length;

const normalize = (value) => value.replace(/\s+/g, '').trim();

const readNarration = (file) => {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    process.stderr.write(`tts: ignoring unreadable ${file}: ${error.message}\n`);
    return null;
  }
};

const rowId = (row) => normalizeSceneId(String(row.scene ?? row.id ?? row.sceneId ?? ''));

const existingNarration = readNarration(narrationPath);
const existingById = new Map();
if (existingNarration && Array.isArray(existingNarration.scenes)) {
  for (const row of existingNarration.scenes) {
    const id = rowId(row);
    if (id) existingById.set(id, row);
  }
}

const round = (value, digits = 3) => Number(value.toFixed(digits));

/** Write to a sibling temp file, probe it, then rename over the target. */
const synthesizeScene = (profile, text, target) => {
  const temp = path.join(
    path.dirname(target),
    `.${path.basename(target)}.${process.pid}.tmp.mp3`,
  );
  fs.rmSync(temp, { force: true });
  try {
    run(
      edgeTts,
      [
        '--voice',
        profile.voice,
        `--rate=${profile.rate}`,
        `--pitch=${profile.pitch}`,
        `--volume=${profile.volume}`,
        '--text',
        text,
        '--write-media',
        temp,
      ],
      `edge-tts ${profile.voice}`,
    );
    const duration = probeDuration(temp);
    fs.renameSync(temp, target);
    return duration;
  } catch (error) {
    fs.rmSync(temp, { force: true });
    throw error;
  }
};

const makeRow = (scene, profile, duration) => {
  const characters = nonWhitespace(scene.narration);
  const requiredSeconds = duration + TAIL_SECONDS;
  const windowSeconds = scene.minSeconds;
  return {
    scene: scene.id,
    id: scene.id,
    text: scene.narration,
    textHash: textHash(profile, scene.narration),
    audio: rel(path.join(outDir, `${scene.id.toLowerCase()}.mp3`)),
    duration: round(duration),
    durationSeconds: round(duration),
    frames: Math.ceil(requiredSeconds * film.FPS),
    audioFrames: Math.ceil(duration * film.FPS),
    windowFrames: scene.minSeconds * film.FPS,
    windowSeconds,
    characters,
    charsPerSecond: round(characters / duration, 2),
    requiredSeconds: round(requiredSeconds),
    slackSeconds: round(windowSeconds - requiredSeconds),
    fits: requiredSeconds <= windowSeconds + 1e-9,
  };
};

const generateNarration = () => {
  fs.mkdirSync(outDir, { recursive: true });
  const generated = new Map();

  for (const scene of scenes) {
    const target = path.join(outDir, `${scene.id.toLowerCase()}.mp3`);
    const hash = textHash(voice.VOICE, scene.narration);
    const prior = existingById.get(scene.id);
    let duration;
    let mode = 'generated';

    if (!force && prior && prior.textHash === hash) {
      try {
        duration = probeDuration(target);
        mode = 'cached';
      } catch {
        duration = undefined;
      }
    }

    if (duration === undefined) {
      process.stdout.write(`tts: ${scene.id} -> ${rel(target)}\n`);
      try {
        duration = synthesizeScene(voice.VOICE, scene.narration, target);
      } catch (error) {
        process.stderr.write(
          `tts: FAILED ${scene.id} (${voice.ACTIVE_VOICE}): ${error.message}\n`,
        );
        process.stderr.write(
          'tts: no fallback engine is attempted; the previous clip is untouched.\n',
        );
        process.exit(1);
      }
    } else {
      process.stdout.write(`tts: ${scene.id} cached (${duration.toFixed(3)}s)\n`);
    }

    generated.set(scene.id, { ...makeRow(scene, voice.VOICE, duration), mode });
  }

  // A `--scene=` run must not drop the other measured rows.
  const rows = film.SCENES.flatMap((scene) => {
    const produced = generated.get(scene.id);
    if (produced) return [produced];
    const prior = existingById.get(scene.id);
    return prior ? [{ ...prior, mode: 'kept' }] : [];
  });

  const cleanRows = rows.map(({ mode, ...row }) => row);

  const totalSpeech = cleanRows.reduce((sum, row) => sum + row.duration, 0);
  const totalChars = cleanRows.reduce((sum, row) => sum + row.characters, 0);
  const totalRequiredFrames = cleanRows.reduce((sum, row) => sum + row.frames, 0);
  const totals = {
    scenes: cleanRows.length,
    speechSeconds: round(totalSpeech),
    tailSeconds: round(TAIL_SECONDS * cleanRows.length),
    requiredSeconds: round(totalSpeech + TAIL_SECONDS * cleanRows.length),
    windowSeconds: round(film.TOTAL_FRAMES / film.FPS),
    slackSeconds: round(film.TOTAL_FRAMES / film.FPS - totalSpeech - TAIL_SECONDS * cleanRows.length),
    characters: totalChars,
    avgCharsPerSecond: round(totalChars / totalSpeech, 2),
    audioFrames: cleanRows.reduce((sum, row) => sum + row.audioFrames, 0),
    requiredFrames: totalRequiredFrames,
    windowFrames: film.TOTAL_FRAMES,
  };

  const document = {
    profile: voice.ACTIVE_VOICE,
    voice: voice.VOICE,
    label: voice.VOICE.label,
    fps: film.FPS,
    totalFrames: film.TOTAL_FRAMES,
    totalSeconds: film.TOTAL_SECONDS,
    tailSeconds: TAIL_SECONDS,
    totals,
    scenes: cleanRows,
  };

  fs.writeFileSync(
    narrationPath,
    `${JSON.stringify(document, null, 2)}\n`,
    'utf8',
  );
  process.stdout.write(`tts: wrote ${rel(narrationPath)}\n`);

  const srt = buildSrt(cleanRows);
  fs.writeFileSync(profileSrtPath, srt.content, 'utf8');
  fs.writeFileSync(rootSrtPath, srt.content, 'utf8');
  process.stdout.write(
    `tts: wrote ${rel(profileSrtPath)} and ${rel(rootSrtPath)} ` +
      `(${srt.cues.length} cues, max ${srt.maxCharsPerSecond.toFixed(2)} chars/s)\n`,
  );

  return { document, rows: cleanRows, srt };
};

// ---------------------------------------------------------------------------
// SRT
// ---------------------------------------------------------------------------

const splitSentences = (text) => {
  const parts = text.replace(/\s+/g, ' ').match(/[^。！？!?；;]+[。！？!?；;]?/g);
  return (parts ?? [text])
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
};

const toTimestamp = (milliseconds) => {
  const safe = Math.max(0, Math.round(milliseconds));
  const hours = Math.floor(safe / 3_600_000);
  const minutes = Math.floor((safe % 3_600_000) / 60_000);
  const seconds = Math.floor((safe % 60_000) / 1000);
  const millis = safe % 1000;
  return (
    `${String(hours).padStart(2, '0')}:` +
    `${String(minutes).padStart(2, '0')}:` +
    `${String(seconds).padStart(2, '0')},` +
    `${String(millis).padStart(3, '0')}`
  );
};

const buildSrt = (rows) => {
  const cues = [];
  const windowById = new Map(
    film.SCENE_WINDOWS.map((window) => [window.id, window]),
  );

  for (const row of rows) {
    const window = windowById.get(row.scene);
    if (!window) throw new Error(`srt: no window for ${row.scene}`);
    const sentences = splitSentences(row.text);
    const sentenceChars = sentences.map((sentence) => nonWhitespace(sentence));
    const totalChars = sentenceChars.reduce((sum, value) => sum + value, 0) || 1;

    // Proportional to characters, but never faster than 14 chars/s. Measured
    // edge-tts speech is ~5 chars/s, so the floor has ample headroom.
    const durations = sentences.map((_, index) =>
      Math.max(
        (row.duration * sentenceChars[index]) / totalChars,
        sentenceChars[index] / MAX_SRT_CHARS_PER_SECOND,
      ),
    );

    const sceneStart = window.from / film.FPS;
    let cursor = sceneStart;
    for (const [index, sentence] of sentences.entries()) {
      const startSeconds = cursor;
      const endSeconds = cursor + durations[index];
      cursor = endSeconds;
      let startMs = Math.round(startSeconds * 1000);
      let endMs = Math.round(endSeconds * 1000);
      if (endMs <= startMs) endMs = startMs + 1;
      cues.push({
        scene: row.scene,
        startMs,
        endMs,
        text: sentence,
        characters: sentenceChars[index],
        sceneEndMs: Math.round(
          (window.from + window.durationInFrames) / film.FPS * 1000,
        ),
      });
    }
  }

  cues.sort((a, b) => a.startMs - b.startMs);

  let previousEnd = -1;
  let maxCharsPerSecond = 0;
  const covered = new Set();
  for (const cue of cues) {
    if (cue.startMs < previousEnd) cue.startMs = previousEnd;
    if (cue.endMs <= cue.startMs) cue.endMs = cue.startMs + 1;
    if (cue.endMs > cue.sceneEndMs) {
      throw new Error(
        `srt: cue for ${cue.scene} ends at ${cue.endMs}ms, past scene end ${cue.sceneEndMs}ms`,
      );
    }
    const seconds = (cue.endMs - cue.startMs) / 1000;
    const rate = cue.characters / seconds;
    if (rate > MAX_SRT_CHARS_PER_SECOND + 1e-6) {
      throw new Error(
        `srt: cue too fast (${rate.toFixed(2)} chars/s): ${cue.text}`,
      );
    }
    maxCharsPerSecond = Math.max(maxCharsPerSecond, rate);
    covered.add(cue.scene);
    previousEnd = cue.endMs;
  }

  const expectedScenes = film.SCENES.length;
  if (covered.size !== expectedScenes) {
    throw new Error(
      `srt: ${covered.size}/${expectedScenes} scenes covered by cues`,
    );
  }

  const content = cues
    .map((cue, index) => {
      const body = `${index + 1}\n${toTimestamp(cue.startMs)} --> ${toTimestamp(
        cue.endMs,
      )}\n${cue.text}\n`;
      return body;
    })
    .join('\n');

  return { content: `${content}\n`, cues, maxCharsPerSecond };
};

// ---------------------------------------------------------------------------
// 15-second audition pack
// ---------------------------------------------------------------------------

const SAMPLE_PROFILES = [
  { name: 'yunyang', profile: voice.VOICES.yunyang },
  {
    name: 'yunjian',
    profile: {
      voice: 'zh-CN-YunjianNeural',
      rate: '+0%',
      pitch: '+0Hz',
      volume: '+0%',
      label: 'Yunjian / 解说男声',
    },
  },
  { name: 'xiaoxiao', profile: voice.VOICES.xiaoxiao },
];

const generateSamples = () => {
  fs.mkdirSync(samplesDir, { recursive: true });
  const manifestPath = path.join(samplesDir, 'manifest.json');
  const prior = readNarration(manifestPath);
  const priorByName = new Map(
    (prior?.samples ?? []).map((sample) => [sample.name, sample]),
  );

  const samples = [];
  for (const { name, profile } of SAMPLE_PROFILES) {
    const target = path.join(samplesDir, `${name}.mp3`);
    const hash = textHash(profile, SAMPLE_TEXT);
    let duration;
    let mode = 'generated';

    if (!force && priorByName.get(name)?.hash === hash) {
      try {
        duration = probeDuration(target);
        if (Math.abs(duration - SAMPLE_SECONDS) <= 0.15) mode = 'cached';
        else duration = undefined;
      } catch {
        duration = undefined;
      }
    }

    if (duration === undefined) {
      const raw = path.join(samplesDir, `.${name}.raw.tmp.mp3`);
      const temp = path.join(samplesDir, `.${name}.${process.pid}.tmp.mp3`);
      fs.rmSync(raw, { force: true });
      fs.rmSync(temp, { force: true });
      try {
        run(
          edgeTts,
          [
            '--voice',
            profile.voice,
            `--rate=${profile.rate}`,
            `--pitch=${profile.pitch}`,
            `--volume=${profile.volume}`,
            '--text',
            SAMPLE_TEXT,
            '--write-media',
            raw,
          ],
          `edge-tts sample ${profile.voice}`,
        );
        run(
          ffmpeg,
          [
            '-hide_banner',
            '-loglevel',
            'error',
            '-y',
            '-i',
            raw,
            '-af',
            'apad',
            '-t',
            String(SAMPLE_SECONDS),
            '-c:a',
            'libmp3lame',
            '-q:a',
            '4',
            temp,
          ],
          `ffmpeg pad sample ${name}`,
        );
        duration = probeDuration(temp);
        if (Math.abs(duration - SAMPLE_SECONDS) > 0.15) {
          throw new Error(
            `sample ${name} is ${duration.toFixed(3)}s, expected ${SAMPLE_SECONDS}s`,
          );
        }
        fs.renameSync(temp, target);
        process.stdout.write(
          `tts: sample ${name} -> ${rel(target)} (${duration.toFixed(3)}s)\n`,
        );
      } catch (error) {
        fs.rmSync(raw, { force: true });
        fs.rmSync(temp, { force: true });
        throw error;
      }
    } else {
      process.stdout.write(
        `tts: sample ${name} cached (${duration.toFixed(3)}s)\n`,
      );
    }

    samples.push({
      name,
      voice: profile.voice,
      rate: profile.rate,
      pitch: profile.pitch,
      volume: profile.volume,
      label: profile.label,
      file: rel(target),
      duration: round(duration),
      hash,
    });
  }

  fs.writeFileSync(
    manifestPath,
    `${JSON.stringify(
      {
        sampleSeconds: SAMPLE_SECONDS,
        text: SAMPLE_TEXT,
        samples,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  process.stdout.write(`tts: wrote ${rel(manifestPath)}\n`);
};

// ---------------------------------------------------------------------------

try {
  if (!samplesOnly) {
    generateNarration();
  }
  generateSamples();
} catch (error) {
  process.stderr.write(`tts: FAILED: ${error.message}\n`);
  process.exit(1);
}

process.stdout.write(samplesOnly ? 'PASS (samples)\n' : 'PASS\n');
