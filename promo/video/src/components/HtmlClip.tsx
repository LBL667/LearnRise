/**
 * HtmlClip — a HyperFrames pre-rendered clip as flat footage.
 *
 * Contract (see `references/hyperframes.md`):
 * - WHOLE-CLIP PLAYBACK ONLY. The file is a finished mp4; this component never
 *   seeks into it, never drives `hf-seek`, and never mounts a second timeline.
 *   Remotion's composition frame is the only clock. `OffthreadVideo` has no
 *   `loop` here: the host must keep the clip mounted for at most the clip's
 *   own frame count, because there is no correct frame past its end.
 * - ALWAYS MUTED. The clip is authored silent, and `muted` is not configurable,
 *   so the film's music bed stays the single audio source.
 * - The source lives under `public/` and is resolved with `staticFile`, e.g.
 *   `clips/demo/demo.mp4`. Render it with `scripts/render-clip.mjs`.
 *
 * The wrapper is the only layout surface: the caller sizes the box and the
 * video fills it with `object-fit: cover`. No design tokens, colours or copy
 * live here; the host scene owns those.
 */

import React from 'react';
import {OffthreadVideo, staticFile} from 'remotion';

export type HtmlClipProps = {
  /** Public-relative path of the pre-rendered mp4, e.g. `clips/demo/demo.mp4`. */
  readonly src: string;
  /** Box width in design pixels. */
  readonly width: number;
  /** Box height in design pixels; defaults to 16:9 from `width`. */
  readonly height?: number;
  readonly style?: React.CSSProperties;
};

export const HtmlClip: React.FC<HtmlClipProps> = ({src, width, height, style}) => {
  const boxHeight = height ?? Math.round((width * 9) / 16);

  return (
    <div
      style={{
        position: 'relative',
        width,
        height: boxHeight,
        overflow: 'hidden',
        ...style,
      }}
    >
      <OffthreadVideo
        src={staticFile(src)}
        muted
        style={{
          display: 'block',
          width: '100%',
          height: '100%',
          objectFit: 'cover',
        }}
      />
    </div>
  );
};
