/**
 * S11 — the closing frame.
 *
 * Stack line, two-line claim, geometric wordmark and a five-part fact strip,
 * all built from token geometry. The authored content fades to the living
 * backdrop before the last frame; the accent bloom stays lit so the cut never
 * lands on black.
 */

import React from 'react';
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import {SCENE_BY_ID} from '../content/film';
import {
  API_OPERATIONS,
  API_PATHS,
  STACK_LINE,
  TESTS_COLLECTED,
  TESTS_PASSED,
  TESTS_SKIPPED,
} from '../content/facts';
import {FONT_FAMILIES} from '../fonts';
import {clamp01} from '../lib/anim';
import {useLayout} from '../theme/layout';
import {tokens, type ThemeName} from '../theme/tokens';
import {Fade, LineReveal, textAudit} from '../components/Typography';

const CONTENT_FADE_START = 438;
const CONTENT_FADE_END = 474;
const MARK_SIZE = 112;
const RING_WIDTH = 1040;
const RING_HEIGHT = 280;
const DATA_STRIP_WIDTH = 1240;
const CLAIM_RULE_WIDTH = 420;

const STATS = [
  {value: API_PATHS, label: 'API', tone: 'ink'},
  {value: API_OPERATIONS, label: 'OPS', tone: 'ink'},
  {value: TESTS_COLLECTED, label: 'TESTS', tone: 'ink'},
  {value: TESTS_PASSED, label: 'PASSED', tone: 'accentAltText'},
  {value: TESTS_SKIPPED, label: 'SKIPPED', tone: 'warnText'},
] as const;

const withAlpha = (hex: string, alpha: number) =>
  `${hex}${Math.round(clamp01(alpha) * 255)
    .toString(16)
    .padStart(2, '0')}`;

const range = (frame: number, from: number, to: number) =>
  clamp01(
    interpolate(frame, [from, to], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }),
  );

const Mark: React.FC<{theme: ThemeName}> = ({theme}) => {
  const {palette} = tokens[theme];
  const layout = useLayout();
  const size = layout.px(MARK_SIZE);

  return (
    <svg width={size} height={size} viewBox="0 0 112 112" aria-hidden>
      <path
        d="M8 86 L104 26"
        stroke={palette.accent}
        strokeWidth="6"
        strokeLinecap="square"
      />
      <rect x="8" y="78" width="20" height="20" fill={palette.accentAlt} />
      <rect x="46" y="54" width="20" height="20" fill={palette.ink} opacity={0.88} />
      <rect x="84" y="18" width="20" height="20" fill={palette.accentAlt} />
    </svg>
  );
};

const Orbit: React.FC<{theme: ThemeName; frame: number}> = ({theme, frame}) => {
  const {palette, stroke} = tokens[theme];
  const layout = useLayout();
  return (
    <div
      style={{
        position: 'absolute',
        left: '50%',
        top: '50%',
        width: layout.px(RING_WIDTH),
        height: layout.px(RING_HEIGHT),
        transform: `translate(-50%, -50%) rotate(${frame * 0.22}deg)`,
        borderRadius: '50%',
        border: `${stroke.hair}px dashed ${palette.stroke}`,
        opacity: 0.8,
      }}
    />
  );
};

const StackRow: React.FC<{theme: ThemeName}> = ({theme}) => {
  const {palette, type, space} = tokens[theme];
  const layout = useLayout();
  const segments = STACK_LINE.split(' · ');

  return (
    <Fade delay={0} theme={theme}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: layout.gap(space.sm),
          flexWrap: 'nowrap',
        }}
      >
        {segments.map((segment, index) => (
          <React.Fragment key={segment}>
            {index === 0 ? null : (
              <div
                style={{
                  width: layout.px(5),
                  height: layout.px(5),
                  borderRadius: '50%',
                  background: palette.accent,
                  boxShadow: `0 0 ${layout.px(space.sm)}px ${palette.accent}`,
                }}
              />
            )}
            <div
              {...textAudit(segment)}
              style={{
                fontFamily: FONT_FAMILIES.mono,
                fontSize: layout.font(type.label),
                fontWeight: type.weight.medium,
                letterSpacing: `${type.tracking.wider}em`,
                color: palette.inkMuted,
                whiteSpace: 'nowrap',
              }}
            >
              {segment}
            </div>
          </React.Fragment>
        ))}
      </div>
    </Fade>
  );
};

