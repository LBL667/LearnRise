/**
 * Layout — the single scale law for multi-spec films.
 *
 * Reference frame: 1920×1080 (`wide`). Everything authored for that frame is
 * laid out in design pixels; every other spec re-derives it with
 *
 *     scale = Math.min(width / 1920, height / 1080)
 *
 * which is exactly 1 for `wide`, 0.5625 for both `tall` (1080×1920) and
 * `square` (1080×1080). Scenes never hardcode a pixel: they call `px()`,
 * `font()` and `gap()`, so the wide output stays algebraically identical
 * (`px(x) === x` when `scale === 1`) while the narrow specs shrink to fit.
 *
 * `font()` clamps to the token floor (`limits.fontFloorPx`, 20px). At 0.5625 a
 * 20px label would fall to 11.25px — the audit gate would reject it, and so
 * would a reader. Legibility wins over uniform shrinkage, and the clamp is the
 * only documented exception to "scale everything".
 *
 * `stacked` is the *visual language* switch, not a size: cards become a column,
 * the S3 terminal sits above its claim, and the S2 UI wall is dropped rather
 * than squeezed. It is true for both narrow specs.
 *
 * `bands` mirrors the safe-area fractions the audit probe measures against.
 * `wide` keeps the token fractions verbatim (0.10 / 0.05 / 0.15); narrow specs
 * reserve 12% top and bottom, per the layout matrix.
 */

import {createContext, useContext} from 'react';
import {tokens} from './tokens';

export type LayoutName = 'wide' | 'tall' | 'square';

export const LAYOUT_NAMES: readonly LayoutName[] = ['wide', 'tall', 'square'];

export type SafeBands = {
  readonly title: number;
  readonly action: number;
  readonly subtitle: number;
};

export type Layout = {
  readonly name: LayoutName;
  readonly width: number;
  readonly height: number;
    readonly scale: number;
  readonly safe: {
    readonly top: number;
    readonly bottom: number;
    readonly side: number;
    readonly gutter: number;
  };
    readonly bands: SafeBands;
    readonly stacked: boolean;
    readonly px: (value: number) => number;
    readonly font: (value: number) => number;
    readonly gap: (value: number) => number;
};

/** Token floor, mirrored here because `Layout` is theme-independent. */
const FONT_FLOOR_PX = tokens.dark.limits.fontFloorPx;

const WIDE_FRAME = {width: 1920, height: 1080} as const;

const FRAMES: Record<LayoutName, {width: number; height: number}> = {
  wide: WIDE_FRAME,
  tall: {width: 1080, height: 1920},
  square: {width: 1080, height: 1080},
};

const WIDE_BANDS: SafeBands = {
  title: tokens.dark.safe.title,
  action: tokens.dark.safe.action,
  subtitle: tokens.dark.safe.subtitle,
};

const NARROW_BAND = 0.12;

const buildLayout = (name: LayoutName): Layout => {
  const {width, height} = FRAMES[name];
  const scale = Math.min(width / WIDE_FRAME.width, height / WIDE_FRAME.height);

  if (name === 'wide') {
    const {px: widePx} = tokens.dark.safe;
    return {
      name,
      width,
      height,
      scale,
      safe: {
        top: widePx.title,
        bottom: widePx.action,
        side: widePx.side,
        gutter: widePx.gutter,
      },
      bands: WIDE_BANDS,
      stacked: false,
      px: (value) => value,
      font: (value) => Math.max(FONT_FLOOR_PX, value),
      gap: (value) => value,
    };
  }

  const px = (value: number) => Math.round(value * scale);
  const bandPx = Math.round(NARROW_BAND * height);

  return {
    name,
    width,
    height,
    scale,
    safe: {
      top: bandPx,
      bottom: bandPx,
      side: px(tokens.dark.safe.px.side),
      gutter: px(tokens.dark.safe.px.gutter),
    },
    bands: {
      title: NARROW_BAND,
      action: NARROW_BAND,
      subtitle: NARROW_BAND,
    },
    stacked: true,
    px,
    font: (value) => Math.max(FONT_FLOOR_PX, Math.round(value * scale)),
    gap: px,
  };
};

const CACHE: Record<LayoutName, Layout> = {
  wide: buildLayout('wide'),
  tall: buildLayout('tall'),
  square: buildLayout('square'),
};

export const layoutFor = (name: LayoutName): Layout => CACHE[name];

export const layoutFromFrame = (width: number, height: number): Layout => {
  if (height > width) return CACHE.tall;
  if (height >= width) return CACHE.square;
  return CACHE.wide;
};

export const LayoutContext = createContext<Layout>(CACHE.wide);

export const useLayout = (): Layout => useContext(LayoutContext);
