# DAW VST bridge (shared-window injector)

Neiro's Learn mode is available in the desktop/browser UI (**Advanced** rail, or
automatically when a DAW injector connects). This page describes the installable
**Neiro DAW Bridge** VST2 plug-in that injects into any DAW while still using
**one** Neiro window for every function.

## Contract

- Insert `Neiro DAW Bridge` on as many tracks as you like.
- Opening the plug-in's editor does **not** embed a second UI.
- It calls `POST /api/daw/show-ui`, which focuses the single running Neiro window
  and switches it to **Learn** for that injector instance.
- Audio is passed through (true injector). Host MIDI note-ons are forwarded into
  Learn wait mode (`DAW VST injector MIDI`).

## Prerequisites

1. Neiro engine UI running locally (`neiro ui` or the Tauri desktop app) on
   `127.0.0.1:8377`.
2. Rust toolchain (1.85+ recommended for the plug-in crate).

## Build & install

```bash
chmod +x scripts/install_daw_plugin.sh
./scripts/install_daw_plugin.sh
```

This builds `plugins/neiro-vst` as a VST2 `cdylib` and copies it to a standard
user plug-in path:

| OS | Install location |
|---|---|
| Linux | `~/.vst/neiro_daw.so` |
| macOS | `~/Library/Audio/Plug-Ins/VST/Neiro DAW Bridge.vst` |
| Windows | `%COMMONPROGRAMFILES%/VST2/neiro_daw.dll` |

Rescan plug-ins in your DAW after installing.

## Engine API (local only)

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/daw/register` | Register an injector instance |
| POST | `/api/daw/unregister` | Drop an instance |
| POST | `/api/daw/heartbeat` | Keep-alive + peak meter |
| POST | `/api/daw/show-ui` | Focus the shared Neiro window → Learn |
| POST | `/api/daw/midi` | Push MIDI into Learn wait mode |
| GET | `/api/daw/status` | List instances + focus sequence |
| GET | `/api/daw/midi?after_seq=N` | UI polls new MIDI events |

Nothing is exposed beyond `127.0.0.1` (roadmap principle 2).

## Learn mode

- **Advanced** workspace: Learn is always on the rail (key `8`).
- **Simple** workspace: Learn appears automatically while any DAW injector is
  connected.
- Wait modes: Space/Enter, WebMIDI, or **DAW VST injector MIDI**.

## VST3 / CLAP

This release ships a VST2 injector (broad DAW coverage). A CLAP/VST3 variant can
reuse the same HTTP bridge; open a feature request if you need a specific format
bundle for your host.
