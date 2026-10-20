# Browser worklet verification — 2026-10-21

Chromium `156.0.8078.4` via Playwright, headless, real `OfflineAudioContext` and
`AudioWorklet` (not a Node stub). Command:

```powershell
cd frontend
npm run test:browser
```

## Results

Shifter (`neiro-stem-shift`) fed a 440 Hz sine with `processorOptions.semitones = 12`:

| Frequency | Goertzel magnitude |
|---|---:|
| 440 Hz | 0.000385 |
| 880 Hz | 0.006443 |

**880 Hz dominates by ~16.7×** — the worklet registers, loads and shifts in a real
browser.

Player (`neiro-player`) with an atomically loaded 440 Hz buffer:

| Case | 440 Hz | 880 Hz | Verdict |
|---|---:|---:|---|
| speed 2× | 0.004317 | 0.000196 | pitch preserved (440 dominates by ~22×) |
| +12 semitones | 0.000319 | 0.008352 | transposed (880 dominates by ~26×) |

This closes the gap between Node kernel tests and the actual AudioWorklet runtime:
registration, module loading, processor options and the phase-vocoder path were
exercised in Chromium. It is **not** a listening test: quality, formants and
latency under a real device remain owner-run.
