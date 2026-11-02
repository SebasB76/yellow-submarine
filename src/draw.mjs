import gifenc from 'gifenc';

// gifenc ships CommonJS as its main entry, so named ESM imports fail.
const { GIFEncoder, applyPalette, quantize } = gifenc;

// A 3:1 strip fills a README's width without growing tall.
export const WIDTH = 192;
export const HEIGHT = 64;
export const FRAMES = 96;
const FRAME_DELAY_MS = 90;
// The submarine leaves the strip fully before it re-enters, so the loop seam is hidden.
const TRAVEL_MARGIN = 40;
const TAU = Math.PI * 2;
const STRIPES = ['#e63946', '#2a9d8f', '#f4a261', '#9b5de5', '#3a86ff'];
const YELLOW = '#f7d117';
const OUTLINE = '#6b5200';
const Z_GLYPH = ['####', '..#.', '.#..', '####'];
const NOTE_GLYPH = ['..##', '..#.', '..#.', '###.', '##..'];
const PORTHOLE_GLYPH = ['.##.', '#..#', '#..#', '.##.'];
const BUBBLE_GLYPH = ['.#.', '#.#', '.#.'];
const WINDOW_LIGHT = '#ffd66b';
const AMBIENTS = {
  morning: { stops: ['#5cc0e6', '#2a8fbf', '#0f4f73'], sand: ['#dcbd7e', '#a8894f'], ray: '#ffffff', rayStrength: 0.22 },
  afternoon: { stops: ['#f4a65c', '#3f7f8f', '#10304a'], sand: ['#c99a62', '#8a6a3e'], ray: '#ffd27a', rayStrength: 0.28 },
  night: { stops: ['#123056', '#071a33', '#020a16'], sand: ['#5e5a4a', '#3a3729'], ray: null, rayStrength: 0 },
};
const SEABED_Y = 58;

// One keepsake per Beatle, unlocked in this order; each row maps letters to colors.
const BEATLE_KEEPSAKES = [
  {
    name: 'john-glasses', x: 22, y: 59,
    colors: { g: '#d4af37', l: '#9fd8e8' },
    rows: ['.gg...gg.', 'gllgggllg', 'gllg.gllg', '.gg...gg.'],
  },
  {
    name: 'paul-violin-bass', x: 56, y: 50,
    colors: { n: '#3b2414', b: '#8b4a2b', c: '#d98c4a' },
    rows: ['..n..', '.nnn.', '..n..', '..n..', '..n..', '..n..', '.bnb.', 'bbcbb', '.bcb.', 'bbcbb', 'bbcbb', '.bbb.'],
  },
  {
    name: 'george-sitar', x: 134, y: 45,
    colors: { n: '#6b3e1f', f: '#e0c068', g: '#c98a3a', d: '#8a5a24' },
    rows: ['..g..', '.ggg.', '..n..', '..f..', '..n..', '..f..', '..n..', '..f..', '..n..', '..f..', '..n..', '.ggg.', 'ggggg', 'ggggd', 'gggdd', '.ddd.'],
  },
  {
    name: 'ringo-bass-drum', x: 162, y: 55,
    colors: { r: '#2b2b2b', h: '#f1ecdc', k: '#c0392b' },
    rows: ['..rrr..', '.rhhhr.', 'rhhhhhr', 'rhkkkhr', 'rhhhhhr', '.rhhhr.', '..rrr..'],
  },
];

const toRgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const toHex = rgb => '#' + rgb.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const mix = (a, b, t) => { const A = toRgb(a), B = toRgb(b); return toHex(A.map((v, i) => v + (B[i] - v) * t)); };
const shade = (hex, amount) => amount < 0 ? mix(hex, '#000000', -amount) : mix(hex, '#ffffff', amount);

