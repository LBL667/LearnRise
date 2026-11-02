/**
 * S03 — Upload (local frames 0–719, 24 s).
 *
 * Asymmetric two-up: the upload card owns the left column and replays a real job
 * as a four-step state machine (queued → parsing → embedding → ready); the right
 * column is the product's own library view, swapping from the upload dialog to
 * the parsing view and finally to the ready list. The card is the source of
 * truth for the file name — it reads `SOURCE_DOCUMENT.filename` from the cast,
 * so the film never claims a file the product does not have.
 *
 * The progress bar, the scan sweep, the panel zoom and the ready glow are all
 * frame-driven, so the scene has motion in every window and cannot trip
 * freezedetect. No PPTX state exists anywhere: the only format in play is the
 * `.pdf` suffix read off the cast file name.
 */

import React from 'react';
import {AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame} from 'remotion';
import {FONT_FAMILIES} from '../fonts';
import {useLayout} from '../theme/layout';
import {tokens, type ThemeName} from '../theme/tokens';
import {Fade, LineReveal, textAudit} from '../components/Typography';
import {SOURCE_DOCUMENT} from '../content/cast';
import {SCENE_BY_ID, SCENE_FRAMES} from '../content/film';
import {clamp01, useEnter} from '../lib/anim';

const SCENE = SCENE_BY_ID.S03;
const KICKER = SCENE.kicker ?? '';
const SPLIT = ' / ';
const SPLIT_AT = KICKER.indexOf(SPLIT);
const KICKER_INDEX = SPLIT_AT === -1 ? KICKER : KICKER.slice(0, SPLIT_AT + SPLIT.length);
const KICKER_LABEL = SPLIT_AT === -1 ? '' : KICKER.slice(SPLIT_AT + SPLIT.length);
const SUBLINE = SCENE.subline ?? '';
const FOOTNOTE = SCENE.footnote ?? '';
const FILENAME = SOURCE_DOCUMENT?.filename ?? '';
const FORMAT = FILENAME.split('.').pop()?.toUpperCase() ?? '';

