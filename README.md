# DEMIURGE — a god-simulator of suns & life

Play god over a solar system and the life that clings to one of its worlds.
Add suns, sculpt a chaotic multi-star sky like the one in Cixin Liu's
*The Three-Body Problem*, and watch an evolving biosphere either flourish in a
long **Stable Era** or fight to survive the freezing and scorching **Chaotic
Eras** the wandering suns inflict on it.

It is a single self-contained web app — **no build step, no dependencies, no
server required.** Just open `index.html`.

```
git clone <this repo>
cd three-body-sim
# then simply double-click index.html, or:
python3 -m http.server 8000   # → http://localhost:8000
```

Runs in any modern browser (Chrome, Firefox, Safari, Edge).

---

## What you can do

**Sculpt the cosmos**
- Load ready-made systems: a calm **Lone Sun**, a **Binary**, the chaotic
  three-sun **Trisolaris**, a **Four-Body Maelstrom**, or the genuinely stable
  **Figure-Eight** choreography.
- **Drag on empty space** in the cosmos to launch a new sun (or a dark rogue
  planet) with whatever velocity your drag implies — slingshot it into an orbit
  and watch it perturb everything.
- **Click a star** to select it, then change its mass (and therefore its
  brightness and gravity) live, or extinguish it entirely.

**Play god of evolution**
- **Seed Life**, then watch natural selection act every tick.
- Nudge the whole population's genome — make them prefer warmer or cooler
  climates, broaden their tolerance, grant them **dormancy** (the ability to
  dehydrate and wait out a Chaotic Era, exactly like the Trisolarans), change
  body size or metabolism.
- Dial mutation rate and evolution speed, trigger a **Cambrian Burst** of fresh
  variation, or unleash a **Cataclysm** mass-extinction and see who recovers.

Keyboard: **Space** = pause/play, **R** = reset, **L** = seed life.

---

## The science under the hood

This is meant to be *semi-realistic* — the models are simplified but the
mechanisms are real.

### Gravity — N-body with a symplectic integrator
Every body pulls on every other via Newton's law of gravitation. Motion is
advanced with **velocity Verlet**, a symplectic integrator: unlike RK4 it
conserves energy over the millions of steps a long game accumulates, so orbits
stay physical rather than spiralling into numerical nonsense. The HUD shows the
live **energy drift** — it stays near 0%, which is how you know the orbits are
faithful. Close encounters use **gravitational softening** (`r² + ε²`) so a
near-collision produces a realistic slingshot instead of a divide-by-zero.

The three-body problem is genuinely chaotic: tiny differences explode into
wildly different futures, which is exactly why Trisolaris can never predict its
own seasons. The **Figure-Eight** preset is a real, stable periodic solution
(Chenciner & Montgomery, 2000) — proof that chaos is common but not guaranteed.

### Climate — inverse-square flux → temperature
Each sun's brightness follows `L ∝ mass^1.6`. The light reaching the planet
obeys the **inverse-square law**, summed over every sun. Absorbed flux drives an
equilibrium temperature through a **Stefan–Boltzmann quarter-power law**,
calibrated so a lone Sun-like star gives a ~15 °C world. A **thermal-inertia
lag** means the planet warms and cools gradually, so a sun whipping past causes
a heat wave that fades rather than an instant teleport to a new temperature.

When the temperature sits in the habitable band it's a **Stable Era**; outside
it, a **Chaotic Era** — deep freeze, scorching, or a sunless long night.

### Evolution — agent-based natural selection
Each organism carries a genome of continuous, heritable traits (preferred
temperature, tolerance, dormancy, size, metabolism). Every step the current
climate imposes selection: individuals poorly matched to the surface
temperature suffer higher mortality and reproduce less; offspring inherit the
parent genome plus gaussian **mutation**. So the population's trait
distribution visibly tracks the environment — the blue line on the temperature
graph is the population's *evolving* preferred temperature chasing the orange
surface temperature.

The strategies trade off against each other, which is what makes it interesting:

| Trait | Helps | Costs |
|-------|-------|-------|
| **Dormancy** | survive Chaotic Eras by dehydrating | lower reproduction when active |
| **Tolerance** | survive temperature swings | lower peak fecundity (generalist tax) |
| **Metabolism** | breed fast | burns energy, shorter lifespan |
| **Size** | buffers thermal stress | costs energy, slows breeding |

In a calm Lone-Sun world the fast-breeding specialists win and dormancy fades
away. In chaotic Trisolaris you'll watch the population repeatedly crash to a
handful of **dormant** survivors during a scorching era, then explode back to
hundreds when calm returns — each cycle enriching the gene pool for dormancy and
tolerance. That boom-and-bust ratchet *is* the story of Trisolaran life.

---

## Project layout

```
index.html          markup + layout
css/style.css       dark "deep space" theme
js/config.js        all tunable constants (physics, climate, evolution)
js/utils.js         RNG, math, colour, history ring-buffer
js/physics.js       Body + NBodySystem (velocity-Verlet integrator)
js/climate.js       flux → temperature → era classification
js/evolution.js     Creature genome + Population selection model
js/presets.js       the ready-made star systems
js/world.js         binds physics+climate+life, history & event log
js/render.js        cosmos / biosphere / graph rendering
js/ui.js            controls + pointer interaction
js/main.js          boot + animation loop
```

Everything is plain, dependency-free JavaScript. Open the browser console and
poke at `window.DEMIURGE` (`.world`, `.renderer`, `.ui`, `.CONFIG`) to
experiment — e.g. `DEMIURGE.CONFIG.dt = 0.02` to speed up time, or
`DEMIURGE.world.population.nudgeTrait('dormancy', 0.5)`.

*Not to scale, and not a substitute for a real astrophysics or population-genetics
code — but every knob is grounded in a real mechanism.*
