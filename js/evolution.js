/*
 * evolution.js — An agent-based natural-selection model living on the planet.
 *
 * Each creature carries a genome of continuous, heritable traits. Every step
 * the current climate imposes selection: individuals whose "preferred temp"
 * is far from the surface temperature (relative to their "tolerance") suffer
 * higher mortality and lower reproduction. Offspring inherit the parent genome
 * plus gaussian mutation, so the population's trait distribution tracks the
 * environment — you literally watch adaptation.
 *
 * Trade-offs make the strategy space non-trivial (mirroring Trisolaris):
 *   - High DORMANCY lets a creature dehydrate and survive Chaotic Eras, but
 *     dormancy carries a standing reproductive cost, so in a calm single-sun
 *     world the fast-breeding non-dormant specialists win.
 *   - High TOLERANCE survives swings but lowers peak fecundity (generalist tax).
 *   - High METABOLISM breeds fast but burns energy and shortens lifespan.
 *   - Large SIZE buffers stress but costs energy and slows reproduction.
 */

const TRAIT_KEYS = Object.keys(CONFIG.traits);

function randomGenome() {
  const g = {};
  for (const k of TRAIT_KEYS) {
    const { min, max } = CONFIG.traits[k];
    g[k] = lerp(min, max, RNG());
  }
  // Bias initial seeds toward temperate, non-extreme life.
  g.optimalTemp = clamp(gaussian(18, 18), CONFIG.traits.optimalTemp.min, CONFIG.traits.optimalTemp.max);
  g.tolerance = clamp(gaussian(24, 10), CONFIG.traits.tolerance.min, CONFIG.traits.tolerance.max);
  // Wide dormancy spread so some seeds are pre-adapted — selection has raw
  // material to work with when the first Chaotic Era strikes.
  g.dormancy = clamp(RNG() * 0.6, 0, 1);
  return g;
}

function mutateGenome(parent, scale) {
  const g = {};
  for (const k of TRAIT_KEYS) {
    const { min, max } = CONFIG.traits[k];
    const range = max - min;
    g[k] = clamp(parent[k] + gaussian(0, scale * range), min, max);
  }
  return g;
}

const norm = (k, v) => {
  const { min, max } = CONFIG.traits[k];
  return (v - min) / (max - min);
};

class Creature {
  constructor(genome, gen = 0) {
    this.g = genome;
    this.energy = 0.6 + RNG() * 0.3;
    this.age = 0;
    this.gen = gen;
    this.dormant = false;
    this.alive = true;
    // Position on the biosphere strip (purely for visualisation).
    this.px = RNG();
    this.py = 0.12 + RNG() * 0.76;
    this.vpx = (RNG() - 0.5) * 0.0008;
    this.vpy = (RNG() - 0.5) * 0.0008;
  }

  get color() { return tempColor(this.g.optimalTemp); }

  // Squared, tolerance-scaled thermal stress. 0 = perfectly matched.
  stress(tempC) {
    const d = (tempC - this.g.optimalTemp) / this.g.tolerance;
    return d * d;
  }
}

class Population {
  constructor() {
    this.creatures = [];
    this.mutationScale = CONFIG.baseMutation;
    this.evolutionRate = 1.0;   // global multiplier on birth/death rates
    this.generation = 0;
    this.totalBirths = 0;
    this.totalDeaths = 0;
    this.extinctions = 0;
    this._lastBirths = 0;
    this._lastDeaths = 0;
  }

  get count() { return this.creatures.length; }
  get dormantCount() { let n = 0; for (const c of this.creatures) if (c.dormant) n++; return n; }

  seed(count, aroundTemp = null) {
    for (let i = 0; i < count; i++) {
      const g = randomGenome();
      if (aroundTemp !== null) g.optimalTemp = clamp(gaussian(aroundTemp, 12),
        CONFIG.traits.optimalTemp.min, CONFIG.traits.optimalTemp.max);
      this.creatures.push(new Creature(g, 0));
    }
  }

  clear() { this.creatures.length = 0; this.generation = 0; }

  // Average of a trait across the living population.
  avg(trait) {
    if (!this.creatures.length) return 0;
    let s = 0; for (const c of this.creatures) s += c.g[trait];
    return s / this.creatures.length;
  }

  // Trait diversity (std-dev) — collapses under strong selection, widens with
  // high mutation. A readout for "how much genetic variation is left".
  diversity(trait) {
    const n = this.creatures.length;
    if (n < 2) return 0;
    const m = this.avg(trait);
    let s = 0; for (const c of this.creatures) { const d = c.g[trait] - m; s += d * d; }
    return Math.sqrt(s / n);
  }