const GRAIN_SVG = encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/><feColorMatrix type='saturate' values='0'/></filter><rect width='180' height='180' filter='url(#n)' opacity='0.55'/></svg>`,
);
const GRAIN_TILE_PX = 180;

const STATES = ['queued', 'parsing', 'embedding', 'ready'] as const;
type JobState = (typeof STATES)[number];

const STATE_AT = [0, 90, 300, 500] as const;

const JOB_NATIVE_WIDTH = 1920;
const CARD_WIDTH_PX = 660;
const CARD_HEIGHT_PX = 430;
const PANEL_HEIGHT_PX = 430;
const CHROME_HEIGHT_PX = 44;
const KICKER_DOT_PX = 11;
const CARD_RADIUS_PX = 28;
const PDF_ICON_WIDTH_PX = 52;
const PDF_ICON_HEIGHT_PX = 66;
const STATE_DOT_PX = 22;
const PROGRESS_HEIGHT_PX = 8;
const SCAN_BAND_PX = 130;

const SHOTS: readonly {file: string; visible: (frame: number) => number}[] = [
  {
    file: 's03-upload-dialog.png',
    visible: (frame) => 1 - clamp01((frame - 110) / 60),
  },
  {
    file: 's03-parsing.png',
    visible: (frame) => clamp01((frame - 110) / 60) * (1 - clamp01((frame - 480) / 60)),
  },
  {
    file: 's03-library-ready.png',
    visible: (frame) => clamp01((frame - 480) / 60),
  },
];

const stateIndexAt = (frame: number): number => {
  if (frame >= STATE_AT[3]) return 3;
  if (frame >= STATE_AT[2]) return 2;
  if (frame >= STATE_AT[1]) return 1;
  return 0;
};

const progressAt = (frame: number): number =>
  interpolate(frame, [0, 90, 300, 500, 560], [0.02, 0.09, 0.46, 0.93, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

const CheckMark: React.FC<{size: number; color: string; strokeWidth?: number}> = ({
  size,
  color,
  strokeWidth = 2,
}) => (
  <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
    <path
      d="M3.5 8.5 L6.8 11.8 L12.8 4.6"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const S03Upload: React.FC<{theme?: ThemeName}> = ({theme = 'dark'}) => {
  const {palette, type, space, radius, stroke, motion} = tokens[theme];
  const layout = useLayout();
  const frame = useCurrentFrame();

  const kickerIn = useEnter(0, motion.enter);
  const stateIndex = stateIndexAt(frame);
  const currentState: JobState = STATES[stateIndex];
  const progress = progressAt(frame);
  const pan = 1 + 0.045 * (frame / SCENE_FRAMES[2]);
  const scanOpacity =
    clamp01((frame - 110) / 60) * (1 - clamp01((frame - 430) / 50));
  const scanPos = clamp01((frame - 110) / 320);
  const readyReveal = clamp01((frame - 500) / 60);

  return (
    <AbsoluteFill
      style={{
        fontFamily: FONT_FAMILIES.sans,
        flexDirection: 'column',
        justifyContent: 'center',
        paddingLeft: layout.safe.side,
        paddingRight: layout.safe.side,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: layout.gap(space.sm),
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
          {...textAudit(KICKER_INDEX)}
          style={{
            fontFamily: FONT_FAMILIES.mono,
            fontSize: layout.font(type.label),
            fontWeight: type.weight.medium,
            letterSpacing: `${type.tracking.wider}em`,
            color: palette.inkMuted,
            whiteSpace: 'nowrap',
          }}
        >
          {KICKER_INDEX}
        </div>
        {KICKER_LABEL.length === 0 ? null : (
          <div
            {...textAudit(KICKER_LABEL)}
            style={{
              fontSize: layout.font(type.label),
              fontWeight: type.weight.medium,
              letterSpacing: `${type.tracking.wide}em`,
              color: palette.inkMuted,
              whiteSpace: 'nowrap',
            }}
          >
            {KICKER_LABEL}
          </div>
        )}
      </div>

      <div style={{marginTop: layout.gap(space.md)}}>
        <LineReveal delay={motion.stagger} theme={theme}>
          <div
            {...textAudit(SCENE.screenText[0])}
            style={{
              fontSize: layout.font(type.display3),
              fontWeight: type.weight.black,
              letterSpacing: `${type.tracking.normal}em`,
              color: palette.ink,
              lineHeight: type.leading.snug,
              whiteSpace: 'nowrap',
            }}
          >
            {SCENE.screenText[0]}
          </div>
        </LineReveal>
      </div>

      <Fade
        delay={motion.stagger * 2}
        theme={theme}
        style={{marginTop: layout.gap(space.sm)}}
      >
        <div
          {...textAudit(SUBLINE)}
          style={{
            fontSize: layout.font(type.label),
            fontWeight: type.weight.medium,
            letterSpacing: `${type.tracking.wide}em`,
            color: palette.inkMuted,
            lineHeight: type.leading.normal,
            whiteSpace: 'nowrap',
          }}
        >
          {SUBLINE}
        </div>
      </Fade>

      <div
        style={{
          marginTop: layout.gap(space.xl),
          display: 'flex',
          flexDirection: layout.stacked ? 'column' : 'row',
          alignItems: 'stretch',
          gap: layout.gap(space.huge),
        }}
      >
        <div
          style={{
            width: layout.stacked ? '100%' : layout.px(CARD_WIDTH_PX),
            height: layout.px(CARD_HEIGHT_PX),
            flexShrink: 0,
            borderRadius: layout.px(CARD_RADIUS_PX),
            border: `${stroke.hair}px solid ${palette.stroke}`,
            background: palette.surface,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            padding: layout.gap(space.lg),
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: layout.gap(space.md),
            }}
          >
            <svg
              width={layout.px(PDF_ICON_WIDTH_PX)}
              height={layout.px(PDF_ICON_HEIGHT_PX)}
              viewBox="0 0 52 66"
              aria-hidden
              style={{flexShrink: 0}}
            >
              <path
                d="M4 3 H32 L48 19 V60 a3 3 0 0 1 -3 3 H7 a3 3 0 0 1 -3 -3 Z"
                fill="none"
                stroke={palette.accent}
                strokeWidth={stroke.thin}
                strokeLinejoin="round"
              />
              <path
                d="M32 3 V19 H48"
                fill="none"
                stroke={palette.accent}
                strokeWidth={stroke.thin}
                strokeLinejoin="round"
              />
              <line x1={12} y1={34} x2={40} y2={34} stroke={palette.accent} strokeWidth={stroke.hair} opacity={0.55} />
              <line x1={12} y1={42} x2={40} y2={42} stroke={palette.accent} strokeWidth={stroke.hair} opacity={0.55} />
              <line x1={12} y1={50} x2={30} y2={50} stroke={palette.accent} strokeWidth={stroke.hair} opacity={0.55} />
            </svg>

            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: layout.gap(space.sm),
                minWidth: 0,
              }}
            >
              <div
                {...textAudit(FILENAME)}
                style={{
                  fontSize: layout.font(type.body),
                  fontWeight: type.weight.bold,
                  color: palette.ink,
                  lineHeight: type.leading.snug,
                  whiteSpace: layout.stacked ? 'normal' : 'nowrap',
                }}
              >
                {FILENAME}
              </div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: layout.gap(space.sm),
                }}
              >
                <div
                  style={{
                    background: palette.accent,
                    borderRadius: layout.px(radius.sm),
                    padding: `${layout.px(2)}px ${layout.px(10)}px`,
                  }}
                >
                  <div
                    {...textAudit(FORMAT)}
                    style={{
                      fontFamily: FONT_FAMILIES.mono,
                      fontSize: layout.font(type.label),
                      fontWeight: type.weight.medium,
                      letterSpacing: `${type.tracking.wider}em`,
                      color: palette.onAccent,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {FORMAT}
                  </div>
                </div>
                <div
                  {...textAudit(currentState.toUpperCase())}
                  style={{
                    fontFamily: FONT_FAMILIES.mono,
                    fontSize: layout.font(type.label),
                    fontWeight: type.weight.medium,
                    letterSpacing: `${type.tracking.wider}em`,
                    color: palette.accentText,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {currentState.toUpperCase()}
                </div>
              </div>
            </div>
          </div>

          <div
            style={{
              position: 'relative',
              display: 'flex',
              flexDirection: 'column',
              gap: layout.gap(space.sm),
            }}
          >
            <div
              style={{
                position: 'absolute',
                left: layout.px(10),
                top: layout.px(12),
                bottom: layout.px(12),
                width: stroke.hair,
                background: palette.strokeSoft,
              }}
            />
            {STATES.map((state, index) => {
              const done = index < stateIndex;
              const active = index === stateIndex;
              const dotPulse = active ? 0.7 + 0.3 * Math.sin(frame / 9) : 1;
              return (
                <div
                  key={state}
                  style={{
                    height: layout.px(44),
                    display: 'flex',
                    alignItems: 'center',
                    gap: layout.gap(space.md),
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      left: 0,
                      width: layout.px(STATE_DOT_PX),
                      height: layout.px(STATE_DOT_PX),
                      borderRadius: '50%',
                      border: `${stroke.thin}px solid ${
                        done ? palette.accentAlt : active ? palette.accent : palette.stroke
                      }`,
                      background: done ? palette.accentAlt : palette.surface,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      boxShadow: active
                        ? `0 0 ${layout.px(16) * dotPulse}px ${palette.accent}`
                        : 'none',
                      transform: `scale(${active ? 1 + 0.08 * dotPulse : 1})`,
                    }}
                  >
                    {done ? (
                      <CheckMark
                        size={layout.px(14)}
                        color={palette.bg}
                        strokeWidth={2.4}
                      />
                    ) : active ? (
                      <div
                        style={{
                          width: layout.px(8),
                          height: layout.px(8),
                          borderRadius: '50%',
                          background: palette.accent,
                        }}
                      />
                    ) : null}
                  </div>
                  <div
                    {...textAudit(state)}
                    style={{
                      marginLeft: layout.px(38),
                      fontFamily: FONT_FAMILIES.mono,
                      fontSize: layout.font(type.label),
                      fontWeight: type.weight.medium,
                      letterSpacing: `${type.tracking.wide}em`,
                      color: done || active ? palette.ink : palette.inkMuted,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {state}
                  </div>
                </div>
              );
            })}
          </div>

          <div
            style={{
              height: layout.px(PROGRESS_HEIGHT_PX),
              borderRadius: layout.px(PROGRESS_HEIGHT_PX),
              background: palette.strokeSoft,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${progress * 100}%`,
                height: '100%',
                borderRadius: layout.px(PROGRESS_HEIGHT_PX),
                background: `linear-gradient(90deg, ${palette.accent}, ${palette.accentAlt}, ${palette.accent})`,
                backgroundSize: '200% 100%',
                backgroundPosition: `${(frame * 2) % 200}% 0`,
                boxShadow: `0 0 ${layout.px(14)}px ${palette.accent}`,
              }}
            />
          </div>
        </div>

        <div
          style={{
            position: 'relative',
            flex: 1,
            minWidth: 0,
            height: layout.px(PANEL_HEIGHT_PX),
            borderRadius: layout.px(CARD_RADIUS_PX),
            border: `${stroke.hair}px solid ${palette.stroke}`,
            overflow: 'hidden',
            background: palette.bgAlt,
            boxShadow: `0 0 ${layout.px(60) * readyReveal}px ${palette.accentAlt}44`,
          }}
        >
          <div
            style={{
              height: layout.px(CHROME_HEIGHT_PX),
              display: 'flex',
              alignItems: 'center',
              gap: layout.gap(space.xs),
              paddingLeft: layout.gap(space.lg),
              paddingRight: layout.gap(space.lg),
              borderBottom: `${stroke.hair}px solid ${palette.strokeSoft}`,
            }}
          >
            {[0, 1, 2].map((dot) => (
              <div
                key={dot}
                style={{
                  width: layout.px(10),
                  height: layout.px(10),
                  borderRadius: '50%',
                  background: palette.stroke,
                }}
              />
            ))}
          </div>

          <div
            style={{
              position: 'relative',
              height: `calc(100% - ${layout.px(CHROME_HEIGHT_PX)}px)`,
              overflow: 'hidden',
            }}
          >
            {SHOTS.map((shot) => {
              const opacity = shot.visible(frame);
              return (
                <div
                  key={shot.file}
                  style={{
                    position: 'absolute',
                    inset: 0,
                    opacity,
                    transform: `scale(${pan})`,
                    transformOrigin: '50% 40%',
                  }}
                >
                  <Img
                    src={staticFile(`ui/${shot.file}`)}
                    alt=""
                    data-asset-natural-width={JOB_NATIVE_WIDTH}
                    style={{
                      display: 'block',
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                    }}
                  />
                </div>
              );
            })}

            <div
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                top: `${scanPos * 100}%`,
                height: layout.px(SCAN_BAND_PX),
                background: `linear-gradient(180deg, transparent, ${palette.accent}30, transparent)`,
                opacity: scanOpacity,
                pointerEvents: 'none',
              }}
            />
            <div
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                top: `${scanPos * 100}%`,
                height: stroke.thin,
                background: palette.accent,
                boxShadow: `0 0 ${layout.px(18)}px ${palette.accent}`,
                opacity: scanOpacity,
                pointerEvents: 'none',
              }}
            />

            <div
              style={{
                position: 'absolute',
                right: layout.gap(space.md),
                top: layout.gap(space.md),
                width: layout.px(44),
                height: layout.px(44),
                borderRadius: '50%',
                background: palette.accentAlt,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: readyReveal,
                transform: `scale(${0.7 + 0.3 * readyReveal})`,
                boxShadow: `0 0 ${layout.px(24)}px ${palette.accentAlt}`,
              }}
            >
              <CheckMark size={layout.px(24)} color={palette.onAccent} strokeWidth={2.6} />
            </div>
          </div>
        </div>
      </div>

      <Fade
        delay={motion.stagger * 4}
        theme={theme}
        style={{marginTop: layout.gap(space.md)}}
      >
        <div
          {...textAudit(FOOTNOTE)}
          style={{
            fontFamily: FONT_FAMILIES.mono,
            fontSize: layout.font(type.label),
            fontWeight: type.weight.regular,
            letterSpacing: `${type.tracking.normal}em`,
            color: palette.inkFaint,
            lineHeight: type.leading.normal,
            whiteSpace: 'nowrap',
          }}
        >
          {FOOTNOTE}
        </div>
      </Fade>

      <AbsoluteFill
        style={{
          backgroundImage: `url("data:image/svg+xml,${GRAIN_SVG}")`,
          backgroundPosition: `${(frame * 3) % GRAIN_TILE_PX}px ${(frame * 2) % GRAIN_TILE_PX}px`,
          opacity: 0.13,
          mixBlendMode: 'screen',
          pointerEvents: 'none',
        }}
      />
    </AbsoluteFill>
  );
};
