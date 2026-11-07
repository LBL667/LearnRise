/**
 * Remotion CLI configuration for a rendered project.
 *
 * Chrome is resolved from `.env.json` (written by scripts/doctor.mjs), with an
 * explicit `$REMOTION_CHROME` override taking precedence. We deliberately never
 * trigger Remotion's Chromium download: on this machine remotion.media is
 * unreachable and the download hangs.
 */

import fs from 'node:fs';
import path from 'node:path';
import { Config } from '@remotion/cli/config';

function readEnvChrome(): string | null {
  try {
    const raw = fs.readFileSync(path.join(process.cwd(), '.env.json'), 'utf8');
    const env = JSON.parse(raw) as { chromePath?: unknown };
    return typeof env.chromePath === 'string' && env.chromePath ? env.chromePath : null;
  } catch {
    return null;
  }
}

const chromePath = process.env.REMOTION_CHROME || readEnvChrome();

if (chromePath) {
  Config.setBrowserExecutable(chromePath);
}

Config.setVideoImageFormat('png');
Config.setPixelFormat('yuv420p');
Config.setColorSpace('bt709');
Config.setOverwriteOutput(true);
// Measured budget: 720 frames at --concurrency=2 takes ~95s on this box.
Config.setConcurrency(2);
