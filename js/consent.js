/*
 * consent.js — Cookie/ad consent gate.
 *
 * Personalised advertising sets cookies, which in the EU/UK (GDPR/ePrivacy)
 * and California (CPRA) requires the visitor's informed, opt-in agreement
 * BEFORE any ad script runs. So the rule here is strict: AdManager.init() is
 * only ever reached from the accept path. Declining leaves the site fully
 * functional with zero ad requests — the simulation never depends on ads.
 *
 * The choice is remembered in localStorage (not a cookie, so nothing is sent
 * to any server) and can be revisited from the footer link at any time.
 *
 * NOTE: this is a clear, good-faith implementation of a consent gate, not
 * legal advice. If you serve a large EU audience, ad networks will generally
 * expect a certified IAB TCF Consent Management Platform; this gate is
 * designed so that swapping one in later only touches this file.
 */

const CONSENT_KEY = 'heliurge.consent.v1';

const Consent = {
  get value() {
    try { return localStorage.getItem(CONSENT_KEY); } catch { return null; }
  },

  set(v) {
    try { localStorage.setItem(CONSENT_KEY, v); } catch { /* private mode */ }
  },

  start() {
    // Nothing to ask if ads are not configured at all.
    if (!ADS.enabled) { this._wireFooter(); return; }

    const v = this.value;
    if (v === 'accepted') AdManager.init();
    else if (v !== 'declined') this.show();
    this._wireFooter();
  },

  show() {
    if (document.getElementById('consent')) return;
    const el = document.createElement('div');
    el.id = 'consent';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-live', 'polite');
    el.setAttribute('aria-label', 'Cookie consent');
    el.innerHTML = `
      <div class="consent-text">
        <strong>Cookies &amp; advertising</strong>
        <p>Heliurge is free and supported by ads. With your consent we and our
        advertising partners use cookies to show and measure ads. Decline and
        the simulation still works exactly the same — you will simply see no
        ads. See our <a href="privacy.html">Privacy Policy</a>.</p>
      </div>
      <div class="consent-actions">
        <button id="consent-no" class="btn">Decline</button>
        <button id="consent-yes" class="btn primary">Accept</button>
      </div>`;
    document.body.appendChild(el);

    document.getElementById('consent-yes').onclick = () => {
      this.set('accepted');
      el.remove();
      AdManager.init();
    };
    document.getElementById('consent-no').onclick = () => {
      this.set('declined');
      el.remove();
    };
  },

  _wireFooter() {
    const link = document.getElementById('consent-reopen');
    if (!link) return;
    link.onclick = (e) => {
      e.preventDefault();
      this.set('');
      this.show();
    };
  },
};
