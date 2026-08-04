/*
 * technology.js — What a species can build, and the road it is forced to take.
 *
 * The governing idea: biology chooses the route; physics sets the ceiling.
 *
 * Every civilisation is bound by the same thermodynamics, so the milestones are
 * universal — a Kardashev Type II has captured its star's output whatever it is
 * made of. But HOW it gets there is decided by what evolution made it. A
 * species under kilometres of ocean never lights a fire, so it cannot smelt
 * metal, and must reach computation through biology instead. A species evolved
 * under hard radiation is not frightened of fission and reaches for it
 * centuries early. A photosynthetic species treats every square metre of
 * unintercepted sunlight as waste, so a Dyson swarm is not an exotic
 * megaproject to it — it is the obvious next step.
 *
 * Five mechanisms encode that:
 *
 *   BRANCHES     parallel routes to the same capability. Metallurgy and
 *                Cultured Metallophores both give you materials.
 *   AFFINITY     a species pays less knowledge for techs its biology suits and
 *                more for those it does not, so paths genuinely diverge.
 *   PROHIBITION  some routes are simply closed. There is no fire underwater.
 *   TELOS        the thing a civilisation is ultimately for, derived from what
 *                evolution made it rather than chosen.
 *   COMMITMENT   you do not take your star apart twice. A civilisation builds
 *                exactly one star-scale structure, and which one it built is
 *                the clearest statement it ever makes about itself.
 *
 * And past the named ages sits the Kardashev scale, which is about energy
 * rather than cleverness: Type I commands a planet's power, Type II a star's,
 * Type III a galaxy's. Physics does not care how you got there.
 */

// A branch is a way of solving a problem. Species differ in which they can take.
const BRANCHES = {
  universal: 'available to anyone',
  thermal:   'fire, smelting, heat engines — needs a dry world',
  biotech:   'cultured organisms doing the work of machines',
  nuclear:   'energy from the nucleus',
  solar:     'intercepting starlight directly',
  info:      'storage and computation as the primary product',
  network:   'many minds acting as one system',
  mega:      'structures too large for one lifetime',
};

/*
 * Which adaptations push a species down which branch. Affinity below 1 makes a
 * technology cheaper to reach; above 1, harder. This is the mechanism that
 * turns "they evolved perfect recall" into "their civilisation is an archive".
 */
const BRANCH_AFFINITY = {
  thermal: { photosynth: 1.4, dreamers: 1.2 },
  biotech: { symbiotic: 0.5, programmable: 0.55, biostorage: 0.7, hivemind: 0.8, logic: 1.3 },
  nuclear: { redundancy: 0.45, quantum: 0.55, emcomm: 0.8, empathic: 1.35 },
  solar:   { photosynth: 0.35, dreamers: 0.7, slowthought: 0.8 },
  info:    { crystals: 0.4, logic: 0.5, biostorage: 0.65, telepathy: 0.8 },
  network: { hivemind: 0.35, telepathy: 0.4, emcomm: 0.5, distributed: 0.6, chemself: 1.2 },
  mega:    { longevity: 0.4, slowthought: 0.5, predictive: 0.6, castes: 1.25 },
};

/*
 * The thing a civilisation is ultimately for. Derived from what it is, not
 * chosen — and it decides what its Type II and Type III look like. Humans
 * imagine bigger machines; a species of perfect recall imagines a bigger
 * archive, and a hive mind imagines a bigger mind.
 */
