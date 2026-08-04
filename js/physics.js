/*
 * physics.js — Newtonian N-body gravity with a symplectic velocity-Verlet
 * integrator and physically meaningful stellar/planetary properties.
 *
 * Velocity Verlet is chosen over RK4 because it is symplectic: total energy
 * oscillates around the true value instead of drifting, so orbits stay
 * physical across the millions of steps a long game accumulates. Gravity is
 * exact by default. Optional Plummer softening is available for experiments,
 * but presets use physical radii and merge bodies on contact instead.
 */

let _bodyId = 1;

// Densities are representative zero-pressure values in g/cm^3. A planet's
// mixture is combined by additive volume: 1/rho = sum(massFraction/rho_i).
const PLANET_MATERIALS = Object.freeze({
  iron:     { label: 'Iron', density: 7.87 },
  silicate: { label: 'Silicate rock', density: 3.30 },
  water:    { label: 'Water / ice', density: 1.00 },
  gas:      { label: 'H/He gas', density: 0.20 },
});

const PLANET_COMPOSITIONS = Object.freeze({
  // Reference bulk densities include the compression expected at roughly the
  // characteristic mass of each class. Custom mixtures use additive volume.
  iron:  { label: 'Iron world', density: 7.8, fractions: { iron: 0.90, silicate: 0.10 } },
  rocky: { label: 'Rocky world', density: 4.2, fractions: { iron: 0.20, silicate: 0.80 } },
  earth: { label: 'Earth-like', density: 5.514, fractions: { iron: 0.32, silicate: 0.67, water: 0.01 } },
  ocean: { label: 'Ocean world', density: 2.2, fractions: { iron: 0.10, silicate: 0.30, water: 0.60 } },
  ice:   { label: 'Ice world', density: 1.5, fractions: { silicate: 0.20, water: 0.80 } },
  gas:   { label: 'Gas giant', density: 1.3, fractions: { silicate: 0.03, water: 0.07, gas: 0.90 } },
});

function normaliseComposition(composition = 'earth') {
  const source = typeof composition === 'string'
    ? (PLANET_COMPOSITIONS[composition] || PLANET_COMPOSITIONS.earth).fractions
    : composition;
  let total = 0;
  for (const [material, fraction] of Object.entries(source || {})) {
    if (PLANET_MATERIALS[material] && Number.isFinite(fraction) && fraction > 0) total += fraction;
  }
  if (!(total > 0)) return { ...PLANET_COMPOSITIONS.earth.fractions };
  const result = {};
  for (const [material, fraction] of Object.entries(source)) {
    if (PLANET_MATERIALS[material] && Number.isFinite(fraction) && fraction > 0) {
      result[material] = fraction / total;
    }
  }
  return result;
}

function compositionDensity(composition) {
  const fractions = normaliseComposition(composition);
  let specificVolume = 0;
  for (const [material, fraction] of Object.entries(fractions)) {
    specificVolume += fraction / PLANET_MATERIALS[material].density;
  }
  return 1 / specificVolume;
}

class Body {
  constructor({ x, y, vx = 0, vy = 0, mass, massEarth = null,
    type = 'sun', name = '', composition = 'earth' }) {
    this.id = _bodyId++;
    this.x = x; this.y = y;
    this.vx = vx; this.vy = vy;
    this.ax = 0; this.ay = 0;      // acceleration cache for Verlet
    this.mass = massEarth === null ? mass : massEarth * CONFIG.earthMassInSolar;
    if (!Number.isFinite(this.mass) || this.mass <= 0) throw new RangeError('Body mass must be positive');
    this.type = type;              // 'sun' | 'planet' | 'rogue'
    this.name = name;
    this.compositionKey = typeof composition === 'string' && PLANET_COMPOSITIONS[composition]
      ? composition : 'custom';
    this.composition = normaliseComposition(composition);
    this.trail = [];               // recent [x,y] samples for rendering
    this.alive = true;
  }

  get radius() {
    // Deliberately visible canvas radius. Collision calculations use the much
    // smaller physicalRadius, because an Earth radius is only 0.000043 AU.
    if (this.type === 'planet') return 0.13 + 0.05 * Math.cbrt(this.radiusEarth);
    if (this.type === 'rogue') return 0.18 + 0.12 * Math.cbrt(this.mass);
    return 0.22 + 0.32 * Math.cbrt(this.mass);
  }

  get massEarth() { return this.mass / CONFIG.earthMassInSolar; }

  get density() {
    if (this.type !== 'planet') return null;
    return PLANET_COMPOSITIONS[this.compositionKey]?.density || compositionDensity(this.composition);
  }

  get radiusEarth() {
    if (this.type !== 'planet') return null;
    return Math.cbrt(this.massEarth * CONFIG.earthDensity / this.density);
  }

