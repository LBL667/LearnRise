#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SCENES } from './record-scenes.mjs'

const FILM_ROOT = process.env.FILM_ROOT ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const LR_ROOT = process.env.LR_ROOT ?? '/home/sky/竞赛/华为ICT/LearnRise'
const CONFIG = process.env.RECORD_CONFIG ?? path.join(LR_ROOT, 'frontend', 'playwright.record.config.ts')
const RAW_DIR = path.join(FILM_ROOT, 'recordings', 'raw')
const MANIFEST = path.join(FILM_ROOT, 'recordings', 'raw_manifest.json')
const verifyOnly = process.argv.includes('--verify-only')

function probe(file) {
  const result = spawnSync(
    'ffprobe',
    [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height,r_frame_rate,duration',
      '-show_entries', 'format=duration,size',
      '-of', 'json',
      file,
    ],
    { encoding: 'utf8' },
  )
  if (result.status !== 0) {
    console.error(`ffprobe failed for ${file}: ${result.stderr?.trim()}`)
    return null
  }
  let parsed
  try {
    parsed = JSON.parse(result.stdout)
  } catch (error) {
    console.error(`ffprobe output unparsable for ${file}: ${error.message}`)
    return null
  }
  const stream = (parsed.streams ?? [])[0] ?? {}
  const duration = Number(stream.duration ?? parsed.format?.duration)
  return {
    width: Number(stream.width ?? 0),
    height: Number(stream.height ?? 0),
    rFrameRate: String(stream.r_frame_rate ?? ''),
    durationSeconds: Number.isFinite(duration) ? Number(duration.toFixed(3)) : 0,
    bytes: fs.statSync(file).size,
  }
}

console.log(`[record-ui] project: ${FILM_ROOT}`)
console.log(`[record-ui] config:   ${CONFIG}`)

let testStatus = 0
if (!verifyOnly) {
  fs.mkdirSync(RAW_DIR, { recursive: true })
  const result = spawnSync('npx', ['playwright', 'test', '--config', CONFIG], {
    cwd: process.env.RECORD_CWD ?? path.join(LR_ROOT, 'frontend'),
    stdio: 'inherit',
    env: { ...process.env, FILM_ROOT, LR_ROOT },
  })
  if (result.error) {
    console.error(`[record-ui] failed to spawn playwright: ${result.error.message}`)
    testStatus = 1
  } else {
    testStatus = result.status ?? 1
  }
  console.log(`[record-ui] playwright exit code: ${testStatus}`)
}

const manifest = []
const problems = []

for (const scene of SCENES) {
  const file = path.join(RAW_DIR, `${scene.id}.webm`)
  if (!fs.existsSync(file)) {
    problems.push(`${scene.id}: missing ${file}`)
    manifest.push({
      scene: scene.id,
      file: path.relative(FILM_ROOT, file),
      durationSeconds: 0,
      width: 0,
      height: 0,
      rFrameRate: '',
      bytes: 0,
    })
    continue
  }
  const meta = probe(file)
  if (meta === null) {
    problems.push(`${scene.id}: ffprobe failed`)
    continue
  }
  manifest.push({
    scene: scene.id,
    file: path.relative(FILM_ROOT, file),
    durationSeconds: meta.durationSeconds,
    width: meta.width,
    height: meta.height,
    rFrameRate: meta.rFrameRate,
    bytes: meta.bytes,
  })
  if (meta.durationSeconds < scene.targetSeconds) {
    problems.push(
      `${scene.id}: duration ${meta.durationSeconds}s < target ${scene.targetSeconds}s`,
    )
  }
}

fs.mkdirSync(path.dirname(MANIFEST), { recursive: true })
fs.writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`)

console.log('[record-ui] manifest:')
console.log(JSON.stringify(manifest, null, 2))

if (problems.length > 0) {
  console.error('\n[record-ui] PROBLEMS:')
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}
if (testStatus !== 0) {
  console.error(`[record-ui] recordings exist but playwright exited ${testStatus}`)
  process.exit(1)
}
console.log(`\n[record-ui] OK: ${manifest.length} clips, manifest at ${MANIFEST}`)
