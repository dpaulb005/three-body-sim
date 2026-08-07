#!/usr/bin/env node
'use strict';

/*
 * technology.test.js — Locks in the claim the technology model exists to make:
 * biology chooses the route, physics sets the ceiling.
 *
 * The invariants worth defending are that an ocean world can never smelt metal
 * and still gets to Type II; that a species' ultimate goal follows from what
 * evolution made it; and that a civilisation commits to exactly one star-scale
 * structure, so which one it built tells you what it was for.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const context = vm.createContext({ console, Math });
for (const file of ['js/config.js', 'js/utils.js', 'js/technology.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
}
vm.runInContext(`globalThis.api = { TECHS, TELOI, telosFor, techCostFactor, techAvailable,
  techEffects, availableTechs, upcomingTechs, kardashev, kardashevLabel, prohibitionReason };`, context);
const T = context.api;

const STAR = ['dyson', 'matrioshka', 'starmind', 'ringworld', 'starlifting', 'biosphere'];
const GALAXY = ['galactic', 'galacticmind'];

function run(name, test) {
  const started = Date.now();
  try {
    test();
    console.log(`ok - ${name} (${Date.now() - started} ms)`);
  } catch (error) {
    console.error(`FAIL - ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

// Climbs a species from nothing to an unlimited knowledge budget and records
// what it actually unlocked, in order.
function climb(adaptationIds, profileOverrides = {}) {
  const adaptations = { has: (id) => adaptationIds.includes(id) };
  const profile = Object.assign(
    { hydrosphere: 'land', radiation: 0, gravity: 1, geothermal: 0 }, profileOverrides);
  const telos = T.telosFor(adaptations, profile);
  const unlocked = new Set();
  const order = [];
  const civ = { knowledge: 0 };
  for (let k = 0; k <= 6e6; k += 500) {
    civ.knowledge = k;
    for (const tech of T.availableTechs(civ, unlocked, adaptations, profile, telos)) {
      unlocked.add(tech.id);
      order.push(tech.id);
    }
  }
  const fx = T.techEffects(unlocked);
  return {
    order, unlocked, telos, fx, adaptations, profile,
    kardashev: T.kardashev(fx.power + fx.powerFixed),
    star: order.filter((id) => STAR.includes(id)),
    galaxy: order.filter((id) => GALAXY.includes(id)),
  };
}

// The eight archetypes, and the goal each one's biology should arrive at.
const ARCHETYPES = [
  { name: 'Trisolaran-like', adaptations: ['redundancy', 'quantum'], telos: 'survival', star: 'ringworld' },
  { name: 'Aquatic', adaptations: ['symbiotic'], profile: { hydrosphere: 'ocean' }, telos: 'life', star: 'biosphere' },
  { name: 'Photosynthetic', adaptations: ['photosynth'], telos: 'energy', star: 'dyson' },
  { name: 'Crystal memory', adaptations: ['crystals'], telos: 'preservation', star: 'matrioshka' },
  { name: 'Hive mind', adaptations: ['hivemind'], telos: 'computation', star: 'starmind' },
  { name: 'Radiation-adapted', adaptations: [], profile: { radiation: 0.7 }, telos: 'extremes', star: 'starlifting' },
  { name: 'Collective dreamers', adaptations: ['dreamers'], telos: 'simulation', star: 'matrioshka' },
  { name: 'Human-like', adaptations: [], telos: 'exploration', star: 'dyson' },
];

run('a species’ ultimate goal follows from its biology, not from a roll', () => {
  for (const a of ARCHETYPES) {
    const r = climb(a.adaptations, a.profile);
    assert.equal(r.telos.id, a.telos,
      `${a.name} should aim at "${a.telos}", got "${r.telos.id}"`);
  }
});

run('a weak signal does not hand a species a whole purpose', () => {
  /*
   * The fallback has to be genuinely hard to displace. Four unrelated dry
   * worlds once all ended up pursuing the goal of an ocean species because one
   * adaptation cleared the exploration baseline by 0.05, which made every calm
   * world's civilisation identical — the precise outcome this system exists to
   * prevent.
   */
  const land = { hydrosphere: 'land', radiation: 0 };
  // Traits that merely gesture at a purpose rather than announcing one.
  // Quantum Dormancy is deliberately not in this list: a species that can
  // suspend itself indefinitely really is defined by outlasting things.
  const weakOnLand = ['symbiotic', 'biostorage', 'emcomm', 'slowthought', 'predictive'];
  for (const id of weakOnLand) {
    const ad = { has: (x) => x === id };
    assert.equal(T.telosFor(ad, land).id, 'exploration',
      `"${id}" alone on a dry world should not decide what a civilisation is for`);
  }
  // But the same trait on the world that makes it meaningful does decide.
  const aquatic = { has: (x) => x === 'symbiotic' };
  assert.equal(T.telosFor(aquatic, { hydrosphere: 'ocean', radiation: 0 }).id, 'life',
    'under an ocean, where nothing can be smelted, it is decisive');
  // A single overwhelming trait, however, is allowed to be decisive.
  assert.equal(T.telosFor({ has: (x) => x === 'quantum' }, land).id, 'survival',
    'being able to suspend yourself indefinitely is a purpose all by itself');
  // And two mutually reinforcing traits clear the bar on their own.
  const both = { has: (x) => x === 'symbiotic' || x === 'programmable' };
  assert.equal(T.telosFor(both, land).id, 'life',
    'two biotech traits together are a real signal, not a rounding error');
  // Every archetype that is supposed to have a purpose still has one.
  for (const a of ARCHETYPES) {
    const ad = { has: (id) => a.adaptations.includes(id) };
    const prof = Object.assign({ hydrosphere: 'land', radiation: 0 }, a.profile);
    assert.equal(T.telosFor(ad, prof).id, a.telos,
      `${a.name} must still clear the margin`);
  }
});

