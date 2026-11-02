/**
 * S10 — personal centre.
 *
 * Six settings are lit one at a time, then the same surface switches from the
 * light theme to the dark theme, then an Agent key is shown only in its masked
 * form, then an avatar change is reflected on the leaderboard. Every colour,
 * type step and duration comes from `tokens`; geometry is authored in design
 * pixels and passed through `useLayout()`.
 */

import React from 'react';
import {
  AbsoluteFill,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
} from 'remotion';
import {SCENE_BY_ID} from '../content/film';
import {FONT_FAMILIES} from '../fonts';
import {clamp01, useEnter} from '../lib/anim';
import {useLayout} from '../theme/layout';
import {tokens, type ThemeName} from '../theme/tokens';
import {Fade, Kicker, LineReveal, textAudit} from '../components/Typography';

const LEFT_WIDTH = 720;
const PANEL_LEFT = 960;
const PANEL_TOP = 250;
const PANEL_WIDTH = 768;
const PANEL_HEIGHT = 472;
const PANEL_CHROME_PX = 40;
const PANEL_IMAGE_WIDTH = PANEL_WIDTH;
const PANEL_IMAGE_HEIGHT = 432;
const ROW_HEIGHT = 54;
const ROW_INDEX_WIDTH = 44;
const ACCENT_BAR_WIDTH = 4;
const MASKED_KEY = 'sk-****1234';

/* Settings sequence (frames @30 fps). */
const SETTINGS_START = 72;
const SETTINGS_STEP = 30;
const SETTINGS_FADE_OUT = 252;
const SETTINGS_FADE_END = 270;
const LIGHT_IN = 252;
const LIGHT_OUT = 300;
const DARK_IN = 300;
const DARK_OUT = 336;
const AGENT_IN = 336;
const AGENT_OUT = 420;
const PROFILE_IN = 420;
const CROSSFADE = 18;
const LIGHT_CUT = LIGHT_IN + CROSSFADE / 2;
const DARK_CUT = DARK_IN + CROSSFADE / 2;
const AGENT_CUT = AGENT_IN + CROSSFADE / 2;
const PROFILE_CUT = PROFILE_IN + CROSSFADE / 2;

/* The six cards in `s10-profile-settings.png`, as fractions of the 1920x1080
 * capture. Measured from the settings grid (2 columns x 3 rows). */
const CARD_BOXES = [
  {left: 0.276, top: 0.19, width: 0.349, height: 0.264},
  {left: 0.64, top: 0.19, width: 0.35, height: 0.264},
  {left: 0.276, top: 0.458, width: 0.349, height: 0.269},
  {left: 0.64, top: 0.458, width: 0.35, height: 0.269},
  {left: 0.276, top: 0.727, width: 0.349, height: 0.264},
  {left: 0.64, top: 0.727, width: 0.35, height: 0.264},
] as const;

const SETTINGS = [
  {label: '基本信息', code: 'PROFILE'},
  {label: '安全设置', code: 'SECURITY'},
  {label: '通知设置', code: 'NOTIFY'},
  {label: '学习偏好', code: 'LEARNING'},
  {label: '界面设置', code: 'THEME'},
  {label: '隐私设置', code: 'PRIVACY'},
] as const;

const range = (frame: number, from: number, to: number) =>
  clamp01(interpolate(frame, [from, to], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  }));

const fadeWindow = (
  frame: number,
  inStart: number,
  inEnd: number,
  outStart?: number,
  outEnd?: number,
) => {
  const enter = range(frame, inStart, inEnd);
  if (outStart === undefined || outEnd === undefined) return enter;
  return enter * (1 - range(frame, outStart, outEnd));
};

const focusAt = (frame: number, index: number) => {
  const start = SETTINGS_START + index * SETTINGS_STEP;
  const end = start + SETTINGS_STEP;
  if (frame < start || frame > end) return 0;
  return Math.min(range(frame, start, start + 6), 1 - range(frame, end - 6, end));
};

const Screenshot: React.FC<{
  src: string;
  visible?: boolean;
}> = ({src, visible = true}) => (
  <Img
    src={staticFile(src)}
    data-asset-natural-width={768}
    style={{
      position: 'absolute',
      inset: 0,
      width: '100%',
      height: '100%',
      objectFit: 'fill',
      display: visible ? 'block' : 'none',
    }}
  />
);

