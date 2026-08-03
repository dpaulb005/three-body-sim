/*
 * main.js — Boots the simulation and drives the animation loop.
 *
 * Each animation frame we advance `world.speed` physics steps (so the star
 * dance and evolution can run fast-forward), then render once. HUD/readout
 * text is refreshed a few times a second rather than every frame to keep the
 * DOM cheap.
 */

(function boot() {
  const world = new World();
  const renderer = new Renderer(world);
  const ui = new UI(world, renderer);

  // expose for tinkering in the console
  window.DEMIURGE = { world, renderer, ui, CONFIG };

  // Start on the flagship chaotic scenario.
  const startIndex = PRESETS.findIndex(p => p.name.startsWith('Trisolaris'));
  ui.loadPreset(startIndex >= 0 ? startIndex : 0);

  let textAccum = 0;

  function frame(now) {
    if (world.running && world.speed > 0) {
      for (let i = 0; i < world.speed; i++) world.step();
    }
    renderer.draw();

    // throttle DOM text updates to ~8 Hz
    textAccum++;
    if (textAccum >= 7) {
      textAccum = 0;
      ui.updateHUD();
      ui.updateReadout();
      ui.updateLog();
    }

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
