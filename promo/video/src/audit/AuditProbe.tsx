/**
 * AuditProbe — DOM-level picture audit, driven by `renderStill` + `onBrowserLog`.
 *
 * Mounted by `Film` only when `audit` is truthy, so it never changes a normal
 * render. It walks every `[data-audit]` element (plus every asset carrying
 * `data-asset-natural-width`), builds a report and prints it as a single line:
 *
 *     AUDIT::{"failures":[...],"checks":{...},"frame":60}
 *
 * `scripts/audit.mjs` collects those lines from the browser console and turns
 * them into a gate. Elements inside `[data-audit-skip]` (decorative chrome such
 * as the ruler Rail) are ignored; so are image pixels, gradients and the
 * Backdrop — the contract only covers authored type and images.
 *
 * Failure codes (exact, stable): font_missing, text_overflow,
 * safe_area_violation, font_too_small, low_contrast, asset_upscale,
 * reading_speed, palette_drift.
 *
 * The handle is created during render (before the first commit) so the
 * renderer cannot capture the frame between mount and the audit effect;
 * `useEffect` then waits for fonts, measures layout and clears the handle.
 */

import React, {useEffect, useRef} from 'react';
import {continueRender, delayRender, useCurrentFrame, useVideoConfig} from 'remotion';
import {FONT_FACES} from '../fonts';
import type {Layout, SafeBands} from '../theme/layout';
import {layoutFor} from '../theme/layout';
import {
  tokens,
  type ThemeName,
  type TokenSet,
} from '../theme/tokens';

export type AuditFailureCode =
  | 'font_missing'
  | 'text_overflow'
  | 'safe_area_violation'
  | 'font_too_small'
  | 'low_contrast'
  | 'asset_upscale'
  | 'reading_speed'
  | 'palette_drift';

export type AuditReport = {
  failures: AuditFailureCode[];
  checks: {
    fonts: FontCheck[];
    overflow: OverflowCheck[];
    safeArea: SafeAreaCheck[];
    fontSizes: FontSizeCheck[];
    contrast: ContrastCheck[];
    upscale: UpscaleCheck[];
    readingSpeed: ReadingSpeedCheck[];
    palette: PaletteCheck[];
  };
  frame: number;
};

type FontCheck = {
  family: string;
  declared: boolean;
  check: boolean;
  loaded: boolean;
  ok: boolean;
};

type OverflowCheck = {
  label: string;
  parent: string;
  dx: number;
  dy: number;
  ok: boolean;
};

type SafeAreaCheck = {
  label: string;
  top: number;
  bottom: number;
  violation: 'title' | 'action' | 'subtitle' | null;
  ok: boolean;
};

type FontSizeCheck = {
  label: string;
  px: number;
  minPx: number;
  ok: boolean;
};

type ContrastCheck = {
  label: string;
  ratio: number;
  threshold: number;
  foreground: string;
  background: string;
  decorative: boolean;
  ok: boolean;
};

type UpscaleCheck = {
  label: string;
  naturalWidth: number;
  renderedWidth: number;
  ratio: number;
  ok: boolean;
  warning: boolean;
};

type ReadingSpeedCheck = {
  label: string;
  chars: number;
  seconds: number;
  charsPerSecond: number;
  max: number;
  ok: boolean;
};

type PaletteCheck = {
  label: string;
  color: string;
  nearest: string;
  deltaE: number;
  ok: boolean;
};

type RGBA = {r: number; g: number; b: number; a: number};

const SKIP_SELECTOR = '[data-audit-skip]';
const TOLERANCE_PX = 2;
const PALETTE_DELTA_E = 3;
const INVISIBLE_OPACITY = 0.01;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const round = (value: number, places = 3) =>
  Math.round(value * 10 ** places) / 10 ** places;

