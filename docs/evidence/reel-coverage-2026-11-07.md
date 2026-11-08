# Reel digest coverage — music-assistant / Neiro (2026-11-07)

Full-corpus sweep, not a sample: every DIGESTS section in the private reel toolkit
gets a row below, including the ones judged irrelevant. Read-only pass — nothing in `reelkit`
was modified or re-digested, and no repo code was touched.

**Corpus size measured today:** `rq.py stats` reports `digest sections : 101`, `dm items indexed : 248`,
`verdict rows : 65`. The work order that commissioned this file says "all 126 DIGESTS sections"; the
126 is the `VERDICTS.md` row count (`wc -l` = 126), not the section count. All **101** sections are
covered here.

## Commands run (verbatim, on this tree)

```
$ cd the private reel toolkit && ./venv/Scripts/python.exe rq.py stats
dm items indexed : 248
digest sections  : 101
verdict rows     : 65

$ ./venv/Scripts/python.exe rq.py project music-assistant
# 42  Oct 28, 2026  note       task-note   Reimplement the entirety of PianoVision in VR
# 82  Oct 24, 2026  reel       adopt       gokayfem/shader-skills: 186 pre-tested GLSL shader functions for coding agents
#246  May 27, 2026   other-url  reference   Scribd document of Michael Jackson multitracks (stems reference)

$ ./venv/Scripts/python.exe rq.py notes music-assistant      # the same item #42 only

# contract §2 asks for "verdict viable" and "verdict implemented": rq.py's verdict enums are
# adopt|trial|reference|reject|hype|task-note (rq.py --help), so the two were mapped.
$ ./venv/Scripts/python.exe rq.py verdict adopt    # 22 rows, incl. #46/#47 (anti-slop tells), #82 (shader-skills)
$ ./venv/Scripts/python.exe rq.py verdict trial    # 19 rows; only §91 (img2threejs) and §97 (AnyScene) are 3D, not this repo
$ ./venv/Scripts/python.exe rq.py gaps             # no unowned gap names this project
```

Searches (12, the four the order names first):

| Query | Hits that matter here |
|---|---|
| `piano` | DM #42 only — no section match |
| `practice` | #65, #113, #173, #209 — none is a practice-mode method |
| `midi` | **no match** anywhere in the corpus |
| `audio` | #41, #173, #190, #246; sections §88, §93 |
| `music` | #82, #105, #137, #148, #149, #161, #246 |
| `webxr vr` / `notation` / `web audio` / `audio worklet` / `transcribe` / `pitch detection` | **no match** |
| `three.js` | #18, #96, #109; section §91 |
| `score` | #13, #59, #144, #173, #215, #218, #228, #235, #238, #243; section §90 |
| `learning app` | #98, #105; section §63 |
| `react` / `accessibility` / `guitar` / `stems` | §89 / §95 / §91 / #21, #222, #242 |

`rq.py section <n>` was then run for every section a search returned (§63, §88, §89, §90, §91, §93,
§95), and `sed` on `DIGESTS.md` for the eight sections whose body `rq.py section` returned as a
heading only (§8, §37, §38, §48, §49, §70, §73, §81 — the parser drops bodies that begin on the same
line as the heading). `INDEX.md` headings were read once to catch what search missed; that is how
§55, §17 and §32 entered the sweep.

## Verdicts already recorded for this project (checked first, §1b)

| Item | Verdict on file | State here |
|---|---|---|
| #42 PianoVision-in-VR note | `task-note` — "owner instruction naming one target app and one delivery mode (VR)" | **applied**: `frontend/src/practice/PianoVisionVRView.tsx` + `vrCalibration.ts` + `pianovisionVr.test.tsx` exist and pass the gate |
| #82 / §81 shader-skills | `adopt` — wired into `~/.dsh/skills/frontend-superskill/SKILL.md` §2.C, "for … the music-assistant VR shaders" | **applied in the harness only**; `grep -riE "glsl\|fragmentShader\|shaderMaterial" frontend/src` = 0 hits, so there is no local shader code to wire it into |
| #246 Michael Jackson multitracks | `reference` — listening reference only, rights unestablished | **not applicable as an asset**: nothing copied, nothing shipped |

## Sections

`n/a` rows carry the one-word reason for skipping. The "applied?" column answers *this repo*, not
the machine.

