/**
 * Animated backdrop layer: gradient mesh, drifting grid, accent glows, film
 * grain, vignette and an accent border.
 *
 * Colour contract: every colour comes from `tokens[theme].palette` (the
 * optional `accent` prop defaults to `palette.accent`). Only the things that
 * are deliberately theme-independent stay literal — glow blur radius, vignette
 * alpha, drift speed and mask percentages. The noise layer is theme-aware:
 * `screen` is invisible on the off-white palette, so light switches to
 * `multiply` at a higher opacity (see `NOISE` tuning below).
 */

import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {useLayout} from '../theme/layout';
import {tokens, type ThemeName} from '../theme/tokens';

const NOISE_SVG = encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/><feColorMatrix type='saturate' values='0'/></filter><rect width='180' height='180' filter='url(#n)' opacity='0.55'/></svg>`,
);

/**
 * The grain is the only whole-frame motion after an entrance settles, and
 * freezedetect (`n=0.003`, 1 s window) runs on the *decoded* stream: `screen`
 * over `#05070C` preserves fine grain, while over the off-white `#F6F7FB` it is
 * almost white and the encoder flattens it. Light therefore multiplies (visible
 * on a bright surface).
 *
 * Amplitude is a measured function of BOTH theme and canvas, not taste:
 *  - `wide` keeps the historical dark calibration (0.08) so the golden frames
 *    decoded from the delivered 1920x1080 film stay comparable.
 *  - Narrow specs at `scale = 0.5625` encode the same 24 s with a smaller
 *    canvas / bitrate budget, so x264 quantises the grain away and the
 *    post-entrance hold trips freezedetect unless the amplitude is raised.
 *    Slice renders (`--frames=120-239` / `240-359`) measured the boundary:
 *    square-light still freezes at multiply 0.32 and clears at 0.40; dark
 *    clears at screen 0.16. Those are the values below.
 */
const NOISE = {
  dark: {
    blend: 'screen' as const,
    wide: 0.08,
    narrow: 0.16,
  },
  light: {
    blend: 'multiply' as const,
    wide: 0.2,
    narrow: 0.4,
  },
};

/* Theme-independent constants (explicitly allowed to stay literal). */
const GRID_DRIFT_PX_PER_FRAME = 1;
const GLOW_BLUR_PX = 30;
const GLOW_PULSE_FRAMES = 34;
const NOISE_DRIFT_X_PX_PER_FRAME = 3;
const NOISE_DRIFT_Y_PX_PER_FRAME = 2;
const NOISE_TILE_PX = 180;
const VIGNETTE_EDGE = 0.9;
const EDGE_GLOW_BLUR_PX = 180;
const GRID_MASK =
  'radial-gradient(ellipse 85% 75% at 50% 45%, #000 25%, transparent 78%)';
const VIGNETTE_MASK =
  'radial-gradient(ellipse 70% 60% at 50% 45%, transparent 30%,';

export type Glow = {x: number; y: number; r: number; color: string; opacity?: number};

/** `#rrggbb` token + 0–1 alpha → 8-digit hex. Palette values are hex. */
const withAlpha = (hex: string, alpha: number): string => {
  const clamped = Math.max(0, Math.min(1, alpha));
  return `${hex}${Math.round(clamped * 255)
    .toString(16)
    .padStart(2, '0')}`;
};

export const Backdrop: React.FC<{
  theme?: ThemeName;
  accent?: string;
  grid?: boolean;
  glow?: Glow[];
  vignette?: number;
}> = ({
  theme = 'dark',
  accent: accentProp,
  grid = true,
  glow = [],
  vignette = VIGNETTE_EDGE,
}) => {
  const {palette, space, stroke} = tokens[theme];
  const accent = accentProp ?? palette.accent;
  const frame = useCurrentFrame();
  const drift = (frame * GRID_DRIFT_PX_PER_FRAME) % space.grid;
  const pulse = 0.6 + 0.4 * Math.sin(frame / GLOW_PULSE_FRAMES);
  const grainX = (frame * NOISE_DRIFT_X_PX_PER_FRAME) % NOISE_TILE_PX;
  const grainY = (frame * NOISE_DRIFT_Y_PX_PER_FRAME) % NOISE_TILE_PX;
  const noise = NOISE[theme];
  const layout = useLayout();
  const noiseOpacity = layout.scale < 1 ? noise.narrow : noise.wide;

  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(160deg, ${palette.bgAlt} 0%, ${palette.bg} 55%, ${palette.bg} 100%)`,
      }}
    >
      <AbsoluteFill style={{background: palette.surfaceStrong}} />
      {grid ? (
        <AbsoluteFill
          style={{
            backgroundImage: `linear-gradient(to right, ${palette.stroke} ${stroke.thin}px, transparent ${stroke.thin}px), linear-gradient(to bottom, ${palette.stroke} ${stroke.thin}px, transparent ${stroke.thin}px)`,
            backgroundSize: `${space.grid}px ${space.grid}px`,
            backgroundPosition: `${drift}px ${drift * 0.4}px`,
            maskImage: GRID_MASK,
            WebkitMaskImage: GRID_MASK,
            opacity: 0.85,
          }}
        />
      ) : null}

      {glow.map((g, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            left: g.x - g.r / 2,
            top: g.y - g.r / 2,
            width: g.r,
            height: g.r,
            borderRadius: '50%',
            background: `radial-gradient(circle, ${g.color} 0%, transparent 68%)`,
            opacity: (g.opacity ?? 0.5) * pulse,
            filter: `blur(${GLOW_BLUR_PX}px)`,
          }}
        />
      ))}

      <AbsoluteFill
        style={{
          background: `${VIGNETTE_MASK} ${withAlpha(palette.bg, vignette)} 100%)`,
        }}
      />
      <AbsoluteFill
        style={{
          backgroundImage: `url("data:image/svg+xml,${NOISE_SVG}")`,
          backgroundPosition: `${grainX}px ${grainY}px`,
          opacity: noiseOpacity,
          mixBlendMode: noise.blend,
          pointerEvents: 'none',
        }}
      />
      <AbsoluteFill
        style={{
          border: `${stroke.hair}px solid ${withAlpha(accent, 0.08)}`,
          boxShadow: `inset 0 0 ${EDGE_GLOW_BLUR_PX}px ${withAlpha(accent, 0.06)}`,
          pointerEvents: 'none',
        }}
      />
    </AbsoluteFill>
  );
};
