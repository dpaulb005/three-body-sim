/*
 * ui.js — Wires the DOM controls to the World/Renderer and handles pointer
 * interaction on the cosmos canvas (select a body, or drag to launch a new one).
 */

class UI {
  constructor(world, renderer) {
    this.world = world;
    this.renderer = renderer;
    this.bodyType = 'sun';
    this.placeMass = 1.0;
    this.drag = null;   // {startWorld, curWorld}
    this._build();
    this._bindPointer();
    this._bindKeys();
  }

  $(id) { return document.getElementById(id); }

  _build() {
    // Simulation
    this.$('btn-play').onclick = () => this.togglePlay();
    this.$('btn-reset').onclick = () => this.reset();
    this.$('in-speed').oninput = (e) => {
      this.world.speed = +e.target.value;
      this.$('out-speed').textContent = `${this.world.speed}×`;
      if (this.world.speed === 0) this.setPlayLabel(false); else this.setPlayLabel(this.world.running);
    };

    // Presets
    const wrap = this.$('presets');
    PRESETS.forEach((p, i) => {
      const b = document.createElement('button');
      b.textContent = p.name;
      b.onclick = () => this.loadPreset(i);
      wrap.appendChild(b);
    });

    // Body creation
    this.$('body-type').querySelectorAll('button').forEach(btn => {
      btn.onclick = () => {
        this.bodyType = btn.dataset.type;
        this.$('body-type').querySelectorAll('button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      };
    });
    this.$('in-mass').oninput = (e) => {
      this.placeMass = +e.target.value;
      this.$('out-mass').textContent = this.placeMass.toFixed(2);
    };
    this.$('btn-add-center').onclick = () => {
      const com = this.world.system.centerOfMass();
      const off = 2 + RNG() * 3;
      const ang = RNG() * Math.PI * 2;
      const x = com.x + Math.cos(ang) * off, y = com.y + Math.sin(ang) * off;
      if (this.bodyType === 'sun') this.world.addSun(x, y, 0, 0, this.placeMass);
      else this.world.addRogue(x, y, 0, 0, this.placeMass);
    };

    // Selected body editor
    this.$('in-selmass').oninput = (e) => {
      if (!this.renderer.selected) return;
      this.renderer.selected.mass = +e.target.value;
      this.$('out-selmass').textContent = (+e.target.value).toFixed(2);
      this.world.system._invalidateEnergy();
      this.refreshSelected();
    };
    this.$('btn-del').onclick = () => {
      if (!this.renderer.selected) return;
      this.world.system.remove(this.renderer.selected);
      this.world.log('A body was extinguished by divine will.', 'cosmic');
      this.renderer.selected = null;
      this.refreshSelected();
    };

    // Evolution
    this.$('btn-seed').onclick = () => {
      this.world.population.seed(CONFIG.seedCount, this.world.climate.tempC);
      this.world.log('You breathe life into the world.', 'life');
    };
    this.$('btn-burst').onclick = () => {
      this.world.population.burstMutation(6);
      this.world.log('A Cambrian burst — genetic variation explodes.', 'life');
    };
    this.$('in-mut').oninput = (e) => {
      this.world.population.mutationScale = +e.target.value / 100;
      this.$('out-mut').textContent = `${(+e.target.value).toFixed(1)}%`;
    };
    this.$('in-evo').oninput = (e) => {
      this.world.population.evolutionRate = +e.target.value;
      this.$('out-evo').textContent = `${(+e.target.value).toFixed(1)}×`;
    };
    document.querySelectorAll('.nudges button').forEach(btn => {
      btn.onclick = () => {
        const trait = btn.dataset.trait, delta = +btn.dataset.delta;
        this.world.population.nudgeTrait(trait, delta);
        const label = CONFIG.traits[trait].label;
        this.world.log(`Divine edict: ${label} shifted ${delta > 0 ? '+' : ''}${delta}.`, 'life');
      };
    });
    this.$('in-cata').oninput = (e) => {
      this.$('out-cata').textContent = `${e.target.value}%`;
    };
    this.$('btn-extinct').onclick = () => {
      const frac = +this.$('in-cata').value / 100;
      const before = this.world.population.count;
      this.world.population.massExtinction(frac);
      const killed = before - this.world.population.count;
      this.world.log(`Cataclysm! ${killed} organisms wiped out.`, 'death');
    };

    this.setPlayLabel(true);
  }

  loadPreset(i) {
    const p = PRESETS[i];
    this.world.loadPreset(p);
    this.$('preset-blurb').textContent = p.blurb;
    this.$('presets').querySelectorAll('button').forEach((b, j) =>
      b.classList.toggle('active', j === i));
    this.renderer.selected = null;
    this.renderer._camInit = false;   // re-fit camera to new system
    this.refreshSelected();
  }

  reset() {
    // Reload current preset if any, else the first.
    const idx = Math.max(0, PRESETS.findIndex(p => p.name === this.world.presetName));
    this.loadPreset(idx);
  }

  togglePlay() {
    this.world.running = !this.world.running;
    this.setPlayLabel(this.world.running);
  }
  setPlayLabel(playing) {
    this.$('btn-play').textContent = playing ? '⏸ Pause' : '▶ Play';
  }

  // ---- selection panel ----
  refreshSelected() {
    const sel = this.renderer.selected;
    const g = this.$('sel-group');
    if (!sel) { g.classList.add('hidden'); return; }
    g.classList.remove('hidden');
    const lum = sel.type === 'sun' ? `, luminosity ${fmt.sci(sel.luminosity)}` : '';
    this.$('sel-info').innerHTML =
      `<b>${sel.name || sel.type}</b> — ${sel.type}<br>mass ${sel.mass.toFixed(2)}${lum}`;
    const sm = this.$('in-selmass');
    sm.value = clamp(sel.mass, +sm.min, +sm.max);
    this.$('out-selmass').textContent = sel.mass.toFixed(2);
  }

  // ---- pointer interaction ----
  _bindPointer() {
    const cv = this.renderer.cosmos.canvas;
    const pos = (e) => {
      const r = cv.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    cv.addEventListener('pointerdown', (e) => {
      const p = pos(e);
      const hit = this.renderer.pick(p.x, p.y);
      if (hit) {
        this.renderer.selected = hit;
        this.refreshSelected();
        this.drag = null;
      } else {
        // begin placing a new body
        const wpt = this.renderer.screenToWorld(p.x, p.y);
        this.drag = { startWorld: wpt, curWorld: wpt };
        this.renderer.selected = null;
        this.refreshSelected();
        this._updateGhost();
      }
      cv.setPointerCapture(e.pointerId);
    });

    cv.addEventListener('pointermove', (e) => {
      if (!this.drag) return;
      const p = pos(e);
      this.drag.curWorld = this.renderer.screenToWorld(p.x, p.y);
      this._updateGhost();
    });

    const finish = (e) => {
      if (!this.drag) return;
      const s = this.drag.startWorld, c = this.drag.curWorld;
      const k = 0.5; // drag distance -> launch speed
      const vx = (c.x - s.x) * k, vy = (c.y - s.y) * k;
      if (this.bodyType === 'sun') this.world.addSun(s.x, s.y, vx, vy, this.placeMass);
      else this.world.addRogue(s.x, s.y, vx, vy, this.placeMass);
      this.drag = null;
      this.renderer.ghost = null;
    };
    cv.addEventListener('pointerup', finish);
    cv.addEventListener('pointercancel', () => { this.drag = null; this.renderer.ghost = null; });
  }

  _updateGhost() {
    if (!this.drag) { this.renderer.ghost = null; return; }
    const s = this.drag.startWorld, c = this.drag.curWorld;
    const k = 0.5;
    this.renderer.ghost = {
      x: s.x, y: s.y,
      vx: (c.x - s.x) * k, vy: (c.y - s.y) * k,
      mass: this.placeMass, type: this.bodyType,
      get radius() { return this.type === 'sun' ? 0.22 + 0.32 * Math.cbrt(this.mass) : 0.18; },
    };
  }

  _bindKeys() {
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      if (e.code === 'Space') { e.preventDefault(); this.togglePlay(); }
      if (e.key === 'r' || e.key === 'R') this.reset();
      if (e.key === 'l' || e.key === 'L') this.$('btn-seed').click();
    });
  }

  // ---- HUD / readouts (called each frame) ----
  updateHUD() {
    const w = this.world, c = w.climate, p = w.population;
    const eraEl = this.$('stat-era');
    eraEl.textContent = c.era.replace('Chaotic Era — ', '');
    eraEl.style.color = c.isStable ? 'var(--good)' : 'var(--warn)';
    this.$('stat-temp').textContent = fmt.temp(c.tempC);
    this.$('stat-pop').textContent = fmt.int(p.count);
    this.$('stat-gen').textContent = fmt.int(p.generation);
    this.$('stat-suns').textContent = fmt.int(w.system.suns.length);
    this.$('stat-time').textContent = (w.system.time / (2 * Math.PI)).toFixed(1);
    const drift = w.system.energyDrift();
    const de = this.$('stat-energy');
    de.textContent = (drift * 100).toFixed(2) + '%';
    de.style.color = Math.abs(drift) < 0.02 ? 'var(--good)' : Math.abs(drift) < 0.1 ? 'var(--warn)' : 'var(--bad)';

    if (this.renderer.selected) this.refreshSelected();
  }

  updateReadout() {
    const p = this.world.population;
    const el = this.$('readout');
    const traitRow = (key, unit = '') => {
      const t = CONFIG.traits[key];
      const v = p.avg(key);
      const frac = clamp((v - t.min) / (t.max - t.min), 0, 1);
      const col = key === 'optimalTemp' ? tempColor(v)
        : key === 'dormancy' ? 'var(--accent)'
          : 'var(--good)';
      const disp = key === 'optimalTemp' ? fmt.temp(v)
        : key === 'dormancy' ? fmt.pct(v)
          : v.toFixed(1) + unit;
      return `<span class="k">${t.label}</span><span class="v">${disp}</span>` +
        `<span class="bar"><i style="width:${(frac * 100).toFixed(0)}%;background:${col}"></i></span>`;
    };
    el.innerHTML =
      traitRow('optimalTemp') +
      traitRow('tolerance', '°') +
      traitRow('dormancy') +
      traitRow('size') +
      traitRow('metabolism') +
      `<span class="k">Dormant now</span><span class="v">${p.dormantCount}</span>` +
      `<span class="k">Genetic diversity</span><span class="v">${p.diversity('optimalTemp').toFixed(1)}°</span>` +
      `<span class="k">Total births / deaths</span><span class="v">${fmt.int(p.totalBirths)} / ${fmt.int(p.totalDeaths)}</span>`;
  }

  updateLog() {
    const el = this.$('log');
    const evts = this.world.events;
    // Only rebuild when the newest event changes (cheap dedup).
    const key = evts.length ? evts[0].t + evts[0].text : '';
    if (this._logKey === key) return;
    this._logKey = key;
    el.innerHTML = evts.map(e =>
      `<li class="${e.kind}"><b>${(e.t / (2 * Math.PI)).toFixed(1)}</b>${e.text}</li>`).join('');
  }
}
