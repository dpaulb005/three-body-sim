/*
 * civilization.js — The second stage: once biology evolves enough intelligence,
 * a civilisation awakens and starts accumulating knowledge.
 *
 * A civilisation here is not one number. It has four:
 *
 *   knowledge     what they have worked out. Accumulates; mostly lost in a
 *                 collapse; unlocks the named ages.
 *   innovation    how readily genuinely new ideas appear. Gates the rate at
 *                 which knowledge grows at all.
 *   cohesion      whether the society holds together under strain.
 *   adaptability  how well they cope when conditions change without warning.
 *
 * That split exists so the costs of an adaptation can be real. Perfect recall
 * gives flawless knowledge and destroys cohesion, because nothing is ever
 * forgiven. Inherited memory preserves everything through a dark age and
 * freezes innovation, because the dead ideas are inherited too. Slow, careful
 * thought plans centuries ahead and is annihilated by a change it did not see.
 *
 * So there are four ways to fall, not one:
 *
 *   COLLAPSE    the climate simply kills enough of them  (tests raw survival)
 *   SCHISM      cohesion gives way and the society tears  (tests cohesion)
 *   STAGNATION  innovation dies; knowledge stops moving   (tests innovation)
 *   SHOCK       the world changes faster than they can    (tests adaptability)
 *
 * A species can be extraordinary and still be killed by exactly one of these.
 * That is the point.
 */

const DIM_BASE = { innovation: 0.55, cohesion: 0.60, adaptability: 0.55 };

class Civilization {
  constructor() { this.reset(); }

