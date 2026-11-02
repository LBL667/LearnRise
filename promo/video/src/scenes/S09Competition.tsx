/**
 * Scene 9 — Competition (local frames 0–599, 20 s).
 *
 * Three beats: the create dialog (owner + invite code), the class leaderboard,
 * and the study dashboard. The leaderboard is the cast source of record —
 * `LEADERBOARD` is students only, so the plate can never pick up a teacher row,
 * and it renders the first four rows with their exact points.
 *
 * The scene adds no product sentence: names, points and the invite code come
 * from `cast.ts`; the data strip comes from `SCENE_BY_ID.S09`. There is no
 * pagination control and no real-time claim anywhere in this file.
 */

import React from 'react';
import {
  AbsoluteFill,
  staticFile,
  useCurrentFrame,
} from 'remotion';
import {CAST, LEADERBOARD} from '../content/cast';
import {SCENE_BY_ID} from '../content/film';
import {FONT_FAMILIES} from '../fonts';
import {useLayout, type Layout} from '../theme/layout';
import {tokens, type ThemeName} from '../theme/tokens';
import {Fade, LineReveal, textAudit} from '../components/Typography';

const SCENE_ID = 'S09';

const STEP_LABELS = ['CREATE', 'RANK', 'DASHBOARD'] as const;

type Beat = {
  readonly src: string;
  readonly from: number;
  readonly to: number;
  readonly fx: number;
  readonly fy: number;
  readonly scale: number;
};

const BEATS: readonly Beat[] = [
  {src: 'ui/s09-create-competition-dialog.png', from: 0, to: 212, fx: 960, fy: 540, scale: 0.8},
  {src: 'ui/s09-leaderboard.png', from: 202, to: 412, fx: 960, fy: 368, scale: 0.8},
  {src: 'ui/s09-dashboard.png', from: 402, to: 600, fx: 960, fy: 350, scale: 0.8},
];

const CAPTURE_W = 1920;
const CAPTURE_H = 1080;
const STAGE_RADIUS = 28;
const STAGE_BORDER = 1;
const CORNER = 26;
const CORNER_INSET = 16;
const CHIP_PAD_X = 18;
const CHIP_PAD_Y = 10;
const LEADERBOARD_ROWS = 4;

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const activeBeat = (frame: number): number => {
  const found = BEATS.findIndex((beat) => frame >= beat.from && frame < beat.to);
  return found === -1 ? BEATS.length - 1 : found;
};

const cameraFor = (beat: Beat, stageW: number, stageH: number, frame: number) => {
  const local = frame - beat.from;
  const progress = clamp01(local / Math.max(1, beat.to - beat.from));
  const scale = beat.scale * (1.02 - 0.02 * progress);
  const width = CAPTURE_W * scale;
  const height = CAPTURE_H * scale;
  const left = clamp(stageW / 2 - beat.fx * scale, Math.min(0, stageW - width), 0);
  const top = clamp(stageH / 2 - beat.fy * scale, Math.min(0, stageH - height), 0);
  return {left, top, scale};
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
  const {left, top, scale} = cameraFor(beat, stageW, stageH, frame);

  return (
    <img
      src={staticFile(beat.src)}
      alt=""
      data-asset-natural-width={CAPTURE_W}
      style={{
        position: 'absolute',
        left,
        top,
        width: CAPTURE_W * scale,
        height: CAPTURE_H * scale,
        opacity,
        transform: `translateY(${(1 - enter) * 16}px)`,
        objectFit: 'cover',
      }}
    />
  );
};

const Plate: React.FC<{
  theme: ThemeName;
  layout: Layout;
  style?: React.CSSProperties;
  children: React.ReactNode;
}> = ({theme, layout, style, children}) => {
  const {palette, stroke} = tokens[theme];
  return (
    <div
      style={{
        padding: `${layout.px(CHIP_PAD_Y)}px ${layout.px(CHIP_PAD_X)}px`,
        borderRadius: layout.px(16),
        background: palette.bgAlt,
        border: `${stroke.hair}px solid ${palette.stroke}`,
        boxShadow: `0 ${layout.px(18)}px ${layout.px(36)}px rgba(0, 0, 0, 0.45)`,
        ...style,
      }}
    >
      {children}
    </div>
  );
};

