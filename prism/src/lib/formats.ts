/**
 * Format registry.
 *
 * Every container, codec and image format Prism knows about lives here, with an
 * explicit `availability` flag. That flag is the contract with the UI: a format
 * that needs a custom ffmpeg core is *shown* and *greyed*, never silently
 * missing, so the roadmap is visible instead of surprising.
 */

export type MediaFamily = 'video' | 'image' | 'audio' | 'document' | 'archive'

export type Availability =
  /** Works right now on at least one engine path. */
  | 'ready'
  /** Needs the extended ffmpeg core build (HAP, ProRes, exotic containers). */
  | 'requires-core'
  /** Can be read but not written. */
  | 'decode-only'
  /** Registered for the roadmap; no encoder wired up yet. */
  | 'planned'

export interface CodecDef {
  id: string
  label: string
  /** ffmpeg encoder name. */
  encoder: string
  /** WebCodecs codec string, when the hardware path can do it. */
  webcodec?: string
  availability: Availability
  alpha?: boolean
  lossless?: boolean
  /** Sensible CRF-equivalent range for this codec, low = better. */
  qualityRange?: [best: number, worst: number, standard: number]
  note?: string
}

export interface FormatDef {
  id: string
  label: string
  /** Primary file extension, without the dot. */
  ext: string
  /** Extensions accepted as input for this format. */
  aliases?: string[]
  family: MediaFamily
  mime: string
  availability: Availability
  /** Containers list the codecs they can carry. */
  codecs?: string[]
  defaultCodec?: string
  alpha?: boolean
  lossless?: boolean
  animated?: boolean
  note?: string
}

/* ===========================================================================
   Video codecs
   ======================================================================== */

export const VIDEO_CODECS: Record<string, CodecDef> = {
  h264: {
    id: 'h264',
    label: 'H.264 / AVC',
    encoder: 'libx264',
    webcodec: 'avc1.640028',
    availability: 'ready',
    qualityRange: [14, 34, 23],
    note: 'Kompatibel mit praktisch allem. Standardwahl.',
  },
  hevc: {
    id: 'hevc',
    label: 'H.265 / HEVC',
    encoder: 'libx265',
    webcodec: 'hvc1.1.6.L93.B0',
    availability: 'ready',
    qualityRange: [18, 38, 28],
    note: 'Ca. 40 % kleiner als H.264, dafür langsamer und nicht überall abspielbar.',
  },
  av1: {
    id: 'av1',
    label: 'AV1',
    encoder: 'libsvtav1',
    webcodec: 'av01.0.08M.08',
    availability: 'ready',
    qualityRange: [20, 50, 32],
    note: 'Beste Kompression, lizenzfrei. Ohne Hardware-Encoder sehr langsam.',
  },
  vp9: {
    id: 'vp9',
    label: 'VP9',
    encoder: 'libvpx-vp9',
    webcodec: 'vp09.00.10.08',
    availability: 'ready',
    alpha: true,
    qualityRange: [20, 45, 31],
    note: 'WebM-Standard, unterstützt Alpha.',
  },
  vp8: {
    id: 'vp8',
    label: 'VP8',
    encoder: 'libvpx',
    webcodec: 'vp8',
    availability: 'ready',
    alpha: true,
    qualityRange: [20, 45, 31],
  },
  prores: {
    id: 'prores',
    label: 'Apple ProRes',
    encoder: 'prores_ks',
    availability: 'requires-core',
    alpha: true,
    note: 'Schnittcodec. Große Dateien, sehr schnelle Dekodierung.',
  },
  dnxhd: {
    id: 'dnxhd',
    label: 'DNxHD / DNxHR',
    encoder: 'dnxhd',
    availability: 'requires-core',
    note: 'Avid-Schnittcodec, Gegenstück zu ProRes.',
  },

  /* --- The HAP family ---------------------------------------------------
     HAP stores GPU texture blocks (BC1/BC3) instead of a normal video
     bitstream, so playback costs almost no CPU - which is why media servers
     and VJ tools want it. Encoding means running a DXT compressor per frame,
     plus optional Snappy on the chunks.

     Not in any stock ffmpeg.wasm build: the core must be compiled with
     --enable-encoder=hap --enable-libsnappy. See docs/hap.md. */
  hap: {
    id: 'hap',
    label: 'HAP',
    encoder: 'hap',
    availability: 'requires-core',
    note: 'BC1/DXT1. Kleinste Variante, kein Alphakanal.',
  },
  hap_alpha: {
    id: 'hap_alpha',
    label: 'HAP Alpha',
    encoder: 'hap',
    availability: 'requires-core',
    alpha: true,
    note: 'BC3/DXT5 mit Alphakanal.',
  },
  hap_q: {
    id: 'hap_q',
    label: 'HAP Q',
    encoder: 'hap',
    availability: 'requires-core',
    note: 'Scaled YCoCg DXT5. Deutlich bessere Qualität, ca. doppelte Datenrate.',
  },
  hap_q_alpha: {
    id: 'hap_q_alpha',
    label: 'HAP Q Alpha',
    encoder: 'hap',
    availability: 'requires-core',
    alpha: true,
    note: 'HAP Q plus separater Alphakanal.',
  },

  gif: { id: 'gif', label: 'GIF', encoder: 'gif', availability: 'ready' },
  png_seq: {
    id: 'png_seq',
    label: 'PNG-Sequenz',
    encoder: 'png',
    availability: 'ready',
    alpha: true,
    lossless: true,
    note: 'Einzelbilder als ZIP.',
  },
  copy: {
    id: 'copy',
    label: 'Kopieren (Remux)',
    encoder: 'copy',
    availability: 'ready',
    lossless: true,
    note: 'Nur den Container tauschen, Bitstream unangetastet. Sekundenschnell.',
  },
}

