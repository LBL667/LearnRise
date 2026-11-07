/**
 * ClipScene — the shared shell for every new-UI scene.
 *
 * The visual body is a single frozen browser clip (`public/clips/<Sxx>/clip.mp4`)
 * mounted through `HtmlClip`, full-bleed at the composition's native 1920×1080.
 * Copy is rendered in a self-contained lower-third panel so the clip area above
 * the panel stays pixel-identical to the frozen recording (PSNR region check in
 * `evidence`/`clips_manifest.json`).
 *
 * Copy comes from `film.ts`; this file contains no authored Chinese.
 * The clip is treated as immutable flat footage; the host `Sequence` duration
 * equals the clip's own frame count.
 */

import React from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {FONT_FAMILIES} from '../fonts';
import {useLayout} from '../theme/layout';
import {tokens, type ThemeName} from '../theme/tokens';
import {LineReveal, textAudit} from './Typography';
import {HtmlClip} from './HtmlClip';
import {useEnter, useLinear} from '../lib/anim';
import type {FilmScene} from '../content/film';

const FRAME_WIDTH = 1920;
const FRAME_HEIGHT = 1080;
const KICKER_DOT_PX = 10;
/** Lower-third panel geometry (design px at 1080p). */
const PANEL_HEIGHT_PX = 352;
const PANEL_PAD_X_PX = 96;
const PANEL_PAD_Y_PX = 162;

export type ClipSceneProps = {
  readonly scene: FilmScene;
  readonly theme?: ThemeName;
};

export const ClipScene: React.FC<ClipSceneProps> = ({scene, theme = 'dark'}) => {
  const {palette, type, space, stroke, motion} = tokens[theme];
  const layout = useLayout();
  const frame = useCurrentFrame();

  const kickerIn = useEnter(0, motion.enter);
  const underline = useLinear(
    motion.stagger * 3,
    motion.stagger * 3 + motion.enter,
  );

  const headline = scene.screenText;
  const kicker = scene.kicker ?? '';
  const subline = scene.subline ?? '';
  const footnote = scene.footnote ?? '';
  const strip = scene.dataStrip ?? [];
  const lastIndex = headline.length - 1;

  // Slide the panel up 18px over the first 6 frames, then hold.
  const panelRise = Math.max(0, 6 - frame) * 3;

  return (
    <AbsoluteFill style={{fontFamily: FONT_FAMILIES.sans, backgroundColor: palette.bg}}>
      <HtmlClip
        src={`clips/${scene.id}/clip.mp4`}
        width={FRAME_WIDTH}
        height={FRAME_HEIGHT}
        style={{position: 'absolute', inset: 0}}
      />

      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: layout.px(PANEL_HEIGHT_PX + 28),
          background: `linear-gradient(180deg, ${palette.bg}00 0%, ${palette.bg}d9 34%, ${palette.bg}f2 100%)`,
          pointerEvents: 'none',
          transform: `translateY(${layout.px(panelRise)}px)`,
        }}
      />

      <div
        style={{
          position: 'absolute',
          left: layout.px(PANEL_PAD_X_PX),
          right: layout.px(PANEL_PAD_X_PX),
          bottom: layout.px(PANEL_PAD_Y_PX),
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: layout.gap(space.xl),
          transform: `translateY(${layout.px(panelRise)}px)`,
        }}
      >
        <div style={{minWidth: 0, maxWidth: layout.px(strip.length > 0 ? 1180 : 1560)}}>
          {kicker ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: layout.gap(space.sm),
                opacity: kickerIn,
                marginBottom: layout.gap(space.xs),
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
                {...textAudit(kicker)}
                style={{
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
          ) : null}

          {headline.map((line, index) => (
            <div key={`${scene.id}-headline-${index}`}>
              <LineReveal delay={motion.stagger * (index + 1)} theme={theme}>
                <div style={{display: 'inline-block'}}>
                  <div
                    {...textAudit(line)}
                    style={{
                      fontSize: layout.font(index === lastIndex ? type.display3 : type.head),
                      fontWeight: index === lastIndex ? type.weight.black : type.weight.medium,
                      color: index === lastIndex ? palette.ink : palette.inkMuted,
                      letterSpacing: `${type.tracking.normal}em`,
                      lineHeight: type.leading.snug,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {line}
                  </div>
                  {index === lastIndex ? (
                    <div
                      style={{
                        marginTop: layout.gap(space.xs),
                        width: `${underline * 100}%`,
                        height: stroke.thick,
                        background: palette.accent,
                        boxShadow: `0 0 ${layout.px(18)}px ${palette.accent}`,
                      }}
                    />
                  ) : null}
                </div>
              </LineReveal>
            </div>
          ))}

          {subline ? (
            <div
              {...textAudit(subline)}
              style={{
                marginTop: layout.gap(space.sm),
                fontSize: layout.font(type.label),
                fontWeight: type.weight.medium,
                color: palette.inkMuted,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {subline}
            </div>
          ) : null}
        </div>

        <div style={{display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: layout.gap(space.xs)}}>
          {strip.map((line) => (
            <div
              key={`${scene.id}-strip-${line}`}
              {...textAudit(line)}
              style={{
                fontFamily: FONT_FAMILIES.mono,
                fontSize: layout.font(type.label),
                letterSpacing: `${type.tracking.wider}em`,
                color: palette.inkMuted,
                whiteSpace: 'nowrap',
              }}
            >
              {line}
            </div>
          ))}
          {footnote ? (
            <div
              {...textAudit(footnote)}
              style={{
                fontSize: layout.font(type.label),
                color: palette.inkFaint,
                maxWidth: layout.px(700),
                textAlign: 'right',
                lineHeight: type.leading.normal,
              }}
            >
              {footnote}
            </div>
          ) : null}
        </div>
      </div>
    </AbsoluteFill>
  );
};
