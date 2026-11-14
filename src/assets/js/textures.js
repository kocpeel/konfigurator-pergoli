// Textures drawn in code: deck boards, plaster, grass, wood, powder coating, fabric, rug and roof.
// Nothing is downloaded, and fixed seeds make every load and screenshot look the same.
// Every texture tiles seamlessly. Its size in metres is set in scene.js through `repeat`.
import * as THREE from 'three';

function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

// Value noise on a grid that wraps around, so the texture has no seams. u and v run from 0 to 1.
function noise(cellsX, cellsY, next) {
  const grid = new Float32Array(cellsX * cellsY);
  for (let index = 0; index < grid.length; index += 1) grid[index] = next();
  return (u, v) => {
    const x = u * cellsX;
    const y = v * cellsY;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    let tx = x - x0;
    let ty = y - y0;
    tx = tx * tx * (3 - 2 * tx);
    ty = ty * ty * (3 - 2 * ty);
    const xa = ((x0 % cellsX) + cellsX) % cellsX;
    const ya = ((y0 % cellsY) + cellsY) % cellsY;
    const xb = (xa + 1) % cellsX;
    const yb = (ya + 1) % cellsY;
    const a = grid[ya * cellsX + xa];
    const b = grid[ya * cellsX + xb];
    const c = grid[yb * cellsX + xa];
    const d = grid[yb * cellsX + xb];
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
  };
}

// Several octaves of noise, each twice as fine and half as strong. Returns values between 0 and 1.
function fractal(cellsX, cellsY, octaves, next) {
  const layers = Array.from({ length: octaves }, (_, octave) => noise(cellsX << octave, cellsY << octave, next));
  return (u, v) => {
    let sum = 0;
    let weight = 0.5;
    let total = 0;
    for (const layer of layers) {
      sum += layer(u, v) * weight;
      total += weight;
      weight *= 0.5;
    }
    return sum / total;
  };
}

function blank(size) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  const image = context.createImageData(size, size);
  return { canvas, context, image, data: image.data };
}

function texture(canvas, { color = false, anisotropy = 1, metres = 1 } = {}) {
  const map = new THREE.CanvasTexture(canvas);
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  map.anisotropy = anisotropy;
  map.repeat.set(1 / metres, 1 / metres);
  return map;
}

// Fills a canvas pixel by pixel. `shade` gets u, v and pixel coordinates and writes r, g, b (0–1) into `out`.
function paint(size, shade) {
  const target = blank(size);
  const out = [0, 0, 0];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      shade(x / size, y / size, x, y, out);
      const index = (y * size + x) * 4;
      target.data[index] = out[0] * 255;
      target.data[index + 1] = out[1] * 255;
      target.data[index + 2] = out[2] * 255;
      target.data[index + 3] = 255;
    }
  }
  target.context.putImageData(target.image, 0, 0);
  return target.canvas;
}

// Turns a height field into a tangent-space normal map (OpenGL convention, as three.js expects).
function normalCanvas(height, size, strength) {
  const target = blank(size);
  for (let y = 0; y < size; y += 1) {
    const row = y * size;
    const up = ((y - 1 + size) % size) * size;
    const down = ((y + 1) % size) * size;
    for (let x = 0; x < size; x += 1) {
      const left = (x - 1 + size) % size;
      const right = (x + 1) % size;
      const nx = (height[row + left] - height[row + right]) * strength;
      const ny = (height[down + x] - height[up + x]) * strength;
      const scale = 1 / Math.sqrt(nx * nx + ny * ny + 1);
      const index = (row + x) * 4;
      target.data[index] = (nx * scale * 0.5 + 0.5) * 255;
      target.data[index + 1] = (ny * scale * 0.5 + 0.5) * 255;
      target.data[index + 2] = (scale * 0.5 + 0.5) * 255;
      target.data[index + 3] = 255;
    }
  }
  target.context.putImageData(target.image, 0, 0);
  return target.canvas;
}

