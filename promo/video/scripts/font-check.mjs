#!/usr/bin/env node
/**
 * font-check.mjs — verify the CJK/web fonts the film needs are available.
 *
 * Usage: npm run fonts:check
 *
 * Local stand-in for the former shared skill renderer's font check; it only
 * inspects the system fonts and exits non-zero when a required family is
 * missing, so a render with missing fonts fails early and readably.
 */

import { spawnSync } from 'node:child_process';

const REQUIRED = [
  'Noto Sans SC',
  'Noto Serif SC',
];

const result = spawnSync('fc-list', ['--format', '%{family}\n'], {
  encoding: 'utf8',
});
if (result.error) {
  process.stderr.write(
    `font-check: cannot list system fonts (fc-list missing?): ${result.error.message}\n`,
  );
  process.exit(1);
}

const families = new Set(
  result.stdout
    .split('\n')
    .flatMap((line) => line.split(','))
    .map((family) => family.trim())
    .filter((family) => family.length > 0),
);

const missing = REQUIRED.filter((family) => !families.has(family));
if (missing.length > 0) {
  process.stderr.write(`font-check missing fonts: ${missing.join(', ')}\n`);
  process.exit(1);
}

process.stdout.write(
  `font-check ok: ${REQUIRED.join(', ')} all present\n`,
);
