/*
 * world.js — The simulation kernel. Owns the star system, the climate model
 * and the population, advances them in lock-step, records time-series history,
 * and emits narrative events (era changes, extinctions, civilisation
 * milestones, star mergers) for the UI to surface.
 */

class World {
  constructor() {
    this.system = new NBodySystem();
    this.climate = new Climate();
    this.population = new Population();
    this.civ = new Civilization();
    this.profile = new WorldProfile();
    this.geography = new Geography();
    this.signature = new Signature();
    this.adaptations = new AdaptationSet();

    this.running = true;
    this.speed = 3;            // sim steps per animation frame
    this.stepCount = 0;
    this.presetName = '';

    // ---- Identity within the galaxy ----
    this.id = 1;
    this.starName = 'Home';
    this.galPos = { x: 0, y: 0 };
    this.contacts = new Set();      // ids of worlds this one has detected
    this.relations = new Map();     // id -> 'ally' | 'wary' | 'hostile'
    // A permanent record, unlike `events` which is a rolling window. This is
    // what the civilisation tab reads to show a whole history.
    this.milestones = [];
    this.speciesName = '';

    const H = 600;
    this.hist = {
      temp: new History(H),
      eqTemp: new History(H),
      pop: new History(H),
      prod: new History(H),
      dormant: new History(H),
      optimal: new History(H),
      tolerance: new History(H),
      dormancy: new History(H),
      intelligence: new History(H),
      knowledge: new History(H),
    };
    this._sampleEvery = 2;

    this.events = [];          // {t, text, kind}
    this._lastEra = null;
    this._milestones = new Set();
    this._recordHot = -Infinity;
    this._recordCold = Infinity;
    this._worldLost = false;
  }

  loadPreset(preset, { seedLife = true } = {}) {
    this.system.clear();
    this.climate = new Climate();
    this.population.clear();
    this.civ.reset();
    // Presets may declare a physical world profile; default to Earth-like.
    this.profile = new WorldProfile(preset.profile || {});
    this.geography = new Geography();
    this.signature = new Signature();
    this.adaptations.reset();
    this.stepCount = 0;
    this.presetName = preset.name;
    for (const k in this.hist) this.hist[k] = new History(600);
    this.events.length = 0;
    this.milestones.length = 0;
    this.contacts.clear();
    this.relations.clear();
    this.speciesName = '';
    this._lastEra = null;
    this._milestones.clear();
    this._recordHot = -Infinity; this._recordCold = Infinity;
    this._worldLost = false;

    preset.build(this);
    // Eliminate artificial centre-of-mass drift while preserving every
    // relative position and velocity defined by the preset.
    this.system.recenter();
    this.profile.syncPlanet(this.system.planet);
    // Prime the climate so temperature starts at equilibrium, not a cold start,
    // then let the geography settle so life is seeded into the world's real
    // habitable band rather than into its planetary average.
    this.climate.update(this.system, 0.0001, this.profile);
    this.geography.update(this.climate, this.profile, null);
    this.climate.applyNiche(this.geography, this.profile);
    if (seedLife) {
      // Seed life adapted to the niche it will actually occupy.
      this.population.seed(CONFIG.seedCount, this.climate.habitatTempC);
      this.log(`Life seeded on ${this.presetName}.`, 'life');
    }
    this.system.energy0 = null; // reset drift reference
  }

  log(text, kind = 'info') {
    this.events.unshift({ t: this.system.time, text, kind });
    if (this.events.length > 60) this.events.pop();
  }

  /** Permanent, uncapped record of the things worth remembering. */
  milestone(text, kind = 'info') {
    this.milestones.push({ t: this.system.time, orbits: this.system.time / (2 * Math.PI), text, kind });
    if (this.milestones.length > 400) this.milestones.shift();
  }

  get orbits() { return this.system.time / (2 * Math.PI); }

  /*
   * Orbital facts, read off the actual bodies rather than stored. The suns are
   * weighted by mass because that is what the planet orbits — in a three-body
   * tangle "the distance to the sun" is only meaningful as a distance to the
   * thing actually holding you.
   */
  get centralMassSolar() {
    let m = 0;
    for (const s of this.system.suns) m += s.mass;
    return m;
  }

  get orbitalRadiusAU() {
    const p = this.system.planet, suns = this.system.suns;
    if (!p || !suns.length) return null;
    let mx = 0, my = 0, m = 0;
    for (const s of suns) { mx += s.x * s.mass; my += s.y * s.mass; m += s.mass; }
    if (!(m > 0)) return null;
    return Math.hypot(p.x - mx / m, p.y - my / m);
  }

  /*
   * Is the planet actually orbiting anything? Specific orbital energy
   * v^2/2 - GM/r is negative for a bound orbit and positive for something on
   * its way out of the system. A rogue has no year, and saying so is more
   * honest than reporting a number derived from an orbit it is not on.
   */
  get bound() {
    const p = this.system.planet, m = this.centralMassSolar, r = this.orbitalRadiusAU;
    if (!p || !(m > 0) || !(r > 0)) return false;
    let mx = 0, my = 0, mvx = 0, mvy = 0;
    for (const s of this.system.suns) {
      mx += s.x * s.mass; my += s.y * s.mass;
      mvx += s.vx * s.mass; mvy += s.vy * s.mass;
    }
    const dvx = p.vx - mvx / m, dvy = p.vy - mvy / m;
    return (dvx * dvx + dvy * dvy) / 2 - CONFIG.G * m / r < 0;
  }

