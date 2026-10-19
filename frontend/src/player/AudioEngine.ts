/**
 * One AudioContext, one worklet, one clock.
 *
 * The engine is the browser half of the shared player; the worklet does the DSP.
 * If the worklet cannot load, the engine falls back to `<audio>`-class playback
 * via AudioBufferSourceNode and *says so* (`mode = 'fallback'`), because a
 * playbackRate fallback does not preserve pitch.
 */

import workletUrl from './worklet/player-worklet.js?url'
import type { PlayerParams } from './params'
import { pitchAt, type PitchReading } from './pitch'

export type EngineMode = 'preview' | 'fallback'

export interface PlayerStatus {
  position: number
  playing: boolean
  latencySeconds: number
}

export interface PlayOptions {
  from?: number
  countInBeats?: number
  bpm?: number
}

export interface LoopPoints {
  enabled: boolean
  start: number
  end: number
}

export class PlayerEngine {
  private ctx: AudioContext | null = null
  private node: AudioWorkletNode | null = null
  private buffer: AudioBuffer | null = null
  private fallbackSource: AudioBufferSourceNode | null = null
  private fallbackStartedAt = 0
  private fallbackOffset = 0
  private fallbackLoop: LoopPoints = { enabled: false, start: 0, end: 0 }
  private params: PlayerParams | null = null
  private workletLatency = 0
  mode: EngineMode = 'preview'
  duration = 0

  onStatus: ((status: PlayerStatus) => void) | null = null
  onWait: ((position: number) => void) | null = null
  onEnded: (() => void) | null = null
  onError: ((message: string) => void) | null = null

  get context(): AudioContext | null {
    return this.ctx
  }

