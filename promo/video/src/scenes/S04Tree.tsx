/**
 * S04 — 结构化 (720 frames / 24 s).
 *
 * One source document becomes a tree, a knowledge point opens its source slice
 * on `/kp/:id`, the note editor opens on the same `/kp/:id` route, and the mind
 * map closes the beat.
 *
 * Composition: an app window on the right (cropped to the capture's content
 * column, never upscaled) cross-fades through five captures while a slow pan
 * keeps the frame alive, and a copy column on the left drives the reading.
 * Every sentence comes from `SCENE_BY_ID.S04`; the source card pulls the cast
 * document; nothing here invents copy.
 *
 * Note-editing evidence is `/kp/:id` only — the route chip on the window states
 * it explicitly, and no `/library` capture is used for the editing beat.
 */

import React from 'react';
import {
  AbsoluteFill,
  Img,
  staticFile,
  useCurrentFrame,
} from 'remotion';
import {textAudit} from '../components/Typography';
import {SOURCE_DOCUMENT} from '../content/cast';
import {FPS, SCENE_BY_ID} from '../content/film';
import {FONT_FAMILIES} from '../fonts';
import {clamp01} from '../lib/anim';
import {useLayout} from '../theme/layout';
import {tokens, type ThemeName} from '../theme/tokens';

const SCENE = SCENE_BY_ID.S04;
const DURATION = SCENE.minSeconds * FPS;
const NATIVE_W = 1920;

const CROP = {x: 400, y: 110, width: 1200, height: 859} as const;
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
const PAN_PX = 123;

const LABELS = (SCENE.subline ?? '').split(' · ');

type Beat = {readonly src: string; readonly from: number; readonly to: number; readonly label: string};

const BEATS: readonly Beat[] = [
  {src: 'ui/s04-tree.png', from: 0, to: 140, label: LABELS[0] ?? ''},
  {src: 'ui/s04-tree-accounting.png', from: 140, to: 285, label: LABELS[1] ?? ''},
  {src: 'ui/s04-kp-accounting-detail.png', from: 285, to: 420, label: LABELS[2] ?? ''},
  {src: 'ui/s04-kp-accounting-edit.png', from: 420, to: 560, label: LABELS[3] ?? ''},
  {src: 'ui/s04-mindmap.png', from: 560, to: DURATION, label: LABELS[4] ?? ''},
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

export const S04Tree: React.FC<{theme?: ThemeName}> = ({theme = 'dark'}) => {
  const frame = useCurrentFrame();
  const layout = useLayout();
  const {palette, type, space, stroke, radius, motion} = tokens[theme];

  const kicker = (SCENE.kicker ?? '').split(' / ');
  const headline = splitHeadline(SCENE.screenText[0] ?? '');
  const active = activeBeat(frame);
  const activeLabel = BEATS[active]?.label ?? LABELS[0] ?? '';
  const enter = clamp01(frame / motion.enter);
  const source = SOURCE_DOCUMENT;
  const showRoute = active === 2 || active === 3;

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
          {BEATS.map((beat, index) => {
            const progress = clamp01(
              (frame - beat.from) / Math.max(1, beat.to - beat.from),
            );
            return (
              <Img
                key={beat.src}
                src={staticFile(beat.src)}
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

          {showRoute ? (
            <div
              style={{
                position: 'absolute',
                left: layout.px(24),
                bottom: layout.px(96),
                display: 'flex',
                alignItems: 'center',
                gap: layout.gap(space.md),
                padding: `${layout.px(12)}px ${layout.px(20)}px`,
                borderRadius: layout.px(radius.pill),
                background: palette.bg,
                border: `${stroke.hair}px solid ${palette.accent}`,
              }}
            >
              <div
                {...textAudit(activeLabel)}
                style={{
                  fontSize: layout.font(type.label),
                  fontWeight: type.weight.medium,
                  color: palette.ink,
                  whiteSpace: 'nowrap',
                }}
              >
                {activeLabel}
              </div>
              <div
                {...textAudit('/kp/:id')}
                style={{
                  fontFamily: FONT_FAMILIES.mono,
                  fontSize: layout.font(type.label),
                  fontWeight: type.weight.medium,
                  letterSpacing: `${type.tracking.wide}em`,
                  color: palette.accentText,
                  whiteSpace: 'nowrap',
                }}
              >
                /kp/:id
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {source === null ? null : (
        <div
          style={{
            position: 'absolute',
            left: layout.px(1020),
            top: layout.px(100),
            width: layout.px(740),
            padding: layout.px(14),
            borderRadius: layout.px(radius.md),
            border: `${stroke.hair}px solid ${palette.stroke}`,
            background: palette.bg,
            opacity: enter,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              gap: layout.gap(space.md),
            }}
          >
            <div style={{display: 'flex', alignItems: 'baseline', gap: layout.gap(space.md)}}>
              <div
                {...textAudit('PDF')}
                style={{
                  fontFamily: FONT_FAMILIES.mono,
                  fontSize: layout.font(type.label),
                  fontWeight: type.weight.medium,
                  letterSpacing: `${type.tracking.wider}em`,
                  color: palette.accentText,
                }}
              >
                PDF
              </div>
              <div
                {...textAudit(source.status.toUpperCase())}
                style={{
                  fontFamily: FONT_FAMILIES.mono,
                  fontSize: layout.font(type.label),
                  fontWeight: type.weight.medium,
                  letterSpacing: `${type.tracking.wider}em`,
                  color: palette.accentAltText,
                }}
              >
                {source.status.toUpperCase()}
              </div>
            </div>
            <div
              {...textAudit(source.title)}
              style={{
                fontSize: layout.font(type.label),
                fontWeight: type.weight.medium,
                color: palette.ink,
                lineHeight: 1.2,
                whiteSpace: 'nowrap',
              }}
            >
              {source.title}
            </div>
          </div>
          <div
            {...textAudit(source.filename)}
            style={{
              marginTop: layout.px(6),
              fontFamily: FONT_FAMILIES.mono,
              lineHeight: 1.2,
              fontSize: layout.font(type.label),
              color: palette.inkMuted,
              whiteSpace: 'nowrap',
            }}
          >
            {source.filename}
          </div>
        </div>
      )}

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
          {LABELS.map((label) => {
            const isActive = label === activeLabel;
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
