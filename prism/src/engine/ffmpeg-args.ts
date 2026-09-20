import { AUDIO_CODECS, FORMATS, VIDEO_CODECS } from '@/lib/formats'
import type { MediaFamily } from '@/lib/formats'
import type { MediaProbe, OutputSettings, SpeedPreset } from './types'

/**
 * Turns settings into an ffmpeg invocation.
 *
 * Kept as a pure function on purpose: the command line is the part most likely
 * to be wrong, and a pure builder can be inspected in the UI ("show command"),
 * diffed, and unit-tested without spinning up a 30 MB WASM core.
 */

export interface FFmpegPass {
  args: string[]
  /** Shown in the job card while this pass runs. */
  label: string
  /** Share of total work, used to keep the progress bar monotonic. */
  weight: number
}

export interface FFmpegPlan {
  passes: FFmpegPass[]
  outputName: string
  mime: string
  /** Intermediate files to delete from the virtual FS afterwards. */
  scratch: string[]
  /** Human-readable command, for the "show command" disclosure. */
  commandLine: string
  warnings: string[]
}

export interface BuildContext {
  inputName: string
  outputStem: string
  family: MediaFamily
  settings: OutputSettings
  probe?: MediaProbe
  threads: number
  /** Force audio-only output, e.g. the "extract audio" preset. */
  audioOnly?: boolean
}

/** Short-edge target for each named resolution preset. */
export const RESOLUTION_HEIGHT: Record<string, number> = {
  '4320p': 4320,
  '2160p': 2160,
  '1440p': 1440,
  '1080p': 1080,
  '720p': 720,
  '480p': 480,
  '360p': 360,
}

/** SVT-AV1 and libvpx take a numeric speed; x264/x265 take the word. */
const SVT_SPEED: Record<SpeedPreset, string> = {
  ultrafast: '12',
  veryfast: '10',
  fast: '8',
  medium: '6',
  slow: '4',
  veryslow: '2',
}

const VPX_CPU_USED: Record<SpeedPreset, string> = {
  ultrafast: '8',
  veryfast: '6',
  fast: '4',
  medium: '2',
  slow: '1',
  veryslow: '0',
}

/**
 * Commas inside a filter *expression* would otherwise be read as filter
 * separators by the filtergraph parser.
 */
function esc(expr: string): string {
  return expr.replace(/,/g, '\\,')
}

/** Build the video filter chain. Returns [] when no filtering is needed. */
function buildVideoFilters(ctx: BuildContext): string[] {
  const v = ctx.settings.video
  const filters: string[] = []

  if (v.fps > 0) filters.push(`fps=${v.fps}`)

  if (v.resolution === 'custom') {
    const w = Math.max(2, Math.round(v.customWidth))
    const h = Math.max(2, Math.round(v.customHeight))
    switch (v.fit) {
      case 'cover':
        filters.push(`scale=${w}:${h}:force_original_aspect_ratio=increase:flags=lanczos`)
        filters.push(`crop=${w}:${h}`)
        break
      case 'contain':
        filters.push(`scale=${w}:${h}:force_original_aspect_ratio=decrease:flags=lanczos`)
        filters.push(`pad=${w}:${h}:-1:-1:color=black`)
        break
      default:
        filters.push(`scale=${w}:${h}:flags=lanczos`)
    }
    filters.push('setsar=1')
  } else if (v.resolution !== 'source') {
    const target = RESOLUTION_HEIGHT[v.resolution]
    // min(ih, target) so a 720p source is never upscaled to 1080p; -2 keeps the
    // aspect ratio and forces an even width.
    filters.push(`scale=-2:${esc(`min(ih,${target})`)}:flags=lanczos`)
  }

  return filters
}

/**
 * Derive a video bitrate from a target file size.
 * 1 MB = 8192 kbit; 3 % is reserved for container and index overhead.
 */
function bitrateForTargetSize(
  targetSizeMB: number,
  durationSec: number,
  audioKbps: number,
): { kbps: number; warning?: string } {
  if (!durationSec || durationSec <= 0) {
    return { kbps: 2000, warning: 'Laufzeit unbekannt — Zielgröße konnte nicht berechnet werden.' }
  }
  const totalKbit = targetSizeMB * 8192 * 0.97
  const kbps = Math.floor(totalKbit / durationSec) - audioKbps
  if (kbps < 120) {
    return {
      kbps: 120,
      warning: `Zielgröße für ${Math.round(durationSec)} s Laufzeit sehr knapp — das Ergebnis wird stark sichtbar komprimiert.`,
    }
  }
  return { kbps }
}

