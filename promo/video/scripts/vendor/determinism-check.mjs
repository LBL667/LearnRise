#!/usr/bin/env node
// Double-render determinism check.
//
// Renders the same composition over the same frame range twice, then compares
// the two files with ffmpeg's psnr filter. The comparison runs on decoded
// frames, not on container bytes: mp4 metadata (creation time, encoder tags,
// moov ordering) changes between runs even when every pixel is identical, so
// hashing the files would fail for the wrong reason.
//
// Pass condition: `average:inf` (all compared luma/chroma samples identical).
//
// Usage:
//   node scripts/determinism-check.mjs --frames=0-29 --composition=Bench --json
//   node scripts/determinism-check.mjs --project=/path/to/project --keep
//
// Zero runtime dependencies beyond node builtins, npx (for remotion) and ffmpeg.
import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = path.dirname(SCRIPT_DIR);
const REPO_ROOT = path.dirname(path.dirname(SKILL_ROOT));

const DEFAULTS = {
  frames: '0-29',
  composition: 'Bench',
  concurrency: 2,
  // On this machine the default GL backend rasterizes with run-to-run noise
  // (~47 dB PSNR) even for frame-pure scenes. ANGLE is pixel-identical.
  gl: 'angle',
  timeoutMs: 300000,
};

const HELP = `Usage: node scripts/determinism-check.mjs [options]

Renders the same composition twice and compares the mp4s with ffmpeg PSNR
(pass condition: average:inf, i.e. pixel-identical).

Options:
  --frames=<range>      frame range (default: ${DEFAULTS.frames})
  --composition=<id>    composition id (default: ${DEFAULTS.composition})
  --project=<dir>       render sandbox (default: cwd, else projects/daw-promo)
  --concurrency=<n>     remotion concurrency (default: ${DEFAULTS.concurrency})
  --gl=<backend>        GL backend (default: ${DEFAULTS.gl})
  --timeout-ms=<n>      per-render timeout (default: ${DEFAULTS.timeoutMs})
  --keep                keep the temp render directory
  --json                machine-readable report on stdout
  --help, -h            show this help and exit 0

Example:
  node scripts/determinism-check.mjs --frames=0-29 --composition=Bench --json
`;

const valueOf = (argv, name) => {
  const prefix = `--${name}=`;
  const match = argv.find((argument) => argument.startsWith(prefix));
  if (match) return match.slice(prefix.length);
  const index = argv.indexOf(`--${name}`);
  if (index !== -1 && argv[index + 1] && !argv[index + 1].startsWith('--')) {
    return argv[index + 1];
  }
  return undefined;
};

const parseArgs = (argv) => {
  const flags = new Set(argv.filter((argument) => argument.startsWith('--')));
  const frames = valueOf(argv, 'frames') ?? DEFAULTS.frames;
  if (!/^\d+(-\d+)?(,\d+(-\d+)?)*$/.test(frames)) {
    throw new Error(`--frames must look like 0-29, got ${JSON.stringify(frames)}`);
  }
  const concurrencyRaw = valueOf(argv, 'concurrency');
  const concurrency = concurrencyRaw === undefined ? DEFAULTS.concurrency : Number(concurrencyRaw);
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error(`--concurrency must be a positive integer, got ${concurrencyRaw}`);
  }
  return {
    json: flags.has('--json'),
    keep: flags.has('--keep'),
    frames,
    composition: valueOf(argv, 'composition') ?? DEFAULTS.composition,
    concurrency,
    gl: valueOf(argv, 'gl') ?? DEFAULTS.gl,
    timeoutMs: Number(valueOf(argv, 'timeout-ms') ?? DEFAULTS.timeoutMs),
    project: valueOf(argv, 'project') ?? valueOf(argv, 'root'),
  };
};

// A render sandbox must already have Remotion installed: `npx` must never be
// allowed to fetch packages as a side effect of a pre-flight check.
const isRunnable = (directory) =>
  existsSync(path.join(directory, 'package.json')) &&
  (existsSync(path.join(directory, 'node_modules', 'remotion')) ||
    existsSync(path.join(directory, 'node_modules', '.bin', 'remotion')));

// Prefer an explicit --project, then the cwd, then the known sandboxes in this
// repo. Auto-discovery only accepts a project with node_modules; an explicit
// path is trusted so the caller gets a clear remotion error instead of a
// "project not found" surprise.
const resolveProject = (explicit) => {
  if (explicit) {
    const resolved = path.resolve(explicit);
    if (!existsSync(resolved)) {
      throw new Error(`--project does not exist: ${resolved}`);
    }
    return resolved;
  }
  const candidates = [
    process.cwd(),
    // The legacy bench sandbox is the default because the `Bench` composition
    // lives there. Pass --project for the golden project or any other sandbox.
    path.join(path.dirname(REPO_ROOT), 'DAW-promo'),
    path.join(REPO_ROOT, 'projects', 'daw-promo'),
  ];
  for (const candidate of candidates) {
    if (isRunnable(candidate)) return candidate;
  }
  throw new Error(
    `no runnable Remotion project found (needs package.json + node_modules); ` +
      `pass --project=<dir> (tried: ${candidates.join(', ')})`,
  );
};

