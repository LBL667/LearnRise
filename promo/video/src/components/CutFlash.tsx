/**
 * Cut accent: a single hairline that sweeps the full frame height across the
 * ±`motion.cutFlash` window around a cut, peaking in opacity exactly at the cut.
 * Purely decorative — renders nothing outside the window.
 */

import {useCurrentFrame} from 'remotion';
import {tokens, type ThemeName} from '../theme/tokens';

const SWEEP_START_PERCENT = -4;
const SWEEP_END_PERCENT = 104;
const SWEEP_RANGE = SWEEP_END_PERCENT - SWEEP_START_PERCENT;

export const CutFlash: React.FC<{
  at: number;
  enabled?: boolean;
  theme?: ThemeName;
}> = ({at, enabled = true, theme = 'dark'}) => {
  const frame = useCurrentFrame();
  const {palette, stroke, motion, space} = tokens[theme];
  const span = motion.cutFlash;
  const distance = Math.abs(frame - at);

  if (!enabled || distance > span) {
    return null;
  }

  const progress = Math.max(0, Math.min(1, (frame - (at - span)) / (span * 2)));
  const left = SWEEP_START_PERCENT + progress * SWEEP_RANGE;
  const opacity = 1 - distance / span;

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: `${left}%`,
        width: stroke.hair,
        background: palette.accent,
        boxShadow: `0 0 ${space.md}px ${palette.accent}`,
        opacity,
        pointerEvents: 'none',
      }}
    />
  );
};