/* ===========================================================================
   Audio codecs
   ======================================================================== */

export const AUDIO_CODECS: Record<string, CodecDef> = {
  aac: { id: 'aac', label: 'AAC', encoder: 'aac', availability: 'ready' },
  mp3: { id: 'mp3', label: 'MP3', encoder: 'libmp3lame', availability: 'ready' },
  opus: {
    id: 'opus',
    label: 'Opus',
    encoder: 'libopus',
    availability: 'ready',
    note: 'Beste Qualität pro Bit unter den verlustbehafteten Codecs.',
  },
  vorbis: { id: 'vorbis', label: 'Vorbis', encoder: 'libvorbis', availability: 'ready' },
  flac: { id: 'flac', label: 'FLAC', encoder: 'flac', availability: 'ready', lossless: true },
  alac: { id: 'alac', label: 'ALAC', encoder: 'alac', availability: 'ready', lossless: true },
  pcm: {
    id: 'pcm',
    label: 'PCM (unkomprimiert)',
    encoder: 'pcm_s16le',
    availability: 'ready',
    lossless: true,
  },
  copy: { id: 'copy', label: 'Kopieren', encoder: 'copy', availability: 'ready', lossless: true },
  none: { id: 'none', label: 'Kein Ton', encoder: '', availability: 'ready' },
}

/* ===========================================================================
   Containers and formats
   ======================================================================== */

