#!/usr/bin/env node
/**
 * check-facts.mjs — reconcile `src/content/facts.ts` with LearnRise.
 *
 * Baseline files (read-only):
 *   openapi.json                    paths + operations (all methods, incl. HEAD)
 *   scripts/test-baseline.json      collected / passed / skipped / failed
 *   docker-compose.yml              six services
 *
 * Usage:
 *   node scripts/check-facts.mjs [--json] [--learnrise=<path>]
 *
 * Exit 0 only when every number matches; exit 1 prints the drift.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '..');
const FACTS_PATH = path.join(PROJECT_ROOT, 'src', 'content', 'facts.ts');

const argv = process.argv.slice(2);
const asJson = argv.includes('--json');
const explicitRoot = argv.find((argument) => argument.startsWith('--learnrise='));

const LEARNRISE_CANDIDATES = [
  explicitRoot ? explicitRoot.slice('--learnrise='.length) : undefined,
  process.env.LEARNRISE_ROOT,
  '/home/sky/竞赛/华为ICT/LearnRise',
  path.resolve(PROJECT_ROOT, '../../../../../竞赛/华为ICT/LearnRise'),
].filter(Boolean);

const HTTP_METHODS = new Set([
  'get',
  'put',
  'post',
  'delete',
  'options',
  'head',
  'patch',
  'trace',
]);

const fail = (message) => {
  process.stderr.write(`check-facts: ${message}\n`);
  process.exit(1);
};

const resolveLearnrise = () => {
  for (const candidate of LEARNRISE_CANDIDATES) {
    if (fs.existsSync(path.join(candidate, 'openapi.json'))) {
      return path.resolve(candidate);
    }
  }
  fail(
    `no LearnRise checkout found; probed: ${LEARNRISE_CANDIDATES.join(', ')}`,
  );
};

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    fail(`cannot read ${file}: ${error.message}`);
  }
};

const readFact = (source, name) => {
  const match = source.match(
    new RegExp(`export\\s+const\\s+${name}\\s*(?::\\s*number\\s*)?=\\s*(\\d+)`),
  );
  if (!match) fail(`facts.ts is missing an integer \`export const ${name}\``);
  return Number.parseInt(match[1], 10);
};

const countComposeServices = (composePath) => {
  const lines = fs.readFileSync(composePath, 'utf8').split(/\r?\n/);
  const names = [];
  let inServices = false;
  for (const line of lines) {
    if (/^services:\s*$/.test(line)) {
      inServices = true;
      continue;
    }
    if (!inServices) continue;
    if (/^\S/.test(line) && line.trim() !== '') break;
    const match = line.match(/^  ([A-Za-z0-9_.-]+):\s*$/);
    if (match) names.push(match[1]);
  }
  return names;
};

const main = () => {
  if (!fs.existsSync(FACTS_PATH)) fail(`missing ${FACTS_PATH}`);
  const source = fs.readFileSync(FACTS_PATH, 'utf8');
  const facts = {
    API_PATHS: readFact(source, 'API_PATHS'),
    API_OPERATIONS: readFact(source, 'API_OPERATIONS'),
    TESTS_COLLECTED: readFact(source, 'TESTS_COLLECTED'),
    TESTS_PASSED: readFact(source, 'TESTS_PASSED'),
    TESTS_SKIPPED: readFact(source, 'TESTS_SKIPPED'),
    TESTS_FAILED: readFact(source, 'TESTS_FAILED'),
    SERVICES: readFact(source, 'SERVICES'),
  };

  const learnrise = resolveLearnrise();
  const openapi = readJson(path.join(learnrise, 'openapi.json'));
  const baseline = readJson(path.join(learnrise, 'scripts', 'test-baseline.json'));
  const composePath = path.join(learnrise, 'docker-compose.yml');

  const openapiPaths = Object.keys(openapi.paths || {}).length;
  const openapiOperations = Object.values(openapi.paths || {}).reduce(
    (sum, item) =>
      sum +
      Object.keys(item || {}).filter((key) =>
        HTTP_METHODS.has(key.toLowerCase()),
      ).length,
    0,
  );
  const services = countComposeServices(composePath);

  const checks = [
    {
      label: 'API_PATHS',
      expected: facts.API_PATHS,
      actual: openapiPaths,
      source: 'openapi.json paths',
    },
    {
      label: 'API_OPERATIONS',
      expected: facts.API_OPERATIONS,
      actual: openapiOperations,
      source: 'openapi.json operations (incl. HEAD)',
    },
    {
      label: 'TESTS_COLLECTED',
      expected: facts.TESTS_COLLECTED,
      actual: Number(baseline.collected),
      source: 'scripts/test-baseline.json collected',
    },
    {
      label: 'TESTS_PASSED',
      expected: facts.TESTS_PASSED,
      actual: Number(baseline.passed),
      source: 'scripts/test-baseline.json passed',
    },
    {
      label: 'TESTS_SKIPPED',
      expected: facts.TESTS_SKIPPED,
      actual: Number(baseline.skipped),
      source: 'scripts/test-baseline.json skipped',
    },
    {
      label: 'TESTS_FAILED',
      expected: facts.TESTS_FAILED,
      actual: Number(baseline.failed),
      source: 'scripts/test-baseline.json failed',
    },
    {
      label: 'SERVICES',
      expected: facts.SERVICES,
      actual: services.length,
      source: 'docker-compose.yml services',
    },
  ].map((check) => ({ ...check, pass: check.expected === check.actual }));

  const failed = checks.filter((check) => !check.pass);
  const result = {
    pass: failed.length === 0,
    facts: FACTS_PATH,
    learnrise,
    services,
    checks,
  };

  if (asJson) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write('check-facts\n');
    process.stdout.write(`  facts:     ${FACTS_PATH}\n`);
    process.stdout.write(`  learnrise: ${learnrise}\n`);
    for (const check of checks) {
      process.stdout.write(
        `  ${check.pass ? 'PASS' : 'FAIL'} ${check.label}: ` +
          `${check.actual} (${check.source}; facts ${check.expected})\n`,
      );
    }
    process.stdout.write(result.pass ? 'PASS\n' : 'FAIL\n');
  }

  return result.pass ? 0 : 1;
};

process.exit(main());
