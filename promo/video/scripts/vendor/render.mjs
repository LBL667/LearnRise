#!/usr/bin/env node
// Render wrapper with a determinism gate.
//
// A render is only allowed to start after two cheap pre-flight checks pass:
//   1. lint-determinism.mjs  — no Math.random / Date.now / new Date in src/**
//   2. determinism-check.mjs — the same 30 frames render identically twice
//                              (compared as decoded pixels, PSNR average:inf)
//
// If either check fails the wrapper exits 1 and never invokes remotion, so a
// non-deterministic scene cannot ship a video just because nobody noticed.
//
// Usage:
//   node scripts/render.mjs --project=/path/to/project --composition=Bench \
//        --output=out/bench.mp4 --json
//   node scripts/render.mjs --composition=DawPromo -- --log=verbose
//
// Zero runtime dependencies beyond node builtins and npx/remotion.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = path.dirname(SCRIPT_DIR);
const REPO_ROOT = path.dirname(path.dirname(SKILL_ROOT));
const LINT = path.join(SCRIPT_DIR, 'lint-determinism.mjs');
const DETERMINISM = path.join(SCRIPT_DIR, 'determinism-check.mjs');

const DEFAULTS = {
  composition: 'Bench',
  concurrency: 2,
  preflightFrames: '0-29',
  // Must match determinism-check.mjs: the default GL backend is not pixel-stable
  // here, ANGLE is. Pinning it keeps the checked render and the real render equal.
  gl: 'angle',
  timeoutMs: 900000,
};