const TELOI = [
  { id: 'survival', name: 'Survival', branch: 'mega',
    // The Trisolaran answer: a species that can dehydrate and wait out an era
    // does not dream of glory, it dreams of still being here.
    score: (a) => (a.has('redundancy') ? 1.0 : 0) + (a.has('distributed') ? 0.9 : 0)
      + (a.has('quantum') ? 0.8 : 0) + (a.has('biostorage') ? 0.6 : 0),
    creed: 'Nothing they build is meant to be impressive. It is meant to still be there afterwards.',
    typeI: 'Not one planetary grid but nine, none of which needs the others. Redundancy is the architecture.',
    typeII: 'Millions of habitats instead of one homeworld — no single catastrophe can reach them all.',
    typeIII: 'Every system in reach holds an archived copy of them. Extinction stops being possible.' },
  { id: 'computation', name: 'Maximum computation', branch: 'network',
    score: (a) => (a.has('hivemind') ? 1.2 : 0) + (a.has('telepathy') ? 0.7 : 0)
      + (a.has('emcomm') ? 0.3 : 0),
    creed: 'They are already one mind. Everything after that is a question of how large it can be made.',
    typeI: 'The planet itself is the computer. They never needed to invent networking — they were one.',
    typeII: 'The swarm around their star is not a power plant. It is a brain.',
    typeIII: 'Each system is a neuron, and the signals between stars are thought.' },
  { id: 'preservation', name: 'Perfect preservation', branch: 'info',
    score: (a) => (a.has('crystals') ? 1.2 : 0) + (a.has('biostorage') ? 0.4 : 0),
    creed: 'They never forget anything, so losing anything is the only catastrophe they recognise.',
    typeI: 'Their world’s energy budget goes largely to keeping records nobody will ever read again.',
    typeII: 'Their star is rearranged into storage. Matter is worth more as record than as structure.',
    typeIII: 'A galaxy converted to archive. Their scarce resource was never energy — it was information.' },
  { id: 'energy', name: 'Maximum energy capture', branch: 'solar',
    score: (a) => (a.has('photosynth') ? 1.3 : 0),
    creed: 'They eat light. Unintercepted sunlight is not an opportunity to them, it is waste.',
    typeI: 'Every lit surface on the planet collects. They reached this stage without ever burning anything.',
    typeII: 'A complete swarm, because any photon that misses them is a loss.',
    typeIII: 'Most of a galaxy’s starlight caught. They optimise collection, not production.' },
  { id: 'life', name: 'Spreading life', branch: 'biotech',
    // An ocean world has no choice — but merely living with partners is a much
    // weaker signal than being unable to light a fire at all.
    score: (a, prof) => (prof.hydrosphere === 'ocean' ? 1.1 : 0) + (a.has('symbiotic') ? 0.55 : 0)
      + (a.has('programmable') ? 0.35 : 0),
    creed: 'They never separated technology from biology, so building and growing are the same verb.',
    typeI: 'A planet-wide cultured biosphere doing the work of industry. Nothing here was ever smelted.',
    typeII: 'Their megastructures are grown, not assembled — living swarms around a living star.',
    typeIII: 'They terraform by seeding ecosystems. A galaxy made habitable rather than industrialised.' },
  { id: 'extremes', name: 'Harnessing extremes', branch: 'nuclear',
    score: (a, prof) => clamp((prof.radiation - 0.25) * 2.4, 0, 1.2)
      + (a.has('redundancy') ? 0.45 : 0),
    creed: 'What sterilises other worlds is merely their weather. They walk toward what others flee.',
    typeI: 'Fission arrived centuries early, because radiation was never something they had to fear.',
    typeII: 'They live closer to their star than anything else could, drawing power straight from plasma.',
    typeIII: 'Neutron stars and black holes as power plants. The violent parts of the universe are theirs.' },
  { id: 'simulation', name: 'Simulated worlds', branch: 'info',
    score: (a) => (a.has('dreamers') ? 1.15 : 0) + (a.has('slowthought') ? 0.3 : 0),
    creed: 'They live mostly asleep, and their real work has always happened inside their own heads.',
    typeI: 'Most of their planet’s power runs environments that are not real. They prefer them.',
    typeII: 'Stellar output spent running worlds that do not exist, because that is where they live.',
    typeIII: 'Galaxies given over to simulation. They stopped distinguishing it from reality long ago.' },
  { id: 'exploration', name: 'Exploration and knowledge', branch: 'universal',
    // Ours, and the fallback: the goal a species arrives at when nothing about
    // its world forced a narrower one on it. Having no megastructure of its own
    // to want, it builds the general-purpose one — power for instruments, and
    // fuel for ships going somewhere interesting.
    starBranch: 'solar',
    score: () => 0.5,
    creed: 'No single pressure dominates them, so they went looking simply to find out.',
    typeI: 'A world’s worth of power, spent on rather more things than any of them could agree on.',
    typeII: 'A swarm built to power instruments, and ships sent because the question was interesting.',
    typeIII: 'A galaxy mapped and understood, largely for its own sake.' },
];