export const FORMATS: Record<string, FormatDef> = {
  /* --- Video ----------------------------------------------------------- */
  mp4: {
    id: 'mp4',
    label: 'MP4',
    ext: 'mp4',
    aliases: ['m4v'],
    family: 'video',
    mime: 'video/mp4',
    availability: 'ready',
    codecs: ['h264', 'hevc', 'av1', 'copy'],
    defaultCodec: 'h264',
    note: 'Universell abspielbar.',
  },
  mov: {
    id: 'mov',
    label: 'MOV (QuickTime)',
    ext: 'mov',
    aliases: ['qt'],
    family: 'video',
    mime: 'video/quicktime',
    availability: 'ready',
    codecs: ['h264', 'hevc', 'prores', 'hap', 'hap_alpha', 'hap_q', 'hap_q_alpha', 'copy'],
    defaultCodec: 'h264',
    alpha: true,
    note: 'Einziger Container für HAP und ProRes.',
  },
  webm: {
    id: 'webm',
    label: 'WebM',
    ext: 'webm',
    family: 'video',
    mime: 'video/webm',
    availability: 'ready',
    codecs: ['vp9', 'vp8', 'av1', 'copy'],
    defaultCodec: 'vp9',
    alpha: true,
    note: 'Web-nativ, unterstützt Transparenz.',
  },
  mkv: {
    id: 'mkv',
    label: 'Matroska',
    ext: 'mkv',
    family: 'video',
    mime: 'video/x-matroska',
    availability: 'ready',
    codecs: ['h264', 'hevc', 'av1', 'vp9', 'copy'],
    defaultCodec: 'h264',
    note: 'Nimmt fast jeden Codec und beliebig viele Spuren auf.',
  },
  avi: {
    id: 'avi',
    label: 'AVI',
    ext: 'avi',
    family: 'video',
    mime: 'video/x-msvideo',
    availability: 'ready',
    codecs: ['h264', 'copy'],
    defaultCodec: 'h264',
    note: 'Veraltet, aber manche Hardware verlangt es.',
  },
  gif_anim: {
    id: 'gif_anim',
    label: 'GIF (animiert)',
    ext: 'gif',
    family: 'video',
    mime: 'image/gif',
    availability: 'ready',
    codecs: ['gif'],
    defaultCodec: 'gif',
    animated: true,
    note: 'Zweipass mit Palette für saubere Farben.',
  },
  webp_anim: {
    id: 'webp_anim',
    label: 'WebP (animiert)',
    ext: 'webp',
    family: 'video',
    mime: 'image/webp',
    availability: 'ready',
    codecs: ['vp8'],
    defaultCodec: 'vp8',
    animated: true,
    alpha: true,
    note: 'Deutlich kleiner als GIF, mit Alphakanal.',
  },
  ts: {
    id: 'ts',
    label: 'MPEG-TS',
    ext: 'ts',
    aliases: ['m2ts', 'mts'],
    family: 'video',
    mime: 'video/mp2t',
    availability: 'ready',
    codecs: ['h264', 'hevc', 'copy'],
    defaultCodec: 'h264',
  },
  flv: {
    id: 'flv',
    label: 'FLV',
    ext: 'flv',
    family: 'video',
    mime: 'video/x-flv',
    availability: 'decode-only',
  },
  wmv: {
    id: 'wmv',
    label: 'WMV',
    ext: 'wmv',
    family: 'video',
    mime: 'video/x-ms-wmv',
    availability: 'decode-only',
  },

  /* --- Image ----------------------------------------------------------- */
  jpeg: {
    id: 'jpeg',
    label: 'JPEG',
    ext: 'jpg',
    aliases: ['jpeg', 'jpe', 'jfif'],
    family: 'image',
    mime: 'image/jpeg',
    availability: 'ready',
    note: 'Kleinste Dateien für Fotos, kein Alphakanal.',
  },
  png: {
    id: 'png',
    label: 'PNG',
    ext: 'png',
    family: 'image',
    mime: 'image/png',
    availability: 'ready',
    alpha: true,
    lossless: true,
    note: 'Verlustfrei mit Transparenz. Für Fotos unnötig groß.',
  },
  webp: {
    id: 'webp',
    label: 'WebP',
    ext: 'webp',
    family: 'image',
    mime: 'image/webp',
    availability: 'ready',
    alpha: true,
    note: 'Ca. 30 % kleiner als JPEG bei gleicher Qualität.',
  },
  avif: {
    id: 'avif',
    label: 'AVIF',
    ext: 'avif',
    family: 'image',
    mime: 'image/avif',
    availability: 'ready',
    alpha: true,
    note: 'Beste Kompression. Encoding nur in Chromium-Browsern.',
  },
  gif: {
    id: 'gif',
    label: 'GIF',
    ext: 'gif',
    family: 'image',
    mime: 'image/gif',
    availability: 'ready',
    alpha: true,
    animated: true,
  },
  bmp: {
    id: 'bmp',
    label: 'BMP',
    ext: 'bmp',
    family: 'image',
    mime: 'image/bmp',
    availability: 'ready',
    lossless: true,
  },
  tiff: {
    id: 'tiff',
    label: 'TIFF',
    ext: 'tif',
    aliases: ['tiff'],
    family: 'image',
    mime: 'image/tiff',
    availability: 'ready',
    alpha: true,
    lossless: true,
  },
  ico: {
    id: 'ico',
    label: 'ICO (Favicon)',
    ext: 'ico',
    family: 'image',
    mime: 'image/x-icon',
    availability: 'ready',
    alpha: true,
    note: 'Mehrere Auflösungen in einer Datei.',
  },
  heic: {
    id: 'heic',
    label: 'HEIC / HEIF',
    ext: 'heic',
    aliases: ['heif'],
    family: 'image',
    mime: 'image/heic',
    availability: 'decode-only',
    alpha: true,
    note: 'iPhone-Fotoformat. Lesen ja, schreiben braucht libheif.',
  },
  jxl: {
    id: 'jxl',
    label: 'JPEG XL',
    ext: 'jxl',
    family: 'image',
    mime: 'image/jxl',
    availability: 'planned',
    alpha: true,
    lossless: true,
  },
  svg: {
    id: 'svg',
    label: 'SVG',
    ext: 'svg',
    family: 'image',
    mime: 'image/svg+xml',
    availability: 'ready',
    alpha: true,
    lossless: true,
    note: 'Vektor. Als Eingang wird gerastert, als Ausgang nur durchgereicht.',
  },
  dds: {
    id: 'dds',
    label: 'DDS (DXT)',
    ext: 'dds',
    family: 'image',
    mime: 'image/vnd-ms.dds',
    availability: 'planned',
    alpha: true,
    note: 'GPU-Texturformat, verwandt mit HAP.',
  },
  raw: {
    id: 'raw',
    label: 'Kamera-RAW',
    ext: 'dng',
    aliases: ['cr2', 'cr3', 'nef', 'arw', 'orf', 'raf', 'rw2', 'dng'],
    family: 'image',
    mime: 'image/x-dcraw',
    availability: 'planned',
    note: 'Braucht libraw.wasm.',
  },

  /* --- Audio ----------------------------------------------------------- */
  mp3: {
    id: 'mp3',
    label: 'MP3',
    ext: 'mp3',
    family: 'audio',
    mime: 'audio/mpeg',
    availability: 'ready',
    codecs: ['mp3'],
    defaultCodec: 'mp3',
  },
  m4a: {
    id: 'm4a',
    label: 'M4A / AAC',
    ext: 'm4a',
    aliases: ['aac'],
    family: 'audio',
    mime: 'audio/mp4',
    availability: 'ready',
    codecs: ['aac', 'alac'],
    defaultCodec: 'aac',
  },
  opus: {
    id: 'opus',
    label: 'Opus',
    ext: 'opus',
    family: 'audio',
    mime: 'audio/opus',
    availability: 'ready',
    codecs: ['opus'],
    defaultCodec: 'opus',
  },
  ogg: {
    id: 'ogg',
    label: 'OGG Vorbis',
    ext: 'ogg',
    aliases: ['oga'],
    family: 'audio',
    mime: 'audio/ogg',
    availability: 'ready',
    codecs: ['vorbis', 'opus'],
    defaultCodec: 'vorbis',
  },
  flac: {
    id: 'flac',
    label: 'FLAC',
    ext: 'flac',
    family: 'audio',
    mime: 'audio/flac',
    availability: 'ready',
    codecs: ['flac'],
    defaultCodec: 'flac',
    lossless: true,
  },
  wav: {
    id: 'wav',
    label: 'WAV',
    ext: 'wav',
    family: 'audio',
    mime: 'audio/wav',
    availability: 'ready',
    codecs: ['pcm'],
    defaultCodec: 'pcm',
    lossless: true,
  },
  aiff: {
    id: 'aiff',
    label: 'AIFF',
    ext: 'aiff',
    aliases: ['aif'],
    family: 'audio',
    mime: 'audio/aiff',
    availability: 'ready',
    codecs: ['pcm'],
    defaultCodec: 'pcm',
    lossless: true,
  },
  wma: {
    id: 'wma',
    label: 'WMA',
    ext: 'wma',
    family: 'audio',
    mime: 'audio/x-ms-wma',
    availability: 'decode-only',
  },

  /* --- Document (roadmap) ---------------------------------------------- */
  pdf: {
    id: 'pdf',
    label: 'PDF',
    ext: 'pdf',
    family: 'document',
    mime: 'application/pdf',
    availability: 'planned',
    note: 'Bilder zu PDF und PDF zu Bildern.',
  },
  srt: {
    id: 'srt',
    label: 'SRT',
    ext: 'srt',
    family: 'document',
    mime: 'application/x-subrip',
    availability: 'planned',
    note: 'Untertitel.',
  },
  vtt: {
    id: 'vtt',
    label: 'WebVTT',
    ext: 'vtt',
    family: 'document',
    mime: 'text/vtt',
    availability: 'planned',
  },
}

