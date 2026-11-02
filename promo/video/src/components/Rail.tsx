/**
 * Bottom ruler chrome. Decorative, never interactive.
 *
 * Height is exactly 52px so every film reserves the same strip; the whole rail
 * is capped at 0.55 opacity so it never competes with scene content.
 * Ticks land on whole seconds, major ticks on every section boundary
 * (`durationInFrames / fps / sections.length`), and the accent playhead reads
 * `frame / (durationInFrames - 1)` as a percentage.
 */

import {useCurrentFrame, useVideoConfig} from 'remotion';
import {FONT_FAMILIES} from '../fonts';
import {useLayout} from '../theme/layout';
import {tokens, type ThemeName} from '../theme/tokens';
import {textAudit} from './Typography';

const RAIL_HEIGHT_PX = 52;
const MAX_OPACITY = 0.55;
const DEFAULT_SECTIONS = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'] as const;

export const Rail: React.FC<{
  theme?: ThemeName;
  sections?: readonly string[];
  opacity?: number;
  durationInFrames?: number;
}> = ({
  theme = 'dark',
  sections = DEFAULT_SECTIONS,
  opacity: opacityProp = MAX_OPACITY,
  durationInFrames,
}) => {
  const frame = useCurrentFrame();
  const config = useVideoConfig();
  const total = durationInFrames ?? config.durationInFrames;
  const totalSeconds = total / config.fps;
  const sectionSeconds = totalSeconds / Math.max(1, sections.length);

  const percentAt = (seconds: number) =>
    totalSeconds > 0 ? (seconds / totalSeconds) * 100 : 0;
  const playhead = total > 1 ? (frame / (total - 1)) * 100 : 0;

  const boundaries = sections.map((_, index) => index * sectionSeconds);
  const isBoundary = (second: number) =>
    boundaries.some((boundary) => Math.abs(boundary - second) < 1e-6);

  const seconds: number[] = [];
  for (let second = 0; second <= Math.floor(totalSeconds); second += 1) {
    seconds.push(second);
  }

  const {palette, type, space, stroke} = tokens[theme];
  const layout = useLayout();

  return (
    <div
      data-audit-skip
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        height: layout.px(RAIL_HEIGHT_PX),
        opacity: Math.min(MAX_OPACITY, opacityProp),
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: stroke.hair,
          background: palette.stroke,
        }}
      />

      <div
        style={{
          position: 'absolute',
          left: layout.safe.side,
          right: layout.safe.side,
          top: 0,
          bottom: 0,
        }}
      >
        {seconds
          .filter((second) => !isBoundary(second))
          .map((second) => (
            <div
              key={`minor-${second}`}
              style={{
                position: 'absolute',
                left: `${percentAt(second)}%`,
                bottom: 0,
                width: stroke.hair,
                height: layout.gap(space.xs),
                background: palette.strokeSoft,
              }}
            />
          ))}

        {boundaries.map((boundary, index) => (
          <div
            key={`major-${index}`}
            style={{
              position: 'absolute',
              left: `${percentAt(boundary)}%`,
              bottom: 0,
              width: stroke.hair,
              height: layout.gap(space.sm),
              background: palette.stroke,
            }}
          />
        ))}

        {sections.map((label, index) => (
          <div
            key={`section-${index}`}
            {...textAudit(label)}
            style={{
              position: 'absolute',
              left: `${percentAt((index + 0.5) * sectionSeconds)}%`,
              transform: 'translateX(-50%)',
              top: layout.gap(space.xs),
              fontFamily: FONT_FAMILIES.mono,
              fontSize: layout.font(type.label),
              fontWeight: type.weight.regular,
              letterSpacing: `${type.tracking.wide}em`,
              color: palette.inkMuted,
              whiteSpace: 'nowrap',
            }}
          >
            {label}
          </div>
        ))}

        <div
          style={{
            position: 'absolute',
            left: `${playhead}%`,
            top: 0,
            bottom: 0,
            width: stroke.hair,
            background: palette.accent,
            boxShadow: `0 0 ${layout.gap(space.sm)}px ${palette.accent}`,
          }}
        />
      </div>
    </div>
  );
};
