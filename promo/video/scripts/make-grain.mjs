#!/usr/bin/env node
/**
 * make-grain.mjs — generate the deterministic fine film-grain tile.
 *
 * Writes `public/grain/fine-256.png`: a 256x256 8-bit grayscale tile made of
 * 2x2-px cells of uniform white noise. Unlike the old `coarse-512.png`
 * (512 px blobs), this reads as film grain instead of dark clouds at frame
 * scale. The PRNG is a fixed 32-bit LCG with no wall-clock input, so the tile
 * is reproducible byte-for-byte on every machine.
 *
 * Usage: node scripts/make-grain.mjs [--size=256] [--cell=2]
 */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(PROJECT_ROOT, 'public', 'grain', 'fine-256.png');

const arg = (name, fallback) => {
  const hit = process.argv.slice(2).find((value) => value.startsWith(`--${name}=`));
  return hit ? Number(hit.split('=')[1]) : fallback;
};

const size = Math.round(arg('size', 256));
const cell = Math.max(1, Math.round(arg('cell', 2)));

/* Deterministic 32-bit LCG (Numerical Recipes constants). */
let state = 0x1a2b3c4d;
const nextByte = () => {
  state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
  return state >>> 24;
};

const pixels = Buffer.alloc(size * size);
for (let y = 0; y < size; y += 1) {
  for (let x = 0; x < size; x += 1) {
    const cx = Math.floor(x / cell);
    const cy = Math.floor(y / cell);
    const index = cy * Math.ceil(size / cell) + cx;
    /* Re-seed per cell so tiling the tile is seamless in distribution. */
    state = (Math.imul(index + 1, 0x9e3779b1) + 0x1a2b3c4d) >>> 0;
    pixels[y * size + x] = nextByte();
  }
}

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c >>> 0;
}
const crc32 = (buffer) => {
  let c = 0xffffffff;
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type, data) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
};

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(size, 0);
ihdr.writeUInt32BE(size, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 0; // grayscale
ihdr[10] = 0; // deflate
ihdr[11] = 0; // adaptive filtering
ihdr[12] = 0; // no interlace

/* One filter byte (0 = none) per scanline. */
const raw = Buffer.alloc(size * (size + 1));
for (let y = 0; y < size; y += 1) {
  raw[y * (size + 1)] = 0;
  pixels.copy(raw, y * (size + 1) + 1, y * size, (y + 1) * size);
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, png);
console.log(`wrote ${path.relative(PROJECT_ROOT, OUT)} (${png.length} bytes, ${size}x${size}, ${cell}px cells)`);
