/*
 * main.js — Boots the simulation and drives the animation loop.
 *
 * Each animation frame we advance `world.speed` physics steps (so the star
 * dance and evolution can run fast-forward), then render once. HUD/readout
 * text is refreshed a few times a second rather than every frame to keep the
 * DOM cheap.
 */

(function boot() {
  const galaxy = new Galaxy();
  const world = galaxy.add(new World());
  const renderer = new Renderer(galaxy);
  const ui = new UI(galaxy, renderer);

  // expose for tinkering in the console
  window.DEMIURGE = { galaxy, renderer, ui, CONFIG, get world() { return galaxy.active; } };

  // A shared link fully specifies its world; otherwise start on Trisolaris.
  if (!ui.editor.applyFromURL()) {
    const startIndex = PRESETS.findIndex(p => p.name.startsWith('Trisolaris'));
    ui.loadPreset(startIndex >= 0 ? startIndex : 0);
  }

  let textAccum = 0;

  function frame(now) {
    const active = galaxy.active;
    if (active.running && active.speed > 0) {
      // Every world advances, not just the one being watched — otherwise a
      // civilisation you are not looking at could never rise to meet you.
      for (let i = 0; i < active.speed; i++) galaxy.step();
    }
    renderer.draw();

    // throttle DOM text updates to ~8 Hz
    textAccum++;
    if (textAccum >= 7) {
      textAccum = 0;
      ui.updateHUD();
      ui.updateCiv();
      ui.updateAdaptations();
      ui.updateDossier();
      ui.updateGalaxy();
      ui.updateCivSwitch();
      ui.updateCivRecord();
      ui.updateReadout();
    }

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