  // Kepler's third law, in the units the physics already uses: P = sqrt(a^3/M).
  get yearInEarthYears() {
    const a = this.orbitalRadiusAU, m = this.centralMassSolar;
    if (!(a > 0) || !(m > 0) || !this.bound) return null;
    return Math.sqrt(a * a * a / m);
  }

  get dayInHours() { return this.profile.dayInHours(this.yearInEarthYears); }

  // Advance one simulation step (physics + climate + life).
  step() {
    const dt = CONFIG.dt;
    this.system.step(dt);
    this.system.updateTrails();

    /*
     * The world can stop existing. A planet that falls into a star is merged
     * away by the collision handler, and without this check everything
     * downstream carries on regardless — climate reading a flux for a body that
     * is gone, a population living on a profile that is now a memory, a
     * civilisation accumulating knowledge on a planet that is vapour.
     *
     * That is not a hypothetical: it is what the Rogue preset did on every long
     * run before its orbit was fixed.
     */
    if (!this.system.planet) {
      if (!this._worldLost) {
        this._worldLost = true;
        const had = this.population.count > 0 || this.civ.everAwakened;
        this.log(had
          ? 'The world itself is gone — fallen into a star. Everything that lived here went with it.'
          : 'The world itself is gone, and there was no one on it.', 'collapse');
        this.milestone('The planet was destroyed', 'collapse');
        this.population.clear();
        this.civ.reset();
        this.climate.flux = 0;
        this.climate.productivity = 0;
      }
      this.stepCount++;
      this._drainMergeEvents();
      return;
    }
    this._worldLost = false;
    // Mass and makeup can change under a world — a merge, or the player editing
    // it — and everything derived from them has to follow.
    this.profile.syncPlanet(this.system.planet);

    this.climate.update(this.system, dt, this.profile);
    // Resolve the world into places before anything reads a temperature off it:
    // the climate's niche, the carrying capacity and the map all depend on
    // where on this planet is actually liveable.
    this.geography.update(this.climate, this.profile, this.population);
    this.climate.applyNiche(this.geography, this.profile);

    // Record what this world has actually been like, then let that history
    // decide which evolutionary paths it is pushing life down.
    const orbits = this.system.time / (2 * Math.PI);
    this.signature.update(this.climate, orbits);
    for (const e of this.adaptations.update(this.signature, this.profile,
        { sunCount: this.system.suns.length })) {
      this.log(e.text, e.kind);
      this.milestone(e.text, e.kind);
    }
    const fx = this.adaptations.effects;

    // Technology shields the population from the climate — so an advanced
    // civilisation literally changes the selection pressure acting on it.
    this.population.update(this.climate, dt, this.civ.protection, fx, this.profile);
    // Translate the sampled biosphere into an actual census.
    const K = Math.max(12, CONFIG.maxCreatures * (0.15 + 0.85 * this.climate.productivity));
    // Habitable area is now measured rather than inferred: how much of the
    // globe this species can actually occupy, tempered by how much of the time
    // the sky lets it. A world habitable only at the poles genuinely holds
    // fewer people than one habitable everywhere.
    const liveable = clamp(0.12 + 1.15 * this.geography.settledFraction, 0.05, 1.25);
    this.population.census(K, this.civ.techFx.carry,
      liveable * (0.45 + 0.55 * this.signature.stableFrac), this.profile.gravity);
    this.civ._memoryAdd = fx.memoryAdd;
    for (const e of this.civ.update(this.population, this.climate, dt, fx,
        this.adaptations, this.profile)) {
      this.log(e.text, e.kind);
      this.milestone(e.text, e.kind);
    }
    this.stepCount++;

    this._drainMergeEvents();
    this._trackNarrative();

    if (this.stepCount % this._sampleEvery === 0) this._sample();
    if (this.stepCount % 600 === 0 && this.population.count > 0) {
      this.speciesName = speciesName(this.profile, this.signature, this.adaptations);
    }
  }

  _sample() {
    const p = this.population;
    this.hist.temp.push(this.climate.tempC);
    this.hist.eqTemp.push(this.climate.eqTempC);
    this.hist.pop.push(p.count);
    this.hist.prod.push(this.climate.productivity);
    this.hist.dormant.push(p.dormantCount);
    this.hist.optimal.push(p.avg('optimalTemp'));
    this.hist.tolerance.push(p.avg('tolerance'));
    this.hist.dormancy.push(p.avg('dormancy'));
    this.hist.intelligence.push(p.avg('intelligence'));
    this.hist.knowledge.push(this.civ.knowledge);
  }

  _drainMergeEvents() {
    const ev = this.system.mergeEvents;
    while (ev.length) {
      const m = ev.shift();
      this.log(`Collision: ${m.survivor} absorbed ${m.absorbed}.`, 'cosmic');
    }
  }

