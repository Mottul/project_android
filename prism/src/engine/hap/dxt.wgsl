// DXT / BC block compression on the GPU.
//
// A transcription of dxt.ts, kept deliberately literal: the two must agree, and
// the self-check in gpu-dxt.ts refuses the GPU path when they drift. Where the
// TypeScript relies on integer semantics — `>>` flooring, Int32Array truncating
// on assignment — this uses floor() rather than round() so the two arrive at the
// same number.
//
// Pixels arrive as a storage buffer rather than a texture. The GPU copies the
// canvas into it without the CPU ever seeing the pixels, and a plain buffer is
// something a WGSL interpreter can run, which is the only way this shader gets
// tested without a graphics card.

struct Params {
  width: u32,
  height: u32,
  blocksWide: u32,
  blocksHigh: u32,
  // Distance between pixel rows, in u32s. copyTextureToBuffer pads rows to a
  // 256-byte boundary, so this is not always the width.
  rowStride: u32,
  mode: u32,
  pad0: u32,
  pad1: u32,
};

const MODE_DXT1: u32 = 0u;
const MODE_DXT5: u32 = 1u;
const MODE_YCOCG: u32 = 2u;

@group(0) @binding(0) var<storage, read> pixels: array<u32>;
@group(0) @binding(1) var<storage, read_write> blocks: array<u32>;
@group(0) @binding(2) var<uniform> params: Params;

// One 4x4 block per invocation. Private, so every invocation has its own.
var<private> texels: array<vec4<f32>, 16>;
var<private> indices: array<u32, 16>;
var<private> endpoint0: vec3<f32>;
var<private> endpoint1: vec3<f32>;
var<private> palette: array<vec3<f32>, 4>;

fn clamp255(v: f32) -> f32 {
  return clamp(v, 0.0, 255.0);
}

// floor(x + 0.5) rather than round(): WGSL rounds halfway cases to even and
// JavaScript rounds them up, and the two implementations have to agree.
fn roundHalfUp(v: f32) -> f32 {
  return floor(v + 0.5);
}

fn readPixel(x: u32, y: u32) -> vec4<f32> {
  let packed = pixels[y * params.rowStride + x];
  return vec4<f32>(
    f32(packed & 0xffu),
    f32((packed >> 8u) & 0xffu),
    f32((packed >> 16u) & 0xffu),
    f32((packed >> 24u) & 0xffu),
  );
}

// RGB -> YCoCg, rearranged to (Co, Cg, 0, Y) so that a plain DXT5 compressor
// puts luma in the precise alpha ramp and chroma in the coarse colour block.
fn toYCoCg(c: vec4<f32>) -> vec4<f32> {
  let r = c.r;
  let g = c.g;
  let b = c.b;
  let y = floor((r + 2.0 * g + b + 2.0) / 4.0);
  let co = floor((r - b + 1.0) / 2.0) + 128.0;
  let cg = floor((-r + 2.0 * g - b + 2.0) / 4.0) + 128.0;
  return vec4<f32>(clamp255(co), clamp255(cg), 0.0, clamp255(y));
}

// Blocks past the right or bottom edge repeat the last real pixel; a black pad
// would bleed into the border of the decoded texture.
fn gatherBlock(bx: u32, by: u32) {
  for (var y: u32 = 0u; y < 4u; y = y + 1u) {
    let sy = min(by * 4u + y, params.height - 1u);
    for (var x: u32 = 0u; x < 4u; x = x + 1u) {
      let sx = min(bx * 4u + x, params.width - 1u);
      var c = readPixel(sx, sy);
      if (params.mode == MODE_YCOCG) {
        c = toYCoCg(c);
      }
      texels[y * 4u + x] = c;
    }
  }
}

fn quantize565(c: vec3<f32>) -> u32 {
  let r = u32(roundHalfUp(clamp255(c.r) * 31.0 / 255.0));
  let g = u32(roundHalfUp(clamp255(c.g) * 63.0 / 255.0));
  let b = u32(roundHalfUp(clamp255(c.b) * 31.0 / 255.0));
  return (r << 11u) | (g << 5u) | b;
}

