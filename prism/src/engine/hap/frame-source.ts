/// <reference lib="webworker" />

import { createFile, DataStream, type MP4File, type MP4Info, type MP4Track } from 'mp4box'

/**
 * Frame reader for the HAP encoder.
 *
 * HAP needs every frame as raw pixels, which rules out both of the obvious
 * approaches: ffmpeg.wasm would have to write gigabytes of intermediate
 * rawvideo, and a `<video>` element only produces frames as fast as it plays
 * them and silently drops what it cannot keep up with.
 *
 * WebCodecs `VideoDecoder` fed by an mp4box demux does neither. It is frame
 * exact, it runs in a worker, and it uses the platform's hardware decoder. The
 * limitation is the container: mp4box reads MP4 and MOV, and the codec has to
 * be one the browser decodes — ProRes, notably, is not. Everything else goes
 * through the transcode fallback in the worker.
 */

export class UnsupportedSource extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnsupportedSource'
  }
}

export interface SourceInfo {
  width: number
  height: number
  /** Frames per second, derived from the sample count and the duration. */
  fps: number
  durationSec: number
  frameCount: number
  codec: string
}

/** Decoder queue depth. Deeper hides decode latency; too deep hoards frames. */
const DECODE_BACKPRESSURE = 6

/** Samples mp4box collects before handing over a batch. */
const SAMPLE_BATCH = 512

interface Demuxed {
  mp4: MP4File
  track: MP4Track
  description: Uint8Array
}

/**
 * Read the file into mp4box.
 *
 * Appended in slices rather than as one buffer: mp4box wants ArrayBuffers
 * carrying a `fileStart`, and slicing keeps the extra copy down to one slice
 * instead of a second image of a multi-gigabyte source.
 */
async function demux(file: File): Promise<Demuxed> {
  const mp4 = createFile()

  let info: MP4Info | null = null
  let parseError: string | null = null
  // mp4box resolves both of these synchronously from inside appendBuffer.
  mp4.onReady = (parsed) => {
    info = parsed
  }
  mp4.onError = (message) => {
    parseError = message
  }

  const CHUNK = 16 * 1024 * 1024
  let offset = 0
  try {
    while (offset < file.size && !info && !parseError) {
      const slice = await file.slice(offset, Math.min(offset + CHUNK, file.size)).arrayBuffer()
      const buffer = slice as ArrayBuffer & { fileStart: number }
      buffer.fileStart = offset
      mp4.appendBuffer(buffer)
      offset += slice.byteLength
    }
    // A MOV straight off a camera keeps its index at the end of the file, so
    // the loop above may have to read all the way through before moov turns up.
    while (offset < file.size) {
      const slice = await file.slice(offset, Math.min(offset + CHUNK, file.size)).arrayBuffer()
      const buffer = slice as ArrayBuffer & { fileStart: number }
      buffer.fileStart = offset
      mp4.appendBuffer(buffer)
      offset += slice.byteLength
    }
    mp4.flush()
  } catch (err) {
    throw new UnsupportedSource((err as Error).message)
  }

  if (parseError) throw new UnsupportedSource(parseError)
  if (!info) throw new UnsupportedSource('Kein lesbares MP4 oder MOV.')

  const track = (info as MP4Info).videoTracks?.[0]
  if (!track) throw new UnsupportedSource('Die Datei enthält keine Videospur.')

  return { mp4, track, description: describe(mp4, track) }
}

/**
 * Pull the codec-private data out of the sample description.
 *
 * `VideoDecoder` wants the raw avcC/hvcC/vpcC/av1C payload without its box
 * header, which mp4box will only hand over by re-serialising the box.
 */
function describe(mp4: MP4File, track: MP4Track): Uint8Array {
  const trak = mp4.getTrackById(track.id)
  for (const entry of trak?.mdia?.minf?.stbl?.stsd?.entries ?? []) {
    const config = entry.avcC ?? entry.hvcC ?? entry.vpcC ?? entry.av1C
    if (config) {
      const stream = new DataStream(undefined, 0, DataStream.BIG_ENDIAN)
      config.write(stream)
      return new Uint8Array(stream.buffer, 8)
    }
  }
  // Intra-only production codecs (ProRes, DNxHD, v210) carry no config box.
  // The decoder check below then rejects them, which is what we want.
  return new Uint8Array(0)
}

