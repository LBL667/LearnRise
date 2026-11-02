/**
 * S05 — 可溯源 (780 frames / 26 s).
 *
 * Pick a knowledge point, generate three questions, answer one wrong, watch the
 * card enter the review queue, then expand the exact source chunk.
 *
 * Same app-window grammar as S04: the capture is cropped to its content column
 * at native scale (never upscaled) and cross-fades through four states while a
 * slow pan keeps motion alive. The state chip above the window names the current
 * mechanic; the copy column reads the S05 story from `SCENE_BY_ID.S05`.
 */

import React from 'react';
import {
  AbsoluteFill,
  Img,
  staticFile,
  useCurrentFrame,
} from 'remotion';
import {textAudit} from '../components/Typography';
import {FPS, SCENE_BY_ID} from '../content/film';
import {FONT_FAMILIES} from '../fonts';
import {clamp01} from '../lib/anim';
import {useLayout} from '../theme/layout';
import {tokens, type ThemeName} from '../theme/tokens';

const SCENE = SCENE_BY_ID.S05;
const DURATION = SCENE.minSeconds * FPS;
const NATIVE_W = 1920;

const CROP = {x: 440, y: 0, width: 1200, height: 859} as const;
const WINDOW = {x: 780, y: 214, width: 1020, chrome: 34, imageHeight: 730} as const;
const SCALE = WINDOW.width / CROP.width;
const IMG_W = NATIVE_W * SCALE;
const IMG_H = 1080 * SCALE;
const IMG_LEFT = -CROP.x * SCALE;
const IMG_TOP = -CROP.y * SCALE;

