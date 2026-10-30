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

Ship `srd-tracker.js` (pinned under Sources) **verbatim** as a static file, e.g. `public/srd-tracker.js`, and load it on every page of the site (it is ~10 KB, has no dependencies, does nothing until called, and loads Vimeo's `player.js` itself when the first player is attached).

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

The full script is pinned under Sources (repo path `apps-script/Code.gs`). To change it: Extensions › Apps Script in the sheet, replace the file, save, run `setup` if columns or episodes changed, then **Deploy › Manage deployments › pencil › Version: New version › Deploy**. Saving alone does not change the live endpoint; the web app runs the last deployed version. Bump `VERSION` and update the acceptance test's minimum version if behaviour changes.

## Acceptance test (run it; don't skip it)

`srd-selftest.mjs` (pinned under Sources) plays a few seconds of every episode as two fake viewers, one arriving from an Inro link and one using the form, then asks the sheet what it received. It passes only if every play reached the sheet with the right person, episode, watch time, source and pathway.

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

## Sources (exact files, pinned)

Fetch these exact versions. Don't retype them. Check the hash after downloading.

| File | URL | sha256 |
|---|---|---|
| `srd-tracker.js` (ship verbatim as `/srd-tracker.js`) | https://raw.githubusercontent.com/skidrowdiaries/SRD-100k/d6431b266ed4a2e90bda0ddc691449bb97bc966f/srd-tracker.js | `8fa875aeb3ff84afc22268cd7547d29234899f01eb828bb1f0ad0004f52ef830` |
| `srd-selftest.mjs` (acceptance test) | https://raw.githubusercontent.com/skidrowdiaries/SRD-100k/d6431b266ed4a2e90bda0ddc691449bb97bc966f/tools/srd-selftest.mjs | `6d0d34f9a79986244969b994f83831ca25b6d5990ef35e50ef6d5d15a5b2c849` |
| `Code.gs` (record of the deployed Apps Script, version 4) | https://raw.githubusercontent.com/skidrowdiaries/SRD-100k/d6431b266ed4a2e90bda0ddc691449bb97bc966f/apps-script/Code.gs | `4c7607507ac92bbe85630aa106ebe785608f2f89a71c9a85f4d0c11f592b4ec4` |
| Reference page (plain HTML using all of the above) | https://raw.githubusercontent.com/skidrowdiaries/SRD-100k/d6431b266ed4a2e90bda0ddc691449bb97bc966f/index.html and https://raw.githubusercontent.com/skidrowdiaries/SRD-100k/d6431b266ed4a2e90bda0ddc691449bb97bc966f/app.js | |

```bash
curl -fsSLo public/srd-tracker.js https://raw.githubusercontent.com/skidrowdiaries/SRD-100k/d6431b266ed4a2e90bda0ddc691449bb97bc966f/srd-tracker.js
curl -fsSLo scripts/srd-selftest.mjs https://raw.githubusercontent.com/skidrowdiaries/SRD-100k/d6431b266ed4a2e90bda0ddc691449bb97bc966f/tools/srd-selftest.mjs
shasum -a 256 public/srd-tracker.js scripts/srd-selftest.mjs
```

If GitHub isn't reachable from the session, ask Patrick for the self-contained copy of this skill (`SKILL.md` in the repo's `docs/` folder), which has all three files inline.
