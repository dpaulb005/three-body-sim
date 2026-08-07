/*
 * render.js — All drawing. Three surfaces:
 *   cosmos  : the N-body star system (trails, glowing suns, the shaded world)
 *   surface : the planet's biosphere strip (creatures coloured by their genome)
 *   graphs  : temperature / population / trait time-series
 *
 * The cosmos camera auto-fits every frame (smoothed) so a chaotic system that
 * flings suns apart stays on screen.
 */

// Canvas text uses the same family as the interface.
const FONT = '"Space Grotesk", -apple-system, BlinkMacSystemFont, Inter, system-ui, sans-serif';

class Renderer {
  constructor(galaxy) {
    // The renderer always draws whichever world is currently selected.
    this.galaxy = galaxy;
    this.cosmos = this._setup('cosmos');
    this.surface = this._setup('surface');
    this.graphs = this._setup('graphs');
    this.worldmap = this._setup('worldmap');

    this.cam = { x: 0, y: 0, scale: CONFIG.pixelsPerUnit, mode: 'planet' };
    this._camInit = false;
    this.selected = null;
    this.ghost = null;   // {x,y,vx,vy,mass,type} while placing a body

    this._starfield = null;
    window.addEventListener('resize', () => this._resizeAll());
    this._resizeAll();
  }

  get world() { return this.galaxy.active; }

  _setup(id) {
    const canvas = document.getElementById(id);
    const ctx = canvas.getContext('2d');
    return { canvas, ctx, w: 0, h: 0 };
  }

  _resizeAll() {
    for (const s of [this.cosmos, this.surface, this.graphs, this.worldmap]) this._resize(s);
    this._buildStarfield();
  }

  _resize(s) {
    const dpr = window.devicePixelRatio || 1;
    const rect = s.canvas.getBoundingClientRect();
    s.w = rect.width; s.h = rect.height;
    s.canvas.width = Math.max(1, Math.round(rect.width * dpr));
    s.canvas.height = Math.max(1, Math.round(rect.height * dpr));
    s.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  _buildStarfield() {
    const { w, h } = this.cosmos;
    const rng = makeRNG(1234);
    const n = Math.floor(w * h / 4200);
    const pts = [];
    for (let i = 0; i < n; i++) pts.push([rng() * w, rng() * h, 0.3 + rng() * 0.7, rng() * 1.6 + 0.3]);
    this._starfield = pts;
  }

  // ---- camera ----
  /*
   * The old camera auto-fitted every body every frame, which meant one sun
   * slingshotting out of the system dragged the view with it and the planet
   * shrank to nothing. Three fixes:
   *
   *   1. FOCUS MODES. Follow the planet (default), fit the system, or free.
   *   2. ESCAPEE REJECTION. A fit ignores bodies that have clearly left, so a
   *      departing star cannot hijack the framing.
   *   3. MANUAL CONTROL. Wheel zooms, right/middle-drag pans, and touching
   *      either drops you into free mode until you recentre.
   *
   * Nothing that leaves is ever lost, either: off-screen bodies get an edge
   * marker showing which way they went and how far.
   */
  setMode(mode) {
    this.cam.mode = mode;
    if (mode !== 'free') this._camInit = false;   // re-frame immediately
  }

  zoomBy(factor, sx, sy) {
    const before = this.screenToWorld(sx, sy);
    this.cam.scale = clamp(this.cam.scale * factor, 0.6, 400);
    const after = this.screenToWorld(sx, sy);
    // Keep the point under the cursor pinned while zooming.
    this.cam.x += before.x - after.x;
    this.cam.y += before.y - after.y;
    this.cam.mode = 'free';
  }

  panBy(dxPx, dyPx) {
    this.cam.x -= dxPx / this.cam.scale;
    this.cam.y -= dyPx / this.cam.scale;
    this.cam.mode = 'free';
  }

  // Bodies that are still meaningfully part of the system. A star that has been
  // flung out is excluded from framing so it stops stealing the view.
  _framedBodies() {
    const bodies = this.world.system.bodies;
    if (bodies.length < 2) return bodies;
    const com = this.world.system.centerOfMass();
    const ds = bodies.map(b => Math.hypot(b.x - com.x, b.y - com.y));
    const sorted = [...ds].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] || 1;
    // Generous cut: keep anything within 6x the median distance, always keep
    // the planet, and never return an empty set.
    const kept = bodies.filter((b, i) => b.type === 'planet' || ds[i] <= Math.max(median * 6, 3));
    return kept.length ? kept : bodies;
  }

  fitCamera() {
    const sys = this.world.system;
    if (!sys.bodies.length) return;
    const mode = this.cam.mode;
    if (mode === 'free') return;

    let target;
    if (mode === 'planet' && sys.planet) {
      // Frame the world and whatever star currently dominates its sky, so the
      // planet is always visible and always in context.
      const p = sys.planet;
      const sun = this._brightestSunAt(p);
      const span = sun ? Math.max(Math.hypot(sun.x - p.x, sun.y - p.y) * 2.4, 4) : 8;
      const { w, h } = this.cosmos;
      target = {
        x: sun ? (p.x + sun.x) / 2 : p.x,
        y: sun ? (p.y + sun.y) / 2 : p.y,
        scale: clamp(Math.min(w, h) / span, 3, 200),
      };
    } else {
      const bodies = this._framedBodies();
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const b of bodies) {
        minX = Math.min(minX, b.x); maxX = Math.max(maxX, b.x);
        minY = Math.min(minY, b.y); maxY = Math.max(maxY, b.y);
      }
      const spanX = Math.max(maxX - minX, 2), spanY = Math.max(maxY - minY, 2);
      const { w, h } = this.cosmos;
      target = {
        x: (minX + maxX) / 2, y: (minY + maxY) / 2,
        scale: clamp(Math.min(w / (spanX * 1.35), h / (spanY * 1.35)), 1.5, 200),
      };
    }

