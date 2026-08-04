/*
 * adaptations.js — Divergent evolutionary paths, and what each one costs.
 *
 * The governing idea: evolution does not produce perfection. Selection favours
 * whatever improves reproductive success in *this* environment, and every such
 * trait is paid for somewhere else. A species that is extraordinary at
 * surviving catastrophe is usually mediocre at inventing; one that never
 * forgets is usually bad at forgiving.
 *
 * So every adaptation here carries BOTH:
 *
 *   boon  — what it makes the species extraordinary at, and
 *   cost  — the capability it permanently gives up for it,
 *
 * expressed not as flavour text but as pushes on four measurable civilisation
 * dimensions:
 *
 *   knowledge     what they have worked out (accumulates, is lost in collapses)
 *   innovation    the rate at which genuinely new ideas appear
 *   cohesion      whether the society holds together under strain
 *   adaptability  how well they cope when conditions change suddenly
 *
 * A civilisation can die from a shortfall in any of the last three, not just
 * from the climate. Perfect recall breeds grudges and shatters cohesion.
 * Inherited memory makes children born knowledgeable but freezes innovation.
 * Slow, near-perfect thought plans centuries ahead and is destroyed by a change
 * it did not see coming.
 *
 * Gates are measured from the world's Signature over time, so an adaptation is
 * a response to a *regime*, never to a moment.
 */

// Neutral baseline. Every adaptation states only what it changes.
function baseEffects() {
  return {
    // — biology —
    intelUpkeepMult: 1,
    intelReproTaxMult: 1,
    reproMult: 1,
    deathMult: 1,
    stressRelief: 0,
    dormancyDrainMult: 1,
    redundancy: 0,          // 0..1 chance a lethal event costs a part, not a life
    lightProductivity: 0,   // 0..1 blend toward flux-driven food
    darkPenalty: 0,         // extra suffering when the sky goes dark
    mutationMult: 1,
    upkeepMult: 1,          // bodily cost of simply existing

    // — civilisation dimensions (targets these traits pull toward) —
    innovation: 0,
    cohesion: 0,
    adaptability: 0,

    // — civilisation mechanics —
    knowledgeKeepBonus: 0,
    knowledgeGrowthMult: 1,
    awakenIntelDelta: 0,
    collapseResist: 0,
    memoryAdd: 0,
    needsDiversity: 0,

    // — signature vulnerabilities —
    emDependent: false,     // coordination collapses under radiation spikes
    lightDependent: false,  // starves in a long night
    unityDependent: false,  // a shared mind fails when scattered
  };
}

/*
 * Each entry:
 *   gate(sig, prof, ctx) -> 0..1  how hard this world pushes this way
 *   boon / cost                   the tradeoff, in plain language
 *   effects                       the mechanical consequences of both halves
 */
