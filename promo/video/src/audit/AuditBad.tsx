/**
 * AuditBad — an intentionally broken composition with exactly four defects,
 * used only by `scripts/audit.mjs` to prove the probe has teeth. Each defect
 * lives on its own `data-audit` element: 8px type, text wider than its parent,
 * near-invisible text, and a 608px capture rendered at 1216px.
 *
 * This composition is never part of the film path; it exists solely so the
 * audit gate can be exercised against known-bad input.
 */

import React from 'react';
import {AbsoluteFill, staticFile} from 'remotion';
import {AuditProbe} from './AuditProbe';
import {FONT_FAMILIES} from '../fonts';
import {tokens, type ThemeName} from '../theme/tokens';

export const AuditBad: React.FC<{theme?: ThemeName; audit?: boolean}> = ({
  theme = 'dark',
  audit = false,
}) => {
  const {palette} = tokens[theme];

  return (
    <AbsoluteFill style={{background: palette.bg, fontFamily: FONT_FAMILIES.sans}}>
      <div style={{position: 'absolute', left: 300, top: 300}}>
        <div
          {...{'data-audit': 'defect-font-size', 'data-chars': '9'}}
          style={{fontSize: 8, color: palette.ink, whiteSpace: 'nowrap'}}
        >
          TOO SMALL
        </div>
      </div>

      <div style={{position: 'absolute', left: 700, top: 400, width: 240, overflow: 'hidden'}}>
        <div
          {...{'data-audit': 'defect-overflow', 'data-chars': '26'}}
          style={{
            display: 'inline-block',
            fontSize: 28,
            color: palette.ink,
            whiteSpace: 'nowrap',
          }}
        >
          OVERFLOWING TEXT SENTINEL
        </div>
      </div>

      <div style={{position: 'absolute', left: 300, top: 520}}>
        <div
          {...{'data-audit': 'defect-contrast', 'data-chars': '17'}}
          style={{fontSize: 28, color: palette.bg, whiteSpace: 'nowrap'}}
        >
          LOW CONTRAST TEXT
        </div>
      </div>

      <img
        src={staticFile('ui/structure.png')}
        alt=""
        {...{'data-audit': 'defect-upscale', 'data-asset-natural-width': '608'}}
        style={{position: 'absolute', left: 352, top: 100, width: 1216, height: 738}}
      />

      {audit ? <AuditProbe audit={audit} theme={theme} /> : null}
    </AbsoluteFill>
  );
};
