import React from 'react';
import { AbsoluteFill, staticFile, useCurrentFrame } from 'remotion';

/**
 * Film-level grain.
 *
 * The tile is a 256x256 8-bit grayscale PNG of 2px white-noise cells
 * (`scripts/make-grain.mjs`), deliberately fine: the previous 512px coarse
 * tile read as large dark/white clouds on dark scenes and as a white haze
 * over the S06 chat panel. Two low-opacity passes break up banding without
 * veiling the picture (total ~0.03).
 *
 * Motion is deterministic: an integer hash of the frame picks the tile
 * origin, so every frame differs and no wall clock / RNG is involved.
 */

const TILE_PX = 256;

/* Integer hash (mulberry32-style) — stable across runs and platforms. */
const hash = (n: number): number => {
  let t = (n | 0) + 0x6d2b79f5;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const offset = (frame: number, seed: number): string => {
  const x = Math.floor(hash(frame * 2 + seed) * TILE_PX);
  const y = Math.floor(hash(frame * 2 + seed + 1) * TILE_PX);
  return `${x}px ${y}px`;
};

export type GrainOverlayProps = {
  firstOpacity?: number;
  secondOpacity?: number;
};

export const GrainOverlay: React.FC<GrainOverlayProps> = ({
  firstOpacity = 0.012,
  secondOpacity = 0.008,
}) => {
  const frame = useCurrentFrame();
  return (
    <>
      <AbsoluteFill
        style={{
          backgroundImage: `url(${staticFile('grain/fine-256.png')})`,
          backgroundPosition: offset(frame, 0),
          opacity: firstOpacity,
          pointerEvents: 'none',
        }}
      />
      <AbsoluteFill
        style={{
          backgroundImage: `url(${staticFile('grain/fine-256.png')})`,
          backgroundPosition: offset(frame, 977),
          opacity: secondOpacity,
          pointerEvents: 'none',
        }}
      />
    </>
  );
};