const SettingRow: React.FC<{
  index: number;
  label: string;
  code: string;
  theme: ThemeName;
  delay: number;
}> = ({index, label, code, theme, delay}) => {
  const {palette, type, space} = tokens[theme];
  const layout = useLayout();
  const frame = useCurrentFrame();
  const enter = useEnter(delay, tokens[theme].motion.enter);
  const focus = focusAt(frame, index);
  const active = focus > 0.45;

  return (
    <Fade delay={delay} duration={tokens[theme].motion.enter} theme={theme}>
      <div
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          height: layout.px(ROW_HEIGHT),
          paddingLeft: layout.gap(space.md),
          paddingRight: layout.gap(space.md),
          borderRadius: layout.px(tokens[theme].radius.sm),
          overflow: 'hidden',
          opacity: clamp01(enter * 1.4),
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: palette.surfaceStrong,
            opacity: focus * 0.9,
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: layout.gap(space.sm),
            bottom: layout.gap(space.sm),
            width: layout.px(ACCENT_BAR_WIDTH) * focus,
            background: palette.accent,
            boxShadow: `0 0 ${layout.px(space.md)}px ${palette.accent}`,
            opacity: focus,
          }}
        />
        <div
          {...textAudit(String(index + 1).padStart(2, '0'))}
          style={{
            width: layout.px(ROW_INDEX_WIDTH),
            fontFamily: FONT_FAMILIES.mono,
            fontSize: layout.font(type.label),
            fontWeight: type.weight.medium,
            letterSpacing: `${type.tracking.wide}em`,
            color: active ? palette.accentText : palette.inkMuted,
          }}
        >
          {String(index + 1).padStart(2, '0')}
        </div>
        <div
          {...textAudit(label)}
          style={{
            flex: 1,
            fontSize: layout.font(type.body),
            fontWeight: active ? type.weight.bold : type.weight.regular,
            color: active ? palette.ink : palette.inkMuted,
            whiteSpace: 'nowrap',
          }}
        >
          {label}
        </div>
        <div
          {...textAudit(code)}
          style={{
            fontFamily: FONT_FAMILIES.mono,
            fontSize: layout.font(type.label),
            fontWeight: type.weight.regular,
            letterSpacing: `${type.tracking.wider}em`,
            color: active ? palette.accentText : palette.inkMuted,
            whiteSpace: 'nowrap',
          }}
        >
          {code}
        </div>
        <div
          style={{
            width: layout.px(8),
            height: layout.px(8),
            marginLeft: layout.gap(space.sm),
            borderRadius: '50%',
            background: active ? palette.accent : palette.stroke,
            boxShadow: active ? `0 0 ${layout.px(space.sm)}px ${palette.accent}` : undefined,
          }}
        />
      </div>
    </Fade>
  );
};