/*
 * Strongest signal wins, not first match. A species is aimed by whatever
 * pressure shaped it hardest; ties go to the earlier entry, and a species that
 * nothing shaped hard ends up like us, looking around out of curiosity.
 */
function telosFor(adaptations, profile) {
  let best = TELOI[TELOI.length - 1], bestScore = -1;
  for (const t of TELOI) {
    const s = t.score(adaptations, profile);
    if (s > bestScore) { best = t; bestScore = s; }
  }
  return best;
}

/*
 * requires / forbids are predicates on (adaptations, profile). This is where
 * "no fire underwater" actually lives.
 */
const noFire = (a, p) => p.hydrosphere !== 'ocean';
noFire.why = 'there is no fire under an ocean';

/** Why a road is shut to this species, in their own terms. */
function prohibitionReason(adaptations, profile) {
  const reasons = new Set();
  for (const t of TECHS) {
    if (!techAvailable(t, adaptations, profile) && t.requires && t.requires.why) {
      reasons.add(t.requires.why);
    }
  }
  return [...reasons];
}

/*
 * Costs are in knowledge, and knowledge is measured in the hundreds of
 * thousands by the time a civilisation is old — so the ladder is deliberately
 * steep at the top. Reaching Type II should take an age; Type III should be
 * something most worlds never manage at all.
 *
 * `exclusive` marks a commitment. You do not take your star apart twice: a
 * civilisation builds exactly one star-scale structure, and which one it builds
 * is the single clearest statement of what its species was for.
 */
