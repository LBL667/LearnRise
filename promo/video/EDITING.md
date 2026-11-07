# EDITING — LearnRise 3-minute promo

Project root: `/home/sky/文档/Gitprojects/remotion-video-pipeline/projects/learnrise-promo-3min`

The film is **6720 frames @ 30 fps = 224.000 s**, 1920×1080, 11 scenes.
`Film` is the master cut; `S01`…`S11` are independently renderable.

The one rule: **authored copy lives in `src/content/film.ts`**. Scene files in
`src/scenes/**` render that copy; `npm run lint-content` fails if a scene file
contains a Chinese string/JSX run longer than 12 non-whitespace characters.
Short data values such as `'小红 1000'` (6 non-whitespace chars) are below that
threshold and are *not* caught — the rule is a long-copy guard, not a general
"no CJK in scenes" rule.

Scene compositions (`S01`…`S11`) are **video-only**: `Root.tsx` wraps each scene
with `Backdrop` + `GrainOverlay` and never mounts narration. Narration audio is
added later by `scripts/mix-audio.mjs`. A narration edit therefore never changes
scene pixels; a `screenText`/`subline`/`kicker`/`footnote`/`dataStrip` edit does.

### UI-refresh changelog (2026-11-06)

The LearnRise `main` UI removed the standalone quiz page, the six profile
settings cards and the server-side theme switch. This film was adjusted
**in-place, without re-capturing any screenshot and without touching the
application repo**:

- **S01** — the middle deck card `s01-bg-quiz.png` (dead `/quiz` route) is
  replaced by `s03-library-ready.png`.
- **S05** — no longer an "answer wrong, auto-create card" scene. It is now the
  knowledge-tree / knowledge-point / mindmap scene, reusing `s04-*.png`
  captures (those pages were unchanged by the UI refresh). `film.ts` copy,
  `S05Quiz.tsx` beats and the S05 narration clip were regenerated.
- **S10** — the six-setting highlight list, `CARD_BOXES` and the light/dark
  switch are gone. `S10Profile.tsx` now cross-fades profile card → masked
  Agent key → avatar sync, using the `s10-*-768.png` captures that still
  exist. `film.ts` copy, `S10Profile.tsx` and the S10 narration clip were
  regenerated.
- **S02/S11** fact numbers are unchanged and still `check-facts`-clean
  (67 paths / 77 operations / 498 tests).
- `claims.md` rows 20/21/32/33 and the mock-text limitation were rewritten
  for the new S05/S10 wording.

Regenerate after any copy edit: `npm run storyboard:build`,
`npm run tts:all -- --scene=Sxx`, `npm run timeline:check`, then re-render the
affected scene(s) and finally `npm run render` + `mix-audio.mjs`.

---

## Change one narration line

1. Edit the scene's `narration` in `src/content/film.ts`.
2. Rebuild the generated contract:
   ```bash
   npm run storyboard:build
   ```
3. Regenerate **only that scene's clip** and re-check the budget:
   ```bash
   npm run tts:all -- --scene=S05
   npm run timeline:check
   ```

`npm run tts:all -- --scene=S05` keeps the other 10 measured rows in
`out/audio/<profile>/narration.json`; clips are cached by a SHA-256 of voice
parameters + text, so the other 10 MP3s are not re-synthesized. If
`timeline:check` reports an overflow, shorten the line and repeat step 3. Do
**not** speed up the voice and do **not** move the 6720-frame boundary.

Narration is audio-only, so this does **not** require `render:scene`: scene
compositions contain no narration audio (see the note at the top). The changed
bytes are `out/audio/<profile>/sNN.mp3`, `narration.json`, `narration.srt` and
the mirrored `out/learnrise-promo.srt`. To update the delivered cut, re-mux
without re-rendering pixels:

```bash
node scripts/mix-audio.mjs --voice=yunyang \
  --video=out/learnrise-promo-video.mp4 \
  --output=out/learnrise-promo.mp4
```

If you also changed a visual field (`screenText`, `subline`, `kicker`,
`footnote`, `dataStrip`), rebuild that scene:

```bash
npm run render:scene -- S05
```

Never hand-edit the SRT; it is generated from `narration.json`.

---

## Change one person's name or score

The cast is generated, not hand-authored:

1. Edit the source of record:
   `/home/sky/竞赛/华为ICT-evidence/learnrise-promo/promo_manifest.json`
   (`students[]`; teachers come from `users[]` where `role === "teacher"`).
   `sync-cast` sorts `students[]` by `points` and derives `rank`. The
   `expected_scores` / `cast` arrays are for the seeding pipeline; `sync-cast`
   does not read them, so keep them aligned manually if you change a score.
