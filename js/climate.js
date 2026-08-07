/*
 * climate.js — Turns the instantaneous geometry of the star system into a
 * surface temperature for the planet, then classifies the climate "era".
 *
 * Flux from each sun follows the inverse-square law  F = L / (4*pi*d^2).
 * Absorbed flux drives an equilibrium temperature via a Stefan-Boltzmann
 * style quarter-power law, calibrated in config so a lone mass-1 sun at the
 * reference distance gives ~15C. A thermal-inertia lag (dT/dt propto Teq - T)
 * means the planet warms and cools gradually — so a sun whipping past causes a
 * heat spike that fades, not an instant teleport to a new temperature.
 */

const ERA = {
  STABLE: 'Stable Era',
  FREEZING: 'Chaotic Era — Deep Freeze',
  SCORCHING: 'Chaotic Era — Scorching',
  DIM: 'Chaotic Era — Long Night',
};

class Climate {
  constructor() {
    this.tempC = 15;          // current surface temperature (Celsius)
    this.habitatTempC = 15;   // temperature in the niche life actually occupies
    this.eqTempC = 15;        // instantaneous equilibrium target
    this.flux = 0;            // total absorbed flux at the planet
    this.era = ERA.STABLE;
    this.productivity = 0.5;  // [0,1] biological energy availability
    this.habitableFraction = 1; // share of the surface anything could live on
    this._initialised = false;
  }

  // Sum inverse-square flux from every sun onto the planet.
  computeFlux(system) {
    const planet = system.planet;
    if (!planet) { this.flux = 0; return 0; }
    let total = 0;
    for (const sun of system.suns) {
      const dx = planet.x - sun.x, dy = planet.y - sun.y;
      const d2 = dx * dx + dy * dy + CONFIG.fluxSoftening;
      total += sun.luminosity / (4 * Math.PI * d2);
    }
    this.flux = total * (1 - CONFIG.albedo);
    return this.flux;
  }

  update(system, dt, profile = null) {
    this.computeFlux(system);
    // Quarter-power law -> Kelvin -> Celsius, plus a fixed greenhouse offset.
    const teqK = CONFIG.tempScaleK * Math.pow(Math.max(this.flux, 1e-9), 0.25) + CONFIG.greenhouseK;
    this.eqTempC = teqK - 273.15;

    if (!this._initialised) { this.tempC = this.eqTempC; this._initialised = true; }

    // First-order thermal lag (exponential relaxation toward equilibrium).
    // Oceans and deep ice give a world enormous thermal mass, so the same
    // wandering suns produce far gentler swings on a water world than on rock.
    const tau = CONFIG.thermalInertiaTau * (profile ? profile.thermalBuffer : 1);
    const alpha = 1 - Math.exp(-dt / tau);
    this.tempC += (this.eqTempC - this.tempC) * alpha;

    // What the biosphere actually experiences in its niche.
    this.habitatTempC = profile ? profile.habitatTempC(this.tempC) : this.tempC;

    this._classify();
    this._productivity(profile);
    return this.tempC;
  }

  _classify() {
    const [lo, hi] = CONFIG.stableBandC;
    const t = this.habitatTempC;
    if (t < lo) {
      // Distinguish "no sun in reach" (long night) from merely cold.
      this.era = this.flux < 0.0008 ? ERA.DIM : ERA.FREEZING;
    } else if (t > hi) {
      this.era = ERA.SCORCHING;
    } else {
      this.era = ERA.STABLE;
    }
  }

  get isStable() { return this.era === ERA.STABLE; }

  /*
   * Second pass, once the world's geography is known.
   *
   * The temperature that matters to a biosphere is the temperature of the
   * places it can actually occupy, not the average of the whole globe — and on
   * a world with a strong gradient those are very different numbers. A planet
   * whose mean is -30°C but whose tropics sit at 12°C is not a dead world; it
   * is a world where everyone lives near the equator.
   *
   * So the niche is the area-weighted mean of the habitable bands. If nothing
   * is habitable, it falls back to the least hostile band there is, which is
   * what life would be clinging to if it were clinging to anything.
   */
  applyNiche(geo, profile) {
    if (!geo || !geo.bands.length) return;
    let sum = 0, area = 0;
    for (const b of geo.bands) {
      if (!b.habitable) continue;
      sum += b.habitatC * b.area;
      area += b.area;
    }
    if (area > 0) {
      this.habitatTempC = sum / area;
    } else {
      // Nowhere is survivable. Report the closest thing to survivable there is,
      // so the shortfall is visible rather than averaged into meaninglessness.
      let best = geo.bands[0], bestGap = Infinity;
      const mid = (CONFIG.stableBandC[0] + CONFIG.stableBandC[1]) / 2;
      for (const b of geo.bands) {
        const gap = Math.abs(b.habitatC - mid);
        if (gap < bestGap) { bestGap = gap; best = b; }
      }
      this.habitatTempC = best.habitatC;
    }
    this.habitableFraction = geo.habitableFraction;
    this._classify();
    this._productivity(profile);
  }

  /*
   * Sunlight reaching the planet, expressed against Earth's. The simulation's
   * flux is in calibrated units, but the calibration is anchored to a world at
   * 288 K — so the ratio to that reference is a real, comparable number, and
   * 1361 W/m^2 is the real solar constant it corresponds to.
   */
  get insolationEarths() {
    const refAbs = CONFIG.lumPerMass /
      (4 * Math.PI * (CONFIG.refDistance * CONFIG.refDistance)) * (1 - CONFIG.albedo);
    return this.flux / refAbs;
  }
  get insolationWm2() { return this.insolationEarths * 1361; }

  // Biological productivity: peaks near comfort temp AND needs adequate light.
  _productivity(profile = null) {
    // Always the niche temperature, never the planetary mean — this runs again
    // after the geography is known, and must not undo what that established.
    const dT = (this.habitatTempC - CONFIG.comfortC) / CONFIG.comfortWidthC;
    const tempFactor = Math.exp(-dT * dT);
    // Light factor saturates: more light helps up to a point, then heat hurts
    // (already captured by tempFactor). Normalise against reference flux.
    const refAbs = (CONFIG.lumPerMass) /
      (4 * Math.PI * (CONFIG.refDistance * CONFIG.refDistance)) * (1 - CONFIG.albedo);
    const lightFactor = clamp(this.flux / refAbs, 0, 1.5) / 1.5;
    this.productivity = clamp(tempFactor * (0.35 + 0.65 * lightFactor), 0, 1);
  }
}
