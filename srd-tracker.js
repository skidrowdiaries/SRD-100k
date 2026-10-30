/*! Skid Row Diaries · viewer tracker v2
 * Drop-in, no styling, no dependencies (loads Vimeo's player.js itself if the page hasn't).
 * Sends to the Google Apps Script web app that keeps the "SRD viewers" sheet.
 *
 *   SRD.isKnown()                       true once we know who is watching (email, or Inro ID from ?c=)
 *   SRD.viewer()                        { email, first_name, inro_id, ig_handle, source, pathway } or null
 *   SRD.signup({ first_name, email })   validates, remembers, logs a signup. Returns { ok, error }
 *   SRD.gateShown()                     call when the sign-up form is shown to someone we don't know
 *   SRD.attach(iframe) / SRD.attachAll() start tracking Vimeo iframes (iframe[data-srd-video])
 *   SRD.forget()                        clear the remembered viewer on this device ("Not you?")
 *   Any element with data-srd-link="name" logs a link_click when clicked.
 *
 * Watch time counts only seconds that actually play: seeking or skipping never adds time.
 */
(function (w, doc) {
  'use strict';
  if (w.SRD && w.SRD.version) return;

  var cfg = {
    endpoint: 'https://script.google.com/macros/s/AKfycbwLT8cMZgfye1NIlQX2oN-XOovgOFSzUnvX8DrCimFST18ggHnVrwaPtbpgqEePmPDX/exec',
    heartbeatSeconds: 60,          // running totals; pause, leave and the end also report, so nothing between beats is lost
    debug: false
  };
  var KEY = 'srd_viewer';

  // ---- storage that never throws (private mode, blocked storage) ----
  var mem = {};
  function sget(store, k) { try { return w[store].getItem(k); } catch (e) { return mem[store + k] || null; } }
  function sset(store, k, v) { try { w[store].setItem(k, v); } catch (e) { mem[store + k] = v; } }
  function sdel(store, k) { try { w[store].removeItem(k); } catch (e) { delete mem[store + k]; } }

  function load() { try { return JSON.parse(sget('localStorage', KEY) || '{}') || {}; } catch (e) { return {}; } }
  function save(v) { sset('localStorage', KEY, JSON.stringify(v)); }
  var me = load();

  var isEmail = function (v) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v); };
  var device = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ? 'mobile' : 'desktop';
  var uuid = function () {
    return (w.crypto && crypto.randomUUID) ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
  };

  // ---- read the link: ?c= Inro contact ID, ?u= Instagram handle, ?n= first name, ?src= source tag, ?p= pathway ----
  (function readLink() {
    var q = new URLSearchParams(location.search), changed = false;
    var c = (q.get('c') || '').trim();
    if (c && c.indexOf('{{') === -1) {
      if (me.inro_id && me.inro_id !== c) me = {};       // a different person's link on this device
      me.inro_id = c; changed = true;
    }
    var u = (q.get('u') || '').replace(/^@/, '').trim();
    if (u && u.indexOf('{{') === -1) { me.ig_handle = u; changed = true; }
    var n = (q.get('n') || '').trim();
    if (n && n.indexOf('{{') === -1 && !me.first_name) { me.first_name = n; changed = true; }
    var src = (q.get('src') || '').trim().toLowerCase();
    if (src && !me.source) { me.source = src.slice(0, 60); changed = true; }   // first touch wins
    var p = (q.get('p') || '').trim().toLowerCase();
    if (p) { me.pathway = p.slice(0, 30); changed = true; }
    if (changed) save(me);
    // Take identity out of the address bar so a shared link doesn't credit someone else.
    ['c', 'u', 'n', 'p'].forEach(function (k) { q.delete(k); });
    if (c || u || n || p) {
      var rest = q.toString();
      try { history.replaceState(null, '', location.pathname + (rest ? '?' + rest : '') + location.hash); } catch (e) {}
    }
  })();

  var testing = /^selftest-/.test(me.inro_id || '') || /^selftest-/.test(me.email || '');
  var session = sget('sessionStorage', 'srd_session');
  if (!session || (testing && session.indexOf('selftest-') !== 0)) {
    session = (testing ? 'selftest-' : '') + uuid();
    sset('sessionStorage', 'srd_session', session);
  }

  // ---- sending: text/plain keeps it a simple request that Apps Script accepts without a preflight ----
  function send(payload, leaving) {
    var body = JSON.stringify(Object.assign({
      email: me.email || '', first_name: me.first_name || '', inro_id: me.inro_id || '', ig_handle: me.ig_handle || '',
      source: me.source || (doc.referrer ? 'referral' : 'direct'), pathway: me.pathway || '',
      session: session, device: device, page: location.pathname, ts: new Date().toISOString()
    }, payload));
    if (cfg.debug) console.info('[srd]', JSON.parse(body));
    if (!cfg.endpoint) return;
    if (leaving && navigator.sendBeacon) {
      navigator.sendBeacon(cfg.endpoint, new Blob([body], { type: 'text/plain;charset=utf-8' }));
      return;
    }
    fetch(cfg.endpoint, {
      method: 'POST', mode: 'no-cors', keepalive: true,
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: body
    }).catch(function () {});
  }

  function isKnown() { return !!(me.email || me.inro_id); }

  function visitOnce() {
    if (!isKnown()) return;
    var k = 'srd_visit_' + location.pathname;
    if (sget('sessionStorage', k)) return;
    sset('sessionStorage', k, '1');
    send({ type: 'visit' });
  }

  // ---- Vimeo ----
  var trackers = [], queue = [], loading = false;
  function withVimeo(fn) {
    if (w.Vimeo && w.Vimeo.Player) return fn();
    queue.push(fn);
    if (loading) return;
    loading = true;
    var s = doc.createElement('script');
    s.src = 'https://player.vimeo.com/api/player.js';
    s.async = true;
    s.onload = function () { var q = queue; queue = []; q.forEach(function (f) { f(); }); };
    doc.head.appendChild(s);
  }

  function attach(iframe) {
    if (!iframe || iframe.__srd) return;
    iframe.__srd = true;
    var id = iframe.getAttribute('data-srd-video') || ((iframe.src || '').match(/video\/(\d+)/) || [])[1];
    if (!id) return;
    var title = iframe.getAttribute('data-srd-title') || iframe.title || '';
    withVimeo(function () {
      var player = new w.Vimeo.Player(iframe);
      var t = { id: id, player: player, watched: 0, seen: {}, unique: 0, furthest: 0, duration: 0, last: null, started: false, sent: 0 };
      trackers.push(t);
      var base = function () {
        return { video_id: id, video_title: title, watched: Math.round(t.watched), unique: t.unique,
          furthest: Math.round(t.furthest), duration: Math.round(t.duration) };
      };
      var report = function (type, leaving) { t.sent = t.watched; send(Object.assign({ type: type }, base()), leaving); };
      t.flush = function () { if (t.watched > t.sent + 0.5) report('leave', true); };

      player.getDuration().then(function (d) { t.duration = d; }).catch(function () {});
      player.on('play', function (d) {
        t.last = d.seconds;
        trackers.forEach(function (o) { if (o !== t) o.player.pause().catch(function () {}); });  // one story at a time
        if (!t.started) { t.started = true; report('start'); }
      });
      player.on('timeupdate', function (d) {
        if (t.last !== null) {
          var step = d.seconds - t.last;
          if (step > 0 && step < 2) {                       // a jump is a seek, not watching
            t.watched += step;
            var s = Math.floor(d.seconds);
            if (!t.seen[s]) { t.seen[s] = 1; t.unique++; }
          }
        }
        t.last = d.seconds;
        if (d.seconds > t.furthest) t.furthest = d.seconds;
        if (d.duration) t.duration = d.duration;
        if (t.watched - t.sent >= cfg.heartbeatSeconds) report('progress');
      });
      player.on('seeked', function (d) { t.last = d.seconds; });
      player.on('pause', function () { t.last = null; if (t.watched > t.sent + 0.5) report('pause'); });
      player.on('ended', function () { t.last = null; report('complete'); });
      player.on('error', function (e) { send(Object.assign({ type: 'error', error: (e && e.name) || 'error' }, base())); });
    });
    visitOnce();
  }

  function attachAll(root) {
    var list = (root || doc).querySelectorAll('iframe[data-srd-video]');
    for (var i = 0; i < list.length; i++) attach(list[i]);
  }

  function flushAll() { trackers.forEach(function (t) { t.flush && t.flush(); }); }
  doc.addEventListener('visibilitychange', function () { if (doc.visibilityState === 'hidden') flushAll(); });
  w.addEventListener('pagehide', flushAll);

  doc.addEventListener('click', function (e) {
    var el = e.target && e.target.closest && e.target.closest('[data-srd-link]');
    if (el && isKnown()) send({ type: 'link_click', link: el.getAttribute('data-srd-link') || el.href || '' }, true);
  }, true);

  w.SRD = {
    version: 2,
    configure: function (o) { Object.assign(cfg, o || {}); return cfg; },
    isKnown: isKnown,
    viewer: function () { return isKnown() ? Object.assign({}, me) : null; },
    signup: function (o) {
      o = o || {};
      var email = String(o.email || '').trim().toLowerCase();
      var first = String(o.first_name || '').trim();
      if (o.requireFirstName !== false && !first) return { ok: false, error: 'first_name' };
      if (!isEmail(email)) return { ok: false, error: 'email' };
      if (me.email && me.email !== email) me = { source: me.source };   // someone else on a shared device
      me.email = email;
      if (first) me.first_name = first.slice(0, 80);
      if (o.source && !me.source) me.source = String(o.source).slice(0, 60);
      if (!me.pathway) me.pathway = 'website';
      save(me);
      send({ type: 'signup', signup_form: o.form || '' });
      return { ok: true };
    },
    gateShown: function () {
      if (isKnown()) return;
      var k = 'srd_gate_' + location.pathname;
      if (sget('sessionStorage', k)) return;
      sset('sessionStorage', k, '1');
      send({ type: 'gate_view' });
    },
    visit: visitOnce,
    attach: attach,
    attachAll: attachAll,
    track: function (type, extra) { if (isKnown()) send(Object.assign({ type: String(type) }, extra || {})); },
    forget: function () { me = {}; sdel('localStorage', KEY); },
    players: trackers                                       // for the acceptance test
  };
})(window, document);
