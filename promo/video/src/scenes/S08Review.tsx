/**
 * S08Review — Review (local frames 0–599, 20 s).
 *
 * Visual body: frozen new-UI browser clip `public/clips/S08/clip.mp4`
 * (1920×1080 / 30 fps / 600 frames / muted), mounted full-bleed through
 * `HtmlClip`. Copy comes from `SCENE_BY_ID.S08`; this file contains no
 * authored Chinese.
 *
 * The clip is treated as immutable flat footage; the host `Sequence`
 * duration equals the clip's own frame count.
 */

import React from 'react';
import {ClipScene} from '../components/ClipScene';
import {SCENE_BY_ID} from '../content/film';
import type {ThemeName} from '../theme/tokens';

export const S08Review: React.FC<{theme?: ThemeName}> = ({theme = 'dark'}) => (
  <ClipScene scene={SCENE_BY_ID.S08} theme={theme} />
);
