/// <reference lib="webworker" />

import { DataStream, type MP4ConfigBox, type MP4File, type MP4Track } from 'mp4box'

/**
 * Audio for HAP files.
 *
 * Media servers want uncompressed audio next to a HAP track — the whole point
 * of the format is that playback costs nothing, and a codec that has to be
 * decoded every frame undoes part of that. So whatever the source carries gets
 * decoded once here and written as 16-bit PCM.
 *
 * Audio is never allowed to fail a job. A track that cannot be decoded costs a
 * warning and a silent file, not an error: someone converting a two-gigabyte
 * clip should not lose the run over a soundtrack.
 */

export class NoUsableAudio extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NoUsableAudio'
  }
}

export interface DecodedAudio {
  sampleRate: number
  channels: number
  /** PCM frames per channel. */
  frameCount: number
  /** Interleaved signed 16-bit little-endian, in order. */
  chunks: Blob[]
  byteLength: number
  codec: string
}

/** Decoder queue depth, in packets. */
const BACKPRESSURE = 12

/**
 * Walk an MPEG-4 descriptor tree to the DecoderSpecificInfo.
 *
 * `AudioDecoder` wants the AudioSpecificConfig — two to five bytes deep inside
 * the esds box — not the descriptor that contains it. Reading it by walking the
 * raw bytes rather than mp4box's parsed object keeps this working when mp4box
 * changes the shape of what it hands back.
 *
 *   0x03 ES_Descriptor -> 0x04 DecoderConfig -> 0x05 DecoderSpecificInfo
 *
 * Exported for the tests: a wrong config does not throw, it produces a decoder
 * that runs and emits noise.
 */
export function findDecoderSpecificInfo(esds: Uint8Array): Uint8Array | null {
  let at = 4 // version and flags of the full box

  const readLength = (): number => {
    let length = 0
    for (let i = 0; i < 4; i++) {
      const byte = esds[at++]
      length = (length << 7) | (byte & 0x7f)
      if ((byte & 0x80) === 0) break
    }
    return length
  }

  while (at < esds.length) {
    const tag = esds[at++]
    const length = readLength()
    if (at + length > esds.length) return null

    switch (tag) {
      case 0x03: // ES_Descriptor: skip ES_ID and the flags byte
        at += 3
        break
      case 0x04: // DecoderConfigDescriptor: skip the fixed 13-byte header
        at += 13
        break
      case 0x05:
        return esds.subarray(at, at + length)
      default:
        at += length
    }
  }
  return null
}

/**
 * Rebuild an OpusHead from the `dOps` box.
 *
 * Same fields, but the MP4 box stores them big-endian and the identification
 * header `AudioDecoder` expects is little-endian with a magic prefix. Getting
 * this backwards produces a decoder that configures and then outputs noise, so
 * it is exported and tested rather than trusted.
 */
export function opusHeadFrom(dOps: Uint8Array): Uint8Array | null {
  if (dOps.length < 11) return null
  const mappingFamily = dOps[10]
  const tail = mappingFamily === 0 ? 0 : dOps.length - 11
  const head = new Uint8Array(19 + tail)
  const view = new DataView(head.buffer)

  head.set([0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64], 0) // "OpusHead"
  head[8] = 1 // version
  head[9] = dOps[1] // channel count
  view.setUint16(10, (dOps[2] << 8) | dOps[3], true) // pre-skip
  view.setUint32(12, (dOps[4] << 24) | (dOps[5] << 16) | (dOps[6] << 8) | dOps[7], true)
  view.setUint16(16, (dOps[8] << 8) | dOps[9], true) // output gain
  head[18] = mappingFamily
  if (tail > 0) head.set(dOps.subarray(11), 19)
  return head
}

/**
 * Rebuild a FLAC identification header from the `dfLa` box.
 *
 * WebCodecs wants the stream's own header — the `fLaC` magic followed by the
 * metadata blocks — while the MP4 box stores the blocks alone behind a
 * full-box version field. Handing over the blocks without the magic is the
 * kind of mistake that survives `isConfigSupported`: the decoder accepts the
 * configuration and only rejects it later, asynchronously, when the first
 * packet arrives.
 */
export function flacHeaderFrom(dfLa: Uint8Array): Uint8Array | null {
  if (dfLa.length <= 4) return null
  const blocks = dfLa.subarray(4)
  const out = new Uint8Array(4 + blocks.length)
  out.set([0x66, 0x4c, 0x61, 0x43], 0) // "fLaC"
  out.set(blocks, 4)
  return out
}

