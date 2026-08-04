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
    this.signature = new Signature();
    this.adaptations = new AdaptationSet();

    this.running = true;
    this.speed = 3;            // sim steps per animation frame
    this.stepCount = 0;
    this.presetName = '';

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
  }

  loadPreset(preset, { seedLife = true } = {}) {
    this.system.clear();
    this.climate = new Climate();
    this.population.clear();
    this.civ.reset();
    // Presets may declare a physical world profile; default to Earth-like.
    this.profile = new WorldProfile(preset.profile || {});
    this.signature = new Signature();
    this.adaptations.reset();
    this.stepCount = 0;
    this.presetName = preset.name;
    for (const k in this.hist) this.hist[k] = new History(600);
    this.events.length = 0;
    this._lastEra = null;
    this._milestones.clear();
    this._recordHot = -Infinity; this._recordCold = Infinity;

    preset.build(this);
    // Eliminate artificial centre-of-mass drift while preserving every
    // relative position and velocity defined by the preset.
    this.system.recenter();
    this.profile.syncPlanet(this.system.planet);
    // Prime the climate so temperature starts at equilibrium, not a cold start.
    this.climate.update(this.system, 0.0001, this.profile);
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

  // Advance one simulation step (physics + climate + life).
  step() {
    const dt = CONFIG.dt;
    this.system.step(dt);
    this.system.updateTrails();
    this.climate.update(this.system, dt, this.profile);

    // Record what this world has actually been like, then let that history
    // decide which evolutionary paths it is pushing life down.
    const orbits = this.system.time / (2 * Math.PI);
    this.signature.update(this.climate, orbits);
    for (const e of this.adaptations.update(this.signature, this.profile,
        { sunCount: this.system.suns.length })) {
      this.log(e.text, e.kind);
    }
    const fx = this.adaptations.effects;

    // Technology shields the population from the climate — so an advanced
    // civilisation literally changes the selection pressure acting on it.
    this.population.update(this.climate, dt, this.civ.protection, fx, this.profile);
    this.civ._memoryAdd = fx.memoryAdd;
    for (const e of this.civ.update(this.population, this.climate, dt, fx)) {
      this.log(e.text, e.kind);
    }
    this.stepCount++;

    this._drainMergeEvents();
    this._trackNarrative();

    if (this.stepCount % this._sampleEvery === 0) this._sample();
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
    if (b === this.system.planet) this.profile.syncPlanet(b);
    this.log(`A ${PLANET_COMPOSITIONS[composition]?.label || 'custom world'} coalesces (${massEarth.toFixed(1)} Earth masses).`, 'cosmic');
    return b;
  }

  syncPlanetProfile() { this.profile.syncPlanet(this.system.planet); }
  _starName() {
    const names = ['Vega', 'Rigel', 'Mira', 'Lyra', 'Orin', 'Nova', 'Cygnus', 'Draco', 'Pyra', 'Zheng'];
    return names[Math.floor(RNG() * names.length)];
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
