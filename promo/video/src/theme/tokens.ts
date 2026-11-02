const type = {
  /** Display sizes (px @1080p). Floor for any on-screen text is 20px. */
  display1: 132,
  display2: 96,
  display3: 64,
  head: 40,
  body: 28,
  label: 20,
  weight: { regular: 400, medium: 500, bold: 700, black: 900 },
  /** Letter spacing in em. Negative values are for Latin display only. */
  tracking: { tight: -0.02, normal: 0, wide: 0.06, wider: 0.12 },
  /** Line height multiplier. */
  leading: { tight: 0.95, snug: 1.1, normal: 1.35, loose: 1.55 },
  /** Hard floor enforced by the audit gate. */
  floor: 20,
} as const;

const space = {
  /** 8px base rhythm. */
  base: 8,
  /** One layout grid cell. */
  grid: 96,
  scale: [0, 8, 16, 24, 32, 40, 48, 64, 96, 128],
  none: 0,
  xs: 8,
  sm: 16,
  md: 24,
  lg: 32,
  xl: 40,
  xxl: 48,
  xxxl: 64,
  huge: 96,
  max: 128,
} as const;

const safe = {
  /** Fractions of the frame edge reserved for each band. */
  title: 0.1,
  action: 0.05,
  subtitle: 0.15,
  /** Resolved pixel insets for the default 1920×1080 frame. */
  px: {
    title: 108,
    action: 54,
    subtitle: 162,
    side: 192,
    gutter: 96,
  },
  frame: { width: 1920, height: 1080 },
} as const;

const radius = { sm: 8, md: 16, lg: 28, pill: 999 } as const;

const stroke = { hair: 1, thin: 2, thick: 4 } as const;

const motion = {
  /** Frames @30fps. 26f = 0.867s, 12f = 0.4s, 8f = 0.267s. */
  enter: 26,
  exit: 12,
  cutFlash: 8,
  stagger: 4,
} as const;

const asset = {
  /** Display width ÷ native pixel width. Above 1.0 the image is upscaled. */
  maxUpscale: 1.0,
  /** Upscaling past this ratio is a hard failure for the audit gate. */
  warnUpscale: 1.15,
  /** Inset ceiling imposed by the real capture set; never exceed it. */
  maxInsetWidthPx: 608,
  maxInsetHeightPx: 738,
  capture: {
    /** Capture at 2× device pixel ratio when possible, never below 1×. */
    preferDpr: 2,
    minDpr: 1,
    /** Captured pixel width must cover the intended display size. */
    minScaleOfTarget: 1,
  },
} as const;

const canvas = { width: 1920, height: 1080, fps: 30, frames: 6720 } as const;

const limits = {
  fontFloorPx: 20,
  maxCharsPerSecond: 14,
  /** 80% of 1920 — the widest line a display size may occupy. */
  maxTextWidthPx: 1536,
  minBodyContrast: 4.5,
  minLargeTextContrast: 3,
} as const;

const darkPalette = {
  bg: '#05070C',
  bgAlt: '#0A0F18',
  surface: 'rgba(255,255,255,0.032)',
  surfaceStrong: 'rgba(255,255,255,0.06)',
  stroke: 'rgba(255,255,255,0.09)',
  strokeSoft: 'rgba(255,255,255,0.05)',
  ink: '#E9EEF8',
  inkMuted: '#73829D',
  inkFaint: '#3A465B',
  accent: '#4EA1FF',
  accentAlt: '#5CF2C0',
  warn: '#FFB26B',
  onAccent: '#07111F',
  /** Text-safe variants; fill tokens above never carry body copy. */
  accentText: '#7CC0FF',
  accentAltText: '#7FF7D3',
  warnText: '#FFC894',
} as const;

const lightPalette = {
  bg: '#F6F7FB',
  bgAlt: '#ECF0F7',
  surface: '#FFFFFF',
  surfaceStrong: '#E3E9F3',
  stroke: 'rgba(17,26,45,0.16)',
  strokeSoft: 'rgba(17,26,45,0.08)',
  ink: '#0C1524',
  inkMuted: '#45536B',
  inkFaint: '#5F6E87',
  accent: '#4EA1FF',
  accentAlt: '#5CF2C0',
  warn: '#FFB26B',
  onAccent: '#07111F',
  accentText: '#0B63C7',
  accentAltText: '#067A5C',
  warnText: '#9A5210',
} as const;

const dark = {
  palette: darkPalette,
  type,
  space,
  safe,
  radius,
  stroke,
  motion,
  asset,
  canvas,
  limits,
} as const;

const light = {
  palette: lightPalette,
  type,
  space,
  safe,
  radius,
  stroke,
  motion,
  asset,
  canvas,
  limits,
} as const;

/** Deeply widened shape so a theme may change values but never keys. */
type Widen<T> = T extends string
  ? string
  : T extends number
    ? number
    : T extends readonly (infer U)[]
      ? readonly Widen<U>[]
      : { readonly [K in keyof T]: Widen<T[K]> };

export type ThemeName = 'dark' | 'light';
/** Top-level token group name (palette, type, space, safe, ...). */
export type TokenName = keyof typeof dark;
export type TokenSet = Widen<typeof dark>;
export type PaletteName = keyof typeof dark.palette;
export type TypeName = keyof typeof dark.type;

/** Compile-time guarantee that both themes expose identical keys. */
export const tokens = { dark, light } as const satisfies Record<ThemeName, TokenSet>;

export const THEME_NAMES = ['dark', 'light'] as const satisfies readonly ThemeName[];

export type ThemePreset = (typeof tokens)[ThemeName];
