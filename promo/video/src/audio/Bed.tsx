import type * as React from 'react';
import {
  Audio,
  Easing,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { tokens } from '../theme/tokens';

/**
 * One scene on the frozen film timeline.
 *
 * `from` and `durationInFrames` are frame counts, never seconds: the visual
 * timeline is 6 × 120 frames @30fps and ducking must not drift against it.
 */
export type BedScene = {
  /** First frame of the scene on the global timeline (0, 120, 240, …). */
  from: number;
  /** Scene length in frames (120 in the reference film). */
  durationInFrames: number;
  /**
   * How far the bed drops while this scene's narration is speaking, in dB.
   * Defaults to the narration level (-3 dB). Pass `0` for a scene with no
   * narration (e.g. a music-led outro) so the bed stays at full level.
   */
  duckDb?: number;
};

export type BedProps = {
  /** Scene metadata; the cut points are the scene `from` values. */
  scenes: readonly BedScene[];
  /** Linear master trim applied after ducking. 1 = unity. Clamped to [0, 1]. */
  gain?: number;
  /** Override the bed file. Defaults to `staticFile('audio/bed.wav')`. */
  src?: string;
};

/**
 * Audio constants live beside the component because `tokens.ts` intentionally
 * has no audio group (T5 froze that file). The timing is still tokens-driven:
 * the bed's grid is tied to `canvas.fps` / `canvas.frames`.
 */
export const BED = {
  /** 120 BPM → 0.5 s per beat → 15 frames per beat at 30fps. */
  bpm: 120,
  beatSeconds: 0.5,
  barSeconds: 2,
  bars: 12,
  seconds: 24,
  fps: tokens.dark.canvas.fps,
  frames: tokens.dark.canvas.frames,
  /** Narration duck depth for a full scene. */
  narrationDuckDb: -3,
  /** Fully-lifted window around a cut, in frames (0.2 s @30fps). */
  cutLiftFrames: 6,
  /** Frames of easing on each side of the lift (half of the lift). */
  cutLiftRampFrames: 3,
} as const;

const FULL_DB = 0;
const MAX_DB = 0;

const dbToGain = (db: number): number => Math.pow(10, db / 20);

const duckOf = (scene: BedScene): number =>
  typeof scene.duckDb === 'number' ? scene.duckDb : BED.narrationDuckDb;

/**
 * Build the dB keyframes for the whole film.
 *
 * Shape: every scene sits at its narration level (`duckDb`, default -3 dB),
 * except for a 6-frame plateau that starts 3 frames before each cut and lifts
 * back to 0 dB, with 3-frame ramps on either side. The lift lets the bar-line
 * downbeat / impact land at full level before the next narration starts.
 */
export const buildBedEnvelope = (
  scenes: readonly BedScene[],
  durationInFrames: number,
): { frames: number[]; db: number[] } => {
  const lastFrame = Math.max(1, Math.round(durationInFrames) - 1);
  const ordered = scenes
    .filter(
      (scene) =>
        Number.isFinite(scene.from) && Number.isFinite(scene.durationInFrames),
    )
    .slice()
    .sort((a, b) => a.from - b.from);

  const frames: number[] = [];
  const db: number[] = [];

  const push = (frame: number, value: number): void => {
    const f = Math.min(Math.max(Math.round(frame), 0), lastFrame);
    const v = Math.min(MAX_DB, Math.max(-60, value));
    if (frames.length > 0 && f < frames[frames.length - 1]) {
      return; // scenes shorter than the lift window cannot reorder keys
    }
    if (frames.length > 0 && f === frames[frames.length - 1]) {
      db[db.length - 1] = v;
      return;
    }
    frames.push(f);
    db.push(v);
  };

  if (ordered.length === 0) {
    push(0, FULL_DB);
    push(lastFrame, FULL_DB);
    return { frames, db };
  }

  push(0, duckOf(ordered[0]));

  const half = Math.max(1, Math.floor(BED.cutLiftFrames / 2));
  const ramp = Math.max(0, Math.round(BED.cutLiftRampFrames));

  for (let i = 1; i < ordered.length; i += 1) {
    const cut = ordered[i].from;
    const previous = duckOf(ordered[i - 1]);
    const next = duckOf(ordered[i]);

    push(cut - half - ramp, previous);
    push(cut - half, FULL_DB);
    push(cut + half - 1, FULL_DB);
    push(cut + half - 1 + ramp, next);
  }

  push(lastFrame, duckOf(ordered[ordered.length - 1]));

  if (frames.length === 1) {
    push(lastFrame, db[0]);
  }

  return { frames, db };
};

/**
 * The music bed. Volume is computed purely from `useCurrentFrame()` against
 * the envelope above; there is no clock, no random value, and no setState, so
 * a still render and a video render agree at every frame.
 */
export const Bed: React.FC<BedProps> = ({ scenes, gain = 1, src }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const envelope = buildBedEnvelope(scenes, durationInFrames);

  const db = interpolate(frame, envelope.frames, envelope.db, {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.inOut(Easing.quad),
  });

  const volume = Math.min(1, Math.max(0, dbToGain(db) * gain));

  return <Audio src={src ?? staticFile('audio/bed.wav')} volume={volume} />;
};
