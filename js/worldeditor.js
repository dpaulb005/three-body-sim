/*
 * worldeditor.js — Editing a world's physical character, and sharing it.
 *
 * The profile is not decoration: gravity feeds into upkeep and stress
 * tolerance, hydrosphere into thermal buffering, radiation and rotation into
 * which adaptations can ever emerge, geothermal heat into whether a sunless
 * world is habitable at all. So editing these genuinely re-aims evolution, and
 * every change here is applied live.
 *
 * Sharing encodes the whole world — preset, seed, and every profile value —
 * into the URL fragment. A fragment never reaches the server, so a shared link
 * carries no request and needs no backend.
 */

const WORLD_FIELDS = [
  { key: 'gravity', label: 'Gravity', min: 0.2, max: 4, step: 0.05, unit: 'g',
    hint: 'Sturdier against stress, but everything costs more to build and move.' },
  { key: 'radiation', label: 'Radiation', min: 0, max: 1, step: 0.01, pct: true,
    hint: 'Drives hardening, redundancy and broadcast organs — and jams them.' },
  { key: 'geothermal', label: 'Internal heat', min: 0, max: 1, step: 0.01, pct: true,
    hint: 'A floor under food and temperature. Enough of it makes a sunless world liveable.' },
  { key: 'rotationOrbits', label: 'Rotation period', min: 0.003, max: 1.5, step: 0.005, unit: ' orb',
    hint: 'A very long day selects for slow, near-perfect thought.' },
];

const HYDRO = [
  { v: 'land', label: 'Land' },
  { v: 'ocean', label: 'Ocean' },
  { v: 'ice', label: 'Ice' },
];

class WorldEditor {
  constructor(ui) {
    this.ui = ui;
    this.seed = 0xC0FFEE;
  }

  // Always edits whichever world is currently selected.
  get world() { return this.ui.world; }

  // ---- live edits ----
  set(key, value) {
    this.world.profile[key] = value;
    // Gravity is normally derived from the planet's mass and composition.
    // An explicit edit here claims the override so syncPlanet stops
    // overwriting it on the next physics sync.
    if (key === 'gravity') this.world.profile._gravityOverride = true;
    // Changing the world changes which futures are reachable, so the measured
    // signature and any pressure toward an adaptation are no longer valid.
    this.world.signature = new Signature();
    this.world.log(`The world itself is altered — ${key} is now ${
      typeof value === 'number' ? value.toFixed(2) : value}.`, 'cosmic');
  }

  setTidalLock(on) {
    this.world.profile.tidalLocked = on;
    this.world.signature = new Signature();
  }

  // ---- share links ----
  /** Encode preset + seed + profile into a compact URL fragment. */
  encode() {
    const p = this.world.profile;
    const payload = {
      p: PRESETS.findIndex(x => x.name === this.world.presetName),
      s: this.seed,
      g: +p.gravity.toFixed(2),
      r: +p.radiation.toFixed(2),
      t: +p.geothermal.toFixed(2),
      o: +p.rotationOrbits.toFixed(3),
      h: p.hydrosphere,
      l: p.tidalLocked ? 1 : 0,
      n: p.label,
    };
    return btoa(JSON.stringify(payload)).replace(/=+$/, '');
  }

  shareURL() {
    return `${location.origin}${location.pathname}#w=${this.encode()}`;
  }

  /** Apply a world encoded in the current URL, if any. Returns true if applied. */
  applyFromURL() {
    const m = /[#&]w=([A-Za-z0-9+/]+)/.exec(location.hash || '');
    if (!m) return false;
    try {
      const d = JSON.parse(atob(m[1]));
      const idx = clamp(d.p | 0, 0, PRESETS.length - 1);
      this.seed = d.s >>> 0 || 1;
      reseed(this.seed);
      this.ui.loadPreset(idx);
      const p = this.world.profile;
      if (typeof d.g === 'number') p.gravity = clamp(d.g, 0.2, 4);
      if (typeof d.r === 'number') p.radiation = clamp(d.r, 0, 1);
      if (typeof d.t === 'number') p.geothermal = clamp(d.t, 0, 1);
      if (typeof d.o === 'number') p.rotationOrbits = clamp(d.o, 0.003, 1.5);
      if (typeof d.h === 'string' && HYDRO.some(x => x.v === d.h)) p.hydrosphere = d.h;
      p.tidalLocked = !!d.l;
      if (typeof d.n === 'string') p.label = d.n.slice(0, 40);
      this.world.signature = new Signature();
      this.world.log('A world arrives from elsewhere, exactly as it was made.', 'cosmic');
      return true;
    } catch (err) {
      console.warn('[world] could not decode shared world', err);
      return false;
    }
  }

  /** Randomise into a world nobody has seen before. */
  randomise() {
    const p = this.world.profile;
    p.gravity = +(0.4 + RNG() * 2.6).toFixed(2);
    p._gravityOverride = true;
    p.radiation = +(RNG() * RNG()).toFixed(2);          // biased low, occasionally brutal
    p.geothermal = RNG() < 0.25 ? +(0.4 + RNG() * 0.5).toFixed(2) : 0;
    p.rotationOrbits = RNG() < 0.25 ? +(0.2 + RNG() * 1.2).toFixed(3) : 0.003;
    p.hydrosphere = HYDRO[Math.floor(RNG() * HYDRO.length)].v;
    p.tidalLocked = RNG() < 0.2;
    p.label = 'Uncharted';
    this.world.signature = new Signature();
    this.world.log('An uncharted world condenses out of the dark.', 'cosmic');
  }
}