function audioArgs(ctx: BuildContext, warnings: string[]): string[] {
  const v = ctx.settings.video
  if (v.audioCodec === 'none') return ['-an']
  if (!ctx.probe?.audioCodec && ctx.family === 'video') return ['-an']

  const codec = AUDIO_CODECS[v.audioCodec]
  if (!codec) {
    warnings.push(`Unbekannter Audio-Codec "${v.audioCodec}" — Ton wird kopiert.`)
    return ['-c:a', 'copy']
  }
  if (codec.id === 'copy') return ['-c:a', 'copy']
  if (codec.lossless) return ['-c:a', codec.encoder]
  return ['-c:a', codec.encoder, '-b:a', `${v.audioBitrateKbps}k`]
}

function videoCodecArgs(ctx: BuildContext, bitrateKbps: number | null): string[] {
  const v = ctx.settings.video
  const codec = VIDEO_CODECS[v.codec]
  if (!codec) return ['-c:v', 'libx264', '-crf', '23']
  if (codec.id === 'copy') return ['-c:v', 'copy']

  const rate = bitrateKbps !== null ? ['-b:v', `${bitrateKbps}k`] : null

  switch (codec.id) {
    case 'h264':
      return [
        '-c:v', 'libx264',
        ...(rate ?? ['-crf', String(v.quality)]),
        '-preset', v.speed,
        '-pix_fmt', 'yuv420p',
      ]
    case 'hevc':
      return [
        '-c:v', 'libx265',
        ...(rate ?? ['-crf', String(v.quality)]),
        '-preset', v.speed,
        '-pix_fmt', 'yuv420p',
        // Without hvc1 tagging, QuickTime and Safari refuse to play the file.
        '-tag:v', 'hvc1',
      ]
    case 'av1':
      return [
        '-c:v', 'libsvtav1',
        ...(rate ?? ['-crf', String(v.quality)]),
        '-preset', SVT_SPEED[v.speed],
        '-pix_fmt', 'yuv420p',
      ]
    case 'vp9':
      return [
        '-c:v', 'libvpx-vp9',
        ...(rate ?? ['-crf', String(v.quality), '-b:v', '0']),
        '-cpu-used', VPX_CPU_USED[v.speed],
        '-row-mt', '1',
        '-pix_fmt', ctx.probe?.hasAlpha ? 'yuva420p' : 'yuv420p',
      ]
    case 'vp8':
      return [
        '-c:v', 'libvpx',
        ...(rate ?? ['-crf', String(v.quality), '-b:v', '2M']),
        '-cpu-used', VPX_CPU_USED[v.speed],
        '-pix_fmt', ctx.probe?.hasAlpha ? 'yuva420p' : 'yuv420p',
      ]
    case 'prores':
      // Profile 3 = 422 HQ, the usual delivery choice.
      return ['-c:v', 'prores_ks', '-profile:v', '3', '-pix_fmt', 'yuv422p10le']
    case 'dnxhd':
      return ['-c:v', 'dnxhd', '-profile:v', 'dnxhr_hq', '-pix_fmt', 'yuv422p']

    /* HAP: one encoder, four variants selected by -format. `-chunks` splits
       each frame so the decoder can spread it across cores on playback, which
       is the whole point of the codec for media servers. */
    case 'hap':
      return ['-c:v', 'hap', '-format', 'hap', '-chunks', String(v.hapChunks)]
    case 'hap_alpha':
      return ['-c:v', 'hap', '-format', 'hap_alpha', '-chunks', String(v.hapChunks)]
    case 'hap_q':
      return ['-c:v', 'hap', '-format', 'hap_q', '-chunks', String(v.hapChunks)]
    case 'hap_q_alpha':
      return ['-c:v', 'hap', '-format', 'hap_q_alpha', '-chunks', String(v.hapChunks)]

    default:
      return ['-c:v', codec.encoder]
  }
}

/** -ss before -i is a keyframe-accurate fast seek; -t bounds the duration. */
function trimArgs(start: number, end: number): { pre: string[]; post: string[] } {
  const pre: string[] = []
  const post: string[] = []
  if (start > 0) pre.push('-ss', start.toFixed(3))
  if (end > start) post.push('-t', (end - start).toFixed(3))
  return { pre, post }
}

function commonOutputArgs(ctx: BuildContext): string[] {
  const v = ctx.settings.video
  const args: string[] = []
  const format = FORMATS[v.format]

  if (v.stripMetadata) args.push('-map_metadata', '-1')
  if (v.faststart && (format?.ext === 'mp4' || format?.ext === 'mov')) {
    args.push('-movflags', '+faststart')
  }
  if (ctx.threads > 1) args.push('-threads', String(ctx.threads))
  return args
}