const ADAPTATIONS = [
  {
    id: 'distributed', name: 'Distributed Consciousness', group: 'selfhood',
    blurb: 'Mind spread across many bodies. Losing one is losing a finger, not dying.',
    boon: 'Extraordinarily resilient — most lethal events cost a body, not a life.',
    cost: 'No decision is quick. Consensus across a scattered self is slow, so sudden change is met sluggishly, and there is no individual to speak for the whole.',
    gate: (s) => Math.min(s.chaos * 1.3, s.tempVolatility / 30),
    effects: { redundancy: 0.45, reproMult: 0.75, adaptability: -0.30, cohesion: 0.12,
               innovation: -0.10, unityDependent: true },
  },
  {
    id: 'reversible', name: 'Reversible Intelligence', group: 'brain',
    blurb: 'Nervous tissue grown in abundance and reabsorbed in famine.',
    boon: 'A brain that costs almost nothing when it cannot be afforded — they simply put it away.',
    cost: 'Each descent into animality loses the thread. Knowledge accumulates in fits and starts, and continuity of thought is the price.',
    gate: (s) => (s.stableFrac > 0.15 && s.stableFrac < 0.8) ? clamp(s.eraChurn / 1.1, 0, 1) : 0,
    effects: { intelUpkeepMult: 0.4, knowledgeGrowthMult: 0.85, knowledgeKeepBonus: 0.08,
               innovation: -0.15, adaptability: 0.2 },
  },
  {
    id: 'biostorage', name: 'Inherited Memory', group: 'memory',
    blurb: 'Knowledge encoded into heritable molecules; the libraries are alive.',
    boon: 'Children are born already knowing. Almost nothing is lost when a civilisation falls.',
    cost: 'The old ideas are born again too. Refuted theories and dead assumptions are inherited with everything else, and innovation grinds against them.',
    gate: (s) => clamp((s.eraChurn / 0.9) * 0.8 + (1 - s.stableFrac) * 0.4, 0, 1),
    effects: { knowledgeKeepBonus: 0.34, memoryAdd: 0.5, knowledgeGrowthMult: 0.92,
               innovation: -0.35, adaptability: -0.15, cohesion: 0.15 },
  },
  {
    id: 'slowthought', name: 'Time-Delayed Thinking', group: 'tempo',
    blurb: 'Thought unfolds over months and is almost never wrong.',
    boon: 'Planning that spans centuries, and conclusions that are very nearly always correct.',
    cost: 'A crisis is over before they have finished considering it. Anything that changes quickly defeats them entirely.',
    gate: (s, p) => Math.max(clamp(p.rotationOrbits / 0.9, 0, 1), s.stableFrac > 0.9 ? 0.55 : 0),
    effects: { knowledgeGrowthMult: 1.55, reproMult: 0.7, mutationMult: 0.7,
               adaptability: -0.45, innovation: -0.1, cohesion: 0.2 },
  },
  {
    id: 'emcomm', name: 'Electromagnetic Communication', group: 'signal',
    blurb: 'Organs that broadcast and receive; cities think in unison.',
    boon: 'Instant coordination across a whole world, and deception is nearly impossible.',
    cost: 'Every thought is broadcast in the open. A stellar flare drowns the channel and the civilisation goes deaf, blind and leaderless at once.',
    gate: (s, p) => clamp(p.radiation * 1.6, 0, 1),
    effects: { knowledgeGrowthMult: 1.4, awakenIntelDelta: -0.05, cohesion: 0.3,
               innovation: -0.12, emDependent: true },
  },
  {
    id: 'hivemind', name: 'Collective Consciousness', group: 'selfhood',
    blurb: 'Nervous systems fuse; the civilisation becomes one mind.',
    boon: 'The reasoning power of an entire species applied to one problem at once.',
    cost: 'There is no dissent to draw on, and no second opinion. One error propagates through everyone, and scattering the population severs the mind itself.',
    gate: (s) => (s.stableFrac > 0.25 && s.stableFrac < 0.75) ? clamp(s.eraChurn / 1.0, 0, 1) * 0.9 : 0,
    effects: { knowledgeGrowthMult: 1.7, reproMult: 0.85, needsDiversity: 4,
               cohesion: 0.45, innovation: -0.40, adaptability: -0.2, unityDependent: true },
  },
  {
    id: 'programmable', name: 'Programmable Bodies', group: 'morphology',
    blurb: 'No permanent organs — wings, gills or extra neural tissue as needed.',
    boon: 'At home in any environment. Almost nothing the world does can render them unfit.',
    cost: 'Rebuilding a body is enormously expensive, and they are helpless while it happens.',
    gate: (s) => clamp(Math.min(s.tempVolatility / 26, s.chaos * 1.2), 0, 1),
    effects: { stressRelief: 0.22, mutationMult: 1.6, reproMult: 0.85, deathMult: 0.85,
               upkeepMult: 1.35, adaptability: 0.45, innovation: 0.1 },
  },
  {
    id: 'photosynth', name: 'Photosynthetic Intelligence', group: 'metabolism',
    blurb: 'They eat light. Days pass motionless.',
    boon: 'Almost no need for food, and metabolic costs so low that famine barely touches them.',
    cost: 'Power output is feeble — everything they do is slow — and a long night starves them outright.',
    gate: (s) => (s.fluxMean > 0.0055 && s.stableFrac > 0.5) ? clamp(s.fluxMean / 0.011, 0, 1) : 0,
    effects: { lightProductivity: 0.65, intelUpkeepMult: 0.55, reproMult: 0.8, deathMult: 0.9,
               darkPenalty: 0.5, innovation: -0.15, adaptability: -0.2, lightDependent: true },
  },
  {
    id: 'crystals', name: 'Crystal Memory', group: 'memory',
    blurb: 'Memory is mineral. It can be cut out, handed over, installed.',
    boon: 'Flawless recall, and knowledge that can be transferred whole rather than taught.',
    cost: 'Nothing fades. Every grievance stays as sharp as the day it happened, so feuds never cool and reconciliation is close to impossible.',
    gate: (s, p) => (s.meanTempC < 6 || p.hydrosphere === 'ice')
      ? clamp((6 - s.meanTempC) / 30 + (p.hydrosphere === 'ice' ? 0.45 : 0), 0, 1) : 0,
    effects: { knowledgeKeepBonus: 0.3, knowledgeGrowthMult: 1.25, memoryAdd: 0.35,
               cohesion: -0.42, innovation: -0.2 },
  },
  {
    id: 'symbiotic', name: 'Symbiotic Intelligence', group: 'selfhood',
    blurb: 'No single organism is intelligent; mind is what cooperation produces.',
    boon: 'Several kinds of thinking at once, and sapience achieved far below the usual cost.',
    cost: 'The mind is only as safe as its rarest partner. Lose one lineage and the whole intelligence goes out.',
    gate: (s) => (s.stableFrac > 0.4) ? clamp(s.stableFrac * 0.7, 0, 1) : 0,
    effects: { awakenIntelDelta: -0.1, knowledgeGrowthMult: 1.3, needsDiversity: 7,
               deathMult: 1.1, innovation: 0.25, adaptability: -0.15 },
  },
  {
    id: 'redundancy', name: 'Extreme Redundancy', group: 'morphology',
    blurb: 'Every organ three times over; the genome keeps dozens of backups.',
    boon: 'Extraordinarily hard to kill. Radiation, injury and famine are all survivable.',
    cost: 'Maintaining three of everything demands an enormous body and an enormous appetite.',
    gate: (s, p) => clamp(p.radiation * 1.4 + s.chaos * 0.35, 0, 1),
    effects: { deathMult: 0.55, redundancy: 0.25, reproMult: 0.8, intelUpkeepMult: 1.15,
               upkeepMult: 1.45, innovation: -0.1, adaptability: 0.1 },
  },
  {
    id: 'chemself', name: 'Chemical Personalities', group: 'brain',
    blurb: 'Cognition is chosen — become a mathematician, a soldier, an artist at will.',
    boon: 'Any mind the moment demands, with no need to raise a specialist for it.',
    cost: 'Identity will not hold still. Commitments made by one self are not felt by the next, and trust is difficult to build.',
    gate: (s) => (s.stableFrac > 0.35) ? clamp(s.stableFrac * 0.55 + s.tempVolatility / 60, 0, 1) : 0,
    effects: { knowledgeGrowthMult: 1.35, mutationMult: 1.25, reproMult: 0.92,
               innovation: 0.3, cohesion: -0.28, adaptability: 0.2 },
  },
  {
    id: 'dreamers', name: 'Sleep Evolution', group: 'tempo',
    blurb: 'Nine tenths of life spent asleep, dreaming collectively.',
    boon: 'Almost no exposure to danger, and problems solved in the dark without effort.',
    cost: 'Very little gets done while awake, and a threat arriving during the long sleep meets no one at all.',
    gate: (s) => clamp(s.darkFrac * 2.2, 0, 1),
    effects: { dormancyDrainMult: 0.45, knowledgeGrowthMult: 1.3, reproMult: 0.85,
               stressRelief: 0.1, adaptability: -0.3, innovation: 0.15 },
  },
  {
    id: 'empathic', name: 'Emotional Evolution', group: 'social',
    blurb: 'Perfect empathy, wired in: to injure another is to feel it yourself.',
    boon: 'A society that does not fracture. Cooperation is automatic and crime never evolved.',
    cost: 'Every loss is felt by everybody. Mass death is not a statistic here but a wound the whole species carries, and hard necessary choices are almost unmakeable.',
    gate: (s) => (s.stableFrac > 0.78) ? clamp((s.stableFrac - 0.78) * 4.2, 0, 1) : 0,
    effects: { collapseResist: 0.35, knowledgeGrowthMult: 1.18, deathMult: 0.9,
               cohesion: 0.5, adaptability: -0.15, innovation: -0.05 },
  },
  {
    id: 'topology', name: 'Four-Dimensional Spatial Sense', group: 'brain',
    blurb: 'They simply see the shape of an orbit that has no closed solution.',
    boon: 'Mathematics that we require centuries to formalise is, to them, obvious at a glance.',
    cost: 'A mind built for structure is poor at everything unstructured. Their intuitions about other minds are famously bad.',
    gate: (s, p, ctx) => (ctx.sunCount >= 3) ? clamp(s.chaos * 1.25, 0, 1) : 0,
    effects: { knowledgeGrowthMult: 1.45, collapseResist: 0.3, awakenIntelDelta: 0.04,
               innovation: 0.2, cohesion: -0.25 },
  },
  {
    id: 'quantum', name: 'Quantum Dormancy', group: 'metabolism',
    blurb: 'All activity suspended, molecular structure held intact for centuries.',
    boon: 'They skip catastrophes entirely. An era that would end another species simply passes them by.',
    cost: 'They wake into a world that has moved on without them, having contributed nothing and learned nothing in the interval.',
    gate: (s, p) => clamp(Math.max((s.maxTempC - 70) / 60, 0) + p.radiation * 0.8, 0, 1),
    effects: { dormancyDrainMult: 0.12, stressRelief: 0.18, knowledgeKeepBonus: 0.12,
               reproMult: 0.9, innovation: -0.25, adaptability: 0.25 },
  },
  {
    id: 'predictive', name: 'Predictive Evolution', group: 'signal',
    blurb: 'Enormous resources spent on patterns spanning millennia.',
    boon: 'They see what is coming decades out, and prepare for it while it is still theoretical.',
    cost: 'The prediction is only as good as the regularity behind it. When the pattern breaks, their entire planning apparatus is worse than useless.',
    gate: (s, p, ctx) => (s.stableFrac > 0.8 && ctx.sunCount <= 2) ? clamp((s.stableFrac - 0.8) * 4, 0, 1) : 0,
    effects: { knowledgeGrowthMult: 1.4, collapseResist: 0.3, intelUpkeepMult: 1.2,
               adaptability: -0.35, innovation: 0.1 },
  },
  {
    id: 'castes', name: 'Evolutionary Castes', group: 'morphology',
    blurb: 'One life, several species: explorer, builder, scientist, reproducer.',
    boon: 'A body and a brain purpose-built for each task, and no wasted effort at any stage.',
    cost: 'No one holds the whole picture. Understanding is fragmented across life-stages that never meet as equals.',
    gate: (s) => clamp(s.eraChurn / 1.2 * 0.85, 0, 1),
    effects: { reproMult: 1.25, knowledgeGrowthMult: 1.22, deathMult: 0.9,
               intelReproTaxMult: 0.7, cohesion: -0.2, innovation: 0.15 },
  },

  // ── Costs that are purely civilisational ──────────────────────────────
  {
    id: 'logic', name: 'Perfect Logic', group: 'brain',
    blurb: 'Reasoning without error, and without intuition.',
    boon: 'They never make a fallacious step, and never fool themselves.',
    cost: 'They will not guess. A speculative leap with no evidence behind it is unavailable to them, and most real discoveries begin as exactly that.',
    gate: (s) => (s.stableFrac > 0.94 && s.tempVolatility < 4)
      ? clamp((s.stableFrac - 0.94) * 12, 0, 1) : 0,
    effects: { knowledgeGrowthMult: 1.3, innovation: -0.45, adaptability: -0.2, cohesion: 0.1 },
  },
  {
    id: 'telepathy', name: 'Telepathy', group: 'signal',
    blurb: 'Thought is shared directly, whether or not it is finished.',
    boon: 'Nothing is misunderstood and nothing can be hidden. Deception simply does not work.',
    cost: 'No idea gets to be private while it is still half-formed and foolish, so few are ever pursued that far. Privacy, and with it a great deal of creativity, is gone.',
    gate: (s, p) => (p.radiation > 0.25 && s.stableFrac > 0.5)
      ? clamp(p.radiation * 0.9, 0, 1) : 0,
    effects: { cohesion: 0.55, knowledgeGrowthMult: 1.2, innovation: -0.45, unityDependent: true },
  },
  {
    id: 'longevity', name: 'Biological Immortality', group: 'tempo',
    blurb: 'They do not age. Generations do not turn over.',
    boon: 'Expertise accumulates in a single mind for thousands of years, and nothing is lost to death.',
    cost: 'Nothing is lost to death — including the people at the top. Authority never vacates, orthodoxy never dies with its holders, and a society with everything to lose stops taking risks.',
    gate: (s) => (s.stableFrac > 0.92) ? clamp((s.stableFrac - 0.92) * 8, 0, 1) : 0,
    effects: { deathMult: 0.45, reproMult: 0.55, knowledgeGrowthMult: 1.25,
               innovation: -0.5, adaptability: -0.3, cohesion: 0.15 },
  },
];