const smooth = (edge0, edge1, value) => {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

// Composite deck boards: 16 boards per tile with gaps, staggered board ends, colour variation and brushed grooves.
export function deck(anisotropy) {
  const size = 512;
  const rows = 16;
  const rowPx = size / rows;
  const gapPx = 2;
  const next = random(11);
  const grain = fractal(3, 48, 3, next);
  const fine = fractal(64, 64, 2, next);
  const joints = Array.from({ length: rows }, () => Math.floor(next() * size));
  const tints = Array.from({ length: rows * 2 }, () => (next() - 0.5) * 0.14);
  const height = new Float32Array(size * size);
  const rough = new Float32Array(size * size);
  const map = paint(size, (u, v, x, y, out) => {
    const row = Math.floor(y / rowPx);
    const inRow = y % rowPx;
    const fromJoint = Math.min(Math.abs(x - joints[row]), size - Math.abs(x - joints[row]));
    const index = y * size + x;
    if (inRow < gapPx || fromJoint < 1.5) {
      out[0] = 0.11;
      out[1] = 0.1;
      out[2] = 0.09;
      height[index] = 0;
      rough[index] = 1;
      return;
    }
    const edge = smooth(0, 3, Math.min(inRow - gapPx, rowPx - 1 - inRow)) * smooth(1.5, 4, fromJoint);
    const brushed = 0.5 + 0.5 * Math.sin(((inRow - gapPx) / (rowPx - gapPx)) * Math.PI * 2 * 7);
    const g = grain(u, v);
    const f = fine(u, v);
    const tint = tints[row * 2 + (x < joints[row] ? 0 : 1)];
    const shade = (1 + tint + (g - 0.5) * 0.32 + (f - 0.5) * 0.08 - (1 - brushed) * 0.035) * (0.82 + 0.18 * edge);
    out[0] = 0.55 * shade;
    out[1] = 0.49 * shade;
    out[2] = 0.43 * shade;
    height[index] = edge * (0.85 + brushed * 0.06 + g * 0.05);
    rough[index] = 0.66 + (f - 0.5) * 0.25;
  });
  const roughness = paint(size, (u, v, x, y, out) => {
    const value = rough[y * size + x];
    out[0] = value;
    out[1] = value;
    out[2] = value;
  });
  const metres = 2.08;
  return {
    map: texture(map, { color: true, anisotropy, metres }),
    normal: texture(normalCanvas(height, size, 6), { anisotropy, metres }),
    roughness: texture(roughness, { anisotropy, metres }),
  };
}

// Off-white mineral plaster with fine grain and faint patches.
export function plaster(anisotropy) {
  const size = 256;
  const next = random(21);
  const fine = fractal(64, 64, 2, next);
  const patches = fractal(4, 4, 3, next);
  const height = new Float32Array(size * size);
  const map = paint(size, (u, v, x, y, out) => {
    const f = fine(u, v);
    const shade = 0.975 + (patches(u, v) - 0.5) * 0.05 + (f - 0.5) * 0.05;
    height[y * size + x] = f;
    out[0] = 0.93 * shade;
    out[1] = 0.915 * shade;
    out[2] = 0.89 * shade;
  });
  const metres = 0.6;
  return {
    map: texture(map, { color: true, anisotropy, metres }),
    normal: texture(normalCanvas(height, size, 1.6), { anisotropy, metres }),
  };
}

// Lawn: muted greens mixed by blade speckle and small clumps. Larger colour changes come from the
// lawn's vertex colours, so the tiling does not show as a repeating pattern.
export function grass(anisotropy) {
  const size = 256;
  const next = random(31);
  const clumps = fractal(16, 16, 2, next);
  const blades = fractal(96, 96, 1, next);
  const height = new Float32Array(size * size);
  const map = paint(size, (u, v, x, y, out) => {
    const b = blades(u, v);
    const mix = b * 0.7 + clumps(u, v) * 0.3;
    height[y * size + x] = b;
    out[0] = 0.32 + mix * 0.17;
    out[1] = 0.39 + mix * 0.17;
    out[2] = 0.22 + mix * 0.1;
  });
  const metres = 0.8;
  return {
    map: texture(map, { color: true, anisotropy, metres }),
    normal: texture(normalCanvas(height, size, 3), { anisotropy, metres }),
  };
}

// Straight-grained oak along u, like a wood-effect print: the wood-effect frame colour and the table top.
export function wood(anisotropy) {
  const size = 256;
  const next = random(41);
  const bands = fractal(2, 18, 3, next);
  const fibre = fractal(4, 112, 1, next);
  const height = new Float32Array(size * size);
  const map = paint(size, (u, v, x, y, out) => {
    const f = fibre(u, v);
    const dark = smooth(0.38, 0.72, bands(u, v)) * 0.32 + smooth(0.45, 0.85, f) * 0.6;
    height[y * size + x] = 1 - f;
    out[0] = 0.72 - dark * 0.2;
    out[1] = 0.51 - dark * 0.16;
    out[2] = 0.32 - dark * 0.11;
  });
  const metres = 1;
  return {
    map: texture(map, { color: true, anisotropy, metres }),
    normal: texture(normalCanvas(height, size, 1.5), { anisotropy, metres }),
  };
}

// The fine texture of a powder-coated aluminium profile (a normal map only).
export function powder(anisotropy) {
  const size = 256;
  const next = random(51);
  const grain = fractal(48, 48, 3, next);
  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) height[y * size + x] = grain(x / size, y / size);
  }
  return texture(normalCanvas(height, size, 2), { anisotropy, metres: 0.25 });
}