/* ===========================================================================
   Plans
   ======================================================================== */

/** Animated GIF needs its own palette, otherwise it comes out muddy. */
function buildGifPlan(ctx: BuildContext, warnings: string[]): FFmpegPlan {
  const v = ctx.settings.video
  const outputName = `${ctx.outputStem}.gif`
  const filters = buildVideoFilters(ctx)
  const chain = filters.length ? filters.join(',') : 'null'
  const { pre, post } = trimArgs(v.trimStart, v.trimEnd)

  warnings.push('GIF kann nur 256 Farben — Verläufe werden sichtbar abgestuft.')

  // `-an` is said out loud rather than left to the muxer: the format has no
  // sound at all, and an implicit drop is one more thing to wonder about when
  // a file comes out silent.
  return {
    passes: [
      {
        label: 'Farbpalette analysieren',
        weight: 0.35,
        args: [
          ...pre, '-i', ctx.inputName, ...post,
          '-an',
          '-vf', `${chain},palettegen=stats_mode=diff`,
          '-y', 'palette.png',
        ],
      },
      {
        label: 'GIF schreiben',
        weight: 0.65,
        args: [
          ...pre, '-i', ctx.inputName, ...post,
          '-i', 'palette.png',
          '-an',
          '-lavfi',
          `${chain}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`,
          '-loop', '0',
          '-y', outputName,
        ],
      },
    ],
    outputName,
    mime: 'image/gif',
    scratch: ['palette.png'],
    commandLine: '',
    warnings,
  }
}

function buildAudioOnlyPlan(ctx: BuildContext, warnings: string[]): FFmpegPlan {
  const a = ctx.settings.audio
  const format = FORMATS[a.format]
  const codec = AUDIO_CODECS[a.codec]
  const outputName = `${ctx.outputStem}.${format?.ext ?? 'mp3'}`
  const { pre, post } = trimArgs(a.trimStart, a.trimEnd)

  const filters: string[] = []
  // Two-pass EBU R128 would be better, but needs a full analysis pass; for a
  // one-shot convert, dynaudnorm is the honest compromise.
  if (a.normalize) filters.push('dynaudnorm=f=250:g=15')

  const args = [
    ...pre, '-i', ctx.inputName, ...post,
    '-vn',
    ...(filters.length ? ['-af', filters.join(',')] : []),
    ...(codec?.lossless
      ? ['-c:a', codec.encoder]
      : ['-c:a', codec?.encoder ?? 'libmp3lame', '-b:a', `${a.bitrateKbps}k`]),
    ...(a.sampleRate > 0 ? ['-ar', String(a.sampleRate)] : []),
    ...(a.channels > 0 ? ['-ac', String(a.channels)] : []),
    '-y', outputName,
  ]

  return {
    passes: [{ args, label: 'Ton kodieren', weight: 1 }],
    outputName,
    mime: format?.mime ?? 'audio/mpeg',
    scratch: [],
    commandLine: '',
    warnings,
  }
}