const DataStrip: React.FC<{theme: ThemeName}> = ({theme}) => {
  const {palette, type, space, radius, stroke} = tokens[theme];
  const layout = useLayout();

  return (
    <div
      style={{
        width: layout.px(DATA_STRIP_WIDTH),
        display: 'flex',
        alignItems: 'stretch',
        borderRadius: layout.px(radius.lg),
        border: `${stroke.hair}px solid ${palette.stroke}`,
        background: palette.surface,
        paddingTop: layout.gap(space.md),
        paddingBottom: layout.gap(space.md),
      }}
    >
      {STATS.map((stat, index) => (
        <React.Fragment key={stat.label}>
          {index === 0 ? null : (
            <div
              style={{
                width: stroke.hair,
                background: palette.strokeSoft,
                marginTop: layout.gap(space.xs),
                marginBottom: layout.gap(space.xs),
              }}
            />
          )}
          <Fade
            delay={96 + index * 6}
            theme={theme}
            style={{flex: 1, display: 'flex', justifyContent: 'center'}}
          >
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: layout.gap(2),
              }}
            >
              <div
                {...textAudit(String(stat.value))}
                style={{
                  fontSize: layout.font(type.head),
                  fontWeight: type.weight.black,
                  lineHeight: type.leading.tight,
                  color: palette[stat.tone],
                  whiteSpace: 'nowrap',
                }}
              >
                {stat.value}
              </div>
              <div
                {...textAudit(stat.label)}
                style={{
                  fontFamily: FONT_FAMILIES.mono,
                  fontSize: layout.font(type.label),
                  fontWeight: type.weight.medium,
                  letterSpacing: `${type.tracking.wider}em`,
                  color: palette.inkMuted,
                  whiteSpace: 'nowrap',
                }}
              >
                {stat.label}
              </div>
            </div>
          </Fade>
        </React.Fragment>
      ))}
    </div>
  );
};