export interface FrameSource {
  info: SourceInfo
  /** Frames in presentation order. The consumer closes each one. */
  frames(signal: AbortSignal): AsyncGenerator<VideoFrame>
  close(): void
}

export async function openFrameSource(file: File): Promise<FrameSource> {
  if (typeof VideoDecoder === 'undefined') {
    throw new UnsupportedSource('Dieser Browser hat keinen WebCodecs-Decoder.')
  }

  const { mp4, track, description } = await demux(file)

  const width = track.track_width || track.video?.width || 0
  const height = track.track_height || track.video?.height || 0
  const config: VideoDecoderConfig = {
    codec: track.codec,
    codedWidth: width,
    codedHeight: height,
    description: description.byteLength > 0 ? description : undefined,
  }

  const support = await VideoDecoder.isConfigSupported(config).catch(
    () => ({ supported: false }) as VideoDecoderSupport,
  )
  if (!support.supported) {
    throw new UnsupportedSource(`Der Codec ${track.codec} lässt sich hier nicht dekodieren.`)
  }

  const durationSec = track.timescale > 0 ? track.duration / track.timescale : 0
  const frameCount = track.nb_samples
  const fps = durationSec > 0 && frameCount > 0 ? frameCount / durationSec : 30

  const info: SourceInfo = { width, height, fps, durationSec, frameCount, codec: track.codec }

  async function* frames(signal: AbortSignal): AsyncGenerator<VideoFrame> {
    const ready: VideoFrame[] = []
    let failure: Error | null = null
    let drained = false
    let wake: (() => void) | null = null

    const signalReady = () => {
      const fn = wake
      wake = null
      fn?.()
    }
    // The timeout is a safety net, not the mechanism: it keeps a dropped
    // decoder callback from parking the generator forever.
    const waitForWork = () =>
      new Promise<void>((resolve) => {
        wake = resolve
        setTimeout(resolve, 250)
      })

    const decoder = new VideoDecoder({
      output: (frame) => {
        ready.push(frame)
        signalReady()
      },
      error: (err) => {
        failure = err instanceof Error ? err : new Error(String(err))
        signalReady()
      },
    })
    decoder.configure(config)

    const pending: Array<{ data: Uint8Array; cts: number; duration: number; sync: boolean }> = []
    mp4.onSamples = (_id, _user, batch) => {
      for (const sample of batch) {
        const scale = sample.timescale || track.timescale || 1
        pending.push({
          data: sample.data,
          cts: (sample.cts / scale) * 1e6,
          duration: (sample.duration / scale) * 1e6,
          sync: sample.is_sync,
        })
      }
    }
    mp4.setExtractionOptions(track.id, null, { nbSamples: SAMPLE_BATCH })
    mp4.start()
    mp4.flush()

    // Feeding runs alongside the consumer so texture compression and decoding
    // overlap instead of taking turns.
    const feed = (async () => {
      for (const sample of pending) {
        if (signal.aborted || failure) break
        decoder.decode(
          new EncodedVideoChunk({
            type: sample.sync ? 'key' : 'delta',
            timestamp: sample.cts,
            duration: sample.duration,
            data: sample.data,
          }),
        )
        while (decoder.decodeQueueSize > DECODE_BACKPRESSURE && !failure && !signal.aborted) {
          await new Promise<void>((resolve) => setTimeout(resolve, 4))
        }
      }
      if (!signal.aborted && !failure) await decoder.flush()
    })()
      .catch((err: unknown) => {
        failure ??= err instanceof Error ? err : new Error(String(err))
      })
      .finally(() => {
        drained = true
        signalReady()
      })

    try {
      for (;;) {
        if (failure) throw failure
        if (signal.aborted) break
        if (ready.length > 0) {
          yield ready.shift()!
          continue
        }
        if (drained) break
        await waitForWork()
      }
      await feed
      if (failure) throw failure
    } finally {
      for (const frame of ready) frame.close()
      ready.length = 0
      pending.length = 0
      if (decoder.state !== 'closed') decoder.close()
    }
  }

  return {
    info,
    frames,
    close() {
      try {
        mp4.stop()
      } catch {
        /* already stopped */
      }
    },
  }
}
