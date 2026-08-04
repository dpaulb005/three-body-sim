/*
 * galaxy.js — Many worlds, light years apart, each running its own evolution.
 *
 * Up to this point the simulation held one world. This file holds all of them,
 * steps them together, and models the one thing that can only happen when there
 * is more than one: they find out about each other.
 *
 * Contact is not scripted. A civilisation becomes DETECTABLE when its
 * technology starts leaking into space — industry and radio do that, and a
 * species that evolved Electromagnetic Communication has been broadcasting
 * since before it had cities. It becomes a LISTENER once it has the science to
 * look. Whether two worlds ever meet is then a question of how far apart they
 * are and how long both happen to be shouting at the same time, which is the
 * actual shape of the Fermi problem: most civilisations are separated by more
 * light years than either survives.
 *
 * What happens after contact is decided by what each species is, not by dice.
 * A world of perfect empathy and one of collective consciousness make contact
 * very differently from two worlds that never learned to forgive anything.
 */

const GALAXY_NAMES = [
  'Vashti', 'Kepler-9c', 'Ondrave', 'Suhail', 'Tabit', 'Nashira', 'Alcor',
  'Meissa', 'Zubeneg', 'Sarin', 'Tarazed', 'Aldhibah', 'Cursa', 'Yildun',
  'Maia', 'Sadr', 'Rukbat', 'Enif', 'Izar', 'Keid',
];

const CONTACT = {
  // Light years the strongest signal crosses before it is lost in noise.
  baseRange: 46,
  // Tech tier at which a civilisation starts leaking detectable signal.
  emitTier: 4,    // Industry
  // Tech tier at which it can hear anyone else.
  listenTier: 4,  // Industry — radio astronomy is not that hard
  checkEvery: 240,
};

class Galaxy {
  constructor() {
    this.worlds = [];
    this.activeIndex = 0;
    this._nameIdx = 0;
    this._contactTimer = 0;
    this.contacts = [];   // {a, b, t} — every first contact that has occurred
  }

  get active() { return this.worlds[this.activeIndex] || null; }
  get count() { return this.worlds.length; }

  nextName() {
    const n = GALAXY_NAMES[this._nameIdx % GALAXY_NAMES.length];
    const cycle = Math.floor(this._nameIdx / GALAXY_NAMES.length);
    this._nameIdx++;
    return cycle ? `${n} ${'II III IV V'.split(' ')[cycle - 1] || cycle + 1}` : n;
  }

  /** Add a world at a position some light years from the others. */
  add(world) {
    world.id = this.worlds.length + 1;
    world.starName = this.nextName();
    // Scatter in a disc; distance is what decides who ever hears whom.
    const ang = RNG() * Math.PI * 2;
    const rad = 4 + RNG() * 18;
    world.galPos = { x: Math.cos(ang) * rad, y: Math.sin(ang) * rad };
    this.worlds.push(world);
    return world;
  }

  remove(i) {
    if (this.worlds.length <= 1) return;
    this.worlds.splice(i, 1);
    this.activeIndex = clamp(this.activeIndex, 0, this.worlds.length - 1);
  }

  select(i) { this.activeIndex = clamp(i, 0, this.worlds.length - 1); }

  lightYears(a, b) {
    return Math.hypot(a.galPos.x - b.galPos.x, a.galPos.y - b.galPos.y);
  }

  /** Advance every world, then test for contact between them. */
  step() {
    for (const w of this.worlds) w.step();
    if (++this._contactTimer >= CONTACT.checkEvery) {
      this._contactTimer = 0;
      this._testContact();
    }
  }

  // ---- Contact ----
  _emitting(w) {
    if (!w.civ.awakened) return 0;
    // Broadcast species are loud from the beginning; everyone else has to build
    // an industrial base before anything leaks off-world.
    const em = w.adaptations.has('emcomm') || w.adaptations.has('telepathy');
    if (!em && w.civ.tierIdx < CONTACT.emitTier) return 0;
    const tierFrac = w.civ.tierIdx / (w.civ.tiers.length - 1);
    return (em ? 0.55 : 0) + tierFrac;   // 0..~1.5, scales detection range
  }

  _listening(w) {
    if (!w.civ.awakened) return false;
    if (w.adaptations.has('emcomm') && w.civ.tierIdx >= 3) return true;
    return w.civ.tierIdx >= CONTACT.listenTier;
  }

  _knows(a, b) { return a.contacts.has(b.id); }

  _testContact() {
    const ws = this.worlds;
    for (let i = 0; i < ws.length; i++) {
      for (let j = 0; j < ws.length; j++) {
        if (i === j) continue;
        const listener = ws[i], source = ws[j];
        if (this._knows(listener, source)) continue;
        if (!this._listening(listener)) continue;
        const power = this._emitting(source);
        if (power <= 0) continue;
        const d = this.lightYears(listener, source);
        if (d > CONTACT.baseRange * power) continue;

        listener.contacts.add(source.id);
        const mutual = this._knows(source, listener);
        const sName = source.speciesName || source.starName;
        const lName = listener.speciesName || listener.starName;
        listener.log(`First contact — a signal from ${source.starName}, ${d.toFixed(1)} light years out. They are not alone.`, 'contact');
        listener.milestone(`Detected ${source.starName} (${sName}) at ${d.toFixed(1)} ly`, 'contact');
        if (!mutual) {
          source.log(`Something is listening. A world at ${listener.starName} has heard ${lName ? 'them' : 'this world'}.`, 'contact');
        }
        this.contacts.push({ a: listener.id, b: source.id, t: listener.system.time });
        this._resolveRelation(listener, source, d);
        return;  // one contact per check, so the chronicle stays readable
      }
    }
  }

