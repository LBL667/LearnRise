import React from 'react';
import type {SceneId} from '../content/film';
import type {ThemeName} from '../theme/tokens';
import {S01Hook} from './S01Hook';
import {S02Loop} from './S02Loop';
import {S03Upload} from './S03Upload';
import {S04Tree} from './S04Tree';
import {S05Quiz} from './S05Quiz';
import {S06Explain} from './S06Explain';
import {S07Practice} from './S07Practice';
import {S08Review} from './S08Review';
import {S09Competition} from './S09Competition';
import {S10Profile} from './S10Profile';
import {S11Outro} from './S11Outro';

export type SceneComponent = React.FC<{theme?: ThemeName}>;

export const SCENE_COMPONENTS: Record<SceneId, SceneComponent> = {
  S01: S01Hook,
  S02: S02Loop,
  S03: S03Upload,
  S04: S04Tree,
  S05: S05Quiz,
  S06: S06Explain,
  S07: S07Practice,
  S08: S08Review,
  S09: S09Competition,
  S10: S10Profile,
  S11: S11Outro,
};
