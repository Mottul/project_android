import { describe, expect, it } from 'vitest'

import { buildPlan, type BuildContext } from '@/engine/ffmpeg-args'
import { DEFAULT_SETTINGS, type OutputSettings, type VideoSettings } from '@/engine/types'

/**
 * The ffmpeg command line is the part of Prism most likely to be quietly wrong:
 * a bad flag produces a file that exists but is broken. buildPlan is pure, so
 * it can be pinned down without loading a 31 MB WASM core.
 */

function ctx(video: Partial<VideoSettings>, overrides: Partial<BuildContext> = {}): BuildContext {
  const settings: OutputSettings = {
    ...DEFAULT_SETTINGS,
    video: { ...DEFAULT_SETTINGS.video, ...video },
  }
  return {
    inputName: 'input_source',
    outputStem: 'clip',
    family: 'video',
    settings,
    threads: 4,
    probe: { durationSec: 60, width: 1920, height: 1080, audioCodec: 'aac' },
    ...overrides,
  }
}

/** Value that follows a flag, e.g. flagValue(args, '-crf'). */
function flagValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag)
  return i === -1 ? undefined : args[i + 1]
}

describe('constant quality', () => {
  it('uses CRF and the speed preset, not a bitrate', () => {
    const plan = buildPlan(ctx({ codec: 'h264', mode: 'quality', quality: 21, speed: 'slow' }))
    const [pass] = plan.passes

    expect(plan.passes).toHaveLength(1)
    expect(plan.outputName).toBe('clip.mp4')
    expect(flagValue(pass.args, '-c:v')).toBe('libx264')
    expect(flagValue(pass.args, '-crf')).toBe('21')
    expect(flagValue(pass.args, '-preset')).toBe('slow')
    expect(pass.args).not.toContain('-b:v')
  })

  it('tags HEVC as hvc1 so QuickTime and Safari will play it', () => {
    const plan = buildPlan(ctx({ codec: 'hevc', mode: 'quality' }))
    expect(flagValue(plan.passes[0].args, '-tag:v')).toBe('hvc1')
  })

  it('maps the speed preset to a number for SVT-AV1', () => {
    const plan = buildPlan(ctx({ codec: 'av1', mode: 'quality', speed: 'veryslow' }))
    expect(flagValue(plan.passes[0].args, '-c:v')).toBe('libsvtav1')
    expect(flagValue(plan.passes[0].args, '-preset')).toBe('2')
  })
})

describe('target size', () => {
  it('derives the video bitrate from duration minus the audio track', () => {
    // 25 MB over 60 s: 25 * 8192 * 0.97 / 60 - 128 = ~3184 kbit/s
    const plan = buildPlan(
      ctx({ mode: 'size', targetSizeMB: 25, audioBitrateKbps: 128, twoPass: false }),
    )
    const bitrate = Number(flagValue(plan.passes[0].args, '-b:v')?.replace('k', ''))

    expect(bitrate).toBeGreaterThan(3100)
    expect(bitrate).toBeLessThan(3250)
    expect(plan.passes[0].args).not.toContain('-crf')
  })

  it('warns instead of producing an absurd bitrate when the target is too small', () => {
    const plan = buildPlan(ctx({ mode: 'size', targetSizeMB: 1 }, { probe: { durationSec: 3600 } }))

    expect(flagValue(plan.passes[0].args, '-b:v')).toBe('120k')
    expect(plan.warnings.join(' ')).toMatch(/komprimiert/i)
  })

  it('warns when the duration is unknown', () => {
    const plan = buildPlan(ctx({ mode: 'size' }, { probe: {} }))
    expect(plan.warnings.join(' ')).toMatch(/Laufzeit unbekannt/i)
  })

  it('runs two passes with a shared log file when asked', () => {
    const plan = buildPlan(ctx({ mode: 'size', targetSizeMB: 25, twoPass: true }))

    expect(plan.passes).toHaveLength(2)
    expect(flagValue(plan.passes[0].args, '-pass')).toBe('1')
    expect(flagValue(plan.passes[1].args, '-pass')).toBe('2')
    // The analysis pass must not encode audio or write a file.
    expect(plan.passes[0].args).toContain('-an')
    expect(plan.passes[0].args).toContain('-f')
    expect(plan.passes[1].args).toContain(plan.outputName)
  })

  it('skips two-pass under constant quality and says so', () => {
    const plan = buildPlan(ctx({ mode: 'quality', twoPass: true }))

    expect(plan.passes).toHaveLength(1)
    expect(plan.warnings.join(' ')).toMatch(/Zweipass/i)
  })
})

