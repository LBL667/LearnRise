import {interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {tokens} from '../theme/tokens';

export const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export const useEnter = (
  delay = 0,
  durationInFrames: number = tokens.dark.motion.enter,
  damping = 200,
) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  return spring({
    frame: frame - delay,
    fps,
    config: {damping, mass: 0.7, stiffness: 120},
    durationInFrames,
  });
};

export const useLinear = (from: number, to: number) => {
  const frame = useCurrentFrame();
  return clamp01(interpolate(frame, [from, to], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  }));
};

export const useExit = (at: number, duration: number = tokens.dark.motion.exit) => {
  const frame = useCurrentFrame();
  return clamp01(interpolate(frame, [at, at + duration], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  }));
};

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
export const easeInOutCubic = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
