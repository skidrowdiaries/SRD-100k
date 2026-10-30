---
name: srd-watch-tracking
description: Build or change the Skid Row Diaries /watch page, episode embeds, sign-up forms or viewer tracking on skidrowdiaries.com, and verify the Google Sheet receives every play.
---

# Skid Row Diaries · watch page and viewer tracking

This skill is the complete hand-off for the episode funnel on skidrowdiaries.com. The back end (Google Sheet + Apps Script web app) is **already built, deployed and tested with real plays**. Your job in the website code session is to build `/watch` (and the two homepage entry points) in the site's own design, wire in the tracker exactly as specified here, and run the acceptance test until it passes.

Do not redesign or re-implement the tracking or the sheet. Do not change the endpoint URL. Design is yours; the contract below is not.

## How it fits together

```
Instagram (Inro DM "Watch")  ──link /watch?c=<inro id>&u=<handle>&src=ig-dm&p=dm──┐
Homepage section B button     ──link /watch?src=home-b─────────────────────────────┤
Homepage footer sign-up form  ──SRD.signup() then go to /watch────────────────────┤
                                                                                   ▼
                        skidrowdiaries.com/watch  (srd-tracker.js + 3 Vimeo iframes)
                                                                                   │  POST text/plain JSON
                                                                                   ▼
                 Google Apps Script web app  ──writes──▶  Google Sheet "SRD viewers"
                                                           Viewers · Episodes · Watch · Log
```

- A visitor is **known** when the device has their email (from a form) or their Inro contact ID (from `?c=` in an Inro link). Known visitors see the episodes immediately. Unknown visitors see a form (first name + email, both required), and the episodes unlock the moment they submit. No email confirmation step for website visitors.
- Every second of actual playback is counted per person, per episode. Seeking and skipping never add time. "Finished" means 90% of the episode actually watched, so skipping to the end does not count.
- Material is not given away: there is no anonymous viewing. The gate is a soft gate (a fake email works); the Vimeo domain lock is what stops the videos playing anywhere else.

## Live pieces (do not change)

| Piece | Value |
|---|---|
| Web app endpoint (tracker posts here) | `https://script.google.com/macros/s/AKfycbwLT8cMZgfye1NIlQX2oN-XOovgOFSzUnvX8DrCimFST18ggHnVrwaPtbpgqEePmPDX/exec` |
| Health check | `GET <endpoint>?ping=1` → `{"ok":true,"version":4,...}` |
| Test read-back | `GET <endpoint>?selftest=selftest-<anything>` → that test viewer's rows (test IDs only, never real people) |
| Google Sheet | "SRD viewers" · id `1xNAivJaFFNVC51aIzBaGGG53kTzQrGXXo5T1RQ7OarM` · owned by press@skidrowdiaries.com |
| Apps Script project | bound to that sheet (Extensions › Apps Script) · id `13VpvayjZMNfDMpOxoGhhoBegYYfw64FFJ8cOSWRiAbLCOTChgqzqqPFT` · deployment "SRD viewer log v4", execute as Me, access Anyone |
| Reference implementation (plain HTML) | repo `skidrowdiaries/SRD-100k` (public) · live at `https://dashing-bavarois-22479e.netlify.app/` · source of truth for every file in this skill, commit `f6ad0e8` |

Note for whoever opens the sheet: in a browser signed into several Google accounts, the `/exec` URL opens a "Page not found" Drive page because Google inserts `/u/N/`. That's a browser quirk; the endpoint works. Test it from a signed-out window, `curl -L`, or the acceptance test.

## The episodes

| # | Vimeo ID | Title on page | Line |
|---|---|---|---|
| 1 | `1210983580` | Michael Steger | A gentle giant. |
| 2 | `1209284450` | LaJeune McDonald | Angels among us. |
| 3 | `1210982273` | Ronald Coulter | "But I have memories." |

The episode labels on the reference page are Episode 01, Episode 02 and Episode 04 (the series numbering). Ask Patrick before changing them.

To swap an episode later, change it in **two** places: the page, and `EPISODES` at the top of the Apps Script (order = column order on the Viewers tab). Then in the Apps Script editor run `setup`, and redeploy (Deploy › Manage deployments › pencil › Version: New version › Deploy). The URL stays the same.

## Vimeo settings (required, or the players show "cannot be played here")

For each of the three videos, in Vimeo › video › Privacy (Vimeo Plus account):
- Who can watch: **Hide from Vimeo** / "Embed only" (not Private: Private blocks embeds).
- Where can this be embedded: **Specific domains**, listing every exact hostname that will show the player: `skidrowdiaries.com`, `www.skidrowdiaries.com`, `dashing-bavarois-22479e.netlify.app` (the test bench), and any preview hostname you test on. Vimeo needs exact hostnames: `netlify.app` on its own is rejected, and Netlify deploy previews each have their own hostname. Up to 50 domains.
- Player: hide title, byline, portrait and badge (the iframe parameters below do this too).

If the acceptance test fails only on playback against a new hostname, it is almost always this list.

## The page contract

### 1. Load the tracker once, on every page

