/*
 * civilization.js — The second stage: once biology evolves enough
 * intelligence, a civilisation "awakens" and starts accumulating KNOWLEDGE.
 *
 * This is the Three-Body ratchet. Knowledge climbs through named ages while the
 * world stays survivable, and technology increasingly shields the population
 * from the climate (the tech-vs-suns race). But a bad enough Chaotic Era
 * shatters the civilisation into a Dark Age, wiping most of its knowledge — and
 * each rebuild goes faster, because cultural/genetic memory persists. Only a
 * world lucky enough to grant long, calm, productive stretches ever reaches the
 * summit; brutal worlds collapse forever, or breed the costly brains back out
 * entirely and sink back into mere animals.
 *
 * update() returns a list of narrative events for the World to log.
 */

class Civilization {
  constructor() {
    this.reset();
  }

  reset() {
    this.awakened = false;
    this.everAwakened = false;
    this.knowledge = 0;
    this.collapses = 0;
    this.peakPop = 0;
    this.peakTierIdx = 0;      // highest age ever reached (zenith)
    this.transcended = false;
    this._collapseCd = 0;
    this._lastTierIdx = 0;
  }

  get tiers() { return CONFIG.civ.tiers; }

  get tierIdx() {
    let idx = 0;
    for (let i = 0; i < this.tiers.length; i++) if (this.knowledge >= this.tiers[i].k) idx = i;
    return idx;
  }
  get tier() { return this.tiers[this.tierIdx]; }
  get ageName() { return this.awakened ? this.tier.name : (this.everAwakened ? 'Fallen' : '—'); }
  get zenithName() { return this.tiers[this.peakTierIdx].name; }

  // Fraction of climate stress that technology absorbs (0..maxProtection).
  get protection() {
    if (!this.awakened) return 0;
    const frac = this.tierIdx / (this.tiers.length - 1);
    return frac * CONFIG.civ.maxProtection;
  }

  get memoryBonus() {
    return clamp(1 + CONFIG.civ.memoryPerCollapse * this.collapses, 1, CONFIG.civ.memoryCap);
  }

  // Progress toward the NEXT age, 0..1 (for a progress bar).
  get tierProgress() {
    const i = this.tierIdx;
    if (i >= this.tiers.length - 1) return 1;
    const lo = this.tiers[i].k, hi = this.tiers[i + 1].k;
    return clamp((this.knowledge - lo) / (hi - lo), 0, 1);
  }

  update(pop, climate, dt) {
    const cfg = CONFIG.civ;
    const events = [];
    const count = pop.count;
    const avgIntel = pop.avg('intelligence');

    // decaying record of the largest population seen (for collapse detection)
    this.peakPop = Math.max(count, this.peakPop * 0.9997);
    if (this._collapseCd > 0) this._collapseCd--;

    // ---- Awakening ----
    if (!this.awakened) {
      if (avgIntel >= cfg.awakenIntel && count >= cfg.awakenPop && climate.isStable) {
        this.awakened = true;
        this._lastTierIdx = 0;
        if (this.knowledge < this.tiers[0].k + 1) this.knowledge = this.tiers[0].k + 1;
        const again = this.everAwakened;
        this.everAwakened = true;
        events.push({
          text: again
            ? `Sapience re-awakens (${this.collapses} collapses remembered) — the climb resumes, faster.`
            : `★ THE AWAKENING — the species achieves sapience. A civilisation is born.`,
          kind: 'awaken',
        });
      }
      return events;
    }

    // ---- Loss of sapience (brains bred out, or extinction) ----
    if (count === 0) {
      events.push({ text: 'The last of the people is gone. Their knowledge turns to dust.', kind: 'lost' });
      this.reset();
      return events;
    }
    if (avgIntel < cfg.loseIntel) {
      // Survival pressure has selected the expensive brains away.
      events.push({ text: 'Intelligence has been bred out by relentless hardship — the survivors are beasts again.', kind: 'lost' });
      const keepMemory = this.collapses;
      const everA = this.everAwakened;
      this.reset();
      this.collapses = keepMemory;     // genetic predisposition lingers -> faster re-awakening
      this.everAwakened = everA;
      return events;
    }

    // ---- Collapse (Dark Age) ----
    const catastrophic = count < cfg.collapseAbsPop ||
      (!climate.isStable && count < this.peakPop * cfg.collapsePeakFrac && this.tierIdx >= 1);
    if (this._collapseCd <= 0 && catastrophic && this.tierIdx >= 1) {
      const fromAge = this.tier.name;
      this.knowledge *= cfg.collapseKeep;
      this.collapses++;
      this._collapseCd = cfg.collapseCooldown;
      this._lastTierIdx = this.tierIdx;
      events.push({
        text: `☠ COLLAPSE — a Chaotic Era shatters the ${fromAge} civilisation into a Dark Age (collapse #${this.collapses}).`,
        kind: 'collapse',
      });
      return events;
    }

    // ---- Knowledge growth ----
    const popFactor = clamp(count / 200, 0.1, 1.6);
    const prodFactor = 0.2 + 0.8 * climate.productivity;   // science needs surplus
    const stableFactor = climate.isStable ? 1 : 0.10;      // near-halt through chaos
    this.knowledge += cfg.growthRate * popFactor * prodFactor * stableFactor * this.memoryBonus;

    // slow bleed if the population is too small to maintain its knowledge
    if (count < cfg.awakenPop * 0.4) this.knowledge = Math.max(0, this.knowledge - cfg.decayLowPop);

    // ---- Age transitions ----
    const idx = this.tierIdx;
    if (idx > this._lastTierIdx) {
      for (let i = this._lastTierIdx + 1; i <= idx; i++) {
        events.push({ text: `${this.tiers[i].icon} The civilisation enters the ${this.tiers[i].name}.`, kind: 'tierup' });
      }
      this._lastTierIdx = idx;
    } else if (idx < this._lastTierIdx) {
      this._lastTierIdx = idx;
    }
    if (idx > this.peakTierIdx) this.peakTierIdx = idx;

    // ---- Pinnacle (legendary, once) ----
    if (idx >= this.tiers.length - 1 && !this.transcended) {
      this.transcended = true;
      const ord = ordinal(this.collapses + 1);
      events.push({
        text: `🌌 TRANSCENDENCE — after ${this.collapses} collapse${this.collapses === 1 ? '' : 's'}, the ${ord} civilisation masters the suns and launches an escape fleet out of the dying system.`,
        kind: 'pinnacle',
      });
    }
    return events;
  }

  // ---- God interventions ----
  giftKnowledge(amount) { this.knowledge += amount; }
  burnLibrary(frac = 0.7) {
    this.knowledge *= (1 - frac);
    if (this._lastTierIdx > this.tierIdx) this._lastTierIdx = this.tierIdx;
  }
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
