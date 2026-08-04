/*
 * technology.js — Specific technologies, and what having them actually does.
 *
 * "Industry" as a word does nothing. A blast furnace, nitrogen fixation and a
 * fission pile do very different things, and a civilisation that has one and
 * not the others behaves differently. So each age unlocks named technologies,
 * and each one has a concrete mechanical effect:
 *
 *   carry     multiplies how many people the world can hold — this is what
 *             takes a population from thousands to billions
 *   growth    multiplies the rate knowledge accumulates
 *   shield    protects the population from the climate
 *   reach     how far the civilisation can act across interstellar distance
 *   offense   what it can do to somebody else
 *
 * The offensive branch is deliberately Three-Body shaped. A civilisation that
 * fears what it has found can reach across light years and stall a rival's
 * science permanently without ever sending a ship — and a rival that never
 * works out why its physics stopped making sense simply stops advancing.
 */

const TECHS = [
  // ── Stone / Fire ──────────────────────────────────────────────────────
  { id: 'fire', name: 'Controlled Fire', tier: 1, k: 140,
    desc: 'Cooking unlocks calories that were previously indigestible, and the night stops being lethal.',
    fx: { carry: 1.8, shield: 0.04 } },
  { id: 'tools', name: 'Composite Tools', tier: 1, k: 220,
    desc: 'Hafted, repairable tools — the first technology that is itself improvable.',
    fx: { carry: 1.3, growth: 1.08 } },

  // ── Agriculture ───────────────────────────────────────────────────────
  { id: 'farming', name: 'Cultivation', tier: 2, k: 340,
    desc: 'Deliberate food production. The single largest jump in how many people a world can carry.',
    fx: { carry: 3.5, growth: 1.1 } },
  { id: 'irrigation', name: 'Irrigation', tier: 2, k: 470,
    desc: 'Water moved to where the food is, decoupling harvest from rainfall.',
    fx: { carry: 1.8, shield: 0.05 } },

  // ── Writing ───────────────────────────────────────────────────────────
  { id: 'writing', name: 'Writing', tier: 3, k: 660,
    desc: 'Knowledge outlives the knower. Progress stops restarting with every generation.',
    fx: { growth: 1.35, keep: 0.08 } },
  { id: 'metallurgy', name: 'Metallurgy', tier: 3, k: 860,
    desc: 'Ores reduced to metal — structures, ploughs and blades all at once.',
    fx: { carry: 1.4, offense: 0.1 } },

  // ── Industry ──────────────────────────────────────────────────────────
  { id: 'sanitation', name: 'Sanitation & Germ Theory', tier: 4, k: 1150,
    desc: 'The realisation that invisible things cause disease. Childhood stops killing most people.',
    fx: { carry: 9, growth: 1.1 } },
  { id: 'haber', name: 'Nitrogen Fixation', tier: 4, k: 1330,
    desc: 'Fertiliser out of air. More of the population is fed by fewer of them than ever before.',
    fx: { carry: 3.5 } },
  { id: 'engines', name: 'Heat Engines', tier: 4, k: 1500,
    desc: 'Stored sunlight burned for work, and the first energy budget larger than muscle.',
    fx: { carry: 1.5, growth: 1.2, offense: 0.15 } },

  // ── Science ───────────────────────────────────────────────────────────
  { id: 'electronics', name: 'Computation', tier: 5, k: 1850,
    desc: 'Thinking machines. Problems too large for any single mind become tractable.',
    fx: { growth: 1.5, reach: 0.2 } },
  { id: 'fission', name: 'Nuclear Fission', tier: 5, k: 2100,
    desc: 'Energy from the nucleus — and, unavoidably, the ability to destroy a city with one device.',
    fx: { carry: 1.3, growth: 1.15, offense: 0.5 } },
  { id: 'climatecontrol', name: 'Climate Engineering', tier: 5, k: 2400,
    desc: 'Deliberate management of the atmosphere. The sky stops being something that merely happens to them.',
    fx: { shield: 0.22, carry: 1.4 } },

  // ── Spaceflight ───────────────────────────────────────────────────────
  { id: 'orbital', name: 'Orbital Habitats', tier: 6, k: 2900,
    desc: 'People living off the surface entirely. The carrying capacity of the planet stops being the limit.',
    fx: { carry: 2.5, shield: 0.12, reach: 0.3 } },
  { id: 'fusion', name: 'Fusion', tier: 6, k: 3300,
    desc: 'Starlight made deliberately. Effectively unlimited energy, and weapons to match.',
    fx: { carry: 1.6, growth: 1.25, offense: 0.6, reach: 0.4 } },
  { id: 'warheads', name: 'Relativistic Warheads', tier: 6, k: 3700, needs: 'fusion',
    desc: 'Mass accelerated to a fraction of light speed. No defence, no warning, and it works across a solar system.',
    fx: { offense: 1.4, reach: 0.5 }, weapon: true },

  // ── Transcendence ─────────────────────────────────────────────────────
  { id: 'sophon', name: 'Observer Lattice', tier: 7, k: 4300, needs: 'electronics',
    desc: 'A particle unfolded into a sensor and saboteur, dispatched at light speed. It watches everything a rival does and corrupts every experiment it runs — their physics simply stops making sense, and their science never advances again.',
    fx: { offense: 0.9, reach: 1.2 }, weapon: true, interference: true },
  { id: 'starship', name: 'Escape Fleet', tier: 7, k: 4800,
    desc: 'Crewed vessels capable of leaving the system permanently. Whatever happens to this world, the species continues.',
    fx: { reach: 1.5, carry: 1.3 } },
];

/** Cumulative effect of everything a civilisation has unlocked. */
function techEffects(unlocked) {
  const e = { carry: 1, growth: 1, shield: 0, keep: 0, reach: 0, offense: 0 };
  for (const id of unlocked) {
    const t = TECHS.find(x => x.id === id);
    if (!t) continue;
    for (const [k, v] of Object.entries(t.fx)) {
      if (k === 'carry' || k === 'growth') e[k] *= v;
      else e[k] += v;
    }
  }
  return e;
}

/** Which techs a civilisation qualifies for but has not yet unlocked. */
function availableTechs(civ, unlocked) {
  return TECHS.filter(t =>
    !unlocked.has(t.id) &&
    civ.knowledge >= t.k &&
    (!t.needs || unlocked.has(t.needs)));
}

const techById = (id) => TECHS.find(t => t.id === id);
