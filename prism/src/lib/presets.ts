import type { MediaFamily } from './formats'
import type { AudioSettings, ImageSettings, OutputSettings, VideoSettings } from '@/engine/types'

/**
 * Presets are the fastest path from "I have a file" to "I have the file I
 * needed". Each one is a partial settings patch plus the reasoning behind it,
 * because a preset the user cannot inspect is a preset they will not trust.
 */

export type PresetGroup = 'web' | 'social' | 'size' | 'quality' | 'pro' | 'utility'

export interface Preset {
  id: string
  label: string
  /** One line explaining what this produces and when to pick it. */
  hint: string
  group: PresetGroup
  family: MediaFamily
  /** Lucide icon name. */
  icon: string
  /** Short chip shown on the card, e.g. "1080p · H.264". */
  spec: string
  video?: Partial<VideoSettings>
  image?: Partial<ImageSettings>
  audio?: Partial<AudioSettings>
  /** Needs the extended ffmpeg core; UI marks it. */
  requiresCore?: boolean
  /** Output family differs from the input family (video to audio, etc.). */
  outputFamily?: MediaFamily
}

export const PRESET_GROUP_LABEL: Record<PresetGroup, string> = {
  web: 'Web',
  social: 'Social Media',
  size: 'Zielgröße',
  quality: 'Qualität',
  pro: 'Produktion',
  utility: 'Werkzeuge',
}

