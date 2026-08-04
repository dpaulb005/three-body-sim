/*
 * presets.js — Ready-made star systems.
 *
 * Velocities are chosen close to the circular-orbit value v = sqrt(G*M/r) so
 * planets start loosely bound. The three-body "Trisolaris" case is deliberately
 * chaotic; the figure-eight is a real stable choreography (Chenciner &
 * Montgomery, 2000) shown to prove that not every three-body system is chaos.
 */

function _sun(x, y, vx, vy, mass, name) {
  return new Body({ x, y, vx, vy, mass, type: 'sun', name });
}
function _planet(x, y, vx, vy, massEarth = 1, composition = 'earth') {
  return new Body({ x, y, vx, vy, massEarth, composition, type: 'planet', name: 'the world' });
}

// Relative circular speed for a planet of finite Earth-mass around a primary
// measured in solar masses. Recentring later gives both bodies their exact
// barycentric share of that relative velocity.
const vCirc = (primaryMass, r, secondaryMassEarth = 1) =>
  Math.sqrt(CONFIG.G * (primaryMass + secondaryMassEarth * CONFIG.earthMassInSolar) / r);

const PRESETS = [
  {
    name: 'Empty Space (sandbox)',
    blurb: 'Nothing at all. Place your own suns and world, set their velocities, and see whether anything you build can hold together.',
    profile: { label: 'Your design' },
    build(world) {
      // Deliberately empty. Everything here is the player's.
    },
  },
  {
    name: 'Lone Sun (Earth-like)',
    blurb: 'A single steady star. Long Stable Era — life specialises and flourishes.',
    build(world) {
      const s = world.system;
      s.add(_sun(0, 0, 0, 0, 1.0, 'Sol'));
      const r = CONFIG.refDistance;
      s.add(_planet(r, 0, 0, vCirc(1.0, r)));
    },
  },
  {
    name: 'Binary Suns',
    blurb: 'Two stars locked in a tight waltz; the world circles the pair with strong seasons.',
    build(world) {
      const s = world.system;
      const m = 0.7, sep = 1.6, half = sep / 2;
      const vrel = Math.sqrt(CONFIG.G * (2 * m) / sep) / 2;
      s.add(_sun(-half, 0, 0, -vrel, m, 'Alpha'));
      s.add(_sun(half, 0, 0, vrel, m, 'Beta'));
      // Placed in this pair's actual habitable zone (see the flux model).
      const r = 4.3;
      s.add(_planet(r, 0, 0, vCirc(2 * m, r)));
    },
  },
  {
    name: 'Trisolaris (chaotic 3-body)',
    blurb: 'Three suns in an unpredictable dance. Wild swings between Stable and Chaotic Eras — evolve dormancy or perish.',
    build(world) {
      const s = world.system;
      const m = 0.9, R = 1.35;
      for (let i = 0; i < 3; i++) {
        const a = (Math.PI / 2) + i * (2 * Math.PI / 3);
        const x = Math.cos(a) * R, y = Math.sin(a) * R;
        // small tangential kick + tiny perturbation -> chaos
        const vt = 0.34;
        const vx = -Math.sin(a) * vt + (RNG() - 0.5) * 0.05;
        const vy = Math.cos(a) * vt + (RNG() - 0.5) * 0.05;
        s.add(_sun(x, y, vx, vy, m, ['Ay', 'Bee', 'Cee'][i]));
      }
      const r = 7.5;
      s.add(_planet(r, 0, 0, vCirc(3 * m, r) * 0.92));
    },
  },
  {
    name: 'Four-Body Maelstrom',
    blurb: 'Four suns and no mercy. Rarely a calm moment — only the most tolerant, dormant life survives.',
    build(world) {
      const s = world.system;
      const m = 0.65, R = 1.7;
      for (let i = 0; i < 4; i++) {
        const a = i * (Math.PI / 2) + 0.3;
        const x = Math.cos(a) * R, y = Math.sin(a) * R;
        const vt = 0.30;
        s.add(_sun(x, y, -Math.sin(a) * vt + (RNG() - 0.5) * 0.06,
          Math.cos(a) * vt + (RNG() - 0.5) * 0.06, m, ['Ay', 'Bee', 'Cee', 'Dee'][i]));
      }
      // Deliberately placed beyond the naive habitable zone: these suns tend to
      // pair up and scorch anything close in, so the far orbit is the only one
      // with any chance at all. Life here is a long shot.
      const r = 8.5;
      s.add(_planet(r, 0, 0, vCirc(4 * m, r) * 0.9));
    },
  },
  {
    name: 'Figure-Eight Choreography',
    blurb: 'A rare STABLE three-body orbit: three equal suns chase each other along a single figure-8, giving the world a permanent Stable Era. Proof that three suns need not mean chaos.',
    build(world) {
      const s = world.system;
      // Chenciner-Montgomery solution (G=1, m=1).
      s.add(_sun(0.97000436, -0.24308753, 0.4662036850, 0.4323657300, 1, 'One'));
      s.add(_sun(-0.97000436, 0.24308753, 0.4662036850, 0.4323657300, 1, 'Two'));
      s.add(_sun(0, 0, -0.93240737, -0.86473146, 1, 'Three'));
      // A near-massless world, placed in this trio's habitable zone (~21-29C)
      // where it stays perpetually in a Stable Era — the whole point of the
      // preset: a three-body system need not doom whatever lives near it.
      const r = 7;
      s.add(_planet(r, 0, 0, vCirc(3, r, 0.33), 0.33));
    },
  },

  // ── Alien environments ─────────────────────────────────────────────────
  // These differ from the ones above not in their orbits but in what the world
  // physically IS. A profile changes the thermal buffering, the metabolic
  // baseline and the radiation dose — so the same sky selects for very
  // different biology.
  {
    name: 'Tidally Locked World',
    blurb: 'One face always burning, one always frozen; life clings to the twilight ring. Close orbit means a heavy radiation dose.',
    profile: { label: 'Tidally locked', tidalLocked: true, rotationOrbits: 1.0,
               radiation: 0.55, hydrosphere: 'land' },
    build(world) {
      const s = world.system;
      s.add(_sun(0, 0, 0, 0, 0.55, 'Ember'));
      // Very close in — which is why it locked in the first place.
      const r = 2.5;
      s.add(_planet(r, 0, 0, vCirc(0.55, r, 0.86), 0.86));
    },
  },
  {
    name: 'High-Gravity World',
    blurb: 'Three times Earth gravity. Everything is short, dense and immensely strong — and everything costs more to build and move.',
    profile: { label: 'High gravity', hydrosphere: 'land', radiation: 0.08 },
    build(world) {
      const s = world.system;
      s.add(_sun(0, 0, 0, 0, 1.0, 'Sol'));
      const r = CONFIG.refDistance;
      s.add(_planet(r, 0, 0, vCirc(1.0, r, 13.5), 13.5, 'iron'));
    },
  },
  {
    name: 'Ocean World',
    blurb: 'A world of water under two suns. Enormous thermal mass smooths the chaos into something survivable — but there is no fire down there, and so no metallurgy.',
    profile: { label: 'Ocean', hydrosphere: 'ocean', radiation: 0.02 },
    build(world) {
      const s = world.system;
      const m = 0.7, sep = 1.6, half = sep / 2;
      const vrel = Math.sqrt(CONFIG.G * (2 * m) / sep) / 2;
      s.add(_sun(-half, 0, 0, -vrel, m, 'Thal'));
      s.add(_sun(half, 0, 0, vrel, m, 'Meri'));
      const r = 4.3;
      s.add(_planet(r, 0, 0, vCirc(2 * m, r, 8.36), 8.36, 'ocean'));
    },
  },
  {
    name: 'Rogue Planet',
    blurb: 'No sun at all. Life survives kilometres beneath the ice, around geothermal vents, where the concepts of sky and star may never arise.',
    profile: { label: 'Rogue / sub-glacial', hydrosphere: 'ice', geothermal: 0.72,
               radiation: 0.01 },
    build(world) {
      const s = world.system;
      // A single distant, feeble star it is not bound to — effectively starless.
      s.add(_sun(-46, 0, 0, 0, 0.35, 'a distant star'));
      s.add(_planet(0, 0, 0.02, 0, 13.5, 'ice'));
    },
  },
  {
    name: 'Flare Star',
    blurb: 'A violent dwarf that erupts without warning. Radiation is relentless, so life either hardens against it or learns to disappear until it passes.',
    profile: { label: 'Flare-irradiated', radiation: 0.85,
               hydrosphere: 'land' },
    build(world) {
      const s = world.system;
      s.add(_sun(0, 0, 0, 0, 0.45, 'Kestrel'));
      const r = 2.15;
      s.add(_planet(r, 0, 0, vCirc(0.45, r, 0.73), 0.73));
      // A heavy companion on a wide eccentric path keeps stirring the system,
      // producing the irregular flare-like swings in received flux.
      s.add(_sun(9.5, 0, 0, 0.30, 0.30, 'Shrike'));
    },
  },
];
