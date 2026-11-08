#!/usr/bin/env node
// Verifies that the bundled font subsets actually load, and that the check has
// teeth: Chrome returns `true` from document.fonts.check() for ANY family that
// is not declared in the FontFaceSet, so a bare check is a no-op. A family only
// counts as available when a matching FontFace is declared AND loaded, which is
// exactly what the --no-face reverse run must turn into `false`.
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFile, readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const execFileAsync = promisify(execFile);
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = path.dirname(SCRIPT_DIR);
const TEMPLATE_DIR = path.join(SKILL_ROOT, 'template');
const SRC_FONTS_TS = path.join(TEMPLATE_DIR, 'src', 'fonts.ts');
const PUBLIC_DIR = path.join(TEMPLATE_DIR, 'public');

const SAMPLE_TEXT = {
  sans: '地基引擎模型接口',
  mono: 'Hamburgefonstiv 0123',
};

const HELP = `Usage: node scripts/font-check.mjs [options]

Loads the bundled font subsets in headless Chrome and verifies the check has
teeth: a --no-face reverse run must report every family unavailable.

Options:
  --json            machine-readable report on stdout
  --detail          include per-face detail
  --no-face         reverse run: declare no FontFace (every family must be false)
  --shots           save a screenshot (requires --out)
  --system-fonts    do not isolate fontconfig from system fonts
  --out=<dir>       screenshot output directory
  --help, -h        show this help and exit 0

Example:
  node scripts/font-check.mjs --json
`;

const parseArgs = (argv) => {
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  return {
    json: flags.has('--json'),
    detail: flags.has('--detail'),
    noFace: flags.has('--no-face'),
    shots: flags.has('--shots'),
    systemFonts: flags.has('--system-fonts'),
    outDir: (argv.find((a) => a.startsWith('--out=')) || '').slice('--out='.length),
  };
};

const readFaces = async () => {
  const source = await readFile(SRC_FONTS_TS, 'utf8');
  const re = /role:\s*'([^']+)',\s*family:\s*'([^']+)',\s*file:\s*'([^']+)',\s*weight:\s*'([^']+)'/g;
  const faces = [];
  for (const match of source.matchAll(re)) {
    faces.push({ role: match[1], family: match[2], file: match[3], weight: match[4] });
  }
  if (faces.length === 0) {
    throw new Error(`no font faces parsed from ${SRC_FONTS_TS}`);
  }
  for (const face of faces) {
    const abs = path.join(PUBLIC_DIR, 'fonts', face.file);
    if (!existsSync(abs)) {
      throw new Error(`missing font file: ${abs}`);
    }
  }
  return faces;
};

const findChrome = () => {
  const candidates = [
    process.env.CHROME_PATH,
    ...(existsSync(path.join(os.homedir(), '.cache/ms-playwright'))
      ? [path.join(os.homedir(), '.cache/ms-playwright')]
      : []),
  ].filter(Boolean);
  const direct = [
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
  for (const candidate of direct) {
    if (existsSync(candidate)) return candidate;
  }
  for (const root of candidates) {
    if (root.endsWith('chrome') && existsSync(root)) return root;
    if (!existsSync(root)) continue;
    const entries = readdirSync(root, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const candidate = path.join(root, entry.name, 'chrome-linux64', 'chrome');
      if (existsSync(candidate)) return candidate;
    }
  }
  throw new Error('no chrome found; set CHROME_PATH');
};

const isolatedFontconfig = async () => {
  const root = path.join(os.tmpdir(), `font-check-fc-${process.pid}`);
  const fontsDir = path.join(root, 'fonts');
  const cacheDir = path.join(root, 'cache');
  await mkdir(fontsDir, { recursive: true });
  await mkdir(cacheDir, { recursive: true });
  const latinOnly = [
    '/usr/share/fonts/liberation-sans-fonts/LiberationSans-Regular.ttf',
    '/usr/share/fonts/liberation-mono-fonts/LiberationMono-Regular.ttf',
    '/usr/share/fonts/liberation-serif-fonts/LiberationSerif-Regular.ttf',
  ].filter((f) => existsSync(f));
  if (latinOnly.length === 0) {
    throw new Error('no Latin-only base font found for fontconfig isolation');
  }
  for (const font of latinOnly) {
    await copyFile(font, path.join(fontsDir, path.basename(font)));
  }
  const file = path.join(root, 'fonts.conf');
  await writeFile(
    file,
    `<?xml version="1.0"?>\n` +
      `<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">\n` +
      `<fontconfig><dir>${fontsDir}</dir><cachedir>${cacheDir}</cachedir></fontconfig>\n`,
  );
  return { file, root };
};

const auditHtml = (faces, { noFace, viewport }) => {
  const faceCss = noFace
    ? ''
    : faces
        .map(
          (f) =>
            `@font-face{font-family:"${f.family}";src:url("/fonts/${f.file}") format("woff2");` +
            `font-weight:${f.weight};font-style:normal;font-display:block;}`,
        )
        .join('\n');
  const rows = faces
    .map(
      (f) =>
        `<div class="row" style="font-family:'${f.family}',monospace">${f.family} 地基引擎模型接口 0123</div>`,
    )
    .join('\n');
  return `<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><style>
html,body{margin:0;background:#111;color:#eee;font-size:28px}
#audit{padding:24px;width:${viewport.width}px}
.row{margin:8px 0;white-space:nowrap}
${faceCss}
</style></head><body><div id="audit">${rows}</div><pre id="result">pending</pre>
<script>
(async () => {
  const faces = ${JSON.stringify(faces.map((f) => ({
    family: f.family,
    weight: f.weight,
    sample: SAMPLE_TEXT[f.role] || SAMPLE_TEXT.sans,
    generic: f.role === 'mono' ? 'sans-serif' : 'serif',
  })))};
  await document.fonts.ready;
  const declared = new Set([...document.fonts].map((f) => f.family.replace(/["']/g, '')));
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const measure = (font, text) => { ctx.font = font; return ctx.measureText(text).width; };
  const out = {};
  for (const face of faces) {
    const raw = document.fonts.check('16px "' + face.family + '"');
    const isDeclared = declared.has(face.family);
    out[face.family] = {
      rawCheck: raw,
      declared: isDeclared,
      available: isDeclared && raw,
      loadedEntries: [...document.fonts].filter((f) => f.family.replace(/["']/g, '') === face.family && f.status === 'loaded').length,
      widthWithFace: measure('28px "' + face.family + '"', face.sample),
      widthFallback: measure('28px ' + face.generic, face.sample),
      widthUpper: measure('28px "' + face.family + '"', 'MMMM'),
      widthLower: measure('28px "' + face.family + '"', 'iiii'),
    };
  }
  document.getElementById('result').textContent = 'RESULT:' + JSON.stringify(out);
})();
</script></body></html>`;
};

const serve = async (faces, options) => {
  const html = auditHtml(faces, options);
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/audit.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }
    if (url.pathname.startsWith('/fonts/')) {
      try {
        const body = await readFile(path.join(PUBLIC_DIR, url.pathname));
        res.writeHead(200, { 'content-type': 'font/woff2' });
        res.end(body);
      } catch {
        res.writeHead(404).end('not found');
      }
      return;
    }
    res.writeHead(404).end('not found');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, port: server.address().port };
};

