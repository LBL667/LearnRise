/**
 * Storyboard schema v1 — the long-lived, engine-agnostic film contract.
 *
 * Deliberately dependency-free (no zod/ajv): the skill directory must never
 * contain node_modules, so this module ships its own runtime validator with
 * zod-quality, field-level error messages.
 *
 * Domain words (bpm, bar, command, midi, pattern, ...) are only ever legal
 * inside `scene.content` values. They must never become schema field names.
 */

import { tokens } from '../theme/tokens';

/** A runtime-checked storyboard. `checks` is always present after validation. */
export interface StoryboardMeta {
  slug: string;
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
}

export interface StoryboardAudio {
  /** Path (relative to the project public dir) or URL of the score. */
  src: string;
  /** Linear gain applied to the bed, 0..n. */
  gain: number;
  /** Duck depth for narration/SFX, 0..1 (1 = no duck). */
  duckTo: number;
}

export interface StoryboardAsset {
  id?: string;
  /** Path (relative to the project public dir) or URL of the asset. */
  src: string;
  kind?: string;
  nativeWidth?: number;
  nativeHeight?: number;
  /** Asset metadata is free-form and never interpreted by the schema. */
  [key: string]: unknown;
}

export interface StoryboardScene {
  /** Unique within the film; stable across edits (used by audits/evals). */
  id: string;
  primitive: Primitive;
  /** Absolute frame where this scene starts. Must equal the sum of prior durations. */
  from: number;
  durationInFrames: number;
  /** Free-form bag. All domain language belongs here (and only here). */
  content: Record<string, unknown>;
  assets: StoryboardAsset[];
}

export interface StoryboardChecks {
  minsFontPx: number;
  maxUpscale: number;
  maxCharsPerSecond: number;
}

/** Input shape: `checks` is optional and may be partial (defaults are filled). */
export interface StoryboardInput {
  meta: StoryboardMeta;
  theme: ThemeName;
  audio: StoryboardAudio;
  scenes: StoryboardScene[];
  checks?: Partial<StoryboardChecks>;
}

export interface Storyboard {
  meta: StoryboardMeta;
  theme: ThemeName;
  audio: StoryboardAudio;
  scenes: StoryboardScene[];
  checks: StoryboardChecks;
}

export const THEME_NAMES = ['dark', 'light'] as const;
export type ThemeName = (typeof THEME_NAMES)[number];

/**
 * v1 has exactly one primitive: inline "custom" scenes. Extend only after the
 * T19 extraction proves a second primitive is actually needed.
 */
export const PRIMITIVES = ['custom'] as const;
export type Primitive = (typeof PRIMITIVES)[number];

/** Remotion's accepted composition frame rates for this skill. */
export const FPS_VALUES = [24, 25, 30, 50, 60] as const;

/** Defaults mirror `template/src/theme/tokens.ts`; never invent new gates. */
export const CHECK_DEFAULTS: StoryboardChecks = {
  minsFontPx: tokens.dark.limits.fontFloorPx,
  maxUpscale: tokens.dark.asset.warnUpscale,
  maxCharsPerSecond: tokens.dark.limits.maxCharsPerSecond,
};

export interface ValidationError {
  /** Dotted path, e.g. `meta.durationInFrames` or `scenes[2].content`. */
  path: string;
  message: string;
}

export type ValidationResult =
  | { ok: true; data: Storyboard }
  | { ok: false; errors: ValidationError[] };

/**
 * Schema key names that are reserved for the subject matter of one film.
 * They may appear inside content values, never as field names.
 */
const DOMAIN_TERM =
  /^(bpm|bar|bars|midi|command|commands|pattern|playlist|daw)$/i;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  );
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function joinPath(base: string, key: string): string {
  return base === '' ? key : `${base}.${key}`;
}

/**
 * Lint only *schema* key names. `content` is intentionally not descended into:
 * its values are where chips, MIDI, commands and patterns are allowed to live.
 */
