/*
 * environment.js — What kind of world this is, and what it has actually been
 * like to live on.
 *
 * Two separate things live here:
 *
 *   WorldProfile   The planet's fixed physical character — gravity, rotation,
 *                  hydrosphere, radiation, internal heat. Set by the preset.
 *                  These are the "fundamental pressures" that make an
 *                  environment alien rather than just differently decorated.
 *
 *   Signature      A rolling measurement of what the climate has DONE: how
 *                  violently it swings, how much of the time is habitable, how
 *                  often eras flip, how long it stays dark. Adaptations read
 *                  this rather than the instantaneous temperature, because an
 *                  adaptation is a response to a *regime*, not to a moment.
 *
 * Keeping them apart matters: two worlds can share a profile and still diverge
 * completely because their suns behaved differently.
 */

class WorldProfile {
  constructor(opts = {}) {
    // 1.0 = Earth-like unless noted.
    this._gravityOverride = opts.gravity !== undefined;
    this.gravity = opts.gravity ?? 1.0;
    // Rotation period measured in orbits. >0.5 is effectively a world where a
    // "day" is longer than a season — or tidally locked, with no day at all.
    this.rotationOrbits = opts.rotationOrbits ?? 0.003;
    this.tidalLocked = opts.tidalLocked ?? false;
    // Axial tilt in degrees. This is the single number that decides whether a
    // world has seasons and how flat its pole-to-equator gradient is: at 0° the
    // poles never see the sun and freeze permanently, and past ~54° the poles
    // receive more annual sunlight than the equator does.
    this.obliquityDeg = opts.obliquityDeg ?? 23.4;
    // 'land' | 'ocean' | 'ice'
    this.hydrosphere = opts.hydrosphere ?? 'land';
    // 0..1 — stellar particle flux reaching the surface (flare stars, thin
    // atmospheres, close orbits).
    this.radiation = opts.radiation ?? 0.05;
    // Internal/tidal heat, as a floor under the stellar flux. This is what
    // makes a sunless rogue planet survivable at all.
    this.geothermal = opts.geothermal ?? 0;
    this.label = opts.label ?? 'Terrestrial';
    this.planetMassEarth = 1;
    this.density = CONFIG.earthDensity;
    this.radiusEarth = 1;
    this._compositionBuffer = 1;
  }

  // Connect the environmental layer to the actual inhabited planet. Presets
  // may override gravity for narrative edge cases; otherwise mass and density
  // determine radius and surface gravity directly.
  syncPlanet(planet) {
    if (!planet || planet.type !== 'planet') return;
    this.planetMassEarth = planet.massEarth;
    this.density = planet.density;
    this.radiusEarth = planet.radiusEarth;
    if (!this._gravityOverride) this.gravity = planet.surfaceGravityG;
    const water = planet.composition.water || 0;
    const gas = planet.composition.gas || 0;
    this._compositionBuffer = 1 + water * 1.8 + gas * 0.7;
  }

  // Higher gravity means a denser, sturdier build: stress is better tolerated
  // but movement and growth cost more.
  get gravityStressRelief() { return clamp((this.gravity - 1) * 0.18, -0.1, 0.3); }
  get gravityUpkeep() { return 1 + clamp((this.gravity - 1) * 0.25, -0.2, 0.6); }

  /*
   * Derived physical attributes. None of these are stored — they all fall out
   * of the mass, radius and density the physics layer already computes, which
   * is the point: a world's character should be a consequence of what it is
   * made of rather than a set of independent dials.
   */

  // v_esc = sqrt(2GM/R), expressed against Earth's 11.186 km/s.
  get escapeVelocityKmS() {
    return 11.186 * Math.sqrt(this.planetMassEarth / Math.max(this.radiusEarth, 1e-6));
  }

  /*
   * Whether this world can hold onto an atmosphere at all.
   *
   * The physical criterion is Jeans escape: the ratio of escape velocity to the
   * thermal speed of the gas. The interesting range is narrow and empirical —
   * our Moon sits near 5 and has no air, Mars near 12 and has almost none,
   * Earth near 22 and keeps everything. So the ratio is mapped across that
   * span, which puts the real Solar System roughly where it belongs.
   */
  atmosphereRetention(surfaceC) {
    const T = Math.max(surfaceC + 273.15, 30);
    // RMS speed of nitrogen, in km/s: sqrt(3kT/m).
    const vThermal = Math.sqrt(3 * 1.380649e-23 * T / (28 * 1.66054e-27)) / 1000;
    const ratio = this.escapeVelocityKmS / vThermal;
    return clamp((ratio - 5) / 15, 0, 1);
  }