export const PRESETS: Preset[] = [
  /* ---------------------------------------------------------------- Web -- */
  {
    id: 'web-1080',
    label: 'Web 1080p',
    hint: 'H.264 mit Faststart — spielt sofort ab, ohne die ganze Datei zu laden.',
    group: 'web',
    family: 'video',
    icon: 'Globe',
    spec: '1080p · H.264 · CRF 23',
    video: {
      format: 'mp4',
      codec: 'h264',
      audioCodec: 'aac',
      mode: 'quality',
      quality: 23,
      resolution: '1080p',
      audioBitrateKbps: 160,
      faststart: true,
      speed: 'medium',
    },
  },
  {
    id: 'web-720-light',
    label: 'Web 720p leicht',
    hint: 'Für Hintergrundvideos und Vorschauen, wo Ladezeit über Schärfe geht.',
    group: 'web',
    family: 'video',
    icon: 'Feather',
    spec: '720p · H.264 · CRF 28',
    video: {
      format: 'mp4',
      codec: 'h264',
      audioCodec: 'aac',
      mode: 'quality',
      quality: 28,
      resolution: '720p',
      audioBitrateKbps: 96,
      faststart: true,
      speed: 'fast',
    },
  },
  {
    id: 'web-av1',
    label: 'AV1 maximal komprimiert',
    hint: 'Kleinste Datei bei gleicher Qualität. Ohne Hardware-Encoder sehr langsam.',
    group: 'web',
    family: 'video',
    icon: 'Minimize2',
    spec: '1080p · AV1 · CRF 32',
    video: {
      format: 'mp4',
      codec: 'av1',
      audioCodec: 'opus',
      mode: 'quality',
      quality: 32,
      resolution: '1080p',
      audioBitrateKbps: 128,
      speed: 'medium',
    },
  },
  {
    id: 'web-alpha',
    label: 'WebM mit Transparenz',
    hint: 'VP9 behält den Alphakanal — für Overlays direkt im Browser.',
    group: 'web',
    family: 'video',
    icon: 'Layers',
    spec: 'WebM · VP9 + Alpha',
    video: {
      format: 'webm',
      codec: 'vp9',
      audioCodec: 'opus',
      mode: 'quality',
      quality: 31,
      resolution: 'source',
    },
  },
  {
    id: 'img-web',
    label: 'Bild web-optimiert',
    hint: 'WebP bei 82 — der Punkt, an dem Artefakte noch unsichtbar sind.',
    group: 'web',
    family: 'image',
    icon: 'Image',
    spec: 'WebP 82 · max 2048 px',
    image: {
      format: 'webp',
      quality: 82,
      lossless: false,
      resizeMode: 'fit',
      width: 2048,
      height: 2048,
      noUpscale: true,
      stripMetadata: true,
    },
  },
  {
    id: 'img-avif',
    label: 'Bild AVIF',
    hint: 'Nochmal ca. 30 % kleiner als WebP. Encoding nur in Chromium.',
    group: 'web',
    family: 'image',
    icon: 'Sparkles',
    spec: 'AVIF 60 · max 2048 px',
    image: {
      format: 'avif',
      quality: 60,
      lossless: false,
      resizeMode: 'fit',
      width: 2048,
      height: 2048,
      noUpscale: true,
      stripMetadata: true,
    },
  },

  /* ------------------------------------------------------------- Social -- */
  {
    id: 'ig-feed',
    label: 'Instagram Feed',
    hint: 'Quadratisch 1080 × 1080, auf Instagrams eigene Rekompression hin optimiert.',
    group: 'social',
    family: 'video',
    icon: 'Square',
    spec: '1080 × 1080 · 30 fps',
    video: {
      format: 'mp4',
      codec: 'h264',
      audioCodec: 'aac',
      mode: 'quality',
      quality: 21,
      resolution: 'custom',
      customWidth: 1080,
      customHeight: 1080,
      fit: 'cover',
      fps: 30,
      audioBitrateKbps: 128,
      faststart: true,
    },
  },
  {
    id: 'reels',
    label: 'Reels / TikTok / Shorts',
    hint: 'Hochformat 9:16. Zuschneiden statt Balken, damit nichts leer bleibt.',
    group: 'social',
    family: 'video',
    icon: 'Smartphone',
    spec: '1080 × 1920 · 30 fps',
    video: {
      format: 'mp4',
      codec: 'h264',
      audioCodec: 'aac',
      mode: 'quality',
      quality: 21,
      resolution: 'custom',
      customWidth: 1080,
      customHeight: 1920,
      fit: 'cover',
      fps: 30,
      audioBitrateKbps: 128,
      faststart: true,
    },
  },
  {
    id: 'whatsapp',
    label: 'WhatsApp',
    hint: 'Bleibt unter dem Versandlimit und wird nicht nochmal zerkomprimiert.',
    group: 'social',
    family: 'video',
    icon: 'MessageCircle',
    spec: '720p · Ziel 15 MB',
    video: {
      format: 'mp4',
      codec: 'h264',
      audioCodec: 'aac',
      mode: 'size',
      targetSizeMB: 15,
      resolution: '720p',
      audioBitrateKbps: 96,
      faststart: true,
      speed: 'fast',
    },
  },
  {
    id: 'youtube-4k',
    label: 'YouTube 4K',
    hint: 'Hohe Datenrate als Upload-Master — YouTube kodiert ohnehin neu.',
    group: 'social',
    family: 'video',
    icon: 'Youtube',
    spec: '2160p · H.264 · CRF 18',
    video: {
      format: 'mp4',
      codec: 'h264',
      audioCodec: 'aac',
      mode: 'quality',
      quality: 18,
      resolution: '2160p',
      audioBitrateKbps: 320,
      faststart: true,
      speed: 'slow',
    },
  },
  {
    id: 'img-social-square',
    label: 'Social-Bild 1:1',
    hint: 'JPEG 1080 × 1080, zugeschnitten statt verzerrt.',
    group: 'social',
    family: 'image',
    icon: 'Crop',
    spec: 'JPEG 90 · 1080 × 1080',
    image: {
      format: 'jpeg',
      quality: 90,
      resizeMode: 'fill',
      width: 1080,
      height: 1080,
      stripMetadata: true,
      background: '#ffffff',
    },
  },

  /* -------------------------------------------------------- Zielgröße --- */
  {
    id: 'size-10',
    label: '10 MB',
    hint: 'Discord ohne Nitro. Bitrate wird aus der Laufzeit zurückgerechnet.',
    group: 'size',
    family: 'video',
    icon: 'Gauge',
    spec: 'Ziel 10 MB · 2-Pass',
    video: {
      format: 'mp4',
      codec: 'h264',
      audioCodec: 'aac',
      mode: 'size',
      targetSizeMB: 10,
      audioBitrateKbps: 96,
      twoPass: true,
      faststart: true,
    },
  },
  {
    id: 'size-25',
    label: '25 MB',
    hint: 'Übliches E-Mail-Anhangslimit.',
    group: 'size',
    family: 'video',
    icon: 'Mail',
    spec: 'Ziel 25 MB · 2-Pass',
    video: {
      format: 'mp4',
      codec: 'h264',
      audioCodec: 'aac',
      mode: 'size',
      targetSizeMB: 25,
      audioBitrateKbps: 128,
      twoPass: true,
      faststart: true,
    },
  },
  {
    id: 'size-100',
    label: '100 MB',
    hint: 'Für Uploads mit großzügigerem Limit, aber noch ohne Ewigkeiten.',
    group: 'size',
    family: 'video',
    icon: 'HardDrive',
    spec: 'Ziel 100 MB · 2-Pass',
    video: {
      format: 'mp4',
      codec: 'h264',
      audioCodec: 'aac',
      mode: 'size',
      targetSizeMB: 100,
      audioBitrateKbps: 192,
      twoPass: true,
      faststart: true,
    },
  },
  {
    id: 'img-thumb',
    label: 'Thumbnail',
    hint: 'Kleine Vorschau für Listen und Galerien.',
    group: 'size',
    family: 'image',
    icon: 'Grid2x2',
    spec: 'WebP 75 · 400 px',
    image: {
      format: 'webp',
      quality: 75,
      resizeMode: 'fit',
      width: 400,
      height: 400,
      noUpscale: true,
      stripMetadata: true,
    },
  },

  /* --------------------------------------------------------- Qualität --- */
  {
    id: 'master',
    label: 'Master / Archiv',
    hint: 'Visuell verlustfrei. Als Zwischenstand, nicht zum Weitergeben.',
    group: 'quality',
    family: 'video',
    icon: 'Archive',
    spec: 'Quelle · H.264 · CRF 16',
    video: {
      format: 'mp4',
      codec: 'h264',
      audioCodec: 'copy',
      mode: 'quality',
      quality: 16,
      resolution: 'source',
      speed: 'slow',
      stripMetadata: false,
    },
  },
  {
    id: 'hevc-efficient',
    label: 'HEVC platzsparend',
    hint: 'Halbe Größe gegenüber H.264. Ältere Geräte spielen es nicht ab.',
    group: 'quality',
    family: 'video',
    icon: 'Shrink',
    spec: '1080p · H.265 · CRF 26',
    video: {
      format: 'mp4',
      codec: 'hevc',
      audioCodec: 'aac',
      mode: 'quality',
      quality: 26,
      resolution: '1080p',
      audioBitrateKbps: 160,
      faststart: true,
    },
  },
  {
    id: 'img-lossless',
    label: 'PNG verlustfrei',
    hint: 'Für Screenshots, Grafiken und alles mit harten Kanten.',
    group: 'quality',
    family: 'image',
    icon: 'ShieldCheck',
    spec: 'PNG · verlustfrei',
    image: { format: 'png', lossless: true, quality: 100, resizeMode: 'none', stripMetadata: false },
  },
  {
    id: 'img-print',
    label: 'Druck',
    hint: 'TIFF in Originalauflösung, Metadaten und Farbprofil bleiben erhalten.',
    group: 'quality',
    family: 'image',
    icon: 'Printer',
    spec: 'TIFF · 100 %',
    image: {
      format: 'tiff',
      lossless: true,
      quality: 100,
      resizeMode: 'none',
      stripMetadata: false,
    },
  },
  {
    id: 'audio-flac',
    label: 'FLAC Archiv',
    hint: 'Verlustfrei, ca. halb so groß wie WAV.',
    group: 'quality',
    family: 'audio',
    icon: 'Disc3',
    spec: 'FLAC · verlustfrei',
    audio: { format: 'flac', codec: 'flac', mode: 'lossless', sampleRate: 0, channels: 0 },
  },

  /* ------------------------------------------------------- Produktion ---
     The three HAP variants Prism encodes itself. They are ordered the way the
     decision is actually made: how much data rate the playback system has to
     spare, and whether the clip needs an alpha channel. */
  {
    id: 'hap',
    label: 'HAP · Medienserver',
    hint: 'Die Standardvariante: BC1-Texturen, kein Alphakanal, die kleinsten Dateien der Familie. Erste Wahl, wenn die Platte des Medienservers mitspielen muss.',
    group: 'pro',
    family: 'video',
    icon: 'Cpu',
    spec: 'MOV · HAP · 4 Chunks',
    video: {
      format: 'mov',
      codec: 'hap',
      audioCodec: 'none',
      mode: 'lossless',
      resolution: 'source',
      hapChunks: 4,
      stripAudio: true,
    },
  },
  {
    id: 'hap-q',
    label: 'HAP Q · beste Qualität',
    hint: 'YCoCg-Texturen mit deutlich feinerem Farbverlauf als HAP, dafür die doppelte Datenrate. Für Flächen, Verläufe und alles, was groß projiziert wird.',
    group: 'pro',
    family: 'video',
    icon: 'Gem',
    spec: 'MOV · HAP Q · 4 Chunks',
    video: {
      format: 'mov',
      codec: 'hap_q',
      audioCodec: 'none',
      mode: 'lossless',
      resolution: 'source',
      hapChunks: 4,
      stripAudio: true,
    },
  },
  {
    id: 'hap-alpha',
    label: 'HAP Alpha',
    hint: 'HAP mit Alphakanal für Overlays und Keying auf dem Medienserver.',
    group: 'pro',
    family: 'video',
    icon: 'Blend',
    spec: 'MOV · HAP Alpha · 4 Chunks',
    video: {
      format: 'mov',
      codec: 'hap_alpha',
      audioCodec: 'none',
      mode: 'lossless',
      resolution: 'source',
      hapChunks: 4,
      stripAudio: true,
    },
  },
  {
    id: 'prores-hq',
    label: 'ProRes 422 HQ',
    hint: 'Schnittcodec für Resolve, Premiere und Final Cut.',
    group: 'pro',
    family: 'video',
    icon: 'Clapperboard',
    spec: 'MOV · ProRes 422 HQ',
    requiresCore: true,
    video: {
      format: 'mov',
      codec: 'prores',
      audioCodec: 'pcm',
      mode: 'lossless',
      resolution: 'source',
    },
  },

  /* -------------------------------------------------------- Werkzeuge --- */
  {
    id: 'remux',
    label: 'Nur umpacken',
    hint: 'Container tauschen, ohne neu zu kodieren. Verlustfrei und in Sekunden fertig.',
    group: 'utility',
    family: 'video',
    icon: 'Package',
    spec: 'Stream Copy',
    video: {
      format: 'mp4',
      codec: 'copy',
      audioCodec: 'copy',
      mode: 'lossless',
      resolution: 'source',
      faststart: true,
    },
  },
  {
    id: 'to-gif',
    label: 'Als GIF',
    hint: 'Zweipass mit eigener Palette — sonst wird GIF matschig.',
    group: 'utility',
    family: 'video',
    icon: 'Film',
    spec: 'GIF · 480p · 15 fps',
    video: {
      format: 'gif_anim',
      codec: 'gif',
      mode: 'quality',
      resolution: '480p',
      fps: 15,
      stripAudio: true,
    },
  },
  {
    id: 'extract-audio',
    label: 'Ton extrahieren',
    hint: 'Nur die Tonspur herauslösen, das Bild wird verworfen.',
    group: 'utility',
    family: 'video',
    icon: 'AudioLines',
    spec: 'MP3 · 320 kbit/s',
    outputFamily: 'audio',
    audio: { format: 'mp3', codec: 'mp3', mode: 'bitrate', bitrateKbps: 320 },
  },
  {
    id: 'favicon',
    label: 'Favicon-Set',
    hint: 'Eine ICO-Datei mit allen Größen, die Browser erwarten.',
    group: 'utility',
    family: 'image',
    icon: 'AppWindow',
    spec: 'ICO · 16 – 256 px',
    image: {
      format: 'ico',
      lossless: true,
      quality: 100,
      resizeMode: 'none',
      iconSizes: [16, 32, 48, 64, 128, 256],
      stripMetadata: true,
    },
  },
  {
    id: 'audio-podcast',
    label: 'Podcast / Sprache',
    hint: 'Mono-Opus bei 64 kbit/s klingt für Sprache besser als MP3 bei 128.',
    group: 'utility',
    family: 'audio',
    icon: 'Mic',
    spec: 'Opus · 64 kbit/s · mono',
    audio: {
      format: 'opus',
      codec: 'opus',
      mode: 'bitrate',
      bitrateKbps: 64,
      channels: 1,
      normalize: true,
    },
  },
]