export const S11Outro: React.FC<{theme?: ThemeName}> = ({theme = 'dark'}) => {
  const scene = SCENE_BY_ID.S11;
  const {palette, type, space, stroke} = tokens[theme];
  const layout = useLayout();
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  const contentOpacity = 1 - range(frame, CONTENT_FADE_START, CONTENT_FADE_END);
  const claimRule = range(frame, 52, 112);
  const kicker = '10 / 收尾';
  const dotPulse = 0.75 + 0.25 * Math.sin(frame / (fps * 0.55));
  const glowDriftX = Math.sin(frame / 57);
  const glowDriftY = Math.cos(frame / 71);
  const glowScale = 1 + 0.05 * Math.sin(frame / 36);
  const glowDriftXAlt = Math.cos(frame / 49);
  const glowDriftYAlt = Math.sin(frame / 61);
  const glowScaleAlt = 1 + 0.06 * Math.cos(frame / 33);

  return (
    <AbsoluteFill style={{fontFamily: FONT_FAMILIES.sans}}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '46%',
            width: layout.px(1180),
            height: layout.px(640),
            transform: `translate(-50%, -50%) translate(${layout.px(glowDriftX * 80)}px, ${layout.px(glowDriftY * 46)}px) scale(${glowScale})`,
            background: `radial-gradient(ellipse, ${withAlpha(palette.accent, 0.34)} 0%, ${withAlpha(palette.accent, 0.26)} 24%, ${withAlpha(palette.accent, 0.15)} 44%, ${withAlpha(palette.accent, 0.06)} 58%, ${withAlpha(palette.accent, 0)} 70%, transparent 82%)`,
            opacity: 0.8 + 0.2 * Math.sin(frame / 30),
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '62%',
            width: layout.px(820),
            height: layout.px(420),
            transform: `translate(-50%, -50%) translate(${layout.px(glowDriftXAlt * 90)}px, ${layout.px(glowDriftYAlt * 54)}px) scale(${glowScaleAlt})`,
            background: `radial-gradient(ellipse, ${withAlpha(palette.accentAlt, 0.27)} 0%, ${withAlpha(palette.accentAlt, 0.2)} 24%, ${withAlpha(palette.accentAlt, 0.11)} 44%, ${withAlpha(palette.accentAlt, 0.04)} 58%, ${withAlpha(palette.accentAlt, 0)} 70%, transparent 82%)`,
            opacity: 0.62 + 0.22 * Math.cos(frame / 27),
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: layout.safe.side,
            right: layout.safe.side,
            top: layout.px(946),
            height: stroke.hair,
            background: `linear-gradient(90deg, transparent, ${palette.accent}, transparent)`,
            opacity: 0.42 + 0.12 * Math.sin(frame / 30),
          }}
        />
      </div>

      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          paddingLeft: layout.safe.side,
          paddingRight: layout.safe.side,
          paddingTop: layout.safe.top,
          paddingBottom: layout.safe.bottom,
          opacity: contentOpacity,
        }}
      >
        <div style={{display: 'flex', alignItems: 'center', gap: layout.gap(space.sm)}}>
          <div
            style={{
              width: layout.px(9),
              height: layout.px(9),
              background: palette.accent,
              boxShadow: `0 0 ${layout.px(space.md) * dotPulse}px ${palette.accent}`,
              opacity: dotPulse,
            }}
          />
          <div
            {...textAudit(kicker)}
            style={{
              fontFamily: FONT_FAMILIES.mono,
              fontSize: layout.font(type.label),
              fontWeight: type.weight.medium,
              letterSpacing: `${type.tracking.wider}em`,
              color: palette.inkMuted,
              whiteSpace: 'nowrap',
            }}
          >
            {kicker}
          </div>
        </div>

        <div style={{marginTop: layout.gap(space.sm)}}>
          <StackRow theme={theme} />
        </div>

        <div style={{marginTop: layout.gap(space.md), textAlign: 'center'}}>
          {scene.screenText.map((line, index) => (
            <LineReveal
              key={line}
              delay={18 + index * tokens[theme].motion.stagger}
              theme={theme}
            >
              <div
                {...textAudit(line)}
                style={{
                  fontSize: layout.font(type.display2),
                  fontWeight:
                    index === 0 ? type.weight.regular : type.weight.black,
                  lineHeight: type.leading.tight,
                  letterSpacing: `${type.tracking.tight}em`,
                  color: index === 0 ? palette.inkMuted : palette.ink,
                  whiteSpace: 'nowrap',
                }}
              >
                {line}
              </div>
            </LineReveal>
          ))}
          <div
            style={{
              marginTop: layout.gap(space.xs),
              marginLeft: 'auto',
              marginRight: 'auto',
              width: layout.px(CLAIM_RULE_WIDTH) * claimRule,
              height: stroke.thin,
              background: palette.accent,
              boxShadow: `0 0 ${layout.px(space.md)}px ${palette.accent}`,
            }}
          />
        </div>

        <div
          style={{
            position: 'relative',
            marginTop: layout.gap(space.sm),
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: layout.gap(space.md),
          }}
        >
          <Orbit theme={theme} frame={frame} />
          <Mark theme={theme} />
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              letterSpacing: `${type.tracking.tight}em`,
            }}
          >
            <div
              {...textAudit('Learn')}
              style={{
                fontSize: layout.font(type.display1),
                fontWeight: type.weight.black,
                lineHeight: type.leading.tight,
                color: palette.ink,
                whiteSpace: 'nowrap',
              }}
            >
              Learn
            </div>
            <div
              {...textAudit('Rise')}
              style={{
                fontSize: layout.font(type.display1),
                fontWeight: type.weight.black,
                lineHeight: type.leading.tight,
                color: palette.accentText,
                whiteSpace: 'nowrap',
              }}
            >
              Rise
            </div>
          </div>
        </div>

        <div style={{marginTop: layout.gap(space.xl)}}>
          <DataStrip theme={theme} />
        </div>

        <Fade delay={126} theme={theme}>
          <div
            {...textAudit(scene.subline ?? '')}
            style={{
              marginTop: layout.gap(space.sm),
              fontSize: layout.font(type.body),
              fontWeight: type.weight.regular,
              color: palette.inkMuted,
              textAlign: 'center',
              whiteSpace: 'nowrap',
            }}
          >
            {scene.subline}
          </div>
        </Fade>
      </div>
    </AbsoluteFill>
  );
};