  /** Load and decode a URL, then hand the PCM to the worklet. */
  async load(url: string): Promise<number> {
    this.destroy()
    const ctx = new AudioContext({ latencyHint: 'interactive' })
    this.ctx = ctx
    await ctx.resume().catch(() => undefined)
    const response = await fetch(url)
    if (!response.ok) throw new Error(`audio fetch failed (${response.status})`)
    const bytes = await response.arrayBuffer()
    const buffer = await ctx.decodeAudioData(bytes.slice(0))
    this.buffer = buffer
    this.duration = buffer.duration
    try {
      await ctx.audioWorklet.addModule(workletUrl)
      const node = new AudioWorkletNode(ctx, 'neiro-player', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      })
      node.port.onmessage = (event) => this._onMessage(event.data)
      node.connect(ctx.destination)
      this.node = node
      this.mode = 'preview'
      const left = buffer.getChannelData(0).slice()
      const right =
        buffer.numberOfChannels > 1 ? buffer.getChannelData(1).slice() : buffer.getChannelData(0).slice()
      node.port.postMessage(
        { type: 'load', channels: [left, right], sampleRate: ctx.sampleRate },
        [left.buffer, right.buffer],
      )
      if (this.params) this.setParams(this.params)
    } catch (error) {
      this.mode = 'fallback'
      this.onError?.(error instanceof Error ? error.message : String(error))
    }
    return this.duration
  }

  setParams(params: PlayerParams): void {
    this.params = params
    if (this.node) {
      this.node.port.postMessage({ type: 'params', params })
    }
    if (this.fallbackSource && this.mode === 'fallback') {
      this.fallbackSource.playbackRate.value = params.speed
    }
  }

  play(options: PlayOptions = {}): void {
    const ctx = this.ctx
    if (!ctx) return
    void ctx.resume()
    if (this.mode === 'preview' && this.node) {
      this.node.port.postMessage({
        type: 'play',
        from: options.from,
        countInBeats: options.countInBeats ?? 0,
        bpm: options.bpm ?? 100,
      })
      return
    }
    this._stopFallback()
    if (!this.buffer) return
    const source = ctx.createBufferSource()
    source.buffer = this.buffer
    source.playbackRate.value = this.params?.speed ?? 1
    source.loop = this.fallbackLoop.enabled
    source.loopStart = this.fallbackLoop.start
    source.loopEnd = this.fallbackLoop.end
    source.connect(ctx.destination)
    const offset = options.from ?? this.fallbackOffset
    source.start(0, Math.max(0, Math.min(offset, this.duration - 0.01)))
    source.onended = () => {
      if (this.fallbackSource === source) this.onEnded?.()
    }
    this.fallbackSource = source
    this.fallbackStartedAt = ctx.currentTime
    this.fallbackOffset = offset
  }

  pause(): void {
    if (this.mode === 'preview' && this.node) {
      this.node.port.postMessage({ type: 'pause' })
      return
    }
    if (this.fallbackSource && this.ctx) {
      this.fallbackOffset = this.position
      this._stopFallback()
      this.onStatus?.({ position: this.position, playing: false, latencySeconds: this.latency })
    }
  }

  seek(seconds: number): void {
    const target = Math.max(0, Math.min(seconds, this.duration))
    if (this.mode === 'preview' && this.node) {
      this.node.port.postMessage({ type: 'seek', to: target })
      return
    }
    const wasPlaying = Boolean(this.fallbackSource)
    this._stopFallback()
    this.fallbackOffset = target
    if (wasPlaying) this.play({ from: target })
    else this.onStatus?.({ position: target, playing: false, latencySeconds: this.latency })
  }

  setLoop(range: LoopPoints): void {
    this.fallbackLoop = range
    if (this.node) this.node.port.postMessage({ type: 'loop', range })
    if (this.fallbackSource) {
      this.fallbackSource.loop = range.enabled
      this.fallbackSource.loopStart = range.start
      this.fallbackSource.loopEnd = range.end
    }
  }

  setWaitPoints(points: number[]): void {
    if (this.node) this.node.port.postMessage({ type: 'waitPoints', points })
  }

  resume(): void {
    if (this.node) {
      this.node.port.postMessage({ type: 'resume' })
      return
    }
    if (this.ctx) void this.ctx.resume()
  }

  get latency(): number {
    const ctx = this.ctx
    if (!ctx) return this.workletLatency
    const base = ctx.baseLatency || 0
    const output = (ctx as AudioContext & { outputLatency?: number }).outputLatency || 0
    return base + output + (this.mode === 'preview' ? this.workletLatency : 0)
  }

  /** Preview tuner: fundamental near a source-time position, or null. */
  pitchAt(seconds: number, windowSeconds = 0.06): PitchReading | null {
    if (!this.buffer || this.mode !== 'preview') return null
    const channels = [
      this.buffer.getChannelData(0),
      this.buffer.numberOfChannels > 1 ? this.buffer.getChannelData(1) : this.buffer.getChannelData(0),
    ]
    return pitchAt(channels, this.buffer.sampleRate, Math.floor(seconds * this.buffer.sampleRate), windowSeconds)
  }

  get position(): number {
    if (this.ctx && this.fallbackSource) {
      return this.fallbackOffset + (this.ctx.currentTime - this.fallbackStartedAt)
    }
    return this.fallbackOffset
  }

  private _stopFallback(): void {
    if (this.fallbackSource) {
      try {
        this.fallbackSource.onended = null
        this.fallbackSource.stop()
      } catch {
        // already stopped
      }
      this.fallbackSource.disconnect()
      this.fallbackSource = null
    }
  }

  private _onMessage(message: { type?: string; [key: string]: unknown }): void {
    if (!message || typeof message !== 'object') return
    if (message.type === 'status' || message.type === 'ended') {
      const position = Number(message.position ?? 0)
      const playing = Boolean(message.playing)
      if (message.type === 'ended') this.onEnded?.()
      this.onStatus?.({ position, playing, latencySeconds: this.latency })
      return
    }
    if (message.type === 'wait') {
      this.onWait?.(Number(message.position ?? 0))
      this.onStatus?.({ position: Number(message.position ?? 0), playing: false, latencySeconds: this.latency })
      return
    }
    if (message.type === 'latency') {
      this.workletLatency = Number(message.seconds ?? 0)
      return
    }
    if (message.type === 'loaded') {
      this.workletLatency = Number(message.latencySeconds ?? 0)
    }
  }

  destroy(): void {
    this._stopFallback()
    if (this.node) {
      this.node.disconnect()
      this.node.port.onmessage = null
      this.node = null
    }
    if (this.ctx) {
      void this.ctx.close().catch(() => undefined)
      this.ctx = null
    }
    this.buffer = null
    this.workletLatency = 0
  }
}
