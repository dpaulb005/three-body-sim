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
    this.stepCount = 0;
    this.presetName = preset.name;
    for (const k in this.hist) this.hist[k] = new History(600);
    this.events.length = 0;
    this._lastEra = null;
    this._milestones.clear();
    this._recordHot = -Infinity; this._recordCold = Infinity;

    preset.build(this);
    // Prime the climate so temperature starts at equilibrium, not a cold start.
    this.climate.update(this.system, 0.0001);
    if (seedLife) {
      this.population.seed(CONFIG.seedCount, this.climate.tempC);
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
    this.climate.update(this.system, dt);
    this.population.update(this.climate, dt);
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
  }

  _drainMergeEvents() {
    const ev = this.system.mergeEvents;
    while (ev.length) {
      const m = ev.shift();
      this.log(`Stars collided: ${m.survivor} absorbed ${m.absorbed}.`, 'cosmic');
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

    // Civilisation milestones by generation depth
    for (const g of [25, 75, 150, 300, 600, 1000]) {
      const key = `gen${g}`;
      if (p.generation >= g && !this._milestones.has(key)) {
        this._milestones.add(key);
        this.log(`Lineage reached ${g} generations — life is adapting.`, 'life');
      }
    }
    // Flourishing
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
    this.system.add(_planet(com.x + r, com.y, 0, vCirc(M, r)));
    this.log('A new world coalesces.', 'cosmic');
  }
}
