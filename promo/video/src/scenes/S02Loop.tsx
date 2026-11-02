/**
 * S02 — Closed loop (local frames 0–599, 20 s).
 *
 * The eight stages are not authored here: they are the eight labels in the
 * scene's own `screenText`, split on the middot. Phase 1 (0–300) runs them as a
 * left-to-right pipeline, each node lighting 28 frames after the last and each
 * connector drawing in behind it. Phase 2 (300–450) eases every node from its
 * pipeline slot onto a circle; the last connector closes the ring at 330. The
 * wordmark rises at 440 and the ring keeps a slow orbiting pulse for the rest of
 * the scene, so the hold is never a freeze.
 *
 * Labels stay in the sans face (the mono subset is ASCII-only); the kicker's
 * `01 /` index is the only mono text.
 */

import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import {FONT_FAMILIES} from '../fonts';
import {useLayout} from '../theme/layout';
import {tokens, type ThemeName} from '../theme/tokens';
import {Fade, textAudit} from '../components/Typography';
import {SCENE_BY_ID} from '../content/film';
import {clamp01, easeInOutCubic, easeOutCubic, lerp, useEnter} from '../lib/anim';

const GRAIN_SVG = encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/><feColorMatrix type='saturate' values='0'/></filter><rect width='180' height='180' filter='url(#n)' opacity='0.55'/></svg>`,
);
const GRAIN_TILE_PX = 180;

const SCENE = SCENE_BY_ID.S02;
const KICKER = SCENE.kicker ?? '';
const SPLIT = ' / ';
const SPLIT_AT = KICKER.indexOf(SPLIT);
const KICKER_INDEX = SPLIT_AT === -1 ? KICKER : KICKER.slice(0, SPLIT_AT + SPLIT.length);
const KICKER_LABEL = SPLIT_AT === -1 ? '' : KICKER.slice(SPLIT_AT + SPLIT.length);
const SUBLINE = SCENE.subline ?? '';
const DATA_STRIP = SCENE.dataStrip?.[0] ?? '';
const WORDMARK = 'LearnRise';

const NODE_LABELS: readonly string[] = SCENE.screenText.flatMap((line) =>
  line.split('·').map((label) => label.trim()),
).filter((label) => label.length > 0);

const NODE_COUNT = NODE_LABELS.length;
const STAGE_W = 1536;
const STAGE_H = 560;
const NODE_W = 132;
const NODE_H = 80;
const NODE_RADIUS = 14;
const SLOT_GAP = (STAGE_W - NODE_W * NODE_COUNT) / Math.max(1, NODE_COUNT - 1);
const RING_RADIUS = 230;
const RING_START_DEG = -90;
const RING_STEP_DEG = 360 / NODE_COUNT;
const KICKER_DOT_PX = 11;
const CORE_GLOW_PX = 300;

const LIGHT_FIRST = 24;
const LIGHT_STEP = 28;
const LIGHT_FADE = 18;
const CONVERGE_FROM = 300;
const CONVERGE_TO = 450;
const RING_CLOSE_FROM = 330;
const RING_CLOSE_TO = 410;
const WORDMARK_FROM = 440;
const WORDMARK_TO = 480;

const litAt = (index: number) => LIGHT_FIRST + index * LIGHT_STEP;

const nodeProgress = (frame: number, index: number) =>
  easeOutCubic(clamp01((frame - litAt(index)) / LIGHT_FADE));

const segmentProgress = (frame: number, index: number) => {
  if (index === NODE_COUNT - 1) {
    return easeOutCubic(clamp01((frame - RING_CLOSE_FROM) / (RING_CLOSE_TO - RING_CLOSE_FROM)));
  }
  return easeOutCubic(clamp01((frame - litAt(index + 1)) / 14));
};

const stagePoint = (
  index: number,
  converge: number,
): {x: number; y: number} => {
  const pipelineX = NODE_W / 2 + index * (NODE_W + SLOT_GAP);
  const angle = ((RING_START_DEG + index * RING_STEP_DEG) * Math.PI) / 180;
  const ringX = STAGE_W / 2 + RING_RADIUS * Math.cos(angle);
  const ringY = STAGE_H / 2 + RING_RADIUS * Math.sin(angle);
  return {
    x: lerp(pipelineX, ringX, converge),
    y: lerp(STAGE_H / 2, ringY, converge),
  };
};

export const S02Loop: React.FC<{theme?: ThemeName}> = ({theme = 'dark'}) => {
  const {palette, type, space, stroke, motion} = tokens[theme];
  const layout = useLayout();
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const kickerIn = useEnter(0, motion.enter);

  const converge = easeInOutCubic(
    clamp01((frame - CONVERGE_FROM) / (CONVERGE_TO - CONVERGE_FROM)),
  );
  const ringIn = clamp01((frame - RING_CLOSE_FROM) / (RING_CLOSE_TO - RING_CLOSE_FROM));
  const wordmarkIn = easeOutCubic(
    clamp01((frame - WORDMARK_FROM) / (WORDMARK_TO - WORDMARK_FROM)),
  );
  const pulse = 0.65 + 0.35 * Math.sin(frame / (fps * 0.7));

  return (
    <AbsoluteFill
      style={{
        fontFamily: FONT_FAMILIES.sans,
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        paddingLeft: layout.safe.side,
        paddingRight: layout.safe.side,
        paddingBottom: layout.px(96),
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

      <div style={{marginTop: layout.gap(space.xl)}}>
        <div
          style={{
            position: 'relative',
            width: layout.px(STAGE_W),
            height: layout.px(STAGE_H),
          }}
        >
          <div
            style={{
              position: 'absolute',
              left: layout.px(STAGE_W / 2 - CORE_GLOW_PX / 2),
              top: layout.px(STAGE_H / 2 - CORE_GLOW_PX / 2),
              width: layout.px(CORE_GLOW_PX),
              height: layout.px(CORE_GLOW_PX),
              borderRadius: '50%',
              background: `radial-gradient(circle, ${palette.accent} 0%, transparent 66%)`,
              opacity: 0.16 * ringIn * pulse,
              filter: `blur(${layout.px(24)}px)`,
              pointerEvents: 'none',
            }}
          />

          <svg
            width="100%"
            height="100%"
            viewBox={`0 0 ${STAGE_W} ${STAGE_H}`}
            style={{position: 'absolute', inset: 0, overflow: 'visible'}}
          >
            <circle
              cx={STAGE_W / 2}
              cy={STAGE_H / 2}
              r={RING_RADIUS}
              fill="none"
              stroke={palette.stroke}
              strokeWidth={stroke.hair}
              strokeDasharray="3 10"
              opacity={ringIn * 0.9}
            />
            <circle
              cx={STAGE_W / 2}
              cy={STAGE_H / 2}
              r={RING_RADIUS}
              fill="none"
              stroke={palette.accent}
              strokeWidth={stroke.thin}
              strokeLinecap="round"
              strokeDasharray={`${RING_RADIUS * 1.1} ${RING_RADIUS * 8}`}
              strokeDashoffset={-frame * 2.4}
              opacity={ringIn * 0.85}
            />
            {NODE_LABELS.map((_, index) => {
              const visible = segmentProgress(frame, index);
              if (visible <= 0) return null;
              const from = stagePoint(index, converge);
              const to =
                index === NODE_COUNT - 1
                  ? stagePoint(0, converge)
                  : stagePoint(index + 1, converge);
              return (
                <line
                  key={`link-${index}`}
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  stroke={palette.accent}
                  strokeWidth={stroke.thin}
                  strokeLinecap="round"
                  opacity={visible * 0.62}
                />
              );
            })}
          </svg>

          {NODE_LABELS.map((label, index) => {
            const point = stagePoint(index, converge);
            const lit = nodeProgress(frame, index);
            const active = lit > 0.02;
            return (
              <div
                key={label}
                style={{
                  position: 'absolute',
                  left: layout.px(point.x),
                  top: layout.px(point.y),
                  width: layout.px(NODE_W),
                  height: layout.px(NODE_H),
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: layout.px(NODE_RADIUS),
                  border: `${active ? stroke.thin : stroke.hair}px solid ${
                    active ? palette.accent : palette.stroke
                  }`,
                  background: active ? palette.surfaceStrong : palette.surface,
                  boxShadow: active
                    ? `0 0 ${layout.px(26) * lit}px ${palette.accent}`
                    : 'none',
                  transform: `translate(-50%, -50%) scale(${lerp(1, 0.94, converge)})`,
                  opacity: 0.45 + 0.55 * Math.max(lit, 0.4 * ringIn),
                }}
              >
                <div
                  {...textAudit(label)}
                  style={{
                    fontSize: layout.font(type.body),
                    fontWeight: lit > 0.5 ? type.weight.bold : type.weight.medium,
                    letterSpacing: `${type.tracking.wide}em`,
                    color: lit > 0.5 ? palette.ink : palette.inkMuted,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {label}
                </div>
              </div>
            );
          })}

          <div
            style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              transform: `translate(-50%, -50%) scale(${lerp(0.9, 1, wordmarkIn)})`,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: layout.gap(space.sm),
              opacity: wordmarkIn,
            }}
          >
            <div
              {...textAudit(WORDMARK)}
              style={{
                fontSize: layout.font(type.display3),
                fontWeight: type.weight.black,
                letterSpacing: `${type.tracking.tight}em`,
                color: palette.ink,
                lineHeight: type.leading.tight,
                whiteSpace: 'nowrap',
              }}
            >
              {WORDMARK}
            </div>
            <div
              style={{
                width: layout.px(96) * wordmarkIn,
                height: stroke.thin,
                background: palette.accent,
                boxShadow: `0 0 ${layout.px(12)}px ${palette.accent}`,
              }}
            />
          </div>
        </div>
      </div>

      <Fade delay={motion.stagger * 4} theme={theme} y={6} style={{marginTop: layout.gap(space.lg)}}>
        <div
          {...textAudit(SUBLINE)}
          style={{
            fontSize: layout.font(type.body),
            fontWeight: type.weight.regular,
            letterSpacing: `${type.tracking.wide}em`,
            color: palette.inkMuted,
            lineHeight: type.leading.normal,
            whiteSpace: 'nowrap',
          }}
        >
          {SUBLINE}
        </div>
      </Fade>

      <Fade delay={motion.stagger * 6} theme={theme} y={6} style={{marginTop: layout.gap(space.md)}}>
        <div
          {...textAudit(DATA_STRIP)}
          style={{
            fontFamily: FONT_FAMILIES.mono,
            fontSize: layout.font(type.label),
            fontWeight: type.weight.medium,
            letterSpacing: `${type.tracking.wider}em`,
            color: palette.accentText,
            whiteSpace: 'nowrap',
          }}
        >
          {DATA_STRIP}
        </div>
      </Fade>
      <AbsoluteFill
        style={{
          backgroundImage: `url("data:image/svg+xml,${GRAIN_SVG}")`,
          backgroundPosition: `${(frame * 3) % GRAIN_TILE_PX}px ${(frame * 2) % GRAIN_TILE_PX}px`,
          opacity: 0.1,
          mixBlendMode: 'screen',
          pointerEvents: 'none',
        }}
      />
    </AbsoluteFill>
  );
};
