/*
 * ui.js — Wires the DOM controls to the World/Renderer and handles pointer
 * interaction on the cosmos canvas (select a body, or drag to launch a new one).
 */

class UI {
  constructor(galaxy, renderer) {
    this.galaxy = galaxy;
    this.renderer = renderer;
    this.bodyType = 'sun';
    this.placeMass = 1.0;
    this.placeComposition = 'earth';
    this.drag = null;   // {startWorld, curWorld}
    this._build();
    this._bindPointer();
    this._bindKeys();
  }

  get world() { return this.galaxy.active; }

  $(id) { return document.getElementById(id); }

  _build() {
    // Tabs
    document.querySelectorAll('#tabs button').forEach(btn => {
      btn.onclick = () => {
        document.querySelectorAll('#tabs button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.querySelectorAll('.pane').forEach(p =>
          p.classList.toggle('active', p.dataset.pane === btn.dataset.tab));
        // Canvases inside a hidden pane measure as zero, so anything that just
        // became visible needs measuring again before it is drawn into.
        this.renderer._resizeAll();
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
    for (const [key, value] of Object.entries(PLANET_COMPOSITIONS)) {
      for (const id of ['in-composition', 'in-selcomposition']) {
        const option = document.createElement('option');
        option.value = key; option.textContent = value.label;
        this.$(id).appendChild(option);
      }
    }
    this.$('body-type').querySelectorAll('button').forEach(btn => {
      btn.onclick = () => {
        this.bodyType = btn.dataset.type;
        this.$('body-type').querySelectorAll('button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._configurePlacement();
      };
    });
    this.$('in-mass').oninput = (e) => {
      this.placeMass = +e.target.value;
      this.$('out-mass').textContent = this._massText(this.bodyType, this.placeMass);
    };
    this.$('in-composition').onchange = (e) => { this.placeComposition = e.target.value; };
    this.$('btn-add-center').onclick = () => {
      const com = this.world.system.centerOfMass();
      const off = 2 + RNG() * 3;
      const ang = RNG() * Math.PI * 2;
      const x = com.x + Math.cos(ang) * off, y = com.y + Math.sin(ang) * off;
      this._placeBody(x, y, 0, 0);
    };

    // Selected body editor
    this.$('in-selmass').oninput = (e) => {
      if (!this.renderer.selected) return;
      const sel = this.renderer.selected;
      if (sel.type === 'planet') sel.setMassEarth(+e.target.value);
      else sel.setMassSolar(+e.target.value);
      this.$('out-selmass').textContent = this._massText(sel.type, +e.target.value);
      this.world.system._invalidateEnergy();
      if (sel === this.world.system.planet) this.world.syncPlanetProfile();
      this.refreshSelected();
    };
    this.$('in-selcomposition').onchange = (e) => {
      const sel = this.renderer.selected;
      if (!sel || sel.type !== 'planet') return;
      sel.setComposition(e.target.value);
      if (sel === this.world.system.planet) this.world.syncPlanetProfile();
      this.world.system._invalidateEnergy();
      this.refreshSelected();
    };
    for (const [id, axis] of [['in-selvx', 'vx'], ['in-selvy', 'vy']]) {
      this.$(id).oninput = (e) => {
        if (!this.renderer.selected) return;
        this.renderer.selected[axis] = +e.target.value;
        this.world.system._invalidateEnergy();
        this.refreshSelected();
      };
    }
    this.$('btn-circ').onclick = () => {
      if (!this.renderer.selected) return;
      this.world.circularise(this.renderer.selected);
      this.refreshSelected();
    };
    this.$('btn-halt').onclick = () => {
      const b = this.renderer.selected;
      if (!b) return;
      b.vx = 0; b.vy = 0;
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
      // Proportionate, so a gift still means something to a civilisation whose
      // knowledge is already measured in the hundreds of thousands.
      c.giftKnowledge(Math.max(260, c.knowledge * 0.18));
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

    // ---- World editor ----
    this.editor = new WorldEditor(this);

    const hydro = this.$('hydro');
    hydro.innerHTML = HYDRO.map(x =>
      `<button data-h="${x.v}">${x.label}</button>`).join('');
    hydro.querySelectorAll('button').forEach(btn => {
      btn.onclick = () => {
        this.editor.set('hydrosphere', btn.dataset.h);
        this._syncEditor();
      };
    });

    this.$('world-fields').innerHTML = WORLD_FIELDS.map(f => `
      <div class="field">
        <label for="wf-${f.key}">${f.label}</label>
        <output id="wo-${f.key}"></output>
        <input id="wf-${f.key}" type="range" min="${f.min}" max="${f.max}" step="${f.step}" />
      </div>`).join('');
    for (const f of WORLD_FIELDS) {
      const el = this.$(`wf-${f.key}`);
      el.title = f.hint;
      el.oninput = (e) => {
        this.editor.set(f.key, +e.target.value);
        this._syncEditor();
      };
    }
    this.$('in-tidal').onchange = (e) => {
      this.editor.setTidalLock(e.target.checked);
    };
    this.$('btn-randomise').onclick = () => { this.editor.randomise(); this._syncEditor(); };
    this.$('btn-share').onclick = async () => {
      const url = this.editor.shareURL();
      const note = this.$('share-note');
      try {
        await navigator.clipboard.writeText(url);
        note.textContent = 'Link copied — it carries this exact world.';
      } catch {
        note.textContent = url;   // clipboard blocked: show it to copy by hand
      }
    };

    // ---- Civilisation character interventions ----
    this.$('btn-inspire').onclick = () => {
      const c = this.world.civ;
      if (!c.awakened) { this.world.log('There is no one to inspire.', 'info'); return; }
      c.inspire();
      this.world.log('A generation of heretics is born. Innovation surges.', 'tierup');
    };
    this.$('btn-reconcile').onclick = () => {
      const c = this.world.civ;
      if (!c.awakened) { this.world.log('There is no one to reconcile.', 'info'); return; }
      c.reconcile();
      this.world.log('Old grievances are set down at last. The society knits back together.', 'tierup');
    };

    // ---- Galaxy ----
    this.$('btn-add-world').onclick = () => {
      const w = new World();
      this.galaxy.add(w);
      // A fresh world gets a random preset and a randomised character, so the
      // galaxy fills with places nobody designed.
      w.loadPreset(PRESETS[Math.floor(RNG() * PRESETS.length)]);
      if (RNG() < 0.55) {
        const e = new WorldEditor({ world: w });
        e.randomise();
      }
      this.galaxy.select(this.galaxy.count - 1);
      this.renderer._camInit = false;
      this._syncEditor();
      this.refreshSelected();
    };
    this.$('btn-del-world').onclick = () => {
      if (this.galaxy.count <= 1) {
        this.world.log('This is the only world there is.', 'info');
        return;
      }
      this.galaxy.remove(this.galaxy.activeIndex);
      this.renderer._camInit = false;
      this._syncEditor();
    };

    // ---- Camera ----
    document.querySelectorAll('#viewbar .v-btn[data-view]').forEach(btn => {
      btn.onclick = () => {
        this.renderer.setMode(btn.dataset.view);
        this._syncView();
      };
    });
    this.$('btn-recenter').onclick = () => {
      this.renderer.setMode('planet');
      this._syncView();
    };

    this.setPlayLabel(true);
    this._syncEditor();
  }

  _syncView() {
    document.querySelectorAll('#viewbar .v-btn[data-view]').forEach(b =>
      b.classList.toggle('active', b.dataset.view === this.renderer.cam.mode));
  }

  selectWorld(i) {
    this.galaxy.select(i);
    this.renderer.selected = null;
    this.renderer._camInit = false;
    this.refreshSelected();
    this._syncEditor();
    const p = PRESETS.findIndex(x => x.name === this.world.presetName);
    this.$('preset-blurb').textContent = p >= 0 ? PRESETS[p].blurb : '';
    this.$('presets').querySelectorAll('button').forEach((b, j) =>
      b.classList.toggle('active', j === p));
  }

  // Push profile values back into the editor controls.
  _syncEditor() {
    const p = this.world.profile;
    for (const f of WORLD_FIELDS) {
      const el = this.$(`wf-${f.key}`), out = this.$(`wo-${f.key}`);
      if (!el) continue;
      el.value = p[f.key];
      out.textContent = f.pct ? fmt.pct(p[f.key])
        : p[f.key].toFixed(f.dp === undefined ? 2 : f.dp) + (f.unit || '');
    }
    this.$('hydro').querySelectorAll('button').forEach(b =>
      b.classList.toggle('active', b.dataset.h === p.hydrosphere));
    this.$('in-tidal').checked = !!p.tidalLocked;
  }

  _configurePlacement() {
    const input = this.$('in-mass');
    if (this.bodyType === 'planet') {
      input.min = 0.1; input.max = 1000; input.step = 0.1; this.placeMass = 1;
    } else if (this.bodyType === 'sun') {
      input.min = 0.08; input.max = 4; input.step = 0.01; this.placeMass = 1;
    } else {
      input.min = 0.01; input.max = 3; input.step = 0.01; this.placeMass = 0.1;
    }
    input.value = this.placeMass;
    this.$('out-mass').textContent = this._massText(this.bodyType, this.placeMass);
    this.$('place-composition').classList.toggle('hidden', this.bodyType !== 'planet');
  }

  _massText(type, value) {
    return type === 'planet' ? `${value < 10 ? value.toFixed(1) : value.toFixed(0)} M⊕`
      : `${value.toFixed(2)} M☉`;
  }

  _placeBody(x, y, vx, vy) {
    if (this.bodyType === 'sun') return this.world.addSun(x, y, vx, vy, this.placeMass);
    if (this.bodyType === 'planet') {
      return this.world.addPlanet(x, y, vx, vy, this.placeMass, this.placeComposition);
    }
    return this.world.addRogue(x, y, vx, vy, this.placeMass);
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
    if (this.editor) this._syncEditor();
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
    const lum = sel.type === 'sun' ? ` · luminosity ${fmt.sci(sel.luminosity)}` : '';
    const planet = sel.type === 'planet'
      ? `<br>${PLANET_COMPOSITIONS[sel.compositionKey]?.label || 'Custom mixture'} · density ${sel.density.toFixed(2)} g/cm³ · radius ${sel.radiusEarth.toFixed(2)} R⊕ · gravity ${sel.surfaceGravityG.toFixed(2)}g`
      : '';
    const shownMass = sel.type === 'planet' ? sel.massEarth : sel.mass;
    this.$('sel-info').innerHTML =
      `<b>${sel.name || sel.type}</b> — ${sel.type}<br>mass ${this._massText(sel.type, shownMass)}${lum}${planet}`;
    const sm = this.$('in-selmass');
    if (sel.type === 'planet') { sm.min = 0.1; sm.max = 1000; sm.step = 0.1; }
    else { sm.min = sel.type === 'sun' ? 0.08 : 0.01; sm.max = sel.type === 'sun' ? 4 : 3; sm.step = 0.01; }
    sm.value = clamp(shownMass, +sm.min, +sm.max);
    this.$('out-selmass').textContent = this._massText(sel.type, shownMass);
    this.$('sel-composition').classList.toggle('hidden', sel.type !== 'planet');
    if (sel.type === 'planet' && sel.compositionKey !== 'custom') {
      this.$('in-selcomposition').value = sel.compositionKey;
    }
    for (const [id, out, axis] of [['in-selvx', 'out-selvx', 'vx'], ['in-selvy', 'out-selvy', 'vy']]) {
      const el = this.$(id);
      el.value = clamp(sel[axis], +el.min, +el.max);
      this.$(out).textContent = sel[axis].toFixed(2);
    }
  }

  // ---- pointer interaction ----
  _bindPointer() {
    const cv = this.renderer.cosmos.canvas;
    const pos = (e) => {
      const r = cv.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    cv.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;    // pan buttons are handled separately
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
      this._placeBody(s.x, s.y, vx, vy);
      this.drag = null;
      this.renderer.ghost = null;
    };
    cv.addEventListener('pointerup', finish);
    cv.addEventListener('pointercancel', () => { this.drag = null; this.renderer.ghost = null; });

    // Wheel zooms about the cursor.
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = pos(e);
      this.renderer.zoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12, p.x, p.y);
      this._syncView();
    }, { passive: false });

    // Right or middle drag pans, leaving left-drag free for creating bodies.
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    let panning = null;
    cv.addEventListener('pointerdown', (e) => {
      if (e.button !== 2 && e.button !== 1) return;
      e.preventDefault();
      panning = pos(e);
      cv.setPointerCapture(e.pointerId);
    });
    cv.addEventListener('pointermove', (e) => {
      if (!panning) return;
      const p = pos(e);
      this.renderer.panBy(p.x - panning.x, p.y - panning.y);
      panning = p;
      this._syncView();
    });
    const endPan = () => { panning = null; };
    cv.addEventListener('pointerup', endPan);
    cv.addEventListener('pointercancel', endPan);
  }

  _updateGhost() {
    if (!this.drag) { this.renderer.ghost = null; return; }
    const s = this.drag.startWorld, c = this.drag.curWorld;
    const k = 0.5;
    this.renderer.ghost = {
      x: s.x, y: s.y,
      vx: (c.x - s.x) * k, vy: (c.y - s.y) * k,
      mass: this.bodyType === 'planet' ? this.placeMass * CONFIG.earthMassInSolar : this.placeMass,
      massEarth: this.placeMass, type: this.bodyType, composition: this.placeComposition,
      get radius() {
        if (this.type === 'sun') return 0.22 + 0.32 * Math.cbrt(this.mass);
        if (this.type === 'planet') {
          const density = PLANET_COMPOSITIONS[this.composition].density;
          const radiusEarth = Math.cbrt(this.massEarth * CONFIG.earthDensity / density);
          return 0.13 + 0.05 * Math.cbrt(radiusEarth);
        }
        return 0.18 + 0.12 * Math.cbrt(this.mass);
      },
    };
  }

  _bindKeys() {
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      if (e.code === 'Space') { e.preventDefault(); this.togglePlay(); }
      if (e.key === 'r' || e.key === 'R') this.reset();
      if (e.key === 'l' || e.key === 'L') this.$('btn-seed').click();
      if (e.key === 'f' || e.key === 'F') { this.renderer.setMode('planet'); this._syncView(); }
      if (e.key === 'g' || e.key === 'G') { this.renderer.setMode('system'); this._syncView(); }
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
    // Show the real census; the dots on screen are only a sample of it.
    this.$('stat-pop').textContent = p.headcount >= 1 ? fmt.people(p.headcount) : fmt.int(p.count);
    this.$('stat-pop').title = `${fmt.int(p.count)} organisms shown as a genetic sample`;

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
      // The age is what they know; the Kardashev level is what they can DO.
      // Both are shown because they come apart — a species can know a great
      // deal and command almost nothing, and vice versa.
      status.innerHTML = `<b>${civ.tier.name}</b><br>Knowledge <span class="hl">${fmt.int(civ.knowledge)}</span>` +
        ` · <span class="hl">${civ.kardashevName}</span> <span style="color:var(--ink-3)">${fmt.watts(civ.energyWatts)}</span>`;
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
    const dim = (k, v, col, warn) =>
      `<div class="r-row"><span class="k">${k}</span>` +
      `<span class="v"${warn ? ' style="color:var(--red)"' : ''}>${fmt.pct(v)}</span>` +
      `<span class="bar"><i style="width:${(v * 100).toFixed(0)}%;background:${col}"></i></span></div>`;
    this.$('civ-dims').innerHTML = civ.awakened
      ? dim('Innovation', civ.innovation, 'var(--teal)', civ.innovation < 0.2) +
        dim('Cohesion', civ.cohesion, 'var(--green)', civ.cohesion < 0.22) +
        dim('Adaptability', civ.adaptability, 'var(--amber)', civ.adaptability < 0.22) +
        (civ.stagnant ? `<div class="r-row"><span class="k" style="color:var(--red)">Stagnant — knowledge has stopped moving</span></div>` : '')
      : `<p class="adapt-empty">No civilisation yet.</p>`;
    this.$('civ-facts').innerHTML =
      row('Zenith ever reached', civ.zenithName) +
      (civ.awakened ? row('Energy commanded', fmt.watts(civ.energyWatts)) : '') +
      (civ.awakened ? row('Kardashev', `K ${civ.kLevel.toFixed(2)} · ${civ.kardashevName}`) : '') +
      (civ.awakened ? row('Ultimate goal', civ.telos.name) : '') +
      row('Dark Ages survived', civ.collapses) +
      row('Tech shielding', fmt.pct(civ.protection)) +
      row('Rebuild speed', `${civ.memoryBonus.toFixed(1)}×`) +
      row('Schisms', civ.crises.schism) +
      row('Shocks', civ.crises.shock) +
      row('Stagnations', civ.crises.stagnation);
  }

  // The species dossier: who these people are, read off their real numbers.
  updateDossier() {
    const w = this.world;
    const d = speciesDossier(w);
    const li = (x) => `<li>${x}</li>`;
    this.$('dossier').innerHTML =
      `<div class="dossier">
        <h4>${d.name}</h4>
        <p class="hab">${d.habitatLine}</p>
        ${d.kardashev ? `<p class="hab">${d.kardashev}</p>` : ''}
        <p class="verdict">${d.verdict}</p>
        ${d.telos ? `<p class="telos"><b>${d.telos.name}.</b> ${d.telos.creed}</p>` : ''}
        ${d.strengths.length ? `<div class="sw good"><span>Extraordinary at</span><ul>${d.strengths.map(li).join('')}</ul></div>` : ''}
        ${d.weaknesses.length ? `<div class="sw bad"><span>The price</span><ul>${d.weaknesses.map(li).join('')}</ul></div>` : ''}
      </div>`;
  }

  /*
   * The world panel: what this planet physically IS, and what that makes it
   * like to stand on. Everything here is derived from the bodies in the
   * simulation — mass and makeup give radius and gravity, gravity and
   * temperature give whether it keeps an atmosphere, the orbit gives the year
   * and hence the day. Nothing is a stored decoration.
   */
  _updateWorldPanel(w, prof, sig, row) {
    const geo = w.geography, clim = w.climate, planet = w.system.planet;
    if (!this.$('world-attrs')) return;

    const kindEl = this.$('world-kind');
    if (kindEl) {
      // The preset's own label often already says these things, so only add
       // what it has not said.
      const said = prof.label.toLowerCase();
      kindEl.textContent = [
        prof.label,
        prof.tidalLocked && !said.includes('lock') ? 'tidally locked' : null,
        prof.geothermal > 0.3 && !said.includes('glacial') ? 'vent-warmed' : null,
        prof.radiation > 0.45 && !said.includes('irradiat') ? 'irradiated' : null,
        !w.bound ? 'unbound' : null,
      ].filter(Boolean).join(' · ');
    }

    const zoneEl = this.$('world-zone');
    if (zoneEl) {
      const live = geo.habitableFraction, settled = geo.settledFraction;
      zoneEl.innerHTML = w.population.count === 0
        ? `<b>${geo.habitableZoneLabel()}.</b> ${fmt.pct(live)} of the surface could hold life. Nothing is living there.`
        : settled <= 0
          ? `<b>${geo.habitableZoneLabel()}.</b> ${fmt.pct(live)} of the surface is survivable, but none of it suits <em>this</em> species — they are living on borrowed conditions.`
          : `<b>${geo.habitableZoneLabel()}.</b> ${fmt.pct(live)} of the surface is survivable; this species can occupy ${fmt.pct(settled)} of it.`;
    }

    // A stacked bar of what kind of place this world is, by area.
    const barEl = this.$('world-biomes');
    if (barEl) {
      barEl.innerHTML = geo.biomeBreakdown().map(b => {
        const c = BIOME_COLOR[b.biome] || [110, 110, 110];
        return `<i style="flex:${b.area};background:rgb(${c[0]},${c[1]},${c[2]})" ` +
          `title="${b.label} — ${fmt.pct(b.area)} of the surface"></i>`;
      }).join('');
    }

    const year = w.yearInEarthYears, day = w.dayInHours;
    const pressure = prof.surfacePressureBar(clim.tempC);
    const airLabel = pressure < 0.01 ? 'None — airless'
      : pressure < 0.25 ? `${pressure.toFixed(2)} bar — thin`
        : pressure > 3 ? `${pressure.toFixed(1)} bar — crushing`
          : `${pressure.toFixed(2)} bar`;
    const dayLabel = prof.tidalLocked ? 'None — one face always lit'
      : day === null ? '—'
        : day < 48 ? `${day.toFixed(1)} h`
          : `${(day / 24).toFixed(1)} Earth days`;
    const extremes = geo.locked
      ? row('Substellar → antistellar', `${geo.hottestC.toFixed(0)}°C → ${geo.coldestC.toFixed(0)}°C`,
        'The lit face, the twilight ring and the permanent night side')
      : row('Equator → pole', `${geo.hottestC.toFixed(0)}°C → ${geo.coldestC.toFixed(0)}°C`,
        'Annual mean temperature at the warmest and coldest bands');

    this.$('world-attrs').innerHTML =
      `<div class="r-head">The body</div>` +
      row('Makeup', compositionLabel(planet)) +
      row('Mass', `${prof.planetMassEarth.toFixed(2)} M⊕`) +
      row('Radius', `${prof.radiusEarth.toFixed(2)} R⊕`) +
      row('Density', `${prof.density.toFixed(2)} g/cm³`) +
      row('Surface gravity', `${prof.gravity.toFixed(2)} g`,
        'Derived from mass and radius unless you have overridden it') +
      row('Escape velocity', `${prof.escapeVelocityKmS.toFixed(1)} km/s`,
        'Below about 6× the thermal speed of nitrogen, a world loses its air') +
      row('Atmosphere', airLabel) +

      `<div class="r-head">The sky</div>` +
      row('Suns', fmt.int(w.system.suns.length)) +
      row('Sunlight', `${clim.insolationEarths.toFixed(2)}× Earth`,
        `${Math.round(clim.insolationWm2).toLocaleString()} W/m² at the top of the atmosphere`) +
      row('Year', year === null ? 'None — not bound to any star'
        : year < 1 ? `${(year * 365.25).toFixed(0)} Earth days`
          : `${year.toFixed(1)} Earth years`,
      'From Kepler’s third law and the current orbit') +
      row('Day', dayLabel) +
      row('Axial tilt', prof.tidalLocked ? '—' : `${prof.obliquityDeg.toFixed(0)}°`,
        'What creates seasons. Past about 54° the poles get more annual sun than the equator') +
      (prof.radiation > 0.02 ? row('Radiation', fmt.pct(prof.radiation)) : '') +
      (prof.geothermal > 0 ? row('Internal heat', fmt.pct(prof.geothermal),
        'A floor under temperature and food that owes nothing to any sun') : '') +

      `<div class="r-head">Standing on it</div>` +
      row('Planetary mean', fmt.temp(clim.tempC)) +
      extremes +
      (Math.abs(clim.habitatTempC - clim.tempC) > 1.5
        ? row('Where life is', fmt.temp(clim.habitatTempC),
          'The area-weighted temperature of the habitable bands, not of the globe') : '') +
      row('Habitable surface', fmt.pct(geo.habitableFraction)) +
      row('Occupied by them', fmt.pct(geo.settledFraction),
        'Bands within this species’ own temperature tolerance') +
      row('Thermal swing', `±${sig.tempVolatility.toFixed(1)}°`) +
      row('Habitable time', fmt.pct(sig.stableFrac)) +
      row('Sunless time', fmt.pct(sig.darkFrac));
  }

  // Which evolutionary roads this world has taken, and which it is pushing toward.
  updateAdaptations() {
    const w = this.world, prof = w.profile, sig = w.signature;
    const row = (k, v, title) => `<div class="r-row"${title ? ` title="${title}"` : ''}>` +
      `<span class="k">${k}</span><span class="v">${v}</span></div>`;
    this._updateWorldPanel(w, prof, sig, row);

    const emerged = w.adaptations.list;
    const ctx = { sunCount: w.system.suns.length };
    this.$('adapt-list').innerHTML = emerged.length
      ? emerged.map(a => `<div class="adapt"><span class="grp">${a.group}</span>` +
          `<h4>${a.name}</h4><p>${a.blurb}</p>` +
          `<p class="why">${adaptationReason(a, sig, prof, ctx)}</p>` +
          `<ul class="fx">${adaptationEffectLines(a).map(l => `<li>${l}</li>`).join('')}</ul></div>`).join('')
      : `<p class="adapt-empty">${sig.mature
          ? 'Nothing yet. This world has not pushed life hard enough in any one direction.'
          : 'Too early — the world has not been observed long enough.'}</p>`;

    const press = w.adaptations.pressures(sig, prof, { sunCount: w.system.suns.length }).slice(0, 4);
    this.$('adapt-pressure').innerHTML = press.length
      ? press.map(({ a, p }) => {
          const prog = w.adaptations.progress[a.id];
          return `<div class="adapt pending"><span class="grp">${a.group} · pressure ${fmt.pct(p)}</span>` +
            `<h4>${a.name}</h4>` +
            `<p class="why">${adaptationReason(a, sig, prof, ctx)}</p>` +
            `<div class="track"><i style="width:${(prog * 100).toFixed(0)}%"></i></div></div>`;
        }).join('')
      : `<p class="adapt-empty">No path is under meaningful pressure right now.</p>`;
  }

  // The roster of worlds, and who has heard whom.
  updateGalaxy() {
    const g = this.galaxy;
    this.$('galaxy-count').textContent = g.count === 1 ? 'one' : String(g.count);
    const key = g.worlds.map(w => `${w.id}${w.civ.tierIdx}${w.population.count}${w.contacts.size}`).join('|')
      + '#' + g.activeIndex;
    if (this._galKey !== key) {
      this._galKey = key;
      this.$('galaxy-list').innerHTML = g.worlds.map((w, i) => {
        const civ = w.civ.awakened ? w.civ.tier.name : (w.population.count ? 'pre-sapient' : 'lifeless');
        const rel = w.contacts.size ? `${w.contacts.size} contact${w.contacts.size > 1 ? 's' : ''}` : 'alone';
        const k = w.civ.awakened && w.civ.kLevel >= 0.8 ? ` · ${w.civ.kardashevName}` : '';
        return `<button class="gal-row${i === g.activeIndex ? ' active' : ''}" data-i="${i}">
          <span class="gal-name">${w.starName}</span>
          <span class="gal-sub">${w.profile.label} · ${civ}${k} · pop ${fmt.people(w.population.headcount || w.population.count)} · ${rel}</span>
        </button>`;
      }).join('');
      this.$('galaxy-list').querySelectorAll('.gal-row').forEach(btn => {
        btn.onclick = () => this.selectWorld(+btn.dataset.i);
      });
    }
    const cs = g.contacts;
    this.$('contact-log').innerHTML = cs.length
      ? cs.slice(-6).reverse().map(c => {
          const a = g.worlds.find(w => w.id === c.a), b = g.worlds.find(w => w.id === c.b);
          if (!a || !b) return '';
          const rel = a.relations.get(b.id) || 'wary';
          const arrow = c.kind === 'observed' ? '→' : '↔';
          const label = c.kind === 'observed' && rel === 'observing' ? 'watching, unseen' : rel;
          return `<div class="r-row"><span class="k">${a.starName} ${arrow} ${b.starName}</span>` +
            `<span class="v rel-${rel}">${label}</span></div>`;
        }).join('')
      : `<p class="adapt-empty">No world has heard another. Most never do.</p>`;
  }

  // A full record for every civilisation the player has started.
  updateCivSwitch() {
    const g = this.galaxy;
    const key = g.worlds.map(w => w.id + (w.speciesName || '')).join('|') + '#' + g.activeIndex;
    if (this._switchKey === key) return;
    this._switchKey = key;
    this.$('civ-switch').innerHTML = g.worlds.map((w, i) =>
      `<button class="civ-chip${i === g.activeIndex ? ' active' : ''}" data-i="${i}" title="${w.starName}">${
        w.speciesName || w.starName}</button>`).join('');
    this.$('civ-switch').querySelectorAll('.civ-chip').forEach(btn => {
      btn.onclick = () => this.selectWorld(+btn.dataset.i);
    });
  }

  updateCivRecord() {
    const w = this.world, c = w.civ;
    this.$('civ-headline').innerHTML =
      `<b>${w.speciesName || 'Unnamed'}</b><span>${w.starName} · ${w.presetName}</span>` +
      `<span>${w.orbits.toFixed(0)} orbits elapsed</span>` +
      (c.awakened ? `<span>${c.kardashevName} · ${fmt.watts(c.energyWatts)}</span>` : '');

    const list = w.adaptations.list;
    const ctx2 = { sunCount: w.system.suns.length };
    this.$('civ-traits').innerHTML = list.length
      ? list.map(a => `<div class="adapt"><span class="grp">${a.group}</span><h4>${a.name}</h4>` +
          `<p class="why">${adaptationReason(a, w.signature, w.profile, ctx2)}</p>` +
          `<p><b style="color:var(--green)">Boon.</b> ${a.boon}</p>` +
          `<p><b style="color:var(--red)">Cost.</b> ${a.cost}</p>` +
          `<ul class="fx">${adaptationEffectLines(a).map(l => `<li>${l}</li>`).join('')}</ul></div>`).join('')
      : `<p class="adapt-empty">No divergent evolution yet.</p>`;

    // Technology: what they have built, what is within reach, and — the point
    // of the whole system — WHY this species took this road and not another.
    const have = [...c.techs].map(techById).filter(Boolean);
    const next = upcomingTechs(c, c.techs, w.adaptations, w.profile, c.telos, 2);
    const closed = TECHS.filter(t => !techAvailable(t, w.adaptations, w.profile));
    const affinity = (t) => {
      const f = techCostFactor(t, w.adaptations, w.profile, c.telos);
      if (f <= 0.7) return `<span class="aff cheap">${f.toFixed(2)}× — their biology suits this</span>`;
      if (f >= 1.2) return `<span class="aff dear">${f.toFixed(2)}× — this cuts against what they are</span>`;
      return '';
    };
    this.$('civ-tech').innerHTML =
      (c.awakened
        ? `<div class="tech telos"><span class="grp">Ultimate goal · ${c.kardashevName}</span>` +
          `<h4>${c.telos.name}</h4><p>${c.telos.creed}</p>` +
          `<ul class="fx">` +
          `<li><b>Type I.</b> ${c.telos.typeI}</li>` +
          `<li><b>Type II.</b> ${c.telos.typeII}</li>` +
          `<li><b>Type III.</b> ${c.telos.typeIII}</li></ul></div>` : '') +
      (c.suppressedBy ? `<div class="tech sup"><h4>Science suppressed</h4><p>Their experiments return nonsense. Someone has reached across the dark and taken their physics from them.</p></div>` : '') +
      (have.length
        ? have.map(t => `<div class="tech${t.weapon ? ' weapon' : ''}"><span class="grp">${t.branch}</span>` +
            `<h4>${t.name}</h4><p>${t.desc}</p>${affinity(t)}</div>`).join('')
        : `<p class="adapt-empty">Nothing built yet.</p>`) +
      (next.length && c.awakened
        ? next.map(({ tech, cost }) => `<div class="tech next"><span class="grp">${tech.branch}</span>` +
            `<h4>Next: ${tech.name}</h4>` +
            `<p>Needs ${fmt.int(cost)} knowledge — they have ${fmt.int(c.knowledge)}.</p>` +
            `${affinity(tech)}</div>`).join('') : '') +
      // Roads physically closed to them. This is the honest half of the idea:
      // a species is defined as much by what it can never build.
      (closed.length && c.awakened
        ? `<div class="tech closed"><span class="grp">closed to them</span>` +
          `<h4>${closed.map(t => t.name).join(', ')}</h4>` +
          `<p>Because ${prohibitionReason(w.adaptations, w.profile).join(' and ')}. ` +
          `Whatever these people become, they will get there another way.</p></div>` : '');

    const ms = w.milestones;
    const hkey = w.id + ':' + ms.length;
    if (this._histKey !== hkey) {
      this._histKey = hkey;
      this.$('civ-history').innerHTML = ms.length
        ? ms.slice(-60).reverse().map(m =>
            `<li class="${m.kind}"><time>${m.orbits.toFixed(0)}</time><span>${m.text}</span></li>`).join('')
        : `<li><span class="adapt-empty">Nothing has happened here yet.</span></li>`;
    }
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