run('there is no fire under an ocean, and metallurgy is closed with it', () => {
  const ocean = climb(['symbiotic'], { hydrosphere: 'ocean' });
  assert.ok(!ocean.unlocked.has('fire'), 'an ocean world must never light a fire');
  assert.ok(!ocean.unlocked.has('metallurgy'), 'no fire means no smelting');
  assert.ok(!ocean.unlocked.has('engines'), 'no smelting means no heat engines');
  const why = T.prohibitionReason(ocean.adaptations, ocean.profile);
  assert.ok(why.length && /fire/.test(why[0]), 'the prohibition explains itself');
  // A land world of otherwise identical biology takes the road they cannot.
  const land = climb(['symbiotic']);
  assert.ok(land.unlocked.has('metallurgy'), 'a dry world of the same biology does smelt');
});

run('a closed road does not lower the ceiling — it only changes the route', () => {
  const ocean = climb(['symbiotic'], { hydrosphere: 'ocean' });
  assert.ok(ocean.unlocked.has('biocompute'),
    'an ocean world reaches computation through biology instead');
  assert.ok(ocean.kardashev >= 3,
    `an ocean world should still reach Type III, got K=${ocean.kardashev.toFixed(2)}`);
  for (const a of ARCHETYPES) {
    const r = climb(a.adaptations, a.profile);
    assert.ok(r.kardashev >= 3,
      `${a.name} should reach Type III given unlimited time, got K=${r.kardashev.toFixed(2)}`);
  }
});

run('a civilisation commits to exactly one star-scale structure', () => {
  for (const a of ARCHETYPES) {
    const r = climb(a.adaptations, a.profile);
    assert.equal(r.star.length, 1,
      `${a.name} built ${r.star.length} star-scale structures: ${r.star.join(', ')}`);
    assert.equal(r.star[0], a.star,
      `${a.name} should build ${a.star}, built ${r.star[0]}`);
    assert.equal(r.galaxy.length, 1,
      `${a.name} built ${r.galaxy.length} galaxy-scale structures`);
  }
});