  get physicalRadius() {
    if (this.type === 'sun') return CONFIG.solarRadiusAU * Math.pow(this.mass, 0.8);
    if (this.type === 'planet') return CONFIG.earthRadiusAU * this.radiusEarth;
    // A rogue is an unlit compact gravitating object; use a small collision
    // radius without claiming a particular internal composition.
    return CONFIG.solarRadiusAU * 0.1 * Math.cbrt(this.mass);
  }

  get surfaceGravityG() {
    if (this.type !== 'planet') return null;
    return this.massEarth / (this.radiusEarth * this.radiusEarth);
  }

  setMassSolar(mass) {
    if (!Number.isFinite(mass) || mass <= 0) throw new RangeError('Body mass must be positive');
    this.mass = mass;
  }

  setMassEarth(massEarth) { this.setMassSolar(massEarth * CONFIG.earthMassInSolar); }

  setComposition(composition) {
    this.compositionKey = typeof composition === 'string' && PLANET_COMPOSITIONS[composition]
      ? composition : 'custom';
    this.composition = normaliseComposition(composition);
  }

  get luminosity() {
    if (this.type !== 'sun') return 0;
    return CONFIG.lumPerMass * Math.pow(this.mass, CONFIG.lumExp);
  }
}

class NBodySystem {
  constructor() {
    this.bodies = [];
    this.time = 0;
    this.energy0 = null;   // reference energy for drift reporting
    this.mergeEvents = [];  // pending merge notifications for the UI
  }

  add(body) { this.bodies.push(body); this._invalidateEnergy(); return body; }

  remove(body) {
    const i = this.bodies.indexOf(body);
    if (i >= 0) this.bodies.splice(i, 1);
    this._invalidateEnergy();
  }

  clear() { this.bodies.length = 0; this.time = 0; this.energy0 = null; }

  get suns() { return this.bodies.filter(b => b.type === 'sun'); }
  get planet() { return this.bodies.find(b => b.type === 'planet') || null; }

  _invalidateEnergy() { this.energy0 = null; }

  recenter() {
    const com = this.centerOfMass();
    const momentum = this.totalMomentum();
    const mass = this.bodies.reduce((sum, body) => sum + body.mass, 0);
    if (!(mass > 0)) return;
    for (const body of this.bodies) {
      body.x -= com.x; body.y -= com.y;
      body.vx -= momentum.x / mass; body.vy -= momentum.y / mass;
    }
    this._invalidateEnergy();
  }

  // Compute acceleration on every body from every other body (O(n^2)).
  computeAccelerations() {
    const b = this.bodies, n = b.length, G = CONFIG.G;
    const eps2 = CONFIG.softening * CONFIG.softening;
    for (let i = 0; i < n; i++) { b[i].ax = 0; b[i].ay = 0; }
    for (let i = 0; i < n; i++) {
      const bi = b[i];
      for (let j = i + 1; j < n; j++) {
        const bj = b[j];
        let dx = bj.x - bi.x, dy = bj.y - bi.y;
        const r2 = dx * dx + dy * dy + eps2;
        if (r2 === 0) continue;
        const invR = 1 / Math.sqrt(r2);
        const invR3 = invR * invR * invR;
        const f = G * invR3;
        bi.ax += f * bj.mass * dx; bi.ay += f * bj.mass * dy;
        bj.ax -= f * bi.mass * dx; bj.ay -= f * bi.mass * dy;
      }
    }
  }

  // Advance by dt using velocity Verlet, split into substeps for stability.
  step(dt) {
    for (const body of this.bodies) {
      body._stepXOld = body.x; body._stepYOld = body.y;
    }
    const sub = this._substepCount(dt);
    const h = dt / sub;
    for (let s = 0; s < sub; s++) this._verlet(h);
    this.time += dt;
    this._handleCollisions(true);
  }

  // Ordinary systems stay at the cheap baseline. Refinement activates only
  // during a close encounter, where the local gravitational timescale becomes
  // shorter than the normal Verlet step.
  _substepCount(dt) {
    let needed = CONFIG.substeps;
    for (let i = 0; i < this.bodies.length; i++) {
      const a = this.bodies[i];
      for (let j = i + 1; j < this.bodies.length; j++) {
        const b = this.bodies[j];
        const r = Math.hypot(b.x - a.x, b.y - a.y);
        if (!(r > 0)) return CONFIG.maxSubsteps;
        const dynamicalTime = Math.sqrt(r * r * r / (CONFIG.G * (a.mass + b.mass)));
        const pairNeeded = Math.ceil(dt / (CONFIG.encounterResolution * dynamicalTime));
        if (pairNeeded > needed) needed = pairNeeded;
      }
    }
    return Math.min(needed, CONFIG.maxSubsteps);
  }

