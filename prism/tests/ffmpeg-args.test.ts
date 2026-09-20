import { describe, expect, it } from 'vitest'

import { buildIntermediatePlan, buildPlan, type BuildContext } from '@/engine/ffmpeg-args'
import { DEFAULT_SETTINGS, type OutputSettings, type VideoSettings } from '@/engine/types'
import { PRESETS } from '@/lib/presets'

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

/*
 * HAP, HAP Alpha and HAP Q are written by Prism's own encoder and never reach
 * ffmpeg — see tests/hap.test.ts. What is left here is HAP Q Alpha, the one
 * variant that still needs the extended core.
 */
describe('HAP Q Alpha via ffmpeg', () => {
  it('selects the variant through -format and passes the chunk count', () => {
    const plan = buildPlan(ctx({ format: 'mov', codec: 'hap_q_alpha', hapChunks: 8 }))
    const args = plan.passes[0].args

    expect(plan.outputName).toBe('clip.mov')
    expect(flagValue(args, '-c:v')).toBe('hap')
    expect(flagValue(args, '-format')).toBe('hap_q_alpha')
    expect(flagValue(args, '-chunks')).toBe('8')
  })

  it('warns up front that the extended core is required', () => {
    const plan = buildPlan(ctx({ format: 'mov', codec: 'hap_q_alpha' }))
    expect(plan.warnings.join(' ')).toMatch(/erweiterten ffmpeg-Core/i)
  })

  it('no longer warns for the variants Prism encodes itself', () => {
    for (const codec of ['hap', 'hap_alpha', 'hap_q']) {
      const plan = buildPlan(ctx({ format: 'mov', codec }))
      expect(plan.warnings.join(' ')).not.toMatch(/erweiterten ffmpeg-Core/i)
    }
  })
})

describe('HAP intermediate', () => {
  it('produces a decodable MP4 without metadata', () => {
    const plan = buildIntermediatePlan('input_source', false)
    const args = plan.passes[0].args

    expect(plan.outputName).toBe('prism_hap_source.mp4')
    expect(flagValue(args, '-c:v')).toBe('libx264')
    expect(flagValue(args, '-crf')).toBe('12')
    expect(flagValue(args, '-pix_fmt')).toBe('yuv420p')
    expect(flagValue(args, '-map_metadata')).toBe('-1')
    expect(args).toContain('-an')
  })

  /*
   * The picture has to be re-encoded to get past a decoder that cannot read
   * the source, but the sound does not — and re-compressing a soundtrack on
   * its way to an uncompressed one would be a loss nobody asked for.
   */
  it('carries the sound through losslessly when it is wanted', () => {
    const args = buildIntermediatePlan('input_source', true).passes[0].args
    expect(flagValue(args, '-c:a')).toBe('flac')
    // FLAC in MP4 is what ffmpeg calls experimental.
    expect(flagValue(args, '-strict')).toBe('-2')
    expect(args).not.toContain('-an')
  })
})

/*
 * One field decides whether a file has sound. It used to be two — a codec and
 * a separate strip flag — and a preset could set one without the other, which
 * left the inspector showing a codec while the output came out silent.
 */
describe('sound is decided in one place', () => {
  /*
   * The pass that writes the finished file is the last one. A two-pass plan
   * analyses first, and that pass is always silent by design.
   */
  const outputArgs = (video: Partial<VideoSettings>) => {
    const passes = buildPlan(ctx(video)).passes
    return passes[passes.length - 1].args
  }

  it('drops the track exactly when the codec says none', () => {
    expect(outputArgs({ audioCodec: 'none' })).toContain('-an')
    expect(outputArgs({ audioCodec: 'aac' })).not.toContain('-an')
  })

  it('agrees with every video preset', () => {
    for (const preset of PRESETS.filter((p) => p.family === 'video' && p.video)) {
      // GIF has no sound to decide about.
      const silent =
        preset.video?.audioCodec === 'none' || preset.video?.format === 'gif_anim'
      expect(
        outputArgs({ ...preset.video }).includes('-an'),
        `${preset.id} should ${silent ? '' : 'not '}be silent`,
      ).toBe(silent)
    }
  })

  it('never writes sound into a GIF, whatever the codec says', () => {
    expect(outputArgs({ format: 'gif_anim', codec: 'gif', audioCodec: 'aac' })).toContain('-an')
  })

  it('keeps the analysis pass of a two-pass plan silent', () => {
    const passes = buildPlan(ctx({ mode: 'size', targetSizeMB: 10, twoPass: true })).passes
    expect(passes).toHaveLength(2)
    expect(passes[0].args).toContain('-an')
    expect(passes[1].args).not.toContain('-an')
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