function serialise(box: MP4ConfigBox): Uint8Array {
  const stream = new DataStream(undefined, 0, DataStream.BIG_ENDIAN)
  box.write(stream)
  // Strip the box header; every consumer here wants the body.
  return new Uint8Array(stream.buffer, 8)
}

/**
 * Frames of encoder priming to throw away at the start.
 *
 * Every lossy audio encoder emits samples before the real signal begins. Left
 * in, they push the whole soundtrack ten to fifty milliseconds late — small
 * enough to survive casual listening, exactly large enough to be wrong when a
 * media server runs the clip against timecode.
 *
 * Who removes them depends on the codec. Opus carries the count in its own
 * identification header, and the decoder applies it before handing anything
 * back; subtracting it again here would cut the start of the programme off.
 * AAC says nothing to its decoder and leaves the delay to the container's edit
 * list, so that one is ours to honour.
 */
function primingFrames(mp4: MP4File, track: MP4Track, sampleRate: number): number {
  const trak = mp4.getTrackById(track.id)
  const first = trak?.edts?.elst?.entries?.find((e) => e.media_time > 0)
  if (!first) return 0

  // `media_time` counts in the track's own timescale, which is usually but not
  // always the sample rate the decoder ends up producing.
  const scale = track.timescale > 0 ? sampleRate / track.timescale : 1
  return Math.round(first.media_time * scale)
}

/** The `description` an AudioDecoder needs, or null when it needs none. */
function describeAudio(mp4: MP4File, track: MP4Track): Uint8Array | null {
  const trak = mp4.getTrackById(track.id)
  for (const entry of trak?.mdia?.minf?.stbl?.stsd?.entries ?? []) {
    if (entry.esds) return findDecoderSpecificInfo(serialise(entry.esds))
    if (entry.dOps) return opusHeadFrom(serialise(entry.dOps))
    if (entry.dfLa) return flacHeaderFrom(serialise(entry.dfLa))
  }
  // MP3 and raw PCM carry no configuration at all.
  return null
}

/**
 * Convert one decoded packet to interleaved 16-bit.
 *
 * `copyTo` will do the conversion itself where the platform supports it. Where
 * it does not, planar float is the format every implementation can produce, and
 * interleaving it by hand is a dozen lines.
 */
function toInt16(data: AudioData): Int16Array<ArrayBuffer> {
  const channels = data.numberOfChannels
  const frames = data.numberOfFrames
  const out = new Int16Array(frames * channels)

  try {
    data.copyTo(out, { planeIndex: 0, format: 's16' })
    return out
  } catch {
    /* fall through to the manual path */
  }

  const plane = new Float32Array(frames)
  for (let channel = 0; channel < channels; channel++) {
    data.copyTo(plane, { planeIndex: channel, format: 'f32-planar' })
    for (let i = 0; i < frames; i++) {
      const sample = plane[i]
      const clamped = sample < -1 ? -1 : sample > 1 ? 1 : sample
      // Asymmetric on purpose: -1.0 maps to -32768, +1.0 to +32767.
      out[i * channels + channel] = Math.round(clamped < 0 ? clamped * 32768 : clamped * 32767)
    }
  }
  return out
}

/**
 * Decode a file's first audio track to PCM.
 *
 * Throws `NoUsableAudio` when there is nothing to decode or the platform
 * cannot decode it; the caller turns that into a warning.
 */