describe('scaling', () => {
  it('never upscales a preset resolution and escapes the expression comma', () => {
    const plan = buildPlan(ctx({ resolution: '1080p' }))
    const vf = flagValue(plan.passes[0].args, '-vf') ?? ''

    // An unescaped comma would be read as a filter separator by ffmpeg.
    expect(vf).toContain('min(ih\\,1080)')
    expect(vf).toContain('scale=-2:')
  })

  it('crops rather than pads when filling a custom size', () => {
    const plan = buildPlan(
      ctx({ resolution: 'custom', customWidth: 1080, customHeight: 1920, fit: 'cover' }),
    )
    const vf = flagValue(plan.passes[0].args, '-vf') ?? ''

    expect(vf).toContain('force_original_aspect_ratio=increase')
    expect(vf).toContain('crop=1080:1920')
    expect(vf).not.toContain('pad=')
  })

  it('pads rather than crops when fitting inside a custom size', () => {
    const plan = buildPlan(
      ctx({ resolution: 'custom', customWidth: 1920, customHeight: 1080, fit: 'contain' }),
    )
    const vf = flagValue(plan.passes[0].args, '-vf') ?? ''

    expect(vf).toContain('force_original_aspect_ratio=decrease')
    expect(vf).toContain('pad=1920:1080')
  })

  it('emits no filter at all when nothing needs changing', () => {
    const plan = buildPlan(ctx({ resolution: 'source', fps: 0 }))
    expect(plan.passes[0].args).not.toContain('-vf')
  })
})

describe('stream copy', () => {
  it('copies both tracks and warns that filters are ignored', () => {
    const plan = buildPlan(ctx({ codec: 'copy', audioCodec: 'copy', resolution: '720p' }))
    const args = plan.passes[0].args

    expect(flagValue(args, '-c:v')).toBe('copy')
    expect(flagValue(args, '-c:a')).toBe('copy')
    expect(args).not.toContain('-vf')
    expect(plan.warnings.join(' ')).toMatch(/Stream Copy/i)
  })
})

describe('HAP', () => {
  it('selects the variant through -format and passes the chunk count', () => {
    const plan = buildPlan(ctx({ format: 'mov', codec: 'hap_q', hapChunks: 8 }))
    const args = plan.passes[0].args

    expect(plan.outputName).toBe('clip.mov')
    expect(flagValue(args, '-c:v')).toBe('hap')
    expect(flagValue(args, '-format')).toBe('hap_q')
    expect(flagValue(args, '-chunks')).toBe('8')
  })

  it('warns up front that the extended core is required', () => {
    const plan = buildPlan(ctx({ format: 'mov', codec: 'hap_alpha' }))
    expect(plan.warnings.join(' ')).toMatch(/erweiterten ffmpeg-Core/i)
  })
})

describe('GIF', () => {
  it('generates a palette first, then uses it', () => {
    const plan = buildPlan(ctx({ format: 'gif_anim', codec: 'gif', fps: 15, resolution: '480p' }))

    expect(plan.passes).toHaveLength(2)
    expect(plan.passes[0].args.join(' ')).toContain('palettegen')
    expect(plan.passes[1].args.join(' ')).toContain('paletteuse')
    expect(plan.scratch).toContain('palette.png')
    expect(plan.outputName).toBe('clip.gif')
    expect(plan.warnings.join(' ')).toMatch(/256 Farben/i)
  })
})

describe('container options', () => {
  it('adds faststart for MP4', () => {
    const plan = buildPlan(ctx({ format: 'mp4', faststart: true }))
    expect(flagValue(plan.passes[0].args, '-movflags')).toBe('+faststart')
  })

  it('does not add faststart to WebM, where it means nothing', () => {
    const plan = buildPlan(ctx({ format: 'webm', codec: 'vp9', faststart: true }))
    expect(plan.passes[0].args).not.toContain('-movflags')
  })

  it('drops the audio track when the source has none', () => {
    const plan = buildPlan(ctx({}, { probe: { durationSec: 10 } }))
    expect(plan.passes[0].args).toContain('-an')
  })

  it('trims with a seek before the input and a bounded duration', () => {
    const plan = buildPlan(ctx({ trimStart: 5, trimEnd: 12 }))
    const args = plan.passes[0].args

    // -ss must precede -i for a fast seek.
    expect(args.indexOf('-ss')).toBeLessThan(args.indexOf('-i'))
    expect(flagValue(args, '-ss')).toBe('5.000')
    expect(flagValue(args, '-t')).toBe('7.000')
  })
})

describe('audio-only output', () => {
  it('drops the video stream and encodes at the requested bitrate', () => {
    const plan = buildPlan(ctx({}, { audioOnly: true }))
    const args = plan.passes[0].args

    expect(args).toContain('-vn')
    expect(plan.outputName).toBe('clip.mp3')
    expect(flagValue(args, '-c:a')).toBe('libmp3lame')
    expect(flagValue(args, '-b:a')).toBe('192k')
  })
})

describe('command line', () => {
  it('renders a runnable line per pass for the log', () => {
    const plan = buildPlan(ctx({ mode: 'size', targetSizeMB: 10, twoPass: true }))
    const lines = plan.commandLine.split('\n')

    expect(lines).toHaveLength(2)
    expect(lines[0].startsWith('ffmpeg ')).toBe(true)
  })
})