2. Regenerate both consumers:
   ```bash
   npm run sync-cast
   ```
   This rewrites exactly `src/content/cast.ts` **and**
   `/home/sky/竞赛/华为ICT-evidence/learnrise-penpot/specs/cast.json`.
   Nothing else in `src/**` or `learnrise-penpot/specs/**` is touched.
3. Rebuild the leaderboard scene (it reads `cast.ts` via `LEADERBOARD`):
   ```bash
   npm run render:scene -- S09
   ```
4. Rebuild only the Penpot rank page (from the Penpot directory):
   ```bash
   cd /home/sky/竞赛/华为ICT-evidence/learnrise-penpot
   node build-page.js rank --dry-run
   node build-page.js rank
   python3 export2x.py --page rank --force
   ```

Teachers stay out of `LEADERBOARD` by construction. Editing `cast.ts` directly
is temporary: the next `sync-cast` overwrites it. The `names`/`points` snapshot
in `specs/pages.json` (rank → leaderboard block) is dry-run readability only;
the builder renders `rowsRef: "cast.leaderboard"`, so the rebuilt board already
reflects the new score without editing `pages.json`.

---

## Change one number (API / tests / services)

1. Edit `src/content/facts.ts` (`API_PATHS`, `API_OPERATIONS`,
   `TESTS_*`, `SERVICES`).
2. Prove it against the LearnRise baseline:
   ```bash
   npm run check-facts
   ```
   If this fails, the repository baseline disagrees — fix `facts.ts`, never the
   baseline, and never the check script.
3. Regenerate the storyboard copy and rebuild the affected scenes:
   ```bash
   npm run storyboard:build
   npm run render:scene -- S02
   npm run render:scene -- S11
   ```

S02's data strip and S11's narration/data strip interpolate these constants, so
they cannot go stale independently.

---

## Narration dependencies (edge-tts)

Narration is synthesized with **edge-tts 7.3.1**, pinned in a throwaway
virtualenv that is *not* vendored into this project:

```
~/.local/share/remotion-video/ttsvenv/bin/edge-tts --version   # 7.3.1
```

The venv lives in a **persistent** location (`~/.local/share/remotion-video/`),
not under `/tmp`, so it survives reboots and `/tmp` cleanup. `scripts/tts.mjs`
resolves the binary in this order: `$EDGE_TTS`, then
`~/.local/share/remotion-video/ttsvenv/bin/edge-tts`, then `edge-tts` on `PATH`.
If the venv is ever missing, recreate it at the same path rather than swapping
engines:

```bash
python3 -m venv ~/.local/share/remotion-video/ttsvenv
~/.local/share/remotion-video/ttsvenv/bin/pip install edge-tts==7.3.1
```

`ffmpeg`/`ffprobe` (8.x on this machine) must also be on `PATH`; ffprobe is the
only source of narration durations and ffmpeg pads the 15-second audition pack.

There is **no fallback engine** (no espeak, no alternate provider). A synthesis
failure exits non-zero and leaves the previous clip untouched. Clips are cached
by a SHA-256 of voice parameters + text, so re-running `tts:all` is idempotent.

`npm run tts:all` writes `out/audio/<profile>/{sNN.mp3,narration.json,narration.srt}`,
mirrors the active SRT to `out/learnrise-promo.srt`, and always refreshes
`out/audio/samples/{yunyang,yunjian,xiaoxiao}.mp3` (15.000 s each). Use
`--scene=S05` to regenerate one clip and `--force` to ignore the cache.

---

## Switch voice

`src/content/voice.ts` is the only voice source. Scene files never import it,
and scene videos do not contain narration, so a voice change never requires a
video re-render.

- Temporary A/B, no file edit:
  ```bash
  ACTIVE_VOICE=xiaoxiao npm run tts:all
  ACTIVE_VOICE=xiaoxiao npm run timeline:check
  node scripts/mix-audio.mjs --voice=xiaoxiao \
    --video=out/learnrise-promo-video.mp4 \
    --output=out/learnrise-promo-xiaoxiao.mp4
  ```
- Permanent default: change `VOICES.yunyang.voice` (or the `ACTIVE_VOICE`
  fallback) in `src/content/voice.ts`, then:
  ```bash
  npm run tts:all
  npm run timeline:check
  node scripts/mix-audio.mjs --voice=yunyang \
    --video=out/learnrise-promo-video.mp4 \
    --output=out/learnrise-promo.mp4
  ```

Audio is written to `out/audio/yunyang/` and `out/audio/xiaoxiao/`, so both
cuts coexist. `npm run tts:all` also refreshes `out/audio/samples/*` and the
mirrored `out/learnrise-promo.srt`; those are the only outputs outside the
active `out/audio/<profile>/` directory.

---

## Rebuild one scene