  _trackNarrative() {
    const c = this.climate, p = this.population;

    // Era transitions
    if (c.era !== this._lastEra) {
      if (this._lastEra !== null) {
        const kind = c.isStable ? 'stable' : 'chaos';
        this.log(`${c.era} begins (${fmt.temp(c.tempC)}).`, kind);
      }
      this._lastEra = c.era;
    }

    // Temperature records
    if (c.tempC > this._recordHot + 5 && c.tempC > 70) {
      this._recordHot = c.tempC;
      this.log(`Scorching record: ${fmt.temp(c.tempC)}.`, 'chaos');
    }
    if (c.tempC < this._recordCold - 5 && c.tempC < -30) {
      this._recordCold = c.tempC;
      this.log(`Deep-freeze record: ${fmt.temp(c.tempC)}.`, 'chaos');
    }

    // Extinction
    if (p.count === 0 && !this._milestones.has('extinct0')) {
      this._milestones.add('extinct0');
      this.log('The biosphere has gone extinct. Seed life to try again.', 'death');
    }
    if (p.count > 0) this._milestones.delete('extinct0');

    // Pre-sapient milestones: the slow, uncertain climb toward a big brain.
    if (!this.civ.awakened) {
      const intel = p.avg('intelligence');
      for (const [frac, key, msg] of [
        [0.20, 'i20', 'Curiosity stirs — brains are growing, slowly.'],
        [0.35, 'i35', 'Tool-use appears. The surplus is paying for grey matter.'],
        [0.50, 'i50', 'On the cusp of sapience — if the good times hold.'],
      ]) {
        if (intel >= frac && !this._milestones.has(key)) {
          this._milestones.add(key);
          this.log(msg, 'life');
        } else if (intel < frac - 0.06) this._milestones.delete(key);
      }
    }

    // Flourishing biosphere
    if (p.count >= 300 && !this._milestones.has('flourish')) {
      this._milestones.add('flourish');
      this.log('The biosphere is flourishing (300+ organisms).', 'life');
    }
    if (p.count < 200) this._milestones.delete('flourish');
  }

  // ---- God actions on the cosmos ----
  addSun(x, y, vx, vy, mass) {
    const b = this.system.add(_sun(x, y, vx, vy, mass, this._starName()));
    this.log(`A new star ignites (mass ${mass.toFixed(2)}).`, 'cosmic');
    return b;
  }
  addRogue(x, y, vx, vy, mass) {
    const b = this.system.add(new Body({ x, y, vx, vy, mass, type: 'rogue', name: 'rogue' }));
    this.log('A rogue mass drifts into the system.', 'cosmic');
    return b;
  }
  addPlanet(x, y, vx, vy, massEarth = 1, composition = 'earth') {
    const b = this.system.add(new Body({ x, y, vx, vy, massEarth, composition,
      type: 'planet', name: this.system.planet ? 'planet' : 'the world' }));
    if (b === this.system.planet) {
      this.profile.syncPlanet(b);
      this.geography.update(this.climate, this.profile, this.population);
      // A world placed into an empty sandbox needs its climate primed.
      this.climate.update(this.system, 0.0001, this.profile);
    }
    this.log(`A ${PLANET_COMPOSITIONS[composition]?.label || 'custom world'} coalesces (${massEarth.toFixed(1)} Earth masses).`, 'cosmic');
    return b;
  }

  syncPlanetProfile() { this.profile.syncPlanet(this.system.planet); }
  _starName() {
    const names = ['Vega', 'Rigel', 'Mira', 'Lyra', 'Orin', 'Nova', 'Cygnus', 'Draco', 'Pyra', 'Zheng'];
    return names[Math.floor(RNG() * names.length)];
  }

  /** Put a body onto a circular orbit about the system's centre of mass. */
  circularise(body) {
    const others = this.system.bodies.filter(b => b !== body);
    if (!others.length) return;
    let mx = 0, my = 0, m = 0;
    for (const b of others) { mx += b.x * b.mass; my += b.y * b.mass; m += b.mass; }
    if (m <= 0) return;
    const cx = mx / m, cy = my / m;
    const dx = body.x - cx, dy = body.y - cy;
    const r = Math.hypot(dx, dy) || 1;
    const v = Math.sqrt(CONFIG.G * m / r);
    body.vx = -dy / r * v; body.vy = dx / r * v;
    this.system._invalidateEnergy();
    this.log(`${body.name || 'A body'} is set on a circular orbit.`, 'cosmic');
  }

  reseedPlanet() {
    // If the planet was lost, drop a fresh one on a sensible orbit.
    if (this.system.planet) return;
    const com = this.system.centerOfMass();
    const M = this.system.suns.reduce((s, b) => s + b.mass, 0) || 1;
    const r = 6;
    this.system.add(_planet(com.x + r, com.y, 0, vCirc(M, r, 1), 1, 'earth'));
    this.system.recenter();
    this.syncPlanetProfile();
    this.log('A new world coalesces.', 'cosmic');
  }
}
