/**
 * Scene 7 — Practice (local frames 0–659, 22 s).
 *
 * Five beats read left-to-right in time, not in space: one practice session,
 * the answered state, the session summary, the weak-point diagnosis, and the
 * remediation / exam plan. The UI captures are cropped by a moving camera
 * (focus + scale per beat) instead of being squeezed into a thumbnail, so the
 * real product chrome stays legible at 1080p.
 *
 * All copy is read from `SCENE_BY_ID.S07`; this file owns only English beat
 * labels and geometry. Colours, type sizes and durations come from
 * `tokens[theme]`; the global Backdrop/Rail/CutFlash own the page chrome.
 */

import React from 'react';
import {
  AbsoluteFill,
  staticFile,
  useCurrentFrame,
} from 'remotion';
import {SCENE_BY_ID} from '../content/film';
import {FONT_FAMILIES} from '../fonts';
import {useLayout, type Layout} from '../theme/layout';
import {tokens, type ThemeName} from '../theme/tokens';
import {Fade, LineReveal, textAudit} from '../components/Typography';

const SCENE_ID = 'S07';

const STEP_LABELS = [
  'SESSION',
  'FEEDBACK',
  'SUMMARY',
  'WEAK POINTS',
  'PLAN',
] as const;

type Beat = {
  readonly src: string;
  readonly from: number;
  readonly to: number;
  /** Focus point in the 1920×1080 capture. */
  readonly fx: number;
  readonly fy: number;
  /** CSS scale applied to the capture before cropping. */
  readonly scale: number;
};

const BEATS: readonly Beat[] = [
  {src: 'ui/s07-practice-session.png', from: 0, to: 142, fx: 1086, fy: 470, scale: 0.9},
  {src: 'ui/s07-practice-answered.png', from: 132, to: 288, fx: 1086, fy: 500, scale: 0.9},
  {src: 'ui/s07-practice-summary.png', from: 278, to: 424, fx: 1086, fy: 380, scale: 0.88},
  {src: 'ui/s07-weak-points.png', from: 414, to: 548, fx: 1300, fy: 500, scale: 0.9},
  {src: 'ui/s07-plan-panel.png', from: 538, to: 660, fx: 1150, fy: 845, scale: 0.9},
];

const CAPTURE_W = 1920;
const CAPTURE_H = 1080;
const STAGE_RADIUS = 28;
const STAGE_BORDER = 1;
const CORNER = 26;
const CORNER_INSET = 16;
const CHIP_PAD_X = 18;
const CHIP_PAD_Y = 10;

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const activeBeat = (frame: number): number => {
  const found = BEATS.findIndex((beat) => frame >= beat.from && frame < beat.to);
  return found === -1 ? BEATS.length - 1 : found;
};

