/*
 * render.js — All drawing. Three surfaces:
 *   cosmos  : the N-body star system (trails, glowing suns, the shaded world)
 *   surface : the planet's biosphere strip (creatures coloured by their genome)
 *   graphs  : temperature / population / trait time-series
 *
 * The cosmos camera auto-fits every frame (smoothed) so a chaotic system that
 * flings suns apart stays on screen.
 */

class Renderer {
  constructor(world) {
    this.world = world;
    this.cosmos = this._setup('cosmos');
    this.surface = this._setup('surface');
    this.graphs = this._setup('graphs');

    this.cam = { x: 0, y: 0, scale: CONFIG.pixelsPerUnit };
    this._camInit = false;
    this.selected = null;
    this.ghost = null;   // {x,y,vx,vy,mass,type} while placing a body

    this._starfield = null;
    window.addEventListener('resize', () => this._resizeAll());
    this._resizeAll();
  }

  _setup(id) {
    const canvas = document.getElementById(id);
    const ctx = canvas.getContext('2d');
    return { canvas, ctx, w: 0, h: 0 };
  }

  _resizeAll() {
    for (const s of [this.cosmos, this.surface, this.graphs]) this._resize(s);
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
  fitCamera() {
    const bodies = this.world.system.bodies;
    if (!bodies.length) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const b of bodies) {
      minX = Math.min(minX, b.x); maxX = Math.max(maxX, b.x);
      minY = Math.min(minY, b.y); maxY = Math.max(maxY, b.y);
    }
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const spanX = Math.max(maxX - minX, 2), spanY = Math.max(maxY - minY, 2);
    const { w, h } = this.cosmos;
    const pad = 1.35;
    const scale = Math.min(w / (spanX * pad), h / (spanY * pad));
    const target = { x: cx, y: cy, scale: clamp(scale, 3, 140) };
    if (!this._camInit) { this.cam = { ...target }; this._camInit = true; }
    else {
      const k = 0.06;
      this.cam.x = lerp(this.cam.x, target.x, k);
      this.cam.y = lerp(this.cam.y, target.y, k);
      this.cam.scale = lerp(this.cam.scale, target.scale, k);
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
      ctx.strokeStyle = b.type === 'planet' ? 'rgba(120,200,255,0.35)'
        : b.type === 'rogue' ? 'rgba(180,160,255,0.28)'
          : 'rgba(255,220,150,0.22)';
      ctx.lineWidth = 1.2;
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

    // scale bar
    this._scaleBar(ctx);
  }

  _drawSun(ctx, p, r, b) {
    const col = starColor(b.mass);
    const glow = r * 4.5;
    const g = ctx.createRadialGradient(p.x, p.y, r * 0.4, p.x, p.y, glow);
    g.addColorStop(0, col);
    g.addColorStop(0.25, col.replace('hsl', 'hsla').replace(')', ',0.5)'));
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(p.x, p.y, glow, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
    if (r > 6 && b.name) {
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(b.name, p.x, p.y + r + 13);
    }
  }

  _drawWorld(ctx, p, r, b) {
    r = Math.max(3.5, r);
    // base tinted by current climate
    const tint = tempColor(this.world.climate.tempC);
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = b.type === 'rogue' ? '#9a8cff' : tint; ctx.fill();
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
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1;
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
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(16, h - 18); ctx.lineTo(16 + unitPx, h - 18); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.65)'; ctx.font = '10px system-ui';
    ctx.textAlign = 'left'; ctx.fillText('1 AU', 16, h - 24);
  }

  // ---- surface / biosphere ----
  _drawSurface() {
    const { ctx, w, h } = this.surface;
    const clim = this.world.climate;
    // sky gradient by temperature
    const sky = tempColor(clim.tempC, -40, 70);
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, this._darken(sky, 0.45));
    g.addColorStop(0.55, sky);
    g.addColorStop(1, this._darken(sky, 0.7));
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);

