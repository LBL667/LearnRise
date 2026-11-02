/**
 * Root — exactly 12 compositions: the master `Film` plus one independently
 * renderable composition per scene (`S01`…`S11`).
 *
 * Composition length is `tokens.dark.canvas.frames` (6720 @ 30 fps); each
 * scene composition uses the window length derived from `film.ts`.
 *
 * Scene compositions get their own `Backdrop`, because the master `Film`
 * supplies one globally and a bare scene would otherwise render on a
 * transparent (white) canvas.
 */

import React from 'react';
import {AbsoluteFill, Composition} from 'remotion';
import {Backdrop} from './components/Backdrop';
import {GrainOverlay} from './components/GrainOverlay';
import {loadFonts} from './fonts';
import {Film} from './Film';
import {FPS, SCENES, SCENE_FRAMES} from './content/film';
import {SCENE_COMPONENTS} from './scenes/registry';
import type {LayoutName} from './theme/layout';
import {tokens, type ThemeName} from './theme/tokens';

void loadFonts();

const {width, height, fps, frames} = tokens.dark.canvas;

const sceneCanvas = (Scene: React.FC<{theme?: ThemeName}>) => {
  const SceneCanvas: React.FC<{theme?: ThemeName}> = ({theme = 'dark'}) => (
    <AbsoluteFill style={{background: tokens[theme].palette.bg}}>
      <Backdrop theme={theme} />
      <Scene theme={theme} />
      <GrainOverlay />
    </AbsoluteFill>
  );
  return SceneCanvas;
};

export const Root: React.FC = () => (
  <>
    <Composition
      id="Film"
      component={Film}
      durationInFrames={frames}
      fps={fps}
      width={width}
      height={height}
      defaultProps={{
        theme: 'dark' as ThemeName,
        layout: 'wide' as LayoutName,
      }}
    />
    {SCENES.map((scene, index) => {
      const Scene = SCENE_COMPONENTS[scene.id];
      return (
        <Composition
          key={scene.id}
          id={scene.id}
          component={sceneCanvas(Scene)}
          durationInFrames={SCENE_FRAMES[index]}
          fps={FPS}
          width={width}
          height={height}
          defaultProps={{theme: 'dark' as ThemeName}}
        />
      );
    })}
  </>
);
