/*
 * species.js — Who these people actually are.
 *
 * Everything here is derived, never authored: the name comes from the world's
 * measured character, and the "extraordinary at / fatally bad at" lines are read
 * off the species' real numbers and its real adaptations. If the dossier says
 * they cannot forgive, that is because cohesion is genuinely near zero and
 * Crystal Memory is genuinely why.
 *
 * The point it exists to make: a species is a set of compromises that happened
 * to work on one particular world, not a score out of ten. Read enough of these
 * and none of them is simply "better" than us — each is spectacular at
 * something and helpless at something else.
 */

// Name fragments chosen by what the world IS, so the name carries information.
const NAME_PREFIX = {
  ice:      ['Veld', 'Hoar', 'Rime', 'Glaci', 'Kald'],
  ocean:    ['Thal', 'Pelag', 'Mari', 'Bathy', 'Nerei'],
  scorched: ['Pyra', 'Ashen', 'Cind', 'Solar', 'Fulg'],
  dark:     ['Noct', 'Umbr', 'Steno', 'Vesper', 'Erebus'],
  chaotic:  ['Vagra', 'Errant', 'Tumult', 'Skein', 'Volt'],
  heavy:    ['Grav', 'Ander', 'Stone', 'Ballast', 'Dun'],
  irradiated:['Fulm', 'Aur', 'Radi', 'Corona', 'Flare'],
  temperate:['Meri', 'Verd', 'Aeol', 'Sylv', 'Calen'],
};
const NAME_SUFFIX = ['-bound', '-kin', 'ari', 'oi', '-born', 'ux', 'ene', '-folk', 'ai', 'ith'];

function speciesArchetype(profile, sig) {
  if (profile.geothermal > 0.3 || sig.darkFrac > 0.6) return 'dark';
  if (profile.hydrosphere === 'ice') return 'ice';
  if (profile.hydrosphere === 'ocean') return 'ocean';
  if (profile.radiation > 0.4) return 'irradiated';
  if (profile.gravity >= 1.8) return 'heavy';
  if (sig.meanTempC > 48) return 'scorched';
  if (sig.chaos > 0.35) return 'chaotic';
  return 'temperate';
}

// Deterministic for a given world so the name does not flicker frame to frame.
function speciesName(profile, sig, adaptations) {
  const arch = speciesArchetype(profile, sig);
  const pool = NAME_PREFIX[arch] || NAME_PREFIX.temperate;
  // Seeded from stable, slow-moving world facts rather than the RNG.
  let h = Math.floor(Math.abs(sig.meanTempC) * 7 + profile.gravity * 31
    + profile.radiation * 53 + adaptations.emerged.length * 17
    + (adaptations.emerged[0] ? adaptations.emerged[0].length * 11 : 0));
  const p = pool[h % pool.length];
  const s = NAME_SUFFIX[(h >> 3) % NAME_SUFFIX.length];
  return `The ${p}${s}`;
}

/*
 * Builds the dossier. Returns:
 *   { name, habitatLine, strengths[], weaknesses[], verdict }
 * Strengths and weaknesses are ranked, so the top of each list is the thing
 * that most defines them.
 */
