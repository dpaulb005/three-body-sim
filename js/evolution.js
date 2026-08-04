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
  // Start dim: intelligence is expensive and must be earned by selection.
  g.intelligence = clamp(RNG() * 0.15, 0, 1);
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

    // The dots on screen are a genetic SAMPLE, not the species. `headcount` is
    // the actual number of individuals alive, which technology and habitable
    // area carry from thousands into the billions. Keeping the two separate is
    // what lets the simulation stay cheap while the numbers stay real.
    this.headcount = 0;
    this.peakHeadcount = 0;
  }

  /*
   * Census. The sampled agents give the *occupancy* of the world (how full it
   * is relative to what it could hold); technology and habitable area give the
   * ceiling. A pre-agricultural world holds a few hundred thousand; one with
   * fixation, sanitation and orbital habitats holds billions.
   */
  census(K, techCarry = 1, habitableFrac = 1, gravity = 1) {
    const occupancy = K > 0 ? clamp(this.count / K, 0, 1) : 0;
    // Baseline a world can support with no technology at all.
    const wildCeiling = 4.5e5;
    // Denser worlds pack more in per unit area; bigger ones have more area.
    const areaFactor = clamp(1 / Math.max(gravity, 0.2), 0.4, 2.4);
    const ceiling = wildCeiling * techCarry * clamp(habitableFrac, 0.05, 1.4) * areaFactor;
    const target = ceiling * occupancy;
    // Populations move, but not instantly — this is generations, not frames.
    this.headcount += (target - this.headcount) * 0.004;
    if (this.count === 0) this.headcount *= 0.97;
    if (this.headcount < 1) this.headcount = 0;
    this.peakHeadcount = Math.max(this.peakHeadcount, this.headcount);
    return this.headcount;
  }

  get count() { return this.creatures.length; }
  get dormantCount() { let n = 0; for (const c of this.creatures) if (c.dormant) n++; return n; }

  seed(count, aroundTemp = null) {
    for (let i = 0; i < count; i++) {
      const g = randomGenome();
      if (aroundTemp !== null) {
        // Seed near current conditions, but with a wide spread and a pull
        // toward the temperate optimum. A founding population perfectly matched
        // to this instant is wiped out by the first swing, leaving selection
        // nothing to work with — the variance IS the raw material.
        const centre = lerp(aroundTemp, CONFIG.comfortC, 0.35);
        g.optimalTemp = clamp(gaussian(centre, 22),
          CONFIG.traits.optimalTemp.min, CONFIG.traits.optimalTemp.max);
      }
      this.creatures.push(new Creature(g, 0));
    }
  }

  clear() { this.creatures.length = 0; this.generation = 0; this.headcount = 0; this.peakHeadcount = 0; }

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

  // `protection` (0..1) comes from an awakened civilisation's technology and
  // shields the population from thermal stress — the tech-vs-suns race.
  update(climate, dt, protection = 0, fx = null, prof = null) {
    // Selection acts on the niche temperature, not the planetary mean.
    const T = climate.habitatTempC !== undefined ? climate.habitatTempC : climate.tempC;
    const rate = this.evolutionRate;
    fx = fx || baseEffects();
    // Photosynthetic lineages eat light directly, so their food supply tracks
    // stellar flux rather than the temperature-shaped productivity curve.
    let prod = climate.productivity;
    if (fx.lightProductivity > 0) {
      const lit = clamp(climate.flux / 0.0075, 0, 1.25);
      prod = lerp(prod, lit, fx.lightProductivity);
    }
    // A world with internal heat has a floor under its food supply even with
    // no sun at all — this is what makes a rogue planet liveable.
    if (prof && prof.geothermal > 0) prod = Math.max(prod, prof.geothermal);
    prod = clamp(prod, 0, 1.25);
    const K = Math.max(12, CONFIG.maxCreatures * (0.15 + 0.85 * prod));

    const newborns = [];
    let births = 0, deaths = 0;
    const cs = this.creatures;

    // Density-dependent competition. Once the world approaches its carrying
    // capacity, individuals must compete for scarce slots and the least
    // competitive are crowded out. Without this, a full world blocks births by
    // luck alone and no trait can ever be selected for — which is precisely the
    // regime where an expensive brain must prove its worth.
    const crowding = clamp((cs.length / K - 0.75) / 0.25, 0, 1);

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
      const intel = c.g.intelligence;          // 0..1
      // Behavioural + technological buffering of thermal stress.
      const relief = clamp(CONFIG.intelStressRelief * intel + protection + fx.stressRelief
        + (prof ? prof.gravityStressRelief : 0), 0, 0.95);
      const mortStress = stress * (1 - relief);

      // ---- Dormancy decision (dehydration) ----
      if (c.dormant) {
        // Better dormancy genes drain slower while dehydrated — they can wait
        // out longer Chaotic Eras.
        // Deep cryptobiosis: a highly dormant lineage burns almost nothing and
        // can ride out a Chaotic Era that lasts for ages (cf. tardigrades).
        c.energy -= CONFIG.dormancyDrain * dt * 60 * fx.dormancyDrainMult
          * Math.pow(1 - 0.97 * dormN, 2);
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
      if (mortStress > 1) death += 0.035 * (mortStress - 1) / (0.4 + sizeN); // size buffers stress
      // starvation when productivity can't feed metabolism — the fixed brain
      // cost makes intelligence lethal in poor conditions, life-changing in rich ones.
      const upkeep = (0.4 + 0.6 * norm('metabolism', c.g.metabolism) + 0.4 * sizeN
        + CONFIG.intelCostUpkeep * intel * fx.intelUpkeepMult)
        * (prof ? prof.gravityUpkeep : 1);
      if (prod < upkeep * 0.5) death += CONFIG.baseDeathRate * (1 - prod / (upkeep * 0.5 + 1e-6));
      // old age
      if (c.age > CONFIG.maxAge) death += (c.age - CONFIG.maxAge) / CONFIG.maxAge * 0.01;
      // Competition for scarce resources in a crowded world: those carrying the
      // least energy reserve lose out. A clever forager banks more, so it wins
      // the squeeze — this is where intelligence finally repays its upkeep.
      if (crowding > 0) {
        const reserve = clamp((c.energy - 0.5) / 2.0, 0, 1);
        death += crowding * 0.010 * (1 - reserve);
      }
      death *= rate * fx.deathMult;

      // energy bookkeeping: brains only pay off where productivity is high
      const gain = prod * (0.9 + 0.6 * norm('metabolism', c.g.metabolism))
        * (1 + CONFIG.intelForageGain * intel * prod) / (0.7 + 0.6 * sizeN);
      c.energy += (gain - upkeep) * 0.02 * dt * 60;
      if (c.energy < 0) { death += CONFIG.activeDrain * (-c.energy) * 40; c.energy = 0; }
      // Generous ceiling: reserves must stay meaningfully different between a
      // clever forager and a dull one, otherwise everyone saturates and
      // intelligence stops being visible to selection.
      c.energy = clamp(c.energy, 0, 3.0);

      if (RNG() < death) {
        // Redundant bodies/organs: a lethal event may cost a part, not a life.
        if (fx.redundancy > 0 && RNG() < fx.redundancy) { c.energy = Math.max(0, c.energy - 0.25); }
        else { this._kill(cs, i); deaths++; continue; }
      }

      // ---- Reproduction ----
      if (cs.length + newborns.length < K && c.energy > 0.7 && stress < 1.0) {
        const metaN = norm('metabolism', c.g.metabolism);
        const tolN = norm('tolerance', c.g.tolerance);
        let repro = CONFIG.baseReproChance
          * (0.5 + metaN)             // fast metabolism breeds faster
          * (1 - 0.45 * dormN)        // dormancy tax
          * (1 - 0.35 * tolN)         // generalist tax
          * (1 - 0.30 * sizeN)        // size tax
          * (1 - CONFIG.intelReproTax * fx.intelReproTaxMult * intel) // long childhoods
          * prod                      // needs a productive environment
          * (1 - stress)             // must be well-matched right now
          // Surplus energy buys breeding opportunities. This is what lets an
          // expensive brain pay for itself: in a rich, calm world a clever
          // forager banks far more surplus than it loses to slow breeding. In a
          // poor or chaotic world there is no surplus, so the brain is pure
          // cost and selection strips it away.
          * (0.35 + 1.15 * clamp(c.energy - 0.7, 0, 1.6) / 1.6);
        repro *= rate * fx.reproMult;
        if (RNG() < repro) {
          const child = new Creature(mutateGenome(c.g, this.mutationScale * fx.mutationMult), c.gen + 1);
          child.px = clamp(c.px + (RNG() - 0.5) * 0.30, 0.01, 0.99);
          child.py = clamp(c.py + (RNG() - 0.5) * 0.22, 0.05, 0.95);
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