const COLUMN = {x: 192, y: 214, width: 620} as const;
const GRAIN_SVG = encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='g'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/><feColorMatrix type='saturate' values='0'/></filter><rect width='180' height='180' filter='url(#g)' opacity='0.6'/></svg>`,
);

const CROSSFADE = 14;
const PAN_PX = 55;

const SUB = (SCENE.subline ?? '').split(' · ');
const RAIL: readonly string[] = [SUB[0] ?? '', SUB[2] ?? '', SUB[1] ?? ''];

type Beat = {readonly src: string; readonly from: number; readonly to: number; readonly chip: string};

const BEATS: readonly Beat[] = [
  {src: 'ui/s05-generating.png', from: 0, to: 150, chip: RAIL[0]},
  {src: 'ui/s05-questions.png', from: 150, to: 340, chip: RAIL[0]},
  {src: 'ui/s05-wrong-toast.png', from: 340, to: 550, chip: '已加入复习卡片'},
  {src: 'ui/s05-wrong-chunk.png', from: 550, to: DURATION, chip: RAIL[2]},
];

const MAX_LINE_CHARS = 9;

const splitHeadline = (text: string): readonly [string, string] => {
  const characters = Array.from(text);
  const comma = characters.indexOf('，');
  const balanced =
    comma > 0 &&
    comma < characters.length - 1 &&
    comma + 1 <= MAX_LINE_CHARS &&
    characters.length - comma - 1 <= MAX_LINE_CHARS;
  if (balanced) {
    return [
      characters.slice(0, comma + 1).join(''),
      characters.slice(comma + 1).join(''),
    ];
  }
  const pivot = Math.ceil(characters.length / 2);
  return [characters.slice(0, pivot).join(''), characters.slice(pivot).join('')];
};

const beatOpacity = (frame: number, index: number): number => {
  const beat = BEATS[index];
  const start = index === 0 ? -CROSSFADE : beat.from - CROSSFADE;
  const out =
    index === BEATS.length - 1 ? 1 : clamp01((beat.to + CROSSFADE - frame) / CROSSFADE);
  return Math.min(clamp01((frame - start) / CROSSFADE), out);
};

const activeBeat = (frame: number): number =>
  Math.max(
    0,
    BEATS.findIndex((beat) => frame >= beat.from && frame < beat.to),
  );

export const S05Quiz: React.FC<{theme?: ThemeName}> = ({theme = 'dark'}) => {
  const frame = useCurrentFrame();
  const layout = useLayout();
  const {palette, type, space, stroke, radius, motion} = tokens[theme];

  const kicker = (SCENE.kicker ?? '').split(' / ');
  const headline = splitHeadline(SCENE.screenText[0] ?? '');
  const active = activeBeat(frame);
  const beat = BEATS[active];
  const enter = clamp01(frame / motion.enter);
  const added = beat?.chip === '已加入复习卡片';

  return (
    <AbsoluteFill data-scene={SCENE.id} style={{fontFamily: FONT_FAMILIES.sans}}>
      <AbsoluteFill
        style={{
          background: `linear-gradient(90deg, ${palette.bg} 0%, ${palette.bg} 58%, ${palette.bg}00 78%)`,
          pointerEvents: 'none',
        }}
      />

      <div
        style={{
          position: 'absolute',
          left: layout.px(WINDOW.x),
          top: layout.px(WINDOW.y),
          width: layout.px(WINDOW.width),
          borderRadius: layout.px(radius.lg),
          border: `${stroke.hair}px solid ${palette.stroke}`,
          background: palette.bgAlt,
          overflow: 'hidden',
          boxShadow: `0 ${layout.px(28)}px ${layout.px(70)}px ${palette.bg}`,
          opacity: enter,
        }}
      >
        <div
          style={{
            height: layout.px(WINDOW.chrome),
            display: 'flex',
            alignItems: 'center',
            gap: layout.gap(space.xs),
            paddingLeft: layout.px(18),
            borderBottom: `${stroke.hair}px solid ${palette.strokeSoft}`,
            background: palette.bgAlt,
          }}
        >
          {[palette.inkFaint, palette.inkFaint, palette.accent].map((color, index) => (
            <div
              key={index}
              aria-hidden
              style={{
                width: layout.px(9),
                height: layout.px(9),
                borderRadius: '50%',
                background: color,
                opacity: index === 2 ? 0.8 : 0.55,
              }}
            />
          ))}
        </div>

        <div
          style={{
            position: 'relative',
            height: layout.px(WINDOW.imageHeight),
            overflow: 'hidden',
            background: palette.bgAlt,
          }}
        >
          {BEATS.map((item, index) => {
            const progress = clamp01(
              (frame - item.from) / Math.max(1, item.to - item.from),
            );
            return (
              <Img
                key={item.src}
                src={staticFile(item.src)}
                data-asset-natural-width={NATIVE_W}
                style={{
                  position: 'absolute',
                  left: layout.px(IMG_LEFT),
                  top: layout.px(IMG_TOP),
                  width: layout.px(IMG_W),
                  height: layout.px(IMG_H),
                  maxWidth: 'none',
                  opacity: beatOpacity(frame, index),
                  transform: `translateX(${-PAN_PX * progress}px)`,
                }}
              />
            );
          })}

          <div
            aria-hidden
            style={{
              position: 'absolute',
              inset: 0,
              backgroundImage: `url("data:image/svg+xml,${GRAIN_SVG}")`,
              backgroundPosition: `${(frame * 5) % 180}px ${(frame * 7) % 180}px`,
              opacity: 0.08,
              mixBlendMode: 'multiply',
              pointerEvents: 'none',
            }}
          />

          <div
            aria-hidden
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              height: layout.px(88),
              background: `linear-gradient(to top, ${tokens.light.palette.bg}, ${tokens.light.palette.bg}00)`,
              pointerEvents: 'none',
            }}
          />
        </div>
      </div>

      <div
        style={{
          position: 'absolute',
          right: layout.px(120),
          top: layout.px(150),
          display: 'flex',
          alignItems: 'center',
          gap: layout.gap(space.md),
          padding: `${layout.px(12)}px ${layout.px(20)}px`,
          borderRadius: layout.px(radius.pill),
          background: palette.bg,
          border: `${stroke.hair}px solid ${added ? palette.accentAlt : palette.accent}`,
          opacity: enter,
        }}
      >
        <div
          aria-hidden
          style={{
            width: layout.px(9),
            height: layout.px(9),
            borderRadius: '50%',
            background: added ? palette.accentAlt : palette.accent,
            boxShadow: `0 0 ${layout.px(14)}px ${added ? palette.accentAlt : palette.accent}`,
          }}
        />
        <div
          {...textAudit(beat?.chip ?? '')}
          style={{
            fontSize: layout.font(type.label),
            fontWeight: type.weight.medium,
            color: added ? palette.accentAltText : palette.ink,
            whiteSpace: 'nowrap',
          }}
        >
          {beat?.chip ?? ''}
        </div>
      </div>

      <div
        style={{
          position: 'absolute',
          left: layout.px(COLUMN.x),
          top: layout.px(COLUMN.y),
          width: layout.px(COLUMN.width),
          opacity: enter,
        }}
      >
        <div style={{display: 'flex', alignItems: 'center', gap: layout.gap(space.md)}}>
          <div
            aria-hidden
            style={{
              width: layout.px(11),
              height: layout.px(11),
              background: palette.accent,
              boxShadow: `0 0 ${layout.px(22)}px ${palette.accent}`,
            }}
          />
          <div
            {...textAudit(kicker[0] ?? '')}
            style={{
              fontFamily: FONT_FAMILIES.mono,
              fontSize: layout.font(type.label),
              fontWeight: type.weight.medium,
              letterSpacing: `${type.tracking.wider}em`,
              color: palette.accentText,
            }}
          >
            {kicker[0] ?? ''}
          </div>
          <div
            {...textAudit(kicker[1] ?? '')}
            style={{
              fontSize: layout.font(type.label),
              fontWeight: type.weight.medium,
              letterSpacing: `${type.tracking.wide}em`,
              color: palette.inkMuted,
            }}
          >
            {kicker[1] ?? ''}
          </div>
        </div>

        <div style={{marginTop: layout.px(26)}}>
          <div
            {...textAudit(headline[0])}
            style={{
              fontSize: layout.font(type.display3),
              fontWeight: type.weight.regular,
              color: palette.inkMuted,
              lineHeight: type.leading.snug,
            }}
          >
            {headline[0]}
          </div>
          <div
            {...textAudit(headline[1])}
            style={{
              fontSize: layout.font(type.display3),
              fontWeight: type.weight.black,
              color: palette.ink,
              lineHeight: type.leading.snug,
            }}
          >
            {headline[1]}
          </div>
        </div>

        <div style={{marginTop: layout.px(22)}}>
          <div
            {...textAudit(SCENE.subline ?? '')}
            style={{
              fontSize: layout.font(type.body),
              fontWeight: type.weight.regular,
              color: palette.inkMuted,
              lineHeight: type.leading.normal,
            }}
          >
            {SCENE.subline ?? ''}
          </div>
        </div>

        <div style={{marginTop: layout.px(26)}}>
          {RAIL.map((label) => {
            const isActive = label === beat?.chip;
            return (
              <div
                key={label}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: layout.gap(space.sm),
                  marginBottom: layout.gap(space.xs),
                }}
              >
                <div
                  aria-hidden
                  style={{
                    width: layout.px(isActive ? 10 : 6),
                    height: layout.px(isActive ? 10 : 6),
                    background: isActive ? palette.accent : palette.inkFaint,
                    boxShadow: isActive ? `0 0 ${layout.px(14)}px ${palette.accent}` : undefined,
                  }}
                />
                <div
                  {...textAudit(label)}
                  style={{
                    fontSize: layout.font(isActive ? type.body : type.label),
                    fontWeight: isActive ? type.weight.medium : type.weight.regular,
                    color: isActive ? palette.ink : palette.inkMuted,
                  }}
                >
                  {label}
                </div>
              </div>
            );
          })}
        </div>

        <div
          {...textAudit(SCENE.footnote ?? '')}
          style={{
            marginTop: layout.px(22),
            fontSize: layout.font(type.label),
            fontWeight: type.weight.regular,
            color: palette.inkFaint,
          }}
        >
          {SCENE.footnote ?? ''}
        </div>
      </div>
      <AbsoluteFill
        style={{
          backgroundImage: `url("data:image/svg+xml,${GRAIN_SVG}")`,
          backgroundPosition: `${(frame * 5) % 180}px ${(frame * 3) % 180}px`,
          opacity: 0.12,
          mixBlendMode: 'screen',
          pointerEvents: 'none',
        }}
      />
    </AbsoluteFill>
  );
};