const parseColor = (input: string): RGBA | null => {
  const value = input.trim().toLowerCase();
  if (!value || value === 'transparent') return {r: 0, g: 0, b: 0, a: 0};

  if (value.startsWith('#')) {
    const hex = value.slice(1);
    const expand = (part: string) => parseInt(part.length === 1 ? part + part : part, 16);
    if (hex.length === 3 || hex.length === 4) {
      return {
        r: expand(hex[0]),
        g: expand(hex[1]),
        b: expand(hex[2]),
        a: hex.length === 4 ? expand(hex[3]) / 255 : 1,
      };
    }
    if (hex.length === 6 || hex.length === 8) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
        a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
      };
    }
    return null;
  }

  const match = value.match(/^rgba?\(([^)]+)\)$/);
  if (!match) return null;
  const parts = match[1].split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3) return null;
  const channel = (part: string) => (part.endsWith('%') ? (parseFloat(part) / 100) * 255 : parseFloat(part));
  const alpha = parts.length >= 4
    ? parts[3].endsWith('%')
      ? parseFloat(parts[3]) / 100
      : parseFloat(parts[3])
    : 1;
  return {r: channel(parts[0]), g: channel(parts[1]), b: channel(parts[2]), a: alpha};
};

const toHex = ({r, g, b}: RGBA) =>
  `#${[r, g, b]
    .map((channel) => Math.round(clamp(channel, 0, 255)).toString(16).padStart(2, '0'))
    .join('')}`;

const over = (foreground: RGBA, background: RGBA): RGBA => {
  const a = foreground.a;
  return {
    r: foreground.r * a + background.r * (1 - a),
    g: foreground.g * a + background.g * (1 - a),
    b: foreground.b * a + background.b * (1 - a),
    a: 1,
  };
};

