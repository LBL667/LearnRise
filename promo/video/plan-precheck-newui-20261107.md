# Plan Pre-Check — learnrise-promo-newui-dynamic (Task 1)

- Date: 2026-11-07
- Plan: `/home/sky/竞赛/华为ICT/.sisyphus/plans/learnrise-promo-newui-dynamic.md` (`$PLAN`)
- Film root: `/home/sky/文档/Gitprojects/remotion-video-pipeline/projects/learnrise-promo-3min` (`$FILM`)
- Mode: READ-ONLY verification. Only this report file was created. No `src/**`, `scripts/**`, `package.json`, `storyboard.json`, `film.ts` or plan file was modified.

---

## A. PLAN SELF-PARSE PRE-CHECK

Run from `/home/sky/竞赛/华为ICT`.

| # | Command | Expected | Actual | Status |
|---|---|---|---|---|
| A1 | `grep -cE '^- \[ \] [0-9]+\. ' $PLAN` | 17 | **17** (exit 0) | PASS |
| A2 | `grep -cE '^- \[ \] F[1-4]\.' $PLAN` | 4 | **4** (exit 0) | PASS |
| A3 | `grep -cE '^  Parallelization: Wave' $PLAN` | 17 | **17** (exit 0) | PASS |
| A4 | `grep -cE '^[[:space:]]+[-*][[:space:]]*\[[ xX]\]' $PLAN` | 0 | **0** (exit 1 = no match) | PASS |
| A5 | `grep -cE '^  \*\*Must NOT do\*\*' $PLAN` | 17 | **17** (exit 0) | PASS |

Raw stdout:

```
=== A1 ===
17
exit=0
=== A2 ===
4
exit=0
=== A3 ===
17
exit=0
=== A4 ===
0
exit=1
=== A5 ===
17
exit=0
```

### A6. Wave continuity

Parsed every `Parallelization:` line (regex `^  Parallelization: (Final Wave|Wave \d+) \| ...`).
21 checkbox items found: 17 numeric TODOs + F1–F4.

```
WAVE SET: ['Final Wave', 'Wave 1', 'Wave 2', 'Wave 3', 'Wave 4', 'Wave 5', 'Wave 6', 'Wave 7']
```

`Wave 1..Wave 7` all present and contiguous; literal `Final Wave` present for F1–F4. **PASS**

### A7. Dependency graph

Parsed all `Blocked by:` / `Blocks:` fields. Result: **PASS** (0 violations).

```
EDGE COUNT: 40
EDGE LIST:
  1 -> 2
  2 -> 3
  2 -> 4
  3 -> 4
  3 -> 6
  3 -> 14
  3 -> 15
  4 -> 5
  5 -> 7
  6 -> 7
  6 -> 8
  6 -> 12
  6 -> 14
  6 -> 15
  7 -> 8
  7 -> 11
  8 -> 9
  9 -> 10
  9 -> 11
  10 -> 11
  10 -> 14
  11 -> 12
  11 -> 13
  11 -> 16
  11 -> F1
  11 -> F3
  12 -> 16
  13 -> 17
  13 -> F4
  14 -> 13
  14 -> 16
  14 -> F2
  14 -> F4
  15 -> 13
  15 -> 16
  15 -> F2
  15 -> F4
  16 -> 17
  16 -> F4
  17 -> F1
VIOLATIONS: NONE
GRAPH_RESULT: PASS
```

Checks performed:
- (a) every referenced id ∈ {1..17, F1..F4}: no dangling refs.
- (b) symmetry: every `A Blocks B` has `B Blocked by A`, and vice-versa: no asymmetry.
- (c) acyclic: DFS found no cycle.

Task field inventory (line numbers in `$PLAN`):