    // suns in the sky
    const sys = this.world.system, planet = sys.planet;
    if (planet) {
      const suns = sys.suns.slice().sort((a, b) => a.mass - b.mass);
      for (const s of suns) {
        const d = Math.hypot(s.x - planet.x, s.y - planet.y);
        const flux = s.luminosity / (4 * Math.PI * (d * d + 0.05));
        const sr = clamp(6 + flux * 4000, 4, 46);
        // pseudo-position in sky from angle
        const ang = Math.atan2(s.y - planet.y, s.x - planet.x);
        const sx = w * (0.5 + 0.42 * Math.cos(ang));
        const sy = h * 0.30 + h * 0.16 * Math.sin(ang);
        const gr = ctx.createRadialGradient(sx, sy, 1, sx, sy, sr * 2.4);
        gr.addColorStop(0, starColor(s.mass));
        gr.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(sx, sy, sr * 2.4, 0, Math.PI * 2); ctx.fill();
      }
    }

    // ground line
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fillRect(0, h * 0.62, w, h * 0.38);

    // creatures
    const pop = this.world.population;
    for (const c of pop.creatures) {
      const x = 8 + c.px * (w - 16);
      const y = h * 0.30 + c.py * (h * 0.62);
      const r = 2 + norm('size', c.g.size) * 4.5;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
      if (c.dormant) {
        ctx.fillStyle = 'rgba(180,180,190,0.55)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.setLineDash([2, 2]);
        ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]);
      } else {
        ctx.fillStyle = c.color; ctx.fill();
        // dormancy shown as a pale ring
        if (c.g.dormancy > 0.5) {
          ctx.strokeStyle = 'rgba(230,240,255,0.6)'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(x, y, r + 2, 0, Math.PI * 2); ctx.stroke();
        }
        // A bright halo marks the clever ones — you can watch sapience spread.
        if (c.g.intelligence > 0.45) {
          const a = clamp((c.g.intelligence - 0.45) / 0.55, 0, 1);
          ctx.strokeStyle = `rgba(255,240,170,${(0.35 + 0.6 * a).toFixed(2)})`;
          ctx.lineWidth = 1.4;
          ctx.beginPath(); ctx.arc(x, y, r + 3.5, 0, Math.PI * 2); ctx.stroke();
        }
      }
    }

    // era banner + temp
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, 0, w, 26);
    ctx.textAlign = 'left'; ctx.font = 'bold 13px system-ui';
    ctx.fillStyle = clim.isStable ? '#7dffb0' : '#ff9a7d';
    ctx.fillText(clim.era, 10, 18);
    ctx.textAlign = 'right'; ctx.fillStyle = '#e8eeff';
    ctx.fillText(`${fmt.temp(clim.tempC)}   ·   ${pop.count} alive`, w - 10, 18);

    // Civilisation banner along the bottom once sapience has arisen.
    const civ = this.world.civ;
    if (civ.awakened) {
      ctx.fillStyle = 'rgba(0,0,0,0.42)';
      ctx.fillRect(0, h - 22, w, 22);
      ctx.textAlign = 'left'; ctx.font = 'bold 12px system-ui';
      ctx.fillStyle = '#ffe9a8';
      ctx.fillText(`${civ.tier.icon} ${civ.tier.name}`, 10, h - 7);
      ctx.textAlign = 'right'; ctx.font = '11px system-ui';
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      const dark = civ.collapses ? `  ·  ${civ.collapses} dark age${civ.collapses === 1 ? '' : 's'}` : '';
      ctx.fillText(`knowledge ${fmt.int(civ.knowledge)}${dark}`, w - 10, h - 7);
    }
  }

  _darken(hsl, f) {
    const m = hsl.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/);
    if (!m) return hsl;
    return `hsl(${m[1]}, ${m[2]}%, ${Math.round(m[3] * f)}%)`;
  }

  // ---- graphs ----
  _drawGraphs() {
    const { ctx, w, h } = this.graphs;
    ctx.fillStyle = '#0a0c16'; ctx.fillRect(0, 0, w, h);
    const H = this.world.hist;
    const pad = 6;
    const topH = h * 0.5;   // temperature panel
    const botY = h * 0.5, botH = h * 0.5;

    // --- Temperature panel ---
    // stable band shading
    const [slo, shi] = CONFIG.stableBandC;
    const tmin = Math.min(-50, H.temp.min() - 5);
    const tmax = Math.max(70, H.temp.max() + 5);
    const ty = (v) => pad + (tmax - v) / (tmax - tmin) * (topH - 2 * pad);
    ctx.fillStyle = 'rgba(90,220,140,0.10)';
    ctx.fillRect(0, ty(shi), w, ty(slo) - ty(shi));
    // zero line
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, ty(0)); ctx.lineTo(w, ty(0)); ctx.stroke();

    this._line(ctx, H.eqTemp, w, tmin, tmax, ty, 'rgba(255,180,90,0.35)', 1);
    this._line(ctx, H.temp, w, tmin, tmax, ty, '#ffb45a', 1.8);
    // avg preferred temp of population (evolution tracking climate)
    this._line(ctx, H.optimal, w, tmin, tmax, ty, '#7de3ff', 1.6);

    ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.font = '10px system-ui'; ctx.textAlign = 'left';
    ctx.fillText('Surface temp', 6, 12);
    ctx.fillStyle = '#7de3ff'; ctx.fillText('· preferred temp (evolving)', 78, 12);
    ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.textAlign = 'right';
    ctx.fillText(`${tmax.toFixed(0)}°`, w - 4, 12); ctx.fillText(`${tmin.toFixed(0)}°`, w - 4, topH - 4);

    // divider
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.beginPath(); ctx.moveTo(0, botY); ctx.lineTo(w, botY); ctx.stroke();

    // --- Population panel ---
    const pmax = Math.max(50, H.pop.max() * 1.15);
    const py = (v) => botY + pad + (pmax - v) / pmax * (botH - 2 * pad);
    // capacity/flourish reference
    this._areaLine(ctx, H.pop, w, 0, pmax, py, botY + botH - pad, 'rgba(125,255,176,0.85)', 'rgba(125,255,176,0.15)');
    this._line(ctx, H.dormant, w, 0, pmax, py, 'rgba(180,190,210,0.9)', 1.4);

    // Knowledge, drawn on its own normalised scale so the rise-and-collapse
    // sawtooth of civilisations is readable next to the population curve.
    const kmax = Math.max(200, H.knowledge.max() * 1.1);
    const ky = (v) => botY + pad + (kmax - v) / kmax * (botH - 2 * pad);
    this._line(ctx, H.knowledge, w, 0, kmax, ky, 'rgba(255,210,127,0.95)', 1.6);
    // Average intelligence (0..1) mapped across the same panel.
    const iy = (v) => botY + pad + (1 - v) * (botH - 2 * pad);
    this._line(ctx, H.intelligence, w, 0, 1, iy, 'rgba(200,160,255,0.8)', 1.3);

    ctx.fillStyle = 'rgba(125,255,176,0.9)'; ctx.textAlign = 'left'; ctx.font = '10px system-ui';
    ctx.fillText('Pop', 6, botY + 12);
    ctx.fillStyle = 'rgba(180,190,210,0.9)'; ctx.fillText('· dormant', 30, botY + 12);
    ctx.fillStyle = 'rgba(255,210,127,0.95)'; ctx.fillText('· knowledge', 86, botY + 12);
    ctx.fillStyle = 'rgba(200,160,255,0.9)'; ctx.fillText('· intel', 152, botY + 12);
    ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.textAlign = 'right';
    ctx.fillText(fmt.int(pmax), w - 4, botY + 12);
  }

  _line(ctx, hist, w, vmin, vmax, ymap, color, width) {
    if (hist.n < 2) return;
    ctx.beginPath();
    const step = w / Math.max(1, hist.size - 1);
    let started = false;
    hist.forEach((v, i) => {
      const x = i * step;
      const y = ymap(clamp(v, vmin, vmax));
      if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
  }

  _areaLine(ctx, hist, w, vmin, vmax, ymap, baseY, stroke, fill) {
    if (hist.n < 2) return;
    const step = w / Math.max(1, hist.size - 1);
    ctx.beginPath();
    let firstX = 0, started = false;
    hist.forEach((v, i) => {
      const x = i * step, y = ymap(v);
      if (!started) { firstX = x; ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
    });
    // close to baseline for fill
    const lastX = (hist.n - 1) * step;
    ctx.lineTo(lastX, baseY); ctx.lineTo(firstX, baseY); ctx.closePath();
    ctx.fillStyle = fill; ctx.fill();
    // stroke top
    ctx.beginPath(); started = false;
    hist.forEach((v, i) => {
      const x = i * step, y = ymap(v);
      if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = stroke; ctx.lineWidth = 1.6; ctx.stroke();
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
