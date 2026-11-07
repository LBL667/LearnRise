/**
 * LearnRise fact baseline — every on-screen number comes from here.
 *
 * These are verifiable claims about the LearnRise repository, not style
 * choices. `npm run check-facts` reconciles them with:
 *
 *   API_PATHS / API_OPERATIONS  -> LearnRise/openapi.json
 *   TESTS_*                     -> LearnRise/scripts/test-baseline.json
 *   SERVICES                    -> LearnRise/docker-compose.yml
 *
 * `API_OPERATIONS` counts every HTTP method in the OpenAPI document,
 * including the single `head` operation (77 = 76 + HEAD).
 *
 * A stale number is a factual bug: fix this file only after the repository
 * baseline actually changed, then run `npm run check-facts`.
 */

export const API_PATHS = 66;
export const API_OPERATIONS = 77;
export const TESTS_COLLECTED = 498;
export const TESTS_PASSED = 490;
export const TESTS_SKIPPED = 8;
export const TESTS_FAILED = 0;
export const SERVICES = 6;

/** Stack line used by the outro. */
export const STACK_LINE = 'FastAPI · React · PostgreSQL/pgvector · Docker';

/** Service names in `LearnRise/docker-compose.yml`, in compose order. */
export const SERVICE_NAMES = [
  'db',
  'minio',
  'backend',
  'ocr-service',
  'frontend',
  'nginx',
] as const;

export const FACTS = {
  apiPaths: API_PATHS,
  apiOperations: API_OPERATIONS,
  testsCollected: TESTS_COLLECTED,
  testsPassed: TESTS_PASSED,
  testsSkipped: TESTS_SKIPPED,
  testsFailed: TESTS_FAILED,
  services: SERVICES,
} as const;