  update(climate, dt) {
    const T = climate.tempC;
    const prod = climate.productivity;
    const rate = this.evolutionRate;
    const K = Math.max(12, CONFIG.maxCreatures * (0.15 + 0.85 * prod));

    const newborns = [];
    let births = 0, deaths = 0;
    const cs = this.creatures;

    for (let i = cs.length - 1; i >= 0; i--) {
      const c = cs[i];
      c.age += 1;
      // gentle brownian drift for a living-looking biosphere
      c.px = clamp(c.px + c.vpx, 0.01, 0.99);
      c.py = clamp(c.py + c.vpy, 0.05, 0.95);
      if (RNG() < 0.02) { c.vpx = (RNG() - 0.5) * 0.0012; c.vpy = (RNG() - 0.5) * 0.0012; }

      const stress = c.stress(T);
      const sizeN = norm('size', c.g.size);
      const dormN = c.g.dormancy;              // already 0..1

      // ---- Dormancy decision (dehydration) ----
      if (c.dormant) {
        // Better dormancy genes drain slower while dehydrated — they can wait
        // out longer Chaotic Eras.
        c.energy -= CONFIG.dormancyDrain * dt * 60 * (1 - 0.6 * dormN);
        // Rehydrate when conditions become survivable again.
        if (stress < 0.5 || RNG() < 0.001) c.dormant = false;
        if (c.energy <= 0) { this._kill(cs, i); deaths++; continue; }
        continue; // dormant: no reproduction, no thermal death
      }

      // Enter dormancy when stressed. Everyone has a small baseline chance, but
      // the dormancy trait makes it far more reliable (the Trisolaran strategy).
      if (stress > 1.0 && RNG() < (0.04 + dormN * 0.5) * rate) { c.dormant = true; continue; }

      // ---- Mortality (active creatures) ----
      let death = CONFIG.baseDeathRate;
      if (stress > 1) death += 0.035 * (stress - 1) / (0.4 + sizeN); // size buffers stress
      // starvation when productivity can't feed metabolism
      const upkeep = 0.4 + 0.6 * norm('metabolism', c.g.metabolism) + 0.4 * sizeN;
      if (prod < upkeep * 0.5) death += CONFIG.baseDeathRate * (1 - prod / (upkeep * 0.5 + 1e-6));
      // old age
      if (c.age > CONFIG.maxAge) death += (c.age - CONFIG.maxAge) / CONFIG.maxAge * 0.01;
      death *= rate;

      // energy bookkeeping
      const gain = prod * (0.9 + 0.6 * norm('metabolism', c.g.metabolism)) / (0.7 + 0.6 * sizeN);
      c.energy += (gain - upkeep) * 0.02 * dt * 60;
      if (c.energy < 0) { death += CONFIG.activeDrain * (-c.energy) * 40; c.energy = 0; }
      c.energy = clamp(c.energy, 0, 1.4);

      if (RNG() < death) { this._kill(cs, i); deaths++; continue; }

      // ---- Reproduction ----
      if (cs.length + newborns.length < K && c.energy > 0.7 && stress < 1.0) {
        const metaN = norm('metabolism', c.g.metabolism);
        const tolN = norm('tolerance', c.g.tolerance);
        let repro = CONFIG.baseReproChance
          * (0.5 + metaN)             // fast metabolism breeds faster
          * (1 - 0.45 * dormN)        // dormancy tax
          * (1 - 0.35 * tolN)         // generalist tax
          * (1 - 0.30 * sizeN)        // size tax
          * prod                      // needs a productive environment
          * (1 - stress);            // must be well-matched right now
        repro *= rate;
        if (RNG() < repro) {
          const child = new Creature(mutateGenome(c.g, this.mutationScale), c.gen + 1);
          child.px = clamp(c.px + (RNG() - 0.5) * 0.06, 0.01, 0.99);
          child.py = clamp(c.py + (RNG() - 0.5) * 0.06, 0.05, 0.95);
          c.energy -= 0.35;
          newborns.push(child);
          births++;
          if (child.gen > this.generation) this.generation = child.gen;
        }
      }
    }

    for (const n of newborns) this.creatures.push(n);
    this.totalBirths += births; this.totalDeaths += deaths;
    this._lastBirths = births; this._lastDeaths = deaths;

    if (this.creatures.length === 0 && (births + deaths) > 0) this.extinctions++;
  }

  _kill(arr, i) { arr.splice(i, 1); }

  // ---- God interventions ----
  nudgeTrait(trait, delta) {
    const { min, max } = CONFIG.traits[trait];
    for (const c of this.creatures) c.g[trait] = clamp(c.g[trait] + delta, min, max);
  }

  massExtinction(fraction) {
    const survivors = [];
    for (const c of this.creatures) if (RNG() > fraction) survivors.push(c);
    this.creatures = survivors;
    this.extinctions++;
  }

  // A rare beneficial "cambrian" burst: inject fresh variation.
  burstMutation(factor = 6) {
    const s = this.mutationScale * factor;
    for (const c of this.creatures) c.g = mutateGenome(c.g, s);
  }
}
