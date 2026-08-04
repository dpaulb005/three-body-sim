/*
 * ads.js — Network-agnostic advertising layer.
 *
 * Design rules this file exists to enforce:
 *
 *  1. NO LAYOUT SHIFT. Every slot reserves its height in CSS before anything
 *     loads. An unfilled or blocked slot collapses to nothing rather than
 *     pushing the simulation around. (Cumulative Layout Shift is both a
 *     ranking signal and the fastest way to make a page feel cheap.)
 *  2. NOTHING LOADS WITHOUT CONSENT. init() is only ever called by consent.js
 *     once the visitor has actually agreed. Before that, not a single ad
 *     request or cookie is made.
 *  3. NO ACCIDENTAL CLICKS. Slots are kept physically away from the simulation
 *     controls and are labelled. Ad networks ban publishers whose placements
 *     invite misclicks, so this is a policy requirement, not a nicety.
 *
 * To go live: set `enabled: true` and fill in your publisher/slot IDs below.
 * Until then the site runs exactly as it does now, with no ad requests and no
 * empty gaps.
 */

const ADS = {
  // ── Flip to true once you have a publisher account approved. ──
  enabled: false,

  // 'adsense' | 'custom'
  provider: 'adsense',

  // AdSense publisher ID, e.g. 'ca-pub-1234567890123456'
  client: '',

  // Per-placement ad unit IDs from your ad network dashboard.
  slots: {
    rail: '',        // 300x250 rectangle in the inspector footer
    leaderboard: '', // responsive banner beneath the stage (wide screens only)
  },

  // For provider:'custom' — return an HTML string for a given placement.
  // Lets you drop in any network's tag without touching the rest of the app.
  customTag: null,   // (placement, el) => string

  _started: false,
};

const AdManager = {
  /** Called by consent.js after the visitor accepts. Safe to call twice. */
  init() {
    if (ADS._started) return;
    if (!ADS.enabled) return;
    ADS._started = true;

    const placements = document.querySelectorAll('[data-ad]');
    if (!placements.length) return;

    if (ADS.provider === 'adsense') this._initAdsense(placements);
    else this._initCustom(placements);
  },

  _initAdsense(placements) {
    if (!ADS.client) {
      console.warn('[ads] provider is adsense but no client ID is set.');
      return;
    }
    // Load the AdSense library once.
    const src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(ADS.client)}`;
    const s = document.createElement('script');
    s.async = true;
    s.src = src;
    s.crossOrigin = 'anonymous';
    s.onerror = () => this._failAll(placements);
    document.head.appendChild(s);

    for (const el of placements) {
      const placement = el.dataset.ad;
      const slotId = ADS.slots[placement];
      if (!slotId) continue;

      const ins = document.createElement('ins');
      ins.className = 'adsbygoogle';
      ins.style.display = 'block';
      ins.style.width = '100%';
      ins.style.height = '100%';
      ins.setAttribute('data-ad-client', ADS.client);
      ins.setAttribute('data-ad-slot', slotId);
      ins.setAttribute('data-full-width-responsive', 'true');
      el.querySelector('.ad-body').appendChild(ins);
      el.classList.add('is-live');

      try {
        (window.adsbygoogle = window.adsbygoogle || []).push({});
      } catch (err) {
        console.warn('[ads] push failed', err);
      }
    }
  },

  _initCustom(placements) {
    if (typeof ADS.customTag !== 'function') return;
    for (const el of placements) {
      const html = ADS.customTag(el.dataset.ad, el);
      if (!html) continue;
      el.querySelector('.ad-body').innerHTML = html;
      el.classList.add('is-live');
    }
  },

  // If the network is unreachable (blocked, offline), leave no trace.
  _failAll(placements) {
    for (const el of placements) el.classList.remove('is-live');
  },
};
