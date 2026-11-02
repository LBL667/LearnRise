/**
 * Panel — the bordered translucent card.
 *
 * Repeated by the S2Foundation feature cards and the S4Paradigm channel chips.
 * Both use the same chrome: 1 px stroke, translucent surface, a radius step.
 * The scene owns everything inside the card (padding, flex direction, gaps),
 * so the primitive never needs a layout or style override prop.
 *
 * Contract: `content` + `theme` + `delay` + domain-free `radius` / `size`
 * knobs. `size` is a pixel box (content-box, like the original markup) and is
 * only needed when the card is not sized by its parent.
 */

import React, {type ReactNode} from 'react';
import {useLayout} from '../../theme/layout';
import {tokens, type ThemeName} from '../../theme/tokens';
import {Fade} from '../Typography';

export type PanelProps = {
  content: ReactNode;
  theme?: ThemeName;
  delay?: number;
  radius?: 'md' | 'lg';
  size?: {readonly width: number; readonly height: number};
  minHeight?: number;
};

export const Panel: React.FC<PanelProps> = ({
  content,
  theme = 'dark',
  delay = 0,
  radius = 'lg',
  size,
  minHeight,
}) => {
  const {palette, radius: radiusScale, stroke} = tokens[theme];
  const layout = useLayout();

  return (
    <Fade delay={delay} theme={theme}>
      <div
        style={{
          width: size?.width,
          height: size?.height,
          minHeight,
          borderRadius: layout.px(radiusScale[radius]),
          border: `${stroke.hair}px solid ${palette.stroke}`,
          background: palette.surface,
        }}
      >
        {content}
      </div>
    </Fade>
  );
};
