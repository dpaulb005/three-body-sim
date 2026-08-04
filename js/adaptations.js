/*
 * adaptations.js — Divergent evolutionary paths.
 *
 * The point of this file is that an adaptation is never decoration. Each one:
 *
 *   1. is GATED on the world actually having been a certain way — measured over
 *      time from the Signature, not from a one-off dice roll at world creation;
 *   2. accumulates PRESSURE while those conditions hold, so it takes real time
 *      and can stall if the world changes character;
 *   3. carries MECHANICAL EFFECTS that change how the simulation runs
 *      afterwards.
 *
 * That is the same contract dormancy already had — a chaotic sky selects for
 * dehydration because dehydration genuinely helps — extended to seventeen more
 * ways of being alive. A world that is merely *hot* and a world that is hot,
 * dark, and irradiated will not produce the same species.
 *
 * Adaptations compete: only `maxAdaptations` can ever emerge on one world, and
 * members of the same `group` are mutually exclusive, so no run collects them
 * all. Two identical star systems can still diverge, because emergence is
 * probabilistic once the gate is open.
 */

// Neutral effect baseline. Every adaptation states only what it changes.
function baseEffects() {
  return {
    // — biology —
    intelUpkeepMult: 1,     // cost of carrying a brain
    intelReproTaxMult: 1,   // penalty of long childhoods
    reproMult: 1,
    deathMult: 1,
    stressRelief: 0,        // extra 0..1 shielding from thermal stress
    dormancyDrainMult: 1,   // energy burn while dormant
    redundancy: 0,          // 0..1 chance a lethal event is survived
    lightProductivity: 0,   // 0..1 blend toward flux-driven, not temp-driven, food
    mutationMult: 1,
    // — civilisation —
    knowledgeKeepBonus: 0,  // added to the fraction surviving a collapse
    knowledgeGrowthMult: 1,
    awakenIntelDelta: 0,    // shifts the sapience threshold
    collapseResist: 0,      // 0..1 chance a collapse is shrugged off
    memoryAdd: 0,           // extra rebuild speed
    needsDiversity: 0,      // genetic diversity floor; below it, the whole thing fails
  };
}

