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
ignored while a text input is focused; `7` opens Studio Mix — the former Mixer);
a session bar across the top always shows the loaded file, live job status with
a working cancel button, DAW injector status when connected, Save/Open session,
and an "engine unreachable" indicator if the local API stops responding. A
bottom-right **job tray** lists running and recent jobs with progress, cancel,
and jump-to-module — jobs keep polling when you switch modules.

| # | Module | What it does |
|---|--------|---------------|
| 1 | **Import** | Open a file or paste a URL (needs `neiro[youtube]`) to fetch and load. Shows upload → decode → analyze progress. |
| 2 | **Analysis** | Report: duration, loudness, tempo, key, clipping, bandwidth, detected conditions — the same JSON `neiro analyze` prints. Corrections (key/BPM/instruments) are always available. |
| 3 | **Studio** | Multi-track timeline: Select / Scrub / Split tools, trim/cut/silence/fade/gain/normalize/reverse, bounce/combine, reorder/mute/solo/gain/pan, Mix drawer (A/B, null-test, export). Shortcuts listed in About. |
| 4 | **Separate** | Presets (vocals, vocals-ensemble, karaoke, harmonic, 4-stem, 6-stem, drums, …) with quality tier, bleed control, and honest per-stage progress. Results open in Studio Mix. |
| 5 | **Restore** | Auto (conditioning-chain) or explicit enhancement chains (declip, dehum, denoise, dereverb, superres, master). |
| 6 | **Transcribe** | Audio → MIDI with piano-roll transport, optional bloom FX, multi-decoder ensemble / hybrid vote, MusicXML + provenance, note edit API, and an embedded **Practice** panel. |
| 8 | **Learn** | Full practice mode with count-in, metronome, step / WebMIDI / **DAW VST injector** wait mode. Multiple DAW inserts share one window. |
| 9 | **Preferences** | Theme/density/font-scale/motion; cache budget and warm-pool TTL synced to `/api/prefs`; resident-model list; flush warm pool (+ optional cache clear). Also `/api/compute` flush. |
| — | **About** | Version, update check, privacy notes, Studio shortcuts, watch-folder / DAWproject honesty. |

There is no Simple/Advanced workspace toggle. Planner overrides (quality tier,
bleed, analysis corrections) stay visible under clear section labels. Mixer is
folded into Studio Mix (`7`).

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

Sheet-music export is available from Transcribe as MusicXML (plus SVG/PDF when
Verovio or MuseScore is present; otherwise MusicXML + a labeled placeholder SVG).
Provenance sidecars ship next to MIDI. Quality-tier, bleed, and analysis
corrections are always available where relevant (no Simple/Advanced toggle).
Mixer is folded into Studio Mix; Learn remains a full practice surface reachable
via shortcut `8` and DAW injector focus, while Transcribe also embeds Practice.
DAW VST injectors share one window — see [daw-vst.md](daw-vst.md).

**Honest follow-ups (not faked in the UI):** full Verovio engraving polish,
signed remote model index refresh, custom Python plugin sandbox, full MUSDB
score tables on CI hardware, and an in-app watch-folder daemon panel (CLI
`neiro watch` remains the supported path).

See [`roadmap.md`](../roadmap.md) and
[`docs/roadmap-traceability.md`](roadmap-traceability.md) for the authoritative
1.0 ledger.
