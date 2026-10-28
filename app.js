/* Skid Row Diaries · watch page
   Asks for an email once, then records how many seconds each person watches of each video.
   Skips and seeks don't count: only time that actually plays is added. */
(function () {
  'use strict';

  // ---- Settings -----------------------------------------------------------
  const CONFIG = {
    // Paste the Google Apps Script web app URL here (ends in /exec).
    // While empty, nothing is sent and events are only printed to the browser console.
    endpoint: '',
    heartbeatSeconds: 15,
    episodes: [
      // vimeo: the number from the Vimeo link. Swap these placeholders for the real three.
      { vimeo: '1209284450', label: 'Episode 02', name: 'LaJeune McDonald', line: 'Angels among us.' },
      { vimeo: '1210982273', label: 'Episode 04', name: 'Ronald Coulter', line: '“But I have memories.”' },
      { vimeo: '1198533142', label: 'Episode 03', name: 'Name Three', line: 'Placeholder line about the third person.' }
    ]
  };

  // ---- Small helpers ------------------------------------------------------
  const $ = (id) => document.getElementById(id);
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode: keep it in memory */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  const EMAIL_KEY = 'srd_email';
  const session = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
  const device = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ? 'mobile' : 'desktop';
  const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
  let email = store.get(EMAIL_KEY) || '';

  // ---- Sending ------------------------------------------------------------
  // text/plain keeps this a "simple" request, so the browser sends it straight to Apps Script
  // without a preflight check that Apps Script can't answer.
  function send(payload, useBeacon) {
    const body = JSON.stringify(Object.assign({
      email, session, device, page: location.pathname + location.search, ts: new Date().toISOString()
    }, payload));
    if (!CONFIG.endpoint) { console.info('[srd] would send', JSON.parse(body)); return; }
    if (useBeacon && navigator.sendBeacon) {
      navigator.sendBeacon(CONFIG.endpoint, new Blob([body], { type: 'text/plain;charset=utf-8' }));
      return;
    }
    fetch(CONFIG.endpoint, {
      method: 'POST', mode: 'no-cors', keepalive: true,
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body
    }).catch(() => {});
  }

  // ---- Episodes -----------------------------------------------------------
  const list = $('episodes');
  const trackers = [];

  function renderEpisodes(locked) {
    list.innerHTML = '';
    list.setAttribute('aria-busy', locked ? 'true' : 'false');
    CONFIG.episodes.forEach((ep, i) => {
      const art = document.createElement('article');
      art.className = 'ep';
      art.innerHTML =
        '<p class="ep-label"></p><h2 class="ep-name"></h2>' +
        '<div class="ep-frame"></div><p class="ep-line"></p>';
      art.querySelector('.ep-label').textContent = ep.label;
      art.querySelector('.ep-name').textContent = ep.name;
      art.querySelector('.ep-line').textContent = ep.line;
      const frame = art.querySelector('.ep-frame');
      if (locked) {
        const lock = document.createElement('div');
        lock.className = 'ep-lock';
        lock.textContent = 'Enter your email above to watch';
        frame.appendChild(lock);
      } else {
        const iframe = document.createElement('iframe');
        iframe.src = 'https://player.vimeo.com/video/' + encodeURIComponent(ep.vimeo) +
          '?badge=0&autopause=0&title=0&byline=0&portrait=0&player_id=0&app_id=58479';
        iframe.allow = 'autoplay; fullscreen; picture-in-picture; clipboard-write; encrypted-media; web-share';
        iframe.referrerPolicy = 'strict-origin-when-cross-origin';
        iframe.title = ep.name;
        iframe.loading = i === 0 ? 'eager' : 'lazy';
        frame.appendChild(iframe);
        trackers.push(track(iframe, ep, i));
      }
      list.appendChild(art);
    });
  }

  function track(iframe, ep, index) {
    const player = new Vimeo.Player(iframe);
    const t = { player, watched: 0, furthest: 0, duration: 0, last: null, started: false, lastSent: 0 };
    const base = () => ({
      video_id: ep.vimeo, video_title: ep.name, video_index: index + 1,
      watched: Math.round(t.watched), furthest: Math.round(t.furthest), duration: Math.round(t.duration)
    });
    const report = (type, beacon) => { t.lastSent = t.watched; send(Object.assign({ type }, base()), beacon); };

    player.getDuration().then((d) => { t.duration = d; }).catch(() => {});
    player.on('play', (d) => {
      t.last = d.seconds;
      // one story at a time
      trackers.forEach((o) => { if (o !== t) o.player.pause().catch(() => {}); });
      if (!t.started) { t.started = true; report('start'); }
    });
    player.on('timeupdate', (d) => {
      if (t.last !== null) {
        const step = d.seconds - t.last;
        if (step > 0 && step < 2) t.watched += step; // jumps are seeks, not watching
      }
      t.last = d.seconds;
      if (d.seconds > t.furthest) t.furthest = d.seconds;
      if (d.duration) t.duration = d.duration;
      if (t.watched - t.lastSent >= CONFIG.heartbeatSeconds) report('progress');
    });
    player.on('seeked', (d) => { t.last = d.seconds; });
    player.on('pause', () => { t.last = null; if (t.watched > t.lastSent) report('pause'); });
    player.on('ended', () => { t.last = null; report('complete'); });
    player.on('error', (e) => send(Object.assign({ type: 'error', error: e.name }, base())));
    t.flush = () => { if (t.watched > t.lastSent) report('leave', true); };
    return t;
  }

  // Leaving the page or switching apps: send what's been watched since the last update.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') trackers.forEach((t) => t.flush());
  });
  window.addEventListener('pagehide', () => trackers.forEach((t) => t.flush()));

  // ---- Gate ---------------------------------------------------------------
  function unlock() {
    $('gate').hidden = true;
    $('outro').hidden = false;
    const signed = $('signed-as');
    signed.hidden = false;
    signed.textContent = 'Watching as ' + email + '. ';
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.textContent = 'Not you?';
    reset.addEventListener('click', () => { store.del(EMAIL_KEY); location.reload(); });
    signed.appendChild(reset);
    renderEpisodes(false);
    send({ type: 'visit' });
  }

  $('gate-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const value = $('email').value.trim().toLowerCase();
    const err = $('gate-error');
    if (!isEmail(value)) {
      err.textContent = 'Please enter a full email address.';
      err.hidden = false;
      $('email').focus();
      return;
    }
    err.hidden = true;
    email = value;
    store.set(EMAIL_KEY, email);
    send({ type: 'signup' });
    unlock();
    list.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  if (email) {
    unlock();
  } else {
    $('gate').hidden = false;
    renderEpisodes(true);
  }
})();
