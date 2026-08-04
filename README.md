# DEMIURGE — a god-simulator of suns, life & civilizations

**The premise: Earth is a freakish stroke of luck.** We evolved on a quiet
world with one well-behaved star, in a stable Goldilocks orbit, with nothing to
do but get clever. This is the experiment that asks what happens *everywhere
else* — in the violent multi-sun skies of Cixin Liu's *The Three-Body Problem*,
where a civilization is repeatedly smashed back into the stone age before it can
ever look up and understand its own sky.

Play god over a solar system. Add suns, sculpt the chaos, and watch life either
flourish in a long **Stable Era** or fight to survive the freezing and scorching
**Chaotic Eras** the wandering suns inflict on it. If a species is lucky enough
to grow a brain it can afford, it **awakens** — and then you watch its
civilization climb, collapse into dark ages, and climb again.

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
  body size or metabolism, or **uplift their intelligence** directly.
- Once they awaken, **gift them insight** to leap an age ahead — or **burn their
  libraries** and watch centuries of progress turn to ash.
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

### Intelligence — the expensive gamble that Earth got to make

Intelligence is a heritable trait like any other, but it is **costly**: a big
brain adds a permanent metabolic upkeep and a reproductive tax (long
childhoods). Its only payoff is a foraging bonus that **scales with how
productive the world is**. The consequence falls straight out of the model:

- On a **rich, calm world**, a clever forager banks a large energy surplus,
  and surplus buys breeding opportunities — so intelligence pays for itself and
  climbs. This is us.
- On a **harsh or chaotic world**, there is no surplus to harvest. The brain is
  pure overhead, selection strips it away, and the species stays an animal
  forever — too busy surviving to ever get clever.

Once average intelligence and population cross a threshold *during a Stable
Era*, the species **awakens** and the second stage begins.

### Civilizations — the ratchet of knowledge and collapse

An awakened civilization accumulates **knowledge**, passing through named ages:

> 🪨 Stone Age → 🔥 Fire & Tribe → 🌾 Agriculture → 📜 Writing → ⚙️ Industry
> → 🔬 Science → 🚀 Spaceflight → 🌌 Transcendence

Technology progressively **shields the population from the climate** — an
industrial civilization survives a scorching era that would annihilate a
neolithic one. So it becomes a race: can they advance fast enough to outrun
their own sky?

Usually not. A severe enough Chaotic Era **shatters the civilization into a Dark
Age**, destroying ~90% of its knowledge. Each rebuild goes faster (cultural
memory), so the chronicle reads exactly like Trisolaris: *civilization #1 fell at
Agriculture, #2 fell at Writing, #3 reached Industry…* If hardship grinds on long
enough, selection breeds the expensive brains back out entirely and the
survivors become beasts again. And very rarely, a civilization masters the suns
and launches an **escape fleet**.

### The experiment: measured results

Across 10 random seeds per system, 120k steps each:

| World | Awakened | Transcended | Mean zenith | Mean collapses |
|---|---|---|---|---|
| Lone Sun (Goldilocks) | 10/10 | **10/10** | Transcendence | 0.0 |
| Binary Suns | 10/10 | **10/10** | Transcendence | 0.0 |
| Trisolaris (3-body) | 7/10 | 2/10 | Writing | **5.3** |
| Four-Body Maelstrom | **1/10** | 0/10 | Stone Age | — |

That gradient is the whole thesis. Quiet skies produce spacefarers every single
time. The chaotic three-body world *can* wake up, but it spends its history
being knocked back down and escapes only twice in ten runs. In the maelstrom,
intelligence is almost never affordable at all.

---

## Project layout

```
index.html          markup + layout
css/style.css       dark "deep space" theme
fonts/              self-hosted variable fonts (see fonts/README.md)
js/config.js        all tunable constants (physics, climate, evolution)
js/utils.js         RNG, math, colour, history ring-buffer
js/physics.js       Body + NBodySystem (velocity-Verlet integrator)
js/climate.js       flux → temperature → era classification
js/evolution.js     Creature genome + Population selection model
js/civilization.js  awakening, knowledge ages, collapses, pinnacle
js/presets.js       the ready-made star systems
js/world.js         binds physics+climate+life, history & event log
js/render.js        cosmos / biosphere / graph rendering
js/ui.js            controls + pointer interaction
js/main.js          boot + animation loop
```

Everything is plain, dependency-free JavaScript. Open the browser console and
poke at `window.DEMIURGE` (`.world`, `.renderer`, `.ui`, `.CONFIG`) to
experiment — e.g. `DEMIURGE.CONFIG.dt = 0.02` to speed up time, or
`DEMIURGE.world.population.nudgeTrait('intelligence', 0.5)` to force an awakening.

*Not to scale, and not a substitute for a real astrophysics or population-genetics
code — but every knob is grounded in a real mechanism.*

---

## Running it as a website

The project is plain static files — no build step, no server code — so any
static host will serve it.

### Deploying to GitHub Pages

`.github/workflows/deploy.yml` publishes the repo root on every push. To turn
it on: **Settings → Pages → Source → GitHub Actions**. The site then lives at
`https://<user>.github.io/three-body-sim/`.

All asset paths are relative, so it works from a subpath without changes. If
you move it to your own domain, update the `canonical`/`og:url` tags in
`index.html` and the URLs in `sitemap.xml` and `robots.txt`.

### Typography

Space Grotesk (interface) and Orbitron (wordmark) are **self-hosted** from
`fonts/`, not loaded from the Google Fonts CDN — that would send every
visitor's IP to a third party and contradict the privacy policy. Both are
variable fonts, 36 KB for the pair, preloaded so there is no flash of fallback
text. Licensing and attribution: `fonts/README.md`.

### Advertising

Ads are **off by default** and the site is fully functional without them.
Everything is configured in one place, `js/ads.js`:

```js
const ADS = {
  enabled: false,                 // ← flip to true once approved
  provider: 'adsense',            // or 'custom' for any other network
  client: 'ca-pub-XXXXXXXXXXXXXXXX',
  slots: { rail: '1234567890' },  // ad unit IDs from your dashboard
};
```

For a network that isn't AdSense, set `provider: 'custom'` and supply
`customTag(placement, el)` returning that network's markup. Nothing else in the
app needs to change.

The implementation deliberately enforces three things:

- **No layout shift.** Slots reserve their space in CSS, and an unfilled or
  blocked slot collapses to nothing rather than leaving a grey hole. Verified:
  the simulation canvas is pixel-identical before and after an ad loads.
- **Nothing loads without consent.** `AdManager.init()` is reachable only from
  the accept path in `js/consent.js`. Before consent — and forever, if the
  visitor declines — zero ad requests are made and no ad cookies are set.
- **No accidental clicks.** The slot sits in the inspector's scroll flow, well
  clear of every control, and is labelled. Ad networks ban placements that
  invite misclicks.

### Consent & privacy

`privacy.html` documents what is stored (only the consent choice, in
`localStorage`) and how advertising data is handled. The banner in
`js/consent.js` gates all ad code, and the footer's **Cookie settings** link
lets a visitor change their mind at any time.

This is a good-faith consent gate, not legal advice. For a large EU audience,
ad networks generally expect a certified IAB TCF Consent Management Platform —
the code is structured so swapping one in touches only `js/consent.js`.