fn expand565(c: u32) -> vec3<f32> {
  let r5 = (c >> 11u) & 31u;
  let g6 = (c >> 5u) & 63u;
  let b5 = c & 31u;
  return vec3<f32>(
    f32((r5 << 3u) | (r5 >> 2u)),
    f32((g6 << 2u) | (g6 >> 4u)),
    f32((b5 << 3u) | (b5 >> 2u)),
  );
}

// Bounding box of the block, inset to blunt single-pixel outliers.
fn boundingBoxEndpoints() {
  var lo = vec3<f32>(255.0, 255.0, 255.0);
  var hi = vec3<f32>(0.0, 0.0, 0.0);
  for (var i: u32 = 0u; i < 16u; i = i + 1u) {
    let c = texels[i].rgb;
    lo = min(lo, c);
    hi = max(hi, c);
  }
  // `>> 4` on an integer range, i.e. a sixteenth, floored.
  let inset = floor((hi - lo) / 16.0);
  endpoint0 = clamp(hi - inset, vec3<f32>(0.0), vec3<f32>(255.0));
  endpoint1 = clamp(lo + inset, vec3<f32>(0.0), vec3<f32>(255.0));
}

fn buildPalette(c0: u32, c1: u32) {
  let a = expand565(c0);
  let b = expand565(c1);
  palette[0] = a;
  palette[1] = b;
  palette[2] = floor((2.0 * a + b + vec3<f32>(1.0)) / 3.0);
  palette[3] = floor((a + 2.0 * b + vec3<f32>(1.0)) / 3.0);
}

// Channel weights are the usual luma approximation: an unweighted distance
// spends bits on blue, where nobody is looking.
fn assignIndices() {
  for (var i: u32 = 0u; i < 16u; i = i + 1u) {
    let c = texels[i].rgb;
    var best: u32 = 0u;
    var bestError: f32 = 3.4e38;
    for (var p: u32 = 0u; p < 4u; p = p + 1u) {
      let d = c - palette[p];
      let e = 3.0 * d.r * d.r + 6.0 * d.g * d.g + d.b * d.b;
      if (e < bestError) {
        bestError = e;
        best = p;
      }
    }
    indices[i] = best;
  }
}

// Least-squares endpoints for the indices we already have. This is the step
// that turns a coarse bounding box into a genuinely good fit.
fn refineEndpoints() {
  var ww: f32 = 0.0;
  var vv: f32 = 0.0;
  var wv: f32 = 0.0;
  var sumA = vec3<f32>(0.0);
  var sumB = vec3<f32>(0.0);

  for (var i: u32 = 0u; i < 16u; i = i + 1u) {
    var w: f32 = 0.0;
    let index = indices[i];
    if (index == 1u) {
      w = 1.0;
    } else if (index == 2u) {
      w = 1.0 / 3.0;
    } else if (index == 3u) {
      w = 2.0 / 3.0;
    }
    let v = 1.0 - w;
    ww = ww + w * w;
    vv = vv + v * v;
    wv = wv + w * v;
    sumA = sumA + v * texels[i].rgb;
    sumB = sumB + w * texels[i].rgb;
  }

  let det = vv * ww - wv * wv;
  // Every pixel landed on the same ramp position; the current endpoints are as
  // good as anything.
  if (abs(det) < 1e-6) {
    return;
  }

  let inv = 1.0 / det;
  endpoint0 = clamp(
    floor((sumA * ww - sumB * wv) * inv + vec3<f32>(0.5)), vec3<f32>(0.0), vec3<f32>(255.0));
  endpoint1 = clamp(
    floor((sumB * vv - sumA * wv) * inv + vec3<f32>(0.5)), vec3<f32>(0.0), vec3<f32>(255.0));
}

