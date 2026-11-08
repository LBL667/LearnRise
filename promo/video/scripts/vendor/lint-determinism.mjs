#!/usr/bin/env node
// Determinism lint.
//
// Remotion compositions must be a pure function of the current frame. Wall-clock
// reads and unseeded RNG silently break that invariant: two renders of the same
// frame range stop matching, contact sheets drift, and regression diffs become
// noise. This script is the tripwire that protects the invariant.
//
// Scans `<root>/src/**` (or `<root>/**` when there is no `src/`), skipping
// node_modules, out, .git and audit fixtures. Any hit exits 1.
//
// Whitelist: a line carrying `// determinism-ok: seeded` is ignored. Use it only
// next to Remotion's seeded `random()` helper, never next to Math.random.
//
// Zero runtime dependencies. Every script in this skill must run with plain
// `node` from any cwd, including before a project has node_modules installed.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = path.dirname(SCRIPT_DIR);
const DEFAULT_ROOT = path.join(SKILL_ROOT, 'template');

// Directories that never contain composition sources we care about.
const SKIP_DIRS = new Set([
  'node_modules',
  'out',
  '.git',
  'audit',
  '.next',
  'dist',
  'build',
  '.cache',
  'coverage',
]);

const SOURCE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.mts',
  '.cts',
]);

// Ordered most-specific first so `Math.floor(Math.random` wins over the
// `Math.random` substring it contains. The canonical token is what we print.
const PATTERNS = [
  { token: 'Math.floor(Math.random', regex: /Math\.floor\(\s*Math\.random/g },
  { token: 'Math.random', regex: /Math\.random/g },
  { token: 'Date.now', regex: /Date\.now/g },
  { token: 'performance.now', regex: /performance\.now/g },
  { token: 'new Date(', regex: /new\s+Date\s*\(/g },
];

const SEEDED_WHITELIST = /determinism-ok:\s*seeded/;

const HELP = `Usage: node scripts/lint-determinism.mjs [root] [options]

Scans composition sources for Math.random / Date.now / new Date /
performance.now and exits 1 on any hit.

Options:
  --root=<dir>    directory to scan (default: <skill>/template, or positional root)
  --json          machine-readable report on stdout
  --help, -h      show this help and exit 0

Example:
  node scripts/lint-determinism.mjs --root=projects/daw-promo --json
`;

const parseArgs = (argv) => {
  const flags = new Set(argv.filter((argument) => argument.startsWith('--')));
  const valueOf = (name) => {
    const prefix = `--${name}=`;
    const match = argv.find((argument) => argument.startsWith(prefix));
    if (match) return match.slice(prefix.length);
    const index = argv.indexOf(`--${name}`);
    if (index !== -1 && argv[index + 1] && !argv[index + 1].startsWith('--')) {
      return argv[index + 1];
    }
    return undefined;
  };
  const positional = argv.find((argument) => !argument.startsWith('--'));
  const rootArg = valueOf('root') ?? positional;
  return {
    json: flags.has('--json'),
    root: rootArg ? path.resolve(rootArg) : DEFAULT_ROOT,
  };
};

// Collect matches on one line, dropping overlaps. Patterns are already ordered
// most-specific first, so keeping the earlier (longer) match is enough.
const scanLine = (line) => {
  const matches = [];
  for (const pattern of PATTERNS) {
    pattern.regex.lastIndex = 0;
    let match;
    while ((match = pattern.regex.exec(line)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      const overlaps = matches.some((entry) => start < entry.end && end > entry.start);
      if (!overlaps) {
        matches.push({ token: pattern.token, start, end });
      }
    }
  }
  return matches.sort((a, b) => a.start - b.start);
};

const walk = (directory, files) => {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(path.join(directory, entry.name), files);
      continue;
    }
    if (!entry.isFile()) continue;
    const extension = path.extname(entry.name).toLowerCase();
    if (!SOURCE_EXTENSIONS.has(extension)) continue;
    files.push(path.join(directory, entry.name));
  }
};

const collectFiles = (root) => {
  if (!statSync(root).isDirectory()) {
    throw new Error(`--root must be a directory: ${root}`);
  }
  const src = path.join(root, 'src');
  const scanRoot = statSync(src, { throwIfNoEntry: false })?.isDirectory() ? src : root;
  const files = [];
  walk(scanRoot, files);
  return { scanRoot, files: files.sort() };
};

const lintFile = (file, root) => {
  const violations = [];
  const relative = path.relative(root, file) || path.basename(file);
  const text = readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    // The marker may sit on the same line as the call or on the line directly
    // above it (the common style: a comment describing the seeded call).
    const previous = index > 0 ? lines[index - 1] : '';
    if (SEEDED_WHITELIST.test(line) || SEEDED_WHITELIST.test(previous)) return;
    for (const match of scanLine(line)) {
      violations.push({
        file: relative,
        line: index + 1,
        token: match.token,
        text: line.trim(),
      });
    }
  });
  return violations;
};

const main = async () => {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(HELP);
    return 0;
  }
  const args = parseArgs(argv);
  let resolved;
  try {
    resolved = collectFiles(args.root);
  } catch (error) {
    if (args.json) {
      process.stdout.write(
        `${JSON.stringify({
          pass: false,
          error: error.message,
          root: args.root,
          scanned: 0,
          violations: [],
        })}\n`,
      );
    } else {
      process.stderr.write(`determinism lint: ${error.message}\n`);
    }
    return 1;
  }

  const { scanRoot, files } = resolved;
  const violations = files.flatMap((file) => lintFile(file, args.root));
  const pass = violations.length === 0;

  if (args.json) {
    process.stdout.write(
      `${JSON.stringify({
        pass,
        root: args.root,
        scanRoot,
        scanned: files.length,
        violations,
      })}\n`,
    );
  } else {
    process.stdout.write(`determinism lint: ${scanRoot}\n`);
    for (const violation of violations) {
      process.stdout.write(`${violation.file}:${violation.line}: ${violation.token}\n`);
    }
    process.stdout.write(
      pass
        ? `PASS: ${files.length} file(s), 0 violations\n`
        : `FAIL: ${violations.length} violation(s) in ${files.length} file(s)\n`,
    );
  }

  return pass ? 0 : 1;
};

main().then(
  (code) => process.exit(code),
  (error) => {
    process.stderr.write(`determinism lint failed: ${error?.stack || error}\n`);
    process.exit(1);
  },
);