  reset() {
    this.awakened = false;
    this.everAwakened = false;
    this.knowledge = 0;
    this.collapses = 0;
    this.peakPop = 0;
    this.peakTierIdx = 0;
    this.transcended = false;

    // The three soft dimensions, 0..1.
    this.innovation = DIM_BASE.innovation;
    this.cohesion = DIM_BASE.cohesion;
    this.adaptability = DIM_BASE.adaptability;

    // Named technologies actually unlocked, and their cumulative effect.
    this.techs = new Set();
    this.techFx = techEffects(this.techs);
    this.newTech = null;          // most recent unlock, for the UI
    // What this species is ultimately FOR — derived from its biology, and the
    // reason two civilisations at the same Kardashev level look nothing alike.
    this.telos = TELOI[TELOI.length - 1];
    // Physics, not cleverness: total power commanded, and where that sits on
    // the Kardashev scale.
    this.energyWatts = 0;
    this.kLevel = 0;
    this.peakK = 0;
    // Interference inflicted by a rival (a sophon-style lattice): science stops.
    this.suppressedBy = 0;
    this.suppressTimer = 0;

    this.crises = { schism: 0, stagnation: 0, shock: 0 };
    // Hysteresis: a society that has just torn itself apart cannot immediately
    // do it again. Cohesion must genuinely recover first, otherwise a species
    // with stacked cohesion penalties schisms forever in a loop.
    this._schismArmed = true;
    // Each schism survived teaches the society something about holding
    // together — law, norms, institutions. Without this a species with stacked
    // cohesion penalties simply fractures forever on a loop.
    this._institutions = 0;
    this.stagnant = false;
    this._stagnantFor = 0;
    this._collapseCd = 0;
    this._crisisCd = 0;
    this._lastTierIdx = 0;
    this._memoryAdd = 0;
    this._prevEra = null;
    this._shockTimer = 0;
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

  get protection() {
    if (!this.awakened) return 0;
    const base = (this.tierIdx / (this.tiers.length - 1)) * CONFIG.civ.maxProtection;
    return clamp(base + this.techFx.shield, 0, 0.9);
  }

  /** Whether this civilisation can act at interstellar distance, and how hard. */
  get reach() { return this.techFx.reach; }
  get offense() { return this.techFx.offense; }
  get weapons() { return [...this.techs].map(techById).filter(t => t && t.weapon); }

  get memoryBonus() {
    const add = this._memoryAdd || 0;
    return clamp(1 + add + CONFIG.civ.memoryPerCollapse * this.collapses, 1, CONFIG.civ.memoryCap + add);
  }

  get tierProgress() {
    const i = this.tierIdx;
    if (i >= this.tiers.length - 1) return 1;
    const lo = this.tiers[i].k, hi = this.tiers[i + 1].k;
    return clamp((this.knowledge - lo) / (hi - lo), 0, 1);
  }

  get totalCrises() { return this.crises.schism + this.crises.stagnation + this.crises.shock; }

  get kardashevName() { return kardashevLabel(this.kLevel); }

  /*
   * Total power commanded. Technology sets the ceiling; population decides how
   * much of that ceiling is actually built out — a species that knows how to
   * make a Dyson swarm and numbers four thousand has not made one. The
   * reference point is deliberately Earth-like: eight billion people with heat
   * engines land near 1e13 W, which is roughly where we actually are.
   */
  _updateEnergy(pop) {
    const headcount = pop.headcount || pop.count || 0;
    const deploy = clamp(headcount / 5e9, 0.02, 1);
    // Industry is limited by how many of them there are; a structure already
    // built around the star is not.
    this.energyWatts = this.awakened
      ? this.techFx.power * deploy + this.techFx.powerFixed : 0;
    this.kLevel = kardashev(this.energyWatts);
    this.peakK = Math.max(this.peakK, this.kLevel);
  }

  update(pop, climate, dt, fx = null, adaptations = null, profile = null) {
    const cfg = CONFIG.civ;
    fx = fx || baseEffects();
    const ad = adaptations || { has: () => false };
    const prof = profile || { hydrosphere: 'mixed', radiation: 0 };
    this.telos = telosFor(ad, prof);
    const events = [];
    const count = pop.count;
    const avgIntel = pop.avg('intelligence');

    this.peakPop = Math.max(count, this.peakPop * 0.9997);
    if (this._collapseCd > 0) this._collapseCd--;
    if (this._crisisCd > 0) this._crisisCd--;

    // A sudden era change is what adaptability is actually tested against.
    if (this._prevEra !== null && climate.era !== this._prevEra) this._shockTimer = 260;
    this._prevEra = climate.era;
    if (this._shockTimer > 0) this._shockTimer--;

    // ---- Awakening ----
    if (!this.awakened) {
      const need = clamp(cfg.awakenIntel + fx.awakenIntelDelta, 0.15, 0.95);
      if (avgIntel >= need && count >= cfg.awakenPop && climate.isStable) {
        this.awakened = true;
        this._lastTierIdx = 0;
        this._resetDimensions(fx);
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
      // Nobody is left to run anything, so nothing is being run.
      this.energyWatts = 0;
      this.kLevel = 0;
      return events;
    }

    if (count === 0) {
      events.push({ text: 'The last of the people is gone. Their knowledge turns to dust.', kind: 'lost' });
      this.reset();
      return events;
    }
    if (avgIntel < cfg.loseIntel) {
      events.push({ text: 'Intelligence has been bred out by relentless hardship — the survivors are beasts again.', kind: 'lost' });
      const keep = this.collapses, ever = this.everAwakened;
      this.reset();
      this.collapses = keep; this.everAwakened = ever;
      return events;
    }

    // ---- Technology ----
    // Which techs are even on the table is decided by biology (affinity makes
    // some routes cheap) and by the world (there is no fire underwater).
    for (const t of availableTechs(this, this.techs, ad, prof, this.telos)) {
      this.techs.add(t.id);
      this.techFx = techEffects(this.techs);
      this.newTech = t;
      events.push({ text: `${t.name} — ${t.desc}`, kind: 'tech' });
    }

    // ---- Energy, and the Kardashev thresholds ----
    // These are announced separately from technology because they are not an
    // achievement of cleverness. They are a measurement.
    const prevK = this.kLevel;
    this._updateEnergy(pop);
    for (const step of KARDASHEV_STEPS) {
      if (prevK < step.k && this.kLevel >= step.k) {
        events.push({
          text: `${step.name} — ${step.what} ${this.telos[step.telosKey] || ''}`.trim(),
          kind: 'pinnacle',
        });
      }
    }
    if (this.suppressTimer > 0) this.suppressTimer--;
    else this.suppressedBy = 0;

    this._relaxDimensions(fx, climate, pop, count);

    // ---- The four ways to fall ----
    if (this._checkCrises(events, fx, climate, pop, count, cfg)) return events;

    // ---- Stagnation state (evaluated before growth) ----
    const wasStagnant = this.stagnant;
    this.stagnant = this.innovation < 0.18;
    if (this.stagnant) {
      this._stagnantFor++;
      if (!wasStagnant && this._crisisCd <= 0) {
        this.crises.stagnation++;
        this._crisisCd = 400;
        events.push({
          text: 'Stagnation — no genuinely new idea has appeared in living memory. The civilisation knows a great deal and discovers nothing.',
          kind: 'crisis',
        });
      }
    } else this._stagnantFor = 0;

    // ---- Knowledge growth ----
    // Innovation gates the rate: a society that cannot generate new ideas
    // barely moves, however much it already knows.
    const popFactor = clamp(count / 200, 0.1, 1.6);
    const prodFactor = 0.2 + 0.8 * climate.productivity;
    const stableFactor = climate.isStable ? 1 : 0.10;
    // Below the stagnation floor, knowledge genuinely stops: a society with no
    // new ideas does not slowly advance, it sits still.
    const innovFactor = this.stagnant ? 0.02 : (0.12 + 0.88 * this.innovation);
    // A civilisation whose physics has been corrupted by a rival's lattice
    // cannot advance at all, however clever or numerous it is.
    const suppressed = this.suppressedBy ? 0 : 1;
    this.knowledge += cfg.growthRate * popFactor * prodFactor * stableFactor
      * innovFactor * this.memoryBonus * fx.knowledgeGrowthMult
      * this.techFx.growth * suppressed;

    if (count < cfg.awakenPop * 0.4) this.knowledge = Math.max(0, this.knowledge - cfg.decayLowPop);

    // ---- Ages ----
    const idx = this.tierIdx;
    if (idx > this._lastTierIdx) {
      for (let i = this._lastTierIdx + 1; i <= idx; i++) {
        events.push({ text: `The civilisation reaches ${this.tiers[i].name}.`, kind: 'tierup' });
      }
      this._lastTierIdx = idx;
    } else if (idx < this._lastTierIdx) this._lastTierIdx = idx;
    if (idx > this.peakTierIdx) this.peakTierIdx = idx;

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

  _resetDimensions(fx) {
    this.innovation = clamp(DIM_BASE.innovation + fx.innovation, 0.02, 1);
    this.cohesion = clamp(DIM_BASE.cohesion + fx.cohesion, 0.02, 1);
    this.adaptability = clamp(DIM_BASE.adaptability + fx.adaptability, 0.02, 1);
  }

  // Dimensions drift toward the target their adaptations and circumstances set.
  _relaxDimensions(fx, climate, pop, count) {
    const strain = climate.isStable ? 0 : 0.14;   // hardship frays a society
    const crowd = count < CONFIG.civ.awakenPop * 0.5 ? 0.10 : 0;
    const variety = clamp(pop.diversity('optimalTemp') / 22, 0, 1); // variety feeds ideas

    const tInnov = clamp(DIM_BASE.innovation + fx.innovation + 0.15 * variety
      - this._techOrthodoxy(), 0.02, 1);
    const tCohes = clamp(DIM_BASE.cohesion + fx.cohesion + this._institutions - strain - crowd, 0.02, 1);
    const tAdapt = clamp(DIM_BASE.adaptability + fx.adaptability + 0.12 * variety, 0.02, 1);

    const k = 0.0025;
    this.innovation += (tInnov - this.innovation) * k;
    this.cohesion += (tCohes - this.cohesion) * k;
    this.adaptability += (tAdapt - this.adaptability) * k;
  }

  // The higher a civilisation climbs without falling, the more entrenched its
  // orthodoxy — a gentle drag that makes late-stage stagnation a real risk.
  _techOrthodoxy() { return clamp(this.tierIdx / (this.tiers.length - 1) * 0.30, 0, 0.30); }

  _checkCrises(events, fx, climate, pop, count, cfg) {
    // ── Signature vulnerabilities: the specific way THIS species breaks. ──
    if (this._crisisCd <= 0 && this.tierIdx >= 1) {
      if (fx.unityDependent && count < cfg.awakenPop * 0.45) {
        this.cohesion = clamp(this.cohesion - 0.28, 0.02, 1);
        this._crisisCd = 500;
        events.push({
          text: 'Scattered too thin — a mind that needs its members close together is coming apart.',
          kind: 'crisis',
        });
        return false;
      }
      if (fx.lightDependent && climate.flux < 0.0016) {
        this.knowledge *= 0.94;
        this.adaptability = clamp(this.adaptability - 0.12, 0.02, 1);
        this._crisisCd = 500;
        events.push({
          text: 'The long night starves them — a species that eats light has nothing to eat.',
          kind: 'crisis',
        });
        return false;
      }
    }

    // ── Schism: cohesion gives way. ──
    if (this.cohesion > 0.34) this._schismArmed = true;   // re-arm once healed
    if (this._schismArmed && this._crisisCd <= 0 && this.cohesion < 0.14 && this.tierIdx >= 1) {
      this.crises.schism++;
      this.knowledge *= 0.55;
      // The fracture itself resets the grievance: survivors of a schism are, for
      // a while, a smaller and more united people.
      this.cohesion = clamp(this.cohesion + 0.45, 0.02, 1);
      this._institutions = Math.min(this._institutions + 0.13, 0.5);
      this._schismArmed = false;
      this._crisisCd = 900;
      this._lastTierIdx = this.tierIdx;
      events.push({
        text: 'Schism — the society tears itself apart. Old grievances no one could let go of finally outweighed what they still had in common.',
        kind: 'crisis',
      });
      return true;
    }

    // ── Shock: the world changed faster than they could. ──
    if (this._crisisCd <= 0 && this._shockTimer > 0 && !climate.isStable
        && this.adaptability < 0.22 && this.tierIdx >= 1) {
      this.crises.shock++;
      this.knowledge *= 0.45;
      this._crisisCd = 600;
      this._lastTierIdx = this.tierIdx;
      events.push({
        text: 'Shock — the era turned before they could respond. Their plans assumed a world that no longer exists.',
        kind: 'crisis',
      });
      return true;
    }

    // ── Symbiosis failure ──
    if (fx.needsDiversity > 0 && pop.diversity('optimalTemp') < fx.needsDiversity
        && this.tierIdx >= 1 && this._collapseCd <= 0) {
      this.knowledge *= cfg.collapseKeep;
      this.collapses++;
      this._collapseCd = cfg.collapseCooldown;
      this._lastTierIdx = this.tierIdx;
      events.push({
        text: 'The partnership fails — genetic variety has narrowed past the point where their composite mind can hold together.',
        kind: 'collapse',
      });
      return true;
    }

    // ── Collapse: the climate simply killed enough of them. ──
    const catastrophic = count < cfg.collapseAbsPop ||
      (!climate.isStable && count < this.peakPop * cfg.collapsePeakFrac && this.tierIdx >= 1);
    if (this._collapseCd <= 0 && catastrophic && this.tierIdx >= 1) {
      if (fx.collapseResist > 0 && RNG() < fx.collapseResist) {
        this._collapseCd = Math.floor(cfg.collapseCooldown / 2);
        events.push({ text: 'The age should have ended here — but this civilisation held.', kind: 'tierup' });
        return true;
      }
      const fromAge = this.tier.name;
      this.knowledge *= clamp(cfg.collapseKeep + fx.knowledgeKeepBonus + this.techFx.keep, 0, 0.85);
      this.collapses++;
      this._collapseCd = cfg.collapseCooldown;
      this._lastTierIdx = this.tierIdx;
      events.push({
        text: `Collapse — a Chaotic Era shatters the ${fromAge} civilisation into a Dark Age (collapse #${this.collapses}).`,
        kind: 'collapse',
      });
      return true;
    }
    return false;
  }

  // ---- God interventions ----
  giftKnowledge(amount) { this.knowledge += amount; }
  burnLibrary(frac = 0.7) {
    this.knowledge *= (1 - frac);
    if (this._lastTierIdx > this.tierIdx) this._lastTierIdx = this.tierIdx;
  }
  inspire() { this.innovation = clamp(this.innovation + 0.3, 0, 1); }
  reconcile() { this.cohesion = clamp(this.cohesion + 0.3, 0, 1); }
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
