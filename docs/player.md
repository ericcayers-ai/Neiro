# Player

Neiro has **one shared real-time player** for the app and the optional browser
companion. The Python engine remains the queued, rendered-quality path.

## Layout

| File | Role |
|---|---|
| `frontend/src/player/AudioEngine.ts` | one `AudioContext`, worklet lifecycle, decode/load, fallback |
| `frontend/src/player/Transport.ts` | pure state machine: play/pause/seek, A–B loop, wait gate, count-in |
| `frontend/src/player/params.ts` | parameter clamps, EQ/tuning presets, honest method labels |
| `frontend/src/player/markers.ts` | markers, clips, sequence resolution, practice-ramp generator |
| `frontend/src/player/scenes.ts` | named snapshots of params, loop, markers and clips |
| `frontend/src/player/midi.ts` | MIDI parse, learn, mapping resolution and persistence |
| `frontend/src/player/PlayerMidiPanel.tsx` | WebMIDI learn UI |
| `frontend/src/player/PlayerSurface.tsx` | transport + controls + markers/clips UI |
| `frontend/src/player/worklet/player-worklet.js` | clean-room DSP (plain ESM, Node-testable) |
| `frontend/src/player/i18n.ts` | single English string catalogue for new player strings |
| `frontend/src/player/tests/*.test.mjs` | DSP + transport + clips tests |

## DSP chain

```
source PCM -> phase-vocoder stretch (speed) -> linear resample (pitch)
            -> cepstral formant warp (optional) -> 6-band EQ
            -> centre reducer -> gain -> output
```

- **Phase vocoder** (`PhaseVocoder`): 1024-frame Hann, 256 synthesis hop, per-bin
  phase propagation. Pitch-exact; smears transients more than WSOLA, which is why
  the UI calls it a preview.
- **Pitch** = transpose semitones + fine cents, applied by resampling after the
  stretch; the stretch factor is `pitch/speed`, so duration depends only on speed.
- **Varispeed** links pitch and speed: no time stretch, only resampling (natural
  tape-style behaviour).
- **Formant** (`FormantWarp`): cepstral envelope warp; `1.0` bypasses the stage.
- **EQ**: six peaking biquads at 60/170/350/1k/3.5k/10k Hz, ±15 dB.
- **Vocal reducer**: centre subtraction with an amount control (preview only; the
  queued karaoke separation is the quality path).
- **Bypass** is bit-exact (null test) and skips all DSP.

Parameter changes are messaged to the worklet; nothing runs on the React render
path. One context per surface; no context-per-effect (the old metronome leak is
gone — the worklet owns click generation and the count-in).

## Transport behaviour

- **A–B loop** wraps at B with the overshoot preserved; the loop lives in samples,
  not in an `<audio loop>` attribute.
- **Count-in** generates metronome clicks for 4 beats (configurable) at the
  song/transcribed BPM, then starts at the requested position.
- **Metronome** is a worklet click (accent on beat 1), phase-locked to playback.
- **Wait mode** stops playback at each note/chord onset (deduplicated within 20 ms).
  Keyboard step resumes on Space/Enter; WebMIDI resumes only on the expected pitch;
  a matching DAW MIDI note from the VST injector also resumes via `resumeToken`.
- **Markers and clips** are data: add at playhead, jump, loop from marker, create a
  clip from A–B, per-clip loop count, sequence playback, practice-ramp generator
  (chromatic / circle of fifths / scale), and previous/next marker transport
  buttons. They persist per file in `localStorage` and can be stored durably in the
  library (`docs/library.md`).
- **Compact mode** collapses the practice panels (markers/clips/scenes) into a
  transport + controls bar; the choice persists per file.
- **Scenes** snapshot parameters, loop, markers and clips under a name; saving the
  same name replaces it, applying restores every field, and deletion is local.
- **MIDI learn** (`midi.ts` + `PlayerMidiPanel`): any connected input, note or CC,
  11 transport/parameter actions, clear per action, persisted locally. It is a
  mapping service, not a MIDI file player; no MIDI data leaves the browser.
- **Analysis overlay**: pass an `AnalysisReport` and the surface draws chord blocks
  and beat ticks under the transport, so practice and analysis share one timeline.
- **Keyboard shortcuts** (`shortcuts.ts` + `PlayerShortcutPanel`): nine player
  actions, exact modifier matching, conflict displacement with a message, reset to
  defaults, persisted locally. Home/End and wait-gate Space/Enter stay fixed.
- **Render with Neiro (Q):** queues one engine job that applies the current speed
  and pitch to the file (`/api/edit/job`, op `render`), polls it, and offers the
  rendered WAV with its provenance. This is the bridge between the preview and the
  rendered path; it never pretends the preview is the final quality.
