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
    // base tinted by current climate
    const tint = tempColor(this.world.climate.tempC);
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = b.type === 'rogue' ? '#8e8aa8' : tint; ctx.fill();
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
    // Sky graded by temperature, kept deliberately desaturated and dark so the
    // strip reads like a photograph rather than a colour swatch.
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0.00, skyColor(clim.tempC, 0.46));
    g.addColorStop(0.64, skyColor(clim.tempC, 1.00));
    g.addColorStop(1.00, skyColor(clim.tempC, 0.34));
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);

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

    // creatures
    const pop = this.world.population;
    for (const c of pop.creatures) {
      const x = 8 + c.px * (w - 16);
      const y = h * 0.30 + c.py * (h * 0.62);
      const r = 1.6 + norm('size', c.g.size) * 3.0;
      if (c.dormant) {
        // Dehydrated: a hollow, colourless husk.
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(225,228,238,0.40)'; ctx.lineWidth = 1;
        ctx.stroke();
      } else {
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = c.color; ctx.fill();
        // A faint halo marks the clever ones — sapience spreading, quietly.
        if (c.g.intelligence > 0.55) {
          const a = clamp((c.g.intelligence - 0.55) / 0.45, 0, 1);
          ctx.strokeStyle = `rgba(255,214,10,${(0.18 + 0.32 * a).toFixed(2)})`;
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(x, y, r + 2.6, 0, Math.PI * 2); ctx.stroke();
        }
      }
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
