/*
 * physics.js — Newtonian N-body gravity with a symplectic velocity-Verlet
 * integrator and gravitational softening.
 *
 * Velocity Verlet is chosen over RK4 because it is symplectic: total energy
 * oscillates around the true value instead of drifting, so orbits stay
 * physical across the millions of steps a long game accumulates. Softening
 * (r^2 + eps^2) caps the force during close encounters — essential for the
 * chaotic three-body dance where suns routinely slingshot past each other.
 */

let _bodyId = 1;

class Body {
  constructor({ x, y, vx = 0, vy = 0, mass, type = 'sun', name = '' }) {
    this.id = _bodyId++;
    this.x = x; this.y = y;
    this.vx = vx; this.vy = vy;
    this.ax = 0; this.ay = 0;      // acceleration cache for Verlet
    this.mass = mass;
    this.type = type;              // 'sun' | 'planet' | 'rogue'
    this.name = name;
    this.trail = [];               // recent [x,y] samples for rendering
    this.alive = true;
  }

  get radius() {
    // Visual/collision radius grows sub-linearly with mass.
    if (this.type === 'planet') return 0.18;
    return 0.22 + 0.32 * Math.cbrt(this.mass);
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
    const sub = CONFIG.substeps;
    const h = dt / sub;
    for (let s = 0; s < sub; s++) this._verlet(h);
    this.time += dt;
    this._handleCollisions();
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
    const vmax = CONFIG.maxSpeed;
    for (let i = 0; i < n; i++) {
      const bi = b[i];
      bi.vx += 0.5 * (bi._axOld + bi.ax) * h;
      bi.vy += 0.5 * (bi._ayOld + bi.ay) * h;
      // Safety clamp: chaotic slingshots can otherwise eject a body at absurd speed.
      const sp = Math.hypot(bi.vx, bi.vy);
      if (sp > vmax) { const k = vmax / sp; bi.vx *= k; bi.vy *= k; }
    }
  }

  // Merge suns that physically overlap (inelastic, conserves momentum & mass).
  _handleCollisions() {
    const b = this.bodies;
    for (let i = 0; i < b.length; i++) {
      for (let j = i + 1; j < b.length; j++) {
        const a = b[i], c = b[j];
        if (a.type === 'planet' || c.type === 'planet') continue; // planet handled elsewhere
        const dx = c.x - a.x, dy = c.y - a.y;
        const rr = a.radius + c.radius;
        // Require a genuine deep overlap before merging, so chaotic slingshots
        // and delicate choreographies (figure-8) survive close passes intact.
        if (dx * dx + dy * dy < rr * rr * 0.12) {
          // merge smaller into larger
          const big = a.mass >= c.mass ? a : c;
          const small = big === a ? c : a;
          const m = big.mass + small.mass;
          big.vx = (big.vx * big.mass + small.vx * small.mass) / m;
          big.vy = (big.vy * big.mass + small.vy * small.mass) / m;
          big.x = (big.x * big.mass + small.x * small.mass) / m;
          big.y = (big.y * big.mass + small.y * small.mass) / m;
          big.mass = m;
          this.mergeEvents.push({ survivor: big.name || 'a star', absorbed: small.name || 'a star' });
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
