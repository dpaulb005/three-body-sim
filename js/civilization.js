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
    const add = this._memoryAdd || 0;
    return clamp(1 + add + CONFIG.civ.memoryPerCollapse * this.collapses, 1, CONFIG.civ.memoryCap + add);
  }

  // Progress toward the NEXT age, 0..1 (for a progress bar).
  get tierProgress() {
    const i = this.tierIdx;
    if (i >= this.tiers.length - 1) return 1;
    const lo = this.tiers[i].k, hi = this.tiers[i + 1].k;
    return clamp((this.knowledge - lo) / (hi - lo), 0, 1);
  }

  update(pop, climate, dt, fx = null) {
    const cfg = CONFIG.civ;
    fx = fx || baseEffects();
    const events = [];
    const count = pop.count;
    const avgIntel = pop.avg('intelligence');

    // decaying record of the largest population seen (for collapse detection)
    this.peakPop = Math.max(count, this.peakPop * 0.9997);
    if (this._collapseCd > 0) this._collapseCd--;

    // ---- Awakening ----
    if (!this.awakened) {
      const need = clamp(cfg.awakenIntel + fx.awakenIntelDelta, 0.15, 0.95);
      if (avgIntel >= need && count >= cfg.awakenPop && climate.isStable) {
        this.awakened = true;
        this._lastTierIdx = 0;
        if (this.knowledge < this.tiers[0].k + 1) this.knowledge = this.tiers[0].k + 1;
        const again = this.everAwakened;
        this.everAwakened = true;
        events.push({
          text: again
            ? `Sapience re-awakens (${this.collapses} collapses remembered) — the climb resumes, faster.`
            : `The Awakening — the species achieves sapience. A civilisation is born.`,
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

    // ---- Symbiosis failure ----
    // A mind assembled from several cooperating lineages ends when the gene
    // pool narrows past the point where those partners still exist.
    if (fx.needsDiversity > 0 && pop.diversity('optimalTemp') < fx.needsDiversity && this.tierIdx >= 1) {
      if (this._collapseCd <= 0) {
        this.knowledge *= cfg.collapseKeep;
        this.collapses++;
        this._collapseCd = cfg.collapseCooldown;
        this._lastTierIdx = this.tierIdx;
        events.push({ text: 'The partnership fails — genetic variety has narrowed past the point where their composite mind can hold together.', kind: 'collapse' });
        return events;
      }
    }

    // ---- Collapse (Dark Age) ----
    const catastrophic = count < cfg.collapseAbsPop ||
      (!climate.isStable && count < this.peakPop * cfg.collapsePeakFrac && this.tierIdx >= 1);
    if (this._collapseCd <= 0 && catastrophic && this.tierIdx >= 1) {
      // Some adaptations let a civilisation ride out what would end another.
      if (fx.collapseResist > 0 && RNG() < fx.collapseResist) {
        this._collapseCd = Math.floor(cfg.collapseCooldown / 2);
        events.push({ text: 'The age should have ended here — but this civilisation held.', kind: 'tierup' });
        return events;
      }
      const fromAge = this.tier.name;
      this.knowledge *= clamp(cfg.collapseKeep + fx.knowledgeKeepBonus, 0, 0.85);
      this.collapses++;
      this._collapseCd = cfg.collapseCooldown;
      this._lastTierIdx = this.tierIdx;
      events.push({
        text: `Collapse — a Chaotic Era shatters the ${fromAge} civilisation into a Dark Age (collapse #${this.collapses}).`,
        kind: 'collapse',
      });
      return events;
    }

    // ---- Knowledge growth ----
    const popFactor = clamp(count / 200, 0.1, 1.6);
    const prodFactor = 0.2 + 0.8 * climate.productivity;   // science needs surplus
    const stableFactor = climate.isStable ? 1 : 0.10;      // near-halt through chaos
    this.knowledge += cfg.growthRate * popFactor * prodFactor * stableFactor
      * this.memoryBonus * fx.knowledgeGrowthMult;

    // slow bleed if the population is too small to maintain its knowledge
    if (count < cfg.awakenPop * 0.4) this.knowledge = Math.max(0, this.knowledge - cfg.decayLowPop);

    // ---- Age transitions ----
    const idx = this.tierIdx;
    if (idx > this._lastTierIdx) {
      for (let i = this._lastTierIdx + 1; i <= idx; i++) {
        events.push({ text: `The civilisation reaches ${this.tiers[i].name}.`, kind: 'tierup' });
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
        text: `Transcendence — after ${this.collapses} collapse${this.collapses === 1 ? '' : 's'}, the ${ord} civilisation masters the suns and launches an escape fleet out of the dying system.`,
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