/* ===========================================================================
   Lookups
   ======================================================================== */

const EXT_INDEX: Map<string, FormatDef> = (() => {
  const map = new Map<string, FormatDef>()
  for (const def of Object.values(FORMATS)) {
    map.set(def.ext, def)
    for (const alias of def.aliases ?? []) map.set(alias, def)
  }
  return map
})()

export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.')
  return dot === -1 ? '' : filename.slice(dot + 1).toLowerCase()
}

export function baseNameOf(filename: string): string {
  const dot = filename.lastIndexOf('.')
  return dot <= 0 ? filename : filename.slice(0, dot)
}

/** Identify a dropped file. Extension first, MIME as the tie-breaker. */
export function identifyFormat(file: { name: string; type?: string }): FormatDef | null {
  const byExt = EXT_INDEX.get(extensionOf(file.name))
  if (byExt) return byExt
  if (file.type) {
    const byMime = Object.values(FORMATS).find((f) => f.mime === file.type)
    if (byMime) return byMime
  }
  return null
}

export function familyOf(file: { name: string; type?: string }): MediaFamily | null {
  const def = identifyFormat(file)
  if (def) return def.family
  const type = file.type ?? ''
  if (type.startsWith('video/')) return 'video'
  if (type.startsWith('image/')) return 'image'
  if (type.startsWith('audio/')) return 'audio'
  return null
}