const Header: React.FC<{
  theme: ThemeName;
  layout: Layout;
  frame: number;
  step: number;
}> = ({theme, layout, frame, step}) => {
  const scene = SCENE_BY_ID[SCENE_ID];
  const {palette, type, space, stroke, motion} = tokens[theme];
  const [index, label] = (scene.kicker ?? '').split(' / ');
  const pulse = 0.7 + 0.3 * Math.sin(frame / 24);
  const top = layout.safe.top + layout.px(12);

  return (
    <div
      style={{
        position: 'absolute',
        left: layout.safe.side,
        right: layout.safe.side,
        top,
      }}
    >
      <div style={{display: 'flex', alignItems: 'center', gap: layout.gap(space.md)}}>
        <div
          aria-hidden
          style={{
            width: layout.px(11),
            height: layout.px(11),
            background: palette.accent,
            boxShadow: `0 0 ${layout.px(22) * pulse}px ${palette.accent}`,
          }}
        />
        <div
          {...textAudit(`${index} /`)}
          style={{
            fontFamily: FONT_FAMILIES.mono,
            fontSize: layout.font(type.label),
            fontWeight: type.weight.medium,
            letterSpacing: `${type.tracking.wider}em`,
            color: palette.inkMuted,
            whiteSpace: 'nowrap',
          }}
        >
          {`${index} /`}
        </div>
        {label === undefined ? null : (
          <div
            {...textAudit(label)}
            style={{
              fontSize: layout.font(type.label),
              fontWeight: type.weight.medium,
              letterSpacing: `${type.tracking.wide}em`,
              color: palette.inkMuted,
              whiteSpace: 'nowrap',
            }}
          >
            {label}
          </div>
        )}
        <div
          aria-hidden
          style={{
            flex: 1,
            height: stroke.hair,
            background: `linear-gradient(90deg, ${palette.stroke}, transparent)`,
          }}
        />
        <div style={{display: 'flex', alignItems: 'center', gap: layout.gap(space.xs)}}>
          {BEATS.map((beat, beatIndex) => (
            <div
              key={beat.src}
              aria-hidden
              style={{
                width: layout.px(beatIndex === step ? 34 : 14),
                height: layout.px(4),
                borderRadius: layout.px(2),
                background: beatIndex === step ? palette.accent : palette.stroke,
              }}
            />
          ))}
        </div>
      </div>

      <div style={{marginTop: layout.gap(space.sm)}}>
        {scene.screenText.map((line, lineIndex) => (
          <LineReveal
            key={line}
            delay={motion.stagger * (lineIndex + 1)}
            theme={theme}
          >
            <div
              {...textAudit(line)}
              style={{
                fontSize: layout.font(type.display2),
                fontWeight: type.weight.black,
                color: palette.ink,
                letterSpacing: `${type.tracking.normal}em`,
                lineHeight: type.leading.snug,
                whiteSpace: 'nowrap',
              }}
            >
              {line}
            </div>
          </LineReveal>
        ))}
      </div>

      <div
        style={{
          marginTop: layout.gap(space.sm),
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: layout.gap(space.lg),
        }}
      >
        {scene.subline === undefined ? null : (
          <Fade delay={motion.stagger * (scene.screenText.length + 2)} theme={theme}>
            <div
              {...textAudit(scene.subline)}
              style={{
                fontSize: layout.font(type.body),
                fontWeight: type.weight.regular,
                color: palette.inkMuted,
                lineHeight: type.leading.normal,
              }}
            >
              {scene.subline}
            </div>
          </Fade>
        )}
        {scene.footnote === undefined ? null : (
          <Fade delay={motion.stagger * (scene.screenText.length + 3)} theme={theme}>
            <div
              {...textAudit(scene.footnote)}
              style={{
                fontFamily: FONT_FAMILIES.mono,
                fontSize: layout.font(type.label),
                fontWeight: type.weight.regular,
                color: palette.inkFaint,
                letterSpacing: `${type.tracking.normal}em`,
                lineHeight: type.leading.normal,
                whiteSpace: 'nowrap',
              }}
            >
              {scene.footnote}
            </div>
          </Fade>
        )}
      </div>
    </div>
  );
};

const Capture: React.FC<{
  beat: Beat;
  frame: number;
  stageW: number;
  stageH: number;
}> = ({beat, frame, stageW, stageH}) => {
  const last = beat === BEATS[BEATS.length - 1];
  const local = frame - beat.from;
  const enter = clamp01(local / 14);
  const leave = last ? 1 : clamp01((beat.to - frame) / 12);
  const opacity = Math.min(enter, leave);
  const progress = clamp01(local / Math.max(1, beat.to - beat.from));
  const scale = beat.scale * (1.02 - 0.02 * progress);
  const width = CAPTURE_W * scale;
  const height = CAPTURE_H * scale;
  const left = clamp(
    stageW / 2 - beat.fx * scale,
    Math.min(0, stageW - width),
    0,
  );
  const top = clamp(
    stageH / 2 - beat.fy * scale,
    Math.min(0, stageH - height),
    0,
  );

  return (
    <img
      src={staticFile(beat.src)}
      alt=""
      data-asset-natural-width={CAPTURE_W}
      style={{
        position: 'absolute',
        left,
        top,
        width,
        height,
        opacity,
        transform: `translateY(${(1 - enter) * 16}px)`,
        objectFit: 'cover',
      }}
    />
  );
};

