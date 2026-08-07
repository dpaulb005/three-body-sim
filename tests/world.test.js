#!/usr/bin/env node
'use strict';

/*
 * world.test.js — The planet as a place.
 *
 * These defend the claims the geography model exists to make: that bands are
 * real spherical area, that the sunlight falling on them is integrated rather
 * than invented, that a tidally locked world has a liveable ring between its
 * scorched face and its frozen one, and that the whole thing stays consistent
 * with the climate model it sits on top of.
 *
 * Also here: the guard that stops a world simulating a biosphere on a planet
 * that has fallen into a star, which is a thing that used to happen.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const context = vm.createContext({ console, Math });
for (const file of ['js/config.js', 'js/physics.js', 'js/utils.js', 'js/climate.js',
  'js/environment.js', 'js/geography.js', 'js/adaptations.js', 'js/evolution.js',
  'js/technology.js', 'js/civilization.js', 'js/species.js', 'js/presets.js', 'js/world.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
}
vm.runInContext(`globalThis.api = { Geography, WorldProfile, Climate, World, PRESETS,
  insolationByBand, insolationLocked, GEO, reseed, compositionLabel, Body };`, context);
const A = context.api;

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

function nearly(actual, expected, tolerance, message) {
  assert.ok(Math.abs(actual - expected) <= tolerance,
    `${message}: expected ${expected}, got ${actual} (tol ${tolerance})`);
}

// A world at a chosen mean temperature, with no simulation attached.
function settle(profileOpts, meanTempC, flux = 0.0045) {
  const profile = new A.WorldProfile(profileOpts);
  const climate = new A.Climate();
  climate.tempC = meanTempC;
  climate.habitatTempC = meanTempC;
  climate.flux = flux;
  const geo = new A.Geography();
  geo.update(climate, profile, null);
  return { profile, climate, geo };
}

run('bands are equal-area, which is what makes them a sphere and not a strip', () => {
  const { geo } = settle({}, 15);
  let total = 0;
  for (const b of geo.bands) total += b.area;
  nearly(total, 1, 1e-12, 'band areas must tile the whole surface exactly once');
  for (const b of geo.bands) nearly(b.area, 1 / geo.n, 1e-12, 'every band is the same area');
  // Equal area means equal steps in sin(latitude), not in latitude itself, so
  // the polar bands must span more degrees than the equatorial ones.
  const equator = Math.abs(geo.latitudeOf(geo.bands[Math.floor(geo.n / 2)]));
  const pole = Math.abs(geo.latitudeOf(geo.bands[0]));
  assert.ok(pole > 60 && equator < 5,
    `bands should run from the equator to high latitude, got ${equator}..${pole}`);
});

run('insolation is integrated over a real orbit, and conserves the energy it should', () => {
  // A sphere intercepts pi*r^2 and radiates from 4*pi*r^2, so the global mean of
  // the daily-mean insolation is exactly a quarter of the beam. Every band being
  // equal-area means that is just the arithmetic mean of the band values.
  for (const tilt of [0, 23.4, 45, 90]) {
    const rel = A.insolationByBand(tilt, A.GEO.bands);
    let mean = 0;
    for (let i = 0; i < rel.length; i++) mean += rel[i] / rel.length;
    nearly(mean, 0.25, 0.004, `obliquity ${tilt}° must conserve total insolation`);
  }
  const locked = A.insolationLocked(A.GEO.bands);
  let lockedMean = 0;
  for (let i = 0; i < locked.length; i++) lockedMean += locked[i] / locked.length;
  nearly(lockedMean, 0.25, 0.02, 'a locked world intercepts the same total beam');
});

run('obliquity decides where the liveable part of a world is', () => {
  const n = A.GEO.bands;
  const upright = A.insolationByBand(0, n);
  const mid = A.insolationByBand(23.4, n);
  const tipped = A.insolationByBand(90, n);
  const poleIdx = 0, eqIdx = Math.floor(n / 2);

  // With no tilt the poles never see the sun high, so the gradient is steepest.
  assert.ok(upright[poleIdx] < mid[poleIdx],
    'tilting a world warms its poles');
  assert.ok(upright[eqIdx] > tipped[eqIdx],
    'tilting a world takes sunlight away from its equator');
  // Past roughly 54 degrees the poles receive MORE annual sunlight than the
  // equator — a real and counter-intuitive result, and Uranus lives there.
  assert.ok(tipped[poleIdx] > tipped[eqIdx],
    'a world on its side is lit hardest at the poles');
  assert.ok(upright[poleIdx] < upright[eqIdx],
    'an upright world is lit hardest at the equator');
});

run('a cold world keeps its tropics and a hot world keeps its poles', () => {
  const cold = settle({}, -22).geo;
  const hot = settle({}, 74).geo;
  // Neither is uniformly dead — that was the whole problem with one number.
  assert.ok(cold.habitableFraction > 0 && cold.habitableFraction < 1,
    `a cold world should be liveable only near the equator, got ${cold.habitableFraction}`);
  assert.ok(hot.habitableFraction > 0 && hot.habitableFraction < 1,
    `a hot world should be liveable only near the poles, got ${hot.habitableFraction}`);
  const coldLive = cold.bands.filter(b => b.habitable);
  const hotLive = hot.bands.filter(b => b.habitable);
  const meanAbsLat = (bands, g) =>
    bands.reduce((s, b) => s + Math.abs(g.latitudeOf(b)), 0) / bands.length;
  assert.ok(meanAbsLat(coldLive, cold) < meanAbsLat(hotLive, hot),
    'the liveable band of a cold world sits nearer the equator than that of a hot world');
});

run('the bands agree with the climate they were derived from', () => {
  for (const meanT of [-40, -5, 15, 40, 70]) {
    const { geo, climate } = settle({}, meanT);
    let mean = 0;
    for (const b of geo.bands) mean += b.tempC * b.area;
    nearly(mean, climate.tempC, 1e-9,
      'the area-weighted mean of the bands is the planetary temperature');
    assert.ok(geo.hottestC >= geo.coldestC, 'hottest band is not colder than the coldest');
  }
});

run('water flattens a world and bare rock does not', () => {
  const rock = settle({ hydrosphere: 'land' }, 15).geo;
  const sea = settle({ hydrosphere: 'ocean' }, 15).geo;
  assert.ok(sea.spreadC < rock.spreadC * 0.75,
    `an ocean should move heat far better than rock (${sea.spreadC.toFixed(1)} vs ${rock.spreadC.toFixed(1)})`);
  // Bare rock at Earth's tilt should land in the neighbourhood of our own
  // pole-to-equator range, which is roughly 50 degrees.
  assert.ok(rock.spreadC > 25 && rock.spreadC < 80,
    `a rocky world's spread should be Earth-like, got ${rock.spreadC.toFixed(1)}°`);
});

run('a tidally locked world is a bullseye with a liveable ring', () => {
  const { geo } = settle({ tidalLocked: true }, 15);
  assert.ok(geo.locked, 'the model switches projection when the world is locked');
  const sub = geo.bands[0], anti = geo.bands[geo.n - 1];
  assert.ok(sub.tempC > 100, `the lit face should be scorched, got ${sub.tempC.toFixed(0)}°C`);
  assert.ok(anti.tempC < -60, `the night side should be frozen, got ${anti.tempC.toFixed(0)}°C`);
  const live = geo.bands.filter(b => b.habitable);
  assert.ok(live.length > 0, 'there must be a twilight ring — this is the whole point');
  assert.ok(live.length < geo.n / 2, 'but it is a ring, not half a planet');
  // And it genuinely sits between the two extremes rather than at either end.
  for (const b of live) {
    const angle = geo.angleOf(b);
    assert.ok(angle > 30 && angle < 150,
      `the liveable ring should straddle the terminator, found one at ${angle.toFixed(0)}°`);
  }
  assert.match(geo.habitableZoneLabel(), /substellar/,
    'and it describes itself in terms of the star, not of latitude');
});

run('a world with nowhere to live says so instead of averaging it away', () => {
  const { geo, climate, profile } = settle({}, -180);
  assert.equal(geo.habitableFraction, 0, 'nothing on a frozen world is survivable');
  assert.match(geo.habitableZoneLabel(), /Nowhere/, 'and the label admits it');
  climate.applyNiche(geo, profile);
  assert.ok(Number.isFinite(climate.habitatTempC),
    'the niche temperature stays a real number with no habitable band to average');
  assert.ok(climate.habitatTempC < CONFIG_STABLE_LO(),
    'and it reports something genuinely uninhabitable rather than a comfortable mean');
});
function CONFIG_STABLE_LO() {
  return vm.runInContext('CONFIG.stableBandC[0]', context);
}

run('geothermal warmth reaches every band, because it is under all of them', () => {
  const { geo } = settle({ hydrosphere: 'ice', geothermal: 0.72 }, -200);
  nearly(geo.habitableFraction, 1, 1e-9,
    'a vent-warmed sub-glacial ocean is liveable everywhere, however dark the sky');
  for (const b of geo.bands) {
    assert.ok(b.habitatC > -10 && b.habitatC < 20,
      `vents hold the niche near freezing, got ${b.habitatC.toFixed(1)}°C`);
    assert.ok(b.tempC < -100, 'while the surface above stays lethal');
  }
});

run('atmosphere follows from mass and heat, and Earth reads one bar', () => {
  const earth = new A.WorldProfile();
  earth.planetMassEarth = 1; earth.radiusEarth = 1; earth.gravity = 1;
  nearly(earth.escapeVelocityKmS, 11.186, 0.01, 'Earth escape velocity');
  nearly(earth.surfacePressureBar(15), 1, 0.05, 'Earth should read about one bar');

  // Our Moon: 0.0123 Earth masses, 0.273 Earth radii. It has no air.
  const moon = new A.WorldProfile();
  moon.planetMassEarth = 0.0123; moon.radiusEarth = 0.273; moon.gravity = 0.165;
  assert.ok(moon.surfacePressureBar(-20) < 0.02,
    `a Moon-sized body cannot hold air, got ${moon.surfacePressureBar(-20).toFixed(3)} bar`);
  // Mars: thin but not nothing.
  const mars = new A.WorldProfile();
  mars.planetMassEarth = 0.107; mars.radiusEarth = 0.532; mars.gravity = 0.38;
  const marsBar = mars.surfacePressureBar(-60);
  assert.ok(marsBar > 0 && marsBar < 0.3, `Mars should be thin, got ${marsBar.toFixed(3)} bar`);
  // The same rock, made hot, holds less: heat is what drives gas away.
  assert.ok(mars.surfacePressureBar(400) < marsBar, 'heating a world strips its air');
});

run('a world whose planet is destroyed stops pretending to have one', () => {
  const world = new A.World();
  const preset = A.PRESETS.find(p => p.name.startsWith('Lone Sun'));
  A.reseed(1000);
  world.loadPreset(preset, { seedLife: true });
  for (let i = 0; i < 400; i++) world.step();
  assert.ok(world.population.count > 0, 'life is present before the catastrophe');

  // Take the planet away, exactly as a merge with a star would.
  world.system.remove(world.system.planet);
  world.step();
  assert.equal(world.system.planet, null, 'the planet really is gone');
  assert.equal(world.population.count, 0, 'and nothing is left living on it');
  assert.equal(world.civ.awakened, false, 'no civilisation persists on a destroyed world');
  assert.ok(world.events.some(e => /world itself is gone/.test(e.text)),
    'the loss is reported rather than passed over in silence');
  // And it must keep stepping without throwing, forever.
  for (let i = 0; i < 500; i++) world.step();
  assert.equal(world.population.count, 0, 'a destroyed world stays destroyed');
});

run('every preset resolves into a real place with coherent attributes', () => {
  for (const preset of A.PRESETS) {
    A.reseed(1000);
    const world = new A.World();
    world.loadPreset(preset, { seedLife: true });
    if (!world.system.planet) continue;       // the empty sandbox
    for (let i = 0; i < 3000; i++) world.step();
    const geo = world.geography, name = preset.name;
    assert.ok(geo.habitableFraction >= 0 && geo.habitableFraction <= 1,
      `${name}: habitable fraction out of range`);
    assert.ok(geo.settledFraction <= geo.habitableFraction + 1e-9,
      `${name}: a species cannot occupy more than is survivable`);
    for (const b of geo.bands) {
      assert.ok(Number.isFinite(b.tempC) && Number.isFinite(b.habitatC),
        `${name}: band temperature is not a number`);
    }
    assert.ok(Number.isFinite(world.profile.escapeVelocityKmS) && world.profile.escapeVelocityKmS > 0,
      `${name}: escape velocity must be a positive number`);
    assert.ok(Number.isFinite(world.profile.surfacePressureBar(world.climate.tempC)),
      `${name}: surface pressure must be a number`);
    const year = world.yearInEarthYears;
    assert.ok(year === null || year > 0, `${name}: a year is either real or absent`);
    assert.equal(typeof A.compositionLabel(world.system.planet), 'string',
      `${name}: every makeup has a name`);
  }
});

// Only claim success if nothing set a failing exit code along the way.
if (process.exitCode) console.error('\nSome world tests FAILED.');
else console.log('All world tests passed.');
