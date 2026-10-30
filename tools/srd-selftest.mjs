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
