/**
 * Minimal typings for mp4box.js.
 *
 * The package ships a UMD bundle and no declarations. Only the demux surface
 * Prism actually touches is described here — a fuller definition would be
 * guesswork about boxes we never read.
 */
declare module 'mp4box' {
  export interface MP4VideoInfo {
    width: number
    height: number
  }

  export interface MP4AudioInfo {
    sample_rate: number
    channel_count: number
    sample_size: number
  }

  export interface MP4Track {
    id: number
    codec: string
    timescale: number
    duration: number
    nb_samples: number
    track_width?: number
    track_height?: number
    video?: MP4VideoInfo
    audio?: MP4AudioInfo
  }

  export interface MP4Info {
    duration: number
    timescale: number
    videoTracks: MP4Track[]
    audioTracks: MP4Track[]
  }

  export interface MP4Sample {
    data: Uint8Array
    cts: number
    duration: number
    timescale: number
    is_sync: boolean
  }

  /** Re-serialisable codec configuration box (avcC, esds, dOps, …). */
  export interface MP4ConfigBox {
    write(stream: DataStream): void
  }

  export interface MP4SampleEntry {
    avcC?: MP4ConfigBox
    hvcC?: MP4ConfigBox
    vpcC?: MP4ConfigBox
    av1C?: MP4ConfigBox
    esds?: MP4ConfigBox
    dOps?: MP4ConfigBox
    dfLa?: MP4ConfigBox
  }

  export interface MP4EditListEntry {
    segment_duration: number
    /** Where in the media timeline this edit starts; -1 marks empty edits. */
    media_time: number
  }

  export interface MP4Trak {
    mdia?: { minf?: { stbl?: { stsd?: { entries?: MP4SampleEntry[] } } } }
    edts?: { elst?: { entries?: MP4EditListEntry[] } }
  }

  export interface MP4File {
    onReady: ((info: MP4Info) => void) | null
    onError: ((message: string) => void) | null
    onSamples: ((id: number, user: unknown, samples: MP4Sample[]) => void) | null
    appendBuffer(buffer: ArrayBuffer & { fileStart: number }): number
    setExtractionOptions(id: number, user: unknown, options: { nbSamples?: number }): void
    getTrackById(id: number): MP4Trak | undefined
    start(): void
    stop(): void
    flush(): void
  }

  export function createFile(keepMdatData?: boolean): MP4File

  export class DataStream {
    static BIG_ENDIAN: boolean
    static LITTLE_ENDIAN: boolean
    constructor(buffer?: ArrayBuffer, byteOffset?: number, endianness?: boolean)
    buffer: ArrayBuffer
  }
}
