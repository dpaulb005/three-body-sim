/*
 * geography.js — The world as a place rather than as a number.
 *
 * Until this existed a planet had exactly one temperature, which made every
 * world a single pixel: a "hot" world was uniformly lethal and a "cold" one was
 * uniformly dead. Real planets are not like that. Earth's mean temperature is
 * 15°C and almost nobody lives at 15°C — people live in a band, and the band
 * moves. A world 40° hotter than ours is not sterile; its tropics are, and its
 * poles are Mediterranean.
 *
 * So the planet is divided into bands and each one gets its own climate:
 *
 *   GEOMETRY       bands are equal-area, cut at uniform intervals of sin(latitude).
 *                  That is exactly right for a sphere, and it has a pleasing
 *                  consequence — under the orthographic projection used to draw
 *                  the globe, equal-area bands are equal-height stripes.
 *
 *   INSOLATION     the annual-mean sunlight at each latitude, integrated
 *                  numerically from the standard daily-insolation formula over
 *                  one orbit. Obliquity is what flattens that curve: a world
 *                  with no axial tilt has frozen poles and a scorched equator,
 *                  and a world tipped on its side is nearly uniform.
 *
 *   REDISTRIBUTION oceans and atmospheres move heat toward the poles. Without
 *                  this term the night side of a tidally locked world would fall
 *                  to absolute zero, which is not what happens, because wind
 *                  happens.
 *
 *   TIDAL LOCK     a locked world has no latitudes worth speaking of, so the
 *                  bands become rings of angular distance from the substellar
 *                  point instead — a bullseye of scorched centre, twilight ring
 *                  and frozen antipode.
 *
 * Everything downstream reads the result: how much of the world is actually
 * habitable is now a measured area rather than a proxy, and the map you look at
 * is drawn from the same numbers the population is living in.
 */

const GEO = {
  bands: 15,          // odd, so there is a true equator
  orbitSamples: 48,   // points per orbit when averaging insolation
};

/*
 * Annual-mean daily insolation by latitude, in units where the global mean is
 * 1/4 (a sphere intercepts pi*r^2 and radiates from 4*pi*r^2).
 *
 * For solar declination d and latitude p the half-day angle is
 *     H = acos(-tan(p) tan(d))
 * and the daily mean insolation is
 *     (1/pi) * (H sin(p) sin(d) + cos(p) cos(d) sin(H))
 * which is integrated over the orbit. Cached per (obliquity, band count),
 * because it depends on nothing that changes frame to frame.
 */
const _insolationCache = new Map();
function insolationByBand(obliquityDeg, n) {
  const key = `${Math.round(obliquityDeg * 2)}:${n}`;
  const hit = _insolationCache.get(key);
  if (hit) return hit;

  const eps = obliquityDeg * Math.PI / 180;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    // Equal-area bands: sin(latitude) is uniform across [-1, 1].
    const sinLat = -1 + (2 * i + 1) / n;
    const lat = Math.asin(clamp(sinLat, -1, 1));
    let sum = 0;
    for (let m = 0; m < GEO.orbitSamples; m++) {
      const decl = Math.asin(Math.sin(eps) * Math.sin(2 * Math.PI * m / GEO.orbitSamples));
      const cosH = clamp(-Math.tan(lat) * Math.tan(decl), -1, 1);
      const H = Math.acos(cosH);
      sum += (H * Math.sin(lat) * Math.sin(decl)
        + Math.cos(lat) * Math.cos(decl) * Math.sin(H)) / Math.PI;
    }
    out[i] = Math.max(sum / GEO.orbitSamples, 0);
  }
  _insolationCache.set(key, out);
  return out;
}

/** The same thing for a locked world: bands are rings around the substellar point. */
const _lockedCache = new Map();
function insolationLocked(n) {
  const hit = _lockedCache.get(n);
  if (hit) return hit;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    // Equal-area rings: cos(angle from substellar point) uniform across [1, -1].
    const cosT = 1 - (2 * i + 1) / n;
    out[i] = Math.max(cosT, 0);
  }
  _lockedCache.set(n, out);
  return out;
}

// What a band looks like, from its own temperature and the world's water.
function bandBiome(tempC, hydrosphere, geothermal) {
  if (geothermal > 0.3 && hydrosphere === 'ice') return 'vent';
  if (tempC > 220) return 'molten';
  if (hydrosphere === 'ocean') return tempC < -2 ? 'packice' : tempC > 40 ? 'warmsea' : 'ocean';
  if (hydrosphere === 'ice') return tempC > 4 ? 'meltwater' : 'glacier';
  if (tempC < -14) return 'icecap';
  if (tempC < 2) return 'tundra';
  if (tempC > 62) return 'scorched';
  if (tempC > 38) return 'desert';
  if (tempC > 24) return 'tropical';
  return 'temperate';
}