```
1:  line245 wave=Wave 1     bb=-              blocks=2
2:  line270 wave=Wave 1     bb=1              blocks=3, 4
3:  line292 wave=Wave 1     bb=2              blocks=4, 6, 14, 15
4:  line317 wave=Wave 2     bb=2, 3           blocks=5
5:  line340 wave=Wave 2     bb=4              blocks=7
6:  line362 wave=Wave 2     bb=3              blocks=7, 8, 12, 14, 15
7:  line387 wave=Wave 3     bb=5, 6           blocks=8, 11
8:  line409 wave=Wave 4     bb=7, 6           blocks=9
9:  line435 wave=Wave 4     bb=8              blocks=10, 11
10: line457 wave=Wave 5     bb=9              blocks=11, 14
11: line478 wave=Wave 5     bb=7, 9, 10       blocks=12, 13, 16, F1, F3
12: line501 wave=Wave 5     bb=6, 11          blocks=16
13: line522 wave=Wave 6     bb=11, 14, 15     blocks=17, F4
14: line540 wave=Wave 6     bb=3, 6, 10       blocks=13, 16, F2, F4
15: line561 wave=Wave 6     bb=3, 6           blocks=13, 16, F2, F4
16: line582 wave=Wave 6     bb=11, 12, 14, 15 blocks=17, F4
17: line605 wave=Wave 7     bb=13, 16         blocks=F1
F1: line631 wave=Final Wave bb=11, 17         blocks=-
F2: line636 wave=Final Wave bb=14, 15         blocks=-
F3: line641 wave=Final Wave bb=11             blocks=-
F4: line646 wave=Final Wave bb=13, 14, 15, 16 blocks=-
```

> Note: an initial parse that only matched `Parallelization: Wave \d+` falsely reported 9 asymmetries because F1–F4 use the literal `Final Wave`. After matching `Final Wave`, the graph is fully symmetric and acyclic. Recorded here so the false FAIL is not repeated.

**PLAN_PARSE = PASS**

---

## B. SCRIPT PATH PRECONDITION

Every path tested with `test -f` (real command, no guessing):

```
OK build-storyboard.mjs      :: $FILM/scripts/build-storyboard.mjs
OK render-scene.mjs          :: $FILM/scripts/render-scene.mjs
OK mix-audio.mjs             :: $FILM/scripts/mix-audio.mjs
OK tts.mjs                   :: $FILM/scripts/tts.mjs
OK timeline-check.mjs        :: $FILM/scripts/timeline-check.mjs
OK check-facts.mjs           :: $FILM/scripts/check-facts.mjs
OK lint-content.mjs          :: $FILM/scripts/lint-content.mjs
OK gate.mjs                  :: /home/sky/.config/opencode/skills/remotion-video/scripts/gate.mjs
OK audit.mjs                 :: /home/sky/.config/opencode/skills/remotion-video/scripts/audit.mjs
OK validate-storyboard.mjs   :: /home/sky/.config/opencode/skills/remotion-video/scripts/validate-storyboard.mjs
OK lint-determinism.mjs      :: /home/sky/.config/opencode/skills/remotion-video/scripts/lint-determinism.mjs
OK contact-sheet.mjs         :: /home/sky/.config/opencode/skills/remotion-video/scripts/contact-sheet.mjs
OK determinism-check.mjs     :: /home/sky/.config/opencode/skills/remotion-video/scripts/determinism-check.mjs
OK render.mjs                :: /home/sky/文档/Gitprojects/remotion-video-pipeline/skill/remotion-video/scripts/render.mjs
```

All 14 found → **SCRIPTS_OK**.

**SCRIPTS = PASS**

---

## C. PLAN PATH AUDIT

`$PLAN` line 37 defines `$SKILL = /home/sky/.config/opencode/skills/remotion-video` and correctly refers to `scripts/gate.mjs`, `audit.mjs`, `validate-storyboard.mjs`.

However, later sections write `$SKILL/remotion-video/scripts/...`, which **does not exist**:

```
$ ls /home/sky/.config/opencode/skills/remotion-video/remotion-video/scripts/render.mjs
ls: 无法访问 ... 没有那个文件或目录
```

Actual skill scripts live directly under `$SKILL/scripts/`:

```
$ ls /home/sky/.config/opencode/skills/remotion-video/scripts
audit.mjs autofix.mjs beat-check.mjs build-font-subsets.py check-facts.mjs contact-sheet.mjs
determinism-check.mjs doctor.mjs font-check.mjs gate.mjs gate.test.mjs golden-check.mjs
lint-determinism.mjs new-project.mjs render-clip.mjs render.mjs validate-storyboard.mjs
```

### CANONICAL_SKILL_SCRIPTS
```
CANONICAL_SKILL_SCRIPTS=/home/sky/.config/opencode/skills/remotion-video/scripts
```

### Wrong references in the plan (must be corrected by orchestrator)