- **Tuner preview** (`pitch.ts`): while playing, a 60 ms window of the decoded
  source is autocorrelated every 300 ms and shown as note + cents ("heard A4 +2¢").
  It is monophonic-biased and labelled a preview; silence/noise returns no reading.
- **Pitch readout**: the surface shows the sounding A4 in Hz (`440 × 2^(st/12)`),
  driven by the same transpose/cents values the DSP uses.
- **Low latency**: disables the formant stage and says so in the method label; it is
  a preview mode, not a premium-quality mode.

## Measured limits (this machine)

From `docs/evidence/player-latency-2026-10-20.md`:

- Algorithmic latency: **23.2 ms** (1024-frame phase vocoder at 44.1 kHz).
- Offline render factor in Node: **5.2×–13.5×** real time depending on stages.
- Browser control-to-audio latency is **not measured here** (no browser harness);
  the surface displays `baseLatency + outputLatency + algorithmic` at runtime.

## Always-open preference

Prefs → Interface → **Open the player after import** stores
`neiro.prefs.openPlayerAfterImport`. When a new file is imported while on the
Import module, the shell routes to Practice once; it never steals focus on
subsequent module switches or when disabled.

## Blind listening (ABX)

After a queued render completes, **Blind A/B test** opens a 10-trial ABX panel:
A is always the original, B the rendered output, and X is a hidden copy of one of
them (balanced, randomised). Each trial plays 4 s at the same offset; the listener
answers "X is A", "X is B" or "can't tell", then sees the reveal and a summary with
accuracy over decided trials (chance = 50%). This is a **discrimination** test, not
a preference score, and it does not replace the owner's ears. Trial logic lives in
`abx.ts` and is unit-tested.

## Studio per-stem transpose

Studio wires every stem through a per-track instance of the same clean-room
granular shifter used by the companion capture worklet (loaded once per
AudioContext from a blob URL; bypassed at 0). A **Transpose** control (-12…+12)
applies to all stems without touching the master clock. A **Speed** control
(0.5–2×) sets each element's `playbackRate` (browser pitch preservation disabled)
and the shifter corrects the resulting pitch shift, so tempo changes while pitch is
preserved; the master clock is scaled by the same factor and rebased on change.
This is **preview-grade**: formants follow the pitch, and per-stem formant/EQ plus
phase-vocoder quality are not implemented in Studio — use Render with Neiro for the
engine-quality path. A fractional ring-index bug that produced NaN/Inf in the
granular taps was fixed in both copies and is covered by tests.

## Studio per-stem EQ

Each stem has a 3-band EQ (low shelf 200 Hz, peaking 1 kHz, high shelf 6 kHz,
±12 dB) in the track head, applied live after the shifter and before gain/pan.
Values are saved in Studio scenes. This is preview EQ; the engine render path
remains the quality reference.

## Studio: bake preview settings

**Render stems** pauses the transport, then sends each track through the queued
engine `render` op with the current transpose/speed. Each finished artifact replaces
that track (original id kept for Reset) and the preview controls return to neutral.
This is the engine-quality counterpart to the granular preview; it writes new
artifacts and can take time proportional to the stems.

## Studio scenes

Studio can save up to 20 named layout scenes (tracks and mix gain/pan/mute/solo,
view window, A–B loop, preview transpose/speed) in localStorage and apply them to
the current timeline by track id. Unknown tracks are preserved; scenes never move
audio. Scenes store mix/view intent, not widget layouts.

## Studio integration

Studio's timeline keeps its multi-track transport (per-stem elements, gain/pan,
A–B, master clock). A **Real-time** action opens the selected (or first) track in
the shared `PlayerSurface` dialog and pauses the studio transport first, so the two
clocks never play at once. This gives real-time transpose/speed/formant/EQ on a stem
without pretending the per-stem engine has been unified; a full per-stem engine
remains the open architectural item.

## Honest labels

`describeMethod()` is the single source of UI wording. A phase-vocoder preview is
never called "Rubber Band" or simply "pitch-preserving"; a `playbackRate` fallback
says that pitch is not preserved. The engine path is labelled "Rendered (Neiro
engine)" and carries per-job provenance.

## Fallback

If `audioWorklet` cannot load, `AudioEngine` uses `AudioBufferSourceNode` and sets
`mode = 'fallback'`; the surface then shows the caveat. The app stays usable, but
the fallback is not parity.

## Tests

```powershell
node --test frontend/src/player/tests/*.test.mjs
node frontend/src/player/tests/bench.mjs
```

The tests cover FFT round-trip, bypass exactness, speed/pitch/varispeed direction,
EQ gain, reducer null, formant peak movement, NaN safety, render speed, transport
loop/wait/end, markers, clips/sequences, ramp generation, parameter clamps, method
labels and provenance formatting.