export function presetsFor(family: MediaFamily): Preset[] {
  return PRESETS.filter((p) => p.family === family)
}

export function presetById(id: string): Preset | undefined {
  return PRESETS.find((p) => p.id === id)
}

/** What to show in place of the preset gallery while it is collapsed. */
export function activePresetLabel(id: string | null): string | null {
  return id ? (presetById(id)?.label ?? null) : null
}

/** Merge a preset's patch into the current settings, leaving the rest alone. */
export function applyPreset(settings: OutputSettings, preset: Preset): OutputSettings {
  return {
    video: { ...settings.video, ...preset.video },
    image: { ...settings.image, ...preset.image },
    audio: { ...settings.audio, ...preset.audio },
  }
}

/**
 * True when the current settings still match every field the preset pins.
 * Used to un-highlight a preset chip once the user edits a control by hand.
 */
export function presetMatches(settings: OutputSettings, preset: Preset): boolean {
  const sections = [
    [preset.video, settings.video],
    [preset.image, settings.image],
    [preset.audio, settings.audio],
  ] as const
  for (const [patch, current] of sections) {
    if (!patch) continue
    for (const [key, value] of Object.entries(patch)) {
      if ((current as unknown as Record<string, unknown>)[key] !== value) return false
    }
  }
  return true
}