const BIOME_LABEL = {
  molten: 'Molten', vent: 'Vent field', packice: 'Pack ice', ocean: 'Ocean',
  warmsea: 'Warm sea', glacier: 'Glacier', meltwater: 'Meltwater', icecap: 'Ice cap',
  tundra: 'Tundra', scorched: 'Scorched', desert: 'Desert', tropical: 'Tropical',
  temperate: 'Temperate',
};

// Colours are the map's whole vocabulary, so they are picked to read at a
// glance rather than to be pretty: ice is bright, dead heat is red, and the
// liveable middle is green.
const BIOME_COLOR = {
  molten:    [150, 44, 24],
  scorched:  [138, 74, 52],
  desert:    [176, 142, 88],
  tropical:  [62, 122, 46],
  temperate: [96, 142, 78],
  tundra:    [140, 136, 112],
  icecap:    [226, 238, 248],
  glacier:   [206, 226, 242],
  meltwater: [150, 186, 208],
  packice:   [198, 218, 234],
  ocean:     [34, 84, 132],
  warmsea:   [46, 110, 130],
  vent:      [58, 74, 96],
};

class Geography {
  constructor(n = GEO.bands) {
    this.n = n;
    this.locked = false;
    this.bands = [];
    for (let i = 0; i < n; i++) {
      this.bands.push({
        index: i,
        sinLat: -1 + (2 * i + 1) / n,      // band centre, latitude mode
        cosTheta: 1 - (2 * i + 1) / n,     // band centre, tidally locked mode
        insolation: 0.25,                   // relative to the global mean of 1/4
        tempC: 15,                          // surface temperature in this band
        habitatC: 15,                       // what the niche here actually feels
        biome: 'temperate',
        habitable: false,                   // liveable for anything at all
        settled: false,                     // liveable for THIS species
        area: 1 / n,                        // equal-area by construction
      });
    }
    this.habitableFraction = 0;
    this.settledFraction = 0;
    this.coldestC = 15;
    this.hottestC = 15;
    this.spreadC = 0;
  }

  /** Latitude of a band's centre, in degrees. Meaningless when locked. */
  latitudeOf(band) { return Math.asin(clamp(band.sinLat, -1, 1)) * 180 / Math.PI; }
  /** Angle from the substellar point, in degrees. Only meaningful when locked. */
  angleOf(band) { return Math.acos(clamp(band.cosTheta, -1, 1)) * 180 / Math.PI; }