function speciesDossier(world) {
  const { profile: prof, signature: sig, civ, population: pop, adaptations: ad } = world;
  const fx = ad.effects;
  const list = ad.list;

  const strengths = [], weaknesses = [];
  const add = (arr, weight, text) => arr.push({ weight, text });

  // ── From the measurable state of the civilisation ──
  if (civ.awakened || civ.everAwakened) {
    if (civ.innovation < 0.2) add(weaknesses, 1.0, `Innovation has stalled (${fmt.pct(civ.innovation)}) — they know a great deal and discover almost nothing.`);
    else if (civ.innovation > 0.72) add(strengths, 0.8, `Restlessly inventive (${fmt.pct(civ.innovation)}) — new ideas arrive faster than they can be tested.`);

    if (civ.cohesion < 0.22) add(weaknesses, 1.0, `The society barely holds together (cohesion ${fmt.pct(civ.cohesion)}). Grievance outlasts common cause.`);
    else if (civ.cohesion > 0.78) add(strengths, 0.8, `Effectively unfracturable (cohesion ${fmt.pct(civ.cohesion)}) — they do not turn on each other, ever.`);

    if (civ.adaptability < 0.22) add(weaknesses, 1.0, `Helpless against sudden change (adaptability ${fmt.pct(civ.adaptability)}). A fast crisis is over before they have decided anything.`);
    else if (civ.adaptability > 0.75) add(strengths, 0.8, `Unshakeable in a crisis (adaptability ${fmt.pct(civ.adaptability)}) — whatever the world does, they have already reconfigured.`);

    if (civ.collapses >= 3) add(weaknesses, 0.6, `${civ.collapses} dark ages endured. Their history is a series of restarts, not a line.`);
    if (civ.crises.schism > 0) add(weaknesses, 0.7, `${civ.crises.schism} schism${civ.crises.schism > 1 ? 's' : ''} — they have torn themselves apart from the inside.`);
    if (civ.crises.shock > 0) add(weaknesses, 0.7, `${civ.crises.shock} time${civ.crises.shock > 1 ? 's' : ''} overtaken by an era that turned faster than they could think.`);
    if (civ.transcended) add(strengths, 1.0, 'They mastered their own sky and left it — the rarest outcome there is.');
  }

  // ── From biology ──
  const dorm = pop.avg('dormancy'), tol = pop.avg('tolerance'), intel = pop.avg('intelligence');
  if (dorm > 0.6) add(strengths, 0.7, `Can dehydrate almost completely (${fmt.pct(dorm)}) and wait out an era that would end anyone else.`);
  if (tol > 45) add(strengths, 0.5, `Tolerates a ±${tol.toFixed(0)}° swing without distress.`);
  if (tol < 18) add(weaknesses, 0.5, `Narrowly specialised — only ±${tol.toFixed(0)}° of tolerance before they begin to die.`);
  if (intel > 0.75) add(strengths, 0.6, `Exceptionally intelligent (${fmt.pct(intel)}), at a metabolic cost few worlds could pay.`);
  if (fx.upkeepMult > 1.3) add(weaknesses, 0.6, `Enormously expensive to keep alive — ${(fx.upkeepMult).toFixed(2)}× the normal upkeep for a body this capable.`);
  if (fx.reproMult < 0.75) add(weaknesses, 0.5, 'Breeds slowly. A population lost here is not quickly replaced.');

  // ── From the adaptations themselves (the authored tradeoff, verbatim) ──
  for (const a of list) {
    add(strengths, 0.9, `<b>${a.name}.</b> ${a.boon}`);
    add(weaknesses, 0.9, `<b>${a.name}.</b> ${a.cost}`);
  }

  // ── Signature vulnerabilities worth naming outright ──
  if (fx.emDependent) add(weaknesses, 0.8, 'Their entire coordination runs on an open channel a flare can drown.');
  if (fx.lightDependent) add(weaknesses, 0.8, 'A long night is not an inconvenience to them. It is starvation.');
  if (fx.unityDependent) add(weaknesses, 0.8, 'Scatter them and the mind itself stops working.');

  strengths.sort((a, b) => b.weight - a.weight);
  weaknesses.sort((a, b) => b.weight - a.weight);

  const habitat = [
    prof.label,
    `${sig.meanTempC.toFixed(0)}°C ±${sig.tempVolatility.toFixed(0)}`,
    `${fmt.pct(sig.stableFrac)} habitable`,
    prof.gravity !== 1 ? `${prof.gravity.toFixed(1)}g` : null,
    sig.darkFrac > 0.15 ? `${fmt.pct(sig.darkFrac)} sunless` : null,
    prof.radiation > 0.2 ? `${fmt.pct(prof.radiation)} radiation` : null,
  ].filter(Boolean).join(' · ');

  return {
    name: speciesName(prof, sig, ad),
    habitatLine: habitat,
    strengths: strengths.slice(0, 5).map(x => x.text),
    weaknesses: weaknesses.slice(0, 5).map(x => x.text),
    verdict: verdictFor(world, strengths, weaknesses),
  };
}

function verdictFor(world, strengths, weaknesses) {
  const { civ, population: pop } = world;
  if (pop.count === 0) return 'Extinct. Whatever they were good at, it was not enough.';
  if (!civ.everAwakened) return 'Still animals. This world has never given them the surplus to afford a brain.';
  if (!civ.awakened) return 'Fallen back to instinct. The capacity was there once; the conditions were not.';
  if (civ.transcended) return 'They got out. Almost nothing does.';
  if (weaknesses.length && strengths.length) {
    return 'Neither better nor worse than us — a different set of compromises, made for a different world.';
  }
  return 'Still being written.';
}