    if (!this._camInit) { this.cam = { ...this.cam, ...target }; this._camInit = true; }
    else {
      const k = 0.08;
      this.cam.x = lerp(this.cam.x, target.x, k);
      this.cam.y = lerp(this.cam.y, target.y, k);
      this.cam.scale = lerp(this.cam.scale, target.scale, k);
    }
  }

  // Anything off-screen gets an arrow at the edge, so a body that leaves can
  // always be found again.
  _drawOffscreenMarkers(ctx) {
    const { w, h } = this.cosmos;
    const pad = 22;
    for (const b of this.world.system.bodies) {
      const p = this.worldToScreen(b.x, b.y);
      if (p.x > -30 && p.x < w + 30 && p.y > -30 && p.y < h + 30) continue;
      const cx = w / 2, cy = h / 2;
      const dx = p.x - cx, dy = p.y - cy;
      const len = Math.hypot(dx, dy) || 1;
      const nx = dx / len, ny = dy / len;
      const t = Math.min((w / 2 - pad) / Math.abs(nx || 1e-6), (h / 2 - pad) / Math.abs(ny || 1e-6));
      const ex = cx + nx * t, ey = cy + ny * t;

      const col = b.type === 'planet' ? '#7de3ff' : starColor(b.mass);
      ctx.save();
      ctx.translate(ex, ey); ctx.rotate(Math.atan2(ny, nx));
      ctx.beginPath(); ctx.moveTo(7, 0); ctx.lineTo(-5, 4.5); ctx.lineTo(-5, -4.5); ctx.closePath();
      ctx.fillStyle = col; ctx.fill();
      ctx.restore();

      const au = Math.hypot(b.x - this.cam.x, b.y - this.cam.y);
      ctx.font = '500 9.5px ' + FONT;
      ctx.fillStyle = 'rgba(235,235,245,0.55)';
      ctx.textAlign = nx > 0.4 ? 'right' : nx < -0.4 ? 'left' : 'center';
      ctx.fillText(`${b.name || b.type} ${au.toFixed(0)} AU`,
        ex - nx * 12, ey - ny * 12 + 3);
    }
  }

  worldToScreen(x, y) {
    return {
      x: (x - this.cam.x) * this.cam.scale + this.cosmos.w / 2,
      y: (y - this.cam.y) * this.cam.scale + this.cosmos.h / 2,
    };
  }
  screenToWorld(sx, sy) {
    return {
      x: (sx - this.cosmos.w / 2) / this.cam.scale + this.cam.x,
      y: (sy - this.cosmos.h / 2) / this.cam.scale + this.cam.y,
    };
  }

  // ---- main draw ----
  draw() {
    this.fitCamera();
    this._drawCosmos();
    this._drawSurface();
    this._drawGraphs();
    // The globe only matters when it is on screen, and it is the most
    // expensive thing here per pixel, so skip it while the tab is hidden.
    if (this.worldmap.canvas.offsetParent !== null) this._drawWorldMap();
  }

  _drawCosmos() {
    const { ctx, w, h } = this.cosmos;
    ctx.fillStyle = '#05060d';
    ctx.fillRect(0, 0, w, h);
    // starfield
    if (this._starfield) {
      for (const [x, y, a, r] of this._starfield) {
        ctx.globalAlpha = a * 0.6;
        ctx.fillStyle = '#cdd6ff';
        ctx.fillRect(x, y, r, r);
      }
      ctx.globalAlpha = 1;
    }

    const sys = this.world.system;

    // trails
    for (const b of sys.bodies) {
      if (b.trail.length < 2) continue;
      ctx.beginPath();
      for (let i = 0; i < b.trail.length; i++) {
        const p = this.worldToScreen(b.trail[i][0], b.trail[i][1]);
        if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
      }
      ctx.strokeStyle = b.type === 'planet' ? 'rgba(120,200,255,0.28)'
        : b.type === 'rogue' ? 'rgba(170,160,200,0.20)'
          : 'rgba(255,220,150,0.15)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // bodies
    for (const b of sys.bodies) {
      const p = this.worldToScreen(b.x, b.y);
      const r = Math.max(2.5, b.radius * this.cam.scale);
      if (b.type === 'sun') this._drawSun(ctx, p, r, b);
      else this._drawWorld(ctx, p, r, b);
      if (b === this.selected) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, r + 8, 0, Math.PI * 2);
        ctx.strokeStyle = '#7fe9ff'; ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]); ctx.stroke(); ctx.setLineDash([]);
      }
    }

    // ghost / launch arrow while placing
    if (this.ghost) {
      const p = this.worldToScreen(this.ghost.x, this.ghost.y);
      const r = Math.max(3, this.ghost.radius * this.cam.scale);
      ctx.globalAlpha = 0.7;
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = this.ghost.type === 'sun' ? starColor(this.ghost.mass) : '#8fb7ff';
      ctx.fill(); ctx.globalAlpha = 1;
      if (this.ghost.vx || this.ghost.vy) {
        const tip = this.worldToScreen(this.ghost.x + this.ghost.vx * 2.5, this.ghost.y + this.ghost.vy * 2.5);
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(tip.x, tip.y);
        ctx.strokeStyle = '#ffd27f'; ctx.lineWidth = 2; ctx.stroke();
        this._arrowHead(ctx, p, tip);
      }
    }

    this._drawOffscreenMarkers(ctx);

    // scale bar
    this._scaleBar(ctx);
  }

  _drawSun(ctx, p, r, b) {
    const col = starColor(b.mass);
    // Restrained corona: a tight bright falloff plus a wide, very faint halo,
    // so bright stars read as luminous without blowing out the frame.
    const glow = r * 3.2;
    const g = ctx.createRadialGradient(p.x, p.y, r * 0.85, p.x, p.y, glow);
    g.addColorStop(0, starColorA(b.mass, 0.42));
    g.addColorStop(0.35, starColorA(b.mass, 0.10));
    g.addColorStop(1, starColorA(b.mass, 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(p.x, p.y, glow, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
    if (r > 6 && b.name) {
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.font = '500 10.5px ' + FONT; ctx.textAlign = 'center';
      ctx.fillText(b.name, p.x, p.y + r + 15);
    }
  }

  _drawWorld(ctx, p, r, b) {
    r = Math.max(3.5, r);
    const tint = tempColor(this.world.climate.tempC);
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = b.type === 'rogue' ? '#8e8aa8' : tint; ctx.fill();
    // Give the disc the face its surface would actually have — ocean, ice,
    // continents or molten rock — clipped to the sphere. Deliberately coarse:
    // this is a marker, and the biosphere strip is where surfaces are read.
    if (b.type === 'planet' && r > 5) this._drawPlanetSurface(ctx, p, r);
    // day/night terminator: dark side away from brightest sun
    const sun = this._brightestSunAt(b);
    if (sun && b.type === 'planet') {
      const dx = sun.x - b.x, dy = sun.y - b.y, len = Math.hypot(dx, dy) || 1;
      const nx = dx / len, ny = dy / len;
      const g = ctx.createLinearGradient(p.x - nx * r, p.y - ny * r, p.x + nx * r, p.y + ny * r);
      g.addColorStop(0, 'rgba(0,0,10,0.72)');
      g.addColorStop(0.5, 'rgba(0,0,10,0.15)');
      g.addColorStop(1, 'rgba(0,0,10,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.stroke();
  }

  _brightestSunAt(planet) {
    let best = null, bestF = -1;
    for (const s of this.world.system.suns) {
      const d2 = (s.x - planet.x) ** 2 + (s.y - planet.y) ** 2 + 0.01;
      const f = s.luminosity / d2;
      if (f > bestF) { bestF = f; best = s; }
    }
    return best;
  }

  _arrowHead(ctx, from, to) {
    const a = Math.atan2(to.y - from.y, to.x - from.x);
    const s = 7;
    ctx.beginPath();
    ctx.moveTo(to.x, to.y);
    ctx.lineTo(to.x - s * Math.cos(a - 0.4), to.y - s * Math.sin(a - 0.4));
    ctx.lineTo(to.x - s * Math.cos(a + 0.4), to.y - s * Math.sin(a + 0.4));
    ctx.closePath(); ctx.fillStyle = '#ffd27f'; ctx.fill();
  }

  _scaleBar(ctx) {
    const { h } = this.cosmos;
    const unitPx = this.cam.scale;   // 1 sim unit
    ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.lineWidth = 1;
    const sbW = Math.min(unitPx, 140);
    const sbX = this.cosmos.w - 22 - sbW, sbY = h - 46;
    ctx.beginPath(); ctx.moveTo(sbX, sbY); ctx.lineTo(sbX + sbW, sbY);
    ctx.moveTo(sbX, sbY - 3); ctx.lineTo(sbX, sbY + 3);
    ctx.moveTo(sbX + sbW, sbY - 3); ctx.lineTo(sbX + sbW, sbY + 3);
    ctx.stroke();
    ctx.fillStyle = 'rgba(235,235,245,0.34)'; ctx.font = '500 9.5px ' + FONT;
    ctx.textAlign = 'right';
    ctx.fillText(`${(sbW / unitPx).toFixed(sbW === unitPx ? 0 : 1)} AU`, sbX + sbW, sbY - 7);
  }

  // ---- surface / biosphere ----
  _drawSurface() {
    const { ctx, w, h } = this.surface;
    const clim = this.world.climate;
    const prof = this.world.profile;
    // The sky is graded from the temperature life actually experiences, and
    // each kind of world gets its own palette and scenery — a sub-glacial vent
    // field should not look like an irradiated desert.
    const t = clim.habitatTempC !== undefined ? clim.habitatTempC : clim.tempC;
    const biome = this._biome(prof, clim);
    const g = ctx.createLinearGradient(0, 0, 0, h);
    if (biome === 'subglacial') {
      g.addColorStop(0.00, 'rgb(10, 18, 30)');
      g.addColorStop(0.55, 'rgb(16, 34, 52)');
      g.addColorStop(1.00, 'rgb(8, 14, 22)');
    } else if (biome === 'ocean') {
      g.addColorStop(0.00, skyColor(t, 0.55));
      g.addColorStop(0.42, 'rgb(24, 62, 92)');
      g.addColorStop(1.00, 'rgb(8, 26, 44)');
    } else if (biome === 'irradiated') {
      g.addColorStop(0.00, skyColor(t, 0.5));
      g.addColorStop(0.60, skyColor(t, 1.05));
      g.addColorStop(1.00, 'rgb(48, 26, 20)');
    } else {
      g.addColorStop(0.00, skyColor(t, 0.46));
      g.addColorStop(0.64, skyColor(t, 1.00));
      g.addColorStop(1.00, skyColor(t, 0.34));
    }
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    this._drawScenery(ctx, w, h, biome, prof, clim);

    // suns in the sky
    const sys = this.world.system, planet = sys.planet;
    if (planet) {
      const suns = sys.suns.slice().sort((a, b) => a.mass - b.mass);
      for (const s of suns) {
        const d = Math.hypot(s.x - planet.x, s.y - planet.y);
        const flux = s.luminosity / (4 * Math.PI * (d * d + 0.05));
        const sr = clamp(5 + flux * 3000, 3, 30);
        // pseudo-position in sky from angle
        const ang = Math.atan2(s.y - planet.y, s.x - planet.x);
        const sx = w * (0.5 + 0.42 * Math.cos(ang));
        const sy = h * 0.30 + h * 0.16 * Math.sin(ang);
        const gr = ctx.createRadialGradient(sx, sy, 0.5, sx, sy, sr * 2.2);
        gr.addColorStop(0, starColorA(s.mass, 0.85));
        gr.addColorStop(0.3, starColorA(s.mass, 0.22));
        gr.addColorStop(1, starColorA(s.mass, 0));
        ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(sx, sy, sr * 2.2, 0, Math.PI * 2); ctx.fill();
      }
    }

    // ground line
    ctx.fillStyle = 'rgba(0,0,0,0.30)';
    ctx.fillRect(0, h * 0.64, w, h * 0.36);
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, h * 0.64 + 0.5); ctx.lineTo(w, h * 0.64 + 0.5); ctx.stroke();

    // creatures — drawn according to what they have become
    const pop = this.world.population;
    const ad = this.world.adaptations;
    for (const c of pop.creatures) {
      const x = 8 + c.px * (w - 16);
      const y = h * 0.30 + c.py * (h * 0.62);
      this._drawCreature(ctx, c, x, y, ad);
    }

    // Era / temperature, set quietly over a soft scrim.
    const scrim = ctx.createLinearGradient(0, 0, 0, 34);
    scrim.addColorStop(0, 'rgba(0,0,0,0.45)');
    scrim.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = scrim; ctx.fillRect(0, 0, w, 34);
    ctx.textAlign = 'left'; ctx.font = '600 11.5px ' + FONT;
    ctx.fillStyle = clim.isStable ? '#32d74b' : '#ff9f0a';
    ctx.fillText(clim.era.toUpperCase(), 12, 19);
    ctx.textAlign = 'right'; ctx.font = '500 11.5px ' + FONT;
    ctx.fillStyle = 'rgba(255,255,255,0.82)';
    ctx.fillText(`${fmt.temp(clim.tempC)}  ·  ${pop.count} alive`, w - 12, 19);

    // Civilisation banner along the bottom once sapience has arisen.
    const civ = this.world.civ;
    if (civ.awakened) {
      const s2 = ctx.createLinearGradient(0, h - 30, 0, h);
      s2.addColorStop(0, 'rgba(0,0,0,0)');
      s2.addColorStop(1, 'rgba(0,0,0,0.5)');
      ctx.fillStyle = s2; ctx.fillRect(0, h - 30, w, 30);
      ctx.textAlign = 'left'; ctx.font = '600 11.5px ' + FONT;
      ctx.fillStyle = '#ffd60a';
      ctx.fillText(civ.tier.name, 12, h - 9);
      ctx.textAlign = 'right'; ctx.font = '500 11px ' + FONT;
      ctx.fillStyle = 'rgba(255,255,255,0.66)';
      const dark = civ.collapses ? `  ·  ${civ.collapses} dark age${civ.collapses === 1 ? '' : 's'}` : '';
      ctx.fillText(`knowledge ${fmt.int(civ.knowledge)}${dark}`, w - 12, h - 9);
    }
  }

  /*
   * ── The world itself ───────────────────────────────────────────────────
   *
   * Drawn straight off the Geography's bands, so the map cannot disagree with
   * the simulation: if the picture shows ice down to the tropics, it is because
   * those bands are genuinely below freezing and the population genuinely
   * cannot live there.
   *
   * Two projections, because two kinds of world:
   *   a spinning world is banded by LATITUDE, so it is drawn side-on with the
   *   equator across the middle and equal-area bands falling out as equal-height
   *   stripes — which is a real property of the orthographic projection, not a
   *   convenience;
   *   a tidally locked world has no meaningful latitude, so it is banded by
   *   angle from the substellar point and drawn with the star to the left, which
   *   puts the scorched face, the twilight ring and the frozen night side all in
   *   one picture.
   */
  _drawWorldMap() {
    // A canvas measured while its tab was hidden has no size at all, so check
    // that what we think we are drawing into still matches the page.
    const rect = this.worldmap.canvas.getBoundingClientRect();
    if (Math.abs(rect.width - this.worldmap.w) > 0.5 || Math.abs(rect.height - this.worldmap.h) > 0.5) {
      this._resize(this.worldmap);
    }
    const { ctx, w, h } = this.worldmap;
    const world = this.world;
    if (!(w > 0) || !(h > 0)) return;
    ctx.clearRect(0, 0, w, h);
    if (!world) return;
    const geo = world.geography, prof = world.profile;
    if (!geo || !geo.bands.length) return;

    // Nudged down so the legend's caption has room above it.
    const R = Math.min(h * 0.42, w * 0.30);
    const cx = w * 0.30, cy = h * 0.54;
    const n = geo.n;

    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.clip();

    // Bands. Equal-area in the model means equal-width on the disc.
    for (let i = 0; i < n; i++) {
      const b = geo.bands[i];
      const c = BIOME_COLOR[b.biome] || [110, 110, 110];
      ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
      if (geo.locked) {
        // Substellar on the LEFT, antistellar on the right, matching the order
        // the legend beside it reads in.
        const x0 = cx - R * (1 - 2 * (i + 1) / n);
        const x1 = cx - R * (1 - 2 * i / n);
        ctx.fillRect(Math.min(x0, x1) - 0.5, cy - R - 1, Math.abs(x1 - x0) + 1, R * 2 + 2);
      } else {
        // sin(latitude) runs -1 (south) to +1 (north); screen y is inverted.
        const y0 = cy - R * (-1 + 2 * (i + 1) / n);
        const y1 = cy - R * (-1 + 2 * i / n);
        ctx.fillRect(cx - R - 1, Math.min(y0, y1) - 0.5, R * 2 + 2, Math.abs(y1 - y0) + 1);
      }
    }

    // Mottling so a band reads as terrain rather than as a paint chip. Seeded
    // from the world so it is stable frame to frame.
    const rng = makeRNG(0x3A17 + Math.round(prof.gravity * 97) + prof.hydrosphere.length * 31);
    // Light enough that it reads as terrain without washing out the bands,
    // which are the actual information here.
    ctx.globalAlpha = 0.07;
    for (let i = 0; i < 70; i++) {
      const a = rng() * Math.PI * 2, d = Math.sqrt(rng()) * R;
      const px = cx + Math.cos(a) * d, py = cy + Math.sin(a) * d;
      ctx.fillStyle = rng() < 0.5 ? '#000' : '#fff';
      ctx.beginPath(); ctx.ellipse(px, py, R * 0.10, R * 0.05, rng() * Math.PI, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Night. A locked world's dark side is permanent and huge; a spinning
    // world's is a moving terminator, so it is only a hint of shading.
    const night = ctx.createLinearGradient(cx - R, 0, cx + R, 0);
    if (geo.locked) {
      night.addColorStop(0, 'rgba(0,0,0,0)');
      night.addColorStop(0.46, 'rgba(0,0,0,0.05)');
      night.addColorStop(0.62, 'rgba(2,4,12,0.62)');
      night.addColorStop(1, 'rgba(2,4,12,0.86)');
    } else {
      night.addColorStop(0, 'rgba(2,4,12,0.44)');
      night.addColorStop(0.4, 'rgba(0,0,0,0.06)');
      night.addColorStop(1, 'rgba(0,0,0,0)');
    }
    ctx.fillStyle = night; ctx.fillRect(cx - R, cy - R, R * 2, R * 2);

    /*
     * Where the people actually are. Scattered rather than ranked, because a
     * band is a band and not a row of pins — and seeded, so a settlement does
     * not jitter from frame to frame while you are looking at it.
     */
    const settled = geo.settledBands();
    if (world.population.headcount >= 1 && settled.length) {
      const prng = makeRNG(0x50C1A1 + settled.length * 31);
      ctx.fillStyle = 'rgba(255, 214, 10, 0.92)';
      for (const b of settled) {
        // The projected half-width of this band on the disc: narrow at the
        // poles, widest at the equator, exactly as a sphere would give you.
        const along = geo.locked ? b.cosTheta : b.sinLat;
        const halfSpan = Math.sqrt(Math.max(0, 1 - along * along));
        const dots = Math.max(2, Math.round(9 * halfSpan));
        for (let k = 0; k < dots; k++) {
          const off = (prng() * 2 - 1) * R * halfSpan * 0.86;
          const jitter = (prng() * 2 - 1) * (R / n) * 0.7;
          const px = geo.locked ? cx - R * along + jitter : cx + off;
          const py = geo.locked ? cy + off : cy - R * along + jitter;
          ctx.beginPath(); ctx.arc(px, py, 1.5, 0, Math.PI * 2); ctx.fill();
        }
      }
    }

    // Aurora, where the particle flux is high enough to light the poles.
    if (prof.radiation > 0.25 && !geo.locked) {
      const a = clamp((prof.radiation - 0.25) * 0.9, 0, 0.5);
      for (const sign of [-1, 1]) {
        const g = ctx.createRadialGradient(cx, cy - sign * R * 0.92, 1, cx, cy - sign * R * 0.92, R * 0.55);
        g.addColorStop(0, `rgba(120, 255, 190, ${a.toFixed(2)})`);
        g.addColorStop(1, 'rgba(120, 255, 190, 0)');
        ctx.fillStyle = g; ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
      }
    }

    // Sphericity: darken the limb so it reads as a ball and not a coin.
    const limb = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.3, R * 0.1, cx, cy, R);
    limb.addColorStop(0, 'rgba(255,255,255,0.10)');
    limb.addColorStop(0.62, 'rgba(0,0,0,0)');
    limb.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = limb; ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
    ctx.restore();

    // Atmospheric halo, thick or thin according to what this world can hold.
    const air = clamp(prof.surfacePressureBar(world.climate.tempC), 0, 3);
    if (air > 0.05) {
      const halo = ctx.createRadialGradient(cx, cy, R * 0.97, cx, cy, R * (1.02 + 0.10 * clamp(air, 0, 1.6)));
      halo.addColorStop(0, `rgba(150, 200, 255, ${(0.16 * clamp(air, 0, 1.5)).toFixed(3)})`);
      halo.addColorStop(1, 'rgba(150, 200, 255, 0)');
      ctx.fillStyle = halo;
      ctx.beginPath(); ctx.arc(cx, cy, R * 1.16, 0, Math.PI * 2); ctx.fill();
    }

    this._drawBandScale(ctx, w, h, geo, cx, cy, R);
  }

  // The legend: every band, its temperature, and whether anyone is living there.
  _drawBandScale(ctx, w, h, geo, cx, cy, R) {
    const n = geo.n;
    const left = cx + R + 26;
    const right = w - 12;
    if (right - left < 90) return;
    const top = cy - R, rowH = (R * 2) / n;

    ctx.textBaseline = 'middle';
    for (let i = 0; i < n; i++) {
      // Screen order must match the globe: north at the top, substellar first.
      const b = geo.bands[geo.locked ? i : n - 1 - i];
      const y = top + rowH * i;
      const c = BIOME_COLOR[b.biome] || [110, 110, 110];
      ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
      ctx.fillRect(left, y + 0.5, 10, Math.max(rowH - 1.2, 1));

      if (rowH >= 8) {
        ctx.font = '500 9px ' + FONT;
        ctx.textAlign = 'left';
        ctx.fillStyle = b.settled ? 'rgba(255,214,10,0.95)'
          : b.habitable ? 'rgba(255,255,255,0.72)' : 'rgba(255,255,255,0.34)';
        const where = geo.locked
          ? `${geo.angleOf(b).toFixed(0)}°`
          : `${Math.abs(geo.latitudeOf(b)).toFixed(0)}°${b.sinLat >= 0 ? 'N' : 'S'}`;
        ctx.fillText(where.padStart(4), left + 15, y + rowH / 2);
        ctx.textAlign = 'right';
        ctx.fillText(`${b.tempC.toFixed(0)}°C`, Math.min(left + 78, right), y + rowH / 2);
      }
    }

    // A caption that says what kind of world this is in one line.
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.font = '600 9.5px ' + FONT;
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillText(geo.locked ? 'SUBSTELLAR → ANTISTELLAR' : 'NORTH → SOUTH', left, top - 8);
  }

  // ── Biome + scenery ─────────────────────────────────────────────────────
  // Which visual world this is. Derived from the profile, not stored, so an
  // edited world changes its look immediately.
  // A planet's face, from its hydrosphere and how hot it actually is.
  _drawPlanetSurface(ctx, p, r) {
    const prof = this.world.profile;
    const t = this.world.climate.habitatTempC ?? this.world.climate.tempC;
    const surf = this.world.climate.tempC;
    const rng = makeRNG(0x9E11 + Math.round(prof.gravity * 100) + prof.hydrosphere.length * 31);

    ctx.save();
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.clip();

    const blob = (fill, n, minR, maxR) => {
      ctx.fillStyle = fill;
      for (let i = 0; i < n; i++) {
        const a = rng() * Math.PI * 2, d = rng() * r * 0.82;
        const bx = p.x + Math.cos(a) * d, by = p.y + Math.sin(a) * d;
        const br = r * (minR + rng() * (maxR - minR));
        ctx.beginPath();
        ctx.ellipse(bx, by, br, br * (0.55 + rng() * 0.5), rng() * Math.PI, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    if (surf > 240) {
      // Molten: dark crust broken by glowing fissures.
      ctx.fillStyle = 'rgba(30, 10, 8, 0.75)'; ctx.fillRect(p.x - r, p.y - r, r * 2, r * 2);
      blob('rgba(255, 120, 40, 0.85)', 5, 0.12, 0.3);
    } else if (prof.hydrosphere === 'ocean') {
      ctx.fillStyle = 'rgba(24, 76, 130, 0.85)'; ctx.fillRect(p.x - r, p.y - r, r * 2, r * 2);
      blob('rgba(210, 235, 255, 0.30)', 4, 0.16, 0.34);   // cloud banding
    } else if (prof.hydrosphere === 'ice' || t < -8) {
      ctx.fillStyle = 'rgba(214, 232, 246, 0.85)'; ctx.fillRect(p.x - r, p.y - r, r * 2, r * 2);
      blob('rgba(150, 186, 214, 0.55)', 4, 0.12, 0.26);   // pressure ridges
    } else {
      // Continents on water, plus polar caps if it is cold enough for them.
      ctx.fillStyle = 'rgba(30, 84, 132, 0.8)'; ctx.fillRect(p.x - r, p.y - r, r * 2, r * 2);
      blob(t > 34 ? 'rgba(150, 116, 68, 0.9)' : 'rgba(74, 122, 62, 0.9)', 4, 0.18, 0.36);
      if (t < 26) {
        ctx.fillStyle = 'rgba(238, 248, 255, 0.8)';
        ctx.beginPath(); ctx.ellipse(p.x, p.y - r, r * 0.8, r * 0.26, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(p.x, p.y + r, r * 0.8, r * 0.26, 0, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
  }

  _biome(prof, clim) {
    if (prof.geothermal > 0.3 && prof.hydrosphere === 'ice') return 'subglacial';
    if (prof.hydrosphere === 'ocean') return 'ocean';
    if (prof.hydrosphere === 'ice') return 'glacial';
    if (prof.radiation > 0.45) return 'irradiated';
    if (prof.tidalLocked) return 'twilight';
    return 'terrestrial';
  }

  // Scenery is deterministic per biome so it does not shimmer between frames.
  _drawScenery(ctx, w, h, biome, prof, clim) {
    const rng = makeRNG(0x5CE1E + biome.length * 977);
    const ground = h * 0.64;

    if (biome === 'subglacial') {
      // A ceiling of ice above, vents glowing on the floor below.
      ctx.fillStyle = 'rgba(150, 200, 235, 0.14)';
      ctx.beginPath();
      ctx.moveTo(0, 0); ctx.lineTo(w, 0); ctx.lineTo(w, h * 0.20);
      for (let x = w; x >= 0; x -= w / 16) {
        ctx.lineTo(x, h * (0.14 + rng() * 0.10));
      }
      ctx.closePath(); ctx.fill();
      for (let i = 0; i < 7; i++) {
        const vx = rng() * w, vr = 14 + rng() * 26;
        const gr = ctx.createRadialGradient(vx, h, 1, vx, h, vr * 2.2);
        gr.addColorStop(0, 'rgba(255, 150, 70, 0.42)');
        gr.addColorStop(0.5, 'rgba(255, 110, 50, 0.10)');
        gr.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = gr;
        ctx.beginPath(); ctx.arc(vx, h, vr * 2.2, Math.PI, 0); ctx.fill();
      }
      return;
    }

    if (biome === 'ocean') {
      // Layered water with a bright surface far above.
      ctx.fillStyle = 'rgba(180, 225, 255, 0.10)';
      ctx.fillRect(0, 0, w, h * 0.06);
      for (let i = 0; i < 22; i++) {
        const bx = rng() * w, by = h * (0.1 + rng() * 0.85), br = 0.6 + rng() * 1.6;
        ctx.fillStyle = `rgba(190, 240, 255, ${(0.05 + rng() * 0.12).toFixed(2)})`;
        ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2); ctx.fill();
      }
      return;
    }

    if (biome === 'glacial') {
      ctx.fillStyle = 'rgba(220, 240, 255, 0.16)';
      ctx.beginPath();
      ctx.moveTo(0, h);
      for (let x = 0; x <= w; x += w / 9) {
        ctx.lineTo(x, ground + (rng() - 0.5) * h * 0.14);
      }
      ctx.lineTo(w, h); ctx.closePath(); ctx.fill();
      return;
    }

    if (biome === 'twilight') {
      // A tidally locked world: burning limb one side, frozen the other, with
      // the habitable ring in between.
      const burn = ctx.createLinearGradient(0, 0, w, 0);
      burn.addColorStop(0, 'rgba(255, 130, 60, 0.30)');
      burn.addColorStop(0.34, 'rgba(255, 130, 60, 0)');
      burn.addColorStop(0.68, 'rgba(120, 170, 255, 0)');
      burn.addColorStop(1, 'rgba(120, 170, 255, 0.26)');
      ctx.fillStyle = burn; ctx.fillRect(0, 0, w, h);
      return;
    }

    if (biome === 'irradiated') {
      // Dust and a hard, sterile horizon.
      for (let i = 0; i < 26; i++) {
        const dx = rng() * w, dy = ground + rng() * (h - ground);
        ctx.fillStyle = `rgba(255, 200, 150, ${(0.04 + rng() * 0.08).toFixed(2)})`;
        ctx.fillRect(dx, dy, 1 + rng() * 2, 1);
      }
      return;
    }
  }

  // ── Creatures, drawn as what they have become ───────────────────────────
  _drawCreature(ctx, c, x, y, ad) {
    const r = 1.6 + norm('size', c.g.size) * 3.0
      * (ad && ad.has('redundancy') ? 1.55 : 1);   // three of everything is bulky

    if (c.dormant) {
      // Quantum dormancy holds molecular structure: a faceted, crystalline husk
      // rather than a shrivelled one.
      if (ad && ad.has('quantum')) {
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = i / 6 * Math.PI * 2 - Math.PI / 2;
          const px = x + Math.cos(a) * (r + 1), py = y + Math.sin(a) * (r + 1);
          i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
        }
        ctx.closePath();
        ctx.strokeStyle = 'rgba(190, 225, 255, 0.55)'; ctx.lineWidth = 1; ctx.stroke();
      } else {
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(225,228,238,0.40)'; ctx.lineWidth = 1; ctx.stroke();
      }
      return;
    }

    const col = (ad && ad.has('photosynth'))
      ? 'hsl(96, 42%, 52%)'                     // they are chlorophyll green
      : c.color;

    if (ad && ad.has('distributed')) {
      // One mind, several bodies: a small linked cluster moving together.
      const n = 4, spread = r * 2.1;
      ctx.strokeStyle = 'rgba(190, 200, 220, 0.30)'; ctx.lineWidth = 0.8;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const a = i / n * Math.PI * 2 + c.px * 6;
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(a) * spread, y + Math.sin(a) * spread);
      }
      ctx.stroke();
      ctx.fillStyle = col;
      for (let i = 0; i < n; i++) {
        const a = i / n * Math.PI * 2 + c.px * 6;
        ctx.beginPath();
        ctx.arc(x + Math.cos(a) * spread, y + Math.sin(a) * spread, r * 0.62, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (ad && ad.has('photosynth')) {
      // Broad, leaf-like: maximising area to the light.
      ctx.save(); ctx.translate(x, y); ctx.rotate(c.px * 3);
      ctx.beginPath(); ctx.ellipse(0, 0, r * 1.8, r * 0.75, 0, 0, Math.PI * 2);
      ctx.fillStyle = col; ctx.fill(); ctx.restore();
    } else if (ad && ad.has('redundancy')) {
      // Armoured, with a visible second shell.
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = col; ctx.fill();
      ctx.strokeStyle = 'rgba(215, 220, 235, 0.45)'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(x, y, r + 1.8, 0, Math.PI * 2); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = col; ctx.fill();
    }

    // Broadcast organs: a faint transmission ring.
    if (ad && (ad.has('emcomm') || ad.has('telepathy'))) {
      ctx.strokeStyle = 'rgba(120, 210, 255, 0.30)'; ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.arc(x, y, r + 4.2, 0, Math.PI * 2); ctx.stroke();
    }
    // Sapience.
    if (c.g.intelligence > 0.55) {
      const a = clamp((c.g.intelligence - 0.55) / 0.45, 0, 1);
      ctx.strokeStyle = `rgba(255,214,10,${(0.18 + 0.32 * a).toFixed(2)})`;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(x, y, r + 2.6, 0, Math.PI * 2); ctx.stroke();
    }
  }

  _darken(hsl, f) {
    const m = hsl.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/);
    if (!m) return hsl;
    return `hsl(${m[1]}, ${m[2]}%, ${Math.round(m[3] * f)}%)`;
  }

  // ---- graphs ----
  // Two stacked charts sharing a time axis: climate on top, life below.
  // Deliberately spare — thin strokes, one hairline grid, labels set small and
  // quiet so the data reads first.
  _drawGraphs() {
    const { ctx, w, h } = this.graphs;
    const H = this.world.hist;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#141416';
    ctx.fillRect(0, 0, w, h);

    const padL = 10, padR = 44, padT = 20, gap = 16;
    const plotW = w - padL - padR;
    const chartH = (h - padT * 2 - gap) / 2;
    const topY = padT;
    const botY = padT + chartH + gap;

    const label = (text, x, y, color, align = 'left') => {
      ctx.font = '500 9.5px ' + FONT;
      ctx.textAlign = align;
      ctx.fillStyle = color;
      ctx.fillText(text, x, y);
    };

    // ══ Climate ══
    const [slo, shi] = CONFIG.stableBandC;
    const tmin = Math.min(-40, H.temp.min() - 5);
    const tmax = Math.max(65, H.temp.max() + 5);
    const ty = (v) => topY + (tmax - clamp(v, tmin, tmax)) / (tmax - tmin) * chartH;

    // Habitable band: barely-there tint plus hairline edges, so it reads as a
    // reference region rather than a coloured block behind the data.
    const bandTop = ty(shi), bandBot = ty(slo);
    ctx.fillStyle = 'rgba(50, 215, 75, 0.035)';
    ctx.fillRect(padL, bandTop, plotW, Math.max(1, bandBot - bandTop));
    ctx.strokeStyle = 'rgba(50, 215, 75, 0.16)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(padL, bandTop + 0.5); ctx.lineTo(padL + plotW, bandTop + 0.5);
    ctx.moveTo(padL, bandBot + 0.5); ctx.lineTo(padL + plotW, bandBot + 0.5);
    ctx.stroke();
    ctx.setLineDash([]);
    // frame + zero line
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padL, topY + chartH + 0.5); ctx.lineTo(padL + plotW, topY + chartH + 0.5);
    if (tmin < 0 && tmax > 0) { ctx.moveTo(padL, ty(0) + 0.5); ctx.lineTo(padL + plotW, ty(0) + 0.5); }
    ctx.stroke();

    this._series(ctx, H.optimal, padL, plotW, ty, 'rgba(100, 210, 255, 0.85)', 1.25);
    this._series(ctx, H.temp, padL, plotW, ty, '#ff9f0a', 1.6);

    label('CLIMATE', padL, topY - 7, 'rgba(235,235,245,0.34)');
    label('surface', padL + 52, topY - 7, '#ff9f0a');
    label('preferred', padL + 92, topY - 7, 'rgba(100,210,255,0.85)');
    label(`${tmax.toFixed(0)}°`, w - padR + 6, topY + 7, 'rgba(235,235,245,0.34)');
    label(`${tmin.toFixed(0)}°`, w - padR + 6, topY + chartH, 'rgba(235,235,245,0.34)');

    // ══ Life & knowledge ══
    const pmax = Math.max(60, H.pop.max() * 1.15);
    const py = (v) => botY + (pmax - clamp(v, 0, pmax)) / pmax * chartH;
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.beginPath();
    ctx.moveTo(padL, botY + chartH + 0.5); ctx.lineTo(padL + plotW, botY + chartH + 0.5);
    ctx.stroke();

    // population as a soft filled area
    this._area(ctx, H.pop, padL, plotW, py, botY + chartH, 'rgba(50, 215, 75, 0.8)', 'rgba(50, 215, 75, 0.055)');
    this._series(ctx, H.dormant, padL, plotW, py, 'rgba(235,235,245,0.34)', 1.1);

    // knowledge on its own normalised scale — the sawtooth of civilisations
    const kmax = Math.max(200, H.knowledge.max() * 1.1);
    const ky = (v) => botY + (kmax - clamp(v, 0, kmax)) / kmax * chartH;
    this._series(ctx, H.knowledge, padL, plotW, ky, '#ffd60a', 1.4);
    // intelligence 0..1 across the same band
    const iy = (v) => botY + (1 - clamp(v, 0, 1)) * chartH;
    this._series(ctx, H.intelligence, padL, plotW, iy, 'rgba(191, 90, 242, 0.8)', 1.1);

    label('LIFE', padL, botY - 7, 'rgba(235,235,245,0.34)');
    label('pop', padL + 32, botY - 7, 'rgba(50,215,75,0.9)');
    label('dormant', padL + 58, botY - 7, 'rgba(235,235,245,0.4)');
    label('knowledge', padL + 108, botY - 7, '#ffd60a');
    label('intel', padL + 168, botY - 7, 'rgba(191,90,242,0.9)');
    label(fmt.int(pmax), w - padR + 6, botY + 7, 'rgba(235,235,245,0.34)');
    label('0', w - padR + 6, botY + chartH, 'rgba(235,235,245,0.34)');
  }

  _series(ctx, hist, x0, plotW, ymap, color, width) {
    if (hist.n < 2) return;
    const step = plotW / Math.max(1, hist.size - 1);
    ctx.beginPath();
    let started = false;
    hist.forEach((v, i) => {
      const x = x0 + i * step, y = ymap(v);
      if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  _area(ctx, hist, x0, plotW, ymap, baseY, stroke, fill) {
    if (hist.n < 2) return;
    const step = plotW / Math.max(1, hist.size - 1);
    ctx.beginPath();
    let firstX = x0, started = false;
    hist.forEach((v, i) => {
      const x = x0 + i * step, y = ymap(v);
      if (!started) { firstX = x; ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
    });
    const lastX = x0 + (hist.n - 1) * step;
    ctx.lineTo(lastX, baseY); ctx.lineTo(firstX, baseY); ctx.closePath();
    ctx.fillStyle = fill; ctx.fill();
    this._series(ctx, hist, x0, plotW, ymap, stroke, 1.4);
  }

  // hit-test a body near screen point (for selection)
  pick(sx, sy) {
    let best = null, bestD = 18;
    for (const b of this.world.system.bodies) {
      const p = this.worldToScreen(b.x, b.y);
      const d = Math.hypot(p.x - sx, p.y - sy);
      const rr = Math.max(6, b.radius * this.cam.scale);
      if (d < rr + 6 && d < bestD + rr) { best = b; bestD = d; }
    }
    return best;
  }
}
