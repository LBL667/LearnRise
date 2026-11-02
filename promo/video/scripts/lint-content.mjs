#!/usr/bin/env node
/**
 * lint-content.mjs — forbid authored copy inside scene components.
 *
 * Rule: narration and screen copy live only in `src/content/film.ts`. A scene
 * file (`src/scenes/**`) may not contain a Chinese string/JSX run longer than
 * 12 non-whitespace characters.
 *
 * Usage: node scripts/lint-content.mjs [--root=<dir>] [--json]
 * Exit: 0 clean, 1 violation(s), 2 bad usage.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '..');

const argv = process.argv.slice(2);
const asJson = argv.includes('--json');
const rootFlag = argv.find((argument) => argument.startsWith('--root='));
const SCAN_ROOT = path.resolve(
  PROJECT_ROOT,
  rootFlag ? rootFlag.slice('--root='.length) : 'src/scenes',
);

const SOURCE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx']);
const MAX_CJK_SENTENCE = 12;
const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
const CJK_RUN =
  /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff，。！？、；：""''（）《》〈〉…—·]+/g;

const walk = (dir, out = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (SOURCE_EXT.has(path.extname(entry.name))) out.push(full);
  }
  return out;
};

const lineAt = (source, index) =>
  source.slice(0, index).split('\n').length;

const nonWhitespaceLength = (value) =>
  Array.from(value).filter((character) => !/\s/.test(character)).length;

/**
 * Blank comments while preserving string/template contents. Returns both the
 * comment-free source and the string literals with their indices.
 */
const tokenize = (source) => {
  const literals = [];
  const blanked = source.split('');
  let index = 0;
  let state = 'code';
  let quote = '';
  let start = 0;
  let value = '';

  const blank = (from, to) => {
    for (let i = from; i < to; i += 1) {
      if (blanked[i] !== '\n') blanked[i] = ' ';
    }
  };

  while (index < source.length) {
    const character = source[index];
    const next = source[index + 1];

    if (state === 'code') {
      if (character === '/' && next === '/') {
        state = 'line';
        index += 2;
        continue;
      }
      if (character === '/' && next === '*') {
        state = 'block';
        index += 2;
        continue;
      }
      if (character === "'" || character === '"' || character === '`') {
        state = 'string';
        quote = character;
        start = index;
        value = '';
        index += 1;
        continue;
      }
      index += 1;
      continue;
    }

    if (state === 'line') {
      if (character === '\n') state = 'code';
      index += 1;
      continue;
    }

    if (state === 'block') {
      if (character === '*' && next === '/') {
        state = 'code';
        index += 2;
        continue;
      }
      index += 1;
      continue;
    }

    if (state === 'string') {
      if (character === '\\') {
        value += source[index + 1] ?? '';
        index += 2;
        continue;
      }
      if (character === quote) {
        literals.push({ value, index: start, end: index + 1 });
        blank(start, index + 1);
        state = 'code';
        quote = '';
        index += 1;
        continue;
      }
      value += character;
      index += 1;
    }
  }

  return { code: blanked.join(''), literals };
};

const violationsFor = (file, source) => {
  const { code, literals } = tokenize(source);
  const found = [];

  for (const literal of literals) {
    if (!CJK.test(literal.value)) continue;
    if (nonWhitespaceLength(literal.value) <= MAX_CJK_SENTENCE) continue;
    found.push({
      file,
      line: lineAt(source, literal.index),
      text: literal.value.trim(),
      reason: 'hardcoded CJK string',
    });
  }

  for (const match of code.matchAll(CJK_RUN)) {
    const run = match[0];
    if (nonWhitespaceLength(run) <= MAX_CJK_SENTENCE) continue;
    found.push({
      file,
      line: lineAt(source, match.index ?? 0),
      text: run.trim(),
      reason: 'hardcoded CJK text node',
    });
  }

  return found;
};

const main = () => {
  if (!fs.existsSync(SCAN_ROOT)) {
    process.stderr.write(`lint-content: missing directory ${SCAN_ROOT}\n`);
    return 2;
  }

  const files = walk(SCAN_ROOT);
  const violations = files.flatMap((file) =>
    violationsFor(file, fs.readFileSync(file, 'utf8')),
  );

  if (asJson) {
    process.stdout.write(
      `${JSON.stringify(
        { pass: violations.length === 0, scanned: files.length, violations },
        null,
        2,
      )}\n`,
    );
  } else {
    process.stdout.write('lint-content\n');
    for (const violation of violations) {
      const relative = path.relative(PROJECT_ROOT, violation.file);
      process.stdout.write(
        `  FAIL ${relative}:${violation.line} ${violation.reason}: ${violation.text}\n`,
      );
    }
    process.stdout.write(
      violations.length === 0
        ? `PASS (${files.length} scene files)\n`
        : `FAIL (${violations.length} violation(s))\n`,
    );
  }

  return violations.length === 0 ? 0 : 1;
};

process.exit(main());