Ship `srd-tracker.js` (full source at the end of this skill) **verbatim** as a static file, e.g. `public/srd-tracker.js`, and load it on every page of the site (it is ~10 KB, has no dependencies, does nothing until called, and loads Vimeo's `player.js` itself when the first player is attached).

- Plain HTML: `<script src="/srd-tracker.js"></script>` before your page script.
- Next.js: `<Script src="/srd-tracker.js" strategy="afterInteractive" />` in the root layout, and only call `window.SRD` from client components after it exists (`if (window.SRD) …`, or poll/await `onLoad`).

Everything must stay on one origin (skidrowdiaries.com): the tracker remembers the viewer in `localStorage`, so a sign-up on the homepage is recognised on `/watch`.

If the site sends a Content-Security-Policy, allow: `script-src https://player.vimeo.com`, `frame-src https://player.vimeo.com`, `connect-src https://script.google.com https://script.googleusercontent.com`.

### 2. The tracker's API

```js
SRD.isKnown()                         // true if we know who this is (email or Inro ID)
SRD.viewer()                          // { email, first_name, inro_id, ig_handle, source, pathway } or null
SRD.signup({ first_name, email, source })  // validates, remembers, logs. Returns { ok: true } or { ok: false, error: 'first_name' | 'email' }
SRD.gateShown()                       // call when the form is shown to an unknown visitor (gate conversion)
SRD.attachAll(rootElement)            // start tracking every iframe[data-srd-video] inside root
SRD.attach(iframe)                    // same, one iframe (safe to call twice)
SRD.forget()                          // "Not you?": clear this device, then reload
SRD.track('event_name', { ... })      // custom event, logged to the Log tab (known viewers only)
```

On load the tracker reads `?c=` (Inro contact ID), `?u=` (Instagram handle), `?n=` (first name), `?p=` (pathway) and `?src=` (source tag, first touch wins), remembers them, and **removes `c`, `u`, `n`, `p` from the address bar** so a shared link doesn't credit the wrong person. Don't fight that with your router.

### 3. Episode markup

Each player is a plain Vimeo iframe with two data attributes. Keep the 9:16 frame.

```html
<iframe
  src="https://player.vimeo.com/video/1210983580?badge=0&autopause=0&title=0&byline=0&portrait=0&dnt=1"
  data-srd-video="1210983580"
  data-srd-title="Michael Steger"
  title="Michael Steger"
  allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
  referrerpolicy="strict-origin-when-cross-origin"
  loading="lazy"></iframe>
```

- `data-srd-video` (the Vimeo ID) is required; `data-srd-title` is a fallback label.
- Call `SRD.attachAll(container)` **after** the iframes are in the DOM (React: in a `useEffect` after the unlocked list renders).
- Don't remount the iframes on scroll or animation. Animate a wrapper, not the iframe. A remounted iframe becomes a new player and restarts its count. GSAP transforms, opacity and Lenis are fine.
- Only one episode plays at a time; the tracker pauses the others automatically.
- `referrerpolicy="strict-origin-when-cross-origin"` is required for Vimeo's domain check. Don't set `no-referrer` anywhere on the page.

### 4. /watch page behaviour

```
on load (client only; localStorage doesn't exist on the server):
  if SRD.isKnown():  render the 3 episode iframes, then SRD.attachAll(list); show "Watching as <first name> · Not you?"
  else:              render the 3 episodes locked (poster/still, no iframe), show the form, call SRD.gateShown()

form submit:
  r = SRD.signup({ first_name, email })
  if !r.ok: show the error for r.error ('first_name' → "Please add your first name.", 'email' → "Please enter a full email address.")
  else:     hide the form, render the iframes, SRD.attachAll(list), scroll to the first episode

"Not you?": SRD.forget(); location.reload()
```

- Render nothing gate-dependent during server render. Show a neutral state (e.g. the episode stills, no form, no iframes) until the client has checked `SRD.isKnown()`, so known viewers don't see the form flash.
- Form fields: first name (`autocomplete="given-name"`, required) and email (`type="email"`, `autocomplete="email"`, required). Use `novalidate` and the tracker's validation, so the error copy stays yours. Keep a `<form>` element: the acceptance test finds the inputs inside it and submits with Enter.
- Consent line under the form (required): "By continuing you agree to our [Privacy Policy](/privacy) and to occasional emails about new stories." The `/privacy` page has to exist before launch (California requires a privacy policy on commercial sites that collect personal info, and this one records what each person watches). Patrick is having one drafted; leave the link in place.
- `/watch` is its own focused page: stripped-down header, no full nav, a clear link back to the homepage. Same fonts, tokens and footer as the site.
- No pop-ups on `/watch`.

### 5. Homepage entry points

- **Section B** ("Full Episodes…") becomes three episode cards (still, name, one line) and one button to `/watch?src=home-b`. Copy says the episodes are out now, not "streaming soon".
- **Footer "Never Miss a Story" form**: on submit call `SRD.signup({ first_name, email, source: 'home-footer' })` (`source` only applies if the visitor has no earlier source tag). If it's ok, go to `/watch` (the visitor is already known, so the episodes are unlocked). Make first name required here too, so every row on the sheet has a name. Remove the Web3Forms submission from this form, or keep it in addition. Patrick decides; the sheet is now the list.
- Put `?src=` tags on every link to `/watch` you create, from this list (lowercase, hyphenated): `home-b`, `home-footer`, `ig-bio`, `ig-dm`, `ig-story`, `newsletter`, `press`. New tags are fine. They appear as-is under VIEWERS BY SOURCE.

### 6. Link clicks worth counting

Add `data-srd-link="<name>"` to links you want counted per viewer (Log tab, `link_clicks` column, LINK CLICKS summary): for example `data-srd-link="instagram"`, `"la-mission"`, `"la-mission-donate"`, `"youtube"`, `"home"`. Only known viewers are counted.

## What lands in the sheet

**Viewers** (one row per person, ranked by total watch time):
`first_name, email, instagram, signed_up, source, pathway, total_watch_min, <episode> · min, <episode> · % (×3), episodes_finished, watched_all, visits, last_seen, tier, first_episode, device, link_clicks, inro_id, key`
- `<episode> · min` counts every second watched, including rewatches (a loyalty signal). `· %` is the best single visit's share of the episode actually seen.
- `tier`: **Superfan** = finished all three · **Engaged** = finished at least one · **Sampler** = watched something · **Signed up only**.
- `pathway`: `website` (form), `dm` / `email` (from Inro links via `?p=`), `instagram` (Inro link without `p`).

**Episodes**: started, finished, completion rate, avg watch, avg %, reached 25/50/75%, median stop point of non-finishers, total minutes, watched first. Then a SUMMARY with tiers, website gate shown → signups (gate conversion), unlocked visits → visits that played (play rate), share of visits on mobile, plays by time of day (LA), viewers by source and by pathway, and link clicks. It refreshes at most once a minute while events arrive, and on demand from the sheet menu **SRD › Refresh Episodes and ranking**.

**Watch**: one row per person × episode × visit with running totals. **Log**: one row per meaningful event: `gate_view, signup, identify, visit, start, milestone (25/50/75%), finished, reached_end, link_click, error`.

Anything containing `selftest-` never counts in the summary. **SRD › Delete self-test rows** removes it. The tabs `old views`, `old signups`, `old loyal viewers` are version 1 test data and can be deleted.

## Event contract (for anything else that posts: Inro, future forms)

`POST <endpoint>` with header `Content-Type: text/plain;charset=utf-8` (a "simple" request, so no CORS preflight; Apps Script can't answer one) and a JSON body:

```json
{ "type": "identify", "email": "", "first_name": "", "inro_id": "", "ig_handle": "",
  "source": "ig-dm", "pathway": "dm", "session": "inro", "device": "", "page": "",
  "video_id": "", "watched": 0, "unique": 0, "furthest": 0, "duration": 0, "link": "" }
```

- A person is matched by email first, then by `inro_id`. If someone first known only by Inro ID later gets an email (an Inro `identify` call with both), their row and watch history move to the email.
- Inro's HTTP Request action can send `identify` with `{{contact.id}}`, `{{contact.username}}`, the collected email and first name. The Inro DM links must carry `?c={{contact.id}}&u={{contact.username}}&src=ig-dm&p=dm`. Inro link cards do fill these placeholders in (tested 28 Oct 2026). This side isn't built yet; it's separate work in the Claude session that owns Inro.

## Changing the Apps Script

The full script is at the end of this skill and in the repo at `apps-script/Code.gs`. To change it: Extensions › Apps Script in the sheet, replace the file, save, run `setup` if columns or episodes changed, then **Deploy › Manage deployments › pencil › Version: New version › Deploy**. Saving alone does not change the live endpoint; the web app runs the last deployed version. Bump `VERSION` and update the acceptance test's minimum version if behaviour changes.

## Acceptance test (run it; don't skip it)

`srd-selftest.mjs` (full source at the end) plays a few seconds of every episode as two fake viewers, one arriving from an Inro link and one using the form, then asks the sheet what it received. It passes only if every play reached the sheet with the right person, episode, watch time, source and pathway.

```bash
npm i -D playwright            # once
node srd-selftest.mjs https://<the site or preview hostname>/watch
# PASS: 25/25 checks passed.   ← required before calling this done
```

- It uses installed Google Chrome (`channel: 'chrome'`) because Playwright's bundled Chromium can't play Vimeo's H.264 streams. If Chrome isn't installed, playback checks can fail for that reason alone. Install Chrome or run it on a machine that has it.
- The hostname under test must be in each video's Vimeo domain list.
- It writes rows tagged `selftest-…`. They don't affect the summary; clear them with SRD › Delete self-test rows.
- Env overrides: `SRD_SECONDS` (seconds played per episode, default 8), `SRD_EPISODES` (default 3), `SRD_ENDPOINT`.
- This exact script passed 25/25 against the reference page with a stand-in player and endpoint. The live endpoint was verified separately with real Chrome plays of all three videos on 30 Oct 2026.

### If the test fails

| Failing check | Likely cause |
|---|---|
| Sheet web app answers | No network to script.google.com from where you run it, or the deployment was changed. |
| tracker loaded on the page | `srd-tracker.js` not served or not loaded on `/watch`. |
| Inro link recognised | The page ran its gate check before the tracker loaded, or your router stripped the query before the tracker read it. |
| identity removed from the address bar | Router re-added the query. |
| page shows 3 tracked Vimeo players | iframes missing `data-srd-video`, or rendered inside a shadow root / other document. |
| episode N plays and counts watch time | Vimeo domain list doesn't include this hostname; `referrerpolicy` stripped; Playwright Chromium without Chrome; iframe remounted during the test. |
| new visitor sees the form, episodes locked | iframes rendered for unknown visitors (anonymous viewing must not happen). |
| first name + email unlocks the episodes | No `<form>` around the inputs, missing `autocomplete="given-name"` or a `name` containing "first" on the first-name input, or the submit handler doesn't call `SRD.signup`. |
| viewer row / watch time in the sheet | Events blocked by CSP `connect-src`, or sent with a JSON content type (must be `text/plain`). |

## Known limits (be straight about these)

- **Capacity.** Apps Script handles one write at a time, about 1–3 seconds each. The tracker reports every 60 s of watching, plus on pause, leaving and finishing, and every report carries running totals, so a dropped beat costs nothing. That comfortably covers roughly 20–30 people watching at the same moment. Past that, writes queue and some arrive late. If a launch is expected to bring hundreds of people at once, move the endpoint to a real database (e.g. a Netlify Function + Supabase) behind the same event contract. The page wouldn't change.
- **Soft gate.** Anyone can type a fake email. Only an emailed link (a later Inro pathway) confirms an address is real.
- **Ad blockers** rarely block script.google.com, but a few strict privacy extensions do; those viewers watch fine but aren't counted.
- **One device = one viewer.** A shared family iPad counts as whoever signed in last; "Not you?" fixes it.

## Source: srd-tracker.js (ship verbatim)

```js
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
```

## Source: Apps Script `Code.gs` (record of what is deployed, version 4)

```js
/**
 * Skid Row Diaries · viewer log  (version 2)
 *
 * Receives events from the watch page (and, later, from Inro) and keeps four tabs:
 *   Viewers   one row per person: who they are, where they came from, how much of each episode they watched, tier
 *   Episodes  one row per episode, plus a summary block (gate conversion, play rate, devices, time of day, sources, links)
 *   Watch     one row per person, per episode, per visit (the running totals the page sends)
 *   Log       one row per meaningful event (signup, visit, start, milestones, finish, link clicks, gate shown)
 *
 * Setup (once, or again after replacing this file):
 *   1. Extensions > Apps Script. Replace everything with this file. Save.
 *   2. Choose `setup` in the toolbar and press Run. Approve access if asked.
 *   3. Deploy > Manage deployments > edit (pencil) > Version: New version > Deploy.
 *      The web app URL stays the same.
 *
 * To swap an episode: change EPISODES below (order = column order on Viewers), save, run `setup`, redeploy.
 */

const VERSION = 4;
const TZ = 'America/Los_Angeles';

const EPISODES = [
  { id: '1210983580', name: 'Michael Steger' },
  { id: '1209284450', name: 'LaJeune McDonald' },
  { id: '1210982273', name: 'Ronald Coulter' }
];
const FINISHED_AT = 0.9;        // 90% watched counts as finished (credits)
const MILESTONES = [25, 50, 75];

const T = { VIEWERS: 'Viewers', EPISODES: 'Episodes', WATCH: 'Watch', LOG: 'Log' };

const VIEWER_BASE = ['first_name', 'email', 'instagram', 'signed_up', 'source', 'pathway', 'total_watch_min'];
const VIEWER_TAIL = ['episodes_finished', 'watched_all', 'visits', 'last_seen', 'tier', 'first_episode',
  'device', 'link_clicks', 'inro_id', 'key'];
function viewerHeaders_() {
  const eps = [];
  EPISODES.forEach((e) => { eps.push(e.name + ' · min', e.name + ' · %'); });
  return VIEWER_BASE.concat(eps, VIEWER_TAIL);
}
const WATCH_HEADERS = ['key', 'viewer', 'video_id', 'episode', 'session', 'first_seen', 'last_seen',
  'seconds_watched', 'unique_seconds', 'furthest', 'duration', 'coverage', 'finished', 'milestone', 'device'];
const LOG_HEADERS = ['time', 'viewer', 'event', 'episode', 'video_id', 'detail', 'source', 'pathway',
  'device', 'hour', 'session', 'page'];

// ---------------------------------------------------------------- setup

function setup() {
  const ss = SpreadsheetApp.getActive();
  ss.setSpreadsheetTimeZone(TZ);
  // Version 1 tabs held test rows only. Keep them, renamed, so nothing is lost; delete them whenever you like.
  ['views', 'signups', 'loyal viewers'].forEach((n) => {
    const old = ss.getSheetByName(n);
    if (old) old.setName('old ' + n);
  });
  const v = sheet_(ss, T.VIEWERS, viewerHeaders_());
  v.getRange(1, 1, 1, viewerHeaders_().length).setValues([viewerHeaders_()]).setFontWeight('bold');
  sheet_(ss, T.EPISODES, []);
  sheet_(ss, T.WATCH, WATCH_HEADERS);
  sheet_(ss, T.LOG, LOG_HEADERS);
  ss.setActiveSheet(v);
  ss.moveActiveSheet(1);
  formatViewers_(v);
  refreshSummary_(true);
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('SRD')
    .addItem('Refresh Episodes and ranking', 'refreshNow')
    .addItem('Delete self-test rows', 'deleteSelftestRows')
    .addToUi();
}
function refreshNow() { refreshSummary_(true); }

// ---------------------------------------------------------------- web app

function doPost(e) {
  let d;
  try { d = JSON.parse(e.postData.contents); } catch (err) { return text_('bad json'); }
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return text_('busy');   // the page re-sends running totals, so a dropped beat is recovered
  try {
    handle_(d);
    return text_('ok');
  } catch (err) {
    console.error(err && err.stack || err);
    return text_('error');
  } finally {
    lock.releaseLock();
  }
}

/** GET ?ping=1 → version.  GET ?selftest=selftest-XXXX → what the sheet holds for that test viewer (test IDs only). */
function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.selftest) {
    const id = String(p.selftest);
    if (!/^selftest-[\w-]{1,60}$/.test(id)) return json_({ error: 'selftest ids must start with selftest-' });
    return json_(selftestReport_(id));
  }
  return json_({ ok: true, version: VERSION, episodes: EPISODES.map((x) => x.id) });
}

// ---------------------------------------------------------------- events

function handle_(d) {
  const ss = SpreadsheetApp.getActive();
  const type = clip_(d.type, 30);
  const now = new Date();
  const ctx = {
    email: normEmail_(d.email),
    first: clip_(d.first_name, 80).trim(),
    inro: clip_(d.inro_id, 80).trim(),
    handle: clip_(d.ig_handle, 80).replace(/^@/, '').trim(),
    source: clip_(d.source, 60) || 'direct',
    pathway: clip_(d.pathway, 30),
    device: clip_(d.device, 20),
    session: clip_(d.session, 80),
    page: clip_(d.page, 200)
  };
  const ep = episodeOf_(d.video_id);

  // Anonymous: the gate was shown to someone we don't know yet. Logged for gate conversion only.
  if (type === 'gate_view') {
    log_(ss, now, 'anon:' + ctx.session, type, null, d, '', ctx);
    return;
  }

  const V = sheet_(ss, T.VIEWERS, viewerHeaders_());
  const vr = findOrCreateViewer_(V, ctx, now);
  if (!vr) return;                                      // no email and no Inro ID: nothing to attach it to
  const key = vr.key, cur = vr.values;
  const H = viewerHeaders_();
  const at = (n) => H.indexOf(n);

  switch (type) {
    case 'signup':
    case 'identify':
      log_(ss, now, key, type, null, d, '', ctx);
      break;
    case 'visit':
      cur[at('visits')] = num_(cur[at('visits')]) + 1;
      log_(ss, now, key, type, null, d, '', ctx);
      break;
    case 'link_click':
      cur[at('link_clicks')] = num_(cur[at('link_clicks')]) + 1;
      log_(ss, now, key, type, null, d, clip_(d.link, 120), ctx);
      break;
    case 'start':
    case 'progress':
    case 'pause':
    case 'leave':
    case 'complete':
    case 'error': {
      if (!d.video_id) break;
      const crossed = upsertWatch_(ss, key, d, ep, ctx, now);
      if (type === 'start') {
        log_(ss, now, key, 'start', ep, d, '', ctx);
        if (!cur[at('first_episode')]) cur[at('first_episode')] = ep ? ep.name : clip_(d.video_title, 80);
      }
      if (type === 'complete') log_(ss, now, key, 'reached_end', ep, d, '', ctx);
      crossed.forEach((m) => log_(ss, now, key, m === 'finished' ? 'finished' : 'milestone', ep, d,
        m === 'finished' ? '' : m + '%', ctx));
      if (type === 'error') log_(ss, now, key, 'error', ep, d, clip_(d.error, 120), ctx);
      recomputeViewer_(ss, cur, key);
      break;
    }
    default:
      log_(ss, now, key, type || 'unknown', ep, d, '', ctx);
  }
  cur[at('last_seen')] = now;
  if (ctx.device) cur[at('device')] = ctx.device;
  V.getRange(vr.row, 1, 1, H.length).setValues([cur]);   // one write per event
  if (type !== 'progress') refreshSummary_(false);
}

/** Who is this? Email wins. Otherwise the Inro contact ID, which Inro puts in the link as ?c= */
function findOrCreateViewer_(V, ctx, now) {
  const H = viewerHeaders_();
  const col = (n) => H.indexOf(n) + 1;
  let row = 0;
  if (ctx.email) row = findRow_(V, col('email'), ctx.email);
  if (!row && ctx.inro) row = findRow_(V, col('inro_id'), ctx.inro);
  if (!row && !ctx.email && !ctx.inro) return null;

  if (!row) {
    const r = H.map(() => '');
    r[col('first_name') - 1] = ctx.first;
    r[col('email') - 1] = ctx.email;
    r[col('instagram') - 1] = ctx.handle;
    r[col('signed_up') - 1] = now;
    r[col('source') - 1] = ctx.source;
    r[col('pathway') - 1] = ctx.pathway || (ctx.inro ? 'instagram' : 'website');
    r[col('total_watch_min') - 1] = 0;
    r[col('episodes_finished') - 1] = 0;
    r[col('watched_all') - 1] = 'no';
    r[col('visits') - 1] = 0;
    r[col('tier') - 1] = 'Signed up only';
    r[col('link_clicks') - 1] = 0;
    r[col('inro_id') - 1] = ctx.inro;
    r[col('key') - 1] = ctx.email || 'inro:' + ctx.inro;
    V.appendRow(r);
    return { row: V.getLastRow(), key: r[col('key') - 1], values: r };
  }

  // Known person: fill in anything we learn later (an Inro viewer who gives an email, a first name, a handle).
  const cur = V.getRange(row, 1, 1, H.length).getValues()[0];
  const fill = (name, val) => { if (val && !cur[col(name) - 1]) cur[col(name) - 1] = val; };
  fill('first_name', ctx.first);
  fill('email', ctx.email);
  fill('instagram', ctx.handle);
  fill('inro_id', ctx.inro);
  if (ctx.pathway && !cur[col('pathway') - 1]) fill('pathway', ctx.pathway);
  let key = cur[col('key') - 1];
  if (ctx.email && String(key).indexOf('inro:') === 0) {
    // They were known only by Inro ID; from now on the email is their key. Move their watch rows over.
    rekeyWatch_(SpreadsheetApp.getActive(), key, ctx.email);
    key = ctx.email;
    cur[col('key') - 1] = key;
  }
  return { row: row, key: key, values: cur };
}

/** Running totals for one person, one episode, one visit. Returns milestones crossed by this update. */
function upsertWatch_(ss, viewer, d, ep, ctx, now) {
  const W = sheet_(ss, T.WATCH, WATCH_HEADERS);
  const key = [viewer, d.video_id, ctx.session].join('|');
  const watched = num_(d.watched), uniq = num_(d.unique), furthest = num_(d.furthest), len = num_(d.duration);
  const row = findRow_(W, 1, key);
  let prev = null;
  if (row) prev = W.getRange(row, 1, 1, WATCH_HEADERS.length).getValues()[0];

  const w = Math.max(prev ? num_(prev[7]) : 0, watched);           // never go backwards
  const u = Math.max(prev ? num_(prev[8]) : 0, uniq);
  const f = Math.max(prev ? num_(prev[9]) : 0, furthest);
  const L = len || (prev ? num_(prev[10]) : 0);
  const cov = L ? Math.min(1, u / L) : 0;
  const wasDone = prev ? prev[12] === 'yes' : false;
  const done = wasDone || cov >= FINISHED_AT;          // skipping to the end doesn't count as finishing
  const prevM = prev ? num_(prev[13]) : 0;
  const m = MILESTONES.filter((x) => cov * 100 >= x).pop() || 0;
  const best = Math.max(prevM, m);

  const crossed = MILESTONES.filter((x) => x > prevM && x <= m).map(String);
  if (done && !wasDone) crossed.push('finished');

  const vals = [key, viewer, clip_(d.video_id, 30), ep ? ep.name : clip_(d.video_title, 80), ctx.session,
    prev ? prev[5] : now, now, Math.round(w), Math.round(u), Math.round(f), Math.round(L),
    Math.round(cov * 1000) / 1000, done ? 'yes' : 'no', best, ctx.device];
  if (row) W.getRange(row, 1, 1, vals.length).setValues([vals]);
  else W.appendRow(vals);
  return crossed;
}

/** Rebuild one person's episode columns, totals and tier from their Watch rows (in memory). */
function recomputeViewer_(ss, cur, key) {
  const H = viewerHeaders_();
  const at = (n) => H.indexOf(n);
  const rows = data_(ss, T.WATCH).filter((r) => r[1] === key);
  let total = 0, finished = 0, startedAny = false;
  EPISODES.forEach((e, i) => {
    const mine = rows.filter((r) => String(r[2]) === e.id);
    const secs = mine.reduce((a, r) => a + num_(r[7]), 0);
    const cov = mine.reduce((a, r) => Math.max(a, num_(r[11])), 0);
    if (mine.some((r) => r[12] === 'yes')) finished++;
    total += secs;
    if (secs > 0) startedAny = true;
    cur[VIEWER_BASE.length + i * 2] = Math.round(secs / 6) / 10;
    cur[VIEWER_BASE.length + i * 2 + 1] = cov;
  });
  const all = finished === EPISODES.length;
  cur[at('total_watch_min')] = Math.round(total / 6) / 10;
  cur[at('episodes_finished')] = finished;
  cur[at('watched_all')] = all ? 'yes' : 'no';
  cur[at('tier')] = all ? 'Superfan' : finished >= 1 ? 'Engaged' : startedAny ? 'Sampler' : 'Signed up only';
}

// ---------------------------------------------------------------- Episodes tab and ranking

function refreshSummary_(force) {
  const cache = CacheService.getScriptCache();
  if (!force && cache.get('srd_refreshed')) return;
  cache.put('srd_refreshed', '1', 60);                    // at most once a minute while events stream in

  const ss = SpreadsheetApp.getActive();
  const W = data_(ss, T.WATCH), L = data_(ss, T.LOG), V = data_(ss, T.VIEWERS);
  const H = viewerHeaders_();
  const vcol = (n) => H.indexOf(n);
  const real = (k) => String(k).indexOf('selftest-') === -1;   // self-test rows never count
  const viewers = V.filter((r) => r[vcol('key')] && real(r[vcol('key')]));
  const watch = W.filter((r) => real(r[1]));
  const log = L.filter((r) => real(r[1]));

  const firstEp = {};
  viewers.forEach((r) => { const f = r[vcol('first_episode')]; if (f) firstEp[f] = (firstEp[f] || 0) + 1; });

  const rows = [['Episode', 'Video ID', 'Viewers started', 'Viewers finished', 'Completion rate',
    'Avg watch (min)', 'Avg % watched', 'Reached 25%', 'Reached 50%', 'Reached 75%',
    'Median stop point (non-finishers)', 'Total minutes', 'Watched first']];
  EPISODES.forEach((e) => {
    const per = {};                                         // per viewer: secs, best coverage, finished
    watch.filter((r) => String(r[2]) === e.id).forEach((r) => {
      const p = per[r[1]] || (per[r[1]] = { s: 0, c: 0, f: false });
      p.s += num_(r[7]); p.c = Math.max(p.c, num_(r[11])); p.f = p.f || r[12] === 'yes';
    });
    const list = Object.keys(per).map((k) => per[k]).filter((p) => p.s > 0);
    const n = list.length, fin = list.filter((p) => p.f).length;
    const sum = list.reduce((a, p) => a + p.s, 0);
    const reach = (x) => list.filter((p) => p.c * 100 >= x).length;
    const stops = list.filter((p) => !p.f).map((p) => p.c).sort((a, b) => a - b);
    const median = stops.length ? stops[Math.floor(stops.length / 2)] : '';
    rows.push([e.name, e.id, n, fin, n ? fin / n : '', n ? Math.round(sum / n / 6) / 10 : '',
      n ? list.reduce((a, p) => a + p.c, 0) / n : '', reach(25), reach(50), reach(75), median,
      Math.round(sum / 6) / 10, firstEp[e.name] || 0]);
  });

  // Summary block
  const sessions = (pred) => Object.keys(log.filter(pred).reduce((o, r) => { o[r[10]] = 1; return o; }, {})).length;
  const gateViews = sessions((r) => r[2] === 'gate_view');
  const siteSignups = log.filter((r) => r[2] === 'signup' && r[7] === 'website').length;
  const visitSessions = sessions((r) => r[2] === 'visit');
  const playSessions = sessions((r) => r[2] === 'start');
  const visitsLog = log.filter((r) => r[2] === 'visit');
  const mobile = visitsLog.filter((r) => r[8] === 'mobile').length;
  const starts = log.filter((r) => r[2] === 'start');
  const tod = { 'Morning (5am–noon)': 0, 'Afternoon (noon–5pm)': 0, 'Evening (5–10pm)': 0, 'Night (10pm–5am)': 0 };
  starts.forEach((r) => {
    const h = num_(r[9]);
    const k = h >= 5 && h < 12 ? 'Morning (5am–noon)' : h >= 12 && h < 17 ? 'Afternoon (noon–5pm)' : h >= 17 && h < 22 ? 'Evening (5–10pm)' : 'Night (10pm–5am)';
    tod[k]++;
  });
  const bySource = {}, byPath = {}, tiers = {}, links = {};
  viewers.forEach((r) => {
    bySource[r[vcol('source')] || 'direct'] = (bySource[r[vcol('source')] || 'direct'] || 0) + 1;
    byPath[r[vcol('pathway')] || '?'] = (byPath[r[vcol('pathway')] || '?'] || 0) + 1;
    tiers[r[vcol('tier')]] = (tiers[r[vcol('tier')]] || 0) + 1;
  });
  log.filter((r) => r[2] === 'link_click').forEach((r) => { links[r[5]] = (links[r[5]] || 0) + 1; });

  const blank = () => rows.push(rows[0].map(() => ''));
  const line = (a, b) => { const r = rows[0].map(() => ''); r[0] = a; r[1] = b; rows.push(r); };
  blank(); line('SUMMARY', '');
  line('Viewers (people)', viewers.length);
  ['Superfan', 'Engaged', 'Sampler', 'Signed up only'].forEach((t) => line('  ' + t, tiers[t] || 0));
  line('Website gate shown (visits)', gateViews);
  line('Website signups', siteSignups);
  line('Gate conversion', gateViews ? siteSignups / gateViews : '');
  line('Unlocked visits', visitSessions);
  line('Visits that played something', playSessions);
  line('Play rate', visitSessions ? playSessions / visitSessions : '');
  line('Visits on mobile', visitsLog.length ? mobile / visitsLog.length : '');
  blank(); line('PLAYS BY TIME OF DAY (LA)', '');
  Object.keys(tod).forEach((k) => line('  ' + k, tod[k]));
  blank(); line('VIEWERS BY SOURCE', '');
  Object.keys(bySource).sort().forEach((k) => line('  ' + k, bySource[k]));
  blank(); line('VIEWERS BY PATHWAY', '');
  Object.keys(byPath).sort().forEach((k) => line('  ' + k, byPath[k]));
  blank(); line('LINK CLICKS', '');
  const lk = Object.keys(links);
  if (!lk.length) line('  (none yet)', '');
  lk.sort().forEach((k) => line('  ' + k, links[k]));
  line('', '');
  line('Updated', Utilities.formatDate(new Date(), TZ, 'MMM d, h:mm a'));

  const E = sheet_(ss, T.EPISODES, []);
  E.clear();
  E.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
  E.getRange(1, 1, 1, rows[0].length).setFontWeight('bold');
  E.setFrozenRows(1);
  const n = EPISODES.length;
  E.getRange(2, 5, n, 1).setNumberFormat('0%');
  E.getRange(2, 7, n, 1).setNumberFormat('0%');
  E.getRange(2, 11, n, 1).setNumberFormat('0%');
  E.getRange(2, 2, rows.length - 1, 1).setNumberFormat('0');
  E.setColumnWidth(1, 240);
  rows.forEach((r, i) => {
    if (/^(SUMMARY|PLAYS|VIEWERS BY|LINK CLICKS)/.test(String(r[0]))) E.getRange(i + 1, 1).setFontWeight('bold');
    if (/conversion|rate|mobile/i.test(String(r[0]))) E.getRange(i + 1, 2).setNumberFormat('0%');
  });

  // Rank Viewers by total watch time, most first.
  const Vs = ss.getSheetByName(T.VIEWERS);
  if (Vs.getLastRow() > 2) {
    Vs.getRange(2, 1, Vs.getLastRow() - 1, H.length).sort({ column: vcol('total_watch_min') + 1, ascending: false });
  }
}

function formatViewers_(V) {
  const H = viewerHeaders_();
  const col = (n) => H.indexOf(n) + 1;
  V.setFrozenRows(1);
  V.setFrozenColumns(2);
  const rows = V.getMaxRows() - 1;
  V.getRange(2, col('signed_up'), rows, 1).setNumberFormat('MMM d, yyyy h:mm am/pm');
  V.getRange(2, col('last_seen'), rows, 1).setNumberFormat('MMM d, yyyy h:mm am/pm');
  EPISODES.forEach((e, i) => {
    V.getRange(2, VIEWER_BASE.length + 2 + i * 2, rows, 1).setNumberFormat('0%');
  });
  const tierRange = V.getRange(2, col('tier'), rows, 1);
  const rules = V.getConditionalFormatRules().filter((r) => r.getRanges()[0].getColumn() !== col('tier'));
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('Superfan')
    .setBackground('#fdf990').setBold(true).setRanges([tierRange]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('Engaged')
    .setBackground('#fefccb').setRanges([tierRange]).build());
  V.setConditionalFormatRules(rules);
}

// ---------------------------------------------------------------- self-test

function selftestReport_(id) {
  const ss = SpreadsheetApp.getActive();
  const H = viewerHeaders_();
  const viewers = data_(ss, T.VIEWERS).filter((r) => String(r[H.indexOf('key')]).indexOf(id) !== -1 ||
    String(r[H.indexOf('inro_id')]) === id);
  const viewer = viewers.length ? H.reduce((o, h, i) => { o[h] = viewers[0][i]; return o; }, {}) : null;
  const keys = viewers.map((r) => String(r[H.indexOf('key')]));
  const watch = data_(ss, T.WATCH).filter((r) => keys.indexOf(String(r[1])) !== -1)
    .map((r) => ({ episode: r[3], video_id: String(r[2]), seconds_watched: r[7], unique_seconds: r[8], coverage: r[11], finished: r[12] }));
  const events = {};
  data_(ss, T.LOG).filter((r) => keys.indexOf(String(r[1])) !== -1 || String(r[1]).indexOf(id) !== -1)
    .forEach((r) => { events[r[2]] = (events[r[2]] || 0) + 1; });
  return { id: id, found: !!viewer, viewer: viewer, watch: watch, events: events, version: VERSION };
}

function deleteSelftestRows() {
  const ss = SpreadsheetApp.getActive();
  [T.VIEWERS, T.WATCH, T.LOG].forEach((name) => {
    const sh = ss.getSheetByName(name);
    if (!sh || sh.getLastRow() < 2) return;
    const vals = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
    for (let i = vals.length - 1; i >= 0; i--) {
      if (vals[i].some((c) => String(c).indexOf('selftest-') !== -1)) sh.deleteRow(i + 2);
    }
  });
  refreshSummary_(true);
}

// ---------------------------------------------------------------- helpers

function log_(ss, now, viewer, event, ep, d, detail, ctx) {
  sheet_(ss, T.LOG, LOG_HEADERS).appendRow([now, viewer, event, ep ? ep.name : '', clip_(d.video_id, 30), detail,
    ctx.source, ctx.pathway || (ctx.inro ? 'instagram' : ctx.email ? 'website' : ''), ctx.device,
    Number(Utilities.formatDate(now, TZ, 'H')), ctx.session, ctx.page]);
}
function rekeyWatch_(ss, from, to) {
  const W = ss.getSheetByName(T.WATCH);
  if (!W || W.getLastRow() < 2) return;
  W.getRange(2, 2, W.getLastRow() - 1, 1).createTextFinder(from).matchEntireCell(true).replaceAllWith(to);
  W.getRange(2, 1, W.getLastRow() - 1, 1).createTextFinder(from + '|').replaceAllWith(to + '|');
}
function episodeOf_(id) {
  for (let i = 0; i < EPISODES.length; i++) if (EPISODES[i].id === String(id)) return EPISODES[i];
  return null;
}
function findRow_(sh, col, value) {
  if (!value || sh.getLastRow() < 2) return 0;
  const hit = sh.getRange(2, col, sh.getLastRow() - 1, 1).createTextFinder(String(value)).matchEntireCell(true).findNext();
  return hit ? hit.getRow() : 0;
}
function data_(ss, name) {
  const sh = ss.getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
}
function sheet_(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    if (headers.length) {
      sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
      sh.setFrozenRows(1);
    }
  }
  return sh;
}
function normEmail_(v) {
  const s = String(v || '').trim().toLowerCase().slice(0, 254);
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s) ? s : '';
}
function num_(v) { const n = Number(v); return isFinite(n) && n > 0 ? n : 0; }
function clip_(v, n) { return String(v == null ? '' : v).slice(0, n || 200); }
function text_(s) { return ContentService.createTextOutput(s); }
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
```

## Source: srd-selftest.mjs (acceptance test)

```js
#!/usr/bin/env node
/**
 * Skid Row Diaries · watch page acceptance test
 *
 *   node srd-selftest.mjs https://skidrowdiaries.com/watch
 *   node srd-selftest.mjs http://localhost:3000/watch          (Vimeo must allow localhost too, see the skill)
 *
 * Plays a few seconds of every episode as two fake viewers, then asks the Google Apps Script
 * whether those plays reached the sheet:
 *   A. Instagram viewer: arrives with ?c=selftest-<time> (an Inro contact ID), no form.
 *   B. Website viewer: arrives with nothing, sees the form, enters first name + email.
 * Exit code 0 = PASS. Test rows never count in the Episodes summary; remove them with
 * SRD > Delete self-test rows in the sheet.
 *
 * Needs Playwright (npm i -D playwright). Uses installed Google Chrome when it can, because
 * Playwright's own Chromium can't play Vimeo's H.264 video.
 */
import { chromium } from 'playwright';

const PAGE = process.argv[2];
const ENDPOINT = process.env.SRD_ENDPOINT ||
  'https://script.google.com/macros/s/AKfycbwLT8cMZgfye1NIlQX2oN-XOovgOFSzUnvX8DrCimFST18ggHnVrwaPtbpgqEePmPDX/exec';
const EPISODES = Number(process.env.SRD_EPISODES || 3);
const SECONDS = Number(process.env.SRD_SECONDS || 8);
if (!PAGE) { console.error('usage: node srd-selftest.mjs <watch page url>'); process.exit(2); }

const stamp = Date.now().toString(36);
const ID_A = `selftest-${stamp}a`;
const ID_B = `selftest-${stamp}b`;
const EMAIL_B = `${ID_B}@example.com`;
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  · ' + detail : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const withParams = (url, params) => { const u = new URL(url); Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v)); return u.toString(); };

async function getJSON(url) {
  const r = await fetch(url, { redirect: 'follow' });
  const t = await r.text();
  try { return JSON.parse(t); } catch { throw new Error(`not JSON from ${url}: ${t.slice(0, 120)}`); }
}

async function launch() {
  const args = ['--autoplay-policy=no-user-gesture-required'];
  try { return { browser: await chromium.launch({ channel: 'chrome', headless: true, args }), chrome: true }; }
  catch { return { browser: await chromium.launch({ headless: true, args }), chrome: false }; }
}

/** Play `SECONDS` of every tracked episode, muted, one after another. */
async function playAll(page, label) {
  const n = await page.evaluate(() => document.querySelectorAll('iframe[data-srd-video]').length);
  check(`${label}: page shows ${EPISODES} tracked Vimeo players`, n === EPISODES, `found ${n}`);
  for (let i = 0; i < n; i++) {
    await page.evaluate((i) => document.querySelectorAll('iframe[data-srd-video]')[i].scrollIntoView({ block: 'center' }), i);
    await page.waitForFunction((i) => window.SRD && SRD.players[i], i, { timeout: 15000 }).catch(() => {});
    const started = await page.evaluate(async (i) => {
      const t = SRD.players[i];
      if (!t) return 'no tracker attached';
      try { await t.player.ready(); await t.player.setMuted(true); await t.player.play(); return 'ok'; }
      catch (e) { return e.name || String(e); }
    }, i);
    let watched = 0;
    for (let s = 0; s < SECONDS + 12 && watched < SECONDS; s++) {
      await sleep(1000);
      watched = await page.evaluate((i) => (SRD.players[i] ? SRD.players[i].watched : 0), i);
    }
    await page.evaluate((i) => SRD.players[i] && SRD.players[i].player.pause(), i);
    check(`${label}: episode ${i + 1} plays and counts watch time`, watched >= SECONDS - 1,
      `${Math.round(watched)}s counted${started !== 'ok' ? ', play(): ' + started : ''}`);
  }
}

(async () => {
  console.log(`\nSRD watch page acceptance test\npage: ${PAGE}\ntest ids: ${ID_A}, ${ID_B}\n`);

  // 0. The sheet's web app is up and is the right version.
  try {
    const ping = await getJSON(ENDPOINT + '?ping=1');
    check('Sheet web app answers', ping.ok === true, `version ${ping.version}`);
    check('Sheet web app is version 4 or newer', ping.version >= 4);
  } catch (e) { check('Sheet web app answers', false, e.message); }

  const { browser, chrome } = await launch();
  if (!chrome) console.log('NOTE  Google Chrome not found; using Playwright Chromium, which may not play Vimeo video. Install Chrome if playback checks fail.\n');

  // A. Instagram viewer with an Inro link.
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(withParams(PAGE, { c: ID_A, u: 'selftest_bot', src: 'selftest', p: 'dm' }), { waitUntil: 'load' });
    await page.waitForFunction(() => window.SRD && SRD.version, null, { timeout: 15000 }).catch(() => {});
    const s = await page.evaluate(() => ({ v: window.SRD && SRD.version, known: window.SRD && SRD.isKnown(), url: location.href }));
    check('A: tracker loaded on the page', s.v >= 2, `SRD.version ${s.v}`);
    check('A: Inro link recognised, no form needed', s.known === true);
    check('A: identity removed from the address bar', !/[?&](c|u|p)=/.test(s.url), s.url);
    await playAll(page, 'A');
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    check('A: no JavaScript errors on the page', errors.length === 0, errors.slice(0, 2).join(' | '));
    await ctx.close();
  }

  // B. Website viewer: form first.
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(withParams(PAGE, { src: 'selftest' }), { waitUntil: 'load' });
    await page.waitForFunction(() => window.SRD && SRD.version, null, { timeout: 15000 }).catch(() => {});
    const locked = await page.evaluate(() => !SRD.isKnown() && document.querySelectorAll('iframe[data-srd-video]').length === 0);
    check('B: new visitor sees the form, episodes locked', locked);
    const email = page.locator('form input[type=email]').first();
    const first = page.locator('form input[autocomplete="given-name"], form input[name*="first" i]').first();
    try {
      await first.fill('Selftest');
      await email.fill(EMAIL_B);
      await email.press('Enter');
      await page.waitForFunction(() => SRD.isKnown() && document.querySelectorAll('iframe[data-srd-video]').length > 0, null, { timeout: 10000 });
      check('B: first name + email unlocks the episodes instantly', true);
      await playAll(page, 'B');
    } catch (e) {
      check('B: first name + email unlocks the episodes instantly', false, e.message.split('\n')[0]);
    }
    await ctx.close();
  }
  await browser.close();

  // C. Did it reach the sheet?
  console.log('\nWaiting for the sheet…');
  const want = Math.min(EPISODES, 3);
  for (const [label, id, needName] of [['A', ID_A, false], ['B', ID_B, true]]) {
    let rep = null;
    for (let i = 0; i < 12; i++) {
      await sleep(5000);
      try { rep = await getJSON(`${ENDPOINT}?selftest=${encodeURIComponent(id)}`); } catch { rep = null; }
      if (rep && rep.found && rep.watch.filter((w) => w.seconds_watched > 0).length >= want) break;
    }
    check(`${label}: viewer row in the sheet`, rep && rep.found);
    if (!rep || !rep.found) continue;
    const played = rep.watch.filter((w) => w.seconds_watched > 0);
    check(`${label}: watch time recorded for every episode`, played.length >= want,
      played.map((w) => `${w.episode} ${w.seconds_watched}s`).join(', '));
    check(`${label}: visit and starts logged`, (rep.events.visit || 0) >= 1 && (rep.events.start || 0) >= want,
      JSON.stringify(rep.events));
    if (needName) {
      check('B: first name and email saved', rep.viewer.first_name === 'Selftest' && rep.viewer.email === EMAIL_B);
      check('B: pathway recorded as website', rep.viewer.pathway === 'website', rep.viewer.pathway);
    } else {
      check('A: Instagram handle and source saved', rep.viewer.instagram === 'selftest_bot' && rep.viewer.source === 'selftest');
    }
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${failed.length ? 'FAIL' : 'PASS'}: ${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length) console.log('See "If the test fails" in the SRD watch-tracking skill.');
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
```