function hash(x, y, salt = 0) {
  let n = (x * 374761393 + y * 668265263 + salt * 1442695041) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

function createCanvas() {
  const pixels = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  const px = (x, y, hex) => {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return;
    const [r, g, b] = toRgb(hex);
    const i = (y * WIDTH + x) * 4;
    pixels[i] = r; pixels[i + 1] = g; pixels[i + 2] = b; pixels[i + 3] = 255;
  };
  const rect = (x, y, w, h, hex) => {
    for (let j = 0; j < Math.round(h); j++) for (let i = 0; i < Math.round(w); i++) px(Math.round(x) + i, Math.round(y) + j, hex);
  };
  const inEllipse = (x, y, cx, cy, rx, ry) => { const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry; return dx * dx + dy * dy <= 1; };
  const fill = (inside, color) => {
    for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) {
      if (!inside(x, y)) continue;
      const edge = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
      const hex = color(x, y, edge);
      if (hex) px(x, y, hex);
    }
  };
  const glyph = (rows, x, y, hex) => rows.forEach((row, j) => [...row].forEach((ch, i) => { if (ch === '#') px(x + i, y + j, hex); }));
  const gradient = (top, bottom, from, to) => { for (let y = from; y < to; y++) rect(0, y, WIDTH, 1, mix(top, bottom, (y - from) / (to - from))); };
  return { pixels, px, rect, inEllipse, fill, glyph, gradient };
}

function drawWater(p, ambientName, frame) {
  const ambient = AMBIENTS[ambientName];
  const [top, middle, bottom] = ambient.stops;
  const rayShift = (frame / FRAMES) * 16;
  for (let y = 0; y < SEABED_Y; y++) {
    const t = y / SEABED_Y;
    const base = t < 0.4 ? mix(top, middle, t / 0.4) : mix(middle, bottom, (t - 0.4) / 0.6);
    for (let x = 0; x < WIDTH; x++) {
      let hex = base;
      // Sun rays slant down and fade with depth; the shift spans one ray period per loop.
      if (ambient.ray && y < 44 && (x + y * 0.5 + rayShift) % 16 < 3) hex = mix(hex, ambient.ray, ambient.rayStrength * (1 - y / 44));
      p.px(x, y, hex);
    }
  }
  p.gradient(ambient.sand[0], ambient.sand[1], SEABED_Y, HEIGHT);
  if (ambientName === 'night') {
    p.fill((x, y) => p.inEllipse(x, y, 172, 8, 4, 4), (x, y, edge) => edge ? '#b9c2b0' : (hash(x, y, 9) < 0.2 ? '#cfd6c4' : '#eef2e0'));
    for (let i = 0; i < 44; i++) {
      const x = Math.floor(hash(i, 1, 11) * WIDTH), y = 4 + Math.floor(hash(i, 2, 11) * 50);
      const lit = (frame + i * 5) % 16 < 8;
      p.px(x, y, lit ? '#7ff7ff' : '#1d5a6a');
    }
  }
}

function drawKeepsakes(p, count, ambientName) {
  const darken = ambientName === 'night' ? -0.2 : 0;
  for (const keepsake of BEATLE_KEEPSAKES.slice(0, count)) {
    keepsake.rows.forEach((row, j) => [...row].forEach((ch, i) => {
      const hex = keepsake.colors[ch];
      if (hex) p.px(keepsake.x + i, keepsake.y + j, darken ? shade(hex, darken) : hex);
    }));
  }
}

