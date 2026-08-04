/*
 * utils.js — Small math / RNG helpers shared across the simulation.
 */

// Deterministic, seedable PRNG (mulberry32). Returns a function -> [0,1).
function makeRNG(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Global RNG used by evolution & scattering. Re-seedable for reproducibility.
let RNG = makeRNG(0xC0FFEE);
function reseed(seed) { RNG = makeRNG(seed >>> 0); }

// Standard-normal sample via Box-Muller (uses global RNG).
function gaussian(mean = 0, std = 1) {
  const u = 1 - RNG();
  const v = RNG();
  return mean + std * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (edge0, edge1, x) => {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

// Map a scalar in [lo,hi] to an HSL colour string sweeping cold(blue)->hot(red).
function tempColor(tempC, lo = -40, hi = 70) {
  const t = clamp((tempC - lo) / (hi - lo), 0, 1);
  // hue 220 (cold blue) -> 0 (hot red)
  const hue = lerp(214, 8, t);
  const light = lerp(52, 62, t);
  return `hsl(${hue.toFixed(0)}, 48%, ${light.toFixed(0)}%)`;
}

// Blackbody star colour from mass. Interpolated through real stellar-class
// RGB stops (M -> K -> G -> F -> A -> B): a blackbody locus never passes
// through green, so an HSL hue sweep would be physically wrong as well as ugly.
const STAR_STOPS = [
  [255, 180, 107],   // M  cool red-orange
  [255, 214, 170],   // K  orange
  [255, 244, 232],   // G  sun-like warm white
  [248, 247, 255],   // F  white
  [213, 224, 255],   // A  blue-white
  [170, 195, 255],   // B  blue
];
function starColor(mass) {
  const t = clamp((mass - 0.25) / 2.6, 0, 1) * (STAR_STOPS.length - 1);
  const i = Math.min(Math.floor(t), STAR_STOPS.length - 2);
  const f = t - i;
  const a = STAR_STOPS[i], b = STAR_STOPS[i + 1];
  return `rgb(${Math.round(lerp(a[0], b[0], f))}, ${Math.round(lerp(a[1], b[1], f))}, ${Math.round(lerp(a[2], b[2], f))})`;
}
// Same colour with an explicit alpha, for glow gradients.
function starColorA(mass, alpha) {
  return starColor(mass).replace('rgb(', 'rgba(').replace(')', `, ${alpha})`);
}

// Fixed-size ring buffer for time-series history (temperature, population...).
class History {
  constructor(size) { this.size = size; this.data = new Float64Array(size); this.n = 0; this.head = 0; }
  push(v) {
    this.data[this.head] = v;
    this.head = (this.head + 1) % this.size;
    if (this.n < this.size) this.n++;
  }
  // iterate oldest -> newest, calling fn(value, index)
  forEach(fn) {
    for (let i = 0; i < this.n; i++) {
      const idx = (this.head - this.n + i + this.size * 2) % this.size;
      fn(this.data[idx], i);
    }
  }
  last() { return this.n ? this.data[(this.head - 1 + this.size) % this.size] : 0; }
  min() { let m = Infinity; this.forEach(v => { if (v < m) m = v; }); return m === Infinity ? 0 : m; }
  max() { let m = -Infinity; this.forEach(v => { if (v > m) m = v; }); return m === -Infinity ? 0 : m; }
}

// Format helpers for the HUD.
const fmt = {
  temp: (c) => `${c >= 0 ? '' : ''}${c.toFixed(1)}°C`,
  int: (n) => Math.round(n).toLocaleString(),
  sci: (n) => Math.abs(n) < 1e-3 || Math.abs(n) > 1e4 ? n.toExponential(2) : n.toFixed(3),
  pct: (x) => `${(x * 100).toFixed(0)}%`,
  // Populations run from dozens to billions, so give them readable magnitudes.
  people: (n) => {
    if (n < 1) return '0';
    if (n < 1e3) return Math.round(n).toString();
    if (n < 1e6) return `${(n / 1e3).toFixed(n < 1e4 ? 1 : 0)}k`;
    if (n < 1e9) return `${(n / 1e6).toFixed(n < 1e7 ? 2 : 1)} million`;
    if (n < 1e12) return `${(n / 1e9).toFixed(n < 1e10 ? 2 : 1)} billion`;
    return `${(n / 1e12).toFixed(2)} trillion`;
  },
};

// Sky colour for the surface view, interpolated through hand-picked stops:
// frozen blue -> temperate blue-grey -> scorched red. Interpolating hue in HSL
// would swing through olive/green, which never looks like a sky.
const SKY_STOPS = [
  [-60, [20, 30, 52]],    // deep freeze
  [-20, [38, 58, 88]],    // cold
  [ 12, [78, 106, 138]],  // temperate
  [ 40, [128, 104, 92]],  // warm, dusty
  [ 75, [150, 68, 46]],   // scorching
  [120, [96, 30, 26]],    // hellish
];
function skyColor(tempC, mul = 1) {
  let a = SKY_STOPS[0], b = SKY_STOPS[SKY_STOPS.length - 1];
  for (let i = 0; i < SKY_STOPS.length - 1; i++) {
    if (tempC >= SKY_STOPS[i][0] && tempC <= SKY_STOPS[i + 1][0]) { a = SKY_STOPS[i]; b = SKY_STOPS[i + 1]; break; }
    if (tempC < SKY_STOPS[0][0]) { a = b = SKY_STOPS[0]; break; }
    if (tempC > SKY_STOPS[SKY_STOPS.length - 1][0]) { a = b = SKY_STOPS[SKY_STOPS.length - 1]; break; }
  }
  const span = b[0] - a[0];
  const f = span === 0 ? 0 : clamp((tempC - a[0]) / span, 0, 1);
  const r = Math.round(lerp(a[1][0], b[1][0], f) * mul);
  const g = Math.round(lerp(a[1][1], b[1][1], f) * mul);
  const bl = Math.round(lerp(a[1][2], b[1][2], f) * mul);
  return `rgb(${r}, ${g}, ${bl})`;
}