Edit the scene component (`src/scenes/S05Quiz.tsx`, …) or its content in
`src/content/film.ts`, then:

```bash
npm run render:scene -- S05
```

Output: `out/scenes/s05.mp4`. The master `Film` is untouched. This is a
video-only render; narration is added by `scripts/mix-audio.mjs`.

To rebuild the whole cut:

```bash
npm run render
```

Output: `out/film.mp4` (video stream; mux narration + bed separately).

---

## Command map

| Command | What it does |
|---|---|
| `npm run storyboard:build` | regenerates `storyboard.json` from `film.ts` |
| `npm run check-facts` | reconciles `facts.ts` with LearnRise baselines |
| `npm run lint-content` | rejects hardcoded Chinese copy in scene files |
| `npm run sync-cast` | regenerates `cast.ts` + Penpot `specs/cast.json` |
| `npm run timeline:check` | verifies 11 windows sum to 6720 and narration fits |
| `npm run tts:all` | regenerates all 11 narration clips for `ACTIVE_VOICE` |
| `npm run tts:all -- --scene=S05` | regenerates one clip, keeps the other 10 measured rows |
| `npm run render:scene -- S05` | renders one scene composition (video only) |
| `node scripts/mix-audio.mjs --voice=yunyang --video=out/learnrise-promo-video.mp4 --output=out/learnrise-promo.mp4` | muxes narration + bed onto the rendered video (no pixel re-render) |
| `npm run render` | renders the master `Film` to `out/film.mp4` (video-only) |

Validation (no dependencies, safe before every render):

```bash
node ~/.config/opencode/skills/remotion-video/scripts/validate-storyboard.mjs storyboard.json --json
```

### New-UI Dynamic Clips changelog (2026-11-07)

This round replaces the **visual layer** of all 11 scenes with **real browser
recordings of the new UI** (`origin/main @ 9309670`, merged into
`promo/learnrise-video-mockups` as `f5a8629`). The timeline is untouched.

**What changed**

- `public/clips/S01…S11/clip.mp4` — 11 frozen clips, each exactly
  `SCENE_FRAMES[i]` frames (360/600/720/720/780/720/660/600/600/480/480 = 6720),
  1920×1080, **30 fps CFR**, H.264, **no audio track**. Hashes in
  `clips_manifest.json`; budget table in `frame_budget.md`.
- Recording harness: `scripts/record-scenes.mjs` (11 real interaction scripts),
  `scripts/record-ui.mjs` (CLI + manifest), `playwright.record.config.ts` lives
  in `LearnRise/frontend/` because `@playwright/test` must resolve from the app's
  `node_modules` (see `minimal_patches.md` #3).
- Every `src/scenes/S*.tsx` is now a thin wrapper around
  `src/components/ClipScene.tsx`, which mounts `HtmlClip` full-bleed and renders
  the copy in a self-contained lower-third panel. `public/ui/*.png` is no longer
  referenced by any scene; `public/clips/demo/demo.mp4` was deleted.
- `remotion.config.ts`: `Config.setVideoImageFormat('png')` (was `jpeg`). PNG
  capture removes the JPEG intermediate loss, lifting the clip-region PSNR from
  39.3–42.5 dB to **42.2–44.1 dB** and shrinking scene renders ~40%.
- Copy (`film.ts`): S02 「出题」→「陪练」, S05 rewritten as the mindmap scene,
  S08 drops the removed email-reminder toggle, S11 API count 67 → **66** (the
  new-UI OpenAPI document has 66 paths; see plan ruling R8). `screenText`,
  `subline`, `footnote`, `visual` and `assets` were rewritten accordingly.
  Full before/after table: `narration_rewrite.md`.
- TTS: S02 / S05 / S08 / S11 regenerated with the same Yunyang voice; all 11
  segments re-checked by `npm run timeline:check` (tightest margin S10 0.49 s).

**How to re-record**

```bash
docker compose --env-file .env.demo -f docker-compose.yml -f docker-compose.recording.yml up -d   # in LearnRise/
cd /home/sky/竞赛/华为ICT/LearnRise/frontend && npx playwright test --config playwright.record.config.ts
node $FILM/scripts/record-ui.mjs --verify-only      # writes recordings/raw_manifest.json
python3 /tmp/freeze.py                              # or re-run the ffmpeg loop in frame_budget.md
```

**How to verify**

```bash
python3 -c "import json;d=json.load(open('clips_manifest.json'));assert len(d)==11 and sum(x['frames'] for x in d)==6720"
grep -RIn "staticFile" src/scenes/ | grep -c png        # 0
grep -RInE 'loop|startFrom|playbackRate' src/scenes/ | wc -l   # 0
npm run lint-content && npm run check-facts && npm run timeline:check
```