// Every periodic motion divides FRAMES, so the GIF loops without a jump.
export function drawFrame(submarine, frame) {
  const p = createCanvas();
  const s = submarine.stage, activity = submarine.activity;
  const phase = frame / FRAMES;

  drawWater(p, submarine.ambient, frame);
  [8, 40, 84, 110, 148, 184].forEach((baseX, j) => {
    for (let k = 0; k < 7 + (j * 3) % 6; k++) {
      p.px(baseX + Math.round(Math.sin(TAU * phase * 2 + k * 0.5 + j)), 57 - k, k % 2 ? '#2f8f5b' : '#257349');
    }
  });

  const rx = 12 + s * 2.5, ry = 5 + s * 1.2;
  const crossings = activity === 2 ? 2 : 1, span = WIDTH + 2 * TRAVEL_MARGIN;
  const cx = activity === 0 ? WIDTH / 2 : Math.round((phase * crossings * span) % span) - TRAVEL_MARGIN;
  const cy = activity === 0 ? 57 - ry : 30 + Math.round(Math.sin(TAU * phase * 4));

  const towerX = cx - 3, towerTop = cy - ry - 4;
  const scopeHeight = 2 + Math.round(s * 2), scopeX = cx + 2, scopeTop = towerTop - scopeHeight;
  p.rect(scopeX, scopeTop, 1, scopeHeight, '#c9a300');
  p.rect(scopeX, scopeTop, 4, 1, '#c9a300');
  p.fill(
    (x, y) => x >= towerX && x < towerX + 9 && y >= towerTop && y < cy - ry + 2,
    (x, y, edge) => edge ? OUTLINE : (x < towerX + 3 ? shade(YELLOW, 0.25) : YELLOW),
  );
  const finX = cx - rx + 3;
  p.fill((x, y) => x >= finX - 2 && x <= finX + 1 && y >= cy - ry - 3 && y < cy - ry + 2, (x, y, edge) => edge ? OUTLINE : YELLOW);

  p.fill((x, y) => p.inEllipse(x, y, cx, cy, rx, ry), (x, y, edge) => {
    if (edge) return OUTLINE;
    let hex = YELLOW;
    const stripe = y - Math.round(cy + 2);
    if (stripe >= 0 && stripe < submarine.stripes) hex = STRIPES[stripe];
    if (y > cy + ry * 0.55) hex = shade(hex, -0.22);
    if (y < cy - ry * 0.55 && x < cx) hex = shade(hex, 0.35);
    if (hash(x, y, 5) < 0.05) hex = shade(hex, 0.2);
    return hex;
  });

  const portholes = Math.floor(s) + 1, spacing = (rx * 1.3) / portholes;
  for (let i = 0; i < portholes; i++) {
    const hx = Math.round(cx - rx * 0.65 + spacing * (i + 0.5)), hy = Math.round(cy - 3);
    const blink = activity === 2 && (frame + i) % 6 < 3;
    const glow = activity === 0 ? shade(WINDOW_LIGHT, -0.6) : shade(WINDOW_LIGHT, blink ? 0.45 : 0);
    p.glyph(PORTHOLE_GLYPH, hx, hy, OUTLINE);
    p.rect(hx + 1, hy + 1, 2, 2, glow);
  }

  const propX = Math.round(cx - rx - 1);
  p.px(propX, cy, '#555555');
  p.px(propX - 1, cy, '#8c8c8c');
  const spin = activity === 0 ? 0 : Math.floor(frame / (activity === 2 ? 1 : 3)) % 2;
  if (spin) p.rect(propX - 2, cy - 1, 1, 3, '#d9d9d9');
  else p.rect(propX - 2, cy - 3, 1, 7, '#d9d9d9');

  if (activity > 0) {
    for (let i = 0; i < activity * 4; i++) {
      const life = (frame + i * 7) % 24;
      const bx = propX - 3 - life * 0.5 + Math.sin(life * 0.5 + i), by = cy - life * 0.9;
      if (i % 3 === 0) p.glyph(BUBBLE_GLYPH, bx, by, '#bfe9ff');
      else p.px(bx, by, '#9fdcff');
    }
  }
  if (activity === 2) {
    for (let i = 0; i < 2; i++) {
      const life = (frame + i * 12) % 24;
      p.glyph(NOTE_GLYPH, scopeX + 5 + life * 0.35, scopeTop - 2 - life * 0.6, STRIPES[(i * 2 + Math.floor(frame / 24)) % STRIPES.length]);
    }
  }
  if (activity === 0) {
    for (let i = 0; i < 2; i++) {
      const life = (frame * 0.5 + i * 6) % 12;
      p.glyph(Z_GLYPH, scopeX + 4 + life * 0.4 + i * 3, scopeTop - 2 - life, mix('#ffffff', '#6b7c8f', life / 12));
    }
  }
  drawKeepsakes(p, submarine.keepsakes, submarine.ambient);
  return p.pixels;
}

function upscale(pixels, scale) {
  const width = WIDTH * scale, height = HEIGHT * scale;
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const from = (Math.floor(y / scale) * WIDTH + Math.floor(x / scale)) * 4, to = (y * width + x) * 4;
    out.set(pixels.subarray(from, from + 4), to);
  }
  return out;
}

export function encodeGif(submarine, scale) {
  const frames = Array.from({ length: FRAMES }, (_, frame) => drawFrame(submarine, frame));
  // One palette for the whole loop keeps colors from flickering between frames.
  const all = new Uint8ClampedArray(frames.length * frames[0].length);
  frames.forEach((frame, i) => all.set(frame, i * frame.length));
  const palette = quantize(all, 256);
  const gif = GIFEncoder();
  frames.forEach(frame => {
    const scaled = upscale(frame, scale);
    gif.writeFrame(applyPalette(scaled, palette), WIDTH * scale, HEIGHT * scale, { palette, delay: FRAME_DELAY_MS, repeat: 0 });
  });
  gif.finish();
  return gif.bytes();
}
