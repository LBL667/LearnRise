/**
 * Typed entry point for a film's storyboard. `defineVideo` validates at load
 * time, so a malformed config fails before Remotion starts rendering.
 */

import {
  validateStoryboard,
  type Storyboard,
  type StoryboardInput,
} from './src/schema/storyboard';

export type VideoConfig = Storyboard;
export type VideoConfigInput = StoryboardInput;
export type { Storyboard, StoryboardInput };

export function defineVideo(config: StoryboardInput): Storyboard {
  const result = validateStoryboard(config);
  if (!result.ok) {
    const details = result.errors
      .map((error) => `  ${error.path}: ${error.message}`)
      .join('\n');
    throw new Error(`Invalid storyboard:\n${details}`);
  }
  return result.data;
}
