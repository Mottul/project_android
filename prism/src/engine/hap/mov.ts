/**
 * Minimal QuickTime writer for HAP tracks.
 *
 * HAP only ever ships in a MOV, and the only thing that identifies the variant
 * to a player is the four-character code in the sample description — `Hap1`,
 * `Hap5`, `HapY`. Everything past that is a plain uncompressed-sample video
 * track, which is why a hand-written muxer is the honest choice here: a general
 * MP4 library would have to be taught the codec anyway, and HAP files are large
 * enough that controlling the layout matters.
 *
 * `mdat` is written before `moov` so the frames can be streamed out as they are
 * encoded and only the (small) index is held back to the end. The sample data
 * itself never has to exist as one contiguous buffer — the caller keeps the
 * frames as separate chunks and hands them to a Blob, which the browser is free
 * to spill to disk.
 */

export type HapVariant = 'Hap1' | 'Hap5' | 'HapY'

/**
 * A view that owns a plain ArrayBuffer.
 *
 * `Uint8Array` on its own may be backed by a SharedArrayBuffer, which `Blob`
 * refuses — and this app runs cross-origin isolated, so that is a real case.
 */
type Bytes = Uint8Array<ArrayBuffer>

/**
 * A PCM sound track to write beside the video.
 *
 * 16-bit little-endian (`sowt`) is the format QuickTime has always used for
 * uncompressed audio and the one every media server reads without thinking
 * about it. Compressed audio would defeat the point of HAP: the format exists
 * so that playback costs nothing.
 */
export interface MovAudioInfo {
  sampleRate: number
  channels: number
  /** PCM frames, i.e. samples per channel. */
  frameCount: number
  byteLength: number
}

export interface MovTrackInfo {
  variant: HapVariant
  width: number
  height: number
  /** Ticks per second of the media timeline. */
  timescale: number
  /** Duration of one sample, in media ticks. */
  sampleDelta: number
  /** Byte length of every frame, in order. */
  sampleSizes: number[]
  compressorName: string
  /** 24 for opaque variants, 32 when the texture carries alpha. */
  depth: number
}

const MOVIE_TIMESCALE = 1000

function fourCC(code: string): number[] {
  return [code.charCodeAt(0), code.charCodeAt(1), code.charCodeAt(2), code.charCodeAt(3)]
}

class Writer {
  private parts: number[] = []

  get length(): number {
    return this.parts.length
  }

  u8(v: number) {
    this.parts.push(v & 0xff)
    return this
  }

  u16(v: number) {
    this.parts.push((v >>> 8) & 0xff, v & 0xff)
    return this
  }