/*
 * Why a world is pushing toward a given adaptation, stated in the measurements
 * that actually opened its gate. Without this the traits look arbitrary; with
 * it, every one of them is traceable to something the player can see happening.
 */
function adaptationReason(a, sig, prof, ctx) {
  const bits = [];
  const pct = (x) => `${Math.round(x * 100)}%`;
  switch (a.id) {
    case 'distributed': case 'programmable':
      bits.push(`temperature swings of ±${sig.tempVolatility.toFixed(0)}°`,
        `a sky ${pct(sig.chaos)} hostile`); break;
    case 'reversible': case 'hivemind': case 'castes':
      bits.push(`eras flipping ${sig.eraChurn.toFixed(2)}× per orbit`,
        `only ${pct(sig.stableFrac)} of time habitable`); break;
    case 'biostorage':
      bits.push(`eras flipping ${sig.eraChurn.toFixed(2)}× per orbit`,
        'knowledge repeatedly destroyed'); break;
    case 'slowthought':
      bits.push(prof.rotationOrbits > 0.2
        ? `a day lasting ${prof.rotationOrbits.toFixed(2)} orbits`
        : `${pct(sig.stableFrac)} of time habitable and nothing ever hurrying`); break;
    case 'emcomm': case 'telepathy':
      bits.push(`${pct(prof.radiation)} radiation — this world is already full of signal`); break;
    case 'photosynth':
      bits.push(`abundant steady light (mean flux ${sig.fluxMean.toFixed(4)})`,
        `${pct(sig.stableFrac)} habitable`); break;
    case 'crystals':
      bits.push(prof.hydrosphere === 'ice'
        ? 'a frozen, mineral-rich world' : `a mean temperature of ${sig.meanTempC.toFixed(0)}°C`); break;
    case 'symbiotic': case 'empathic': case 'chemself': case 'logic': case 'longevity':
      bits.push(`${pct(sig.stableFrac)} of all time habitable`,
        `swings of only ±${sig.tempVolatility.toFixed(0)}°`); break;
    case 'redundancy':
      bits.push(`${pct(prof.radiation)} radiation`, `a sky ${pct(sig.chaos)} hostile`); break;
    case 'dreamers':
      bits.push(`${pct(sig.darkFrac)} of time with no usable light`); break;
    case 'topology':
      bits.push(`${ctx.sunCount} suns whose motion has no closed solution`); break;
    case 'quantum':
      bits.push(sig.maxTempC > 70 ? `peaks reaching ${sig.maxTempC.toFixed(0)}°C` : null,
        prof.radiation > 0.2 ? `${pct(prof.radiation)} radiation` : null); break;
    case 'predictive':
      bits.push(`${pct(sig.stableFrac)} habitable and utterly regular`); break;
  }
  const clean = bits.filter(Boolean);
  return clean.length ? `Driven by ${clean.join(', ')}.` : 'Driven by this world\u2019s particular conditions.';
}

