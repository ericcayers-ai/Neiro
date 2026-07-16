# DAW VST bridge (shared-window injector)

Neiro's Learn mode is available in the desktop/browser UI (**Advanced** rail, or
automatically when a DAW injector connects). This page describes the installable
**Neiro DAW Bridge** DAW plug-ins that inject into a host while still using
**one** Neiro window for every function.

## Contract

- Insert `Neiro DAW Bridge` on as many tracks as you like.
- Opening the plug-in's editor does **not** embed a second UI.
- It calls `POST /api/daw/show-ui`, which focuses the single running Neiro window
  and switches it to the requested module for that injector instance
  (Import, Analysis, Studio, Separate, Restore, Transcribe, Mixer, Learn, Prefs).
- Audio is passed through (true injector). Host MIDI note-ons are forwarded into
  Learn wait mode (`DAW VST injector MIDI`).
- Edison-style capture: arm Record in the plug-in to buffer the insert’s audio,
  release to upload a WAV via `/api/daw/capture`. The shared window loads the
  capture and focuses your Target Mode (e.g. Separate/Restore/Transcribe).

## Prerequisites

1. Neiro engine UI running locally (`neiro ui` or the Tauri desktop app) on
   `127.0.0.1:8377`.
2. Rust toolchain (1.85+ recommended for the plug-in crates).

## Build & install

```bash
chmod +x scripts/install_daw_plugin.sh
./scripts/install_daw_plugin.sh
```

This builds `plugins/neiro-vst` as the production VST2 `cdylib` and
`plugins/neiro-clap` as a lightweight CLAP/VST3 bridge-preview library, then
copies them to standard user plug-in paths:

| OS | Install location |
|---|---|
| Linux | `~/.vst/neiro_daw.so` |
| macOS | `~/Library/Audio/Plug-Ins/VST/Neiro DAW Bridge.vst` |
| Windows | `%COMMONPROGRAMFILES%/VST2/neiro_daw.dll` |

CLAP/VST3 preview paths:

| OS | CLAP preview | VST3 preview |
|---|---|---|
| Linux | `~/.clap/neiro_clap.clap` | `~/.vst3/Neiro DAW Bridge.vst3/Contents/x86_64-linux/Neiro DAW Bridge.so` |
| macOS | `~/Library/Audio/Plug-Ins/CLAP/Neiro DAW Bridge.clap` | `~/Library/Audio/Plug-Ins/VST3/Neiro DAW Bridge.vst3` |
| Windows | `%COMMONPROGRAMFILES%/CLAP/neiro_clap.clap` | `%COMMONPROGRAMFILES%/VST3/Neiro DAW Bridge.vst3` |

Rescan plug-ins in your DAW after installing.

## Engine API (local only)

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/daw/register` | Register an injector instance |
| POST | `/api/daw/unregister` | Drop an instance |
| POST | `/api/daw/heartbeat` | Keep-alive + peak / recording / preferred module |
| POST | `/api/daw/show-ui` | Focus the shared Neiro window (any module) |
| POST | `/api/daw/midi` | Push MIDI into Learn wait mode |
| POST | `/api/daw/capture` | Edison-style WAV body from VST -> file + focus |
| GET | `/api/daw/status` | List instances + focus sequence |
| GET | `/api/daw/midi?after_seq=N` | UI polls new MIDI events |

Nothing is exposed beyond `127.0.0.1` (roadmap principle 2).

## Learn mode

- **Advanced** workspace: Learn is always on the rail (key `8`).
- **Simple** workspace: Learn appears automatically while any DAW injector is
  connected.
- Wait modes: Space/Enter, WebMIDI, or **DAW VST injector MIDI**.

## VST3 / CLAP

`plugins/neiro-clap` is included as a CLAP/VST3-shaped bridge preview for the 1.1
MVP. It builds quickly without a heavy plug-in SDK and shares the same local HTTP
bridge helpers as the VST2 injector (`/api/daw/register`, `/api/daw/show-ui`,
`/api/daw/heartbeat`). The exported CLAP/VST3 entry points are placeholders, so
use the VST2 injector for production DAW injection until this crate is upgraded
to a full CLAP/VST3 SDK implementation.
