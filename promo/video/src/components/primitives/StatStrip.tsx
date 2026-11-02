/**
 * StatStrip — one mono data row.
 *
 * Repeated verbatim by S3Headless and S6Outro: mono label size, medium weight,
 * wide tracking, muted ink, single line. Geometry and colour come from the
 * theme; the scene owns placement and spacing.
 *
 * Contract: `content` + `theme` + `delay` only.
 */

import React from 'react';
import {FONT_FAMILIES} from '../../fonts';
import {useLayout} from '../../theme/layout';
import {tokens, type ThemeName} from '../../theme/tokens';
import {Fade, textAudit} from '../Typography';

export type StatStripProps = {
  content: string;
  theme?: ThemeName;
  delay?: number;
};

export const StatStrip: React.FC<StatStripProps> = ({
  content,
  theme = 'dark',
  delay = 0,
}) => {
  const {palette, type} = tokens[theme];
  const layout = useLayout();

  return (
    <Fade delay={delay} theme={theme}>
      <div
        {...textAudit(content)}
        style={{
          fontFamily: FONT_FAMILIES.mono,
          fontSize: layout.font(type.label),
          fontWeight: type.weight.medium,
          letterSpacing: `${type.tracking.wider}em`,
          color: palette.inkMuted,
          whiteSpace: 'nowrap',
        }}
      >
        {content}
      </div>
    </Fade>
  );
};
