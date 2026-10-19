# Neiro work list

One live list. Each item carries priority, state, the receipt that closes it, and
what specifically remains. Owner-only work is labelled `OWNER`.

Legend: `[ ]` open · `[~]` in progress · `[x]` closed with a receipt · `[!]` blocked.

## Phase 0 — truth, regression safety, security

- [ ] **P0-1 Commit the pitch-correct fix + regression test.** State: fix present in
  the dirty worktree. Receipt: `tests/test_pitch_correct_report.py` + commit SHA.
  Remains: commit.
- [ ] **P0-2 Auto-enhance no-op contract.** Receipt: API test shows
  `result.noop == true` + `reason`, and the UI does not offer a download.
- [ ] **P0-3 Session notes scalar (5 000 cap).** Receipt: round-trip + over-cap test.
- [ ] **P0-4 `verify_models.py` uses `sys.executable -m neiro.cli`.** Receipt: parser
  test + a run that does not report 70/70 absent.
- [ ] **P0-5 `ruff format --check .` green** (two fenced doc examples). Receipt: exit 0.
- [ ] **P0-6 API security**: token, Origin allowlist, JSON content-type, body/upload
  caps, plugin/tool consent, SSRF policy, CORS allowlist. Receipt: security tests.
- [ ] **P0-7 Practice honesty**: real count-in, wait gating, A–B selection loop,
  provenance label. Receipt: player tests + UI change.
- [ ] **P0-8 Analysis honesty**: confidence/no-result, heuristic label, UI lanes.
  Receipt: analysis tests + Analysis UI.
- [ ] **P0-9 Docs truth pass** (README/session/security/ui + traceability banner).
  Receipt: doc checks.

## Phase 1 — shared real-time player

- [ ] **P1-1 Player SDK skeleton**: `frontend/src/player/{AudioEngine,Transport,params,provenance}.ts`.
- [ ] **P1-2 AudioWorklet DSP**: clean-room WSOLA stretcher, resample pitch shift,
  formant preservation, 6-band EQ, vocal reducer, per-stage bypass.
- [ ] **P1-3 Transport**: sample clock, play/pause/seek, A–B loop, count-in, markers.
- [ ] **P1-4 PlayerSurface UI** with transpose/pitch/speed/formant/EQ/reducer controls,
  method label, latency readout.
- [ ] **P1-5 Migrate MIDI Practice** off `<audio>`/whole-file stretch; wait state machine.
- [ ] **P1-6 Migrate Studio transport** to the shared clock; keep Mix gain/pan/A–B.
- [ ] **P1-7 Tests + latency receipt** (`docs/evidence/player-latency-2026-10-20.md`).

## Phase 2 — practice and library

- [ ] **P2-1 SQLite library** at Neiro home (`library.db`) with migrations.
- [ ] **P2-2 API**: `/api/library/songs`, notes, markers, clips, scenes, playlists.
- [ ] **P2-3 Library UI**: recent/saved, notes pane, markers, clips, scenes.
- [ ] **P2-4 Clip sequence + practice ramp generator.**
- [ ] **P2-5 MIDI learn + keyboard mapping persistence.**
- [ ] **P2-6 Byte-bounded cache + disk preflight + quota errors.**

## Phase 3 — real analysis

- [ ] **P3-1 Chord timeline heuristic**: beat-synchronous chroma + templates,
  confidence, no-result.
- [ ] **P3-2 Beat/downbeat**: tracker-lite with meter/phase confidence; fixed-grid
  fallback labelled.
- [ ] **P3-3 Optional ONNX adapter manifest** (ChordMini/BTC, Beat This-class) that
  reports `needs-install` honestly without weights.
- [ ] **P3-4 Analysis UI**: chord lane, beat grid, key/meter, no-result state.

## Phase 4 — optional companion

- [ ] **P4-1 MV3 addon skeleton** (`addon/`): manifest, service worker, side panel,
  offscreen document, permissions per site.
- [ ] **P4-2 Site adapter interface** + YouTube/Spotify/SoundCloud/Deezer/Apple
  Music/Tidal/Vimeo adapters + generic media fallback.
- [ ] **P4-3 Tab capture** through the shared worklet, mute/restore, stop/revoke.
- [ ] **P4-4 Pairing** one-time code → per-install token; Q features gated on pairing.
- [ ] **P4-5 Static validator + build script**; live e2e `OWNER`.

## Phase 5 — i18n, a11y, packaging

- [ ] **P5-1 String catalogue + `t()`** for new surfaces; `en` only; no copied locales.
- [ ] **P5-2 Accessibility pass**: labels, focus, keyboard matrix, reduced motion.
- [ ] **P5-3 Dynamic port + sidecar packaging plan** (bundled externalBin, signing,
  updater); code changes that are safe locally.
- [ ] **P5-4 Model manager status**: size, licence, needs-install, disk impact.

## Phase 6 — release evidence

- [ ] **P6-1 Parity matrix statuses updated from measured evidence.**
- [ ] **P6-2 Audit + handoff refreshed; every claim labelled.**
- [ ] **P6-3 Owner decisions recorded** (scope, DSP licence, addon, packaging, commit).