run('biology reorders the road even where it does not close it', () => {
  const openings = ARCHETYPES.map((a) => climb(a.adaptations, a.profile).order.slice(0, 10).join(','));
  assert.equal(new Set(openings).size, openings.length,
    'every archetype should open with a distinguishable sequence of technologies');
  // Affinity has to be a real discount, and a bounded one.
  const photo = { has: (id) => id === 'photosynth' };
  const plain = { has: () => false };
  const profile = { hydrosphere: 'land', radiation: 0 };
  const dyson = T.TECHS.find((t) => t.id === 'collectors');
  const cheap = T.techCostFactor(dyson, photo, profile, T.telosFor(photo, profile));
  const dear = T.techCostFactor(dyson, plain, profile, T.telosFor(plain, profile));
  assert.ok(cheap < dear * 0.6, 'a light-eater should reach solar collection far sooner');
  for (const tech of T.TECHS) {
    for (const ad of [photo, plain]) {
      const f = T.techCostFactor(tech, ad, profile, T.telosFor(ad, profile));
      assert.ok(f >= 0.45 && f <= 2.2, `${tech.id} cost factor ${f} escaped its bounds`);
    }
  }
});

run('Kardashev level is read off watts, and the thresholds land where physics puts them', () => {
  assert.equal(T.kardashev(1e16).toFixed(4), '1.0000', 'Type I is 1e16 W');
  assert.equal(T.kardashev(1e26).toFixed(4), '2.0000', 'Type II is 1e26 W');
  assert.equal(T.kardashev(1e36).toFixed(4), '3.0000', 'Type III is 1e36 W');
  assert.equal(T.kardashev(0), 0, 'no power is no level');
  assert.equal(T.kardashevLabel(T.kardashev(2e13)), 'Approaching Type I',
    'a civilisation at roughly our own output has not made Type I');
  assert.equal(T.kardashevLabel(2.4), 'Type II');
  // Star-scale output must not be scaled by headcount: it is the star's.
  const swarm = T.techEffects(new Set(['dyson']));
  assert.ok(swarm.powerFixed > 1e26 && swarm.power < 1e13,
    'a Dyson swarm’s output is fixed, not per-capita');
});

run('Type I is earned on the planet, not incidentally on the way to Type II', () => {
  // Everything a civilisation can build without committing to a star-scale
  // structure. A populated world running all of it commands its own energy
  // budget, which is the entire meaning of Type I.
  const planetary = new Set(TECHS_BY_BRANCH_WITHOUT_STAR());
  const fx = T.techEffects(planetary);
  assert.equal(fx.powerFixed, 0, 'no star-scale structure is included here');
  // Deployment is capped at 1 for a fully-populated world; see Civilization.
  assert.ok(T.kardashev(fx.power) >= 1,
    `planetary technology alone should reach Type I, got K=${T.kardashev(fx.power).toFixed(3)}`);
  // And it must not overshoot into Type II — that has to cost a megastructure.
  assert.ok(T.kardashev(fx.power) < 2,
    `planetary technology alone must not reach Type II, got K=${T.kardashev(fx.power).toFixed(3)}`);
  // Half a world's population is not a Type I civilisation.
  assert.ok(T.kardashev(fx.power * 0.3) < 1,
    'a thinly-populated world has not commanded its planet’s energy');
});

function TECHS_BY_BRANCH_WITHOUT_STAR() {
  const human = { has: () => false };
  const profile = { hydrosphere: 'land', radiation: 0 };
  const telos = T.telosFor(human, profile);
  const unlocked = new Set();
  const civ = { knowledge: 0 };
  for (let k = 0; k <= 200000; k += 500) {
    civ.knowledge = k;
    for (const tech of T.availableTechs(civ, unlocked, human, profile, telos)) {
      if (tech.exclusive) continue;          // stop short of the commitment
      unlocked.add(tech.id);
    }
  }
  return unlocked;
}

run('every technology is reachable — no orphaned prerequisites', () => {
  const ids = new Set(T.TECHS.map((t) => t.id));
  for (const tech of T.TECHS) {
    if (tech.needs) assert.ok(ids.has(tech.needs), `${tech.id} needs unknown tech ${tech.needs}`);
    assert.ok(tech.k > 0 && tech.desc && tech.branch, `${tech.id} is incompletely specified`);
  }
  const everReached = new Set();
  for (const a of ARCHETYPES) for (const id of climb(a.adaptations, a.profile).unlocked) everReached.add(id);
  for (const tech of T.TECHS) {
    assert.ok(everReached.has(tech.id), `${tech.id} is unreachable by every archetype`);
  }
});

if (process.exitCode) console.error('\nSome technology tests FAILED.');
else console.log('All technology tests passed.');
