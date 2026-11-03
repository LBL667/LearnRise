#!/usr/bin/env node
/**
 * Deterministic narration + music mix for the LearnRise promo.
 *
 *   node scripts/mix-audio.mjs --voice=yunyang \
 *     --video=out/film.mp4 \
 *     --output=out/learnrise-promo.mp4
 *
 * (Default --video is out/film.mp4, i.e. the `npm run render` output; pass
 * --video=out/learnrise-promo-video.mp4 for a legacy already-muxed stream.)
 *
 * Chain: 11 edge-tts clips placed at their scene windows -> voice loudnorm
 * (I=-14:TP=-2:LRA=11); the 224 s deterministic bed -> loudnorm to -25 LUFS ->
 * sidechain-ducked by the voice; the two summed -> final loudnorm -> 48 kHz
 * stereo AAC muxed onto the already-rendered video stream (video copied).
 *
 * The script is re-runnable: the same narration.json + bed always produce the
 * same measured targets. It never touches the video pixels.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..');

const FPS = 30;
const FRAMES = 6720;
const SECONDS = FRAMES / FPS;
const SR = 48_000;

const VOICE_TARGET = 'I=-14:TP=-2:LRA=11';
const BED_TARGET = 'I=-25:TP=-2:LRA=11';
const BED_LUFS = -25;

const argv = process.argv.slice(2);
const flag = (name) => {
  const prefix = `--${name}=`;
  const hit = argv.find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
};
const has = (name) => argv.includes(`--${name}`);

const voice = flag('voice') ?? 'yunyang';
if (!['yunyang', 'xiaoxiao'].includes(voice)) {
  process.stderr.write(`mix-audio: unknown voice ${voice}\n`);
  process.exit(2);
}

const videoArg = flag('video') ?? 'out/film.mp4';
const outputArg = flag('output') ?? 'out/learnrise-promo.mp4';
const video = path.resolve(ROOT, videoArg);
const output = path.resolve(ROOT, outputArg);

const audioDir = path.join(ROOT, 'out', 'audio');
const bed = path.join(audioDir, 'bed-224.wav');
const narrationPath = path.join(audioDir, voice, 'narration.json');
const voiceWav = path.join(audioDir, `voice-${voice}.wav`);
const bedNorm = path.join(audioDir, 'bed-25lufs.wav');
const bedDucked = path.join(audioDir, `bed-ducked-${voice}.wav`);
const mixWav = path.join(audioDir, `mix-${voice}.wav`);

const run = (command, args, label, { quiet = true } = {}) => {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  if (result.status !== 0) {
    const tail = (result.stderr || result.stdout || '').trim().split('\n').slice(-8).join('\n');
    throw new Error(`${label}: exited ${result.status}\n${tail}`);
  }
  if (!quiet && result.stderr.trim()) process.stderr.write(result.stderr);
  return result;
};

const ffmpeg = (args, label, options) => run('ffmpeg', ['-hide_banner', '-nostdin', '-y', ...args], label, options);

const parseLoudnorm = (stderr, label) => {
  const blocks = stderr.match(/\{[^{}]*"input_i"[^{}]*\}/gs);
  if (!blocks || blocks.length === 0) throw new Error(`${label}: loudnorm printed no JSON`);
  const data = JSON.parse(blocks[blocks.length - 1]);
  for (const key of ['input_i', 'input_tp', 'input_lra', 'input_thresh']) {
    if (data[key] === undefined) throw new Error(`${label}: loudnorm missing ${key}`);
  }
  return data;
};

const applyLoudnorm = (inputArgs, preGraph, target, outputFile, label) => {
  const measureGraph = `${preGraph};[pre]loudnorm=${target}:print_format=json[ln-out]`;
  const measured = ffmpeg(
    [...inputArgs, '-filter_complex', measureGraph, '-map', '[ln-out]', '-f', 'null', '-'],
    `${label} measure`,
  );
  const data = parseLoudnorm(measured.stderr, `${label} measure`);
  const secondPass =
    `${target}` +
    `:measured_I=${data.input_i}:measured_TP=${data.input_tp}` +
    `:measured_LRA=${data.input_lra}:measured_thresh=${data.input_thresh}` +
    `:offset=${data.target_offset ?? 0}:linear=true:print_format=summary`;
  const applyGraph = `${preGraph};[pre]loudnorm=${secondPass}[ln-out]`;
  ffmpeg(
    [...inputArgs, '-filter_complex', applyGraph, '-map', '[ln-out]',
      '-ar', String(SR), '-ac', '2', '-c:a', 'pcm_s16le', outputFile],
    `${label} apply`,
  );
  return data;
};

const measureEbur128 = (file, label) => {
  const result = ffmpeg(
    ['-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-'],
    label,
  );
  const summary = result.stderr.split('Summary:').pop() ?? '';
  const read = (regex) => {
    const match = summary.match(regex);
    return match ? Number(match[1]) : null;
  };
  return {
    integratedLufs: read(/I:\s*(-?[0-9.]+)\s*LUFS/),
    loudnessRangeLu: read(/LRA:\s*(-?[0-9.]+)\s*LU/),
    truePeakDbtp: read(/Peak:\s*(-?[0-9.]+)\s*dBFS/),
  };
};

const main = () => {
  if (!fs.existsSync(narrationPath)) {
    throw new Error(`missing ${path.relative(ROOT, narrationPath)}; run npm run tts:all first`);
  }
  if (!fs.existsSync(video)) {
    throw new Error(`missing video ${videoArg}; render the Film first`);
  }

  if (!fs.existsSync(bed) || has('rebuild-bed')) {
    run('python3', [path.join(SCRIPT_DIR, 'make-bed.py')], 'make-bed', { quiet: false });
  }

  const narration = JSON.parse(fs.readFileSync(narrationPath, 'utf8'));
  if (narration.totalFrames !== FRAMES) {
    throw new Error(`narration totalFrames ${narration.totalFrames} != ${FRAMES}`);
  }
  if (narration.scenes.length !== 11) {
    throw new Error(`expected 11 narration scenes, got ${narration.scenes.length}`);
  }

  let cursorFrames = 0;
  const placements = narration.scenes.map((scene) => {
    const file = path.resolve(ROOT, scene.audio);
    if (!fs.existsSync(file)) throw new Error(`missing clip ${scene.audio}`);
    if (scene.windowFrames !== undefined && scene.fits === false) {
      throw new Error(`clip ${scene.scene} does not fit its window`);
    }
    const startFrames = cursorFrames;
    cursorFrames += scene.windowFrames;
    return {
      scene: scene.scene,
      file,
      startFrames,
      startMs: Math.round((startFrames / FPS) * 1000),
      duration: scene.duration,
    };
  });
  if (cursorFrames !== FRAMES) {
    throw new Error(`scene windows sum to ${cursorFrames}, expected ${FRAMES}`);
  }

  const clipInputs = placements.flatMap((placement) => ['-i', placement.file]);
  const clipChains = placements.map((placement, index) =>
    `[${index}:a]aresample=${SR},aformat=sample_fmts=fltp:channel_layouts=stereo,` +
    `adelay=${placement.startMs}|${placement.startMs}[v${index}]`,
  );
  const mixLabels = placements.map((_, index) => `[v${index}]`).join('');
  const voiceGraph =
    `${clipChains.join(';')};${mixLabels}` +
    `amix=inputs=${placements.length}:normalize=0:duration=longest:dropout_transition=0,` +
    `apad=whole_dur=${SECONDS},atrim=0:${SECONDS},` +
    `acompressor=threshold=0.03:ratio=3:attack=5:release=150[pre]`;

  const voiceMeasured = applyLoudnorm(
    clipInputs,
    voiceGraph,
    VOICE_TARGET,
    voiceWav,
    'voice loudnorm',
  );
  const voiceEbur = measureEbur128(voiceWav, 'voice ebur128');

  const bedGraph = `[0:a]aresample=${SR},aformat=sample_fmts=fltp:channel_layouts=stereo,` +
    `atrim=0:${SECONDS},apad=whole_dur=${SECONDS}[pre]`;
  const bedMeasured = applyLoudnorm(
    ['-i', bed],
    bedGraph,
    BED_TARGET,
    bedNorm,
    'bed loudnorm',
  );
  const bedEbur = measureEbur128(bedNorm, 'bed ebur128');
  if (bedEbur.integratedLufs === null || Math.abs(bedEbur.integratedLufs - BED_LUFS) > 1.0) {
    throw new Error(`bed loudness ${bedEbur.integratedLufs} outside ${BED_LUFS - 1}..${BED_LUFS + 1} LUFS`);
  }

  ffmpeg(
    ['-i', bedNorm, '-i', voiceWav,
      '-filter_complex',
      '[0:a][1:a]sidechaincompress=threshold=0.02:ratio=12:attack=20:release=350:knee=3:makeup=1[duck]',
      '-map', '[duck]', '-ar', String(SR), '-ac', '2', '-c:a', 'pcm_s16le', bedDucked],
    'sidechain duck',
  );
  const bedDuckedEbur = measureEbur128(bedDucked, 'bed ducked ebur128');

  ffmpeg(
    ['-i', voiceWav, '-i', bedDucked,
      '-filter_complex',
      `[0:a][1:a]amix=inputs=2:normalize=0:duration=longest,` +
      `loudnorm=${VOICE_TARGET},aresample=${SR},` +
      `aformat=sample_fmts=s16:channel_layouts=stereo[out]`,
      '-map', '[out]', '-ar', String(SR), '-ac', '2', '-c:a', 'pcm_s16le', mixWav],
    'final mix',
  );
  let mixEbur = measureEbur128(mixWav, 'mix ebur128');

  // loudnorm cannot always reach -14 when the source crest factor is wider
  // than the TP budget; trim the residual with a static gain and a -1.4 dBFS
  // limiter so the delivered mix lands on the gate target instead of -15.1.
  if (mixEbur.integratedLufs !== null) {
    const gainDb = -14 - mixEbur.integratedLufs;
    if (Math.abs(gainDb) > 0.15) {
      const gainFilter = gainDb > 0
        ? `volume=${gainDb.toFixed(2)}dB,alimiter=limit=0.841:level=0`
        : `volume=${gainDb.toFixed(2)}dB`;
      const trimmed = path.join(audioDir, `mix-${voice}.trim.wav`);
      ffmpeg(
        ['-i', mixWav, '-af', gainFilter, '-ar', String(SR), '-ac', '2',
          '-c:a', 'pcm_s16le', trimmed],
        'mix trim',
      );
      fs.renameSync(trimmed, mixWav);
      mixEbur = measureEbur128(mixWav, 'mix ebur128 trimmed');
    }
  }

  ffmpeg(
    ['-i', video, '-i', mixWav,
      '-map', '0:v:0', '-map', '1:a:0',
      '-c:v', 'copy', '-c:a', 'aac', '-ar', String(SR), '-ac', '2', '-b:a', '192k',
      '-t', String(SECONDS), '-movflags', '+faststart', output],
    'mux',
  );

  const report = {
    pass: true,
    voice,
    output: path.relative(ROOT, output),
    video: path.relative(ROOT, video),
    mix: path.relative(ROOT, mixWav),
    bed: path.relative(ROOT, bed),
    targets: {
      voice: VOICE_TARGET,
      bed: BED_TARGET,
      bedLufs: BED_LUFS,
      sidechain: 'threshold=0.02 ratio=12 attack=20 release=350 knee=3',
      codec: 'aac 48 kHz stereo 192 kbps',
    },
    measured: {
      voice: { loudnorm: voiceMeasured, ebur128: voiceEbur },
      bedNormalised: { loudnorm: bedMeasured, ebur128: bedEbur },
      bedDucked: { ebur128: bedDuckedEbur },
      mix: { ebur128: mixEbur },
    },
    placements: placements.map(({ scene, startFrames, startMs, duration }) => ({
      scene, startFrames, startMs, duration,
    })),
  };

  if (mixEbur.integratedLufs === null ||
      Math.abs(mixEbur.integratedLufs + 14) > 1.5 ||
      (mixEbur.truePeakDbtp !== null && mixEbur.truePeakDbtp > -1.0)) {
    throw new Error(`final mix out of gate band: ${JSON.stringify(mixEbur)}`);
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
};

try {
  main();
} catch (error) {
  process.stderr.write(`mix-audio: ${error.message}\n`);
  process.exit(1);
}