struct ColorBlock {
  lo: u32,
  hi: u32,
};

// DXT1 reserves the c0 <= c1 ordering for the punch-through mode. HAP textures
// are opaque, so the four-colour mode is always what we want.
fn fitColorBlock() -> ColorBlock {
  boundingBoxEndpoints();

  var c0 = quantize565(endpoint0);
  var c1 = quantize565(endpoint1);

  var out: ColorBlock;
  if (c0 == c1) {
    out.lo = c0 | (c1 << 16u);
    out.hi = 0u;
    return out;
  }

  buildPalette(c0, c1);
  assignIndices();

  for (var refinement: u32 = 0u; refinement < 2u; refinement = refinement + 1u) {
    refineEndpoints();
    let r0 = quantize565(endpoint0);
    let r1 = quantize565(endpoint1);
    if (r0 == r1) {
      break;
    }
    c0 = r0;
    c1 = r1;
    buildPalette(c0, c1);
    assignIndices();
  }

  if (c0 < c1) {
    let t = c0;
    c0 = c1;
    c1 = t;
    // Swapping the endpoints swaps 0 with 1 and 2 with 3 — one xor covers both.
    for (var i: u32 = 0u; i < 16u; i = i + 1u) {
      indices[i] = indices[i] ^ 1u;
    }
  }

  var packed: u32 = 0u;
  for (var i: u32 = 0u; i < 16u; i = i + 1u) {
    packed = packed | (indices[i] << (2u * i));
  }

  out.lo = c0 | (c1 << 16u);
  out.hi = packed;
  return out;
}

struct AlphaBlock {
  lo: u32,
  hi: u32,
};

// Eight interpolated levels along min..max. For HAP Q this channel carries
// luma, which is why HAP Q looks so much better than plain HAP at the same
// block size.
fn fitAlphaBlock() -> AlphaBlock {
  var lo: f32 = 255.0;
  var hi: f32 = 0.0;
  for (var i: u32 = 0u; i < 16u; i = i + 1u) {
    lo = min(lo, texels[i].a);
    hi = max(hi, texels[i].a);
  }

  var out: AlphaBlock;
  let maxA = u32(hi);
  let minA = u32(lo);

  if (hi == lo) {
    out.lo = maxA | (minA << 8u);
    out.hi = 0u;
    return out;
  }

  let span = hi - lo;
  var low24: u32 = 0u;
  var high24: u32 = 0u;

  for (var i: u32 = 0u; i < 16u; i = i + 1u) {
    let t = u32(roundHalfUp((hi - texels[i].a) * 7.0 / span));
    var index: u32 = t + 1u;
    if (t == 0u) {
      index = 0u;
    } else if (t == 7u) {
      index = 1u;
    }
    if (i < 8u) {
      low24 = low24 | (index << (3u * i));
    } else {
      high24 = high24 | (index << (3u * (i - 8u)));
    }
  }

  // Bytes 0 and 1 are the endpoints; bytes 2..7 are the 48 index bits.
  out.lo = maxA | (minA << 8u) | ((low24 & 0xffffu) << 16u);
  out.hi = ((low24 >> 16u) & 0xffu) | (high24 << 8u);
  return out;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let bx = gid.x;
  let by = gid.y;
  if (bx >= params.blocksWide || by >= params.blocksHigh) {
    return;
  }

  gatherBlock(bx, by);

  let index = by * params.blocksWide + bx;
  if (params.mode == MODE_DXT1) {
    let color = fitColorBlock();
    blocks[index * 2u] = color.lo;
    blocks[index * 2u + 1u] = color.hi;
  } else {
    let alpha = fitAlphaBlock();
    let color = fitColorBlock();
    blocks[index * 4u] = alpha.lo;
    blocks[index * 4u + 1u] = alpha.hi;
    blocks[index * 4u + 2u] = color.lo;
    blocks[index * 4u + 3u] = color.hi;
  }
}