const TECHS = [
  // ── Universal foundations ────────────────────────────────────────────
  { id: 'tools', name: 'Composite Tools', k: 180, branch: 'universal',
    desc: 'Hafted, repairable tools — the first technology that is itself improvable.',
    fx: { carry: 1.3, growth: 1.08 } },
  { id: 'farming', name: 'Cultivation', k: 380, branch: 'universal',
    desc: 'Deliberate food production. The largest single jump in how many people a world can carry.',
    fx: { carry: 9, growth: 1.1 } },
  { id: 'writing', name: 'Recorded Knowledge', k: 800, branch: 'universal',
    desc: 'Knowledge outlives the knower, so progress stops restarting every generation.',
    fx: { growth: 1.35, keep: 0.08 } },

  // ── Thermal route: fire, metal, engines. Closed to ocean worlds. ─────
  { id: 'fire', name: 'Controlled Fire', k: 200, branch: 'thermal', requires: noFire,
    desc: 'Cooking unlocks calories that were previously indigestible, and the night stops being lethal.',
    fx: { carry: 1.8, shield: 0.04 } },
  { id: 'metallurgy', name: 'Metallurgy', k: 1000, branch: 'thermal', requires: noFire, needs: 'fire',
    desc: 'Ores reduced to metal. Structures, tools and blades all at once.',
    fx: { carry: 1.4, offense: 0.1 } },
  { id: 'engines', name: 'Heat Engines', k: 1800, branch: 'thermal', needs: 'metallurgy',
    desc: 'Stored sunlight burned for work — the first energy budget larger than muscle.',
    fx: { carry: 1.5, growth: 1.2, offense: 0.15, power: 1e13 } },

  // ── Biotech route: what a world without fire must do instead. ────────
  { id: 'symbioculture', name: 'Symbioculture', k: 600, branch: 'biotech',
    desc: 'Other organisms domesticated as tools rather than food — the first machines are alive.',
    fx: { carry: 2.2, growth: 1.12 } },
  { id: 'metallophore', name: 'Cultured Metallophores', k: 1200, branch: 'biotech', needs: 'symbioculture',
    desc: 'Organisms that concentrate dissolved metals from water. Materials without ever lighting a fire.',
    fx: { carry: 1.3, growth: 1.1 } },
  { id: 'biocompute', name: 'Living Computation', k: 2400, branch: 'biotech', needs: 'metallophore',
    desc: 'Cultured neural tissue doing the work of circuits. They reached computing through biology.',
    fx: { growth: 1.45, power: 8e12 } },
  { id: 'genecraft', name: 'Deep Genecraft', k: 3400, branch: 'biotech', needs: 'biocompute',
    desc: 'Wholesale redesign of living things, including themselves.',
    fx: { carry: 2.2, shield: 0.15, growth: 1.15 } },
  { id: 'biosphere', name: 'Living Swarm', k: 250000, branch: 'biotech', needs: 'genecraft',
    exclusive: 'star',
    desc: 'A star enclosed in something grown rather than assembled — organisms bred to live on raw sunlight, in numbers that darken the sky. Their Type II is alive.',
    fx: { power: 1.3e26, carry: 3.2, growth: 1.3 } },

  // ── Nuclear route: obvious to anyone raised under radiation. ─────────
  { id: 'fission', name: 'Nuclear Fission', k: 2200, branch: 'nuclear',
    desc: 'Energy from the nucleus — and, unavoidably, the means to destroy a city with one device.',
    fx: { carry: 1.3, growth: 1.15, offense: 0.5, power: 5e13 } },
  { id: 'fusion', name: 'Fusion', k: 3800, branch: 'nuclear', needs: 'fission',
    desc: 'Starlight made deliberately. Effectively unlimited energy, and weapons to match.',
    fx: { carry: 1.6, growth: 1.25, offense: 0.6, reach: 0.4, power: 4e15 } },
  { id: 'starlifting', name: 'Stellar Plasma Tapping', k: 250000, branch: 'nuclear', needs: 'fusion',
    exclusive: 'star',
    desc: 'Power drawn straight from the star’s outer plasma, closer in than anything else could survive. A cruder Type II than a swarm, and reached by people who were never frightened of what it takes.',
    fx: { power: 1.15e26, reach: 0.5, offense: 0.3 } },

  // ── Solar route: obvious to anyone who eats light. ───────────────────
  { id: 'collectors', name: 'Continental Collectors', k: 1600, branch: 'solar',
    desc: 'Whole landmasses given over to intercepting sunlight.',
    fx: { carry: 1.4, power: 2e13 } },
  { id: 'orbitalmirror', name: 'Orbital Collectors', k: 3600, branch: 'solar', needs: 'collectors',
    desc: 'Collection moved off the surface, where there is no night and no weather.',
    fx: { carry: 1.6, power: 6e14, reach: 0.25 } },
  { id: 'dyson', name: 'Dyson Swarm', k: 250000, branch: 'solar', needs: 'orbitalmirror',
    exclusive: 'star',
    desc: 'Collectors enough to intercept nearly everything the star emits. The most complete Type II there is, built by people to whom a wasted photon was always an offence.',
    fx: { power: 3.4e26, reach: 0.6, carry: 2.5 } },

  // ── Information route: for species that cannot forget. ───────────────
  { id: 'archive', name: 'Total Archive', k: 1400, branch: 'info',
    desc: 'Everything ever known, kept and indexed. Nothing is permitted to be lost.',
    fx: { keep: 0.25, growth: 1.2 } },
  { id: 'computation', name: 'Computation', k: 2400, branch: 'info', needs: 'archive',
    desc: 'Thinking machines. Problems too large for any one mind become tractable.',
    fx: { growth: 1.5, reach: 0.2, power: 1e13 } },
  { id: 'matrioshka', name: 'Matrioshka Archive', k: 250000, branch: 'info', needs: 'computation',
    exclusive: 'star',
    desc: 'Their star rearranged into nested shells of computation, each running on the waste heat of the one inside it. Matter is worth more to them as record than as structure.',
    fx: { power: 2.0e26, growth: 1.6, carry: 1.6 } },

  // ── Network route: for species that were never individuals. ──────────
  { id: 'biolink', name: 'Planetary Nervous System', k: 1400, branch: 'network',
    desc: 'The whole population linked as one system, without inventing a single machine to do it.',
    fx: { growth: 1.4, keep: 0.1 } },
  { id: 'starmind', name: 'Stellar Mind', k: 250000, branch: 'network', needs: 'biolink',
    exclusive: 'star',
    desc: 'The swarm around their star is not a power plant. It is a brain, and they are inside it.',
    fx: { power: 2.4e26, growth: 1.8, carry: 2 } },
  { id: 'galacticmind', name: 'Galactic Nervous System', k: 2500000, branch: 'network',
    needs: 'starmind', exclusive: 'galaxy',
    desc: 'Each system a neuron; the signals between stars are thought itself. A single idea takes ten thousand years to finish, and they consider that reasonable.',
    fx: { power: 6e36, growth: 2.2, carry: 10, reach: 2 } },

  // ── Megastructure route: for species that live long enough. ──────────
  { id: 'orbital', name: 'Orbital Habitats', k: 3000, branch: 'mega',
    desc: 'People living off the surface entirely. The planet stops being the limit.',
    fx: { carry: 2.5, shield: 0.12, reach: 0.3, power: 3e14 } },
  { id: 'worldhouse', name: 'Planetary Engineering', k: 4400, branch: 'mega', needs: 'orbital',
    desc: 'Climate, orbit and atmosphere placed under deliberate management.',
    fx: { shield: 0.25, carry: 1.8, power: 5e15 } },
  { id: 'ringworld', name: 'Stellar Megastructure', k: 250000, branch: 'mega', needs: 'worldhouse',
    exclusive: 'star',
    desc: 'A solid structure around the star, on a scale no individual of a short-lived species could have overseen. Begun by people who knew they would not see it finished — or, for some, by people who knew they would.',
    fx: { power: 1.6e26, carry: 4 } },

  // ── Weapons and interference ─────────────────────────────────────────
  { id: 'warheads', name: 'Relativistic Warheads', k: 5200, branch: 'nuclear', needs: 'fusion',
    desc: 'Mass accelerated to a fraction of light speed. No defence and no warning.',
    fx: { offense: 1.4, reach: 0.5 }, weapon: true },
  { id: 'sophon', name: 'Observer Lattice', k: 5600, branch: 'info', needs: 'computation',
    desc: 'A particle unfolded into a sensor and saboteur, dispatched at light speed. It corrupts every experiment a rival runs; their physics stops making sense and their science never advances again.',
    fx: { offense: 0.9, reach: 1.2 }, weapon: true, interference: true },

  // ── Interstellar ─────────────────────────────────────────────────────
  { id: 'starship', name: 'Interstellar Craft', k: 5000, branch: 'universal',
    desc: 'Vessels able to leave the system permanently. Whatever happens here, the species continues.',
    fx: { reach: 1.5, carry: 1.3, power: 1e15 } },
  { id: 'galactic', name: 'Galactic Expansion', k: 2500000, branch: 'universal',
    needs: 'starship', needsGroup: 'star', exclusive: 'galaxy',
    desc: 'Presence established across a meaningful fraction of the galaxy. Whatever happens to any one star now, it is no longer the end of them.',
    fx: { power: 4e36, carry: 12, reach: 2 } },
];

