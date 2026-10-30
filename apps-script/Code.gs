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

const VERSION = 3;
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
