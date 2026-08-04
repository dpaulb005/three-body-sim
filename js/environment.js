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
    this.gravity = opts.gravity ?? 1.0;
    // Rotation period measured in orbits. >0.5 is effectively a world where a
    // "day" is longer than a season — or tidally locked, with no day at all.
    this.rotationOrbits = opts.rotationOrbits ?? 0.003;
    this.tidalLocked = opts.tidalLocked ?? false;
    // 'land' | 'ocean' | 'ice'
    this.hydrosphere = opts.hydrosphere ?? 'land';
    // 0..1 — stellar particle flux reaching the surface (flare stars, thin
    // atmospheres, close orbits).
    this.radiation = opts.radiation ?? 0.05;
    // Internal/tidal heat, as a floor under the stellar flux. This is what
    // makes a sunless rogue planet survivable at all.
    this.geothermal = opts.geothermal ?? 0;
    this.label = opts.label ?? 'Terrestrial';
  }

  // Higher gravity means a denser, sturdier build: stress is better tolerated
  // but movement and growth cost more.
  get gravityStressRelief() { return clamp((this.gravity - 1) * 0.18, -0.1, 0.3); }
  get gravityUpkeep() { return 1 + clamp((this.gravity - 1) * 0.25, -0.2, 0.6); }

  // Oceans buffer temperature swings; deep ice buffers even harder.
  get thermalBuffer() {
    return this.hydrosphere === 'ocean' ? 2.6
      : this.hydrosphere === 'ice' ? 3.4 : 1;
  }

  // The temperature life actually experiences, which is not the planetary mean.
  // Organisms occupy a niche, and on some worlds that niche is radically
  // milder than the globe as a whole:
  //   - under kilometres of ice, geothermal vents hold a steady liquid pocket
  //     no matter how cold the surface gets;
  //   - on a tidally locked world nothing lives on the burning face or the
  //     frozen one, but the twilight ring between them is temperate.
  habitatTempC(surfaceC) {
    let t = surfaceC;
    if (this.geothermal > 0) {
      // Vent-warmed water sits near freezing regardless of the sky.
      const ventC = 4;
      const shielding = clamp(this.geothermal * 2.4, 0, 0.985);
      t = lerp(t, ventC, shielding);
    }
    if (this.tidalLocked) {
      // Life tracks the terminator, so it sees a heavily moderated average.
      t = lerp(t, 18, 0.72);
    }
    return t;
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