const run = async (command, args, options = {}) => {
  const result = await execFileAsync(command, args, {
    maxBuffer: 128 * 1024 * 1024,
    timeout: options.timeoutMs ?? DEFAULTS.timeoutMs,
    ...options,
  });
  return result;
};

const renderOnce = async ({
  project,
  composition,
  frames,
  concurrency,
  gl,
  output,
  timeoutMs,
}) => {
  const started = Date.now();
  await run(
    'npx',
    [
      'remotion',
      'render',
      composition,
      output,
      `--frames=${frames}`,
      `--concurrency=${concurrency}`,
      `--gl=${gl}`,
      '--overwrite',
    ],
    { cwd: project, timeoutMs },
  );
  return Date.now() - started;
};

const measurePsnr = async ({ first, second, timeoutMs }) => {
  let stderr = '';
  try {
    const result = await run(
      'ffmpeg',
      [
        '-hide_banner',
        '-nostdin',
        '-i',
        first,
        '-i',
        second,
        '-lavfi',
        '[0:v][1:v]psnr',
        '-f',
        'null',
        '-',
      ],
      { timeoutMs },
    );
    stderr = result.stderr;
  } catch (error) {
    // ffmpeg exits non-zero on unreadable input, but writes the filter report to
    // stderr either way. Only rethrow when no PSNR line is present at all.
    stderr = error?.stderr ?? '';
    if (!/average:\s*([0-9.]+|inf)/i.test(stderr)) {
      throw error;
    }
  }

  const grab = (key) => {
    const match = stderr.match(new RegExp(`${key}:\\s*([0-9.]+|inf)`, 'i'));
    return match ? match[1] : null;
  };
  const average = grab('average');
  if (average === null) {
    throw new Error(`could not parse PSNR output from ffmpeg:\n${stderr.slice(-2000)}`);
  }
  return {
    average,
    y: grab('y'),
    u: grab('u'),
    v: grab('v'),
    min: grab('min'),
    max: grab('max'),
  };
};

const main = async () => {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(HELP);
    return 0;
  }
  const args = parseArgs(argv);
  const project = resolveProject(args.project);
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'remotion-determinism-'));
  const first = path.join(tempDir, 'render-a.mp4');
  const second = path.join(tempDir, 'render-b.mp4');

  const report = {
    pass: false,
    project,
    composition: args.composition,
    frames: args.frames,
    concurrency: args.concurrency,
    gl: args.gl,
    renders: [],
    psnr: null,
    outputs: { first, second },
  };

  try {
    const firstMs = await renderOnce({
      project,
      composition: args.composition,
      frames: args.frames,
      concurrency: args.concurrency,
      gl: args.gl,
      output: first,
      timeoutMs: args.timeoutMs,
    });
    report.renders.push({ run: 1, ms: firstMs, output: first });

    const secondMs = await renderOnce({
      project,
      composition: args.composition,
      frames: args.frames,
      concurrency: args.concurrency,
      gl: args.gl,
      output: second,
      timeoutMs: args.timeoutMs,
    });
    report.renders.push({ run: 2, ms: secondMs, output: second });

    report.psnr = await measurePsnr({
      first,
      second,
      timeoutMs: args.timeoutMs,
    });
    const average = String(report.psnr.average).toLowerCase();
    report.pass = average === 'inf' || average === 'infinity';
  } finally {
    if (!args.keep) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }

  if (args.json) {
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } else {
    process.stdout.write(
      `determinism-check ${report.composition} frames=${report.frames} project=${report.project}\n`,
    );
    for (const entry of report.renders) {
      process.stdout.write(
        `  render #${entry.run} ${(entry.ms / 1000).toFixed(2)}s -> ${entry.output}\n`,
      );
    }
    if (report.psnr) {
      process.stdout.write(
        `  psnr y:${report.psnr.y} u:${report.psnr.u} v:${report.psnr.v} ` +
          `average:${report.psnr.average} (decoded frames)\n`,
      );
    }
    process.stdout.write(
      report.pass
        ? '  PASS: decoded frames are identical (average:inf)\n'
        : `  FAIL: decoded frames differ (average:${report.psnr?.average})\n`,
    );
    if (args.keep) {
      process.stdout.write(`  kept: ${tempDir}\n`);
    }
  }

  return report.pass ? 0 : 1;
};

main().then(
  (code) => process.exit(code),
  (error) => {
    process.stderr.write(`determinism-check failed: ${error?.stack || error}\n`);
    if (error?.stderr) {
      process.stderr.write(`${String(error.stderr).slice(-4000)}\n`);
    }
    process.exit(1);
  },
);