const relativeLuminance = ({r, g, b}: RGBA): number => {
  const linear = (channel: number) => {
    const c = clamp(channel, 0, 255) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
};

const contrastRatio = (foreground: RGBA, background: RGBA): number => {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
};

/* CIE76 ΔE over D65 sRGB — enough to reject off-palette colours. */
const toLab = ({r, g, b}: RGBA) => {
  const linear = (channel: number) => {
    const c = clamp(channel, 0, 255) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const [lr, lg, lb] = [linear(r), linear(g), linear(b)];
  const x = (lr * 0.4124 + lg * 0.3576 + lb * 0.1805) / 0.95047;
  const y = (lr * 0.2126 + lg * 0.7152 + lb * 0.0722) / 1;
  const z = (lr * 0.0193 + lg * 0.1192 + lb * 0.9505) / 1.08883;
  const f = (value: number) => (value > 0.008856 ? value ** (1 / 3) : 7.787 * value + 16 / 116);
  return {
    l: 116 * f(y) - 16,
    a: 500 * (f(x) - f(y)),
    b: 200 * (f(y) - f(z)),
  };
};

const deltaE = (a: RGBA, b: RGBA): number => {
  const pa = toLab(a);
  const pb = toLab(b);
  return Math.sqrt((pa.l - pb.l) ** 2 + (pa.a - pb.a) ** 2 + (pa.b - pb.b) ** 2);
};

const isSkipped = (element: Element): boolean => element.closest(SKIP_SELECTOR) !== null;

const effectiveOpacity = (element: Element): number => {
  let opacity = 1;
  let node: Element | null = element;
  while (node && node !== document.documentElement) {
    const value = Number.parseFloat(getComputedStyle(node).opacity);
    if (Number.isFinite(value)) opacity *= value;
    node = node.parentElement;
  }
  return opacity;
};

const labelFor = (element: Element): string => {
  const kind = element.getAttribute('data-audit') ?? element.tagName.toLowerCase();
  const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 28);
  return text ? `${kind}:${text}` : kind;
};

/** Composite every ancestor background, outermost first, over the film bg. */
const backdropFor = (element: Element, fallback: RGBA): RGBA => {
  const layers: RGBA[] = [];
  let node: Element | null = element.parentElement;
  while (node && node !== document.documentElement) {
    const color = parseColor(getComputedStyle(node).backgroundColor);
    if (color && color.a > 0.001) layers.push(color);
    node = node.parentElement;
  }
  let background = {...fallback, a: 1};
  for (let index = layers.length - 1; index >= 0; index -= 1) {
    background = over(layers[index], background);
  }
  return background;
};

const isTextElement = (element: Element): boolean => {
  if (element.tagName === 'IMG' || element.tagName === 'VIDEO') return false;
  if (!(element.textContent ?? '').trim()) return false;
  // Only leaves carry the audit contract; wrapping containers are ignored so a
  // parent is never measured twice.
  return element.querySelector('[data-audit]') === null;
};

const paletteColors = (theme: ThemeName): RGBA[] =>
  Object.values(tokens[theme].palette)
    .map((value) => parseColor(value))
    .filter((value): value is RGBA => value !== null);

const auditDocument = (
  theme: ThemeName,
  frame: number,
  width: number,
  height: number,
  bands: SafeBands,
): AuditReport => {
  const set: TokenSet = tokens[theme];
  const {palette, limits, asset} = set;
  const fallback = parseColor(palette.bg) ?? {r: 0, g: 0, b: 0, a: 1};
  const tokenPalette = [...paletteColors('dark'), ...paletteColors('light')];
  const decorativeColor = parseColor(palette.inkFaint);
  const failures = new Set<AuditFailureCode>();

    const declaredFaces: {family: string; status: FontFace['status']}[] = [];
  document.fonts.forEach((face) => {
    declaredFaces.push({family: face.family.replace(/^["']|["']$/g, ''), status: face.status});
  });
  const declaredFamilies = new Set(declaredFaces.map((face) => face.family.toLowerCase()));
  const families = new Set<string>([
    ...FONT_FACES.map((face) => face.family),
    ...declaredFaces.map((face) => face.family),
  ]);

  const fonts: FontCheck[] = [...families].map((family) => {
    const declared = declaredFamilies.has(family.toLowerCase());
    const check = document.fonts.check(`16px "${family}"`);
    const loaded = declaredFaces.some(
      (face) => face.family.toLowerCase() === family.toLowerCase() && face.status === 'loaded',
    );
    const ok = declared && check && loaded;
    if (!ok) failures.add('font_missing');
    return {family, declared, check, loaded, ok};
  });

    const elements = Array.from(document.querySelectorAll<HTMLElement>('[data-audit]'))
    .filter((element) => !isSkipped(element));

  const overflow: OverflowCheck[] = [];
  const safeArea: SafeAreaCheck[] = [];
  const fontSizes: FontSizeCheck[] = [];
  const contrast: ContrastCheck[] = [];
  const readingSpeed: ReadingSpeedCheck[] = [];
  const paletteChecks: PaletteCheck[] = [];

  const topBand = height * bands.title;
  const bottomBand = height * Math.max(bands.action, bands.subtitle);

  for (const element of elements) {
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    const opacity = effectiveOpacity(element);
    if (opacity < INVISIBLE_OPACITY) continue;

    if (!isTextElement(element)) continue;

    const computed = getComputedStyle(element);
    const label = labelFor(element);
    const fontPx = Number.parseFloat(computed.fontSize);
    const color = parseColor(computed.color);

    if (Number.isFinite(fontPx)) {
      const ok = fontPx >= limits.fontFloorPx;
      if (!ok) failures.add('font_too_small');
      fontSizes.push({label, px: round(fontPx), minPx: limits.fontFloorPx, ok});
    }

    const parent = element.parentElement;
    if (parent) {
      const parentRect = parent.getBoundingClientRect();
      const dx = round(Math.max(0, parentRect.left - rect.left, rect.right - parentRect.right));
      const dy = round(Math.max(0, parentRect.top - rect.top, rect.bottom - parentRect.bottom));
      const ok = dx <= TOLERANCE_PX && dy <= TOLERANCE_PX;
      if (!ok) failures.add('text_overflow');
      overflow.push({label, parent: labelFor(parent), dx, dy, ok});
    }

    const inTitle = rect.top < topBand - 1;
    const inAction = rect.bottom > height - height * bands.action + 1;
    const inSubtitle = rect.bottom > height - bottomBand + 1;
    const violation = inTitle ? 'title' : inSubtitle || inAction ? (inSubtitle ? 'subtitle' : 'action') : null;
    const safeOk = violation === null;
    if (!safeOk) failures.add('safe_area_violation');
    safeArea.push({
      label,
      top: round(rect.top, 1),
      bottom: round(rect.bottom, 1),
      violation,
      ok: safeOk,
    });

    if (color && color.a > 0) {
      const background = backdropFor(element, fallback);
      const ratio = round(contrastRatio(over(color, background), background), 2);
      const threshold = fontPx >= 24 ? limits.minLargeTextContrast : limits.minBodyContrast;
      const decorative = decorativeColor !== null && deltaE(color, decorativeColor) < 0.5;
      const ok = decorative || ratio >= threshold - 1e-6;
      if (!ok) failures.add('low_contrast');
      contrast.push({
        label,
        ratio,
        threshold,
        foreground: toHex(color),
        background: toHex(background),
        decorative,
        ok,
      });
    }

    const charsRaw = element.getAttribute('data-chars');
    const secondsRaw = element.getAttribute('data-onscreen-seconds');
    if (charsRaw !== null && secondsRaw !== null) {
      const chars = Number.parseFloat(charsRaw);
      const seconds = Number.parseFloat(secondsRaw);
      if (Number.isFinite(chars) && Number.isFinite(seconds) && seconds > 0) {
        const charsPerSecond = round(chars / seconds, 2);
        const ok = charsPerSecond <= limits.maxCharsPerSecond;
        if (!ok) failures.add('reading_speed');
        readingSpeed.push({label, chars, seconds, charsPerSecond, max: limits.maxCharsPerSecond, ok});
      }
    }

    if (color) {
      let nearest = tokenPalette[0] ?? color;
      let best = Number.POSITIVE_INFINITY;
      for (const token of tokenPalette) {
        const distance = deltaE(color, token);
        if (distance < best) {
          best = distance;
          nearest = token;
        }
      }
      const ok = best <= PALETTE_DELTA_E;
      if (!ok) failures.add('palette_drift');
      paletteChecks.push({
        label,
        color: toHex(color),
        nearest: toHex(nearest),
        deltaE: round(best, 2),
        ok,
      });
    }
  }

  const upscale: UpscaleCheck[] = [];
  const assets = Array.from(document.querySelectorAll<HTMLElement>('[data-asset-natural-width]'))
    .filter((element) => !isSkipped(element));
  for (const element of assets) {
    const naturalWidth = Number.parseFloat(element.getAttribute('data-asset-natural-width') ?? '');
    const rect = element.getBoundingClientRect();
    if (!Number.isFinite(naturalWidth) || naturalWidth <= 0 || rect.width <= 0) continue;
    const ratio = round(rect.width / naturalWidth, 3);
    // tokens.asset: any upscale warns (> 1.0), past warnUpscale (1.15) is a
    // hard failure. Never widen these to silence a check.
    const ok = ratio <= asset.warnUpscale + 1e-6;
    const warning = ok && ratio > asset.maxUpscale + 1e-6;
    if (!ok) failures.add('asset_upscale');
    upscale.push({
      label: labelFor(element),
      naturalWidth,
      renderedWidth: round(rect.width, 1),
      ratio,
      ok,
      warning,
    });
  }

  return {
    failures: [...failures].sort() as AuditFailureCode[],
    checks: {fonts, overflow, safeArea, fontSizes, contrast, upscale, readingSpeed, palette: paletteChecks},
    frame,
  };
};

export const AuditProbe: React.FC<{
  audit?: boolean;
  theme?: ThemeName;
  layout?: Layout;
}> = ({audit = false, theme = 'dark', layout = layoutFor('wide')}) => {
  const frame = useCurrentFrame();
  const {width, height} = useVideoConfig();
  const handleRef = useRef<number | null>(null);
  const frameRef = useRef(frame);
  frameRef.current = frame;

  // Created during render so the frame can never be captured before the effect
  // runs; continueRender() is only called once the report has been printed.
  if (audit && handleRef.current === null) {
    handleRef.current = delayRender('audit-probe');
  }

  useEffect(() => {
    if (!audit) return undefined;
    const handle = handleRef.current;
    if (handle === null) return undefined;

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      continueRender(handle);
    };

    const run = async () => {
      try {
        if (document.fonts?.ready) {
          try {
            await document.fonts.ready;
          } catch {
          }
        }
        const report = auditDocument(theme, frameRef.current, width, height, layout.bands);
        console.log(`AUDIT::${JSON.stringify(report)}`);
      } catch (error) {
        console.log(
          `AUDIT::${JSON.stringify({
            failures: ['audit_error'],
            checks: {error: error instanceof Error ? error.message : String(error)},
            frame: frameRef.current,
          })}`,
        );
      } finally {
        finish();
      }
    };

    void run();
    return finish;
  }, [audit, theme, width, height, layout]);

  return null;
};