/*
 * Affinity: how much cheaper or dearer a technology is for THIS species.
 * A telos discounts its own branch further — a civilisation aimed at
 * computation finds computation easy in a way that is not only technical.
 */
function techCostFactor(tech, adaptations, profile, telos) {
  // A star-scale structure is the one irreversible statement a civilisation
  // makes about itself, so its purpose decides which one it builds — biological
  // convenience does not get a vote at this scale.
  if (tech.exclusive === 'star') {
    if (!telos) return 1;
    const want = telos.starBranch || telos.branch;
    return want === tech.branch ? 0.75 : 2;
  }
  const table = BRANCH_AFFINITY[tech.branch];
  let f = 1;
  if (table) {
    for (const [adaptId, mult] of Object.entries(table)) {
      if (adaptations.has(adaptId)) f *= mult;
    }
  }
  if (profile.hydrosphere === 'ocean' && tech.branch === 'biotech') f *= 0.7;
  if (profile.radiation > 0.4 && tech.branch === 'nuclear') f *= 0.7;
  if (telos && telos.branch === tech.branch) f *= 0.75;
  // Bounded on purpose. Biology should decide the order things arrive in, not
  // hand one species a shortcut past physics.
  return clamp(f, 0.45, 2.2);
}

function techAvailable(tech, adaptations, profile) {
  return !tech.requires || tech.requires(adaptations, profile);
}

/** Has this civilisation already committed to a structure of this class? */
function hasExclusive(unlocked, group) {
  for (const id of unlocked) {
    const t = techById(id);
    if (t && t.exclusive === group) return true;
  }
  return false;
}

/*
 * Prerequisites: a named parent tech, and/or *any* member of an exclusive
 * class. Galactic expansion needs a star-scale structure behind it, but does
 * not care which one you built — that is the whole point of the branches.
 */
function techUnblocked(tech, unlocked) {
  if (tech.needs && !unlocked.has(tech.needs)) return false;
  if (tech.needsGroup && !hasExclusive(unlocked, tech.needsGroup)) return false;
  if (tech.exclusive && hasExclusive(unlocked, tech.exclusive)) return false;
  return true;
}

