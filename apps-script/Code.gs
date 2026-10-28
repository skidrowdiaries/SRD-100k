/**
 * Skid Row Diaries · viewer log
 * Receives events from the watch page and keeps one row per viewer, per video, per visit.
 *
 * Setup (once):
 *   1. In the Google Sheet: Extensions > Apps Script. Replace everything with this file. Save.
 *   2. Run `setup` once from the toolbar and approve access to this one spreadsheet.
 *   3. Deploy > New deployment > type: Web app.
 *        Execute as: Me.   Who has access: Anyone.
 *   4. Copy the web app URL (ends in /exec) and send it to Claude.
 */

const VIEWS = 'views';
const SIGNUPS = 'signups';
const LEADERBOARD = 'loyal viewers';

const VIEW_HEADERS = ['key', 'first_seen', 'last_seen', 'email', 'video', 'title', 'session',
  'seconds_watched', 'furthest_point', 'video_length', 'percent_watched', 'finished', 'device'];
const SIGNUP_HEADERS = ['time', 'email', 'type', 'session', 'device', 'page'];

function setup() {
  const ss = SpreadsheetApp.getActive();
  sheet_(ss, VIEWS, VIEW_HEADERS);
  sheet_(ss, SIGNUPS, SIGNUP_HEADERS);
  // Loyal viewers: total minutes and videos per person, most engaged first.
  const lb = sheet_(ss, LEADERBOARD, []);
  lb.clear();
  lb.getRange('A1').setFormula(
    "=QUERY(views!D2:L, \"select D, sum(H)/60, count(E), sum(L) where D is not null " +
    "group by D order by sum(H) desc label D 'email', sum(H)/60 'minutes_watched', " +
    "count(E) 'video_visits', sum(L) 'videos_finished'\", 0)");
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const d = JSON.parse(e.postData.contents);
    const email = String(d.email || '').trim().toLowerCase().slice(0, 254);
    if (!email) return ok_();
    const ss = SpreadsheetApp.getActive();

    if (d.type === 'signup' || d.type === 'visit') {
      sheet_(ss, SIGNUPS, SIGNUP_HEADERS).appendRow(
        [new Date(), email, d.type, clip_(d.session), clip_(d.device), clip_(d.page)]);
      return ok_();
    }

    if (!d.video_id) return ok_();
    const sh = sheet_(ss, VIEWS, VIEW_HEADERS);
    const key = [email, d.video_id, d.session].join('|');
    const watched = Math.max(0, Number(d.watched) || 0);
    const furthest = Math.max(0, Number(d.furthest) || 0);
    const length = Math.max(0, Number(d.duration) || 0);
    const now = new Date();

    const hit = sh.getRange('A:A').createTextFinder(key).matchEntireCell(true).findNext();
    if (hit) {
      const r = hit.getRow();
      const row = sh.getRange(r, 1, 1, VIEW_HEADERS.length).getValues()[0];
      const w = Math.max(Number(row[7]) || 0, watched);       // never go backwards
      const f = Math.max(Number(row[8]) || 0, furthest);
      const len = length || Number(row[9]) || 0;
      const done = row[11] === 1 || d.type === 'complete' ? 1 : 0;
      sh.getRange(r, 3).setValue(now);
      sh.getRange(r, 8, 1, 5).setValues([[w, f, len, len ? Math.min(1, w / len) : '', done]]);
    } else {
      sh.appendRow([key, now, now, email, clip_(d.video_id), clip_(d.video_title), clip_(d.session),
        watched, furthest, length, length ? Math.min(1, watched / length) : '',
        d.type === 'complete' ? 1 : 0, clip_(d.device)]);
    }
    return ok_();
  } catch (err) {
    console.error(err);
    return ok_();
  } finally {
    lock.releaseLock();
  }
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
function clip_(v) { return String(v == null ? '' : v).slice(0, 200); }
function ok_() { return ContentService.createTextOutput('ok'); }
