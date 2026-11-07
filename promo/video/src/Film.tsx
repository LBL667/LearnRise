/**
 * Film — the 6720-frame master timeline.
 *
 * Every cut is derived from `src/content/film.ts`; this file only maps the
 * scene registry onto the timeline. No copy, no durations, and no Chinese
 * sentence lives here.
 */

import React from 'react';
import {AbsoluteFill, Sequence, useCurrentFrame} from 'remotion';
import {AuditProbe} from './audit/AuditProbe';
import {BED, Bed, type BedScene} from './audio/Bed';
import {Backdrop} from './components/Backdrop';
import {CutFlash} from './components/CutFlash';
import {GrainOverlay} from './components/GrainOverlay';
import {Rail} from './components/Rail';
import {SCENE_WINDOWS, TOTAL_FRAMES} from './content/film';
import {SCENE_COMPONENTS} from './scenes/registry';
import {LayoutContext, layoutFor, type LayoutName} from './theme/layout';
import {tokens, type ThemeName} from './theme/tokens';

const BED_SCENES: readonly BedScene[] = SCENE_WINDOWS.map((window) => ({
  from: window.from,
  durationInFrames: window.durationInFrames,
  duckDb: BED.narrationDuckDb,
}));

const BED_GAIN = 0.74131;

const AMBIENT_GLOWS: readonly {
  size: number;
  color: 'accent' | 'accentAlt';
  phase: number;
  x: number;
  y: number;
  driftX: number;
  driftY: number;
  speed: number;
}[] = [
  {size: 900, color: 'accent', phase: 0, x: 470, y: 330, driftX: 170, driftY: 110, speed: 71},
  {size: 760, color: 'accentAlt', phase: 2.1, x: 1470, y: 690, driftX: 150, driftY: 130, speed: 57},
  {size: 600, color: 'accent', phase: 4.2, x: 1000, y: 980, driftX: 210, driftY: 90, speed: 89},
];

const AMBIENT_BLUR_PX = 30;
const AMBIENT_BREATHE_MID = 0.17;
const AMBIENT_BREATHE_AMP = 0.07;

const AmbientGlows: React.FC<{theme?: ThemeName}> = ({theme = 'dark'}) => {
  const {palette} = tokens[theme];
  const layout = React.useContext(LayoutContext);
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill style={{pointerEvents: 'none'}}>
      {AMBIENT_GLOWS.map((glow, index) => {
        const angle = frame / glow.speed + glow.phase;
        const opacity =
          AMBIENT_BREATHE_MID + AMBIENT_BREATHE_AMP * Math.sin(angle);
        const size = layout.px(glow.size);
        const x = layout.px(glow.x + glow.driftX * Math.sin(angle));
        const y = layout.px(
          glow.y + glow.driftY * Math.cos(angle / 1.37 + glow.phase),
        );
        return (
          <div
            key={index}
            style={{
              position: 'absolute',
              left: x - size / 2,
              top: y - size / 2,
              width: size,
              height: size,
              borderRadius: '50%',
              background: `radial-gradient(circle, ${palette[glow.color]} 0%, transparent 68%)`,
              opacity,
              filter: `blur(${AMBIENT_BLUR_PX}px)`,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

export const Film: React.FC<{
  theme?: ThemeName;
  audit?: boolean;
  layout?: LayoutName;
}> = ({theme = 'dark', audit = false, layout = 'wide'}) => {
  const {palette} = tokens[theme];
  const layoutSet = layoutFor(layout);
  const sections = SCENE_WINDOWS.map((window) => window.id);

  return (
    <LayoutContext.Provider value={layoutSet}>
      <AbsoluteFill style={{background: palette.bg}}>
        <Backdrop theme={theme} />
        <AmbientGlows theme={theme} />

        {SCENE_WINDOWS.map((window) => {
          const Scene = SCENE_COMPONENTS[window.id];
          return (
            <Sequence
              key={window.id}
              from={window.from}
              durationInFrames={window.durationInFrames}
            >
              <Scene theme={theme} />
            </Sequence>
          );
        })}

        <Rail
          theme={theme}
          sections={sections}
          durationInFrames={TOTAL_FRAMES}
        />
        {SCENE_WINDOWS.map((window) => (
          <CutFlash key={window.id} at={window.from} theme={theme} />
        ))}

        <GrainOverlay firstOpacity={0.035} secondOpacity={0.02} />

        <Bed scenes={BED_SCENES} gain={BED_GAIN} />

        {audit ? (
          <AuditProbe audit={audit} theme={theme} layout={layoutSet} />
        ) : null}
      </AbsoluteFill>
    </LayoutContext.Provider>
  );
};