/*
 * Cumulative effect of everything unlocked.
 *
 * Power comes in two kinds, and the distinction matters. Industrial capacity
 * (`power`) scales with how many people there are to run it. A structure built
 * around the star (`powerFixed`) does not: once the collectors are out there,
 * the output is the star's, and it does not care how many of you there are.
 */
function techEffects(unlocked) {
  const e = { carry: 1, growth: 1, shield: 0, keep: 0, reach: 0, offense: 0,
    power: 5e11, powerFixed: 0 };
  for (const id of unlocked) {
    const t = TECHS.find(x => x.id === id);
    if (!t) continue;
    for (const [k, v] of Object.entries(t.fx)) {
      if (k === 'carry' || k === 'growth') e[k] *= v;
      else if (k === 'power') { if (t.exclusive) e.powerFixed += v; else e.power += v; }
      else e[k] += v;
    }
  }
  return e;
}

/*
 * What this civilisation qualifies for now.
 *
 * Sorted cheapest-first and yielded one at a time, because a civilisation that
 * has just crossed a knowledge threshold should commit to the road it can most
 * afford — otherwise it would unlock every rival star-scale structure in the
 * same instant and the exclusivity would mean nothing.
 */
function availableTechs(civ, unlocked, adaptations, profile, telos) {
  const ready = TECHS.filter(t =>
    !unlocked.has(t.id) &&
    techAvailable(t, adaptations, profile) &&
    techUnblocked(t, unlocked) &&
    civ.knowledge >= t.k * techCostFactor(t, adaptations, profile, telos));
  ready.sort((a, b) => a.k * techCostFactor(a, adaptations, profile, telos)
    - b.k * techCostFactor(b, adaptations, profile, telos));
  // Only ever hand back techs that are still mutually compatible.
  const taken = [], groups = new Set();
  for (const t of ready) {
    if (t.exclusive) {
      if (groups.has(t.exclusive)) continue;
      groups.add(t.exclusive);
    }
    taken.push(t);
  }
  return taken;
}

/** The next few things within reach, for the UI. */
function upcomingTechs(civ, unlocked, adaptations, profile, telos, n = 2) {
  return TECHS
    .filter(t => !unlocked.has(t.id) && techAvailable(t, adaptations, profile) &&
      techUnblocked(t, unlocked))
    .map(t => ({ tech: t, cost: Math.round(t.k * techCostFactor(t, adaptations, profile, telos)) }))
    .sort((a, b) => a.cost - b.cost)
    .slice(0, n);
}

/*
 * Kardashev level from raw power. Physics, not cleverness: K = (log10 W - 6)/10.
 * Type I ~1e16 W (a planet's share), Type II ~1e26 W (a star), Type III ~1e36 W.
 */
function kardashev(watts) {
  if (!(watts > 0)) return 0;
  return clamp((Math.log10(watts) - 6) / 10, 0, 5);
}

/*
 * The three thresholds worth announcing. `telosKey` picks the sentence that
 * describes what THIS species did with that much power — the whole point being
 * that two Type IIs can be a power plant and a brain and look nothing alike.
 */
const KARDASHEV_STEPS = [
  { k: 1, name: 'Type I', telosKey: 'typeI',
    what: 'The civilisation commands the full energy falling on its own world.' },
  { k: 2, name: 'Type II', telosKey: 'typeII',
    what: 'The civilisation commands the full output of its star.' },
  { k: 3, name: 'Type III', telosKey: 'typeIII',
    what: 'The civilisation commands the output of a galaxy.' },
];

/*
 * A band name rather than a number, because "Type 1.98" tells a reader nothing
 * that "approaching Type II" does not tell them better. The exact figure is
 * shown alongside wherever it is worth showing.
 */
function kardashevLabel(k) {
  if (k < 0.7) return 'Pre-industrial';
  if (k < 1)   return 'Approaching Type I';
  if (k < 1.9) return 'Type I';
  if (k < 2)   return 'Approaching Type II';
  if (k < 2.9) return 'Type II';
  if (k < 3)   return 'Approaching Type III';
  return 'Type III';
}

const techById = (id) => TECHS.find(t => t.id === id);
