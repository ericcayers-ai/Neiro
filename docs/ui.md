# UI

Neiro has one interface, presented two ways: a Tauri desktop window and a plain
browser tab, both loading the same built frontend from the same local engine (see
[`docs/architecture.md`](architecture.md#desktop-shell--frontend)). This page
covers the module rail, the design language, and what's implemented versus
roadmap-deferred (roadmap §9).

## Launching it

```bash
neiro ui                 # local engine + open a browser tab
neiro ui --no-browser    # local engine only (useful with the Vite dev server, or the desktop shell)
npm run tauri:dev        # desktop shell, from the repo root (spawns the engine itself)
```

## Module rail

A left-hand rail switches between modules (numeric shortcuts `1`–`6` / `8`–`9`,
ignored while a text input is focused; `7` opens Studio Mix — the former Mixer).
The rail shows keyboard digits, collapses with **Ctrl/⌘B**, and exposes a
**command palette** (**Ctrl/⌘K**) for jump-to-module and common actions. On
narrow viewports the rail becomes a horizontal scroll strip.

A session bar across the top always shows the loaded file (or a one-click Import
CTA when empty), live job status with cancel, DAW injector status when connected,
a **Session** menu (Save / Open dialogs — no `prompt()`), and an "engine down"
indicator if the local API stops responding. A bottom-right **job tray** lists
running and recent jobs with progress, cancel, jump-to-module, and collapse —
jobs keep polling when you switch modules. Empty modules use a shared gate with
a clear path back to Import.

| # | Module | What it does |
|---|--------|---------------|
| 1 | **Import** | Open a file or paste a URL (needs `neiro[youtube]`) to fetch and load. Shows upload → decode → analyze progress. |
| 2 | **Analysis** | Report: duration, loudness, tempo, key, clipping, bandwidth, detected conditions — the same JSON `neiro analyze` prints. Corrections (key/BPM/instruments) are always available. |
| 3 | **Studio** | Multi-track timeline: Select / Scrub / Split tools, trim/cut/silence/fade/gain/normalize/reverse, bounce/combine, reorder/mute/solo/gain/pan, Mix drawer (A/B, null-test, export), mashup packs, pitch-correct job, spectrogram lane. Shortcuts in About (`?` in Studio). |
| 4 | **Separate** | Grouped presets (vocals+inst, 4-stem, 6-stem, individual, specialty incl. duet-vocals / drums-deep-dive) with quality tier, bleed control, and honest per-stage progress. **Send stems to Studio** or **Add as mashup pack**. |
| 5 | **Restore** | Layman presets (Clean recording / Old & noisy / Fix clipping / More air / Match reference / Auto) plus explicit chains; detector recommends a chain with plain “why”. |
| 6 | **MIDI Studio** | Unified Transcribe / Roll / Roll+score / Edit / Practice. Quality presets (Draft → Ensemble), YourMT3+ / Kong piano / Transkun / SVT / TimbreAMT / Noise-to-Notes / drums / ensemble with skipped-member Prefs links, MIDI·MusicXML·PDF·provenance exports, Open in Edit / Practice. Shortcut `8` jumps to Practice. |
| 9 | **Preferences** | Theme/density/font-scale/motion; Models table + packs (Separation / Piano / Restore / Transcription); Tools (Install Verovio, MuseScore path/link, Soundfont download); cache budget and warm-pool TTL; flush warm pool. |
| — | **About** | Version, update check, privacy notes, **Windows-first** Studio shortcuts, watch-folder / DAWproject honesty. |

There is no Simple/Advanced workspace toggle. Planner overrides (quality tier,
bleed, analysis corrections) stay visible under clear section labels. Mixer is
folded into Studio Mix (`7`). Former Transcribe + Learn modules redirect into
MIDI Studio.

## Studio mashup packs

After Separate, stems can replace the Studio timeline or append as a **mashup pack**
(`StemPack`: name, source file, BPM, key, track ids). Packs support:

- Color + icon + label badges from stem identity (same vocabulary in Mix)
- Drag clips horizontally with optional **beat snap** from session BPM
- BPM-ratio time-align (Rubber Band stretch when installed) and key-conflict
  **transpose** suggestions between packs
- Bounce selected tracks or an entire pack; session Save/Open persists packs **and**
  Studio clip/track timeline (rehydrates even if Studio is already open)
- Import multi-select + Separate **queue → packs** drains intents into Studio in order

Live transport shows windowed BPM / pack key for sync. Loop with a selection wraps
selection only; Stop leaves the playhead where it is.

## MIDI Studio

One module (`midi`, shortcut **6**) replaces Transcribe + Learn. Modes:

| Mode | Role |
|------|------|
| Transcribe | Model picker + NeuralNote-inspired quality presets; exports; Open in Edit / Practice |
| Roll | Vertical piano + time (Embers-like velocity/glow options); soundfont audition |
| Roll + score | Playhead-linked SVG score scroll when Verovio is installed |
| Edit | Draw/select/erase notes; velocity; quantize; undo |
| Practice | Pitch-preserving speed (Rubber Band when available), metronome phase-locked to BPM, wait modes incl. DAW injector |

Shortcut **8** focuses Practice. PDF export needs MuseScore (or Verovio path); Prefs → Tools
installs Verovio and downloads a GM soundfont when missing.

## Preferences installs

- **Models:** filterable table with status, size hint, Download / Cancel; one-click
  packs for Separation, Piano, Restore, Transcription. MIDI Studio deep-links here
  when an ensemble member is skipped.
- **Tools:** Install Verovio (`pip`); MuseScore detect PATH + browse + download link;
  Soundfont download for MIDI Studio audition.

## Chrome, jobs, and shortcuts (Windows-first)

Rail, job tray, plan DAG, stage logs, and practice/plan panels each collapse to a
**hide/show chevron** (persisted). Job tray: only the log pane scrolls; progress polls
~400ms while a job runs. Engine subprocesses on Windows use `CREATE_NO_WINDOW` so
ffmpeg / MuseScore / adapters do not flash empty consoles.

Shortcuts list **Ctrl** as primary and **⌘** as secondary (macOS). Shell:
**Ctrl+K** command palette, **Ctrl+B** rail. Studio: Space play/pause, **L** loop,
**Ctrl+Z** / **Ctrl+Y** undo/redo, **?** shortcut sheet, **=** / **-** zoom. Full list
in About → Studio shortcuts.

## Design language (roadmap §9.1)

- **Dark-first, ink-on-slate, one accent.** Three background elevations
  (`--bg0`/`--bg1`/`--bg2`/`--bg3`), a single restrained accent hue for
  interactive/active states, full light and high-contrast themes as first-class
  alternates (`frontend/src/styles/tokens.css`), selected in Preferences and
  persisted per-browser-profile. Light theme keeps stronger text/muted contrast
  for labels and rail copy.
- **Stem colors.** A fixed Okabe–Ito-derived categorical palette
  (`--stem-vocals`, `--stem-drums`, `--stem-bass`, …) assigned consistently
  wherever stems appear; color is never the only signal — every colored element
  also has a text label.
- **Type.** IBM Plex Sans + IBM Plex Mono (tabular figures for values/timecodes),
  with an independent font-scale preference (90–200%) separate from OS zoom.
  Shell and module CSS use `rem` so the scale actually resizes UI chrome.
- **Motion.** Short, purposeful transitions; `prefers-reduced-motion` is honored
  automatically and can be forced on in Preferences regardless of OS setting.
- **Language rules.** Progress and errors are plain operational language —
  "Working — vocals, chunk 14 of 52", "Couldn't load SCNet-XL: needs 9.4 GB VRAM,
  7.9 GB free" — never marketing voice. Session-bar job status and the
  engine-unreachable indicator are ARIA live regions so this reaches screen
  readers, not just sighted users.
- **Accessibility baseline.** A skip-link to main content, full rail keyboard
  navigation, `aria-current` on the active module, and labeled form controls
  throughout (`IntentField` pairs every control with a plain-language reason).
  This is a baseline, not the full roadmap §9.7 audit — see
  [`docs/evaluation.md`](evaluation.md) and the
  [accessibility issue template](../.github/ISSUE_TEMPLATE/accessibility.yml) for
  what's tracked versus outstanding.

## Analysis corrections → planners

Applying corrections in Analysis persists an overlay in the session and sends it
with Separate / Transcribe / Restore job bodies as `corrections`. Planners use
the effective report for detect-all instrument order, auto restore hints,
conditioning chains, and compile-time tempo/key — the raw measurement is never
mutated.

## Job progress

DAG execution reports structured `{stage, fraction, eta_s, line}` events. The
graph maps each node's local fraction into an overall 0–1 span so the job tray
and session bar show determinate progress across multi-node plans.

## 1.0 workspace notes

Sheet-music export is available from MIDI Studio as MusicXML (plus SVG via Verovio
and PDF via MuseScore when present; otherwise MusicXML + a labeled placeholder SVG
and an honest “No PDF” line with Prefs → Tools). Provenance sidecars ship next to
MIDI. Quality presets and analysis corrections are always available where relevant.
Mixer is folded into Studio Mix; Practice lives inside MIDI Studio (shortcut `8`
and DAW injector focus).
DAW VST injectors share one window — see [daw-vst.md](daw-vst.md).

**Honest follow-ups (not faked in the UI):** full Verovio engraving polish,
signed remote model index refresh, custom Python plugin sandbox, full MUSDB
score tables on CI hardware, and an in-app watch-folder daemon panel (CLI
`neiro watch` remains the supported path).

See [`roadmap.md`](../roadmap.md) and
[`docs/roadmap-traceability.md`](roadmap-traceability.md) for the authoritative
1.0 ledger.