const runChrome = async (chrome, url, { screenshotPath, viewport, env }) => {
  const args = [
    '--headless',
    '--no-sandbox',
    '--disable-gpu',
    '--hide-scrollbars',
    '--virtual-time-budget=8000',
    `--window-size=${viewport.width},${viewport.height}`,
  ];
  if (screenshotPath) {
    args.push(`--screenshot=${screenshotPath}`);
  } else {
    args.push('--dump-dom');
  }
  args.push(url);
  const { stdout, stderr } = await execFileAsync(chrome, args, {
    maxBuffer: 32 * 1024 * 1024,
    timeout: 60000,
    env,
  });
  return { stdout, stderr };
};

const main = async () => {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(HELP);
    return 0;
  }
  const args = parseArgs(argv);
  const faces = await readFaces();
  const chrome = findChrome();
  const viewport = { width: 900, height: 240 };

  const isolation = args.systemFonts ? null : await isolatedFontconfig();
  const env = isolation
    ? { ...process.env, FONTCONFIG_FILE: isolation.file, FONTCONFIG_PATH: isolation.root }
    : process.env;

  const { server, port } = await serve(faces, { noFace: args.noFace, viewport });
  let result;
  try {
    const url = `http://127.0.0.1:${port}/audit.html`;
    if (args.shots && args.outDir) {
      await mkdir(args.outDir, { recursive: true });
      const shot = path.join(
        args.outDir,
        args.noFace ? 'task-3-width-without.png' : 'task-3-width-with.png',
      );
      await runChrome(chrome, url, { screenshotPath: shot, viewport, env });
    }
    const { stdout } = await runChrome(chrome, url, { viewport, env });
    const match = stdout.match(/RESULT:(\{.*?\})<\/pre>/s);
    if (!match) {
      throw new Error('no RESULT payload in rendered DOM');
    }
    result = JSON.parse(match[1]);
  } finally {
    server.close();
  }

  const flat = Object.fromEntries(
    faces.map((face) => [face.family, Boolean(result[face.family]?.available)]),
  );

  if (args.json) {
    process.stdout.write(JSON.stringify(args.detail ? result : flat) + '\n');
  } else {
    const label = args.noFace ? 'no-face (reverse test)' : 'with-face';
    const fc = args.systemFonts ? 'system-fonts' : 'isolated-fontconfig (no system fonts)';
    process.stdout.write(`font-check [${label}] chrome=${chrome} fc=${fc}\n`);
    for (const face of faces) {
      const info = result[face.family];
      process.stdout.write(
        `  ${flat[face.family] ? 'PASS' : 'FAIL'} ${face.family.padEnd(14)}` +
          ` available=${info.available} declared=${info.declared}` +
          ` rawCheck=${info.rawCheck} width=${info.widthWithFace.toFixed(2)}` +
          ` fallbackWidth=${info.widthFallback.toFixed(2)}\n`,
      );
    }
  }
  return 0;
};

main().then(
  (code) => process.exit(code),
  (error) => {
    process.stderr.write(`font-check failed: ${error?.stack || error}\n`);
    process.exit(1);
  },
);