  /*
   * What contact turns into. Decided by what the two species actually are:
   * empathic and collective minds reach out, grudge-keepers and logicians do
   * not, and only spacefaring civilisations can do anything about it either way.
   */
  /*
   * How frightening a species is to meet. Fear is not about hostility — it is
   * about what the other side could do to you and how little of it you would
   * understand. A single mind spanning a whole world, something that cannot be
   * killed, or something already carrying weapons is terrifying regardless of
   * its intentions.
   */
  _menace(w) {
    let m = 0;
    if (w.adaptations.has('hivemind')) m += 0.45;      // no one to negotiate with
    if (w.adaptations.has('redundancy')) m += 0.30;    // cannot be killed
    if (w.adaptations.has('distributed')) m += 0.20;
    if (w.adaptations.has('logic')) m += 0.15;         // unmoved by appeals
    if (w.adaptations.has('telepathy')) m += 0.20;     // nothing can be hidden from them
    m += w.civ.offense * 0.5;
    m += clamp(w.civ.tierIdx / 7, 0, 1) * 0.3;
    return m;
  }

  _resolveRelation(a, b, d) {
    const warmth = (w) =>
      (w.civ.cohesion - 0.58)
      + (w.adaptations.has('empathic') ? 0.5 : 0)
      + (w.adaptations.has('telepathy') ? 0.3 : 0)
      + (w.adaptations.has('hivemind') ? -0.1 : 0)
      + (w.adaptations.has('crystals') ? -0.35 : 0)   // they remember every slight
      + (w.adaptations.has('logic') ? -0.2 : 0);

    // Fear of what the other side is, subtracted from any willingness to talk.
    const fearA = this._menace(b), fearB = this._menace(a);
    const wa = warmth(a) - fearA * 0.8, wb = warmth(b) - fearB * 0.8;
    if (fearA > 0.55 || fearB > 0.55) {
      const scared = fearA >= fearB ? a : b, feared = scared === a ? b : a;
      scared.log(`What they have found frightens them. ${feared.starName} is something they cannot reason with.`, 'crisis');
      scared.milestone(`Terror at what was found orbiting ${feared.starName}`, 'crisis');
    }
    // Only a civilisation that can actually reach across the gap can fight over it.
    const bothSpacefaring = a.civ.tierIdx >= 5 && b.civ.tierIdx >= 5;
    const joint = wa + wb;

    if (joint > 0.45) {
      a.relations.set(b.id, 'ally'); b.relations.set(a.id, 'ally');
      a.log(`The two worlds begin to talk. Knowledge starts to flow between ${a.starName} and ${b.starName}.`, 'contact');
      a.civ.giftKnowledge(180); b.civ.giftKnowledge(180);
      a.milestone(`Alliance with ${b.starName}`, 'contact');
      b.milestone(`Alliance with ${a.starName}`, 'contact');
    } else if (joint < -0.25 && bothSpacefaring) {
      a.relations.set(b.id, 'hostile'); b.relations.set(a.id, 'hostile');
      // Dominance: the more advanced and more cohesive world prevails, and the
      // loser pays for it in knowledge and population.
      const scoreA = a.civ.knowledge * (0.5 + a.civ.cohesion);
      const scoreB = b.civ.knowledge * (0.5 + b.civ.cohesion);
      const win = scoreA >= scoreB ? a : b, lose = win === a ? b : a;
      // The winner uses whatever it actually built.
      const lattice = win.civ.techs.has('sophon');
      const warheads = win.civ.techs.has('warheads');
      if (lattice) {
        // Never fire a shot: corrupt their physics and let them stall forever.
        lose.civ.suppressedBy = win.id;
        lose.civ.suppressTimer = 60000;
        win.log(`An Observer Lattice is dispatched to ${lose.starName}. They will never know why their science stopped working.`, 'contact');
        lose.log(`Every experiment now returns nonsense. Their physics has been taken from them, and they do not know by whom.`, 'crisis');
        lose.milestone(`Science suppressed by ${win.starName}`, 'crisis');
        win.milestone(`Lattice deployed against ${lose.starName}`, 'contact');
      } else if (warheads) {
        lose.civ.knowledge *= 0.25;
        lose.population.massExtinction(0.6);
        win.log(`Relativistic warheads cross ${d.toFixed(1)} light years. ${lose.starName} is devastated.`, 'contact');
        lose.log(`Something arrived at a fraction of light speed. There was no warning and no defence.`, 'crisis');
        lose.milestone(`Bombarded by ${win.starName}`, 'crisis');
        win.milestone(`Bombarded ${lose.starName}`, 'contact');
      } else {
        lose.civ.knowledge *= 0.5;
        lose.population.massExtinction(0.3);
        win.log(`War across ${d.toFixed(1)} light years. ${win.starName} prevails over ${lose.starName}.`, 'contact');
        lose.log(`War across ${d.toFixed(1)} light years. ${lose.starName} is broken by ${win.starName}.`, 'crisis');
        win.milestone(`Prevailed over ${lose.starName}`, 'contact');
        lose.milestone(`Defeated by ${win.starName}`, 'crisis');
      }
    } else {
      a.relations.set(b.id, 'wary'); b.relations.set(a.id, 'wary');
      a.log(`Contact is made, and both worlds go quiet again. Neither trusts what it has found.`, 'contact');
    }
  }
}
