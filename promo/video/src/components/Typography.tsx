/**
 * Typography primitives — migrated from the verified DAW promo rendering.
 *
 * AUDIT CONTRACT (consumed by the T20 audit gate):
 * - Every element that renders text MUST carry `data-audit="text"` and
 *   `data-chars="<Unicode codepoint count>"` (string, not a JS `.length`
 *   surrogate count — emoji and astral CJK count once). Use `textAudit(text)`
 *   and spread it onto the element; never hand-write the attributes.
 * - Every element that renders an image MUST carry
 *   `data-asset-natural-width="<native pixel width of the source file>"`, so
 *   the gate can compute display ÷ native without guessing. (No images in
 *   this file — the contract is documented here because Typography is the
 *   primitive layer every scene imports.)
 * - Font sizes must come from `tokens[theme].type` (hard floor 20px); colours
 *   from `tokens[theme].palette`; frame durations from `tokens[theme].motion`.
 *
 * Components read only `tokens` + props. They never import a storyboard or
 * `video.config.ts`, and they carry no copy of their own.
 */

import type {CSSProperties, FC, ReactNode} from 'react';
import {interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import {FONT_FAMILIES} from '../fonts';
import {useLayout} from '../theme/layout';
import {tokens, type ThemeName} from '../theme/tokens';
import {clamp01, useEnter, useLinear} from '../lib/anim';

export type TextAudit = {'data-audit': 'text'; 'data-chars': string};

export const textAudit = (text: string): TextAudit => ({
  'data-audit': 'text',
  'data-chars': String(Array.from(text).length),
});

type Themed = {theme?: ThemeName};

/* Decorative geometry (not colours, type sizes, or durations) — kept literal. */
const DOT_SIZE_PX = 11;
const DOT_GLOW_PX = 18;
const KICKER_RULE_PX = 260;
const HALO_PX = 14;

export const Kicker: FC<Themed & {text: string; delay?: number; accent?: string}> = ({
  text,
  delay = 0,
  accent: accentProp,
  theme = 'dark',
}) => {
  const set = tokens[theme];
  const {palette, type, space, motion} = set;
  const layout = useLayout();
  const accent = accentProp ?? palette.accent;
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const appear = useEnter(delay, motion.enter);
  const rule = useLinear(delay + motion.stagger, delay + motion.enter + motion.exit);
  const dotPulse = 0.75 + 0.25 * Math.sin(frame / (fps * 0.6));

  return (
    <div style={{display: 'flex', alignItems: 'center', gap: layout.gap(space.md)}}>
      <div
        style={{
          width: layout.px(DOT_SIZE_PX),
          height: layout.px(DOT_SIZE_PX),
          background: accent,
          transform: `scale(${appear})`,
          boxShadow: `0 0 ${layout.px(DOT_GLOW_PX) * dotPulse}px ${accent}`,
          opacity: dotPulse,
        }}
      />
      <div
        {...textAudit(text)}
        style={{
          fontFamily: FONT_FAMILIES.mono,
          fontSize: layout.font(type.label),
          fontWeight: type.weight.medium,
          letterSpacing: `${type.tracking.wider}em`,
          color: palette.inkMuted,
          opacity: appear,
          whiteSpace: 'nowrap',
        }}
      >
        {text}
      </div>
      <div
        style={{
          width: layout.px(KICKER_RULE_PX) * rule,
          height: set.stroke.hair,
          background: `linear-gradient(90deg, ${palette.stroke}, transparent)`,
        }}
      />
    </div>
  );
};

export const LineReveal: FC<
  Themed & {delay?: number; style?: CSSProperties; children: ReactNode}
> = ({delay = 0, style, children, theme = 'dark'}) => {
  const p = useEnter(delay, tokens[theme].motion.enter, 240);
  return (
    <div style={{overflow: 'hidden', paddingBottom: '0.16em', marginBottom: '-0.16em'}}>
      <div
        style={{
          transform: `translateY(${(1 - p) * 106}%)`,
          opacity: Math.min(1, p * 1.8),
          ...style,
        }}
      >
        {children}
      </div>
    </div>
  );
};

export const Fade: FC<
  Themed & {
    delay?: number;
    duration?: number;
    y?: number;
    style?: CSSProperties;
    children: ReactNode;
  }
> = ({delay = 0, duration, y = 18, style, children, theme = 'dark'}) => {
  const layout = useLayout();
  const p = useEnter(delay, duration ?? tokens[theme].motion.enter);
  return (
    <div
      style={{
        opacity: clamp01(p * 1.4),
        transform: `translateY(${(1 - p) * layout.px(y)}px)`,
        ...style,
      }}
    >
      {children}
    </div>
  );
};

export const Rule: FC<Themed & {delay?: number; width?: number; color?: string}> = ({
  delay = 0,
  width = 520,
  color: colorProp,
  theme = 'dark',
}) => {
  const set = tokens[theme];
  const layout = useLayout();
  const color = colorProp ?? set.palette.stroke;
  const p = useLinear(delay, delay + set.motion.enter);
  return <div style={{width: layout.px(width) * p, height: set.stroke.hair, background: color}} />;
};

export const Exit: FC<Themed & {at: number; duration?: number; children: ReactNode}> = ({
  at,
  duration,
  children,
  theme = 'dark',
}) => {
  const frame = useCurrentFrame();
  const span = duration ?? tokens[theme].motion.exit;
  const o = clamp01(
    1 -
      interpolate(frame, [at, at + span], [0, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      }),
  );
  return <div style={{opacity: o}}>{children}</div>;
};

export const Dot: FC<{color: string; size?: number; glow?: boolean}> = ({
  color,
  size = 10,
  glow = true,
}) => {
  const layout = useLayout();
  return (
    <div
      style={{
        width: layout.px(size),
        height: layout.px(size),
        borderRadius: '50%',
        background: color,
        boxShadow: glow ? `0 0 ${layout.px(HALO_PX)}px ${color}` : undefined,
      }}
    />
  );
};