const HELP = `Usage: node scripts/render.mjs [options] [-- <remotion flags>]

Render wrapper with a determinism gate: lint-determinism.mjs and a double-render
PSNR check run before remotion is invoked.

Options:
  --project=<dir>             render sandbox (default: cwd, else projects/daw-promo)
  --composition=<id>          composition id (default: ${DEFAULTS.composition})
  --output=<file>             output mp4 (default: out/<composition>.mp4)
  --frames=<range>            frame range passed to remotion
  --preflight-frames=<range>  frames checked for determinism (default: ${DEFAULTS.preflightFrames})
  --concurrency=<n>           remotion concurrency (default: ${DEFAULTS.concurrency})
  --gl=<backend>              GL backend (default: ${DEFAULTS.gl})
  --timeout-ms=<n>            per-command timeout (default: ${DEFAULTS.timeoutMs})
  --json                      machine-readable report on stdout
  --help, -h                  show this help and exit 0

Example:
  node scripts/render.mjs --project=projects/daw-promo --composition=Film --output=out/film.mp4 --json
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
  const separator = argv.indexOf('--');
  const own = separator === -1 ? argv : argv.slice(0, separator);
  const passthrough = separator === -1 ? [] : argv.slice(separator + 1);
  const flags = new Set(own.filter((argument) => argument.startsWith('--')));
  const composition = valueOf(own, 'composition') ?? DEFAULTS.composition;
  const concurrencyRaw = valueOf(own, 'concurrency');
  const concurrency = concurrencyRaw === undefined ? DEFAULTS.concurrency : Number(concurrencyRaw);
  return {
    json: flags.has('--json'),
    composition,
    output: valueOf(own, 'output') ?? path.join('out', `${composition}.mp4`),
    frames: valueOf(own, 'frames'),
    preflightFrames: valueOf(own, 'preflight-frames') ?? DEFAULTS.preflightFrames,
    concurrency,
    gl: valueOf(own, 'gl') ?? DEFAULTS.gl,
    project: valueOf(own, 'project') ?? valueOf(own, 'root'),
    timeoutMs: Number(valueOf(own, 'timeout-ms') ?? DEFAULTS.timeoutMs),
    passthrough,
  };
};

const isRunnable = (directory) =>
  existsSync(path.join(directory, 'package.json')) &&
  (existsSync(path.join(directory, 'node_modules', 'remotion')) ||
    existsSync(path.join(directory, 'node_modules', '.bin', 'remotion')));

// An explicit --project is trusted (the determinism check reports its own
// errors); auto-discovery only accepts a sandbox that already has node_modules,
// so `npx` never downloads Remotion behind our back.
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
  throw new Error(`no runnable Remotion project found; pass --project=<dir>`);
};

const runNode = async (script, args, timeoutMs) => {
  try {
    const result = await execFileAsync(process.execPath, [script, ...args], {
      maxBuffer: 128 * 1024 * 1024,
      timeout: timeoutMs,
    });
    return { ok: true, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return {
      ok: false,
      stdout: error?.stdout ?? '',
      stderr: error?.stderr ?? '',
      code: error?.code,
    };
  }
};

const parseJson = (text) => {
  for (const line of text.trim().split(/\r?\n/).reverse()) {
    try {
      return JSON.parse(line);
    } catch {
      // keep looking for the report line
    }
  }
  return null;
};

const main = async () => {
  const argv = process.argv.slice(2);
  const separator = argv.indexOf('--');
  const own = separator === -1 ? argv : argv.slice(0, separator);
  if (own.includes('--help') || own.includes('-h')) {
    process.stdout.write(HELP);
    return 0;
  }
  const args = parseArgs(argv);
  const project = resolveProject(args.project);
  const report = {
    pass: false,
    project,
    composition: args.composition,
    output: args.output,
    frames: args.frames ?? null,
    preflight: { lint: null, determinism: null },
    render: null,
  };

  // 1. Determinism lint — always on. There is deliberately no flag to skip it.
  const lintRun = await runNode(
    LINT,
    ['--root', project, '--json'],
    Math.min(args.timeoutMs, 60000),
  );
  report.preflight.lint = parseJson(lintRun.stdout) ?? {
    pass: false,
    error: lintRun.stderr.trim() || 'lint produced no JSON report',
  };
  if (!lintRun.ok || report.preflight.lint.pass !== true) {
    const violations = report.preflight.lint.violations ?? [];
    if (args.json) {
      process.stdout.write(`${JSON.stringify(report)}\n`);
    } else {
      process.stdout.write('pre-flight: determinism lint FAILED\n');
      for (const violation of violations) {
        process.stdout.write(
          `${violation.file}:${violation.line}: ${violation.token}\n`,
        );
      }
      if (violations.length === 0) {
        process.stdout.write(`  ${report.preflight.lint.error ?? lintRun.stderr.trim()}\n`);
      }
      process.stdout.write('render aborted before invoking remotion\n');
    }
    return 1;
  }

  // 2. Double-render check — decoded-frame comparison, not file hashing.
  // Always runs. There is deliberately no flag to skip it.
  const determinismRun = await runNode(
    DETERMINISM,
    [
      '--project',
      project,
      '--composition',
      args.composition,
      `--frames=${args.preflightFrames}`,
      `--gl=${args.gl}`,
      '--json',
    ],
    args.timeoutMs,
  );
  report.preflight.determinism = parseJson(determinismRun.stdout) ?? {
    pass: false,
    error: determinismRun.stderr.trim() || 'determinism check produced no JSON report',
  };
  if (!determinismRun.ok || report.preflight.determinism.pass !== true) {
    if (args.json) {
      process.stdout.write(`${JSON.stringify(report)}\n`);
    } else {
      process.stdout.write(
        `pre-flight: determinism check FAILED ` +
          `(average:${report.preflight.determinism?.psnr?.average ?? 'n/a'})\n`,
      );
      if (report.preflight.determinism?.error) {
        process.stdout.write(`  ${report.preflight.determinism.error}\n`);
      }
      process.stdout.write('render aborted before invoking remotion\n');
    }
    return 1;
  }

  // 3. The actual render.
  const renderArgs = [
    'remotion',
    'render',
    args.composition,
    args.output,
    `--concurrency=${args.concurrency}`,
    `--gl=${args.gl}`,
    '--overwrite',
    ...(args.frames ? [`--frames=${args.frames}`] : []),
    ...args.passthrough,
  ];
  const started = Date.now();
  try {
    const result = await execFileAsync('npx', renderArgs, {
      cwd: project,
      maxBuffer: 128 * 1024 * 1024,
      timeout: args.timeoutMs,
    });
    report.render = { ok: true, ms: Date.now() - started, output: args.output };
    if (!args.json) {
      if (result.stdout.trim()) process.stdout.write(`${result.stdout.trim()}\n`);
      if (result.stderr.trim()) process.stderr.write(`${result.stderr.trim()}\n`);
    }
  } catch (error) {
    report.render = {
      ok: false,
      ms: Date.now() - started,
      code: error?.code,
      stderr: (error?.stderr ?? '').slice(-4000),
    };
    if (!args.json) {
      if (error?.stdout) process.stdout.write(error.stdout);
      if (error?.stderr) process.stderr.write(error.stderr);
    }
  }

  report.pass = report.render.ok === true;
  if (args.json) {
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } else {
    process.stdout.write(
      report.pass
        ? `render PASS: ${args.output} (${(report.render.ms / 1000).toFixed(2)}s)\n`
        : `render FAIL: remotion exited ${report.render?.code ?? '?'}\n`,
    );
  }
  return report.pass ? 0 : 1;
};

main().then(
  (code) => process.exit(code),
  (error) => {
    process.stderr.write(`render wrapper failed: ${error?.stack || error}\n`);
    if (error?.stderr) {
      process.stderr.write(`${String(error.stderr).slice(-4000)}\n`);
    }
    process.exit(1);
  },
);