// gate(sig, prof) returns 0..1 — how hard this world is pushing this way.
// Anything at or below 0 never emerges.
const ADAPTATIONS = [
  {
    id: 'distributed', name: 'Distributed Consciousness', group: 'selfhood',
    blurb: 'Mind spread across many bodies. Losing one is losing a finger, not dying — but nothing about them is an individual.',
    gate: (s) => Math.min(s.chaos * 1.3, s.tempVolatility / 30),
    effects: { redundancy: 0.45, reproMult: 0.75, knowledgeGrowthMult: 1.1 },
  },
  {
    id: 'reversible', name: 'Reversible Intelligence', group: 'brain',
    blurb: 'Nervous tissue is grown in abundance and reabsorbed in famine. They lapse into animals for decades, then regrow their minds from stored tissue.',
    gate: (s) => (s.stableFrac > 0.15 && s.stableFrac < 0.8) ? clamp(s.eraChurn / 1.1, 0, 1) : 0,
    effects: { intelUpkeepMult: 0.4, knowledgeGrowthMult: 0.85, knowledgeKeepBonus: 0.08 },
  },
  {
    id: 'biostorage', name: 'Biological Data Storage', group: 'memory',
    blurb: 'Knowledge is encoded into heritable molecules. Parents pass understanding directly to offspring; the libraries are alive and history is inherited, not taught.',
    gate: (s) => clamp((s.eraChurn / 0.9) * 0.8 + (1 - s.stableFrac) * 0.4, 0, 1),
    effects: { knowledgeKeepBonus: 0.34, memoryAdd: 0.5, knowledgeGrowthMult: 0.92 },
  },
  {
    id: 'slowthought', name: 'Time-Delayed Thinking', group: 'tempo',
    blurb: 'Thought unfolds over months and is almost never wrong. They plan in centuries. To them, we would look recklessly impulsive.',
    gate: (s, p) => Math.max(clamp(p.rotationOrbits / 0.9, 0, 1), s.stableFrac > 0.9 ? 0.55 : 0),
    effects: { knowledgeGrowthMult: 1.55, reproMult: 0.7, collapseResist: 0.2, mutationMult: 0.7 },
  },
  {
    id: 'emcomm', name: 'Electromagnetic Communication', group: 'signal',
    blurb: 'Organs that broadcast and receive. Cities think in unison, and lying is nearly impossible when everyone reads the field.',
    gate: (s, p) => clamp(p.radiation * 1.6, 0, 1),
    effects: { knowledgeGrowthMult: 1.4, awakenIntelDelta: -0.05, collapseResist: 0.12 },
  },
  {
    id: 'hivemind', name: 'Seasonal Collective Mind', group: 'selfhood',
    blurb: 'For part of every cycle their nervous systems fuse and the civilisation becomes one mind. Politics simply ceases to exist during merge season.',
    gate: (s) => (s.stableFrac > 0.25 && s.stableFrac < 0.75) ? clamp(s.eraChurn / 1.0, 0, 1) * 0.9 : 0,
    effects: { knowledgeGrowthMult: 1.7, collapseResist: 0.25, reproMult: 0.85, needsDiversity: 4 },
  },
  {
    id: 'programmable', name: 'Programmable Bodies', group: 'morphology',
    blurb: 'No permanent organs. Wings when they must fly, gills when they must swim, more neural tissue when they must think. Flexibility beats specialisation.',
    gate: (s) => clamp(Math.min(s.tempVolatility / 26, s.chaos * 1.2), 0, 1),
    effects: { stressRelief: 0.22, mutationMult: 1.6, reproMult: 0.85, deathMult: 0.85 },
  },
  {
    id: 'photosynth', name: 'Photosynthetic Intelligence', group: 'metabolism',
    blurb: 'They eat light. Days pass motionless, metabolic needs are trivial, and their wars are fought over shade rather than food.',
    gate: (s) => (s.fluxMean > 0.0055 && s.stableFrac > 0.5) ? clamp(s.fluxMean / 0.011, 0, 1) : 0,
    effects: { lightProductivity: 0.65, intelUpkeepMult: 0.55, reproMult: 0.8, deathMult: 0.9 },
  },
  {
    id: 'crystals', name: 'Memory Crystals', group: 'memory',
    blurb: 'Memory is mineral, not neural. It can be cut out, handed over, installed. Education is not teaching — it is transfer.',
    gate: (s, p) => (s.meanTempC < 6 || p.hydrosphere === 'ice')
      ? clamp((6 - s.meanTempC) / 30 + (p.hydrosphere === 'ice' ? 0.45 : 0), 0, 1) : 0,
    effects: { knowledgeKeepBonus: 0.3, knowledgeGrowthMult: 1.25, memoryAdd: 0.35 },
  },
  {
    id: 'symbiotic', name: 'Symbiotic Intelligence', group: 'selfhood',
    blurb: 'No single organism here is intelligent. Mind is what happens when several species cooperate — and it ends the moment one of them is lost.',
    gate: (s) => (s.stableFrac > 0.4) ? clamp(s.stableFrac * 0.7, 0, 1) : 0,
    effects: { awakenIntelDelta: -0.1, knowledgeGrowthMult: 1.3, needsDiversity: 7, deathMult: 1.1 },
  },
  {
    id: 'redundancy', name: 'Extreme Redundancy', group: 'morphology',
    blurb: 'Every organ exists three times over, the genome keeps dozens of backups, and the brain rebuilds itself continuously. They are extraordinarily hard to kill.',
    gate: (s, p) => clamp(p.radiation * 1.4 + s.chaos * 0.35, 0, 1),
    effects: { deathMult: 0.55, redundancy: 0.25, reproMult: 0.8, intelUpkeepMult: 1.15 },
  },
  {
    id: 'chemself', name: 'Chemical Personalities', group: 'brain',
    blurb: 'Cognition is chosen. An individual becomes a mathematician, a soldier, an artist by rebalancing their own chemistry. Identity is a setting.',
    gate: (s) => (s.stableFrac > 0.35) ? clamp(s.stableFrac * 0.55 + s.tempVolatility / 60, 0, 1) : 0,
    effects: { knowledgeGrowthMult: 1.35, mutationMult: 1.25, reproMult: 0.92 },
  },
  {
    id: 'dreamers', name: 'Sleep Evolution', group: 'tempo',
    blurb: 'Nine tenths of life is spent asleep, dreaming collectively. Their science advances almost entirely while nobody is awake.',
    gate: (s) => clamp(s.darkFrac * 2.2, 0, 1),
    effects: { dormancyDrainMult: 0.45, knowledgeGrowthMult: 1.3, reproMult: 0.85, stressRelief: 0.1 },
  },
  {
    id: 'empathic', name: 'Emotional Evolution', group: 'social',
    blurb: 'Perfect empathy, wired in: to injure another is to feel it yourself. Crime never evolved here because it was never survivable.',
    gate: (s) => (s.stableFrac > 0.55) ? clamp((s.stableFrac - 0.55) * 2.1, 0, 1) : 0,
    effects: { collapseResist: 0.35, knowledgeGrowthMult: 1.18, deathMult: 0.9 },
  },
  {
    id: 'topology', name: 'Four-Dimensional Spatial Sense', group: 'brain',
    blurb: 'Raised under a sky whose motion has no closed solution, they simply see the shape of it. Topologies we need mathematics to approach are as obvious to them as a face.',
    gate: (s, p, ctx) => (ctx.sunCount >= 3) ? clamp(s.chaos * 1.25, 0, 1) : 0,
    effects: { knowledgeGrowthMult: 1.45, collapseResist: 0.3, awakenIntelDelta: 0.04 },
  },
  {
    id: 'quantum', name: 'Quantum Dormancy', group: 'metabolism',
    blurb: 'Rather than resist a lethal era, they suspend almost all activity and hold their molecular structure intact for centuries — skipping catastrophes entirely.',
    gate: (s, p) => clamp(Math.max((s.maxTempC - 70) / 60, 0) + p.radiation * 0.8, 0, 1),
    effects: { dormancyDrainMult: 0.12, stressRelief: 0.18, knowledgeKeepBonus: 0.12, reproMult: 0.9 },
  },
  {
    id: 'predictive', name: 'Predictive Evolution', group: 'signal',
    blurb: 'Enormous cognitive resources spent on patterns spanning millennia. They appear prophetic, though they are only extrapolating.',
    gate: (s, p, ctx) => (s.stableFrac > 0.8 && ctx.sunCount <= 2) ? clamp((s.stableFrac - 0.8) * 4, 0, 1) : 0,
    effects: { knowledgeGrowthMult: 1.4, collapseResist: 0.3, intelUpkeepMult: 1.2 },
  },
  {
    id: 'castes', name: 'Evolutionary Castes', group: 'morphology',
    blurb: 'One life, several species. Each individual passes through explorer, builder, scientist and reproducer — a different body and a different mind at every stage.',
    gate: (s) => clamp(s.eraChurn / 1.2 * 0.85, 0, 1),
    effects: { reproMult: 1.25, knowledgeGrowthMult: 1.22, deathMult: 0.9, intelReproTaxMult: 0.7 },
  },
];