  u32(v: number) {
    this.parts.push((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff)
    return this
  }

  /** 64-bit big-endian, assembled from two halves to stay in safe integers. */
  u64(v: number) {
    const high = Math.floor(v / 2 ** 32)
    return this.u32(high).u32(v >>> 0)
  }

  ascii(text: string) {
    for (let i = 0; i < text.length; i++) this.parts.push(text.charCodeAt(i) & 0xff)
    return this
  }

  code(text: string) {
    this.parts.push(...fourCC(text))
    return this
  }

  zeros(count: number) {
    for (let i = 0; i < count; i++) this.parts.push(0)
    return this
  }

  toUint8Array(): Bytes {
    return new Uint8Array(this.parts)
  }
}

/** Wrap a body in its box header. Boxes here are all well under 4 GiB. */
function box(type: string, body: Uint8Array): Bytes {
  const out = new Uint8Array(8 + body.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, out.length)
  out.set(fourCC(type), 4)
  out.set(body, 8)
  return out
}

function concat(parts: Uint8Array[]): Bytes {
  const total = parts.reduce((sum, p) => sum + p.length, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

/** `ftyp`, announcing a QuickTime file rather than an ISO-BMFF one. */
export function buildFtyp(): Bytes {
  const w = new Writer()
  w.code('qt  ')
  w.u32(0x20050300)
  w.code('qt  ')
  return box('ftyp', w.toUint8Array())
}

/**
 * The `mdat` header that precedes the frames.
 *
 * Past 4 GiB the 32-bit size field cannot hold the length, and the box switches
 * to the 64-bit form signalled by a size of 1. A minute of 1080p HAP Q lands
 * around 2 GB, so this is a case that gets hit, not a theoretical one.
 */
export function buildMdatHeader(payloadBytes: number): Bytes {
  if (payloadBytes + 8 <= 0xffffffff) {
    const w = new Writer()
    w.u32(payloadBytes + 8).code('mdat')
    return w.toUint8Array()
  }
  const w = new Writer()
  w.u32(1).code('mdat').u64(payloadBytes + 16)
  return w.toUint8Array()
}

function buildMvhd(durationTicks: number, nextTrackId: number): Bytes {
  const w = new Writer()
  w.u32(0) // version + flags
  w.u32(0) // creation time
  w.u32(0) // modification time
  w.u32(MOVIE_TIMESCALE)
  w.u32(durationTicks)
  w.u32(0x00010000) // rate 1.0
  w.u16(0x0100) // volume 1.0
  w.u16(0)
  w.u32(0).u32(0) // reserved
  // Unity matrix.
  w.u32(0x00010000).u32(0).u32(0)
  w.u32(0).u32(0x00010000).u32(0)
  w.u32(0).u32(0).u32(0x40000000)
  w.zeros(24) // predefined
  w.u32(nextTrackId)
  return box('mvhd', w.toUint8Array())
}

function buildTkhd(
  trackId: number,
  durationTicks: number,
  width: number,
  height: number,
  /** 0x0100 is full; a video track carries 0. */
  volume: number,
): Bytes {
  const w = new Writer()
  w.u32(0x0000000f) // version 0, enabled | in movie | in preview | in poster
  w.u32(0).u32(0)
  w.u32(trackId)
  w.u32(0)
  w.u32(durationTicks)
  w.u32(0).u32(0)
  w.u16(0) // layer
  w.u16(0) // alternate group
  w.u16(volume)
  w.u16(0)
  w.u32(0x00010000).u32(0).u32(0)
  w.u32(0).u32(0x00010000).u32(0)
  w.u32(0).u32(0).u32(0x40000000)
  // Multiplication rather than a shift: a 65536-pixel-wide frame would shift
  // straight off the top of a 32-bit integer.
  w.u32(width * 65536)
  w.u32(height * 65536)
  return box('tkhd', w.toUint8Array())
}

function buildMdhd(timescale: number, mediaDuration: number): Bytes {
  const w = new Writer()
  w.u32(0)
  w.u32(0).u32(0)
  w.u32(timescale)
  w.u32(mediaDuration)
  w.u16(0x55c4) // language: undetermined
  w.u16(0)
  return box('mdhd', w.toUint8Array())
}

function buildHdlr(subtype: 'vide' | 'soun'): Bytes {
  const name = subtype === 'vide' ? 'VideoHandler' : 'SoundHandler'
  const w = new Writer()
  w.u32(0)
  w.code('mhlr')
  w.code(subtype)
  w.u32(0).u32(0).u32(0)
  // QuickTime writes a counted string here; players read the name for display.
  w.u8(name.length).ascii(name)
  return box('hdlr', w.toUint8Array())
}

function buildDinf(): Bytes {
  const url = (() => {
    const w = new Writer()
    w.u32(0x00000001) // version 0, flag 1: media is in this same file
    return box('url ', w.toUint8Array())
  })()
  const dref = (() => {
    const w = new Writer()
    w.u32(0).u32(1)
    return box('dref', concat([w.toUint8Array(), url]))
  })()
  return box('dinf', dref)
}

/**
 * The sample description. This is the whole codec signalling for HAP: the
 * four-character code and the dimensions, no extradata of any kind.
 */
function buildStsd(info: MovTrackInfo): Bytes {
  const entry = new Writer()
  entry.zeros(6) // reserved
  entry.u16(1) // data reference index
  entry.u16(0) // version
  entry.u16(0) // revision
  entry.code('appl') // vendor
  entry.u32(0) // temporal quality
  entry.u32(512) // spatial quality
  entry.u16(info.width)
  entry.u16(info.height)
  entry.u32(0x00480000) // 72 dpi horizontal
  entry.u32(0x00480000) // 72 dpi vertical
  entry.u32(0) // data size
  entry.u16(1) // frames per sample

  // 32-byte Pascal string: one length byte plus padding to a fixed field.
  const name = info.compressorName.slice(0, 31)
  entry.u8(name.length).ascii(name).zeros(31 - name.length)

  entry.u16(info.depth)
  entry.u16(0xffff) // no colour table

  const sampleEntry = box(info.variant, entry.toUint8Array())

  const w = new Writer()
  w.u32(0).u32(1)
  return box('stsd', concat([w.toUint8Array(), sampleEntry]))
}

function buildStts(sampleCount: number, delta: number): Bytes {
  const w = new Writer()
  w.u32(0)
  w.u32(1) // one run: constant frame rate
  w.u32(sampleCount)
  w.u32(delta)
  return box('stts', w.toUint8Array())
}

/**
 * One sample per chunk, so the whole sample-to-chunk map is a single run and
 * `stco` can list one offset per frame.
 */
function buildStsc(): Bytes {
  const w = new Writer()
  w.u32(0)
  w.u32(1) // one run
  w.u32(1) // first chunk
  w.u32(1) // samples per chunk
  w.u32(1) // sample description index
  return box('stsc', w.toUint8Array())
}

function buildStsz(sizes: number[]): Bytes {
  const w = new Writer()
  w.u32(0)
  w.u32(0) // varying sizes; the table follows
  w.u32(sizes.length)
  for (const size of sizes) w.u32(size)
  return box('stsz', w.toUint8Array())
}

/**
 * Chunk offsets. Each frame is its own chunk, which keeps the index honest
 * when a frame is appended without knowing what follows it.
 */
function buildChunkOffsets(offsets: number[]): Bytes {
  const needs64 = offsets.length > 0 && offsets[offsets.length - 1] > 0xffffffff
  const w = new Writer()
  w.u32(0)
  w.u32(offsets.length)
  for (const offset of offsets) {
    if (needs64) w.u64(offset)
    else w.u32(offset)
  }
  return box(needs64 ? 'co64' : 'stco', w.toUint8Array())
}

/** The `sowt` sample entry: uncompressed 16-bit little-endian. */
function buildSoundStsd(audio: MovAudioInfo): Bytes {
  const entry = new Writer()
  entry.zeros(6)
  entry.u16(1) // data reference index
  entry.u16(0) // version 0: the classic layout, understood everywhere
  entry.u16(0) // revision
  entry.u32(0) // vendor
  entry.u16(audio.channels)
  entry.u16(16) // bits per sample
  entry.u16(0) // compression id
  entry.u16(0) // packet size
  // 16.16 fixed point. Every rate anyone ships fits the integer half.
  entry.u32(Math.round(audio.sampleRate) * 65536)

  const w = new Writer()
  w.u32(0).u32(1)
  return box('stsd', concat([w.toUint8Array(), box('sowt', entry.toUint8Array())]))
}

/** Fixed-size samples need no table, only the size and the count. */
function buildFixedStsz(sampleSize: number, count: number): Bytes {
  const w = new Writer()
  w.u32(0)
  w.u32(sampleSize)
  w.u32(count)
  return box('stsz', w.toUint8Array())
}

function buildSoundStsc(samplesPerChunk: number): Bytes {
  const w = new Writer()
  w.u32(0)
  w.u32(1)
  w.u32(1) // first chunk
  w.u32(samplesPerChunk)
  w.u32(1) // sample description index
  return box('stsc', w.toUint8Array())
}

/**
 * The sound track.
 *
 * All of the PCM sits in one chunk after the video. Interleaving it between
 * frames would suit a player reading the file straight through, but a HAP frame
 * is megabytes and a second of audio is kilobytes — the interleave would be
 * almost all video anyway, and every tool that reads HAP goes through the index.
 */
function buildSoundTrak(audio: MovAudioInfo, audioStart: number, durationTicks: number): Bytes {
  const sampleSize = audio.channels * 2

  const stbl = box(
    'stbl',
    concat([
      buildSoundStsd(audio),
      buildStts(audio.frameCount, 1),
      buildSoundStsc(audio.frameCount),
      buildFixedStsz(sampleSize, audio.frameCount),
      buildChunkOffsets([audioStart]),
    ]),
  )

  const smhd = (() => {
    const w = new Writer()
    w.u32(0)
    w.u16(0) // balance: centred
    w.u16(0)
    return box('smhd', w.toUint8Array())
  })()

  const minf = box('minf', concat([smhd, buildDinf(), stbl]))
  const mdia = box(
    'mdia',
    concat([
      buildMdhd(Math.round(audio.sampleRate), audio.frameCount),
      buildHdlr('soun'),
      minf,
    ]),
  )
  // A sound track has no dimensions; full volume, or players open it muted.
  return box('trak', concat([buildTkhd(2, durationTicks, 0, 0, 0x0100), mdia]))
}

/**
 * Assemble `moov` for a finished file.
 *
 * `mdatStart` is where the first frame's bytes begin, i.e. just past the `mdat`
 * header; `audioStart` is where the PCM begins, which is after every frame.
 */
export function buildMoov(
  info: MovTrackInfo,
  mdatStart: number,
  audio?: MovAudioInfo | null,
  audioStart = 0,
): Bytes {
  const sampleCount = info.sampleSizes.length
  const mediaDuration = sampleCount * info.sampleDelta
  const videoTicks = Math.round((mediaDuration / info.timescale) * MOVIE_TIMESCALE)
  const audioTicks = audio
    ? Math.round((audio.frameCount / audio.sampleRate) * MOVIE_TIMESCALE)
    : 0
  // The movie lasts as long as its longest track, or a player stops early.
  const durationTicks = Math.max(videoTicks, audioTicks)

  const offsets: number[] = []
  let at = mdatStart
  for (const size of info.sampleSizes) {
    offsets.push(at)
    at += size
  }

  const stbl = box(
    'stbl',
    concat([
      buildStsd(info),
      buildStts(sampleCount, info.sampleDelta),
      buildStsc(),
      buildStsz(info.sampleSizes),
      buildChunkOffsets(offsets),
    ]),
  )

  const vmhd = (() => {
    const w = new Writer()
    w.u32(0x00000001) // version 0, flag 1 as QuickTime requires
    w.u16(0) // graphics mode: copy
    w.u16(0).u16(0).u16(0) // opcolor
    return box('vmhd', w.toUint8Array())
  })()

  const minf = box('minf', concat([vmhd, buildDinf(), stbl]))
  const mdia = box(
    'mdia',
    concat([buildMdhd(info.timescale, mediaDuration), buildHdlr('vide'), minf]),
  )
  const videoTrak = box(
    'trak',
    concat([buildTkhd(1, videoTicks, info.width, info.height, 0), mdia]),
  )

  const traks = audio
    ? concat([videoTrak, buildSoundTrak(audio, audioStart, audioTicks)])
    : videoTrak

  return box('moov', concat([buildMvhd(durationTicks, audio ? 3 : 2), traks]))
}