function lintDomainKeys(
  value: Record<string, unknown>,
  path: string,
  errors: ValidationError[],
  skipKeys: readonly string[] = [],
): void {
  for (const key of Object.keys(value)) {
    if (skipKeys.includes(key)) continue;
    if (DOMAIN_TERM.test(key)) {
      errors.push({
        path: joinPath(path, key),
        message: 'domain term in schema',
      });
    }
  }
}

function addRequired(
  errors: ValidationError[],
  path: string,
): void {
  errors.push({ path, message: 'required' });
}

function addExpected(
  errors: ValidationError[],
  path: string,
  expectation: string,
): void {
  errors.push({ path, message: `expected ${expectation}` });
}

/**
 * Validate an untrusted storyboard. Pure function; no clock, randomness or I/O.
 */
export function validateStoryboard(value: unknown): ValidationResult {
  const errors: ValidationError[] = [];

  if (!isPlainObject(value)) {
    return {
      ok: false,
      errors: [{ path: '$', message: 'expected an object' }],
    };
  }

  // Domain lint runs first so a leaky field is always reported even when the
  // surrounding shape is also wrong.
  lintDomainKeys(value, '', errors);

  const meta = value.meta;
  let slug: string | undefined;
  let width: number | undefined;
  let height: number | undefined;
  let fps: number | undefined;
  let durationInFrames: number | undefined;

  if (!isPlainObject(meta)) {
    addRequired(errors, 'meta');
  } else {
    lintDomainKeys(meta, 'meta', errors);

    if (meta.slug === undefined) {
      addRequired(errors, 'meta.slug');
    } else if (typeof meta.slug !== 'string' || meta.slug.trim() === '') {
      addExpected(errors, 'meta.slug', 'a non-empty string');
    } else {
      slug = meta.slug;
    }

    if (meta.width === undefined) {
      addRequired(errors, 'meta.width');
    } else if (!isPositiveInteger(meta.width)) {
      addExpected(errors, 'meta.width', 'a positive integer');
    } else {
      width = meta.width;
    }

    if (meta.height === undefined) {
      addRequired(errors, 'meta.height');
    } else if (!isPositiveInteger(meta.height)) {
      addExpected(errors, 'meta.height', 'a positive integer');
    } else {
      height = meta.height;
    }

    if (meta.fps === undefined) {
      addRequired(errors, 'meta.fps');
    } else if (
      typeof meta.fps !== 'number' ||
      !(FPS_VALUES as readonly number[]).includes(meta.fps)
    ) {
      addExpected(errors, 'meta.fps', FPS_VALUES.join(', '));
    } else {
      fps = meta.fps;
    }

    if (meta.durationInFrames === undefined) {
      addRequired(errors, 'meta.durationInFrames');
    } else if (!isPositiveInteger(meta.durationInFrames)) {
      addExpected(errors, 'meta.durationInFrames', 'a positive integer');
    } else {
      durationInFrames = meta.durationInFrames;
    }
  }

  let theme: ThemeName | undefined;
  if (value.theme === undefined) {
    addRequired(errors, 'theme');
  } else if (
    typeof value.theme !== 'string' ||
    !(THEME_NAMES as readonly string[]).includes(value.theme)
  ) {
    addExpected(errors, 'theme', '"dark" or "light"');
  } else {
    theme = value.theme as ThemeName;
  }

    const audio = value.audio;
  let audioSrc: string | undefined;
  let audioGain: number | undefined;
  let audioDuckTo: number | undefined;

  if (!isPlainObject(audio)) {
    addRequired(errors, 'audio');
  } else {
    lintDomainKeys(audio, 'audio', errors);

    if (audio.src === undefined) {
      addRequired(errors, 'audio.src');
    } else if (typeof audio.src !== 'string' || audio.src.trim() === '') {
      addExpected(errors, 'audio.src', 'a non-empty string');
    } else {
      audioSrc = audio.src;
    }

    if (audio.gain === undefined) {
      addRequired(errors, 'audio.gain');
    } else if (!isFiniteNumber(audio.gain) || audio.gain < 0) {
      addExpected(errors, 'audio.gain', 'a number >= 0');
    } else {
      audioGain = audio.gain;
    }

    if (audio.duckTo === undefined) {
      addRequired(errors, 'audio.duckTo');
    } else if (
      !isFiniteNumber(audio.duckTo) ||
      audio.duckTo < 0 ||
      audio.duckTo > 1
    ) {
      addExpected(errors, 'audio.duckTo', 'a number between 0 and 1');
    } else {
      audioDuckTo = audio.duckTo;
    }
  }

  const checksRaw = value.checks;
  const checks: StoryboardChecks = { ...CHECK_DEFAULTS };
  if (checksRaw !== undefined && !isPlainObject(checksRaw)) {
    addExpected(errors, 'checks', 'an object');
  } else if (isPlainObject(checksRaw)) {
    lintDomainKeys(checksRaw, 'checks', errors);
    for (const key of Object.keys(
      CHECK_DEFAULTS,
    ) as (keyof StoryboardChecks)[]) {
      const raw = checksRaw[key];
      if (raw === undefined) continue;
      if (!isFiniteNumber(raw) || raw <= 0) {
        addExpected(errors, `checks.${key}`, 'a positive number');
      } else {
        checks[key] = raw;
      }
    }
  }

  const scenesRaw = value.scenes;
  let sceneList: StoryboardScene[] = [];

  if (!Array.isArray(scenesRaw)) {
    addRequired(errors, 'scenes');
  } else if (scenesRaw.length === 0) {
    addExpected(errors, 'scenes', 'a non-empty array');
  } else {
    const ids = new Set<string>();
    let expectedFrom = 0;
    let timelineBroken = false;
    let timelinesComparable = true;
    let totalFrames = 0;

    scenesRaw.forEach((rawScene, index) => {
      const base = `scenes[${index}]`;
      if (!isPlainObject(rawScene)) {
        addExpected(errors, base, 'an object');
        timelineBroken = true;
        timelinesComparable = false;
        return;
      }

      // `content` is a free-form bag: its keys are NOT linted.
      lintDomainKeys(rawScene, base, errors, ['content', 'assets']);

      let id: string | undefined;
      if (rawScene.id === undefined) {
        addRequired(errors, `${base}.id`);
      } else if (
        typeof rawScene.id !== 'string' ||
        rawScene.id.trim() === ''
      ) {
        addExpected(errors, `${base}.id`, 'a non-empty string');
      } else {
        id = rawScene.id;
        if (ids.has(id)) {
          errors.push({
            path: `${base}.id`,
            message: `duplicate id "${id}"`,
          });
        }
        ids.add(id);
      }
      let primitive: Primitive | undefined;
      if (rawScene.primitive === undefined) {
        addRequired(errors, `${base}.primitive`);
      } else if (
        typeof rawScene.primitive !== 'string' ||
        !(PRIMITIVES as readonly string[]).includes(rawScene.primitive)
      ) {
        addExpected(
          errors,
          `${base}.primitive`,
          `${PRIMITIVES.map((p) => `"${p}"`).join(', ')} (v1 has a single primitive)`,
        );
      } else {
        primitive = rawScene.primitive as Primitive;
      }
      let from: number | undefined;
      if (rawScene.from === undefined) {
        addRequired(errors, `${base}.from`);
        timelineBroken = true;
      } else if (!isNonNegativeInteger(rawScene.from)) {
        addExpected(errors, `${base}.from`, 'a non-negative integer');
        timelineBroken = true;
      } else {
        from = rawScene.from;
        if (!timelineBroken && from !== expectedFrom) {
          errors.push({
            path: `${base}.from`,
            message: `expected ${expectedFrom} (scenes must be contiguous from 0)`,
          });
        }
      }
      let duration: number | undefined;
      if (rawScene.durationInFrames === undefined) {
        addRequired(errors, `${base}.durationInFrames`);
        timelinesComparable = false;
      } else if (!isPositiveInteger(rawScene.durationInFrames)) {
        addExpected(
          errors,
          `${base}.durationInFrames`,
          'a positive integer',
        );
        timelinesComparable = false;
      } else {
        duration = rawScene.durationInFrames;
        totalFrames += duration;
        expectedFrom += duration;
      }
      let content: Record<string, unknown> | undefined;
      if (rawScene.content === undefined) {
        addRequired(errors, `${base}.content`);
      } else if (!isPlainObject(rawScene.content)) {
        addExpected(errors, `${base}.content`, 'an object');
      } else {
        content = rawScene.content;
      }
      let assets: StoryboardAsset[] | undefined;
      if (rawScene.assets === undefined) {
        addRequired(errors, `${base}.assets`);
      } else if (!Array.isArray(rawScene.assets)) {
        addExpected(errors, `${base}.assets`, 'an array');
      } else {
        const validated: StoryboardAsset[] = [];
        rawScene.assets.forEach((rawAsset, assetIndex) => {
          const assetPath = `${base}.assets[${assetIndex}]`;
          if (!isPlainObject(rawAsset)) {
            addExpected(errors, assetPath, 'an object');
            return;
          }
          if (rawAsset.src === undefined) {
            addRequired(errors, `${assetPath}.src`);
            return;
          }
          if (
            typeof rawAsset.src !== 'string' ||
            rawAsset.src.trim() === ''
          ) {
            addExpected(errors, `${assetPath}.src`, 'a non-empty string');
            return;
          }
          if (
            rawAsset.id !== undefined &&
            (typeof rawAsset.id !== 'string' || rawAsset.id.trim() === '')
          ) {
            addExpected(errors, `${assetPath}.id`, 'a non-empty string');
          }
          if (
            rawAsset.nativeWidth !== undefined &&
            !isPositiveInteger(rawAsset.nativeWidth)
          ) {
            addExpected(errors, `${assetPath}.nativeWidth`, 'a positive integer');
          }
          if (
            rawAsset.nativeHeight !== undefined &&
            !isPositiveInteger(rawAsset.nativeHeight)
          ) {
            addExpected(
              errors,
              `${assetPath}.nativeHeight`,
              'a positive integer',
            );
          }
          if (
            rawAsset.kind !== undefined &&
            typeof rawAsset.kind !== 'string'
          ) {
            addExpected(errors, `${assetPath}.kind`, 'a string');
          }
          validated.push(rawAsset as StoryboardAsset);
        });
        assets = validated;
      }

      if (
        id !== undefined &&
        primitive !== undefined &&
        from !== undefined &&
        duration !== undefined &&
        content !== undefined &&
        assets !== undefined
      ) {
        sceneList.push({
          id,
          primitive,
          from,
          durationInFrames: duration,
          content,
          assets,
        });
      }
    });

    // Sum gate: only meaningful when every scene duration is a valid integer.
    if (
      timelinesComparable &&
      durationInFrames !== undefined &&
      totalFrames !== durationInFrames
    ) {
      errors.push({
        path: 'scenes',
        message: `total durationInFrames ${totalFrames} does not match meta.durationInFrames ${durationInFrames}`,
      });
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    data: {
      meta: {
        slug: slug as string,
        width: width as number,
        height: height as number,
        fps: fps as number,
        durationInFrames: durationInFrames as number,
      },
      theme: theme as ThemeName,
      audio: {
        src: audioSrc as string,
        gain: audioGain as number,
        duckTo: audioDuckTo as number,
      },
      scenes: sceneList,
      checks,
    },
  };
}