  // Surface pressure, normalised so an Earth-mass rock at Earth's temperature
  // reads 1 bar. Deliberately coarse — it exists to say "thick", "thin" or
  // "none" honestly, not to predict a barometer.
  surfacePressureBar(surfaceC) {
    const held = this.atmosphereRetention(surfaceC);
    const volatiles = this.hydrosphere === 'ocean' ? 1.25
      : this.hydrosphere === 'ice' ? 0.55 : 1;
    return clamp(held * held * this.gravity * volatiles, 0, 12);
  }

  /*
   * How long a day lasts, in hours. `rotationOrbits` is a fraction of the
   * planet's year, and the year itself follows from Kepler's third law, so the
   * answer is real once we know the orbit: P(years) = sqrt(a^3 / M).
   */
  yearInEarthYears(semiMajorAU, centralMassSolar) {
    if (!(semiMajorAU > 0) || !(centralMassSolar > 0)) return null;
    return Math.sqrt(Math.pow(semiMajorAU, 3) / centralMassSolar);
  }

  dayInHours(yearInEarthYears) {
    if (this.tidalLocked || !yearInEarthYears) return null;
    return this.rotationOrbits * yearInEarthYears * 365.25 * 24;
  }

  // Oceans buffer temperature swings; deep ice buffers even harder.
  get thermalBuffer() {
    const environment = this.hydrosphere === 'ocean' ? 2.6
      : this.hydrosphere === 'ice' ? 3.4 : 1;
    return environment * this._compositionBuffer;
  }

  // The temperature life actually experiences, which is not the planetary mean.
  // Organisms occupy a niche, and on some worlds that niche is radically
  // milder than the globe as a whole:
  //   - under kilometres of ice, geothermal vents hold a steady liquid pocket
  //     no matter how cold the surface gets;
  //   - on a tidally locked world nothing lives on the burning face or the
  //     frozen one, but the twilight ring between them is temperate.
  habitatTempC(surfaceC) {
    let t = this.ventAdjustedC(surfaceC);
    if (this.tidalLocked) {
      // Life tracks the terminator, so it sees a heavily moderated average.
      // This is a whole-planet approximation of a thing that is really
      // geographic; where a Geography exists it supersedes this, because the
      // twilight ring is then an actual band with an actual temperature.
      t = lerp(t, 18, 0.72);
    }
    return t;
  }

  /*
   * The vent term on its own. Geothermal warmth is not a location — it is under
   * the whole crust — so it applies to every band alike, and Geography wants it
   * without the tidal-lock approximation layered on top.
   */
  ventAdjustedC(surfaceC) {
    if (!(this.geothermal > 0)) return surfaceC;
    const ventC = 4;   // vent-warmed water sits near freezing whatever the sky does
    return lerp(surfaceC, ventC, clamp(this.geothermal * 2.4, 0, 0.985));
  }
}

class Signature {
  constructor() {
    this.samples = 0;
    this.meanTempC = 15;
    this.m2 = 0;              // running variance accumulator
    this.tempVolatility = 0;  // standard deviation of surface temperature
    this.minTempC = Infinity;
    this.maxTempC = -Infinity;
    this.fluxMean = 0;
    this.darkFrac = 0;        // fraction of time effectively sunless
    this.stableFrac = 1;      // fraction of time in a Stable Era
    this.eraChurn = 0;        // era transitions per orbit
    this._eraFlips = 0;
    this._lastEra = null;
    this._darkCount = 0;
    this._stableCount = 0;
  }

  get chaos() {
    // A single 0..1 "how hostile is this sky" number, from swing + instability.
    const vol = clamp(this.tempVolatility / 45, 0, 1);
    const insta = clamp(1 - this.stableFrac, 0, 1);
    const churn = clamp(this.eraChurn / 1.5, 0, 1);
    return clamp(0.45 * vol + 0.35 * insta + 0.20 * churn, 0, 1);
  }

  // Enough history that adaptation gates are not reacting to noise.
  get mature() { return this.samples > 900; }

  update(climate, timeOrbits) {
    const t = climate.tempC;
    this.samples++;
    // Welford running mean/variance.
    const d = t - this.meanTempC;
    this.meanTempC += d / this.samples;
    this.m2 += d * (t - this.meanTempC);
    this.tempVolatility = this.samples > 1 ? Math.sqrt(this.m2 / this.samples) : 0;
    if (t < this.minTempC) this.minTempC = t;
    if (t > this.maxTempC) this.maxTempC = t;

    this.fluxMean += (climate.flux - this.fluxMean) / this.samples;
    if (climate.flux < 0.0012) this._darkCount++;
    if (climate.isStable) this._stableCount++;
    this.darkFrac = this._darkCount / this.samples;
    this.stableFrac = this._stableCount / this.samples;

    if (this._lastEra !== null && climate.era !== this._lastEra) this._eraFlips++;
    this._lastEra = climate.era;
    this.eraChurn = timeOrbits > 0.5 ? this._eraFlips / timeOrbits : 0;
  }
}