  /**
   * Recompute every band. `pop` is optional; when present the bands also record
   * whether THIS species could survive there, which is what the census and the
   * map's people markers are drawn from.
   */
  update(climate, profile, pop = null) {
    const n = this.n;
    this.locked = !!profile.tidalLocked;
    const rel = this.locked
      ? insolationLocked(n)
      : insolationByBand(profile.obliquityDeg, n);

    // Radiative temperature per band, from the same calibration the global
    // climate uses, so the two models cannot drift apart.
    const flux = Math.max(climate.flux, 1e-9);
    const raw = new Float64Array(n);
    let mean = 0;
    for (let i = 0; i < n; i++) {
      // rel is normalised to a global mean of 1/4, so 4*rel is the factor by
      // which this band's sunlight differs from the planetary average.
      const bandFlux = Math.max(flux * 4 * rel[i], 1e-12);
      raw[i] = CONFIG.tempScaleK * Math.pow(bandFlux, 0.25) + CONFIG.greenhouseK - 273.15;
      mean += raw[i] / n;
    }

    /*
     * Heat redistribution, as actual diffusion between neighbouring bands.
     *
     * This is the transport term of an energy-balance model, and relaxing it
     * with repeated neighbour-averaging passes is how those models are solved.
     * Doing it properly rather than blending everything toward the global mean
     * matters for two reasons: it produces a smooth gradient instead of a cliff
     * at the terminator, and it lets a band be warmed by its neighbours even
     * when no light reaches it at all — which is why the night side of a locked
     * world is cold rather than at absolute zero. Wind is the mechanism.
     *
     * Calibration: bare rock at Earth's tilt should run about +28°C at the
     * equator and -30°C at the poles, which is roughly our own world. Water
     * moves heat far better, so an ocean world flattens almost to isothermal.
     */
    const water = clamp((profile.thermalBuffer - 1) * 0.13, 0, 0.55);
    // A locked world's day-night contrast is the thing being smoothed, and an
    // atmosphere smooths it hard — otherwise there is no twilight ring to live in.
    const rate = this.locked
      ? clamp(0.42 + water * 0.5, 0, 0.72)
      : clamp(0.055 + water, 0.02, 0.66);
    const DIFFUSION_PASSES = 16;
    const t = Float64Array.from(raw);
    const next = new Float64Array(n);
    for (let pass = 0; pass < DIFFUSION_PASSES; pass++) {
      for (let i = 0; i < n; i++) {
        // Reflecting boundaries: the pole (or the antipode of the substellar
        // point) has nowhere further to send heat.
        const a = t[i > 0 ? i - 1 : 0];
        const b = t[i < n - 1 ? i + 1 : n - 1];
        next[i] = t[i] + rate * ((a + b) / 2 - t[i]);
      }
      t.set(next);
    }

    // Diffusion conserves nothing by itself here, so re-centre onto the global
    // temperature the climate model already computed: the bands describe the
    // SPREAD, and the climate keeps owning the MEAN.
    let diffusedMean = 0;
    for (let i = 0; i < n; i++) diffusedMean += t[i] / n;
    const shift = climate.tempC - diffusedMean;

    let habitable = 0, settled = 0;
    let coldest = Infinity, hottest = -Infinity;
    const optimal = pop && pop.count ? pop.avg('optimalTemp') : null;
    const tolerance = pop && pop.count ? pop.avg('tolerance') : null;
    const [stableLo, stableHi] = CONFIG.stableBandC;

    for (let i = 0; i < n; i++) {
      const b = this.bands[i];
      b.insolation = rel[i] * 4;
      b.tempC = t[i] + shift;
      // The niche adjustments (vents under ice, the terminator of a locked
      // world) apply per band, because that is where they physically are.
      // Only the vent term, never the tidal-lock approximation: the twilight
      // ring is one of these bands, so applying a whole-planet stand-in for it
      // here would be counting the same effect twice.
      b.habitatC = profile.ventAdjustedC(b.tempC);
      b.biome = bandBiome(b.tempC, profile.hydrosphere, profile.geothermal);
      b.habitable = b.habitatC >= stableLo && b.habitatC <= stableHi;
      // Whether this particular biosphere could live here, which is a stricter
      // and much more interesting question than whether anything could.
      b.settled = optimal === null
        ? b.habitable
        : b.habitable && Math.abs(b.habitatC - optimal) <= tolerance;
      if (b.habitable) habitable += b.area;
      if (b.settled) settled += b.area;
      if (b.tempC < coldest) coldest = b.tempC;
      if (b.tempC > hottest) hottest = b.tempC;
    }

    this.habitableFraction = habitable;
    this.settledFraction = settled;
    this.coldestC = coldest;
    this.hottestC = hottest;
    this.spreadC = hottest - coldest;
    return this;
  }

  /** Bands this species can actually live in, warmest first. */
  settledBands() { return this.bands.filter(b => b.settled); }

  /** A tally of how much of the surface is each kind of place. */
  biomeBreakdown() {
    const tally = new Map();
    for (const b of this.bands) tally.set(b.biome, (tally.get(b.biome) || 0) + b.area);
    return [...tally.entries()]
      .map(([biome, area]) => ({ biome, label: BIOME_LABEL[biome] || biome, area }))
      .sort((a, b) => b.area - a.area);
  }

  /** Plain-language summary of where the liveable part of this world is. */
  habitableZoneLabel() {
    const live = this.bands.filter(b => b.habitable);
    if (!live.length) return 'Nowhere — no part of this world is survivable';
    if (live.length === this.n) return 'The entire surface';
    if (this.locked) {
      const lo = Math.round(this.angleOf(live[0]));
      const hi = Math.round(this.angleOf(live[live.length - 1]));
      return `A ring ${Math.min(lo, hi)}°–${Math.max(lo, hi)}° from the substellar point`;
    }
    const lats = live.map(b => Math.abs(this.latitudeOf(b)));
    const lo = Math.round(Math.min(...lats)), hi = Math.round(Math.max(...lats));
    // Which end of the world is liveable tells you what kind of world it is.
    const equatorial = live.some(b => Math.abs(b.sinLat) < 1 / this.n);
    const polar = live.some(b => Math.abs(b.sinLat) > 1 - 2 / this.n);
    if (equatorial && polar) return 'Pole to pole';
    if (polar) return `The poles only, above ${lo}° latitude`;
    if (equatorial) return `The tropics, below ${hi}° latitude`;
    return `Two temperate belts, ${lo}°–${hi}° latitude`;
  }
}
