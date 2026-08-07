#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { performance } = require('node:perf_hooks');

const root = path.resolve(__dirname, '..');
const context = vm.createContext({ console, Math });
for (const file of ['js/config.js', 'js/physics.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
}
vm.runInContext(`globalThis.api = { CONFIG, Body, NBodySystem,
  PLANET_COMPOSITIONS, compositionDensity };`, context);
const { CONFIG, Body, NBodySystem } = context.api;

function nearly(actual, expected, tolerance, message) {
  assert.ok(Math.abs(actual - expected) <= tolerance,
    `${message}: expected ${expected}, got ${actual} (tol ${tolerance})`);
}

function relativeError(actual, expected) {
  return Math.abs((actual - expected) / expected);
}

function makeBody(properties) { return new Body(properties); }

function run(name, test) {
  const started = performance.now();
  test();
  console.log(`ok - ${name} (${(performance.now() - started).toFixed(1)} ms)`);
}

run('one body follows exact inertial motion', () => {
  const system = new NBodySystem();
  const body = system.add(makeBody({ x: 1, y: -2, vx: 0.2, vy: -0.4, mass: 1 }));
  system.step(10);
  nearly(body.x, 3, 1e-13, 'x');
  nearly(body.y, -6, 1e-13, 'y');
  nearly(body.vx, 0.2, 1e-15, 'vx');
  nearly(body.vy, -0.4, 1e-15, 'vy');
});

run('two finite masses complete a barycentric circular orbit', () => {
  const system = new NBodySystem();
  const m1 = 1, m2 = CONFIG.earthMassInSolar, total = m1 + m2, separation = 1;
  const relativeSpeed = Math.sqrt(CONFIG.G * total / separation);
  const star = system.add(makeBody({
    x: -m2 / total * separation, y: 0,
    vx: 0, vy: -m2 / total * relativeSpeed, mass: m1,
  }));
  const planet = system.add(makeBody({
    x: m1 / total * separation, y: 0,
    vx: 0, vy: m1 / total * relativeSpeed, massEarth: 1, type: 'planet',
  }));
  const initialEnergy = system.totalEnergy();
  const period = 2 * Math.PI * Math.sqrt(separation ** 3 / (CONFIG.G * total));
  const steps = 630;
  for (let i = 0; i < steps; i++) system.step(period / steps);
  nearly(planet.x - star.x, separation, 1e-5, 'relative x after one period');
  nearly(planet.y - star.y, 0, 1e-5, 'relative y after one period');
  assert.ok(relativeError(system.totalEnergy(), initialEnergy) < 1e-9, 'two-body energy drift');
});

run('three-body figure-eight choreography remains periodic', () => {
  const system = new NBodySystem();
  const initial = [
    [0.97000436, -0.24308753, 0.4662036850, 0.4323657300],
    [-0.97000436, 0.24308753, 0.4662036850, 0.4323657300],
    [0, 0, -0.93240737, -0.86473146],
  ];
  for (const [x, y, vx, vy] of initial) system.add(makeBody({ x, y, vx, vy, mass: 1 }));
  const initialEnergy = system.totalEnergy();
  const period = 6.32591398;
  const steps = 633;
  for (let i = 0; i < steps; i++) system.step(period / steps);
  let squaredError = 0;
  for (let i = 0; i < 3; i++) {
    squaredError += (system.bodies[i].x - initial[i][0]) ** 2;
    squaredError += (system.bodies[i].y - initial[i][1]) ** 2;
  }
  assert.ok(Math.sqrt(squaredError / 6) < 2e-5, 'figure-eight return-position RMS error');
  assert.ok(relativeError(system.totalEnergy(), initialEnergy) < 2e-8, 'three-body energy drift');
});

run('four-body gravity conserves momentum and bounded energy error', () => {
  const system = new NBodySystem();
  system.add(makeBody({ x: 0, y: 0, mass: 1, type: 'sun' }));
  for (const [radius, massEarth, phase] of [[1, 1, 0], [1.7, 10, 2.1], [3, 100, 4.2]]) {
    const mass = massEarth * CONFIG.earthMassInSolar;
    const speed = Math.sqrt(CONFIG.G * (1 + mass) / radius);
    system.add(makeBody({
      x: Math.cos(phase) * radius, y: Math.sin(phase) * radius,
      vx: -Math.sin(phase) * speed, vy: Math.cos(phase) * speed,
      massEarth, type: 'planet',
    }));
  }
  system.recenter();
  const initialEnergy = system.totalEnergy();
  const initialAngularMomentum = system.angularMomentum();
  for (let i = 0; i < 10000; i++) system.step(CONFIG.dt);
  const momentum = system.totalMomentum();
  assert.ok(Math.hypot(momentum.x, momentum.y) < 2e-14, 'linear momentum conservation');
  assert.ok(relativeError(system.angularMomentum(), initialAngularMomentum) < 2e-12,
    'angular momentum conservation');
  assert.ok(relativeError(system.totalEnergy(), initialEnergy) < 2e-6, 'four-body energy drift');
  for (const body of system.bodies) {
    assert.ok(Number.isFinite(body.x) && Number.isFinite(body.y), 'finite four-body state');
  }
});

run('close encounters refine locally and fast contacts cannot tunnel', () => {
  const close = new NBodySystem();
  close.add(makeBody({ x: -0.005, y: 0, mass: 1, type: 'sun' }));
  close.add(makeBody({ x: 0.005, y: 0, mass: 1, type: 'sun' }));
  assert.ok(close._substepCount(CONFIG.dt) > CONFIG.substeps,
    'close pair activates adaptive refinement');

  const system = new NBodySystem();
  const star = system.add(makeBody({ x: 0, y: 0, mass: 1, type: 'sun' }));
  const planet = system.add(makeBody({
    x: -0.02, y: 0, vx: 10, vy: 0, massEarth: 1, type: 'planet',
  }));
  const initialMass = star.mass + planet.mass;
  const initialMomentum = system.totalMomentum();
  system.step(0.004);
  assert.equal(system.bodies.length, 1, 'swept collision merged the crossing bodies');
  nearly(system.bodies[0].mass, initialMass, 1e-15, 'collision mass conservation');
  const finalMomentum = system.totalMomentum();
  nearly(finalMomentum.x, initialMomentum.x, 2e-12, 'collision x-momentum conservation');
  nearly(finalMomentum.y, initialMomentum.y, 2e-12, 'collision y-momentum conservation');
});

run('planet makeup determines density, radius, and surface gravity', () => {
  const earth = makeBody({ x: 0, y: 0, massEarth: 1, type: 'planet', composition: 'earth' });
  nearly(earth.density, CONFIG.earthDensity, 1e-12, 'Earth density');
  nearly(earth.radiusEarth, 1, 1e-12, 'Earth radius');
  nearly(earth.surfaceGravityG, 1, 1e-12, 'Earth gravity');
  const ocean = makeBody({ x: 0, y: 0, massEarth: 1, type: 'planet', composition: 'ocean' });
  assert.ok(ocean.density < earth.density, 'ocean world is less dense');
  assert.ok(ocean.radiusEarth > earth.radiusEarth, 'ocean world is larger at equal mass');
  const giant = makeBody({ x: 0, y: 0, massEarth: 318, type: 'planet', composition: 'gas' });
  assert.ok(giant.radiusEarth > 10 && giant.radiusEarth < 12, 'Jupiter-like radius scaling');
});

run('every browser preset loads and advances with coherent planet properties', () => {
  for (const file of ['js/utils.js', 'js/climate.js', 'js/environment.js', 'js/geography.js',
    'js/adaptations.js', 'js/evolution.js', 'js/technology.js',
    'js/civilization.js', 'js/species.js', 'js/presets.js', 'js/world.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  }
  vm.runInContext('globalThis.api.World = World; globalThis.api.PRESETS = PRESETS;', context);
  const { World, PRESETS } = context.api;
  for (const preset of PRESETS) {
    const world = new World();
    world.loadPreset(preset, { seedLife: false });
    const planet = world.system.planet;
    // The sandbox preset is deliberately empty — the player supplies everything.
    if (!planet) {
      assert.equal(world.system.bodies.length, 0, `${preset.name} is an empty sandbox`);
      continue;
    }
    nearly(world.profile.gravity, planet.surfaceGravityG, 1e-12,
      `${preset.name} profile gravity follows mass and density`);
    for (let i = 0; i < 100; i++) world.step();
    for (const body of world.system.bodies) {
      assert.ok(Number.isFinite(body.x) && Number.isFinite(body.y), `${preset.name} finite state`);
    }
  }
});

run('five-body physics has ample 60 FPS headroom', () => {
  const system = new NBodySystem();
  system.add(makeBody({ x: 0, y: 0, mass: 1, type: 'sun' }));
  for (let i = 0; i < 4; i++) {
    const radius = 1 + i * 0.8, phase = i * 1.4;
    const speed = Math.sqrt(CONFIG.G / radius);
    system.add(makeBody({
      x: Math.cos(phase) * radius, y: Math.sin(phase) * radius,
      vx: -Math.sin(phase) * speed, vy: Math.cos(phase) * speed,
      massEarth: 1 + i, type: 'planet',
    }));
  }
  system.recenter();
  const count = 20000;
  const started = performance.now();
  for (let i = 0; i < count; i++) system.step(CONFIG.dt);
  const elapsedSeconds = (performance.now() - started) / 1000;
  const stepsPerSecond = count / elapsedSeconds;
  console.log(`  benchmark: ${Math.round(stepsPerSecond).toLocaleString()} simulation steps/s`);
  assert.ok(stepsPerSecond > 5000,
    `physics throughput ${Math.round(stepsPerSecond)} steps/s is below the 5000 target`);
});

if (process.exitCode) console.error('\nSome physics tests FAILED.');
else console.log('All physics tests passed.');