/** Formats that can be produced for a given source family. */
export function outputFormatsFor(family: MediaFamily): FormatDef[] {
  const order: Record<MediaFamily, MediaFamily[]> = {
    // A video can also be turned into an image (a frame) or stripped to audio.
    video: ['video', 'audio', 'image'],
    image: ['image'],
    audio: ['audio'],
    document: ['document', 'image'],
    archive: ['archive'],
  }
  const families = order[family]
  return Object.values(FORMATS)
    .filter((f) => families.includes(f.family) && f.availability !== 'decode-only')
    .sort((a, b) => {
      const rank = (x: FormatDef) =>
        (families.indexOf(x.family) + 1) * 100 +
        ({ ready: 0, 'requires-core': 1, planned: 2, 'decode-only': 3 }[x.availability] ?? 9) * 10
      return rank(a) - rank(b) || a.label.localeCompare(b.label)
    })
}

export function codecsFor(format: FormatDef): CodecDef[] {
  if (!format.codecs) return []
  const table = format.family === 'audio' ? AUDIO_CODECS : VIDEO_CODECS
  return format.codecs.map((id) => table[id]).filter(Boolean)
}

/** Every extension the file picker should accept. */
export function acceptedExtensions(): string[] {
  return [...EXT_INDEX.keys()].map((e) => `.${e}`)
}

export const FAMILY_LABEL: Record<MediaFamily, string> = {
  video: 'Video',
  image: 'Bild',
  audio: 'Audio',
  document: 'Dokument',
  archive: 'Archiv',
}

/** CSS custom property holding this family's hue. */
export const FAMILY_VAR: Record<MediaFamily, string> = {
  video: 'var(--fam-video)',
  image: 'var(--fam-image)',
  audio: 'var(--fam-audio)',
  document: 'var(--fam-document)',
  archive: 'var(--fam-archive)',
}