export async function decodeAudioTrack(
  mp4: MP4File,
  track: MP4Track,
  signal: AbortSignal,
  onProgress?: (fraction: number) => void,
): Promise<DecodedAudio> {
  if (typeof AudioDecoder === 'undefined') {
    throw new NoUsableAudio('Dieser Browser hat keinen WebCodecs-Audiodecoder.')
  }

  const channels = track.audio?.channel_count ?? 2
  const sampleRate = track.audio?.sample_rate ?? 48000
  const description = describeAudio(mp4, track)

  const config: AudioDecoderConfig = {
    codec: track.codec,
    sampleRate,
    numberOfChannels: channels,
    ...(description && description.byteLength > 0 ? { description } : {}),
  }

  const support = await AudioDecoder.isConfigSupported(config).catch(
    () => ({ supported: false }) as AudioDecoderSupport,
  )
  if (!support.supported) {
    throw new NoUsableAudio(`Die Tonspur (${track.codec}) lässt sich hier nicht dekodieren.`)
  }

  const skipFrames = primingFrames(mp4, track, sampleRate)
  // What the container says the track lasts, minus whatever the edit list
  // declared was not part of it. Only ever used as a ceiling, so a rounding
  // difference can never cut real audio short.
  const declaredFrames =
    track.timescale > 0
      ? Math.max(0, Math.round((track.duration / track.timescale) * sampleRate) - skipFrames)
      : 0

  const chunks: Blob[] = []
  let frameCount = 0
  let byteLength = 0
  let dropped = 0
  let outRate = sampleRate
  let outChannels = channels
  // Boxed so the callbacks below can set it without TypeScript narrowing the
  // variable to `never` at every later read.
  const failed: { error: Error | null } = { error: null }

  const decoder = new AudioDecoder({
    output: (data) => {
      try {
        outRate = data.sampleRate
        outChannels = data.numberOfChannels
        const pcm = toInt16(data)

        let from = 0
        let to = data.numberOfFrames

        if (dropped < skipFrames) {
          const skip = Math.min(skipFrames - dropped, to)
          dropped += skip
          from = skip
        }
        if (declaredFrames > 0 && frameCount + (to - from) > declaredFrames) {
          to = from + Math.max(0, declaredFrames - frameCount)
        }
        if (to <= from) return

        const kept =
          from === 0 && to === data.numberOfFrames
            ? pcm
            : pcm.subarray(from * outChannels, to * outChannels)

        frameCount += to - from
        byteLength += kept.byteLength
        // Straight into a Blob: an hour of stereo is 700 MB as a typed array,
        // and the browser can page a Blob out to disk.
        chunks.push(new Blob([kept]))
      } catch (err) {
        failed.error ??= err instanceof Error ? err : new Error(String(err))
      } finally {
        data.close()
      }
    },
    error: (err) => {
      failed.error ??= err instanceof Error ? err : new Error(String(err))
    },
  })

  try {
    decoder.configure(config)
  } catch (err) {
    // `isConfigSupported` answering yes is not a promise that `configure`
    // will accept the same object — a description the decoder dislikes only
    // surfaces here. Either way it is a warning, never a failed job.
    decoder.close()
    throw new NoUsableAudio(
      `Die Tonspur (${track.codec}) ließ sich nicht einrichten: ${(err as Error).message}`,
    )
  }

  const packets: Array<{ data: Uint8Array; cts: number; duration: number }> = []
  mp4.onSamples = (_id, _user, batch) => {
    for (const sample of batch) {
      const scale = sample.timescale || track.timescale || 1
      packets.push({
        data: sample.data,
        cts: (sample.cts / scale) * 1e6,
        duration: (sample.duration / scale) * 1e6,
      })
    }
  }
  mp4.setExtractionOptions(track.id, null, { nbSamples: 1024 })
  mp4.start()
  mp4.flush()

  try {
    for (let i = 0; i < packets.length; i++) {
      if (signal.aborted || failed.error) break
      const packet = packets[i]
      decoder.decode(
        new EncodedAudioChunk({
          type: 'key',
          timestamp: packet.cts,
          duration: packet.duration,
          data: packet.data,
        }),
      )
      while (decoder.decodeQueueSize > BACKPRESSURE && !failed.error && !signal.aborted) {
        await new Promise<void>((resolve) => setTimeout(resolve, 2))
      }
      if (i % 64 === 0) onProgress?.(i / packets.length)
    }
    if (!signal.aborted && !failed.error) await decoder.flush()
  } catch (err) {
    // WebCodecs reports a configuration it cannot honour asynchronously, so a
    // rejected flush is where a bad description surfaces. It still only costs
    // the soundtrack, never the job.
    failed.error ??= err instanceof Error ? err : new Error(String(err))
  } finally {
    if (decoder.state !== 'closed') decoder.close()
    mp4.onSamples = null
  }

  if (failed.error) throw new NoUsableAudio(failed.error.message)
  if (frameCount === 0) throw new NoUsableAudio('Die Tonspur enthielt keine Abtastwerte.')

  return {
    sampleRate: outRate,
    channels: outChannels,
    frameCount,
    chunks,
    byteLength,
    codec: track.codec,
  }
}
