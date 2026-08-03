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
  const hue = lerp(220, 0, t);
  const light = lerp(38, 55, t);
  return `hsl(${hue.toFixed(0)}, 70%, ${light.toFixed(0)}%)`;
}

// Blackbody-ish star colour from mass (bigger = hotter/bluer).
function starColor(mass) {
  const t = clamp((mass - 0.3) / 3.2, 0, 1);
  const hue = lerp(35, 210, t);          // red-orange -> white-blue
  const light = lerp(60, 82, t);
  const sat = lerp(85, 65, t);
  return `hsl(${hue.toFixed(0)}, ${sat.toFixed(0)}%, ${light.toFixed(0)}%)`;
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
};