// A plain weave: threads go over and under each other. Used for screen fabric and cushions.
export function fabric(anisotropy) {
  const size = 256;
  const threads = 32;
  const next = random(61);
  const variation = Array.from({ length: threads * 2 }, () => (next() - 0.5) * 0.08);
  const height = new Float32Array(size * size);
  const map = paint(size, (u, v, x, y, out) => {
    const tx = u * threads;
    const ty = v * threads;
    const ix = Math.floor(tx);
    const iy = Math.floor(ty);
    const fx = tx - ix;
    const fy = ty - iy;
    const over = (ix + iy) % 2 === 0;
    const bump = over ? Math.sin(Math.PI * fx) * (0.7 + 0.3 * Math.sin(Math.PI * fy)) : Math.sin(Math.PI * fy) * (0.7 + 0.3 * Math.sin(Math.PI * fx));
    height[y * size + x] = bump;
    const shade = 0.82 + bump * 0.18 + (over ? variation[ix] : variation[threads + iy]);
    out[0] = shade;
    out[1] = shade;
    out[2] = shade;
  });
  return {
    map: texture(map, { color: true, anisotropy, metres: 0.06 }),
    normal: texture(normalCanvas(height, size, 1.2), { anisotropy, metres: 0.06 }),
  };
}

// An outdoor rug: sand-coloured weave with charcoal stripes near the ends.
export function rug(anisotropy) {
  const size = 512;
  const next = random(71);
  const weave = fractal(128, 128, 1, next);
  const map = paint(size, (u, v, x, y, out) => {
    const stripe = (v > 0.08 && v < 0.12) || (v > 0.88 && v < 0.92) || (v > 0.16 && v < 0.175) || (v > 0.825 && v < 0.84);
    const border = u < 0.03 || u > 0.97 || v < 0.03 || v > 0.97;
    const shade = 0.92 + (weave(u, v) - 0.5) * 0.2;
    const base = stripe || border ? [0.3, 0.29, 0.27] : [0.76, 0.71, 0.62];
    out[0] = base[0] * shade;
    out[1] = base[1] * shade;
    out[2] = base[2] * shade;
  });
  const result = texture(map, { color: true, anisotropy });
  result.wrapS = THREE.ClampToEdgeWrapping;
  result.wrapT = THREE.ClampToEdgeWrapping;
  return result;
}

// A standing-seam metal roof: a raised seam every 50 cm along the slope.
export function roof(anisotropy) {
  const size = 256;
  const next = random(81);
  const streaks = fractal(4, 32, 2, next);
  const height = new Float32Array(size * size);
  const map = paint(size, (u, v, x, y, out) => {
    const seam = Math.min(Math.abs(u - 0.25), Math.abs(u - 0.75));
    const ridge = 1 - smooth(0.004, 0.012, seam);
    height[y * size + x] = ridge;
    const shade = 0.95 + (streaks(u, v) - 0.5) * 0.08 + ridge * 0.08;
    out[0] = 0.24 * shade;
    out[1] = 0.25 * shade;
    out[2] = 0.27 * shade;
  });
  return {
    map: texture(map, { color: true, anisotropy }),
    normal: texture(normalCanvas(height, size, 12), { anisotropy }),
  };
}

// Soft contact shadows: a round blob and a strip that fades out from one edge.
export function contactShadows() {
  const size = 128;
  const round = document.createElement('canvas');
  round.width = size;
  round.height = size;
  const roundContext = round.getContext('2d');
  const radial = roundContext.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  radial.addColorStop(0, '#ffffff');
  radial.addColorStop(0.45, '#a0a0a0');
  radial.addColorStop(1, '#000000');
  roundContext.fillStyle = radial;
  roundContext.fillRect(0, 0, size, size);

  const strip = document.createElement('canvas');
  strip.width = 4;
  strip.height = size;
  const stripContext = strip.getContext('2d');
  const linear = stripContext.createLinearGradient(0, 0, 0, size);
  linear.addColorStop(0, '#ffffff');
  linear.addColorStop(0.35, '#707070');
  linear.addColorStop(1, '#000000');
  stripContext.fillStyle = linear;
  stripContext.fillRect(0, 0, 4, size);

  const make = (canvas) => {
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.NoColorSpace;
    return map;
  };
  return { round: make(round), strip: make(strip) };
}