/** Plain-language summary of what an adaptation mechanically does. */
function adaptationEffectLines(a) {
  const L = [];
  const f = a.effects;
  const pctd = (v) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}%`;
  const multd = (v) => `${v > 1 ? '+' : ''}${Math.round((v - 1) * 100)}%`;
  if (f.innovation) L.push(`Innovation ${pctd(f.innovation)}`);
  if (f.cohesion) L.push(`Cohesion ${pctd(f.cohesion)}`);
  if (f.adaptability) L.push(`Adaptability ${pctd(f.adaptability)}`);
  if (f.knowledgeGrowthMult && f.knowledgeGrowthMult !== 1) L.push(`Knowledge growth ${multd(f.knowledgeGrowthMult)}`);
  if (f.knowledgeKeepBonus) L.push(`Survives collapse ${pctd(f.knowledgeKeepBonus)}`);
  if (f.reproMult && f.reproMult !== 1) L.push(`Breeding ${multd(f.reproMult)}`);
  if (f.deathMult && f.deathMult !== 1) L.push(`Mortality ${multd(f.deathMult)}`);
  if (f.redundancy) L.push(`${Math.round(f.redundancy * 100)}% of lethal events survived`);
  if (f.dormancyDrainMult && f.dormancyDrainMult !== 1) L.push(`Dormancy cost ${multd(f.dormancyDrainMult)}`);
  if (f.intelUpkeepMult && f.intelUpkeepMult !== 1) L.push(`Brain upkeep ${multd(f.intelUpkeepMult)}`);
  if (f.upkeepMult && f.upkeepMult !== 1) L.push(`Body upkeep ${multd(f.upkeepMult)}`);
  if (f.stressRelief) L.push(`Climate shielding ${pctd(f.stressRelief)}`);
  if (f.lightProductivity) L.push('Food comes from light, not warmth');
  if (f.mutationMult && f.mutationMult !== 1) L.push(`Mutation ${multd(f.mutationMult)}`);
  if (f.collapseResist) L.push(`${Math.round(f.collapseResist * 100)}% chance to shrug off a collapse`);
  if (f.awakenIntelDelta) L.push(`Sapience threshold ${f.awakenIntelDelta < 0 ? 'lowered' : 'raised'}`);
  if (f.needsDiversity) L.push(`Fails if genetic variety drops below ${f.needsDiversity}`);
  if (f.emDependent) L.push('Vulnerable: a flare silences them');
  if (f.lightDependent) L.push('Vulnerable: a long night starves them');
  if (f.unityDependent) L.push('Vulnerable: scattering breaks the mind');
  return L;
}

const ADAPT_CONFIG = {
  maxAdaptations: 4,
  pressureRate: 0.00040,
  minPressure: 0.30,
  chanceScale: 0.55,
};

class AdaptationSet {
  constructor() { this.reset(); }

  reset() {
    this.progress = {};
    this.emerged = [];
    this.effects = baseEffects();
    // A per-world affinity, rolled once, so two worlds with identical climates
    // still travel different evolutionary roads.
    this.affinity = {};
    for (const a of ADAPTATIONS) {
      this.progress[a.id] = 0;
      this.affinity[a.id] = 0.35 + RNG() * 1.5;
    }
  }

  has(id) { return this.emerged.includes(id); }
  get list() { return this.emerged.map(id => ADAPTATIONS.find(a => a.id === id)); }

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
      const gain = ADAPT_CONFIG.pressureRate * p * this.affinity[a.id]
        * (1 - ADAPT_CONFIG.chanceScale + ADAPT_CONFIG.chanceScale * 2 * RNG());
      this.progress[a.id] = clamp(this.progress[a.id] + gain, 0, 1);
      if (this.progress[a.id] >= 1) {
        this.emerged.push(a.id);
        this._recompute();
        events.push({
          text: `Divergent evolution — ${a.name}. ${a.boon} The cost: ${a.cost}`,
          kind: 'adapt',
        });
        break;
      }
    }
    return events;
  }

  force(id) {
    if (this.has(id)) return null;
    const a = ADAPTATIONS.find(x => x.id === id);
    if (!a) return null;
    const rival = this.list.find(x => x.group === a.group);
    if (rival) this.emerged.splice(this.emerged.indexOf(rival.id), 1);
    this.emerged.push(id);
    this.progress[id] = 1;
    this._recompute();
    return a;
  }

  remove(id) {
    const i = this.emerged.indexOf(id);
    if (i < 0) return;
    this.emerged.splice(i, 1);
    this.progress[id] = 0;
    this._recompute();
  }

  _recompute() {
    const e = baseEffects();
    for (const a of this.list) {
      for (const [k, v] of Object.entries(a.effects)) {
        if (typeof v === 'boolean') e[k] = e[k] || v;
        else if (k.endsWith('Mult')) e[k] *= v;
        else if (k === 'needsDiversity') e[k] = Math.max(e[k], v);
        else e[k] += v;
      }
    }
    for (const k of ['stressRelief', 'redundancy', 'collapseResist', 'lightProductivity']) {
      e[k] = clamp(e[k], 0, 0.85);
    }
    // Diminishing returns on the soft dimensions. Stacking three penalties
    // should leave a species crippled, not identical to every other crippled
    // species — so compress rather than simply sum.
    for (const k of ['innovation', 'cohesion', 'adaptability']) {
      e[k] = 0.62 * Math.tanh(e[k] / 0.62);
    }
    this.effects = e;
  }
}
