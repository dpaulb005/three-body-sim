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
function _planet(x, y, vx, vy, mass = 3e-5) {
  return new Body({ x, y, vx, vy, mass, type: 'planet', name: 'the world' });
}

// Circular orbital speed of a test body at radius r around total mass M.
const vCirc = (M, r) => Math.sqrt(CONFIG.G * M / r);

const PRESETS = [
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
      const r = 6.2;
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
      const r = 9;
      s.add(_planet(r, 0, 0, vCirc(4 * m, r) * 0.9));
    },
  },
  {
    name: 'Figure-Eight Choreography',
    blurb: 'A rare STABLE three-body orbit: three equal suns chase each other along a single figure-8. Proof that chaos is not guaranteed.',
    build(world) {
      const s = world.system;
      // Chenciner-Montgomery solution (G=1, m=1).
      s.add(_sun(0.97000436, -0.24308753, 0.4662036850, 0.4323657300, 1, 'One'));
      s.add(_sun(-0.97000436, 0.24308753, 0.4662036850, 0.4323657300, 1, 'Two'));
      s.add(_sun(0, 0, -0.93240737, -0.86473146, 1, 'Three'));
      // A near-massless world far enough out to barely perturb the choreography.
      const r = 11;
      s.add(_planet(r, 0, 0, vCirc(3, r), 1e-6));
    },
  },
];