export function buildPlan(ctx: BuildContext): FFmpegPlan {
  const warnings: string[] = []

  if (ctx.audioOnly || ctx.family === 'audio') {
    return finalize(buildAudioOnlyPlan(ctx, warnings))
  }

  const v = ctx.settings.video
  if (v.format === 'gif_anim') return finalize(buildGifPlan(ctx, warnings))

  const format = FORMATS[v.format]
  const outputName = `${ctx.outputStem}.${format?.ext ?? 'mp4'}`
  const codec = VIDEO_CODECS[v.codec]

  if (codec?.availability === 'requires-core') {
    warnings.push(
      `${codec.label} benötigt den erweiterten ffmpeg-Core. Ohne ihn schlägt die Konvertierung fehl.`,
    )
  }

  const isCopy = v.codec === 'copy'
  // Build the filters the settings ask for even when copying, so we can tell
  // the user what stream copy is about to discard. Checking the already-emptied
  // list instead would make the warning unreachable.
  const requestedFilters = buildVideoFilters(ctx)
  const filters = isCopy ? [] : requestedFilters
  const { pre, post } = trimArgs(v.trimStart, v.trimEnd)

  if (isCopy && requestedFilters.length > 0) {
    warnings.push('Stream Copy ignoriert Skalierung und Bildrate — dafür müsste neu kodiert werden.')
  }

  // Resolve the rate-control mode into a concrete bitrate, or null for CRF.
  let bitrateKbps: number | null = null
  if (v.mode === 'bitrate') {
    bitrateKbps = v.bitrateKbps
  } else if (v.mode === 'size') {
    const audioKbps = v.audioCodec === 'none' ? 0 : v.audioBitrateKbps
    const derived = bitrateForTargetSize(
      v.targetSizeMB,
      ctx.probe?.durationSec ?? 0,
      audioKbps,
    )
    bitrateKbps = derived.kbps
    if (derived.warning) warnings.push(derived.warning)
  }

  const filterArgs = filters.length ? ['-vf', filters.join(',')] : []
  const base = [...pre, '-i', ctx.inputName, ...post, ...filterArgs]
  const tail = [...commonOutputArgs(ctx), '-y', outputName]

  // Two-pass only helps when a bitrate target exists; with CRF it is pointless.
  const useTwoPass = v.twoPass && isBitrateTarget(bitrateKbps) && !isCopy
  if (v.twoPass && bitrateKbps === null) {
    warnings.push('Zweipass ist nur bei Bitraten- oder Zielgrößen-Modus wirksam und wurde übersprungen.')
  }

  if (useTwoPass) {
    return finalize({
      passes: [
        {
          label: 'Durchgang 1 — Analyse',
          weight: 0.42,
          args: [
            ...base,
            ...videoCodecArgs(ctx, bitrateKbps),
            '-pass', '1', '-passlogfile', 'prism2pass',
            '-an', '-f', 'null', '-',
          ],
        },
        {
          label: 'Durchgang 2 — Kodierung',
          weight: 0.58,
          args: [
            ...base,
            ...videoCodecArgs(ctx, bitrateKbps),
            '-pass', '2', '-passlogfile', 'prism2pass',
            ...audioArgs(ctx, warnings),
            ...tail,
          ],
        },
      ],
      outputName,
      mime: format?.mime ?? 'video/mp4',
      scratch: ['prism2pass-0.log', 'prism2pass-0.log.mbtree'],
      commandLine: '',
      warnings,
    })
  }

  return finalize({
    passes: [
      {
        label: isCopy ? 'Umpacken' : 'Kodieren',
        weight: 1,
        args: [...base, ...videoCodecArgs(ctx, bitrateKbps), ...audioArgs(ctx, warnings), ...tail],
      },
    ],
    outputName,
    mime: format?.mime ?? 'video/mp4',
    scratch: [],
    commandLine: '',
    warnings,
  })
}

function isBitrateTarget(value: number | null): value is number {
  return value !== null
}

/** Render the human-readable command for the "show command" disclosure. */
function finalize(plan: FFmpegPlan): FFmpegPlan {
  plan.commandLine = plan.passes
    .map((p) => `ffmpeg ${p.args.map(quoteIfNeeded).join(' ')}`)
    .join('\n')
  return plan
}

function quoteIfNeeded(arg: string): string {
  return /[\s;|&<>()$`"']/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg
}

/**
 * A decode-only stepping stone for the HAP encoder.
 *
 * WebCodecs has no ProRes or DNxHD decoder and mp4box reads no Matroska, so a
 * source the HAP worker cannot open is first rewritten into the one thing every
 * browser decodes in hardware. CRF 12 is chosen to be visually transparent
 * rather than efficient: the file lives for one conversion and is thrown away,
 * and whatever it discards is discarded from the texture as well.
 *
 * `yuv420p` is not a compromise here — the DXT compressor subsamples chroma far
 * more aggressively than 4:2:0 already does.
 *
 * The sound, by contrast, is carried through losslessly. FLAC in MP4 is what
 * ffmpeg calls experimental and needs `-strict -2`, but the file never leaves
 * this machine and `AudioDecoder` reads it — and re-encoding a soundtrack twice
 * for a format whose entire point is uncompressed audio would be absurd.
 */
export function buildIntermediatePlan(inputName: string, keepAudio: boolean): FFmpegPlan {
  const outputName = 'prism_hap_source.mp4'
  const audio = keepAudio ? ['-c:a', 'flac', '-strict', '-2'] : ['-an']

  return finalize({
    passes: [
      {
        label: 'Zwischenformat erzeugen',
        weight: 1,
        args: [
          '-hide_banner',
          '-i',
          inputName,
          '-sn',
          '-dn',
          '-map_metadata',
          '-1',
          '-c:v',
          'libx264',
          '-preset',
          'veryfast',
          '-crf',
          '12',
          '-pix_fmt',
          'yuv420p',
          ...audio,
          '-movflags',
          '+faststart',
          outputName,
        ],
      },
    ],
    outputName,
    mime: 'video/mp4',
    scratch: [],
    commandLine: '',
    warnings: [],
  })
}