export const S09Competition: React.FC<{theme?: ThemeName}> = ({
  theme = 'dark',
}) => {
  const scene = SCENE_BY_ID[SCENE_ID];
  const {palette, type, space, stroke} = tokens[theme];
  const layout = useLayout();
  const frame = useCurrentFrame();
  const step = activeBeat(frame);
  const x = layout.safe.side;
  const y = layout.px(340);
  const w = layout.px(1536);
  const h = layout.px(570);
  const dashboard = cameraFor(BEATS[2], w, h, frame);
  const scanTop = layout.px(90) + dashboard.scale * 820 * clamp01((frame - 402) / 190);
  const rows = LEADERBOARD.slice(0, LEADERBOARD_ROWS);
  const owner = CAST.teachers[0]?.name ?? '';

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

        {step === 2 ? (
          <div
            aria-hidden
            style={{
              position: 'absolute',
              left: layout.px(60),
              right: layout.px(60),
              top: scanTop,
              height: layout.px(2),
              background: `linear-gradient(90deg, transparent, ${palette.accent}, transparent)`,
              opacity: 0.4,
              pointerEvents: 'none',
            }}
          />
        ) : null}

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

        {step === 0 ? (
          <div
            style={{
              position: 'absolute',
              left: layout.px(24),
              bottom: layout.px(24),
              display: 'flex',
              gap: layout.gap(space.sm),
            }}
          >
            <Fade delay={48} theme={theme}>
              <Plate theme={theme} layout={layout}>
                <div style={{display: 'flex', alignItems: 'baseline', gap: layout.px(10)}}>
                  <div
                    {...textAudit('OWNER')}
                    style={{
                      fontFamily: FONT_FAMILIES.mono,
                      fontSize: layout.font(type.label),
                      fontWeight: type.weight.regular,
                      letterSpacing: `${type.tracking.wider}em`,
                      color: palette.inkMuted,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    OWNER
                  </div>
                  <div
                    {...textAudit(owner)}
                    style={{
                      fontSize: layout.font(type.label),
                      fontWeight: type.weight.bold,
                      color: palette.ink,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {owner}
                  </div>
                </div>
              </Plate>
            </Fade>
            <Fade delay={58} theme={theme}>
              <Plate theme={theme} layout={layout}>
                <div style={{display: 'flex', alignItems: 'baseline', gap: layout.px(10)}}>
                  <div
                    {...textAudit('INVITE')}
                    style={{
                      fontFamily: FONT_FAMILIES.mono,
                      fontSize: layout.font(type.label),
                      fontWeight: type.weight.regular,
                      letterSpacing: `${type.tracking.wider}em`,
                      color: palette.inkMuted,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    INVITE
                  </div>
                  <div
                    {...textAudit(CAST.inviteCode)}
                    style={{
                      fontFamily: FONT_FAMILIES.mono,
                      fontSize: layout.font(type.label),
                      fontWeight: type.weight.bold,
                      color: palette.accentText,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {CAST.inviteCode}
                  </div>
                </div>
              </Plate>
            </Fade>
          </div>
        ) : null}

        {step === 1 ? (
          <div
            style={{
              position: 'absolute',
              left: layout.px(24),
              bottom: layout.px(24),
            }}
          >
            <Fade delay={222} theme={theme}>
              <Plate theme={theme} layout={layout} style={{minWidth: layout.px(340)}}>
                <div
                  {...textAudit('TOP 4')}
                  style={{
                    fontFamily: FONT_FAMILIES.mono,
                    fontSize: layout.font(type.label),
                    fontWeight: type.weight.medium,
                    letterSpacing: `${type.tracking.wider}em`,
                    color: palette.inkMuted,
                    marginBottom: layout.px(8),
                  }}
                >
                  TOP 4
                </div>
                {rows.map((student, index) => (
                  <div
                    key={student.id}
                    style={{
                      display: 'flex',
                      alignItems: 'baseline',
                      gap: layout.px(14),
                      padding: `${layout.px(4)}px 0`,
                    }}
                  >
                    <div
                      {...textAudit(`0${index + 1}`)}
                      style={{
                        fontFamily: FONT_FAMILIES.mono,
                        fontSize: layout.font(type.label),
                        fontWeight: type.weight.bold,
                        color: index === 0 ? palette.accentText : palette.inkMuted,
                        width: layout.px(28),
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {`0${index + 1}`}
                    </div>
                    <div
                      {...textAudit(student.name)}
                      style={{
                        fontSize: layout.font(type.label),
                        fontWeight: type.weight.medium,
                        color: palette.ink,
                        flex: 1,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {student.name}
                    </div>
                    <div
                      {...textAudit(String(student.points))}
                      style={{
                        fontFamily: FONT_FAMILIES.mono,
                        fontSize: layout.font(type.label),
                        fontWeight: type.weight.bold,
                        color: palette.accentAltText,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {student.points}
                    </div>
                  </div>
                ))}
              </Plate>
            </Fade>
          </div>
        ) : null}

        {step === 2 && scene.dataStrip !== undefined ? (
          <div
            style={{
              position: 'absolute',
              left: layout.px(24),
              bottom: layout.px(24),
            }}
          >
            <Fade delay={422} theme={theme}>
              <Plate theme={theme} layout={layout}>
                <div
                  {...textAudit(scene.dataStrip[0])}
                  style={{
                    fontFamily: FONT_FAMILIES.mono,
                    fontSize: layout.font(type.label),
                    fontWeight: type.weight.medium,
                    letterSpacing: `${type.tracking.wider}em`,
                    color: palette.ink,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {scene.dataStrip[0]}
                </div>
              </Plate>
            </Fade>
          </div>
        ) : null}

        <div
          style={{
            position: 'absolute',
            right: layout.px(24),
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