  _verlet(h) {
    const b = this.bodies, n = b.length;
    if (n === 0) return;
    this.computeAccelerations();
    // half-drift using current accel, full position update
    for (let i = 0; i < n; i++) {
      const bi = b[i];
      bi.x += bi.vx * h + 0.5 * bi.ax * h * h;
      bi.y += bi.vy * h + 0.5 * bi.ay * h * h;
      bi._axOld = bi.ax; bi._ayOld = bi.ay;
    }
    this.computeAccelerations();
    for (let i = 0; i < n; i++) {
      const bi = b[i];
      bi.vx += 0.5 * (bi._axOld + bi.ax) * h;
      bi.vy += 0.5 * (bi._ayOld + bi.ay) * h;
    }
  }

  // Perfectly inelastic contact. Mass, linear momentum, and centre of mass are
  // conserved. This is intentionally simple: fragmentation is outside scope.
  _handleCollisions(swept = false) {
    const b = this.bodies;
    for (let i = 0; i < b.length; i++) {
      for (let j = i + 1; j < b.length; j++) {
        const a = b[i], c = b[j];
        const dx = c.x - a.x, dy = c.y - a.y;
        const rr = a.physicalRadius + c.physicalRadius;
        let distance2 = dx * dx + dy * dy;
        if (swept) {
          // Closest point of the relative-motion segment over this full step.
          // This prevents a fast body tunnelling through another between frames.
          const oldDx = c._stepXOld - a._stepXOld;
          const oldDy = c._stepYOld - a._stepYOld;
          const travelX = dx - oldDx, travelY = dy - oldDy;
          const travel2 = travelX * travelX + travelY * travelY;
          const t = travel2 > 0 ? Math.max(0, Math.min(1,
            -(oldDx * travelX + oldDy * travelY) / travel2)) : 1;
          const closeX = oldDx + travelX * t, closeY = oldDy + travelY * t;
          distance2 = closeX * closeX + closeY * closeY;
        }
        if (distance2 <= rr * rr) {
          // merge smaller into larger
          const massA = a.mass, massC = c.mass;
          const big = a.mass >= c.mass ? a : c;
          const small = big === a ? c : a;
          const m = big.mass + small.mass;
          big.vx = (big.vx * big.mass + small.vx * small.mass) / m;
          big.vy = (big.vy * big.mass + small.vy * small.mass) / m;
          big.x = (big.x * big.mass + small.x * small.mass) / m;
          big.y = (big.y * big.mass + small.y * small.mass) / m;
          big.mass = m;
          // A star remains a star; otherwise retain the larger body's type and
          // composition. Planet-planet mergers mix composition by mass.
          if (a.type === 'sun' || c.type === 'sun') big.type = 'sun';
          else if (a.type === 'planet' && c.type === 'planet') {
            const mixed = {};
            for (const material of Object.keys(PLANET_MATERIALS)) {
              mixed[material] = ((a.composition[material] || 0) * massA +
                (c.composition[material] || 0) * massC) / m;
            }
            big.setComposition(mixed);
          }
          this.mergeEvents.push({ survivor: big.name || 'a body', absorbed: small.name || 'a body' });
          this.remove(small);
          this._invalidateEnergy();
          return; // re-evaluate next frame
        }
      }
    }
  }

  // Total mechanical energy (KE + PE). Used to report integrator drift.
  totalEnergy() {
    const b = this.bodies, n = b.length, G = CONFIG.G;
    const eps2 = CONFIG.softening * CONFIG.softening;
    let ke = 0, pe = 0;
    for (let i = 0; i < n; i++) {
      const bi = b[i];
      ke += 0.5 * bi.mass * (bi.vx * bi.vx + bi.vy * bi.vy);
      for (let j = i + 1; j < n; j++) {
        const bj = b[j];
        const dx = bj.x - bi.x, dy = bj.y - bi.y;
        pe -= G * bi.mass * bj.mass / Math.sqrt(dx * dx + dy * dy + eps2);
      }
    }
    return ke + pe;
  }

  energyDrift() {
    const e = this.totalEnergy();
    if (this.energy0 === null) { this.energy0 = e; return 0; }
    if (Math.abs(this.energy0) < 1e-9) return 0;
    return (e - this.energy0) / Math.abs(this.energy0);
  }

  totalMomentum() {
    let x = 0, y = 0;
    for (const body of this.bodies) {
      x += body.mass * body.vx;
      y += body.mass * body.vy;
    }
    return { x, y };
  }

  angularMomentum() {
    let z = 0;
    for (const body of this.bodies) z += body.mass * (body.x * body.vy - body.y * body.vx);
    return z;
  }

  // Centre of mass (used to keep the view anchored).
  centerOfMass() {
    let mx = 0, my = 0, m = 0;
    for (const b of this.bodies) { mx += b.x * b.mass; my += b.y * b.mass; m += b.mass; }
    return m > 0 ? { x: mx / m, y: my / m } : { x: 0, y: 0 };
  }

  updateTrails() {
    for (const b of this.bodies) {
      b.trail.push([b.x, b.y]);
      if (b.trail.length > CONFIG.trailLength) b.trail.shift();
    }
  }
}
