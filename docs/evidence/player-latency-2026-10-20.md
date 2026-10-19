# Player latency and DSP receipt — 2026-10-20

Machine: Windows, CPU-only, Node v24.19.0, 44.1 kHz target.
Method: `node frontend/src/player/tests/bench.mjs` (worklet kernels in Node, no
browser audio device), plus the DSP unit tests.

## Measured

| Case | Render factor (audio s per wall s) | Algorithmic latency |
|---|---:|---:|
| speed 0.75 + transpose +4 | 9.09× | 23.2 ms |
| speed 1, neutral | 13.47× | 23.2 ms |
| formant 0.8 + 6-band EQ | 5.23× | 23.2 ms |

Worst measured render factor: **5.23×** real time (formant stage enabled).

Command output:

```
{"label":"speed 0.75 + transpose +4","rtF":9.09,"algorithmicLatencyMs":23.2,"msPerSecond":2200}
{"label":"speed 1 + transpose 0","rtF":13.47,"algorithmicLatencyMs":23.2,"msPerSecond":1484}
{"label":"formant 0.8 + eq","rtF":5.23,"algorithmicLatencyMs":23.2,"msPerSecond":3825}
{"worstRtF":5.23,"machine":"win32","node":"v24.19.0"}
```

Algorithmic latency = one 1024-sample phase-vocoder frame at 44.1 kHz
(23.2 ms). The browser adds `baseLatency + outputLatency`; the player surface shows
the sum at runtime.

## What the tests prove

`node --test frontend/src/player/tests/*.test.mjs` — 23 tests:

- FFT round-trip accuracy;
- bypass is sample-exact (null test);
- speed 0.5 doubles duration while pitch stays 440 Hz; +12 semitones doubles pitch
  while duration is preserved; varispeed links the two;
- EQ boost raises the matching band; vocal reducer cancels a centred signal;
- formant warp moves a spectral peak in the expected direction;
- no NaN/Inf at extreme parameters;
- transport play/pause/end, A–B wrap with overshoot, wait gate stop/resume/seek,
  count-in timing, markers, clips/sequence, ramp generator, clamps/labels.

## Not measured / not claimed

- **Browser control-to-audio latency is not measured.** There is no Playwright or
  device harness in this environment. The `<30 ms` target in the audit is a design
  target, not a verified browser number.
- No listening panel or ABX test; quality is labelled "preview" in the UI.
- Tab-capture latency for the companion is unmeasured (owner-run live check).
- Transient smearing from the phase vocoder is a known preview limitation, not a
  surprise.
