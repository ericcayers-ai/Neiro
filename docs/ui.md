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

A left-hand rail switches between modules (numeric shortcuts `1`–`9`, ignored
while a text input is focused); a session bar across the top always shows the
loaded file, live job status with a working cancel button, and an "engine
unreachable" indicator if the local API stops responding.

| # | Module | What it does |
|---|--------|---------------|
| 1 | **Import** | Open a file or paste a URL (needs `neiro[youtube]`) to fetch and load. |
| 2 | **Analysis** | Read-only report: duration, loudness, tempo, key, clipping, bandwidth, detected conditions — the same JSON `neiro analyze` prints. |
| 3 | **Studio** | Waveform + spectrogram editor: selection, trim/delete/silence/fade/gain/normalize/reverse, undo/redo, keyboard shortcuts, WAV/FLAC export. |
| 4 | **Separate** | Presets (vocals, vocals-ensemble, karaoke, harmonic, 4-stem, 6-stem, drums, …) with intent copy and honest per-stage progress. |
| 5 | **Restore** | Auto (conditioning-chain) or explicit enhancement chains (declip, dehum, denoise, dereverb, superres, master). |
| 6 | **Transcribe** | Audio → MIDI, with a piano-roll-style event view of the result. |
| 7 | **Mixer** | Per-stem mute/solo/gain preview, A/B against the source, null-test audition, "Open in Studio" for any stem. |
| 8 | **Learn** *(Advanced mode only)* | Practice controls over a transcription result: pitch-preserving speed, loop section, count-in, metronome, step or WebMIDI wait mode. |
| 9 | **Preferences** | Theme/density/font-scale/motion, cache budget and warm-pool TTL fields, and a privacy statement. |
| — | **About** | Version, licensing note, and (desktop only) the engine supervisor's live status. |

**Simple vs. Advanced** is a rail-level toggle, not two different engines
(roadmap principle 3): Advanced currently unlocks the Learn module and is the
place later phases will add the pipeline/condition editors (roadmap §9.3);
Simple and Advanced drive identical Separate/Restore/Transcribe requests today.

## Design language (roadmap §9.1)

- **Dark-first, ink-on-slate, one accent.** Three background elevations
  (`--bg0`/`--bg1`/`--bg2`/`--bg3`), a single restrained accent hue for
  interactive/active states, full light and high-contrast themes as first-class
  alternates (`frontend/src/styles/tokens.css`), selected in Preferences and
  persisted per-browser-profile.
- **Stem colors.** A fixed Okabe–Ito-derived categorical palette
  (`--stem-vocals`, `--stem-drums`, `--stem-bass`, …) assigned consistently
  wherever stems appear; color is never the only signal — every colored element
  also has a text label.
- **Type.** IBM Plex Sans + IBM Plex Mono (tabular figures for values/timecodes),
  with an independent font-scale preference (90–200%) separate from OS zoom.
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

## 1.0 workspace notes

Sheet-music export is available as MusicXML (plus SVG/PDF when Verovio or
MuseScore is present). Advanced mode reveals quality-tier / condition controls
across modules; Learn mode supports Space/Enter stepping and WebMIDI pitch
wait. See [`roadmap.md`](../roadmap.md) and
[`docs/roadmap-traceability.md`](roadmap-traceability.md) for the authoritative
1.0 ledger.
