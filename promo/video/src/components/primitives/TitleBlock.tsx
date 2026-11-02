/**
 * TitleBlock — kicker row + title, optional footnote.
 *
 * Repeated by S4Paradigm and S5Control. The kicker row is identical in both:
 * an 11 px accent square, a mono index, an optional sans label (for CJK that
 * the mono subset cannot render), then the title.
 *
 * Contract: `content` + `theme` + `delay` + a domain-free `align` knob only.
 * The title is passed as a ReactNode so each scene keeps its own token-backed
 * type step (S4 uses `display3`, S5 uses `display2`) without a style override
 * prop. `delay` owns the kicker fade and the title reveal; pass a very negative
 * delay for a scene whose header is static.
 *
 * No copy, no DAW vocabulary, no timing constants live here.
 */

import React, {type ReactNode} from 'react';
import {FONT_FAMILIES} from '../../fonts';
import {useLayout} from '../../theme/layout';
import {tokens, type ThemeName} from '../../theme/tokens';
import {LineReveal, textAudit} from '../Typography';
import {useEnter} from '../../lib/anim';

/** Decorative kicker geometry (layout, deliberately literal). */
const KICKER_DOT_PX = 11;
const KICKER_DOT_GLOW_PX = 18;

export type TitleBlockContent = {
  /** Mono kicker index, e.g. "03 /". */
  readonly index: string;
  /** Optional sans label for glyphs outside the mono subset (CJK). */
  readonly label?: string;
  /** Pre-styled title node; the scene owns its type step. */
  readonly title: ReactNode;
  /** Optional footnote rendered under the title. */
  readonly footnote?: ReactNode;
};

export type TitleBlockProps = {
  content: TitleBlockContent;
  theme?: ThemeName;
  delay?: number;
  align?: 'left' | 'center';
};

export const TitleBlock: React.FC<TitleBlockProps> = ({
  content,
  theme = 'dark',
  delay = 0,
  align = 'left',
}) => {
  const {palette, type, space, motion} = tokens[theme];
  const layout = useLayout();
  const appear = useEnter(delay, motion.enter);

  return (
    <div style={align === 'center' ? {textAlign: 'center'} : undefined}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: layout.gap(space.sm),
          justifyContent: align === 'center' ? 'center' : 'flex-start',
          opacity: appear,
        }}
      >
        <div
          aria-hidden
          style={{
            width: layout.px(KICKER_DOT_PX),
            height: layout.px(KICKER_DOT_PX),
            background: palette.accent,
            boxShadow: `0 0 ${layout.px(KICKER_DOT_GLOW_PX)}px ${palette.accent}`,
          }}
        />
        <div
          {...textAudit(content.index)}
          style={{
            fontFamily: FONT_FAMILIES.mono,
            fontSize: layout.font(type.label),
            fontWeight: type.weight.medium,
            letterSpacing: `${type.tracking.wider}em`,
            color: palette.inkMuted,
            whiteSpace: 'nowrap',
          }}
        >
          {content.index}
        </div>
        {content.label === undefined ? null : (
          <div
            {...textAudit(content.label)}
            style={{
              fontFamily: FONT_FAMILIES.sans,
              fontSize: layout.font(type.label),
              fontWeight: type.weight.medium,
              letterSpacing: `${type.tracking.wide}em`,
              color: palette.inkMuted,
              whiteSpace: 'nowrap',
            }}
          >
            {content.label}
          </div>
        )}
      </div>

      <div style={{marginTop: layout.gap(space.sm)}}>
        <LineReveal delay={delay + motion.stagger} theme={theme}>
          {content.title}
        </LineReveal>
      </div>

      {content.footnote === undefined ? null : (
        <div style={{marginTop: layout.gap(space.sm)}}>{content.footnote}</div>
      )}
    </div>
  );
};