export const S07Practice: React.FC<{theme?: ThemeName}> = ({theme = 'dark'}) => {
  const {palette, type, space, stroke} = tokens[theme];
  const layout = useLayout();
  const frame = useCurrentFrame();
  const step = activeBeat(frame);
  const x = layout.safe.side;
  const y = layout.px(340);
  const w = layout.px(1536);
  const h = layout.px(570);

  return (
    <AbsoluteFill style={{fontFamily: FONT_FAMILIES.sans}}>
      <Header theme={theme} layout={layout} frame={frame} step={step} />

      <div
        style={{
          position: 'absolute',
          left: x,
          top: y,
          width: w,
          height: h,
          borderRadius: layout.px(STAGE_RADIUS),
          border: `${STAGE_BORDER}px solid ${palette.stroke}`,
          background: palette.surface,
          boxShadow: `0 ${layout.px(40)}px ${layout.px(90)}px rgba(0, 0, 0, 0.55)`,
          overflow: 'hidden',
        }}
      >
        {BEATS.map((beat) => (
          <Capture key={beat.src} beat={beat} frame={frame} stageW={w} stageH={h} />
        ))}

        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            background: `linear-gradient(180deg, rgba(5, 7, 12, 0.12) 0%, transparent 18%, transparent 82%, rgba(5, 7, 12, 0.24) 100%)`,
            pointerEvents: 'none',
          }}
        />

        {[0, 1, 2, 3].map((corner) => (
          <div
            key={corner}
            aria-hidden
            style={{
              position: 'absolute',
              top: corner < 2 ? layout.px(CORNER_INSET) : undefined,
              bottom: corner >= 2 ? layout.px(CORNER_INSET) : undefined,
              left: corner % 2 === 0 ? layout.px(CORNER_INSET) : undefined,
              right: corner % 2 === 1 ? layout.px(CORNER_INSET) : undefined,
              width: layout.px(CORNER),
              height: layout.px(CORNER),
              borderTop:
                corner < 2 ? `${stroke.thin}px solid ${palette.accentAlt}55` : undefined,
              borderBottom:
                corner >= 2 ? `${stroke.thin}px solid ${palette.accentAlt}55` : undefined,
              borderLeft:
                corner % 2 === 0 ? `${stroke.thin}px solid ${palette.accentAlt}55` : undefined,
              borderRight:
                corner % 2 === 1 ? `${stroke.thin}px solid ${palette.accentAlt}55` : undefined,
            }}
          />
        ))}

        <div
          style={{
            position: 'absolute',
            left: layout.px(24),
            bottom: layout.px(24),
            display: 'flex',
            alignItems: 'center',
            gap: layout.gap(space.sm),
            padding: `${layout.px(CHIP_PAD_Y)}px ${layout.px(CHIP_PAD_X)}px`,
            borderRadius: layout.px(999),
            background: palette.bgAlt,
            border: `${stroke.hair}px solid ${palette.stroke}`,
          }}
        >
          <div
            aria-hidden
            style={{
              width: layout.px(8),
              height: layout.px(8),
              borderRadius: '50%',
              background: palette.accentAlt,
              boxShadow: `0 0 ${layout.px(12)}px ${palette.accentAlt}`,
            }}
          />
          <Fade key={step} delay={0} theme={theme}>
            <div style={{display: 'flex', alignItems: 'baseline', gap: layout.px(10)}}>
              <div
                {...textAudit(`0${step + 1}`)}
                style={{
                  fontFamily: FONT_FAMILIES.mono,
                  fontSize: layout.font(type.label),
                  fontWeight: type.weight.bold,
                  color: palette.accentText,
                  whiteSpace: 'nowrap',
                }}
              >
                {`0${step + 1}`}
              </div>
              <div
                {...textAudit(STEP_LABELS[step])}
                style={{
                  fontFamily: FONT_FAMILIES.mono,
                  fontSize: layout.font(type.label),
                  fontWeight: type.weight.medium,
                  letterSpacing: `${type.tracking.wider}em`,
                  color: palette.ink,
                  whiteSpace: 'nowrap',
                }}
              >
                {STEP_LABELS[step]}
              </div>
            </div>
          </Fade>
        </div>
      </div>
    </AbsoluteFill>
  );
};