| § | title | applies? | verdict applied |
|---|---|---|---|
| 1 | swarm simulation engine | no | simulation |
| 2 | AI resume agents | no | resume |
| 3 | multi-agent orchestration | no | agents |
| 4 | agent persona roster | no | personas |
| 5 | After Action Review skill | no | harness |
| 6 | loop engineering | no | harness |
| 7 | 9 GitHub repos (carousel) | no | roundup |
| 8 | 10 Claude skills ← best design source | yes | design skills adopted machine-wide (frontend-superskill). Local hook is `docs/design/DESIGN-BRIEF.md`; no repo code change required |
| 9 | 5 design plugins | no | duplicate (see §13) |
| 10 | prompt-master | no | prompting |
| 11 | 5 essential Claude repos | no | roundup |
| 12 | 5 free reference plugins | no | references |
| 13 | 5 design plugins (same stack as #9) | no | duplicate |
| 14 | Harvard AI-tutor study | no | tutoring |
| 15 | ECC agent harness | no | harness |
| 16 | 5 Claude skills | no | skills |
| 17 | 9 learning prompts | no | study |
| 18 | skill security scanner | no | security |
| 19 | weekly AI news roundup | no | news |
| 20 | the "boss loop" technique | no | harness |
| 21 | candlestick forecasting model | no | finance |
| 22 | 9 free Claude Code repos | no | roundup |
| 23 | architecture diagrams | no | diagrams |
| 24 | small open model | no | models |
| 25 | 7 ADHD productivity prompts | no | productivity |
| 26 | Garry Tan's Claude Code setup | no | harness |
| 27 | "Skill of the week" | no | skills |
| 28 | Claude animation workflow | no | animation |
| 29 | weekly AI news roundup | no | news |
| 30 | llmfit — hardware/model fit | no | hardware |
| 31 | "stop using AI skills" | no | opinion |
| 32 | Top 6 Anti-AI Slop Skills | yes | checked against the shipped UI: `frontend/src/**/*.css` has no glassmorphism, no `Inter` font (the 12 `Inter` grep hits are `setInterval`), no Space Grotesk/Instrument Serif pair. Already satisfied, nothing to change |
| 33 | geo-sleuth | no | geolocation |
| 34 | the boring context fix | no | context |
| 35 | AWESOME-CLAUDE-SKILLS | no | skills |
| 36 | "7 Claudes reject your resume" | no | resume |
| 37 | "three things" for non-templated sites | partial | the design-skill half is harness-level and already in use; the Figma/Playwright MCP half is uninstalled here and the UI is served from `127.0.0.1`, so no browser-MCP loop was added |
| 38 | "The Process of Color Grading" | no | graphics |
| 39 | Aleph: download a piece of the world | no | geo |
| 40 | OneCanvas 3D scene understanding | no | 3D |
| 41 | Mint Playground / Mint MCP | no | 3D assets |
| 42 | Unreal MCP | no | unreal |
| 43 | 7 AI prompts for a slow computer | no | windows |
| 44 | Six AI Engineer skills, six projects | no | roundup |
| 45 | headless browser for agents | no | browser |
| 46 | Replica — clone any app with Claude Code | **yes** | this repo's mission is a clean-room Transpose 6.5.4 clone and `docs/REEL-ADOPTION-2026-10-27.md` adopted the method (row B); **unimplemented**: `docs/parity/` does not exist, so `features.csv` + `parity.py` are open — §46 |
| 47 | 3DCodeVerse | no | 3D |
| 48 | 20 reasons your app looks vibecoded | yes | ran the tell list against the tree (see §32): none present. No change |
| 49 | 20 vibecoded website giveaways | partial | `frontend/index.html` has `<html lang="en">` + `<title>Neiro</title>`; it has no meta description, og:image or sitemap — irrelevant for a local Tauri-served app, so recorded, not "fixed" |
| 50 | Geolocation Spy | no | geolocation |
| 51 | 3 AI portfolio defaults & Claude Design | no | portfolio |
| 52 | XERJ Rust search engine / MCP | no | search |
| 53 | rederive — re-design a codebase | partial | same method as §46 for the reverse direction (read Transpose's surface, rebuild clean-room); folded into the §46 parity item, not a second work item |
| 54 | 20 ways vibe coders get hacked | no | security |
| 55 | 6 documents before vibecoding | **yes** | applied: `docs/design/{TRD,APP-FLOW,DESIGN-BRIEF,SCHEMA,PLAN,PRD}.md` exist and each cites its reel doc number `DfDlUNVNui4` doc 1–6. **Open**: the fields are still template blanks (`DESIGN-BRIEF.md` carries the headings "Three adjectives, one anti-reference" and empty colour/typography tables) — §55 |
| 56 | AI Agents 101 — authority, guard.py hooks | no | harness |
| 57 | 5 GitHub repos | no | roundup |
| 58 | $200k vs wannabe AI engineer | no | career |
| 59 | Behance UX/UI extraction | no | design ref |
| 60 | GeoLibre GIS | no | gis |
| 61 | PolyLayout indoor layout | no | gis |
| 62 | Pentest Agent Suite | no | security |
| 63 | Gravity Japanese learning app | no | language |
| 64 | memorial video | no | non-tech |
| 65 | weekly AI roundup (Design/Flint/Beacon) | no | news |
| 66 | api-anything | no | api |
| 67 | predict a company's death | no | finance |
| 68 | StreetCraft Minecraft in real life | no | geo |
| 69 | Grokbot cloud computer | no | cloud |
| 70 | Duolingo churn folder | partial | **record corrected**: DIGESTS §70 claims "honest local-first spaced-repetition scheduling is used in … music-assistant practice streaks"; `grep -rni streak` over `src frontend/src scripts` = 0 hits. Practice progress lives in `frontend/src/practice/memory.ts` as plain per-session memory, not a scheduler. Nothing to un-adopt; the dark-pattern half stays banned |
| 71 | Carmine's C/C++ desktop replacements | no | desktop |
| 72 | ABot-Recon long-video 3D recon | no | 3D |
| 73 | Gamified JLPT kanji packs | no | language |
| 74 | short cinematic reel | no | non-tech |
| 75 | 3D Asset Server MCP | no | 3D assets |
| 76 | RAG-Anything | no | rag |
| 77 | Baidu Unlimited-OCR | no | ocr |
| 78 | 5 Claude Agent Archetypes | no | agents |
| 79 | are vibecoded apps making money | no | product |
| 80 | Turnitout plagiarism/watermark | no | text |
| 81 | shader-skills (186 GLSL functions) | partial | adopted at harness level (`frontend-superskill` §2.C) and named **for this repo's VR shaders**, but the repo has no shader source (0 hits for `glsl`/`fragmentShader`/`shaderMaterial`); the VR view is DOM/canvas. Nothing to wire until a WebGL pass exists |
| 82 | Biggest AI Updates carousel | no | news |
| 83 | SUPRA-Tex PBR textures | no | 3D |
| 84 | MiroFish swarm | no | simulation |
| 85 | indoor 3D scanning comparison | no | 3D |
| 86 | 11 day-trading skills | no | finance |
| 87 | TradingAgents | no | finance |
| 88 | Freefield on ComfyUI | no | media-gen |
| 89 | Karpathy's CLAUDE.md | no | harness |
| 90 | tradingagents desk | no | finance |
| 91 | img2threejs Three.js code | no | 3D |
| 92 | Harness² recursive | no | harness |
| 93 | Floorplan codebase map | no | tooling |
| 94 | DM-2026-11-05 export (corpus) | partial | it is the source of the one directive that applies here (DM #42 / PianoVision VR); the other 363 messages route elsewhere |
| 95 | agent-desktop computer use | no | harness |
| 96 | HAL-X-AI/THX-02 decision model | no | models |
| 97 | AnyScene 3D city block | no | 3D |
| 98 | prompt engineering — four-part shape | no | prompting |
| 99 | Atomic Agent local-first | no | agents |
| 100 | four output formats | no | writing |
| 101 | skill finder walkthrough | no | skills |

## What the sweep produces for this repo

Nothing new is implementable without a product decision, which is why no code was written here:

1. **§46 / §53 — the parity artefact.** Adopted 2026-10-27, still absent: `docs/parity/features.csv`
   plus `docs/parity/parity.py`, joined by one criterion in `scripts/verify_goal.py`. This is the only
   accepted-and-unimplemented item in the corpus for this project.
2. **§55 — the six design docs are unfilled templates.** They exist and carry the reel's doc numbers;
   the blanks are a product/wording decision (owner-only), not an agent edit.
3. **§70 — stale claim in the digest.** Recorded above rather than re-digested (corpus is read-only).

Rejected items were not re-opened: §88 was not trialled (its video/audio apps need more VRAM than
this machine has, and the disk has 6.2 GB free), §91/§97 need a 3D path the frontend does not have
(no `three` dependency), and the finance, geo, resume, security and agent-harness blocks belong to
other projects.
