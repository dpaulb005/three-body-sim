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

    this._classify(system);
    this._productivity(profile);
    return this.tempC;
  }

  _classify(system) {
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

  // Biological productivity: peaks near comfort temp AND needs adequate light.
  _productivity(profile = null) {
    const base = profile ? profile.habitatTempC(this.tempC) : this.tempC;
    const dT = (base - CONFIG.comfortC) / CONFIG.comfortWidthC;
    const tempFactor = Math.exp(-dT * dT);
    // Light factor saturates: more light helps up to a point, then heat hurts
    // (already captured by tempFactor). Normalise against reference flux.
    const refAbs = (CONFIG.lumPerMass) /
      (4 * Math.PI * (CONFIG.refDistance * CONFIG.refDistance)) * (1 - CONFIG.albedo);
    const lightFactor = clamp(this.flux / refAbs, 0, 1.5) / 1.5;
    this.productivity = clamp(tempFactor * (0.35 + 0.65 * lightFactor), 0, 1);
  }
}
