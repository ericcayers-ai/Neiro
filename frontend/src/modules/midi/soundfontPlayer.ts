import { Soundfont, type Soundfont as SoundfontInst } from 'smplr'

/**
 * GM piano audition.
 * Prefs downloads TimGM6mb.sf2 (MuseScore / disk). Browser WebAudio cannot parse SF2
 * natively, so after verifying the SF2 URL is reachable we load smplr FluidR3_GM
 * samples as the browser-side GM piano companion — same install gate, real SF2 on disk.
 */
export class MidiAudition {
  private ctx: AudioContext | null = null
  private inst: SoundfontInst | null = null
  private ready: Promise<void> | null = null
  private stops = new Map<number, () => void>()
  private sf2Urls: string[] = []
  /** Last ensure outcome for UI. */
  lastSource: 'sf2+fluidr3' | 'fluidr3-fallback' | 'failed' | null = null

  setSoundfontUrls(urls: string[]) {
    this.sf2Urls = urls.filter(Boolean)
  }

  async ensure(urls?: string[]): Promise<boolean> {
    if (urls?.length) this.sf2Urls = urls.filter(Boolean)
    if (this.inst) return true
    if (!this.ready) {
      this.ready = (async () => {
        let sf2Ok = false
        const primary = this.sf2Urls[0]
        if (primary) {
          try {
            const res = await fetch(primary, { method: 'HEAD', cache: 'no-store' })
            sf2Ok = res.ok
          } catch {
            sf2Ok = false
          }
        }
        this.ctx = new AudioContext()
        const sf = Soundfont(this.ctx, {
          instrument: 'acoustic_grand_piano',
          kit: 'FluidR3_GM',
        })
        await sf.load
        this.inst = sf
        this.lastSource = sf2Ok ? 'sf2+fluidr3' : 'fluidr3-fallback'
      })()
    }
    try {
      await this.ready
      return !!this.inst
    } catch {
      this.ready = null
      this.inst = null
      this.lastSource = 'failed'
      return false
    }
  }

  async resume() {
    if (this.ctx?.state === 'suspended') await this.ctx.resume()
  }

  noteOn(pitch: number, velocity = 100, duration?: number) {
    if (!this.inst) return
    void this.resume()
    this.noteOff(pitch)
    const stop = this.inst.start({
      note: pitch,
      velocity: Math.max(1, Math.min(127, velocity)),
      duration,
    })
    this.stops.set(pitch, stop)
  }

  noteOff(pitch: number) {
    const stop = this.stops.get(pitch)
    if (stop) {
      stop()
      this.stops.delete(pitch)
    }
  }

  /** Schedule a note at AudioContext time (for roll playback). */
  schedule(pitch: number, velocity: number, when: number, duration: number) {
    if (!this.inst || !this.ctx) return
    this.inst.start({
      note: pitch,
      velocity: Math.max(1, Math.min(127, velocity)),
      time: when,
      duration: Math.max(0.05, duration),
    })
  }

  get context(): AudioContext | null {
    return this.ctx
  }

  dispose() {
    for (const stop of this.stops.values()) stop()
    this.stops.clear()
    this.inst = null
    void this.ctx?.close()
    this.ctx = null
    this.ready = null
    this.lastSource = null
  }
}
