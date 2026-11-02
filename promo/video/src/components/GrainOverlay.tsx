import React from 'react';
import { AbsoluteFill, staticFile, useCurrentFrame } from 'remotion';


const hash = (n: number): number => {
  const value = Math.sin(n * 12.9898) * 43758.5453;
  return value - Math.floor(value);
};

const offset = (frame: number, seed: number): string => {
  const x = Math.floor(hash(frame + seed) * 512);
  const y = Math.floor(hash(frame + seed + 0.371) * 512);
  return `${x}px ${y}px`;
};

export type GrainOverlayProps = {
  firstOpacity?: number;
  secondOpacity?: number;
};

export const GrainOverlay: React.FC<GrainOverlayProps> = ({
  firstOpacity = 0.05,
  secondOpacity = 0.04,
}) => {
  const frame = useCurrentFrame();
  return (
    <>
      <AbsoluteFill
        style={{
          backgroundImage: `url(${staticFile('grain/coarse-512.png')})`,
          backgroundPosition: offset(frame, 0),
          opacity: firstOpacity,
          pointerEvents: 'none',
        }}
      />
      <AbsoluteFill
        style={{
          backgroundImage: `url(${staticFile('grain/coarse-512.png')})`,
          backgroundPosition: offset(frame, 7.13),
          opacity: secondOpacity,
          pointerEvents: 'none',
        }}
      />
    </>
  );
};