| Plan line | Written form | Problem | Correct form |
|---|---|---|---|
| 249 | `$SKILL/remotion-video/scripts/*` | non-existent double `remotion-video` | `$SKILL/scripts/*` |
| 481 | `node "$SKILL/remotion-video/scripts/gate.mjs" ...` | non-existent path | `node "$SKILL/scripts/gate.mjs" ...` |
| 683 | `node $SKILL/remotion-video/scripts/gate.mjs ...` | non-existent path | `node $SKILL/scripts/gate.mjs ...` |
| 687 | `node $SKILL/remotion-video/scripts/validate-storyboard.mjs ...` | non-existent path | `node $SKILL/scripts/validate-storyboard.mjs ...` |
| 469 | `skill/remotion-video/scripts/render.mjs` | relative form; under `$FILM` this resolves to a non-existent `$FILM/skill/...`; only valid from the `remotion-video-pipeline` repo root | `/home/sky/文档/Gitprojects/remotion-video-pipeline/skill/remotion-video/scripts/render.mjs` |

Line 492 uses `skill/remotion-video/scripts/{...}` and is similarly repo-root-relative, not `$FILM`-relative.

### `$FILM/package.json` render target

```
"render": "node ../../skill/remotion-video/scripts/render.mjs --project=. --composition=Film --output=out/film.mp4 --concurrency=2"
```

Resolved from `$FILM`:

```
$ realpath -e "$FILM/../../skill/remotion-video/scripts/render.mjs"
/home/sky/文档/Gitprojects/remotion-video-pipeline/skill/remotion-video/scripts/render.mjs
RENDER_TARGET_OK
```

The `render` script target resolves to an existing file. **PASS**

---

## D. REUSE-ASSET VERIFICATION

### D1. `$FILM/src/components/HtmlClip.tsx`

- Props (`HtmlClipProps`): **only** `src: string`, `width: number`, `height?: number`, `style?: React.CSSProperties` — exactly the required set. **PASS**
- Hardcodes `demo.mp4`? **No** — the string appears only in doc comments (lines 13, 24). The component uses `staticFile(src)`. **PASS**
- Passes `muted`? **Yes** — `<OffthreadVideo src={staticFile(src)} muted ... />` (line 46–48). **PASS**
- Uses `staticFile`? **Yes** — imported from `remotion` and applied to `src`. **PASS**
- Has `durationInFrames` prop? **No** (matches known invariant). Whole-clip playback only.

### D2. Scene usage

```
grep -RIn 'HtmlClip' $FILM/src/scenes/            → 0 matches  (expected 0)  PASS
ls $FILM/src/scenes/S*.tsx | wc -l                → 11         (expected 11) PASS
grep -RIn 'staticFile' $FILM/src/scenes/ | wc -l  → 19         (baseline 19) PASS
```

Scene files: S01Hook, S02Loop, S03Upload, S04Tree, S05Quiz, S06Explain, S07Practice, S08Review, S09Competition, S10Profile, S11Outro.

### D3. `public/clips/demo/demo.mp4`

```
$ ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,width,height,r_frame_rate,nb_frames -of default=nw=1
codec_name=h264
width=1920
height=1080
r_frame_rate=30/1
nb_frames=90
exit=0
```

```
$ ffprobe -v error -show_entries stream=codec_type -of csv=p=0
video
exit=0
```

Only a `video` stream (no audio). Size 47,434 bytes. **PASS**

### D4. Unreferenced check

```
grep -RIn 'demo.mp4' $FILM/src/
src/components/HtmlClip.tsx:13: *   `clips/demo/demo.mp4`. Render it with `scripts/render-clip.mjs`.
src/components/HtmlClip.tsx:24:  /** Public-relative path of the pre-rendered mp4, e.g. `clips/demo/demo.mp4`. */
count=2
```

Expected `0`; actual `2`. **Honest note:** both matches are documentation comments inside `HtmlClip.tsx`, not executable references. No scene, registry or composition imports `demo.mp4`. So the file is effectively unreferenced, but the literal grep count is 2, not 0.

### D5. Decision recommendation

`demo.mp4` = **delete** (preferred).

Rationale: no executable reference anywhere in `src/**` (only two doc comments in an unused component); it is a 90-frame demo clip unrelated to the 11-scene new-UI film; leaving it invites accidental reuse and violates the "no stale assets" objective. **Nothing was deleted in this task.**