const MaskedKeyCard: React.FC<{theme: ThemeName}> = ({theme}) => {
  const {palette, type, space, radius, stroke} = tokens[theme];
  const layout = useLayout();
  const frame = useCurrentFrame();
  const enter = useEnter(AGENT_IN + 6, tokens[theme].motion.enter);
  const out = range(frame, AGENT_OUT, AGENT_OUT + CROSSFADE);
  const visible = clamp01(enter * 1.4) * (1 - out);
  if (visible <= 0.001) return null;

  return (
    <div
      style={{
        position: 'absolute',
        left: layout.gap(space.md),
        bottom: layout.gap(space.md),
        display: 'flex',
        alignItems: 'center',
        gap: layout.gap(space.sm),
        paddingTop: layout.gap(space.sm),
        paddingBottom: layout.gap(space.sm),
        paddingLeft: layout.gap(space.md),
        paddingRight: layout.gap(space.md),
        borderRadius: layout.px(radius.md),
        border: `${stroke.hair}px solid ${palette.stroke}`,
        background: palette.bgAlt,
        boxShadow: `0 ${layout.px(space.sm)}px ${layout.px(space.xxxl)}px ${palette.bg}`,
        opacity: visible,
        transform: `translateY(${(1 - enter) * layout.px(space.md)}px)`,
      }}
    >
      <div
        style={{
          width: layout.px(34),
          height: layout.px(34),
          borderRadius: layout.px(radius.sm),
          border: `${stroke.thin}px solid ${palette.accent}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
        }}
      >
        <div
          style={{
            width: layout.px(12),
            height: layout.px(10),
            border: `${stroke.thin}px solid ${palette.accent}`,
            borderRadius: layout.px(2),
          }}
        />
        <div
          style={{
            position: 'absolute',
            top: layout.px(6),
            width: layout.px(10),
            height: layout.px(8),
            border: `${stroke.thin}px solid ${palette.accent}`,
            borderBottom: 'none',
            borderRadius: `${layout.px(6)}px ${layout.px(6)}px 0 0`,
          }}
        />
      </div>
      <div style={{display: 'flex', flexDirection: 'column', gap: layout.gap(2)}}>
        <div
          {...textAudit('API KEY')}
          style={{
            fontFamily: FONT_FAMILIES.mono,
            fontSize: layout.font(type.label),
            fontWeight: type.weight.medium,
            letterSpacing: `${type.tracking.wider}em`,
            color: palette.inkMuted,
          }}
        >
          API KEY
        </div>
        <div
          {...textAudit(MASKED_KEY)}
          style={{
            fontFamily: FONT_FAMILIES.mono,
            fontSize: layout.font(type.head),
            fontWeight: type.weight.bold,
            letterSpacing: '0em',
            color: palette.accentText,
            whiteSpace: 'nowrap',
          }}
        >
          {MASKED_KEY}
        </div>
      </div>
      <div
        {...textAudit('只回显掩码')}
        style={{
          marginLeft: layout.gap(space.sm),
          fontSize: layout.font(type.label),
          fontWeight: type.weight.regular,
          color: palette.inkMuted,
          whiteSpace: 'nowrap',
        }}
      >
        只回显掩码
      </div>
    </div>
  );
};

const AvatarSyncCard: React.FC<{theme: ThemeName}> = ({theme}) => {
  const {palette, type, space, radius, stroke} = tokens[theme];
  const layout = useLayout();
  const frame = useCurrentFrame();
  const enter = useEnter(PROFILE_IN + 8, tokens[theme].motion.enter);
  const spin = frame * 0.9;
  if (enter <= 0.001) return null;

  return (
    <div
      style={{
        position: 'absolute',
        right: layout.gap(space.md),
        bottom: layout.gap(space.md),
        display: 'flex',
        alignItems: 'center',
        gap: layout.gap(space.md),
        paddingTop: layout.gap(space.sm),
        paddingBottom: layout.gap(space.sm),
        paddingLeft: layout.gap(space.md),
        paddingRight: layout.gap(space.md),
        borderRadius: layout.px(radius.md),
        border: `${stroke.hair}px solid ${palette.stroke}`,
        background: palette.bgAlt,
        opacity: clamp01(enter * 1.4),
        transform: `translateY(${(1 - enter) * layout.px(space.md)}px)`,
      }}
    >
      <div
        style={{
          position: 'relative',
          width: layout.px(56),
          height: layout.px(56),
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '50%',
            border: `${stroke.thin}px solid ${palette.stroke}`,
          }}
        />
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '50%',
            border: `${stroke.thin}px solid transparent`,
            borderTopColor: palette.accent,
            borderRightColor: palette.accentAlt,
            transform: `rotate(${spin}deg)`,
          }}
        />
        <div
          style={{
            width: layout.px(38),
            height: layout.px(38),
            borderRadius: '50%',
            background: palette.accent,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            {...textAudit('M')}
            style={{
              fontFamily: FONT_FAMILIES.sans,
              fontSize: layout.font(type.label),
              fontWeight: type.weight.black,
              color: palette.onAccent,
            }}
          >
            M
          </div>
        </div>
      </div>
      <div style={{display: 'flex', flexDirection: 'column', gap: layout.gap(2)}}>
        <div
          {...textAudit('头像同步')}
          style={{
            fontSize: layout.font(type.body),
            fontWeight: type.weight.bold,
            color: palette.ink,
            whiteSpace: 'nowrap',
          }}
        >
          头像同步
        </div>
        <div
          {...textAudit('LEADERBOARD · SYNCED')}
          style={{
            fontFamily: FONT_FAMILIES.mono,
            fontSize: layout.font(type.label),
            fontWeight: type.weight.medium,
            letterSpacing: `${type.tracking.wider}em`,
            color: palette.accentAltText,
            whiteSpace: 'nowrap',
          }}
        >
          LEADERBOARD · SYNCED
        </div>
      </div>
    </div>
  );
};

export const S10Profile: React.FC<{theme?: ThemeName}> = ({theme = 'dark'}) => {
  const scene = SCENE_BY_ID.S10;
  const {palette, type, space, radius, stroke} = tokens[theme];
  const layout = useLayout();
  const frame = useCurrentFrame();

  const headlineParts = scene.screenText[0].split('，');
  const lead = headlineParts[0] ?? scene.screenText[0];
  const tail = headlineParts.length > 1 ? headlineParts.slice(1).join('，') : '';

  const lightOpacity = fadeWindow(frame, LIGHT_IN, LIGHT_IN + CROSSFADE, LIGHT_OUT, LIGHT_OUT + CROSSFADE);
  const darkOpacity = fadeWindow(frame, DARK_IN, DARK_IN + CROSSFADE, DARK_OUT, DARK_OUT + CROSSFADE);

  const highlightIndex = Math.floor((frame - SETTINGS_START) / SETTINGS_STEP);
  const highlightVisible =
    frame >= SETTINGS_START - 8 && frame <= SETTINGS_FADE_OUT + 4;
  const rule = range(frame, 24, 64);
  const themeFlash = range(frame, DARK_IN - 8, DARK_IN) * (1 - range(frame, DARK_IN, DARK_IN + 22));

  return (
    <AbsoluteFill style={{fontFamily: FONT_FAMILIES.sans}}>
      <Img
        src={staticFile('ui/bloom-soft-1128.png')}
        data-asset-natural-width={1128}
        style={{
          position: 'absolute',
          left: layout.px(PANEL_LEFT - 180),
          top: layout.px(PANEL_TOP - 140),
          width: layout.px(PANEL_WIDTH + 360),
          height: layout.px(PANEL_HEIGHT + 280),
          opacity: 0.55 + 0.2 * Math.sin(frame / 34),
          pointerEvents: 'none',
        }}
      />

      <div
        style={{
          position: 'absolute',
          left: layout.safe.side,
          top: layout.safe.top,
          width: layout.px(LEFT_WIDTH),
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <Kicker text={scene.kicker ?? ''} delay={0} />

        <div style={{marginTop: layout.gap(space.lg)}}>
          <LineReveal delay={tokens[theme].motion.stagger} theme={theme}>
            <div
              {...textAudit(`${lead}，`)}
              style={{
                fontSize: layout.font(type.display3),
                fontWeight: type.weight.regular,
                lineHeight: type.leading.snug,
                color: palette.inkMuted,
                whiteSpace: 'nowrap',
              }}
            >
              {`${lead}，`}
            </div>
          </LineReveal>
          <LineReveal delay={tokens[theme].motion.stagger * 2} theme={theme}>
            <div
              {...textAudit(tail)}
              style={{
                fontSize: layout.font(type.display3),
                fontWeight: type.weight.black,
                lineHeight: type.leading.snug,
                color: palette.ink,
                whiteSpace: 'nowrap',
              }}
            >
              {tail}
            </div>
          </LineReveal>
        </div>

        <div
          style={{
            marginTop: layout.gap(space.md),
            width: layout.px(420) * rule,
            height: stroke.thin,
            background: palette.accent,
            boxShadow: `0 0 ${layout.px(space.sm)}px ${palette.accent}`,
          }}
        />

        <Fade delay={tokens[theme].motion.stagger * 3} theme={theme}>
          <div
            {...textAudit(scene.subline ?? '')}
            style={{
              marginTop: layout.gap(space.md),
              fontSize: layout.font(type.body),
              fontWeight: type.weight.regular,
              color: palette.inkMuted,
              lineHeight: type.leading.normal,
            }}
          >
            {scene.subline}
          </div>
        </Fade>

        <div
          style={{
            marginTop: layout.gap(space.lg),
            display: 'flex',
            flexDirection: 'column',
            gap: layout.gap(4),
          }}
        >
          {SETTINGS.map((setting, index) => (
            <SettingRow
              key={setting.code}
              index={index}
              label={setting.label}
              code={setting.code}
              theme={theme}
              delay={tokens[theme].motion.stagger * (index + 5)}
            />
          ))}
        </div>

        <Fade delay={tokens[theme].motion.stagger * 11} theme={theme}>
          <div
            {...textAudit('FERNET · MASKED · 404 SCOPED')}
            style={{
              marginTop: layout.gap(space.md),
              fontFamily: FONT_FAMILIES.mono,
              fontSize: layout.font(type.label),
              fontWeight: type.weight.regular,
              letterSpacing: `${type.tracking.wider}em`,
              color: palette.inkMuted,
            }}
          >
            FERNET · MASKED · 404 SCOPED
          </div>
        </Fade>
      </div>

      <div
        style={{
          position: 'absolute',
          left: layout.px(PANEL_LEFT),
          top: layout.px(PANEL_TOP),
          width: layout.px(PANEL_WIDTH),
          height: layout.px(PANEL_HEIGHT),
          borderRadius: layout.px(radius.lg),
          border: `${stroke.hair}px solid ${palette.stroke}`,
          background: palette.surface,
          boxShadow: `0 ${layout.px(space.lg)}px ${layout.px(space.huge)}px ${palette.bg}`,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: layout.px(PANEL_CHROME_PX),
            display: 'flex',
            alignItems: 'center',
            gap: layout.gap(space.sm),
            paddingLeft: layout.gap(space.md),
            paddingRight: layout.gap(space.md),
            background: palette.bgAlt,
            borderBottom: `${stroke.hair}px solid ${palette.strokeSoft}`,
          }}
        >
          {[palette.accent, palette.accentAlt, palette.warn].map((color, index) => (
            <div
              key={index}
              style={{
                width: layout.px(9),
                height: layout.px(9),
                borderRadius: '50%',
                background: color,
              }}
            />
          ))}
          <div
            {...textAudit('learnrise.local / profile')}
            style={{
              marginLeft: layout.gap(space.sm),
              fontFamily: FONT_FAMILIES.mono,
              fontSize: layout.font(type.label),
              fontWeight: type.weight.regular,
              letterSpacing: `${type.tracking.wide}em`,
              color: palette.inkMuted,
              whiteSpace: 'nowrap',
            }}
          >
            learnrise.local / profile
          </div>
        </div>

        <div
          style={{
            position: 'relative',
            width: layout.px(PANEL_IMAGE_WIDTH),
            height: layout.px(PANEL_IMAGE_HEIGHT),
            overflow: 'hidden',
          }}
        >
          <Screenshot src="ui/s10-profile-settings-768.png" />
          <Screenshot src="ui/s10-theme-light-768.png" visible={frame >= LIGHT_CUT} />
          <Screenshot src="ui/s10-theme-dark-768.png" visible={frame >= DARK_CUT} />
          <Screenshot src="ui/s10-agents-masked-768.png" visible={frame >= AGENT_CUT} />
          <Screenshot src="ui/s10-profile-top-768.png" visible={frame >= PROFILE_CUT} />

          {highlightVisible
            ? CARD_BOXES.map((box, index) => {
                const active = index === highlightIndex;
                return (
                  <div
                    key={index}
                    style={{
                      position: 'absolute',
                      left: `${box.left * 100}%`,
                      top: `${box.top * 100}%`,
                      width: `${box.width * 100}%`,
                      height: `${box.height * 100}%`,
                      borderRadius: layout.px(radius.sm),
                      border: `${stroke.thin}px solid ${
                        active ? palette.accent : palette.inkFaint
                      }`,
                    }}
                  />
                );
              })
            : null}

          <div
            style={{
              position: 'absolute',
              top: layout.gap(space.sm),
              right: layout.gap(space.sm),
              display: 'flex',
              gap: layout.gap(space.xs),
              opacity: Math.max(lightOpacity, darkOpacity),
            }}
          >
            {[
              {label: '浅色', value: lightOpacity, color: palette.warnText},
              {label: '深色', value: darkOpacity, color: palette.accentText},
            ].map((item) => (
              <div
                key={item.label}
                style={{
                  paddingTop: layout.gap(4),
                  paddingBottom: layout.gap(4),
                  paddingLeft: layout.gap(space.sm),
                  paddingRight: layout.gap(space.sm),
                  borderRadius: layout.px(radius.pill),
                  background: palette.bgAlt,
                  border: `${stroke.hair}px solid ${palette.stroke}`,
                  opacity: item.value,
                }}
              >
                <div
                  {...textAudit(item.label)}
                  style={{
                    fontSize: layout.font(type.label),
                    fontWeight: type.weight.medium,
                    color: item.color,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {item.label}
                </div>
              </div>
            ))}
          </div>

          {themeFlash > 0.01 ? (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                background: palette.accent,
                opacity: themeFlash * 0.18,
              }}
            />
          ) : null}

          <MaskedKeyCard theme={theme} />
          <AvatarSyncCard theme={theme} />
        </div>
      </div>
    </AbsoluteFill>
  );
};