const ADAPT_CONFIG = {
  maxAdaptations: 4,     // no world collects them all
  pressureRate: 0.00040, // progress per step at full pressure
  minPressure: 0.30,     // below this the world simply is not pushing that way
  chanceScale: 0.55,     // randomises which of several open gates actually fires
};

class AdaptationSet {
  constructor() { this.reset(); }

  reset() {
    this.progress = {};     // id -> 0..1
    this.emerged = [];      // ids, in order of emergence
    this.effects = baseEffects();
    // A per-world affinity, rolled once. Two worlds with identical climates
    // still travel different evolutionary roads — which is the point.
    this.affinity = {};
    for (const a of ADAPTATIONS) {
      this.progress[a.id] = 0;
      this.affinity[a.id] = 0.35 + RNG() * 1.5;
    }
  }

  has(id) { return this.emerged.includes(id); }
  get list() { return this.emerged.map(id => ADAPTATIONS.find(a => a.id === id)); }

  // The gates that are currently open but not yet realised — shown in the UI so
  // the player can see what the world is pushing toward.
  pressures(sig, prof, ctx) {
    if (!sig.mature) return [];
    const usedGroups = new Set(this.list.map(a => a.group));
    return ADAPTATIONS
      .filter(a => !this.has(a.id) && !usedGroups.has(a.group))
      .map(a => ({ a, p: clamp(a.gate(sig, prof, ctx) || 0, 0, 1) }))
      .filter(x => x.p >= ADAPT_CONFIG.minPressure)
      .sort((x, y) => (this.progress[y.a.id] - this.progress[x.a.id])
        || (y.p * this.affinity[y.a.id] - x.p * this.affinity[x.a.id]));
  }

  update(sig, prof, ctx) {
    const events = [];
    if (!sig.mature) return events;
    if (this.emerged.length >= ADAPT_CONFIG.maxAdaptations) return events;

    for (const { a, p } of this.pressures(sig, prof, ctx)) {
      // Randomised gain, so two identical worlds still diverge.
      const gain = ADAPT_CONFIG.pressureRate * p * this.affinity[a.id]
        * (1 - ADAPT_CONFIG.chanceScale + ADAPT_CONFIG.chanceScale * 2 * RNG());
      this.progress[a.id] = clamp(this.progress[a.id] + gain, 0, 1);
      if (this.progress[a.id] >= 1) {
        this.emerged.push(a.id);
        this._recompute();
        events.push({ text: `Divergent evolution — ${a.name}. ${a.blurb}`, kind: 'adapt' });
        break; // one at a time, so the chronicle reads clearly
      }
    }
    return events;
  }

  // God can force one directly.
  force(id) {
    if (this.has(id)) return null;
    const a = ADAPTATIONS.find(x => x.id === id);
    if (!a) return null;
    // Forcing overrides exclusivity by displacing the rival in its group.
    const rival = this.list.find(x => x.group === a.group);
    if (rival) this.emerged.splice(this.emerged.indexOf(rival.id), 1);
    this.emerged.push(id);
    this.progress[id] = 1;
    this._recompute();
    return a;
  }

  _recompute() {
    const e = baseEffects();
    for (const a of this.list) {
      for (const [k, v] of Object.entries(a.effects)) {
        if (k.endsWith('Mult')) e[k] *= v;
        else if (k === 'needsDiversity') e[k] = Math.max(e[k], v);
        else e[k] += v;
      }
    }
    // Keep the additive 0..1 quantities sane when several stack.
    for (const k of ['stressRelief', 'redundancy', 'collapseResist', 'lightProductivity']) {
      e[k] = clamp(e[k], 0, 0.85);
    }
    this.effects = e;
  }
}
