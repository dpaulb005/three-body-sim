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
    // Tabs
    document.querySelectorAll('#tabs button').forEach(btn => {
      btn.onclick = () => {
        document.querySelectorAll('#tabs button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.querySelectorAll('.pane').forEach(p =>
          p.classList.toggle('active', p.dataset.pane === btn.dataset.tab));
      };
    });

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
      this.world.population.seed(CONFIG.seedCount, this.world.climate.habitatTempC);
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
    // Civilization interventions
    this.$('btn-gift').onclick = () => {
      const c = this.world.civ;
      if (!c.awakened) { this.world.log('There is no one yet to receive the gift.', 'info'); return; }
      c.giftKnowledge(260);
      this.world.log('A divine insight accelerates the civilisation.', 'tierup');
    };
    this.$('btn-burn').onclick = () => {
      const c = this.world.civ;
      if (!c.awakened) { this.world.log('There is no library to burn.', 'info'); return; }
      c.burnLibrary(0.7);
      this.world.log('You burn their libraries. Centuries of knowledge turn to ash.', 'collapse');
    };

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
    // The transport button swaps its glyph via a body-level class.
    document.body.classList.toggle('paused', !playing);
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
    eraEl.style.color = c.isStable ? 'var(--green)' : 'var(--orange)';
    // Show the habitat temperature when the niche differs from the surface
    // (sub-glacial oceans, tidally locked twilight rings).
    const showsNiche = Math.abs((c.habitatTempC ?? c.tempC) - c.tempC) > 1.5;
    this.$('stat-temp').textContent = fmt.temp(showsNiche ? c.habitatTempC : c.tempC);
    this.$('stat-temp').title = showsNiche
      ? `Habitat ${fmt.temp(c.habitatTempC)} · planetary surface ${fmt.temp(c.tempC)}`
      : '';
    this.$('stat-pop').textContent = fmt.int(p.count);

    const civ = w.civ;
    const intel = p.avg('intelligence');
    const ie = this.$('stat-intel');
    ie.textContent = p.count ? fmt.pct(intel) : '—';
    ie.style.color = intel >= CONFIG.civ.awakenIntel ? 'var(--green)'
      : intel >= 0.35 ? 'var(--orange)' : 'var(--ink-3)';
    const ae = this.$('stat-age');
    ae.textContent = civ.ageName;
    ae.style.color = civ.awakened ? (civ.transcended ? 'var(--orange)' : 'var(--teal)') : 'var(--ink-3)';
    ae.style.fontSize = '12px';
    this.$('stat-collapse').textContent = fmt.int(civ.collapses);
    this.$('stat-suns').textContent = fmt.int(w.system.suns.length);
    this.$('stat-time').textContent = (w.system.time / (2 * Math.PI)).toFixed(1);
    const drift = w.system.energyDrift();
    const de = this.$('stat-energy');
    de.textContent = (drift * 100).toFixed(2) + '%';
    de.style.color = Math.abs(drift) < 0.02 ? 'var(--green)' : Math.abs(drift) < 0.1 ? 'var(--orange)' : 'var(--red)';

    if (this.renderer.selected) this.refreshSelected();
  }

  // The civilization panel: status line, age track, progress, key numbers.
  updateCiv() {
    const w = this.world, civ = w.civ, p = w.population;
    const intel = p.avg('intelligence');
    const status = this.$('civ-status');

    if (!civ.awakened) {
      status.classList.add('asleep');
      if (p.count === 0) {
        status.innerHTML = `<b>No life.</b> Seed a biosphere to begin the experiment.`;
      } else if (civ.everAwakened) {
        status.innerHTML = `<b>Fallen.</b> Sapience was lost — but the potential lingers. ` +
          `Intelligence ${fmt.pct(intel)} / ${fmt.pct(CONFIG.civ.awakenIntel)} needed.`;
      } else {
        const need = [];
        if (intel < CONFIG.civ.awakenIntel) need.push(`intelligence ${fmt.pct(intel)}→${fmt.pct(CONFIG.civ.awakenIntel)}`);
        if (p.count < CONFIG.civ.awakenPop) need.push(`population ${p.count}→${CONFIG.civ.awakenPop}`);
        if (!w.climate.isStable) need.push('a Stable Era');
        status.innerHTML = need.length
          ? `<b>Pre-sapient.</b> Needs ${need.join(', ')}.`
          : `<b>On the brink of sapience…</b>`;
      }
    } else {
      status.classList.remove('asleep');
      status.innerHTML = `<b>${civ.tier.name}</b><br>Knowledge <span class="hl">${fmt.int(civ.knowledge)}</span>`;
    }

    // Age stepper
    const track = this.$('civ-track');
    const key = `${civ.tierIdx}|${civ.peakTierIdx}|${civ.awakened}`;
    if (this._trackKey !== key) {
      this._trackKey = key;
      track.innerHTML = civ.tiers.map((t, i) => {
        const cls = ['step'];
        if (civ.awakened && i === civ.tierIdx) cls.push('current');
        else if (i <= civ.peakTierIdx && civ.everAwakened) cls.push('reached');
        return `<div class="${cls.join(' ')}" title="${t.name}"><i class="dot"></i><span class="lbl">${t.short}</span></div>`;
      }).join('');
    }
    this.$('civ-prog-fill').style.width =
      `${(civ.awakened ? civ.tierProgress * 100 : 0).toFixed(0)}%`;

    const row = (k, v) => `<div class="r-row"><span class="k">${k}</span><span class="v">${v}</span></div>`;
    this.$('civ-facts').innerHTML =
      row('Zenith ever reached', civ.zenithName) +
      row('Dark Ages survived', civ.collapses) +
      row('Tech shielding', fmt.pct(civ.protection)) +
      row('Rebuild speed', `${civ.memoryBonus.toFixed(1)}×`);
  }

  // Which evolutionary roads this world has taken, and which it is pushing toward.
  updateAdaptations() {
    const w = this.world, prof = w.profile, sig = w.signature;
    const row = (k, v) => `<div class="r-row"><span class="k">${k}</span><span class="v">${v}</span></div>`;
    this.$('world-profile').innerHTML =
      row('Type', prof.label) +
      row('Gravity', `${prof.gravity.toFixed(2)}g`) +
      row('Surface', fmt.temp(w.climate.tempC)) +
      (Math.abs(w.climate.habitatTempC - w.climate.tempC) > 1.5
        ? row('Habitat niche', fmt.temp(w.climate.habitatTempC)) : '') +
      row('Radiation', fmt.pct(prof.radiation)) +
      (prof.geothermal > 0 ? row('Geothermal', fmt.pct(prof.geothermal)) : '') +
      row('Thermal swing', `±${sig.tempVolatility.toFixed(1)}°`) +
      row('Habitable time', fmt.pct(sig.stableFrac)) +
      row('Sunless time', fmt.pct(sig.darkFrac));

    const emerged = w.adaptations.list;
    this.$('adapt-list').innerHTML = emerged.length
      ? emerged.map(a => `<div class="adapt"><span class="grp">${a.group}</span>` +
          `<h4>${a.name}</h4><p>${a.blurb}</p></div>`).join('')
      : `<p class="adapt-empty">${sig.mature
          ? 'Nothing yet. This world has not pushed life hard enough in any one direction.'
          : 'Too early — the world has not been observed long enough.'}</p>`;

    const press = w.adaptations.pressures(sig, prof, { sunCount: w.system.suns.length }).slice(0, 4);
    this.$('adapt-pressure').innerHTML = press.length
      ? press.map(({ a, p }) => {
          const prog = w.adaptations.progress[a.id];
          return `<div class="adapt pending"><span class="grp">${a.group} · pressure ${fmt.pct(p)}</span>` +
            `<h4>${a.name}</h4><div class="track"><i style="width:${(prog * 100).toFixed(0)}%"></i></div></div>`;
        }).join('')
      : `<p class="adapt-empty">No path is under meaningful pressure right now.</p>`;
  }

  updateReadout() {
    const p = this.world.population;
    const el = this.$('readout');
    const traitRow = (key, unit = '') => {
      const t = CONFIG.traits[key];
      const v = p.avg(key);
      const frac = clamp((v - t.min) / (t.max - t.min), 0, 1);
      const col = key === 'optimalTemp' ? tempColor(v)
        : key === 'dormancy' ? 'var(--teal)'
          : key === 'intelligence' ? 'var(--amber)'
            : 'var(--green)';
      const disp = key === 'optimalTemp' ? fmt.temp(v)
        : (key === 'dormancy' || key === 'intelligence') ? fmt.pct(v)
          : v.toFixed(1) + unit;
      return `<div class="r-row"><span class="k">${t.label}</span><span class="v">${disp}</span>` +
        `<span class="bar"><i style="width:${(frac * 100).toFixed(0)}%;background:${col}"></i></span></div>`;
    };
    const plain = (k, v) => `<div class="r-row"><span class="k">${k}</span><span class="v">${v}</span></div>`;
    el.innerHTML =
      traitRow('intelligence') +
      traitRow('optimalTemp') +
      traitRow('tolerance', '°') +
      traitRow('dormancy') +
      traitRow('size') +
      traitRow('metabolism') +
      plain('Dormant now', p.dormantCount) +
      plain('Genetic diversity', `${p.diversity('optimalTemp').toFixed(1)}°`) +
      plain('Births / deaths', `${fmt.int(p.totalBirths)} / ${fmt.int(p.totalDeaths)}`);
  }

  updateLog() {
    const el = this.$('log');
    const evts = this.world.events;
    // Only rebuild when the newest event changes (cheap dedup).
    const key = evts.length ? evts[0].t + evts[0].text : '';
    if (this._logKey === key) return;
    this._logKey = key;
    el.innerHTML = evts.map(e =>
      `<li class="${e.kind}"><time>${(e.t / (2 * Math.PI)).toFixed(1)}</time><span>${e.text}</span></li>`).join('');
  }
}
