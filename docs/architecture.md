# Architecture

This document describes how the engine is put together. It complements
[`roadmap.md`](../roadmap.md) (the product vision) by explaining the code that
exists today.

## One sentence

Everything is a **typed artifact** flowing through a **DAG of nodes**, scheduled
by a runtime that **caches by content**, with models loaded through a
**VRAM-aware registry** so nothing is a hard dependency.

## Layers

Moved verbatim to `ARCHITECTURE-details.md` (§ `Layers`) on 2026-11-03 to keep this file under the 120-line cap.

## Data flow examples

**Separation** (`neiro separate x.wav --preset vocals`):

```
ingest → lane(44.1k) → separate(dsp-center) → {vocals, instrumental}
                    └→ residual (null test)
```

**Transcription with auto-split** (stereo, dense):

```
ingest → analyze
      └→ seplane → split(center) → lane(16k mono) → transcribe(yin) → compile → Timeline → MIDI
```

**Enhancement conditioning chain** (clipping + hum detected):

```
ingest → enhance(declip) → enhance(dehum) → restored audio
```

## Where the rest lives

`ARCHITECTURE-details.md` carries the sections moved out on 2026-11-03 to keep this file under
the 120-line document cap: The model-free floor, Desktop shell & frontend, Testing philosophy. The text was
moved verbatim, not rewritten.
