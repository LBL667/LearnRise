/**
 * SceneStage — the shared, content-driven placeholder stage for T04.
 *
 * T09–T12 replace each scene's interior with its real visual language. Until
 * then this component proves every scene is independently renderable without
 * copying a single line of narration into a scene file.
 *
 * All copy comes from `src/content/film.ts`. This file contains no Chinese
 * sentence of its own, which keeps `npm run lint-content` honest.
 */

import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import {SCENE_BY_ID, type SceneId} from '../content/film';
import {FONT_FAMILIES} from '../fonts';
import {Fade, LineReveal, textAudit} from './Typography';
import {clamp01, useEnter} from '../lib/anim';
import {useLayout} from '../theme/layout';
import {tokens, type ThemeName} from '../theme/tokens';

const ACCENT_RULE_PX = 420;
const KICKER_DOT_PX = 11;

const lineSize = (text: string): number => {
  const characters = Array.from(text).length;
  return characters > 12 ? 64 : 96;
};

export const SceneStage: React.FC<{
  sceneId: SceneId;
  theme?: ThemeName;
}> = ({sceneId, theme = 'dark'}) => {
  const scene = SCENE_BY_ID[sceneId];
  const {palette, type, space, stroke, motion} = tokens[theme];
  const layout = useLayout();
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  const dot = useEnter(0, motion.enter);
  const pulse = 0.7 + 0.3 * Math.sin(frame / (fps * 0.8));
  const rule = clamp01(frame / (motion.enter * 2));
  const lastLine = scene.screenText.length - 1;

  return (
    <AbsoluteFill
      data-scene={scene.id}
      style={{
        fontFamily: FONT_FAMILIES.sans,
        justifyContent: 'center',
        alignItems: 'flex-start',
        paddingLeft: layout.safe.side,
        paddingRight: layout.safe.side,
        paddingTop: layout.safe.top,
        paddingBottom: layout.safe.bottom,
      }}
    >
      <div
        {...textAudit(scene.id)}
        style={{
          position: 'absolute',
          top: layout.safe.top,
          right: layout.safe.side,
          fontFamily: FONT_FAMILIES.mono,
          fontSize: layout.font(type.label),
          letterSpacing: `${type.tracking.wider}em`,
          color: palette.inkFaint,
        }}
      >
        {scene.id}
      </div>

      <div style={{maxWidth: layout.px(1280)}}>
        {scene.kicker === undefined ? null : (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: layout.gap(space.md),
              opacity: dot,
            }}
          >
            <div
              style={{
                width: layout.px(KICKER_DOT_PX),
                height: layout.px(KICKER_DOT_PX),
                background: palette.accent,
                boxShadow: `0 0 ${layout.px(KICKER_DOT_PX * 2) * pulse}px ${palette.accent}`,
              }}
            />
            <div
              {...textAudit(scene.kicker)}
              style={{
                fontSize: layout.font(type.label),
                fontWeight: type.weight.medium,
                letterSpacing: `${type.tracking.wider}em`,
                color: palette.inkMuted,
                whiteSpace: 'nowrap',
              }}
            >
              {scene.kicker}
            </div>
          </div>
        )}

        <div style={{marginTop: layout.gap(space.xxl)}}>
          {scene.screenText.map((line, index) => (
            <div
              key={line}
              style={{marginTop: index === 0 ? 0 : layout.gap(space.md)}}
            >
              <LineReveal
                delay={motion.stagger * (index + 1)}
                theme={theme}
              >
                <div
                  {...textAudit(line)}
                  style={{
                    fontSize: layout.font(lineSize(line)),
                    fontWeight:
                      index === lastLine
                        ? type.weight.black
                        : type.weight.regular,
                    color:
                      index === lastLine ? palette.ink : palette.inkMuted,
                    letterSpacing: `${type.tracking.normal}em`,
                    lineHeight: type.leading.snug,
                  }}
                >
                  {line}
                </div>
              </LineReveal>
            </div>
          ))}
        </div>

        <div
          style={{
            marginTop: layout.gap(space.lg),
            width: layout.px(ACCENT_RULE_PX) * rule,
            height: stroke.thin,
            background: palette.accent,
          }}
        />

        {scene.subline === undefined ? null : (
          <Fade
            delay={motion.stagger * (scene.screenText.length + 1)}
            theme={theme}
            style={{marginTop: layout.gap(space.lg)}}
          >
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
          <Fade
            delay={motion.stagger * (scene.screenText.length + 2)}
            theme={theme}
            style={{marginTop: layout.gap(space.md)}}
          >
            <div
              {...textAudit(scene.footnote)}
              style={{
                fontSize: layout.font(type.label),
                fontWeight: type.weight.regular,
                color: palette.inkFaint,
                letterSpacing: `${type.tracking.normal}em`,
                lineHeight: type.leading.normal,
              }}
            >
              {scene.footnote}
            </div>
          </Fade>
        )}

        {scene.dataStrip === undefined ? null : (
          <div
            style={{
              marginTop: layout.gap(space.xl),
              display: 'flex',
              flexDirection: 'column',
              gap: layout.gap(space.xs),
            }}
          >
            {scene.dataStrip.map((row, index) => (
              <Fade
                key={row}
                delay={motion.stagger * (scene.screenText.length + 3 + index)}
                theme={theme}
              >
                <div
                  {...textAudit(row)}
                  style={{
                    fontFamily: FONT_FAMILIES.mono,
                    fontSize: layout.font(type.label),
                    fontWeight: type.weight.medium,
                    letterSpacing: `${type.tracking.wider}em`,
                    color: palette.accentText,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {row}
                </div>
              </Fade>
            ))}
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
};