**REUSE = PASS** (with note: grep count 2 = doc comments only, no code reference)

---

## E. TOOLCHAIN PIN

| Tool | Resolved path / version | Status |
|---|---|---|
| ffmpeg | `ffmpeg version 8.1.3 Copyright (c) 2000-2026 the FFmpeg developers` | PASS (prefix matches) |
| node | `v20.20.2` | recorded |
| npm | `10.8.2` | recorded |
| edge-tts | `~/.local/share/remotion-video/ttsvenv/bin/edge-tts` → `edge-tts 7.3.1` | PASS |
| Chromium | `/home/sky/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome` (executable) | CHROMIUM_OK |
| Playwright npm pkg | `1.64.1` | PASS |

### Playwright location

Not present in `$FILM/node_modules` (`NOT_FOUND:MODULE_NOT_FOUND`) and not vendored under `remotion-video-pipeline`. Found at:

```
/home/sky/竞赛/华为ICT/LearnRise/frontend/node_modules/playwright/package.json   → 1.64.1
/home/sky/竞赛/华为ICT/frontend/node_modules/playwright/package.json            → 1.64.1
```

Recorded: Playwright 1.64.1 lives in `LearnRise/frontend/node_modules` (mirror in ICT `frontend/node_modules`). Task 4 must resolve Playwright from there (or install it into `$FILM`) before adding `record-ui.mjs`.

### Git state of `$FILM`

```
git -C $FILM rev-parse --is-inside-work-tree  → true
git -C $FILM rev-parse --show-toplevel        → /home/sky/文档
git -C $FILM symbolic-ref -q HEAD             → refs/heads/master
git -C $FILM log -1 --oneline                 → 致命错误：您的当前分支 'master' 尚无任何提交
git -C $FILM rev-parse --short HEAD           → 致命错误：需要一个单独的版本 (exit 128)
```

`$FILM` is **not its own git repo**. It is nested inside the parent repo `/home/sky/文档` (branch `master`, **zero commits**), so there is no HEAD hash. The plan itself notes `$FILM` lives inside the `/home/sky/文档` parent repo and forbids committing there.

**TOOLCHAIN = PASS**

---

## F. FOUR-CHAPTER WRITEBACK CHECK

`grep -n` on `$PLAN`:

```
71:  ### Metis Review（Identified Gaps G1–G11 · 已回写）
111: ## Momus Review（严格可执行性 / 验收 · 8 条 · 已回写）
124: ## Hard-Gap Rulings（Momus 先行 3 项硬缺口 · 已裁决）
89:  ## Blocking Rulings（已由用户明确裁决 · 2026-11-07）
```

All four required chapters present. Ordering in file: Metis (71) → Blocking Rulings (89) → Momus (111) → Hard-Gap Rulings (124). **PASS**

---

## G. Additional invariant snapshot (context, not a gate)

```
src/content/film.ts:  FPS = 30; minSeconds = 12,20,24,24,26,24,22,20,20,16,16 (sum 224)
src/theme/tokens.ts:  canvas = { width: 1920, height: 1080, fps: 30, frames: 6720 }
src/Root.tsx:         composition id="Film", fps/frames from tokens
```

Matches plan invariants (11 scenes, 224s, 6720 frames @30fps, 1920x1080).

## H. Known gaps (expected, to be filled by later tasks)

- `$FILM/scripts/record-ui.mjs` — **absent** (Task 4 creates it).
- `$FILM/playwright.record.config.ts` — **absent** (Task 4 creates it).
- `$FILM/public/ui/` — **58 old-UI PNGs** (2026-11-02 residue) still present; this plan must eliminate them.
- `$FILM/out/film.mp4` — 384,662,972 bytes, built from the OLD UI round; must be rebuilt.
- Playwright 1.64.1 is not installed in `$FILM/node_modules`; must be resolved/installed before Task 4.

## I. Workspace cleanliness

No source file, script, config, plan or asset was written or deleted. The only file created by this task is this report. `$FILM` has no own git repo; its parent `/home/sky/文档` is a zero-commit repo with a large pre-existing untracked tree, so a meaningful `git status` diff cannot be produced for `$FILM` alone.

---

## FINAL VERDICT

```
TASK1: PLAN_PARSE=PASS SCRIPTS=PASS REUSE=PASS TOOLCHAIN=PASS
```
