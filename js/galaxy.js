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
  // How far a spacefaring civilisation can positively identify an inhabited
  // world that is not signalling at all.
  surveyRange: 30,
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

  /*
   * Contact is asymmetric, and that asymmetry is the whole point.
   *
   * A civilisation with telescopes and probes can detect a world that has no
   * idea it is being watched — biosignatures and city lights give a
   * pre-industrial world away completely, and it learns nothing in return.
   * So there are three ways to find out about somebody else, and which one you
   * get depends entirely on how advanced you are:
   *
   *   RADIO      both sides are broadcasting and listening: mutual, and roughly
   *              fair. This is the only symmetric kind.
   *   OBSERVED   a spacefaring civilisation surveys a quiet world. The observer
   *              knows everything; the observed knows nothing at all.
   *   ARRIVAL    somebody turns up. For a low-technology world this is usually
   *              the first it ever hears of anyone — by which point the matter
   *              has already been decided.
   */
  _surveyRange(w) {
    // Telescopes and probes: how far this civilisation can positively identify
    // an inhabited world that is not signalling.
    if (!w.civ.awakened || w.civ.tierIdx < 5) return 0;
    return CONTACT.surveyRange * (0.4 + w.civ.reach);
  }

  _testContact() {
    const ws = this.worlds;
    for (let i = 0; i < ws.length; i++) {
      for (let j = 0; j < ws.length; j++) {
        if (i === j) continue;
        const obs = ws[i], target = ws[j];
        if (this._knows(obs, target)) continue;
        if (target.population.count === 0) continue;
        const d = this.lightYears(obs, target);

        // ── Radio: both sides technological. Symmetric. ──
        const heard = this._listening(obs) && this._emitting(target) > 0 &&
          d <= CONTACT.baseRange * this._emitting(target);

        // ── Survey: the observer is advanced enough to simply look. ──
        const surveyed = !heard && d <= this._surveyRange(obs);

        if (!heard && !surveyed) continue;

        obs.contacts.add(target.id);
        const tName = target.speciesName || 'something alive';

        if (heard) {
          obs.log(`First contact — a signal from ${target.starName}, ${d.toFixed(1)} light years out. They are not alone.`, 'contact');
          obs.milestone(`Detected ${target.starName} (${tName}) at ${d.toFixed(1)} ly`, 'contact');
          if (!this._knows(target, obs)) {
            target.log(`Something is listening. A world at ${obs.starName} has heard them.`, 'contact');
          }
          this.contacts.push({ a: obs.id, b: target.id, t: obs.system.time, kind: 'radio' });
          this._resolveRelation(obs, target, d);
        } else {
          // The observed world is told nothing. It cannot be, because it has no
          // way of knowing — and that silence is the point.
          obs.log(`Survey complete: ${target.starName}, ${d.toFixed(1)} light years out, is inhabited. Whatever lives there has no idea it has been seen.`, 'contact');
          obs.milestone(`Surveyed ${target.starName} — ${tName}, unaware`, 'contact');
          this.contacts.push({ a: obs.id, b: target.id, t: obs.system.time, kind: 'observed' });
          this._resolveObservation(obs, target, d);
        }
        return;  // one contact per check, so the chronicle stays readable
      }
    }
  }

  /*
   * What an advanced civilisation does about a world that cannot see it back.
   * Ignore it, watch it, or take it — and if it takes it, the victim's first
   * and last knowledge of anyone else is the arrival itself.
   */
  _resolveObservation(obs, target, d) {
    obs.relations.set(target.id, 'observing');
    const fear = this._menace(target);
    const canReach = obs.civ.reach >= 0.6;
    const predatory = (obs.civ.cohesion < 0.45 || fear > 0.4 || obs.adaptations.has('logic'))
      && !obs.adaptations.has('empathic');

    if (!canReach || !predatory) {
      obs.log(`They decide to watch, and say nothing.`, 'contact');
      return;
    }

    // Arrival. This is the moment the quiet world learns anybody else exists.
    obs.relations.set(target.id, 'hostile');
    target.relations.set(obs.id, 'hostile');
    target.contacts.add(obs.id);   // they know now, because it is on top of them

    const era = target.civ.awakened ? target.civ.tier.name : 'pre-sapient';
    if (obs.civ.techs.has('warheads')) {
      target.civ.knowledge *= 0.15;
      target.population.massExtinction(0.7);
      target.log(`The sky filled with light. They had no word for what arrived, no theory that permitted it, and no warning. This is the first time they learn that anyone else exists.`, 'crisis');
      target.milestone(`Annihilated from orbit by ${obs.starName} — a ${era} world that never saw it coming`, 'crisis');
      obs.log(`${target.starName} is cleared. It was a ${era} world; it never knew what happened.`, 'contact');
      obs.milestone(`Cleared ${target.starName} before it could answer`, 'contact');
    } else {
      target.civ.knowledge *= 0.35;
      target.population.massExtinction(0.4);
      target.log(`Ships came down out of a sky they had only ever looked at. Their first contact with another civilisation is its occupation of their world.`, 'crisis');
      target.milestone(`Conquered by ${obs.starName} — first contact was the invasion`, 'crisis');
      obs.log(`${target.starName} is taken. A ${era} world put up what resistance it could.`, 'contact');
      obs.milestone(`Conquered ${target.starName}`, 'contact');
    }
  }

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
