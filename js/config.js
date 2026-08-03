/*
 * config.js — Global tunable constants for the God Simulator.
 *
 * Everything the physics, climate and evolution models read lives here so the
 * whole simulation can be re-balanced from one place. Values are in abstract
 * "sim units": distance ~ AU, mass ~ solar masses, time ~ (2*pi units = one
 * orbit of a mass-1 body at distance 1). G is set to 1 so Kepler's third law
 * reads T = 2*pi*sqrt(a^3 / M).
 */
const CONFIG = {
  // ---- Gravitation / integration ----
  G: 1.0,                 // gravitational constant (sim units)
  softening: 0.03,        // Plateau length eps: force uses (r^2 + eps^2)
  dt: 0.010,              // base timestep per simulation step
  substeps: 6,            // velocity-Verlet substeps per step (stability)
  maxSpeed: 40,           // clamp to stop numeric blow-ups launching bodies to infinity

  // ---- Rendering ----
  trailLength: 260,       // orbital trail sample count
  pixelsPerUnit: 26,      // base zoom (overridden by auto-fit)

  // ---- Stellar / climate ----
  lumPerMass: 1.0,        // base luminosity coefficient
  lumExp: 1.6,            // L = lumPerMass * mass^lumExp (brighter big stars)
  fluxSoftening: 0.05,    // avoid flux singularity when a sun engulfs the planet
  albedo: 0.30,           // planetary reflectivity
  refDistance: 4.0,       // reference planet-sun distance for calibration
  refTempK: 288,          // target equilibrium temp (K) at reference flux (~15C)
  greenhouseK: 6,         // fixed greenhouse warming added to equilibrium temp (K)
  thermalInertiaTau: 2.4, // climate lag: larger = slower to respond to flux changes
  stableBandC: [-18, 58], // surface temp (C) considered a "Stable Era"
  comfortC: 20,           // temperature of peak biological productivity
  comfortWidthC: 42,      // gaussian width of the productivity-vs-temp curve

  // ---- Evolution ----
  maxCreatures: 420,      // hard population cap (carrying ceiling)
  seedCount: 60,          // creatures spawned by "Seed Life"
  baseMutation: 0.06,     // default mutation magnitude (fraction of trait range)
  baseReproChance: 0.020, // per-step reproduction probability at ideal conditions
  baseDeathRate: 0.0025,  // background per-step mortality
  maxAge: 5000,           // steps before old-age mortality ramps up
  dormancyDrain: 0.00022, // energy lost per step while dormant (dehydrated)
  activeDrain: 0.0009,    // energy lost per step while active but starving

  // Trait definitions: [min, max] ranges used for mutation clamping + display.
  traits: {
    optimalTemp:   { min: -60, max: 90, label: 'Preferred temp' },
    tolerance:     { min: 6,   max: 90, label: 'Temp tolerance' },
    dormancy:      { min: 0,   max: 1,  label: 'Dormancy (dehydration)' },
    metabolism:    { min: 0.3, max: 2.0, label: 'Metabolism' },
    size:          { min: 0.4, max: 2.5, label: 'Size' },
  },
};

// Derived: calibrate the temperature scale so a mass-1 sun at refDistance
// yields refTempK. Computed once at load.
(function calibrate() {
  const refFlux = (CONFIG.lumPerMass * Math.pow(1, CONFIG.lumExp)) /
    (4 * Math.PI * (CONFIG.refDistance * CONFIG.refDistance + CONFIG.fluxSoftening));
  const absorbed = refFlux * (1 - CONFIG.albedo);
  CONFIG.tempScaleK = CONFIG.refTempK / Math.pow(absorbed, 0.25);
})();
