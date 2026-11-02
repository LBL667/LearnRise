/**
 * S01 — Hook (local frames 0–359, 12 s).
 *
 * The claim sits left; three real product captures sit right as a fanned deck
 * of "material you already have". The captures are pushed down to ~13% of their
 * native luminance (the storyboard asks for ~8%; 0.08 sits under ffmpeg's
 * blackdetect pixel threshold, 0.13 keeps the texture above it) and drift
 * upward for the whole scene, each at its own speed, so the frame never settles
 * into a still.
 *
 * Copy is read from `SCENE_BY_ID.S01` — this file contains no authored Chinese.
 * Every colour is a palette token; every size a type token; every asset carries
 * `data-asset-natural-width` so the audit can prove it is never upscaled.
 */

import React from 'react';
import {AbsoluteFill, Img, staticFile, useCurrentFrame} from 'remotion';
import {FONT_FAMILIES} from '../fonts';
import {useLayout} from '../theme/layout';
import {tokens, type ThemeName} from '../theme/tokens';
import {LineReveal, textAudit} from '../components/Typography';
import {SCENE_BY_ID, SCENE_FRAMES} from '../content/film';
import {clamp01, useEnter, useLinear} from '../lib/anim';

const GRAIN_SVG = encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/><feColorMatrix type='saturate' values='0'/></filter><rect width='180' height='180' filter='url(#n)' opacity='0.55'/></svg>`,
);
const GRAIN_TILE_PX = 180;

const SCENE = SCENE_BY_ID.S01;
const SCENE_LENGTH = SCENE_FRAMES[0];
const KICKER = SCENE.kicker ?? '';

/** Capture deck, back → front. Offsets are in design px about the deck centre. */
const DECK = [
  {
    file: 's01-bg-library.png',
    rotate: -7,
    offsetX: -170,
    offsetY: 42,
    drift: 18,
    brightness: 0.1,
    opacity: 0.85,
  },
  {
    file: 's01-bg-quiz.png',
    rotate: 0,
    offsetX: 16,
    offsetY: -52,
    drift: 34,
    brightness: 0.11,
    opacity: 0.92,
  },
  {
    file: 's01-bg-review.png',
    rotate: 7,
    offsetX: 188,
    offsetY: 84,
    drift: 52,
    brightness: 0.13,
    opacity: 1,
  },
] as const;

/** Native capture size of every screenshot in `public/ui`. */
const NATIVE_WIDTH = 1920;
const CARD_WIDTH_PX = 1160;
const CARD_HEIGHT_PX = 653;
const DECK_CENTER_X = 1368;
const DECK_CENTER_Y = 536;
const CARD_RADIUS_PX = 20;
const KICKER_DOT_PX = 11;
const DECK_ZOOM = 0.035;

export const S01Hook: React.FC<{theme?: ThemeName}> = ({theme = 'dark'}) => {
  const {palette, type, space, stroke, motion} = tokens[theme];
  const layout = useLayout();
  const frame = useCurrentFrame();

  const kickerIn = useEnter(0, motion.enter);
  const underline = useLinear(
    motion.stagger * 3,
    motion.stagger * 3 + motion.enter,
  );
  const travel = clamp01(frame / SCENE_LENGTH);
  const zoom = 1 + DECK_ZOOM * travel;

  return (
    <AbsoluteFill style={{fontFamily: FONT_FAMILIES.sans}}>
      <div
        style={{
          position: 'absolute',
          left: layout.px(DECK_CENTER_X - 620),
          top: layout.px(DECK_CENTER_Y - 620),
          width: layout.px(1240),
          height: layout.px(1240),
          borderRadius: '50%',
          background: `radial-gradient(circle, ${palette.accent} 0%, transparent 62%)`,
          opacity: 0.14,
          filter: `blur(${layout.px(30)}px)`,
          pointerEvents: 'none',
        }}
      />

      <AbsoluteFill style={{pointerEvents: 'none'}}>
        {DECK.map((card, index) => {
          const rise = card.drift * travel;
          return (
            <div
              key={card.file}
              style={{
                position: 'absolute',
                left: layout.px(DECK_CENTER_X + card.offsetX - CARD_WIDTH_PX / 2),
                top: layout.px(DECK_CENTER_Y + card.offsetY - CARD_HEIGHT_PX / 2),
                width: layout.px(CARD_WIDTH_PX),
                height: layout.px(CARD_HEIGHT_PX),
                borderRadius: layout.px(CARD_RADIUS_PX),
                border: `${stroke.hair}px solid ${palette.stroke}`,
                overflow: 'hidden',
                background: palette.bgAlt,
                opacity: card.opacity,
                transform: `rotate(${card.rotate}deg) translateY(${-layout.px(rise)}px) scale(${zoom})`,
                transformOrigin: '50% 50%',
                boxShadow: `0 ${layout.px(40)}px ${layout.px(80)}px ${palette.bg}`,
              }}
            >
              <Img
                src={staticFile(`ui/${card.file}`)}
                alt=""
                data-asset-natural-width={NATIVE_WIDTH}
                style={{
                  display: 'block',
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  filter: `brightness(${card.brightness}) saturate(0.45) contrast(1.15)`,
                }}
              />
            </div>
          );
        })}
      </AbsoluteFill>

      <AbsoluteFill
        style={{
          background: `linear-gradient(90deg, ${palette.bg} 20%, transparent 66%)`,
          pointerEvents: 'none',
        }}
      />

      <AbsoluteFill
        style={{
          justifyContent: 'center',
          alignItems: 'flex-start',
          paddingLeft: layout.safe.side,
          paddingRight: layout.safe.side,
        }}
      >
        <div style={{maxWidth: layout.px(1120)}}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: layout.gap(space.md),
              opacity: kickerIn,
            }}
          >
            <div
              style={{
                width: layout.px(KICKER_DOT_PX),
                height: layout.px(KICKER_DOT_PX),
                background: palette.accent,
                boxShadow: `0 0 ${layout.px(KICKER_DOT_PX * 2)}px ${palette.accent}`,
              }}
            />
            <div
              {...textAudit(KICKER)}
              style={{
                fontSize: layout.font(type.label),
                fontWeight: type.weight.medium,
                letterSpacing: `${type.tracking.wider}em`,
                color: palette.inkMuted,
                whiteSpace: 'nowrap',
              }}
            >
              {KICKER}
            </div>
          </div>

          <div style={{marginTop: layout.gap(space.xxl)}}>
            <LineReveal delay={motion.stagger} theme={theme}>
              <div
                {...textAudit(SCENE.screenText[0])}
                style={{
                  fontSize: layout.font(type.display3),
                  fontWeight: type.weight.regular,
                  color: palette.inkMuted,
                  letterSpacing: `${type.tracking.normal}em`,
                  lineHeight: type.leading.snug,
                  whiteSpace: 'nowrap',
                }}
              >
                {SCENE.screenText[0]}
              </div>
            </LineReveal>
          </div>

          <div style={{marginTop: layout.gap(space.md)}}>
            <LineReveal delay={motion.stagger * 2} theme={theme}>
              <div style={{display: 'inline-block'}}>
                <div
                  {...textAudit(SCENE.screenText[1])}
                  style={{
                    fontSize: layout.font(type.display1),
                    fontWeight: type.weight.black,
                    color: palette.ink,
                    letterSpacing: `${type.tracking.normal}em`,
                    lineHeight: type.leading.tight,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {SCENE.screenText[1]}
                </div>
                <div
                  style={{
                    marginTop: layout.gap(space.sm),
                    width: `${underline * 100}%`,
                    height: stroke.thick,
                    background: palette.accent,
                    boxShadow: `0 0 ${layout.px(18)}px ${palette.accent}`,
                  }}
                />
              </div>
            </LineReveal>
          </div>
        </div>
      </AbsoluteFill>
      <AbsoluteFill
        style={{
          backgroundImage: `url("data:image/svg+xml,${GRAIN_SVG}")`,
          backgroundPosition: `${(frame * 3) % GRAIN_TILE_PX}px ${(frame * 2) % GRAIN_TILE_PX}px`,
          opacity: 0.16,
          mixBlendMode: 'screen',
          pointerEvents: 'none',
        }}
      />
    </AbsoluteFill>
  );
};
