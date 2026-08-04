/*
 * config.js — Global tunable constants for the God Simulator.
 *
 * Everything the physics, climate and evolution models read lives here so the
 * whole simulation can be re-balanced from one place. Physics uses canonical
 * astronomical units: distance in AU, mass in solar masses, and time in
 * years/(2*pi). G=1, so Kepler's third law reads T=2*pi*sqrt(a^3/M).
 */
const CONFIG = {
  // ---- Gravitation / integration ----
  G: 1.0,                 // gravitational constant (sim units)
  softening: 0,           // exact Newtonian gravity; opt-in Plummer softening
  dt: 0.010,              // base timestep per simulation step
  substeps: 6,            // velocity-Verlet substeps per step (stability)
  maxSubsteps: 96,        // close-encounter refinement cap
  encounterResolution: 0.03, // max step as a fraction of local dynamical time

  // ---- Physical unit conversions ----
  solarMassKg: 1.98847e30,
  earthMassKg: 5.9722e24,
  earthMassInSolar: 3.0034896e-6,
  solarRadiusAU: 0.00465047,
  earthRadiusAU: 4.26352e-5,
  earthDensity: 5.514,    // g/cm^3

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
    intelligence:  { min: 0,   max: 1,  label: 'Intelligence' },
  },

  // ---- Intelligence: an EXPENSIVE trait (the "Earth got lucky" gate) ----
  // A big brain is a fixed metabolic burden, so it is selected AGAINST unless
  // the world is rich and calm enough that its foraging payoff repays the cost.
  // Harsh worlds stay stuck at bare survival and never afford sapience.
  intelCostUpkeep: 0.9,    // extra energy upkeep at intelligence=1
  intelForageGain: 1.6,    // foraging bonus (only cashed in when productivity is high)
  intelReproTax: 0.35,     // fewer offspring at intelligence=1 (long childhoods)
  intelStressRelief: 0.25, // smart creatures shelter a little from thermal stress

  // ---- Civilization ----
  civ: {
    awakenIntel: 0.55,     // avg intelligence needed to awaken sapience
    awakenPop: 110,        // and a population large enough to sustain culture
    loseIntel: 0.30,       // below this avg intelligence, sapience is bred back out
    growthRate: 0.042,      // knowledge points gained per step at full swing
    decayLowPop: 0.04,     // knowledge lost per step when population is tiny
    collapseAbsPop: 34,    // awakened + pop below this -> collapse (dark age)
    collapsePeakFrac: 0.34,// or pop below this fraction of recent peak during chaos
    collapseKeep: 0.10,    // fraction of knowledge that survives a collapse
    collapseCooldown: 300, // steps before another collapse can fire
    memoryPerCollapse: 0.4,// each reboot rebuilds this much faster (cultural memory)
    memoryCap: 3.0,
    maxProtection: 0.45,   // tech blunts the suns but never conquers them
    // Named ages unlocked as cumulative knowledge crosses each threshold.
    // `short` is used by the compact age stepper in the inspector.
    tiers: [
      { k: 0,    name: 'Stone Age',     short: 'Stone' },
      { k: 120,  name: 'Fire & Tribe',  short: 'Fire' },
      { k: 320,  name: 'Agriculture',   short: 'Farm' },
      { k: 640,  name: 'Writing',       short: 'Write' },
      { k: 1100, name: 'Industry',      short: 'Steam' },
      { k: 1800, name: 'Science',       short: 'Science' },
      { k: 2800, name: 'Spaceflight',   short: 'Space' },
      { k: 4200, name: 'Transcendence', short: 'Beyond' }, // pinnacle
    ],
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
