import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, STALE_AFTER_HOURS, BRAND_NAME, SUBTITLE } from './config.js?v=16';
import {
  TZ, CATS, CAT_KEYS, KINDS, classifyAll, summarize, buildLetter, worth, gaps, weekStart, addDays, daysBetween, vsTarget, targetSentence,
  todayLocal, weekLabel, shortDate, weekdayName, counts,
} from './logic.js?v=16';
import { analyze, nextSteps, questions, monthName } from './plan.js?v=16';
import * as Auth from './auth.js?v=16';
import { makeDemo, demoWrite, DEMO_WORDS } from './demo.js?v=16';

// ---------------------------------------------------------------- state
const CACHE = 'ours.cache.v1';
const KEYSTORE = 'ours.key';        // the private link key: only used to set up Face ID, never to read data
const ENROLLED = 'ours.enrolled';   // non-secret flag: this browser has set up Face ID before
const LOCK_AFTER_MS = 5 * 60e3;     // relock after this long in the background
const PAGES = [
  ['week', 'Week'], ['spend', 'Spend'], ['worth', 'Worth'], ['activity', 'Activity'], ['history', 'History'], ['plan', 'Plan'],
];
const S = {
  linkKey: null, session: null, sessionExp: 0, via: 'passkey', backup: null, newCodes: null, backupNote: false, lockMode: 'unlock', lockMsg: '', lockBusy: false, devices: null, hiddenAt: 0,
  page: 'week', data: null, rows: [], busy: false, fromCache: false, loadError: null,
  spendPeriod: 'this', openCat: null, actFilter: 'all', actLimit: 80, editing: null, draftShape: 'car',
  demo: false, demoSeed: 1, wantTour: false, tourOn: null, tourCheck: '',
};
// Wording that names our own investing account. The tour swaps in its made-up equivalents.
const REAL_WORDS = {
  invInto: 'into Bitcoin (River). Not spending.', invStory: 'Bitcoin', invBuys: 'Bitcoin buys',
  invBuysMid: 'Bitcoin buys',
  invHow: 'Bitcoin buys through River. Counted once, from the bank side. Not spending.',
  invInside: 'Bitcoin is counted once, inside the River account balance.', holdNote: 'Counted once, as part of the River Bitcoin account balance.',
  incomeNote: 'including family Venmo, which may be paybacks',
};
const W = () => (S.demo ? DEMO_WORDS : REAL_WORDS);
const isOpen = () => !!S.session || S.demo;

// ---------------------------------------------------------------- utils
const $ = (s, el = document) => el.querySelector(s);
const CHEV = '<svg class="chev" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5"/></svg>';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const m0 = (n) => (n < -0.004 ? '−' : '') + '$' + Math.round(Math.abs(n)).toLocaleString('en-US');
const m2 = (n) => (n < -0.004 ? '−' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signed = (n) => (n > 0.004 ? '+' : n < -0.004 ? '−' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const bigMoney = (n) => {
  const neg = n < 0; const v = Math.round(Math.abs(n));
  return `${neg ? '−' : ''}$${v.toLocaleString('en-US')}`;
};
const fmtStamp = (iso, withTime = true) => {
  const d = new Date(iso);
  const opts = { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric' };
  if (withTime) Object.assign(opts, { hour: 'numeric', minute: '2-digit' });
  return d.toLocaleString('en-US', opts);
};
const hoursOld = (iso) => (Date.now() - new Date(iso).getTime()) / 36e5;
let toastTimer;
function toast(msg, ms = 4200) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

// ---------------------------------------------------------------- icons
const I = {
  week: '<path d="M4 7.5 12 13l8-5.5M5 5h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z"/>',
  spend: '<path d="M12 3a9 9 0 1 0 9 9h-9V3Z"/><path d="M15 3.5A9 9 0 0 1 20.5 9H15V3.5Z"/>',
  worth: '<path d="M3.5 11 12 4l8.5 7M6 9.5V20h12V9.5"/><path d="M10 20v-5h4v5"/>',
  activity: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  history: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  plan: '<circle cx="12" cy="12" r="8.5"/><path d="m15.5 8.5-2 5-5 2 2-5 5-2Z"/>',
  car: '<path d="M5 16v2M19 16v2M3.5 13.5 5.2 8.6A2 2 0 0 1 7.1 7.2h9.8a2 2 0 0 1 1.9 1.4l1.7 4.9M3 16h18v-2.5H3V16Z"/><circle cx="7" cy="14.5" r=".5"/><circle cx="17" cy="14.5" r=".5"/>',
  home: '<path d="M3.5 11 12 4l8.5 7M6 9.5V20h12V9.5"/><path d="M10 20v-5h4v5"/>',
  bike: '<circle cx="6" cy="16" r="3.5"/><circle cx="18" cy="16" r="3.5"/><path d="M6 16 9.5 9h6L18 16M9.5 9 12 16h-1M14 6h2.5l-1 3"/>',
  other: '<path d="M4 8.5 12 4l8 4.5v7L12 20l-8-4.5v-7Z"/><path d="M4 8.5 12 13l8-4.5M12 13v7"/>',
  loan: '<path d="M4 7h16v11H4zM4 11h16"/><path d="M8 15h3"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4Z"/>',
  trash: '<path d="M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13"/>',
  chev: '<path d="m9 6 6 6-6 6"/>',
};
const icon = (name, size = 22) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[name]}</svg>`;
const SHAPES = { car: 'Car', home: 'Home', bike: 'Bike', other: 'Other', loan: 'Loan' };

// ---------------------------------------------------------------- key + routing
function readHash() {
  const h = new URLSearchParams(location.hash.replace(/^#/, ''));
  return { k: h.get('k'), p: h.get('p'), tour: h.has('tour') };
}
function writeHash(replace = false) {
  const h = new URLSearchParams();
  if (S.page !== 'week') h.set('p', S.page);
  const tour = S.demo || S.wantTour;   // the tour link is just #tour: it never carries a key
  const url = `${location.pathname}${location.search}#${tour ? 'tour' : ''}${tour && h.toString() ? '&' : ''}${h.toString()}`;
  if (replace) history.replaceState(null, '', url); else history.pushState(null, '', url);
}
function initKey() {
  const { k, p, tour } = readHash();
  S.wantTour = tour && !k;
  // The link key only sets up Face ID. Hold it until setup succeeds, and take it out of the address bar.
  if (k) { S.linkKey = k; try { localStorage.setItem(KEYSTORE, k); } catch {} }
  else { try { S.linkKey = localStorage.getItem(KEYSTORE); } catch {} }
  if (p && PAGES.some(([id]) => id === p)) S.page = p;
  writeHash(true);
  try { localStorage.removeItem(CACHE); } catch {} // older versions kept a plain copy of the data here
  S.lockMode = S.linkKey && !enrolledHere() ? 'setup' : 'unlock';
}
function enrolledHere() { try { return !!localStorage.getItem(ENROLLED); } catch { return false; } }

// ---------------------------------------------------------------- face id lock
let expTimer = null;
function startSession(res) {
  S.session = res.session; S.sessionExp = Date.parse(res.expires_at) || Date.now() + 12 * 3600e3;
  S.lockMsg = ''; S.lockBusy = false; S.devices = null; S.hiddenAt = 0;
  S.via = res.via === 'backup' ? 'backup' : 'passkey'; S.backupNote = S.via === 'backup';
  if (res.backup) S.backup = res.backup;
  if (res.backup_codes && res.backup_codes.length) S.newCodes = { codes: res.backup_codes, made: new Date().toISOString(), first: true };
  if (S.via === 'passkey') try { localStorage.setItem(ENROLLED, '1'); } catch {}
  clearTimeout(expTimer);
  expTimer = setTimeout(() => lockNow('Signed out after 12 hours. Unlock again to keep going.', { revoke: false }), Math.min(Math.max(S.sessionExp - Date.now(), 1000), 2 ** 31 - 1));
  S.lastLoad = Date.now(); load();
}
function lockNow(msg = '', { revoke = true } = {}) {
  const tok = S.session;
  S.session = null; S.sessionExp = 0; S.data = null; S.rows = []; S.devices = null; S.editing = null; S.loadError = null;
  S.via = 'passkey'; S.backup = null; S.newCodes = null; S.backupNote = false;
  planMemo = { rows: null, items: null, facts: null, out: null };
  clearTimeout(expTimer); clearTimeout(pollTimer); closeSheet();
  S.lockMode = 'unlock'; S.lockMsg = msg; S.lockBusy = false; S.lockHint = '';
  if (revoke && tok) Auth.call('logout', { session: tok }).catch(() => {});
  render(); window.scrollTo({ top: 0 });
}
function sessionLive() { return !!S.session && Date.now() < S.sessionExp; }
// Automatic Face ID on the lock screen: once on open, and once each time Ours comes back into view while locked
// (including the 5-minute relock). Never while a prompt is up, never right after one ended (a cancel), and never on
// the setup or backup-code screens. A tap on the button always works and takes over from a waiting automatic try.
const AUTO = { armed: false, ctrl: null, lastEnd: 0, hiddenAt: 0, hiddenDuringPrompt: false };
const AUTO_QUIET_MS = 2000;
function armAuto() { AUTO.armed = true; }
function maybeAutoUnlock() {
  if (!AUTO.armed || S.session || S.demo || S.wantTour || S.lockMode !== 'unlock' || !enrolledHere()) return;
  if (AUTO.ctrl || S.lockBusy || document.visibilityState !== 'visible') return;
  if (Date.now() - AUTO.lastEnd < AUTO_QUIET_MS) return;
  AUTO.armed = false; // one automatic try per lock event
  doUnlock({ auto: true });
}
async function doUnlock({ auto = false } = {}) {
  if (S.lockBusy) return;
  if (auto && AUTO.ctrl) return;
  if (!auto && AUTO.ctrl) { const c = AUTO.ctrl; AUTO.ctrl = null; c.abort(); } // the tap takes over
  const ctrl = new AbortController();
  if (auto) AUTO.ctrl = ctrl; else { S.lockBusy = true; S.lockMsg = ''; }
  S.lockHint = auto ? 'Looking for Face ID…' : '';
  render();
  // If the browser neither shows Face ID nor says no, don't sit on "Looking…": point at the button.
  if (auto) setTimeout(() => { if (AUTO.ctrl === ctrl && !S.session && S.lockHint === 'Looking for Face ID…') { S.lockHint = 'Tap to unlock with Face ID'; render(); } }, 6000);
  try {
    const res = await Auth.unlock({ signal: ctrl.signal });
    if (auto && AUTO.ctrl !== ctrl) return;
    if (auto) AUTO.ctrl = null;
    S.lockBusy = false; AUTO.lastEnd = Date.now(); S.lockHint = '';
    startSession(res);
  } catch (e) {
    if (auto && AUTO.ctrl !== ctrl) return; // a tap took over; it reports for itself
    if (auto) AUTO.ctrl = null; else S.lockBusy = false;
    AUTO.lastEnd = Date.now();
    if (S.session) return;
    if (auto && (e.code === 'cancelled' || e.code === 'aborted')) S.lockHint = 'Tap to unlock with Face ID'; // e.g. Safari wanted a tap: stay calm
    else if (e.code === 'unknown_device') { S.lockHint = ''; S.lockMode = 'setup'; S.lockMsg = "This device's Face ID isn't set up for Ours yet, or it was removed. Set it up below."; }
    else { S.lockHint = auto ? 'Tap to unlock with Face ID' : ''; S.lockMsg = e.message; }
    render();
  }
}
const clock = (iso) => new Date(iso).toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
async function doBackup(form) {
  if (S.lockBusy) return;
  const code = String(form.code.value || '').trim();
  if (!code) { S.lockMsg = 'Type one of your backup codes, like ABCDE-23456.'; return render(); }
  S.lockBusy = true; S.lockMsg = ''; render();
  try {
    const res = await Auth.backupUnlock(code);
    startSession(res);
    const n = res.backup ? res.backup.remaining : null;
    toast(n === null ? 'Opened with a backup code.' : `Opened with a backup code. ${n} ${n === 1 ? 'code' : 'codes'} left.`, 5000);
  } catch (e) {
    S.lockBusy = false;
    S.lockMsg = e.code === 'too_many' && e.data && e.data.retry_at ? `${e.message} Try again after ${clock(e.data.retry_at)}.` : e.message;
    render(); const f = $('#backup-code'); if (f) { f.value = code; }
  }
}
function openReenroll() {
  openSheet(`<h3>Set up Face ID on this device</h3>
    <p>So next time Ours opens with Face ID instead of a backup code.</p>
    <form id="reenroll-form" class="form" autocomplete="off">
      <div class="field"><label for="reenroll-name">Name this device</label><input id="reenroll-name" name="name" maxlength="40" required autocomplete="off" placeholder="${esc(exampleDevice())}"></div>
      <div class="btns"><button class="btn" type="submit">${FACE}<span>Set up Face ID</span></button><button type="button" class="btn ghost" data-close>Not now</button></div>
    </form>`, () => {});
  const f = $('#reenroll-name'); if (f) f.focus();
}
async function doReenroll(form) {
  const name = form.name.value.trim().replace(/\s+/g, ' ');
  if (!name) return toast(`Give this device a name, like ${exampleDevice()}.`);
  const btn = form.querySelector('button[type=submit]'); btn.disabled = true;
  try {
    const old = S.session;
    const res = await Auth.enroll(name, { session: old, oldSession: old });
    closeSheet(); startSession(res);
    toast(`Face ID is set up on ${res.device ? res.device.name : 'this device'}.`);
  } catch (e) {
    btn.disabled = false;
    if (e.code === 'locked') return lockNow('Your sign-in ended. Unlock again to keep going.', { revoke: false });
    toast(e.message || "Couldn't set up Face ID. Try again.", 6000);
  }
}
// A neutral example name for the device being set up (no personal names on the public site).
function exampleDevice() {
  const ua = navigator.userAgent || '';
  if (/iPhone/.test(ua)) return 'My iPhone';
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'My iPad';
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'My phone' : 'My tablet';
  if (/Macintosh|Windows|Linux|CrOS/.test(ua)) return 'My computer';
  return 'My iPhone';
}
function parseSetupCode(v) {
  v = String(v || '').trim(); if (!v) return {};
  const m = v.match(/[#&]k=([^&\s]+)/); if (m) return { key: decodeURIComponent(m[1]) };
  if (/^[A-Za-z0-9]{4}[-\s]?[A-Za-z0-9]{4}$/.test(v)) return { invite: v.toUpperCase().replace(/\s/, '-').replace(/^(.{4})(?!-)/, '$1-') };
  return { key: v };
}
async function doEnroll(form) {
  if (S.lockBusy) return;
  const name = form.name.value.trim().replace(/\s+/g, ' ');
  if (!name) { S.lockMsg = `Give this device a name, like ${exampleDevice()}.`; return render(); }
  const typed = form.code ? parseSetupCode(form.code.value) : {};
  const secret = typed.key || typed.invite ? typed : { key: S.linkKey };
  if (!secret.key && !secret.invite) { S.lockMsg = 'Open Ours from our private link, or type a setup code from a device that is already unlocked.'; return render(); }
  S.lockBusy = true; S.lockMsg = ''; S.draftDevice = name; render();
  try {
    const res = await Auth.enroll(name, secret);
    S.linkKey = null; S.needCode = false; S.draftDevice = '';
    try { localStorage.removeItem(KEYSTORE); } catch {}
    startSession(res);
    toast(`Face ID is set up on ${res.device ? res.device.name : 'this device'}.`);
  } catch (e) {
    S.lockBusy = false;
    if (e.code === 'link_closed') { S.needCode = true; S.lockMsg = e.message || 'Our private link has already set up two devices. On a device that is already unlocked, open Worth, then Devices, then Add a device, and type that code here.'; }
    else if (e.code === 'bad_key' || e.code === 'bad_invite' || e.code === 'no_key') { S.needCode = true; S.lockMsg = e.message; }
    else S.lockMsg = e.message;
    render();
  }
}

// ---------------------------------------------------------------- api
async function rpc(fn, body, timeoutMs = 15000) {
  // In the tour every write is answered here, in memory. Nothing is sent anywhere.
  if (S.demo) return demoWrite(S.data, fn, body);
  if (!sessionLive()) { const err = new Error('locked'); if (S.session) lockNow('Signed out after 12 hours. Unlock again to keep going.', { revoke: false }); throw err; }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST', signal: ctrl.signal, cache: 'no-store',
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_key: S.session, ...body }),
    });
    const text = await res.text();
    if (!res.ok) {
      const err = new Error(/"not allowed"/.test(text) ? 'locked' : `HTTP ${res.status}`);
      err.status = res.status; err.body = text; throw err;
    }
    return text ? JSON.parse(text) : null;
  } finally { clearTimeout(timer); }
}

// ---------------------------------------------------------------- data
function setData(d, { fromCache = false } = {}) {
  S.data = d; S.fromCache = fromCache;
  S.rows = d && d.snapshot ? classifyAll(d.snapshot.data, d.fixes || []) : [];
}
// No copy of our numbers is kept on the device: they live in memory only while unlocked.
function saveCache() {}

let pollTimer = null;
async function load({ manual = false } = {}) {
  if (S.demo) { if (manual) toast('This is the tour. Every number is made up, so there is nothing to pull.'); return; }
  if (S.busy) return;
  S.busy = true; S.loadError = null; renderStatus();
  const before = S.data && S.data.snapshot ? S.data.snapshot.id : null;
  try {
    if (manual) { try { await rpc('ours_request_refresh', {}); } catch (e) { if (e.message === 'locked') throw e; } }
    const d = await rpc('ours_load', {});
    setData(d); saveCache();
    if (manual) {
      const snap = d.snapshot;
      if (!snap) toast('No bank pull has been saved yet.');
      else if (snap.id !== before) toast(`New numbers from ${fmtStamp(snap.pulled_at)}.`);
      else toast(`No newer bank pull yet. Still ${fmtStamp(snap.pulled_at)}. A fresh pull has been requested.`, 6000);
    }
  } catch (e) {
    if (e.message === 'locked') { S.busy = false; if (S.session) lockNow('Your sign-in ended. Unlock again to keep going.', { revoke: false }); else render(); return; }
    S.loadError = e;
    if (S.data) toast(`Couldn't reach our notebook. Showing the last copy, from ${fmtStamp(S.data.snapshot ? S.data.snapshot.pulled_at : S.data.server_time, false)}.`, 6000);
  } finally {
    S.busy = false; render(); if (S.session) schedulePoll();
  }
}
// While a fresh pull is requested, quietly check every minute whether it landed (up to 15 minutes).
function schedulePoll() {
  clearTimeout(pollTimer);
  const req = S.data && S.data.open_request;
  if (!req || Date.now() - new Date(req.requested_at).getTime() > 15 * 60e3) return;
  pollTimer = setTimeout(async () => {
    try {
      const latest = await rpc('ours_latest', {});
      if (latest && S.data.snapshot && latest.id !== S.data.snapshot.id) { await load(); toast('Fresh numbers just landed.'); return; }
    } catch {}
    schedulePoll();
  }, 60e3);
}

// ---------------------------------------------------------------- shell
function renderNav() {
  const links = PAGES.map(([id, label]) => `<a href="#" data-page="${id}" ${S.page === id ? 'aria-current="page"' : ''}>${label}</a>`).join('');
  $('.nav-top').innerHTML = links;
  $('.nav-bottom').innerHTML = PAGES.map(([id, label]) => `<a href="#" data-page="${id}" ${S.page === id ? 'aria-current="page"' : ''}>${icon(id)}<span>${label}</span></a>`).join('');
}
function renderStatus() {
  const el = $('#status-text'); const btn = $('#refresh');
  btn.classList.toggle('spin', S.busy); btn.disabled = S.busy;
  el.classList.remove('old', 'busy');
  if (S.busy) { el.textContent = 'Updating…'; el.classList.add('busy'); return; }
  const snap = S.data && S.data.snapshot;
  if (!isOpen()) { el.textContent = ''; return; }
  if (S.demo) { el.textContent = ''; return; }   // the ribbon says it
  if (!snap) { el.textContent = 'No bank pull yet'; return; }
  const shortD = new Date(snap.pulled_at).toLocaleDateString('en-US', { timeZone: TZ, month: 'short', day: 'numeric' });
  el.innerHTML = `<span class="s-long">Updated ${fmtStamp(snap.pulled_at)}</span><span class="s-short">Updated ${shortD}</span>`;
  el.title = `Balances as of ${fmtStamp(snap.pulled_at)} Mountain time`;
  if (hoursOld(snap.pulled_at) > STALE_AFTER_HOURS || S.loadError) el.classList.add('old');
}
function render() {
  const open = isOpen();
  document.body.classList.toggle('is-locked', !open);
  document.body.classList.toggle('is-demo', S.demo);
  renderRibbon(); renderNav(); renderStatus();
  const main = $('#main');
  if (!open) { main.innerHTML = lockedView(); return; }
  if (S.demo) {
    const view = { week: weekView, spend: spendView, worth: worthView, activity: activityView, history: historyView, plan: planView }[S.page];
    main.innerHTML = `<div class="page">${view()}</div>`; return;
  }
  if (!S.data && !S.newCodes) { main.innerHTML = `<div class="page"><p class="empty">${S.busy ? 'Opening our notebook…' : "Couldn't reach our notebook. Check the connection and tap the refresh button."}</p></div>`; return; }
  if (S.newCodes) { main.innerHTML = codesView(); return; }
  const view = { week: weekView, spend: spendView, worth: worthView, activity: activityView, history: historyView, plan: planView }[S.page];
  main.innerHTML = `<div class="page">${backupBanner()}${view()}</div>`;
}
function go(page) {
  if (page === S.page) return;
  S.page = page; writeHash(); render(); window.scrollTo({ top: 0 });
}

// ---------------------------------------------------------------- shared pieces
const snap = () => (S.data && S.data.snapshot ? S.data.snapshot.data : null);
const today = () => todayLocal();
function staleBanner() {
  const s = S.data && S.data.snapshot;
  if (!s) return '<div class="banner">No bank numbers have been saved yet. Things you add still work.</div>';
  const h = hoursOld(s.pulled_at);
  if (S.loadError) return `<div class="banner">Couldn't reach our notebook just now. These are the last real balances, from ${fmtStamp(s.pulled_at)}.</div>`;
  if (h > STALE_AFTER_HOURS) return `<div class="banner">These balances are from ${fmtStamp(s.pulled_at, false)}. The banks haven't been asked since.</div>`;
  return '';
}
function heroBlock(w) {
  const has = !!snap() || (S.data.items || []).length;
  const tile = (kind, label, val, cls, hint) => has
    ? `<button type="button" class="tile" data-sheet="${kind}"><div class="label">${label}</div><div class="num ${cls}">${m0(val)}</div><div class="tap-hint">${hint} ${CHEV}</div></button>`
    : `<div class="tile"><div class="label">${label}</div><div class="num ${cls}">${m0(val)}</div></div>`;
  return `
  <section class="hero">
    <p class="kicker">What's left</p>
    <p class="big">${bigMoney(w.left)}</p>
    <p class="hero-note">What we own minus what we owe${w.stuff || w.owedItems ? ', including the things we added' : ''}.</p>
    <div class="tiles">
      ${tile('own', 'We own', w.own, '', 'What adds up')}
      ${tile('owe', 'We owe', w.owe, w.owe > 0 ? 'down' : '', w.owe > 0 ? 'What adds up' : 'Nothing owed')}
    </div>
  </section>`;
}
function donut(parts, size = 148) {
  const total = parts.reduce((s, p) => s + Math.max(0, p.value), 0);
  const r = 58, c = 2 * Math.PI * r, cx = size / 2;
  let off = 0;
  const arcs = total <= 0 ? `<circle cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke="#2b2720" stroke-width="16"/>` :
    parts.filter((p) => p.value > 0).map((p) => {
      const len = (p.value / total) * c; const gap = parts.filter((x) => x.value > 0).length > 1 ? 2.5 : 0;
      const arc = (color, width) => `<circle cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke="${color}" stroke-width="${width}" stroke-dasharray="${Math.max(0, len - gap)} ${c}" stroke-dashoffset="${-off}" transform="rotate(-90 ${cx} ${cx})"/>`;
      // deep fills (Everest green) get a thin lighter edge so they still read against the card
      const a = `<g class="seg-arc" data-sheet="own|${p.slice}"><title>${esc(p.name)}</title>${p.edge ? arc(p.edge, 16) + arc(p.color, 13) : arc(p.color, 16)}</g>`;
      off += len; return a;
    }).join('');
  const top = parts.filter((p) => p.value > 0).sort((a, b) => b.value - a.value)[0];
  const center = top && total > 0 ? `<text x="${cx}" y="${cx - 2}" text-anchor="middle" font-size="26">${Math.round((top.value / total) * 100)}%</text><text x="${cx}" y="${cx + 18}" text-anchor="middle" font-size="11.5" style="font-family:var(--body);fill:var(--muted)">${esc(top.short)}</text>` : '';
  return `<svg class="donut" viewBox="0 0 ${size} ${size}" role="img" aria-label="What we own, split by kind">${arcs}${center}</svg>`;
}
function ownBlock(w, onWorth = false) {
  const parts = [
    { slice: 'cash', name: 'Cash in the bank', short: 'cash', value: w.cash, color: '#16382c', edge: '#3a7a5e' },
    { slice: 'invest', name: 'Investments', short: 'invested', value: w.invest, color: '#d4c6a4' },
    { slice: 'stuff', name: 'Things we added', short: 'things', value: w.stuff, color: '#b3a892' },
  ];
  const total = parts.reduce((s, p) => s + Math.max(0, p.value), 0) || 1;
  return `
  <section class="section">
    <p class="kicker">What we own</p>
    <div class="card own">
      ${donut(parts)}
      <ul class="rows">
        ${parts.map((p) => `<li class="tap" role="button" tabindex="0" data-sheet="own|${p.slice}"><span class="dot" style="background:${p.color}"></span><span class="name">${p.name}</span><span class="amt">${m0(p.value)}</span><span class="pct">${Math.round((Math.max(0, p.value) / total) * 100)}%</span>${CHEV}</li>`).join('')}
      </ul>
    </div>
    ${w.stuff || onWorth ? '' : '<p class="muted" style="margin:10px 2px 0;font-size:14px">No car or house added yet. <a href="#" data-page="worth" class="warn">Add one on Worth</a>.</p>'}
  </section>`;
}
function gapsBlock() {
  const notes = gaps(snap(), S.rows);
  if (!notes.length) return '';
  return `<div class="foot">${notes.map((n) => `<p>${esc(n)}</p>`).join('')}</div>`;
}

// ---------------------------------------------------------------- Week
function weekView() {
  // Week opens with this week: the target as the hero, Spent and Earned right beside it. Net worth lives on Worth.
  const ws = weekStart(today());
  const tw = summarize(S.rows, ws, today());
  let html = staleBanner();
  if (!snap()) return html + weekHero(tw, null) + '<section class="section"><p class="empty">The weekly letter shows up after the first bank pull.</p></section>';
  const L = buildLetter(S.rows, today(), snap().coverage && snap().coverage.from, { invStory: W().invStory });
  const last = L.last;
  const top = last.cats.slice(0, 3).map(([c, v]) => `${CATS[c].label} ${m0(v)}`).join(' · ') || 'Nothing yet';
  const verdictClass = { more: 'down', less: 'up', same: '', none: 'muted' }[L.verdict];
  const pick = L.storyPick;
  const target = targetOf();
  const lastVs = vsTarget(last.spend, target);
  const lw = `${L.lastWs}|${addDays(L.lastWs, 6)}|Last week`;
  const li = (sheet, t, v, cls = '') => sheet
    ? `<li class="tap" role="button" tabindex="0" data-sheet="${sheet}"><span class="t">${t}</span><span class="v ${cls}">${v}</span>${CHEV}</li>`
    : `<li><span class="t">${t}</span><span class="v ${cls}">${v}</span></li>`;
  html += weekHero(tw, L);
  html += `
  <section class="section">
    <article class="letter">
      <div class="letter-head"><h3>Last week's letter</h3><span class="letter-dates">${weekLabel(L.lastWs)}</span></div>
      <p class="story">${L.story.map(esc).join(' ')}</p>
      <p class="normal"><b class="${verdictClass}">Is this normal?</b> ${esc(L.normal)}</p>
      ${lastVs ? `<p class="tline ${lastVs.state}"><b>Our target</b> ${esc(targetSentence(last.spend, target))}</p>` : ''}
      <ol class="numbered">
        ${li(last.items.length ? `spent|${lw}|day` : '', 'Consumer spending', `${m2(last.spend)}${last.pending > 0 ? ` <small class="warn">Includes ${m2(last.pending)} still pending</small>` : ''}`)}
        ${li('vs', 'vs last week', `${Math.abs(L.vsPrev) < 0.5 ? 'About the same' : `${m2(Math.abs(L.vsPrev))} ${L.vsPrev > 0 ? 'more' : 'less'}`} <small>than the week before (${m2(L.prev.spend)})</small>`, L.vsPrev > 0.5 ? 'down' : L.vsPrev < -0.5 ? 'up' : '')}
        ${li(last.cats.length ? `spent|${lw}|cat` : '', 'Top categories', esc(top))}
        ${li(pick ? `tx|${pick.id}` : '', 'Story item', pick ? `${esc(pick.label)} · ${m2(pick.spend)} <small>${weekdayName(pick.date)}${pick.note ? ` · “${esc(pick.note)}”` : ''}</small>` : 'Nothing stood out.')}
        ${li(last.investRows.length ? `invest|${lw}` : '', 'Investing', last.investing > 0 ? `${m2(last.investing)} <small>${W().invInto}</small>` : 'Nothing this week.')}
        ${li(last.incomeRows.length ? `income|${lw}` : '', 'Income received', `${m2(last.income)}${last.incomeRows.length ? '' : ' <small>Nothing came in.</small>'}`, last.income > 0 ? 'up' : '')}
        ${li(last.transferRows.length || last.cardRows.length ? `moves|${lw}` : '', 'Transfers and card payments', `${m2(last.transfers)} <small>moved between our accounts</small> · ${m2(last.cardPayments)} <small>paid to cards. Not new spending.</small>`)}
      </ol>
    </article>
  </section>
  ${gapsBlock()}`;
  return html;
}

// ---------------------------------------------------------------- weekly target
function weekHero(tw, L) {
  const ws = weekStart(today());
  const tiles = `<div class="sofar">
      <button type="button" class="tile" data-sheet="spent|${ws}|${today()}|This week so far|cat"><div class="label">Spent</div><div class="num">${m0(tw.spend)}</div>${tw.pending > 0 ? `<div class="warn" style="font-size:13px;margin-top:4px">Includes ${m2(tw.pending)} still pending</div>` : ''}<div class="tap-hint">${tw.items.length ? 'See purchases' : 'Nothing yet'} ${CHEV}</div></button>
      <button type="button" class="tile" data-sheet="income|${ws}|${today()}|This week so far"><div class="label">Earned</div><div class="num ${tw.income > 0 ? 'up' : ''}">${m0(tw.income)}</div><div class="tap-hint">${tw.incomeRows.length ? 'See sources' : 'Nothing in yet'} ${CHEV}</div></button>
    </div>`;
  return `<section class="week-hero">
    <p class="kicker">This week · ${shortDate(ws)} to today</p>
    <div class="wh-grid">${targetBlock(tw, L || { usual: null }).replace(/^<section class="section">|<\/section>$/g, '')}${tiles}</div>
  </section>`;
}
function targetOf() { const v = S.data && S.data.settings ? Number(S.data.settings.weekly_target) : NaN; return v > 0 ? v : null; }
const suggestTarget = (usual) => (usual && usual >= 1 ? Math.max(10, Math.round(usual / 10) * 10) : null);
// Days left in this Mon–Sun week, counting today.
const daysLeftInWeek = () => 7 - daysBetween(weekStart(today()), today());
function targetBlock(tw, L) {
  const target = targetOf();
  if (!target) {
    const s = suggestTarget(L.usual);
    return `<section class="section"><div class="target-card unset">
      <p class="label">Weekly target</p>
      <h3 class="t-ask">Pick one number for the week.</h3>
      <p class="t-why">It counts real purchases only, like the letter.${s ? ` Our usual week is about ${m0(L.usual)}, so ${m0(s)} is a fair place to start.` : ''}</p>
      <button type="button" class="btn" data-target-edit>Set a target</button>
    </div></section>`;
  }
  const v = vsTarget(tw.spend, target);
  const dl = daysLeftInWeek();
  const pct = Math.min(100, (tw.spend / target) * 100);
  const big = v.state === 'over' ? `<span class="down">${m0(v.diff)}</span> <span class="t-big-sub">over this week</span>`
    : v.state === 'at' ? `${m0(0)} <span class="t-big-sub">left. Right on target.</span>`
    : `${m0(v.diff)} <span class="t-big-sub">left this week</span>`;
  const pace = v.state === 'under'
    ? (dl === 1 ? `Today is the last day. ${m0(v.diff)} to go.` : `About ${m0(v.diff / dl)} a day for the rest of the week.`)
    : v.state === 'at' ? 'Right on the number. A fresh week starts Monday.' : 'It happens. A fresh week starts Monday.';
  return `<section class="section"><div class="target-card ${v.state}" role="button" tabindex="0" data-sheet="target">
    <div class="target-top"><span class="label">Weekly target · ${m0(target)}</span><button type="button" class="linkish target-edit" data-target-edit>Change</button></div>
    <p class="t-big">${big}</p>
    <div class="tbar thick" role="img" aria-label="${m0(tw.spend)} of ${m0(target)} spent"><span style="width:${Math.max(pct, tw.spend > 0 ? 1.5 : 0).toFixed(1)}%"></span></div>
    <div class="t-meta"><span>${m0(tw.spend)} of ${m0(target)} spent</span><span>${dl} ${dl === 1 ? 'day' : 'days'} left</span></div>
    <p class="t-pace">${pace}</p>
    <div class="tap-hint">By day ${CHEV}</div>
  </div></section>`;
}
function openTargetSheet() {
  const target = targetOf();
  const L = buildLetter(S.rows, today(), snap() && snap().coverage && snap().coverage.from, { invStory: W().invStory });
  const s = suggestTarget(L.usual);
  openSheet(`<h3>Weekly spending target</h3>
    <p>One number for both of us. It counts real purchases only, the same spending as the letter.${L.usual ? ` Our usual week (last 4 weeks) is about ${m0(L.usual)}.` : ''}</p>
    <form id="target-form" class="form">
      <div class="field"><label for="target-amt">Dollars per week</label><input id="target-amt" name="amount" inputmode="decimal" autocomplete="off" placeholder="${s || 400}" value="${target ? Math.round(target * 100) / 100 : (s || '')}"></div>
      <div class="btns"><button class="btn" type="submit">Save target</button>${target ? '<button type="button" class="btn danger" data-target-clear>Remove target</button>' : ''}<button type="button" class="btn ghost" data-close>Cancel</button></div>
    </form>`,
  async (e) => { if (e.target.closest('[data-target-clear]')) await saveTarget(null); });
}
async function saveTarget(amount) {
  const prev = S.data.settings ? { ...S.data.settings } : {};
  closeSheet();
  try {
    await rpc('ours_setting_set', { p_name: 'weekly_target', p_value: amount });
    S.data.settings = { ...prev }; if (amount === null) delete S.data.settings.weekly_target; else S.data.settings.weekly_target = Math.round(amount * 100) / 100;
    saveCache(); render();
    toast(amount === null ? 'Target removed.' : `Saved. Our weekly target is ${m0(amount)}.`);
  } catch { S.data.settings = prev; render(); toast("Couldn't save the target. Nothing changed. Try again."); }
}

// ---------------------------------------------------------------- Spend
function periodRange(p) {
  const t = today(); const ws = weekStart(t);
  if (p === 'this') return [ws, t, 'This week'];
  if (p === 'last') return [addDays(ws, -7), addDays(ws, -1), 'Last week'];
  if (p === '4w') return [addDays(t, -27), t, 'Last 4 weeks'];
  return [(snap() && snap().coverage.from) || '2000-01-01', t, 'Everything we have'];
}
function spendView() {
  const [from, to] = periodRange(S.spendPeriod);
  const s = summarize(S.rows, from, to);
  const fixes = new Map((S.data.fixes || []).map((f) => [f.merchant_key, f]));
  const seg = [['this', 'This week'], ['last', 'Last week'], ['4w', '4 weeks'], ['all', 'All']]
    .map(([id, l]) => `<button type="button" data-period="${id}" aria-pressed="${S.spendPeriod === id}">${l}</button>`).join('');
  let html = `<h2 class="page-title">Where it goes</h2><p class="page-sub">${shortDate(from)} – ${shortDate(to)}</p><div class="seg" role="group" aria-label="Period">${seg}</div>`;
  if (!snap()) return html + '<p class="empty">No bank numbers yet, so there is nothing to sort.</p>';
  const positive = s.cats.filter(([, v]) => v > 0);
  const posTotal = positive.reduce((a, [, v]) => a + v, 0) || 1;
  html += `
  <section class="section" style="margin-top:28px">
    <p class="kicker">Total spent</p>
    <p class="big">${bigMoney(s.spend)}</p>
    <p class="hero-note">${positive.length ? `Most went to ${CATS[positive[0][0]].label.toLowerCase()} (${m0(positive[0][1])}).` : 'No spending in this stretch.'}${s.pending > 0 ? ` <span class="warn">Includes ${m2(s.pending)} still pending.</span>` : ''}</p>
    ${positive.length ? `<div class="stack" aria-hidden="true">${positive.map(([c, v]) => `<span style="flex:${v / posTotal};background:${CATS[c].color}" title="${CATS[c].label}"></span>`).join('')}</div>` : ''}
  </section>
  <section class="section" style="margin-top:20px">
    ${s.cats.map(([c, v]) => {
      const open = S.openCat === c;
      const ms = Object.values(s.merchants[c] || {}).sort((a, b) => b.total - a.total);
      return `<div class="cat" ${open ? 'open-cat' : ''}>
        <button type="button" data-cat="${c}" aria-expanded="${open}">
          <span class="dot" style="background:${CATS[c].color}"></span><span class="name">${CATS[c].label}</span>
          <span class="amt">${m2(v)}</span><span class="chev">${icon('chev', 16)}</span>
        </button>
        ${open ? `<ul class="merchants">${ms.map((m) => `<li>
            <span class="m"><span class="n">${esc(m.label)}${fixes.has(m.key) ? '<span class="fixed-tag">fixed</span>' : ''}</span><small>${m.count} ${m.count === 1 ? 'time' : 'times'}</small></span>
            <span class="amt">${m2(m.total)}</span>
            <button type="button" class="fixbtn" data-fix="${esc(m.key)}" data-label="${esc(m.label)}" data-cur="${c}">Fix</button>
          </li>`).join('')}</ul>` : ''}
      </div>`;
    }).join('') || '<p class="empty">Nothing spent in this stretch.</p>'}
  </section>
  ${fixListBlock()}`;
  return html;
}
function fixListBlock() {
  const f = S.data.fixes || [];
  if (!f.length) return '<p class="foot">Something in the wrong bucket? Open a category and tap Fix on the store. It sticks.</p>';
  const label = (t) => (CATS[t] ? CATS[t].label : KINDS[t] || t);
  return `<section class="section"><p class="kicker">Our fixes</p><div class="card"><ul class="rows">${f.map((x) => `<li><span class="name">${esc(x.merchant_label)}</span><span class="muted">${esc(label(x.set_to))}</span><button class="iconbtn" type="button" data-unfix="${esc(x.merchant_key)}" aria-label="Undo fix for ${esc(x.merchant_label)}">${icon('trash', 18)}</button></li>`).join('')}</ul></div></section>`;
}
function openFixSheet(key, label, cur) {
  const existing = (S.data.fixes || []).find((f) => f.merchant_key === key);
  const curTarget = existing ? existing.set_to : cur;
  const opt = (id, name, color) => `<button type="button" data-set="${id}" aria-pressed="${curTarget === id}">${color ? `<span class="dot" style="background:${color}"></span>` : ''}${name}</button>`;
  openSheet(`
    <h3>Fix ${esc(label)}</h3>
    <p>Pick where ${esc(label)} belongs. This applies to every charge from it, past and future.</p>
    <div class="opts">${CAT_KEYS.map((c) => opt(c, CATS[c].label, CATS[c].color)).join('')}</div>
    <div class="opts-label">Or it isn't spending:</div>
    <div class="opts">${opt('transfer', 'Transfer')}${opt('income', 'Income')}${opt('investing', 'Investing')}</div>
    <div class="btns">${existing ? '<button type="button" class="btn ghost" data-set="__clear">Back to automatic</button>' : ''}<button type="button" class="btn ghost" data-close>Cancel</button></div>`,
  async (e) => {
    const b = e.target.closest('[data-set]'); if (!b) return;
    const target = b.dataset.set;
    closeSheet();
    const prev = S.data.fixes.slice();
    try {
      if (target === '__clear') {
        S.data.fixes = S.data.fixes.filter((f) => f.merchant_key !== key); setData(S.data); render();
        await rpc('ours_fix_clear', { p_merchant_key: key });
        toast(`${label} is back to automatic.`);
      } else {
        const optimistic = { merchant_key: key, merchant_label: label, set_to: target };
        S.data.fixes = [...S.data.fixes.filter((f) => f.merchant_key !== key), optimistic]; setData(S.data); render();
        const saved = await rpc('ours_fix_set', { p_merchant_key: key, p_merchant_label: label, p_set_to: target });
        S.data.fixes = [...S.data.fixes.filter((f) => f.merchant_key !== key), saved];
        toast(`Saved. ${label} now counts as ${(CATS[target] ? CATS[target].label : KINDS[target]).toLowerCase()}.`);
      }
      setData(S.data); saveCache(); render();
    } catch (err) {
      S.data.fixes = prev; setData(S.data); render();
      toast("Couldn't save that fix. Nothing changed. Try again.");
    }
  });
}

// ---------------------------------------------------------------- Worth
function worthView() {
  const items = S.data.items || [];
  const w = worth(snap(), items);
  const accts = snap() ? snap().accounts : [];
  const owes = accts.filter((a) => a.class === 'liability');
  const ownItems = items.filter((i) => i.side === 'own');
  const oweItems = items.filter((i) => i.side === 'owe');
  const e = S.editing;
  let html = staleBanner() + heroBlock(w) + ownBlock(w, true);
  html += `
  <section class="section">
    <p class="kicker">What we owe</p>
    <div class="card"><ul class="rows">
      ${owes.map((a) => `<li><span class="name">${esc(a.display)}</span><span class="amt ${a.balance > 0 ? 'down' : ''}">${m2(Math.abs(a.balance))}</span></li>`).join('')}
      ${oweItems.map((i) => `<li><span class="name">${esc(i.name)} <span class="faint">· added</span></span><span class="amt down">${m2(i.amount)}</span></li>`).join('')}
      <li><span class="name"><b style="font-weight:500">Total</b></span><span class="amt">${m2(w.owe)}</span></li>
    </ul>${!owes.length && !oweItems.length ? '<p class="empty">No cards or loans linked, and none added.</p>' : ''}</div>
  </section>
  <section class="section">
    <div class="panel" id="things">
      <h3>Things we count</h3>
      <p class="lede">A car, a home, a loan. Anything the banks don't know about. It counts toward what's left.</p>
      <ul class="items">${items.map((i) => `<li>
          <span class="ico">${icon(i.shape, 20)}</span>
          <span class="n">${esc(i.name)}<small>${SHAPES[i.shape]} · ${i.side === 'own' ? 'we own it' : 'we owe it'}</small></span>
          <span class="amt ${i.side === 'owe' ? 'down' : ''}">${i.side === 'owe' ? '−' : ''}${m0(Number(i.amount))}</span>
          <button type="button" class="iconbtn" data-edit="${i.id}" aria-label="Edit ${esc(i.name)}">${icon('edit', 18)}</button>
          <button type="button" class="iconbtn" data-del="${i.id}" aria-label="Delete ${esc(i.name)}">${icon('trash', 18)}</button>
        </li>`).join('') || '<li class="muted" style="border:0">Nothing added yet.</li>'}</ul>
      <form class="form" id="item-form" autocomplete="off">
        <div class="shapes" role="group" aria-label="Shape">${Object.entries(SHAPES).map(([id, l]) => `<button type="button" data-shape="${id}" aria-pressed="${(e ? e.shape : S.draftShape) === id}">${icon(id, 17)}${l}</button>`).join('')}</div>
        <div class="row2">
          <div class="field"><label for="item-name">Name</label><input id="item-name" name="name" maxlength="80" required placeholder="${(e ? e.shape : S.draftShape) === 'loan' ? 'Car loan' : 'Our car'}" value="${e ? esc(e.name) : ''}"></div>
          <div class="field"><label for="item-amount">Dollar amount</label><input id="item-amount" name="amount" inputmode="decimal" required placeholder="22000" value="${e ? Number(e.amount) : ''}"></div>
        </div>
        <div class="btns"><button class="btn" type="submit">${e ? 'Save changes' : 'Add it'}</button>${e ? '<button class="btn ghost" type="button" data-cancel-edit>Cancel</button>' : ''}</div>
      </form>
    </div>
  </section>`;
  const holdings = snap() ? snap().holdings : [];
  html += `
  <section class="section">
    <p class="kicker">Holdings</p>
    <div class="card"><ul class="rows">${holdings.map((h) => `<li><span class="name">${esc(h.name)} <span class="faint">${h.quantity.toLocaleString('en-US', { maximumFractionDigits: 6 })} ${esc(h.ticker)} at ${m0(h.price)}</span></span><span class="amt">${m2(h.value)}</span></li>`).join('') || '<li class="muted">No holdings in the linked accounts.</li>'}</ul>
    ${holdings.length ? `<p class="faint" style="font-size:13px;margin:10px 0 0">${W().holdNote}</p>` : ''}</div>
  </section>
  <section class="section">
    <p class="kicker">Every linked account</p>
    <div class="card">${[['cash', 'Cash'], ['investment', 'Investments'], ['liability', 'Cards and loans']].map(([cls, label]) => {
      const list = accts.filter((a) => a.class === cls);
      if (!list.length) return '';
      return `<div class="acct-group"><p class="kicker">${label}</p><ul class="rows">${list.map((a) => `<li><span class="name">${esc(a.display)}${a.nickname ? ` <span class="faint">· ${esc(a.nickname)}</span>` : ''}</span><span class="amt">${m2(a.balance)}</span></li>`).join('')}</ul></div>`;
    }).join('') || '<p class="empty">No accounts linked yet.</p>'}</div>
    ${snap() ? `<p class="faint" style="font-size:13px;margin:10px 2px 0">Balances as of ${fmtStamp(S.data.snapshot.pulled_at)}.</p>` : ''}
  </section>`;
  return html + tourCard() + devicesBlock();
}
async function submitItem(form) {
  const name = form.name.value.trim();
  const amount = Number(String(form.amount.value).replace(/[$,\s]/g, ''));
  if (!name) return toast('Give it a name.');
  if (!isFinite(amount) || amount < 0) return toast('Use a dollar amount, like 22000.');
  const shape = S.editing ? S.editing.shape : S.draftShape;
  const btn = form.querySelector('button[type=submit]'); btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const saved = await rpc('ours_item_save', { p_id: S.editing ? S.editing.id : null, p_shape: shape, p_name: name, p_amount: amount });
    const items = (S.data.items || []).filter((i) => i.id !== saved.id);
    const idx = S.editing ? S.data.items.findIndex((i) => i.id === saved.id) : -1;
    if (idx >= 0) items.splice(idx, 0, saved); else items.push(saved);
    S.data.items = items; S.editing = null; saveCache(); render();
    toast(`Saved. ${saved.name} is in what's left.`);
  } catch {
    btn.disabled = false; btn.textContent = S.editing ? 'Save changes' : 'Add it';
    toast("Couldn't save. Nothing changed. Try again.");
  }
}
function confirmDelete(id) {
  const item = (S.data.items || []).find((i) => i.id === id); if (!item) return;
  openSheet(`<h3>Delete ${esc(item.name)}?</h3><p>${m0(Number(item.amount))} comes out of what's left. Only this one item is removed.</p>
    <div class="btns"><button type="button" class="btn danger" data-confirm>Delete it</button><button type="button" class="btn ghost" data-close>Keep it</button></div>`,
  async (e) => {
    if (!e.target.closest('[data-confirm]')) return;
    closeSheet();
    try {
      await rpc('ours_item_delete', { p_id: id });
      S.data.items = S.data.items.filter((i) => i.id !== id); if (S.editing && S.editing.id === id) S.editing = null;
      saveCache(); render(); toast(`${item.name} removed.`);
    } catch { toast("Couldn't delete. Nothing changed. Try again."); }
  });
}

// ---------------------------------------------------------------- Activity
function activityView() {
  const filters = [['all', 'All'], ['spend', 'Spend'], ['income', 'Income'], ['investing', 'Investing'], ['transfer', 'Transfers'], ['card_payment', 'Card payments']];
  let html = `<h2 class="page-title">Every move.</h2><p class="page-sub">Newest first. Money in is positive, money out is negative.</p>
    <div class="chips" role="group" aria-label="Show">${filters.map(([id, l]) => `<button type="button" data-act="${id}" aria-pressed="${S.actFilter === id}">${l}</button>`).join('')}</div>`;
  if (!snap()) return html + '<p class="empty">No bank activity yet.</p>';
  const list = S.rows.filter((r) => !r.mirror && !r.dup && (S.actFilter === 'all' || r.kind === S.actFilter));
  const shown = list.slice(0, S.actLimit);
  let day = null;
  html += shown.map((r) => {
    let head = '';
    if (r.date !== day) { head = `${day ? '</div>' : ''}<div class="day"><h4>${weekdayName(r.date)}, ${shortDate(r.date)}</h4>`; day = r.date; }
    const label = r.kind === 'spend' ? CATS[r.cat].label : KINDS[r.kind];
    return `${head}<div class="tx">
      <span class="p"><span class="n">${esc(r.label)}</span><small>${esc(r.acct ? r.acct.display : '')}${r.note ? ` · “${esc(r.note)}”` : ''}</small></span>
      <span class="a"><span class="${r.amount > 0 ? 'up' : ''}">${signed(r.amount)}</span><small><span class="badge ${r.kind}">${esc(label)}</span>${r.pending ? '<span class="pend">pending</span>' : ''}</small></span>
    </div>`;
  }).join('') + (day ? '</div>' : '');
  if (!shown.length) html += '<p class="empty">Nothing of this kind in the last six months.</p>';
  if (list.length > shown.length) html += `<button type="button" class="btn ghost more" data-more>Show more (${list.length - shown.length} left)</button>`;
  return html;
}

// ---------------------------------------------------------------- History
function historyView() {
  let html = '<h2 class="page-title">Week by week.</h2><p class="page-sub">Monday to Sunday, Mountain time.</p>';
  if (!snap()) return html + '<p class="empty">History starts after the first bank pull.</p>';
  const t = today(); const from = snap().coverage.from;
  let ws = weekStart(t); const weeks = [];
  while (ws >= from) { weeks.push(summarize(S.rows, ws, addDays(ws, 6))); ws = addDays(ws, -7); }
  const rowsData = weeks.map((w, i) => ({ w, prev: weeks[i + 1], current: i === 0 }));
  const vs = (r) => {
    if (!r.prev) return '<span class="faint">–</span>';
    const d = r.w.spend - r.prev.spend;
    if (Math.abs(d) < 1) return '<span class="muted">same</span>';
    return `<span class="${d > 0 ? 'down' : 'up'}">${d > 0 ? '+' : '−'}${m0(Math.abs(d))}</span>`;
  };
  const wkTitle = (r) => (r.current ? 'This week so far' : 'Week');
  const cell = (kind, r, val, cls, n) => n ? `<button type="button" class="linkish ${cls}" data-sheet="${kind}|${r.w.from}|${r.current ? today() : r.w.to}|${wkTitle(r)}${kind === 'spent' ? '|cat' : ''}">${m0(val)}</button>` : `<span class="${cls}">${m0(val)}</span>`;
  const target = targetOf();
  const mark = (r) => {
    const v = vsTarget(r.w.spend, target);
    if (!v || (r.current && v.state !== 'over')) return '';
    return v.state === 'over' ? `<span class="tmark over" title="${m0(v.diff)} over the ${m0(target)} target">over</span>` : `<span class="tmark under" title="${m0(v.diff)} under the ${m0(target)} target">under</span>`;
  };
  if (target) html = html.replace('Monday to Sunday, Mountain time.', `Monday to Sunday, Mountain time. Each week is marked against our ${m0(target)} target.`);
  html += `<table class="hist"><thead><tr><th>Week</th><th>Spending</th><th>vs week before</th><th>Income</th><th>Investing</th></tr></thead><tbody>
    ${rowsData.map((r) => `<tr class="${r.current ? 'current' : ''}"><td>${weekLabel(r.w.from)}</td><td>${mark(r)}${cell('spent', r, r.w.spend, '', r.w.items.length)}</td><td>${vs(r)}</td><td><button type="button" class="linkish ${r.w.income > 0 ? 'up' : 'faint'}" data-sheet="income|${r.w.from}|${r.w.to}|${r.current ? 'This week so far' : 'Week'}">${m0(r.w.income)}</button></td><td>${cell('invest', r, r.w.investing, r.w.investing > 0 ? 'warn' : 'faint', r.w.investRows.length)}</td></tr>`).join('')}
  </tbody></table>
  <div class="hist-cards">${rowsData.map((r) => `<div class="hcard"><div class="top-row"><span class="wk">${weekLabel(r.w.from)}${r.current ? ' <span class="faint">· so far</span>' : ''}</span><span class="sp">${mark(r)}${cell('spent', r, r.w.spend, 'sp-btn', r.w.items.length)}</span></div>
    <div class="meta"><span>vs before ${vs(r)}</span><span>In <button type="button" class="linkish ${r.w.income > 0 ? 'up' : ''}" data-sheet="income|${r.w.from}|${r.w.to}|${r.current ? 'This week so far' : 'Week'}">${m0(r.w.income)}</button></span><span>Invested ${cell('invest', r, r.w.investing, r.w.investing > 0 ? 'warn' : '', r.w.investRows.length)}</span></div></div>`).join('')}</div>
  <p class="foot">Activity starts ${shortDate(from)}${from.slice(0, 4) !== t.slice(0, 4) ? ' ' + from.slice(0, 4) : ''}, so the oldest week may be partial.</p>`;
  return html;
}

// ---------------------------------------------------------------- Plan
// Advice computed fresh from the live snapshot on every render, plus public figures from data/facts.json.
let planMemo = { rows: null, items: null, facts: null, out: null };
function planData() {
  if (!snap() || !S.facts) return null;
  if (planMemo.rows === S.rows && planMemo.items === S.data.items && planMemo.facts === S.facts && planMemo.day === today()) return planMemo.out;
  const A = analyze({ snapshot: snap(), rows: S.rows, items: S.data.items || [], today: today(), facts: S.facts });
  const steps = nextSteps(A, S.facts);
  const out = { A, steps, calc: steps.calc, qs: questions(A, S.facts) };
  planMemo = { rows: S.rows, items: S.data.items, facts: S.facts, day: today(), out };
  return out;
}
async function loadFacts() {
  try {
    const r = await fetch('data/facts.json?v=16', { cache: 'no-cache' });
    if (!r.ok) throw new Error(r.status);
    const f = await r.json();
    if (!f || !f.facts || !f.checked) throw new Error('bad facts');
    S.facts = f; S.factsError = null;
  } catch (e) { S.facts = null; S.factsError = e; }
  if (S.page === 'plan') render();
}
const longD = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const ext = (f, label) => (f && f.url ? `<a class="src" href="${esc(f.url)}" target="_blank" rel="noopener noreferrer">${esc(label || f.label || f.src)}<svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M6 3.5h6.5V10M12.5 3.5 4 12"/></svg></a>` : '');
const pct1 = (x) => `${(x * 100).toFixed(1)}%`;

function planView() {
  let html = `<h2 class="page-title">What we'd do next</h2>`;
  if (!snap()) return html + '<p class="empty">The plan shows up after the first bank pull.</p>';
  if (!S.facts) return html + `<p class="page-sub">${S.factsError ? "Couldn't load today's rates and limits, so the advice is hidden for now. Tap refresh to try again." : 'Loading rates and limits…'}</p>`;
  const P = planData(); const { A, steps, calc, qs } = P; const F = S.facts.facts;
  const span = A.window.length ? `${monthName(A.window[0], true)} to ${monthName(A.window[A.window.length - 1], true)}` : 'what we have';
  html = staleBanner() + html + `<p class="page-sub">From our own numbers: ${plural(A.months, 'full month')} (${span}) and balances as of ${fmtStamp(S.data.snapshot.pulled_at, false)}.</p>`;

  // summary tiles
  const rate = A.savingsRate;
  html += `<div class="tiles three">
    <button type="button" class="tile" data-sheet="plan-months"><div class="label">In a month</div><div class="num up">${m0(A.income)}</div><div class="tap-hint">By month ${CHEV}</div></button>
    <button type="button" class="tile" data-sheet="plan-months"><div class="label">Out a month</div><div class="num">${m0(A.living)}</div><div class="tap-hint">By month ${CHEV}</div></button>
    <div class="tile"><div class="label">We keep</div><div class="num ${rate > 0.15 ? 'up' : rate < 0 ? 'down' : ''}">${rate === null ? '–' : Math.round(rate * 100) + '%'}</div><div class="tap-hint">of what comes in</div></div>
  </div>`;

  // money in vs out by month
  const max = Math.max(1, ...A.byMonth.map((m) => Math.max(m.income, m.spend - m.oneOff + m.unseen)));
  html += `<section class="section months-sec"><p class="kicker">Money in and out, by month</p><div class="card"><ul class="months">
    ${A.byMonth.map((m) => { const out = m.spend - m.oneOff + m.unseen; return `<li class="tap" role="button" tabindex="0" data-sheet="plan-month|${m.month}">
      <span class="mo-n">${monthName(m.month)}</span>
      <span class="mo-bars"><span class="b in" style="width:${(m.income / max * 100).toFixed(1)}%"></span><span class="b out" style="width:${(out / max * 100).toFixed(1)}%"></span></span>
      <span class="mo-v"><span class="up">${m0(m.income)}</span><span>${m0(out)}</span>${m.oneOff ? `<small class="warn">+${m0(m.oneOff)} one-time</small>` : ''}</span>${CHEV}</li>`; }).join('')}
  </ul><p class="mo-key"><span><i class="k in"></i>In</span><span><i class="k out"></i>Out: purchases${A.unseen > 0 ? ` + ${esc(A.unseenName)} payments` : ''}</span></p></div>
  <p class="note">${A.oneOffs.length ? `Left out of the usual month: ${A.oneOffs.map((r) => `${esc(r.label)} ${m0(r.spend)} (${shortDate(r.date)})`).join(', ')}. ` : ''}Income counts every deposit tagged as income, ${W().incomeNote}. ${A.invested > 0 ? `${W().invBuys} (${m0(A.invested)} a month) count as saving, not spending.` : ''}</p></section>`;

  // next steps
  const MAIN = 6;
  const stepLi = (s) => `<li class="step">
      <div class="step-body">
        <h3 class="step-title">${esc(s.title)}</h3>
        <p class="step-amt"><b>${m0(s.amount)}</b> <span>${esc(s.amountLabel)}</span></p>
        <p class="step-why">${esc(s.why)}</p>
        <p class="step-links"><span class="faint">Learn more:</span> ${ext(s.link)}${s.link2 ? ` ${ext(s.link2)}` : ''}${s.sheet ? ` <button type="button" class="linkish see" data-sheet="${s.sheet}">See our numbers ${CHEV}</button>` : ''}</p>
      </div></li>`;
  html += `<section class="section"><p class="kicker">Next steps, most important first</p>
    <ol class="steps">${steps.slice(0, MAIN).map(stepLi).join('')}</ol>
    ${steps.length > MAIN ? `<p class="kicker" style="margin-top:26px">Smaller things</p><ol class="steps small" start="${MAIN + 1}">${steps.slice(MAIN).map(stepLi).join('')}</ol>` : ''}
  </section>`;

  // cushion
  const em = F.emergency_months || { low: 3, high: 6, text: '' }; const cm = A.cushionMonths || 0; const scale = Math.max(em.high * 1.5, cm * 1.08);
  html += `<section class="section"><p class="kicker">Emergency cushion</p><div class="card tap" role="button" tabindex="0" data-sheet="plan-extra">
    <p class="cush-big"><b>${cm.toFixed(1)}</b> months <span class="muted">of a usual month in cash</span></p>
    <div class="cush-bar"><span class="fill" style="width:${Math.min(100, cm / scale * 100).toFixed(1)}%"></span>
      <i style="left:${(em.low / scale * 100).toFixed(1)}%"><em>${em.low} mo</em></i><i style="left:${(em.high / scale * 100).toFixed(1)}%"><em>${em.high} mo</em></i></div>
    <p class="muted" style="margin:26px 0 0;font-size:14.5px">${m0(A.cash)} in cash ÷ ${m0(A.living)} a usual month.${em.text ? ` ${esc(em.text)}.` : ''}</p>
    <div class="tap-hint">What's extra ${CHEV}</div></div></section>`;

  // where cash sits
  const nat = F.fdic_savings_national;
  html += `<section class="section"><p class="kicker">Where our cash sits</p><div class="card"><ul class="rows">
    ${A.cashSpots.filter((s) => s.balance > 0.005 || s.payments).map((s) => `<li class="tap" role="button" tabindex="0" data-sheet="plan-cash"><span class="name">${esc(s.name)}${s.nickname ? ` <span class="faint">· ${esc(s.nickname)}</span>` : ''}<small class="yield ${s.estYield ? 'up' : 'faint'}">${s.estYield ? `about ${pct1(s.estYield)} a year (estimate)` : 'no interest seen'}</small></span><span class="amt">${m0(s.balance)}</span>${CHEV}</li>`).join('')}
  </ul></div><p class="note">Estimate = last month's interest × 12 ÷ today's balance. We've received ${m2(sum(A.cashSpots, (s) => s.interest6))} in interest since ${shortDate(A.coverFrom)}. ${nat ? `The national average savings rate is ${nat.value}% (${ext(nat, `FDIC, ${shortDate(nat.as_of)}`)}).` : ''}</p></section>`;

  // what we own
  const tot = A.cash + A.investTotal + A.stuff || 1;
  const parts = [['Cash', A.cash, '#16382c', 'cash'], ['Invested', A.investTotal, '#d4c6a4', 'invest'], ['Things we added', A.stuff, '#b3a892', 'stuff']].filter((p) => p[1] > 0);
  html += `<section class="section"><p class="kicker">What we own, by kind</p><div class="card">
    <div class="stack" style="margin-top:4px" aria-hidden="true">${parts.map(([, v, c]) => `<span style="flex:${v / tot};background:${c}"></span>`).join('')}</div>
    <ul class="rows">${parts.map(([n, v, c, sl]) => `<li class="tap" role="button" tabindex="0" data-sheet="own|${sl}"><span class="dot" style="background:${c}"></span><span class="name">${n}</span><span class="amt">${m0(v)}</span><span class="pct">${Math.round(v / tot * 100)}%</span>${CHEV}</li>`).join('')}</ul>
    ${A.topHolding ? `<p class="muted" style="margin:12px 0 0;font-size:14.5px">Of what's invested, ${Math.round(A.topShare * 100)}% is ${esc(A.topHolding.name)}${A.holdings.length === 1 ? ', our only holding' : ''}. ${A.owe > 0 ? `We owe ${m0(A.owe)}.` : 'No debt on the linked cards.'}</p>` : ''}
  </div></section>`;

  // regular charges
  if (A.recurring.length) html += `<section class="section"><p class="kicker">Regular charges we found</p><div class="card"><ul class="rows">
    ${A.recurring.map((g) => `<li class="tap" role="button" tabindex="0" data-sheet="tx|${g.rows.slice().sort(byDateDesc)[0].id}|Regular charge"><span class="name">${esc(g.label)}<small class="faint">${g.kind === 'investing' ? 'investing · ' : ''}${g.cadence} · ${plural(g.count, 'time')} in ${g.months} months</small></span><span class="amt">${m0(g.perMonth)}<small class="faint">/mo</small></span>${CHEV}</li>`).join('')}
  </ul></div><p class="note">Same place, steady amount, at least 3 different months. ${A.unseen > 0 ? `Subscriptions on the ${esc(A.unseenName)} can't be seen.` : ''}</p></section>`;

  // questions
  html += `<section class="section"><p class="kicker">Questions worth asking</p><div class="card"><ul class="qs">
    ${qs.map((q) => `<li><b>${esc(q.title)}</b><span>${esc(q.why)}</span><span class="step-links">${ext(q.link)}${q.link2 ? ` ${ext(q.link2)}` : ''}</span></li>`).join('')}
  </ul></div></section>`;

  // trends
  const tr = (S.facts.trends || []).slice().sort((a, b) => (a.date < b.date ? 1 : -1));
  if (tr.length) html += `<section class="section"><p class="kicker">What's changing</p><ul class="trends">
    ${tr.map((t) => `<li><span class="t-date">${longD(t.date)}</span><b>${esc(t.title)}</b><span>${esc(t.text)}</span>${ext(t)}</li>`).join('')}
  </ul></section>`;

  html += `<div class="foot plan-foot"><p>Rates and limits checked ${longD(S.facts.checked)}. Our numbers update with every bank pull.</p>
    <p>Educational guidance from our own numbers, not a licensed advisor. For big decisions, talk with a ${F.cfp ? ext(F.cfp, 'fiduciary CFP') : 'fiduciary CFP'}.</p></div>`;
  return html;
}

// Plan drill-downs
function openPlanMonths() {
  const { A } = planData();
  const body = A.byMonth.slice().reverse().map((m) => group(`<button type="button" class="linkish" data-sheet="plan-month|${m.month}">${monthName(m.month, true)}</button>`, `${m.oneOff ? `${m0(m.oneOff)} one-time left out · ` : ''}kept ${m0(m.income - (m.spend - m.oneOff + m.unseen))}`, '',
    [line('In', `<span class="up">${m2(m.income)}</span>`), line('Purchases', m2(m.spend - m.oneOff)), ...(m.unseen ? [line(`Paid to ${esc(A.unseenName)}`, m2(m.unseen))] : []), ...(m.invest ? [line('Invested (saving)', m2(m.invest))] : [])])).join('');
  sheetPage({ kicker: `Plan · ${plural(A.months, 'full month')}`, title: 'A usual month', total: `${m0(A.income)} in · ${m0(A.living)} out`,
    note: `Averages over ${A.months} months. Out = purchases${A.unseen > 0 ? ` plus payments to the ${esc(A.unseenName)}, since we can't see its purchases` : ''}; one-time items of ${m0(1500)}+ are left out.`, body });
}
function openPlanMonth(mm) {
  const { A } = planData(); const m = A.byMonth.find((x) => x.month === mm); if (!m) return;
  const s = summarize(S.rows, m.from, m.to);
  const cats = s.cats.filter(([, v]) => Math.abs(v) > 0.005);
  const body = group('Came in', `<button type="button" class="linkish" data-sheet="income|${m.from}|${m.to}|${monthName(mm, true)}">See every deposit</button>`, `<span class="up">${m2(m.income)}</span>`,
      groupBy(s.incomeRows, (r) => r.key, (r) => r.label, (r) => r.amount).sort((a, b) => b.total - a.total).slice(0, 8).map((g) => line(`${esc(g.label)} <span class="faint">· ${plural(g.rows.length, 'deposit')}</span>`, m2(g.total)))) +
    group('Purchases', `<button type="button" class="linkish" data-sheet="spent|${m.from}|${m.to}|${monthName(mm, true)}|cat">See every purchase</button>`, m2(m.spend), cats.map(([c, v]) => line(`<span class="dot" style="background:${CATS[c].color}"></span> ${CATS[c].label}`, m2(v)))) +
    (m.oneOffs.length ? group('One-time, left out of the usual month', '', m2(m.oneOff), m.oneOffs.map((r) => line(`${esc(r.label)} <span class="faint">· ${dayShort(r.date)}</span>`, m2(r.spend)))) : '') +
    (m.unseen ? group(`Paid to the ${esc(A.unseenName)}`, 'Purchases inside it are not visible', m2(m.unseen), []) : '');
  sheetPage({ kicker: `Plan · ${monthName(mm, true)} ${mm.slice(0, 4)}`, title: `${monthName(mm, true)}, in and out`, total: `${m0(m.income)} in · ${m0(m.spend - m.oneOff + m.unseen)} out`, body });
}
function openPlanExtra() {
  const { A, calc } = planData();
  const rows = [line(`Cash in the bank`, m2(A.cash)), line(`Keep ${calc.months} months as a cushion <span class="faint">· ${m0(A.living)} × ${calc.months}</span>`, `−${m2(calc.cushion)}`)];
  if (calc.seTax > 0) rows.push(line('Self-employment tax set-aside', `−${m2(calc.seTax)}`));
  if (calc.tuition > 0) rows.push(line(`Half a semester of school <span class="faint">· half of ${m0(calc.tuition)}</span>`, `−${m2(calc.tuition / 2)}`));
  sheetPage({ kicker: 'Plan · cushion math', title: calc.extra > 0 ? 'Cash beyond the cushion' : 'Still building the cushion', total: m2(calc.extra), totalClass: calc.extra > 0 ? 'up' : 'down',
    note: 'A rough split. The cushion is a range, so treat this as a starting point.', body: group('How we got there', '', '', rows) });
}
function openPlanCash() {
  const { A } = planData();
  const body = A.cashSpots.filter((s) => s.balance > 0.005 || s.payments).map((s) => {
    const ir = S.rows.filter((r) => counts(r) && r.kind === 'income' && /interest/i.test(r.label) && r.account_id === s.id).sort(byDateDesc);
    return group(esc(s.name), s.estYield ? `about ${pct1(s.estYield)} a year, estimated` : 'No interest seen', m2(s.balance), ir.map((r) => line(`Interest · ${dayShort(r.date)}`, `<span class="up">${signed(r.amount)}</span>`)));
  }).join('');
  sheetPage({ kicker: 'Plan · where cash sits', title: 'Interest we actually received', total: m2(sum(A.cashSpots, (s) => s.interest6)), totalClass: 'up',
    note: `Since ${shortDate(A.coverFrom)}. At the latest interest pace that's about ${m0(A.interest12)} a year.`, body });
}
function openPlanRows(kind) {
  const { A } = planData();
  const rows = kind === 'unseen' ? A.unseenRows.map((r) => ({ r, v: -r.amount })) : A.tuitionRows.filter((r) => r.date >= A.wFrom && r.date <= A.wTo).map((r) => ({ r, v: r.spend }));
  const total = sum(rows, (x) => x.v);
  sheetPage({ kicker: kind === 'unseen' ? `Plan · since ${shortDate(A.coverFrom)}` : `Plan · ${shortDate(A.wFrom)} – ${shortDate(A.wTo)}`, title: kind === 'unseen' ? `Payments to the ${esc(A.unseenName)}` : 'School charges', total: m2(total),
    note: kind === 'unseen' ? "Each payment covers purchases we can't see until the card is linked." : 'Charges whose name looks like tuition or the university.',
    body: group('', plural(rows.length, kind === 'unseen' ? 'payment' : 'charge'), '', rows.slice().sort((a, b) => byDateDesc(a.r, b.r)).map(({ r, v }) => line(`${dayShort(r.date)} <span class="faint">· ${esc(r.label)} · ${esc(r.acct ? r.acct.display : '')}</span>`, m2(v)))) });
}
const sum = (a, f) => a.reduce((t, x) => t + f(x), 0);

// ---------------------------------------------------------------- drill-down sheets
// Every sheet recomputes from the same summarize()/worth() the page used, so its total always equals the number tapped.
const dayShort = (d) => `${weekdayName(d).slice(0, 3)} ${shortDate(d)}`;
const rangeText = (from, to) => (to >= today() && from <= today() ? `${shortDate(from)} to today` : `${shortDate(from)} – ${shortDate(to)}`);
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const byDateDesc = (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0);
const XBTN = '<button type="button" class="iconbtn sheet-x" data-close aria-label="Close"><svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3.5 3.5l9 9M12.5 3.5l-9 9"/></svg></button>';
function sheetPage({ kicker, title, total, totalClass = '', note = '', body }) {
  openSheet(`${XBTN}
    <p class="kicker" style="margin-bottom:4px">${kicker}</p>
    <h3>${title}</h3>
    ${total !== undefined ? `<div class="inc-total ${totalClass}">${total}</div>` : ''}
    ${note ? `<p class="muted" style="margin:0;font-size:14px">${note}</p>` : ''}
    ${body}
    <div class="btns"><button type="button" class="btn ghost" data-close>Done</button></div>`);
}
const group = (label, sub, total, rows, totalClass = '') => `<div class="inc-group"><div class="inc-head"><span class="n">${label}${sub ? `<small>${sub}</small>` : ''}</span><span class="t ${totalClass}">${total}</span></div>
  ${rows.length ? `<ul class="inc-rows">${rows.join('')}</ul>` : ''}</div>`;
const line = (left, right, cls = '') => `<li class="${cls}"><span class="w">${left}</span><span class="a">${right}</span></li>`;
const emptyLine = (t) => `<p class="empty" style="margin-top:18px">${t}</p>`;
const pend = (r) => (r.pending ? ' <span class="pend">pending</span>' : '');
const noteOf = (r) => (r.note ? ` · “${esc(r.note)}”` : '');
const groupBy = (rows, keyOf, labelOf, valOf) => {
  const m = new Map();
  for (const r of rows) { const k = keyOf(r); const g = m.get(k) || { key: k, label: labelOf(r), total: 0, rows: [] }; g.total += valOf(r); g.rows.push(r); m.set(k, g); }
  const list = [...m.values()]; list.forEach((g) => g.rows.sort(byDateDesc)); return list;
};

function openIncomeSheet(from, to, title) {
  const s = summarize(S.rows, from, to);
  const list = groupBy(s.incomeRows, (r) => r.key, (r) => r.label, (r) => r.amount).sort((a, b) => b.total - a.total);
  const n = s.incomeRows.length;
  const body = !n ? emptyLine('Nothing came in during these days. Transfers between our own accounts and card refunds are not counted as income.') :
    list.map((g) => {
      const accts = [...new Set(g.rows.map((r) => (r.acct ? r.acct.display : '')))].filter(Boolean);
      return group(esc(g.label), `${plural(g.rows.length, 'deposit')}${accts.length === 1 ? ` · into ${esc(accts[0])}` : ''}`, m2(g.total),
        g.rows.map((r) => line(`${dayShort(r.date)}${accts.length === 1 ? '' : ` · ${esc(r.acct ? r.acct.display : '')}`}${pend(r)}${noteOf(r)}`, signed(r.amount))), g.total > 0 ? 'up' : '');
    }).join('');
  sheetPage({ kicker: `${esc(title)} · ${rangeText(from, to)}`, title: 'Where the money came from', total: m2(s.income), totalClass: s.income > 0 ? 'up' : '',
    note: n ? `${plural(n, 'deposit')} from ${plural(list.length, 'source')}. Same income the letter counts. Transfers between our own accounts are left out.` : '', body });
}

// Purchases (consumer spending), grouped by category or by day.
function openSpentSheet(from, to, title, mode = 'cat') {
  const s = summarize(S.rows, from, to);
  const n = s.items.length;
  const refundTag = (r) => (r.spend < 0 ? ' <span class="faint">refund</span>' : '');
  // Shares only make sense when nothing was refunded (a refund would push a share past 100%).
  const showPct = s.spend > 0 && s.items.every((r) => r.spend >= 0);
  const countTxt = (rows) => { const b = rows.filter((r) => r.spend >= 0).length, f = rows.length - b; return [b ? plural(b, 'purchase') : '', f ? plural(f, 'refund') : ''].filter(Boolean).join(' · '); };
  let body;
  if (!n) body = emptyLine('No purchases in these days.');
  else if (mode === 'day') {
    body = groupBy(s.items, (r) => r.date, (r) => r.date, (r) => r.spend).sort((a, b) => (a.key < b.key ? 1 : -1)).map((g) =>
      group(`${weekdayName(g.key)}, ${shortDate(g.key)}`, countTxt(g.rows), m2(g.total),
        g.rows.map((r) => line(`${esc(r.label)} <span class="faint">· ${CATS[r.cat].label}</span>${pend(r)}${refundTag(r)}${noteOf(r)}`, m2(r.spend))))).join('');
  } else {
    body = groupBy(s.items, (r) => r.cat, (r) => CATS[r.cat].label, (r) => r.spend).sort((a, b) => b.total - a.total).map((g) =>
      group(`<span class="dot" style="background:${CATS[g.key].color}"></span> ${g.label}`, `${countTxt(g.rows)}${showPct ? ` · ${Math.round((g.total / s.spend) * 100)}%` : ''}`, m2(g.total),
        g.rows.map((r) => line(`${esc(r.label)} <span class="faint">· ${dayShort(r.date)}</span>${pend(r)}${refundTag(r)}${noteOf(r)}`, m2(r.spend))))).join('');
  }
  sheetPage({ kicker: `${esc(title)} · ${rangeText(from, to)}`, title: mode === 'day' ? 'Every purchase, day by day' : 'Where it went',
    total: m2(s.spend), note: n ? `${countTxt(s.items).replace(' · ', ' and ')}. Real purchases only, same as the letter${s.pending > 0 ? `. Includes ${m2(s.pending)} still pending` : ''}. Transfers, card payments and ${W().invBuysMid} are left out.` : '', body });
}

function openVsSheet() {
  const L = buildLetter(S.rows, today(), snap().coverage && snap().coverage.from, { invStory: W().invStory });
  const a = L.last, b = L.prev;
  const cats = CAT_KEYS.filter((c) => Math.abs(a.byCat[c] || 0) >= 0.005 || Math.abs(b.byCat[c] || 0) >= 0.005)
    .map((c) => [c, (a.byCat[c] || 0), (b.byCat[c] || 0)]).sort((x, y) => Math.abs(y[1] - y[2]) - Math.abs(x[1] - x[2]));
  const diffTxt = (d) => (Math.abs(d) < 0.5 ? '<span class="muted">same</span>' : `<span class="${d > 0 ? 'down' : 'up'}">${d > 0 ? '+' : '−'}${m2(Math.abs(d))}</span>`);
  const body = `<div class="inc-group"><ul class="inc-rows vs-rows">
    <li class="vs-head"><span class="w">Category</span><span class="c">${shortDate(L.lastWs)} wk</span><span class="c">${shortDate(addDays(L.lastWs, -7))} wk</span><span class="a">Change</span></li>
    ${cats.map(([c, x, y]) => `<li><span class="w"><span class="dot" style="background:${CATS[c].color}"></span> ${CATS[c].label}</span><span class="c">${m0(x)}</span><span class="c">${m0(y)}</span><span class="a">${diffTxt(x - y)}</span></li>`).join('')}
    <li class="vs-total"><span class="w">Total</span><span class="c">${m0(a.spend)}</span><span class="c">${m0(b.spend)}</span><span class="a">${diffTxt(a.spend - b.spend)}</span></li></ul></div>`;
  sheetPage({ kicker: `Last week vs the week before`, title: 'What changed', total: Math.abs(L.vsPrev) < 0.5 ? 'About the same' : `${m2(Math.abs(L.vsPrev))} ${L.vsPrev > 0 ? 'more' : 'less'}`,
    totalClass: L.vsPrev > 0.5 ? 'down' : L.vsPrev < -0.5 ? 'up' : '', note: 'Biggest changes first, by category.', body });
}

function openTxSheet(id, kicker = 'Story item · last week') {
  const r = S.rows.find((x) => x.id === id); if (!r) return;
  const kindLabel = r.kind === 'spend' ? `Spending · ${CATS[r.cat].label}` : KINDS[r.kind];
  const others = S.rows.filter((x) => x.key === r.key && x.id !== r.id && counts(x) && x.kind === r.kind);
  const fields = [['Where', esc(r.label)], ['When', `${weekdayName(r.date)}, ${shortDate(r.date)}`], ['Account', esc(r.acct ? r.acct.display : '—')],
    ['Counted as', esc(kindLabel)], ...(r.pending ? [['Status', '<span class="warn">Still pending</span>']] : []), ...(r.note ? [['Note', `“${esc(r.note)}”`]] : [])];
  const body = `<div class="inc-group"><ul class="inc-rows facts">${fields.map(([k, v]) => line(`<span class="faint">${k}</span>`, v)).join('')}</ul></div>
    ${others.length ? group('Other times here', `${plural(others.length, 'time')} in the last six months`, m2(others.reduce((t, x) => t + (x.kind === 'spend' ? x.spend : Math.abs(x.amount)), 0)),
      others.slice(0, 8).map((x) => line(`${dayShort(x.date)}${pend(x)}`, x.kind === 'spend' ? m2(x.spend) : signed(x.amount)))) : ''}`;
  sheetPage({ kicker: esc(kicker), title: esc(r.label), total: r.kind === 'spend' ? m2(r.spend) : signed(r.amount), note: r.why === 'fix' ? 'Category set by one of our Fix rules.' : '', body });
}

function openInvestSheet(from, to, title) {
  const s = summarize(S.rows, from, to);
  const n = s.investRows.length;
  const body = !n ? emptyLine('No investing in these days.') :
    groupBy(s.investRows, (r) => r.key, (r) => r.label, (r) => -r.amount).sort((a, b) => b.total - a.total).map((g) =>
      group(esc(g.label), plural(g.rows.length, 'buy'), m2(g.total), g.rows.map((r) => line(`${dayShort(r.date)} · from ${esc(r.acct ? r.acct.display : '')}${pend(r)}`, m2(-r.amount))))).join('');
  sheetPage({ kicker: `${esc(title)} · ${rangeText(from, to)}`, title: 'Money we invested', total: m2(s.investing),
    note: n ? W().invHow : '', body });
}

function openMovesSheet(from, to, title) {
  const s = summarize(S.rows, from, to);
  const rowsOf = (list) => list.slice().sort(byDateDesc).map((r) => line(`${esc(r.label)} <span class="faint">· ${dayShort(r.date)} · ${esc(r.acct ? r.acct.display : '')}</span>${pend(r)}`, m2(-r.amount)));
  const body = (s.transferRows.length ? group('Moved between our accounts', `${plural(s.transferRows.length, 'move')} · counted once, from the sending side`, m2(s.transfers), rowsOf(s.transferRows)) : '') +
    (s.cardRows.length ? group('Paid to cards', plural(s.cardRows.length, 'payment'), m2(s.cardPayments), rowsOf(s.cardRows)) : '') ||
    emptyLine('No transfers or card payments in these days.');
  sheetPage({ kicker: `${esc(title)} · ${rangeText(from, to)}`, title: 'Money that only moved', total: m2(s.transfers + s.cardPayments),
    note: 'None of this is new spending: it moved between our own accounts or paid off purchases already counted.', body });
}

function ownParts() {
  const accts = (snap() && snap().accounts) || [];
  const items = S.data.items || [];
  const acctRows = (cls) => accts.filter((a) => a.class === cls).sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance))
    .map((a) => line(`${esc(a.display)}${a.nickname ? ` <span class="faint">· ${esc(a.nickname)}</span>` : ''}`, m2(Math.abs(Number(a.balance) || 0))));
  return { accts, items, acctRows };
}
function openOwnSheet(slice = '') {
  const w = worth(snap(), S.data.items || []);
  const { items, acctRows } = ownParts();
  const holdings = (snap() && snap().holdings) || [];
  const stuff = items.filter((i) => i.side === 'own');
  const g = {
    cash: () => group('Cash in the bank', 'Checking and savings', m2(w.cash), acctRows('cash')),
    invest: () => group('Investments', 'Account balances', m2(w.invest), [...acctRows('investment'),
      ...holdings.map((h) => line(`<span class="faint">Inside it: ${esc(h.name)} ${h.quantity.toLocaleString('en-US', { maximumFractionDigits: 6 })} ${esc(h.ticker)} at ${m0(h.price)}</span>`, `<span class="faint">${m2(h.value)}</span>`))]),
    stuff: () => group('Things we added', stuff.length ? 'Edit these on Worth' : '', m2(w.stuff), stuff.length ? stuff.map((i) => line(`${esc(i.name)} <span class="faint">· ${esc(i.shape)}</span>`, m2(Number(i.amount)))) : [line('<span class="muted">Nothing added yet.</span>', '')]),
  };
  const titles = { cash: 'Cash in the bank', invest: 'Investments', stuff: 'Things we added' };
  const body = slice ? g[slice]() : g.cash() + g.invest() + g.stuff();
  const total = slice ? { cash: w.cash, invest: w.invest, stuff: w.stuff }[slice] : w.own;
  sheetPage({ kicker: `What we own · as of ${fmtStamp(S.data.snapshot ? S.data.snapshot.pulled_at : S.data.server_time, false)}`, title: slice ? titles[slice] : 'Everything we own', total: m2(total),
    note: slice === 'invest' || !slice ? W().invInside : '', body });
}
function openOweSheet() {
  const w = worth(snap(), S.data.items || []);
  const { accts, items, acctRows } = ownParts();
  const owed = items.filter((i) => i.side === 'owe');
  const cards = accts.filter((a) => a.class === 'liability');
  const body = (cards.length ? group('Cards and loans', 'Balances from the banks', m2(w.cards), acctRows('liability')) : '') +
    group('Things we owe', owed.length ? 'Added by us on Worth' : '', m2(w.owedItems), owed.length ? owed.map((i) => line(esc(i.name), m2(Number(i.amount)))) : [line('<span class="muted">None added yet.</span>', '')]);
  sheetPage({ kicker: `What we owe · as of ${fmtStamp(S.data.snapshot ? S.data.snapshot.pulled_at : S.data.server_time, false)}`, title: w.owe > 0.005 ? 'Everything we owe' : 'We owe nothing right now',
    total: m2(w.owe), totalClass: w.owe > 0.005 ? 'down' : '',
    note: w.owe > 0.005 ? '' : `${cards.length ? `Every linked card shows a $0 balance` : 'No cards or loans are linked'}, and we haven't added any loans.`, body });
}

// This week, day by day, against the target.
function openTargetByDay() {
  const target = targetOf(); const ws = weekStart(today()); const t = today();
  const s = summarize(S.rows, ws, t);
  const days = Array.from({ length: 7 }, (_, i) => addDays(ws, i));
  const per = target ? target / 7 : 0;
  let run = 0;
  const body = days.map((d) => {
    if (d > t) return `<div class="inc-group day-future"><div class="inc-head"><span class="n">${weekdayName(d)}, ${shortDate(d)}<small>Still ahead</small></span><span class="t faint">–</span></div></div>`;
    const rows = s.items.filter((r) => r.date === d).sort((a, b) => b.spend - a.spend);
    const tot = rows.reduce((a, r) => a + r.spend, 0); run += tot;
    return group(`${weekdayName(d)}, ${shortDate(d)}${d === t ? ' <span class="faint">· today</span>' : ''}`, `${rows.length ? plural(rows.length, 'purchase') : 'No purchases'} · ${m0(run)} so far${target ? ` of ${m0(target)}` : ''}`, m2(tot),
      rows.map((r) => line(`${esc(r.label)} <span class="faint">· ${CATS[r.cat].label}</span>${pend(r)}${r.spend < 0 ? ' <span class="faint">refund</span>' : ''}`, m2(r.spend))), target && tot > per * 1.5 ? 'warn' : '');
  }).join('');
  const v = vsTarget(s.spend, target);
  sheetPage({ kicker: `This week · ${rangeText(ws, t)}`, title: target ? `${m0(s.spend)} of ${m0(target)}` : 'This week, day by day',
    total: v ? (v.state === 'over' ? `${m0(v.diff)} over` : v.state === 'at' ? 'Right on target' : `${m0(v.diff)} left`) : m2(s.spend), totalClass: v && v.state === 'over' ? 'down' : '',
    note: target ? `An even week would be about ${m0(per)} a day. ${daysLeftInWeek() > 1 && v.state === 'under' ? `About ${m0(v.diff / daysLeftInWeek())} a day keeps us on target.` : ''}` : '', body });
}

function openSheetFor(spec) {
  const [kind, ...a] = spec.split('|');
  if (kind === 'income') return openIncomeSheet(a[0], a[1], a[2]);
  if (!snap() && kind !== 'own' && kind !== 'owe') return;
  if (kind === 'spent') return openSpentSheet(a[0], a[1], a[2], a[3] || 'cat');
  if (kind === 'invest') return openInvestSheet(a[0], a[1], a[2]);
  if (kind === 'moves') return openMovesSheet(a[0], a[1], a[2]);
  if (kind === 'vs') return openVsSheet();
  if (kind === 'tx') return openTxSheet(a[0], a[1]);
  if (kind === 'own') return openOwnSheet(a[0] || '');
  if (kind === 'owe') return openOweSheet();
  if (kind === 'target') return openTargetByDay();
  if (!planData()) return;
  if (kind === 'plan-months') return openPlanMonths();
  if (kind === 'plan-month') return openPlanMonth(a[0]);
  if (kind === 'plan-extra') return openPlanExtra();
  if (kind === 'plan-cash') return openPlanCash();
  if (kind === 'plan-unseen') return openPlanRows('unseen');
  if (kind === 'plan-tuition') return openPlanRows('tuition');
}

// ---------------------------------------------------------------- locked
const FACE = '<svg class="faceid" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8V5.5A2.5 2.5 0 0 1 5.5 3H8M16 3h2.5A2.5 2.5 0 0 1 21 5.5V8M21 16v2.5a2.5 2.5 0 0 1-2.5 2.5H16M8 21H5.5A2.5 2.5 0 0 1 3 18.5V16"/><path d="M8.5 9v1.5M15.5 9v1.5M12 9v4h-1M9 16c1.7 1.3 4.3 1.3 6 0"/></svg>';
function lockedView() {
  const busy = S.lockBusy;
  const msg = S.lockMsg ? `<p class="lock-msg" role="alert">${esc(S.lockMsg)}</p>` : '';
  const head = `<img class="mono" src="icons/icon-192.png?v=3" alt="">`;
  const tourLinkP = `<p class="lock-tour" data-tour-link ${S.tourOn ? '' : 'hidden'}><button type="button" class="linkish" data-tour>Take a tour</button> <span class="faint">with made-up numbers</span></p>`;
  if (S.wantTour) {
    const off = S.tourOn === false, err = !off && S.tourCheck === 'error';
    return `<div class="locked page" data-lock="tour">
    ${head}
    <h2>${off ? 'Tour is off' : err ? 'Couldn’t start the tour' : 'Opening the tour…'}</h2>
    <p>${off ? 'Ours is a private money notebook for two. The tour with made-up numbers is turned off right now. Check back later.'
      : err ? 'Ours couldn’t check whether the tour is on. Check the connection and try again.' : 'A walk through Ours with made-up numbers.'}</p>
    ${err ? '<button type="button" class="btn lock-btn" data-tour-retry>Try again</button>' : ''}
    ${off || err ? '<p class="lock-alt"><button type="button" class="linkish" data-tour-cancel>This is ours? Go to the lock screen</button></p>' : ''}
  </div>`;
  }
  if (S.lockMode === 'unlock') return `<div class="locked page" data-lock="unlock">
    ${head}
    <h2>Ours is locked.</h2>
    <p class="lock-sub">${esc(S.lockHint || 'Unlock with Face ID to open our numbers.')}</p>
    <button type="button" class="btn lock-btn" data-unlock ${busy ? 'disabled' : ''}>${FACE}<span>${busy ? 'Checking…' : 'Unlock with Face ID'}</span></button>
    <p class="lock-fine">If Face ID fails, your phone will offer your passcode.</p>
    ${msg}
    <p class="lock-alt"><button type="button" class="linkish" data-lock-mode="backup">Face ID not working? Use a backup code</button></p>
    <p class="lock-alt lock-alt2"><button type="button" class="linkish" data-lock-mode="setup">New phone or computer? Set up Face ID</button></p>
    ${tourLinkP}
  </div>`;
  if (S.lockMode === 'backup') return `<div class="locked page" data-lock="backup">
    ${head}
    <h2>Use a backup code</h2>
    <p>One of the codes we saved when Ours was set up. Each code works once.</p>
    <form id="backup-form" class="form" autocomplete="off">
      <div class="field"><label for="backup-code">Backup code</label><input id="backup-code" name="code" required maxlength="16" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" placeholder="ABCDE-23456" inputmode="text"></div>
      <button class="btn lock-btn" type="submit" ${busy ? 'disabled' : ''}><span>${busy ? 'Checking…' : 'Open Ours'}</span></button>
    </form>
    ${msg}
    <p class="lock-alt"><button type="button" class="linkish" data-lock-mode="unlock">Back to Face ID</button></p>
  </div>`;
  const needCode = !S.linkKey || S.needCode;
  return `<div class="locked page" data-lock="setup">
    ${head}
    <h2>Set up Face ID</h2>
    <p>Once on each phone or computer. After this, Ours opens only with Face ID, Touch ID or Windows Hello.</p>
    <form id="enroll" class="form" autocomplete="off">
      <div class="field"><label for="enroll-name">Name this device</label><input id="enroll-name" name="name" maxlength="40" required autocomplete="off" placeholder="${esc(exampleDevice())}" value="${esc(S.draftDevice || '')}"></div>
      ${needCode ? `<div class="field"><label for="enroll-code">Setup code or our private link</label><input id="enroll-code" name="code" required autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABCD-2345"><p class="faint field-hint">Get a code on a device that is already unlocked: Worth, then Devices, then Add a device.</p></div>` : ''}
      <button class="btn lock-btn" type="submit" ${busy ? 'disabled' : ''}>${FACE}<span>${busy ? 'Setting up…' : 'Set up Face ID'}</span></button>
    </form>
    ${msg}
    <p class="lock-alt"><button type="button" class="linkish" data-lock-mode="unlock">Already set up? Unlock instead</button></p>
    ${tourLinkP}
  </div>`;
}

// ---------------------------------------------------------------- backup codes
function codesText() {
  const c = S.newCodes;
  return `Ours backup codes\nMade ${fmtStamp(c.made)} (Mountain time)\n\nIf Face ID isn't working, open Ours, tap "Face ID not working? Use a backup code" and type any one of these.\nEach code works once. Making new codes turns these off.\n\n${c.codes.map((x, i) => `${i + 1}. ${x}`).join('\n')}\n`;
}
function codesView() {
  const c = S.newCodes;
  return `<div class="page codes-page" data-codes>
    <p class="kicker">${c.first ? 'Backup codes' : 'New backup codes'}</p>
    <h2 class="page-title">Save these backup codes</h2>
    <p class="lede">If Face ID ever stops working, or a phone is lost, any one of these opens Ours. Each works once.
      <strong>Save these somewhere safe, like your Notes or a printed copy.</strong> They won't be shown again.</p>
    <ol class="code-list">${c.codes.map((x) => `<li><code>${esc(x)}</code></li>`).join('')}</ol>
    <div class="btns"><button type="button" class="btn ghost" data-codes-copy>Copy</button><button type="button" class="btn ghost" data-codes-download>Download</button></div>
    <button type="button" class="btn wide" data-codes-done>I saved them</button>
    <p class="faint" style="font-size:13px;margin:14px 2px 0">${c.first ? 'Both of us use the same codes. ' : 'The old codes no longer work. '}You can make new ones any time in Worth, under Devices with Face ID.</p>
  </div>`;
}
async function copyCodes() {
  try { await navigator.clipboard.writeText(codesText()); toast('Copied. Paste them into Notes.'); }
  catch {
    const ta = document.createElement('textarea'); ta.value = codesText(); ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); let ok = false; try { ok = document.execCommand('copy'); } catch {} ta.remove();
    toast(ok ? 'Copied. Paste them into Notes.' : "Couldn't copy here. Use Download, or write them down.");
  }
}
function downloadCodes() {
  const url = URL.createObjectURL(new Blob([codesText()], { type: 'text/plain' }));
  const a = document.createElement('a'); a.href = url; a.download = 'Ours backup codes.txt'; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function backupBanner() {
  if (S.via !== 'backup' || !S.backupNote) return '';
  const n = S.backup ? S.backup.remaining : null;
  return `<div class="backup-note" role="status"><p><strong>Opened with a backup code.</strong>${n === null ? '' : ` ${n} ${n === 1 ? 'code' : 'codes'} left.`} Set up Face ID on this device so next time it opens normally.</p>
    <div class="btns"><button type="button" class="btn small" data-reenroll>Set up Face ID</button><button type="button" class="btn ghost small" data-backup-note-close>Not now</button></div></div>`;
}
function confirmNewCodes() {
  openSheet(`<h3>Make new backup codes?</h3><p>You'll get 8 new codes to save. The old ones, used or not, stop working right away.</p>
    <div class="btns"><button type="button" class="btn" data-confirm>Make new codes</button><button type="button" class="btn ghost" data-close>Cancel</button></div>`,
  async (e) => {
    if (!e.target.closest('[data-confirm]')) return;
    closeSheet();
    try {
      const r = await Auth.call('backup-new', { session: S.session });
      S.backup = r.backup; S.newCodes = { codes: r.codes, made: new Date().toISOString(), first: false }; render(); window.scrollTo({ top: 0 });
    } catch (err) {
      if (err.code === 'locked') return lockNow('Your sign-in ended. Unlock again to keep going.', { revoke: false });
      toast("Couldn't make new codes. The old ones still work. Try again.");
    }
  });
}

// ---------------------------------------------------------------- devices
const shortDay = (iso) => new Date(iso).toLocaleDateString('en-US', { timeZone: TZ, month: 'short', day: 'numeric', year: new Date(iso).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
function devicesBlock() {
  if (S.demo) return `<section class="section" id="devices"><p class="kicker">Devices with Face ID</p>
    <div class="card"><ul class="rows dev-rows">
      <li class="dev"><span class="name"><span>Maya’s iPhone <span class="pill">This device</span></span><span class="faint dev-meta">Example · last unlocked this morning</span></span></li>
      <li class="dev"><span class="name"><span>Theo’s laptop</span><span class="faint dev-meta">Example · synced passkey</span></span></li>
    </ul>
    <p class="faint" style="font-size:13px;margin:12px 0 0">In the real Ours, only the devices listed here can open it, with Face ID, Touch ID or Windows Hello, and 8 one-time backup codes cover a lost phone. In the tour this is only an example.</p></div>
  </section>`;
  if (!S.session) return '';
  if (S.testSession) return '<section class="section" id="devices"><p class="kicker">Devices with Face ID</p><div class="card"><p class="muted">Box test session: devices are not shown.</p></div></section>';
  if (!S.devices) loadDevices();
  const list = S.devices || [];
  const rows = S.devices ? list.map((d) => `<li class="dev"><span class="name"><span>${esc(d.name)}${d.this_device ? ' <span class="pill">This device</span>' : ''}</span>
      <span class="faint dev-meta">Added ${shortDay(d.created_at)}${d.last_used_at ? ` · last unlocked ${fmtStamp(d.last_used_at)}` : ''}${d.synced ? ' · synced passkey' : ''}</span></span>
      <button type="button" class="btn ghost small" data-dev-remove="${esc(d.id)}">Remove</button></li>`).join('') || '<li class="muted">No devices.</li>'
    : '<li class="muted">Loading…</li>';
  return `<section class="section" id="devices">
    <p class="kicker">Devices with Face ID</p>
    <div class="card"><ul class="rows dev-rows">${rows}</ul>
      ${S.via === 'backup' ? '<p class="muted" style="font-size:14px;margin:12px 0 0">This device is open with a backup code. <button type="button" class="linkish" data-reenroll>Set up Face ID here</button></p>' : ''}
      <p class="faint" style="font-size:13px;margin:12px 0 0">Only these can open Ours. Sign-in lasts up to 12 hours and locks again after 5 minutes away.</p>
      <div class="btns" style="margin-top:14px"><button type="button" class="btn" data-dev-invite>Add a device</button><button type="button" class="btn ghost" data-lock-now>Lock now</button></div>
    </div>
    <div class="card backup-card">
      <div class="backup-row"><span class="name">Backup codes<span class="faint dev-meta">${S.backup ? (S.backup.total ? `${S.backup.remaining} of ${S.backup.total} left${S.backup.made_at ? ` · made ${shortDay(S.backup.made_at)}` : ''}` : 'None yet') : 'Loading…'}</span></span>
      <button type="button" class="btn ghost small" data-codes-new>New codes</button></div>
      <p class="faint" style="font-size:13px;margin:10px 0 0">${S.backup && S.backup.total && S.backup.remaining <= 2 ? '<span class="warn">Running low. Make new ones so there is always a way in.</span> ' : ''}Each opens Ours once if Face ID isn't working. Making new codes turns off the old ones.</p>
    </div>
  </section>`;
}
let devLoading = false;
async function loadDevices() {
  if (devLoading || !S.session) return;
  devLoading = true;
  try { const r = await Auth.call('devices', { session: S.session }); S.devices = r.devices || []; if (r.backup) S.backup = r.backup; if (r.via) S.via = r.via; }
  catch (e) { if (e.code === 'locked') { devLoading = false; return lockNow('Your sign-in ended. Unlock again to keep going.', { revoke: false }); } S.devices = S.devices || []; }
  devLoading = false;
  if (S.session && S.page === 'worth') { const y = window.scrollY; render(); window.scrollTo({ top: y }); }
}
function confirmRemoveDevice(id) {
  const d = (S.devices || []).find((x) => x.id === id); if (!d) return;
  const last = S.devices.length <= 1;
  const body = last
    ? `<p><strong>This is the last device.</strong> After removing it, nobody can open Ours until a device is set up again with our private link.</p>`
    : `<p>${d.this_device ? 'This device locks right away and' : 'It'} won't be able to open Ours anymore. You can set it up again later with a setup code.</p>`;
  openSheet(`<h3>Remove ${esc(d.name)}?</h3>${body}
    <div class="btns"><button type="button" class="btn danger" data-confirm>${last ? 'Remove the last device' : 'Remove it'}</button><button type="button" class="btn ghost" data-close>Keep it</button></div>`,
  async (e) => {
    if (!e.target.closest('[data-confirm]')) return;
    closeSheet();
    try {
      const r = await Auth.call('device-remove', { session: S.session, id, confirmLast: last });
      if (r.signed_out) { try { localStorage.removeItem(ENROLLED); } catch {} lockNow(`${d.name} was removed.`, { revoke: false }); return; }
      S.devices = r.devices || S.devices.filter((x) => x.id !== id); render(); toast(`${d.name} removed.`);
    } catch (err) {
      if (err.code === 'locked') return lockNow('Your sign-in ended. Unlock again to keep going.', { revoke: false });
      toast(err.message && err.code !== 'network' ? err.message : "Couldn't remove it. Nothing changed. Try again.");
    }
  });
}
async function openInvite() {
  try {
    const r = await Auth.call('invite', { session: S.session });
    const mins = Math.max(1, Math.round((Date.parse(r.expires_at) - Date.now()) / 60e3));
    openSheet(`<h3>Setup code</h3>
      <p class="invite-code" aria-label="Setup code">${esc(r.code)}</p>
      <p>On the new phone or computer, open Ours, tap <em>Set up Face ID</em>, name it, and type this code. It works once, for the next ${mins} minutes.</p>
      <div class="btns"><button type="button" class="btn ghost" data-close>Done</button></div>`, () => {});
  } catch (err) {
    if (err.code === 'locked') return lockNow('Your sign-in ended. Unlock again to keep going.', { revoke: false });
    toast(err.message && err.code !== 'network' ? err.message : "Couldn't make a setup code. Try again.");
  }
}

// ---------------------------------------------------------------- demo tour
// A walk through every page with a made-up household (js/demo.js). It runs the same views and drill-downs, but
// S.data comes from the generator, writes are answered in memory (see rpc), and it never asks Supabase for data.
// The only network call is the public yes/no switch: ours_demo_enabled() returns a single boolean.
async function checkTour() {
  S.tourCheck = 'checking';
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/ours_demo_enabled`, {
      method: 'POST', signal: ctrl.signal, cache: 'no-store', headers: { apikey: SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' }, body: '{}',
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    S.tourOn = (await r.json()) === true; S.tourCheck = '';
  } catch { S.tourCheck = 'error'; } finally { clearTimeout(timer); }
  if (S.wantTour && !S.session && !S.demo) { if (S.tourOn) startTour(); else render(); return; }
  // On the lock screen just show or hide the link, so nothing being typed is disturbed.
  document.querySelectorAll('[data-tour-link]').forEach((el) => { el.hidden = !S.tourOn; });
}
function startTour() {
  if (S.session) return;
  if (AUTO.ctrl) { const c = AUTO.ctrl; AUTO.ctrl = null; AUTO.lastEnd = Date.now(); c.abort(); }
  AUTO.armed = false;
  Object.assign(S, { demo: true, wantTour: false, lockMsg: '', lockHint: '', lockBusy: false, spendPeriod: 'this', openCat: null, actFilter: 'all', actLimit: 80, editing: null, draftShape: 'car' });
  planMemo = { rows: null, items: null, facts: null, out: null };
  setData(makeDemo(today(), S.demoSeed));
  if (!S.facts) loadFacts();
  writeHash(true); render(); window.scrollTo({ top: 0 });
}
function exitTour() {
  Object.assign(S, { demo: false, wantTour: false, data: null, rows: [], editing: null, page: 'week', lockMode: S.linkKey && !enrolledHere() ? 'setup' : 'unlock', lockMsg: '', lockHint: '' });
  planMemo = { rows: null, items: null, facts: null, out: null };
  closeSheet(); writeHash(true); render(); window.scrollTo({ top: 0 });
  checkTour();
}
function shuffleTour() {
  S.demoSeed = 2 + Math.floor(Math.random() * 9000);
  planMemo = { rows: null, items: null, facts: null, out: null }; S.editing = null; closeSheet();
  setData(makeDemo(today(), S.demoSeed)); render();
  toast('New made-up numbers. Anything changed in the tour was reset.');
}
function renderRibbon() {
  const rb = $('#demo-ribbon'); if (!rb) return;
  rb.hidden = !S.demo;
  rb.innerHTML = S.demo ? `<div class="demo-inner"><span class="demo-txt"><b>Demo tour:</b> made-up numbers</span>
    <span class="demo-btns"><button type="button" class="linkish" data-tour-shuffle>Shuffle</button><button type="button" class="btn small" data-tour-exit>Exit tour</button></span></div>` : '';
}
const tourLink = () => new URL('tour/', location.href.split('#')[0]).href;
function tourIsOn() { const v = S.data && S.data.settings ? S.data.settings.demo_enabled : undefined; return v === undefined || v === null ? true : v === true; }
function tourCard() {
  if (S.demo || !S.session) return '';
  const on = tourIsOn();
  return `<section class="section" id="tour-card"><p class="kicker">Tour for friends</p>
    <div class="card tour-card">
      <div class="tour-row"><span class="name">${on ? 'The tour is on' : 'The tour is off'}<span class="faint dev-meta">${on ? 'The lock screen shows “Take a tour”, and the link below opens it.' : 'No tour link on the lock screen, and the link below says the tour is off.'}</span></span>
        <button type="button" class="switch" role="switch" aria-checked="${on}" aria-label="Tour for friends" data-tour-toggle><span></span></button></div>
      <p class="muted" style="font-size:14px;margin:12px 0 0">A walk through every page with a made-up couple and made-up numbers. It can’t see any of ours: our numbers still open only with Face ID.</p>
      <div class="tour-link-row"><code>${esc(tourLink())}</code></div>
      <div class="btns" style="margin-top:12px"><button type="button" class="btn ghost small" data-tour-copy>Copy link</button><a class="btn ghost small" href="${esc(tourLink())}" target="_blank" rel="noopener">Preview</a></div>
    </div>
  </section>`;
}
async function setTour(on) {
  const prev = S.data.settings ? { ...S.data.settings } : {};
  S.data.settings = { ...prev, demo_enabled: on }; render();
  try {
    await rpc('ours_setting_set', { p_name: 'demo_enabled', p_value: on });
    S.tourOn = on;
    toast(on ? 'Tour is on. Friends can open it from the lock screen or the link.' : 'Tour is off. The lock screen link is gone and the tour link says it’s off.');
  } catch (e) {
    if (!S.session) return;
    S.data.settings = prev; render(); toast('Couldn’t change the tour. Nothing changed. Try again.');
  }
}
async function copyText(text, okMsg) {
  try { await navigator.clipboard.writeText(text); toast(okMsg); return; } catch {}
  const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select(); let ok = false; try { ok = document.execCommand('copy'); } catch {} ta.remove();
  toast(ok ? okMsg : `Couldn’t copy here. The link is ${text}`, 7000);
}

// ---------------------------------------------------------------- sheet
let sheetHandler = null;
function openSheet(html, onClick) {
  sheetHandler = onClick;
  $('#sheet-root').innerHTML = `<div class="scrim" data-close></div><div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
  const first = $('#sheet-root .sheet button'); if (first) first.focus();
}
function closeSheet() { $('#sheet-root').innerHTML = ''; sheetHandler = null; }
$('#sheet-root').addEventListener('click', (e) => {
  if (e.target.closest('[data-close]')) return closeSheet();
  if (sheetHandler) sheetHandler(e);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') return closeSheet();
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('[role=button][data-sheet]')) { e.preventDefault(); openSheetFor(e.target.dataset.sheet); }
});

// ---------------------------------------------------------------- events
document.addEventListener('click', (e) => {
  const t = e.target;
  if (t.closest('[data-tour]')) { e.preventDefault(); if (S.tourOn && !S.session) startTour(); return; }
  if (t.closest('[data-tour-exit]')) { exitTour(); return; }
  if (t.closest('[data-tour-shuffle]')) { shuffleTour(); return; }
  if (t.closest('[data-tour-retry]')) { S.tourCheck = 'checking'; render(); checkTour(); return; }
  if (t.closest('[data-tour-cancel]')) { S.wantTour = false; writeHash(true); render(); return; }
  if (t.closest('[data-tour-toggle]')) { if (S.session && !S.demo) setTour(!tourIsOn()); return; }
  if (t.closest('[data-tour-copy]')) { copyText(tourLink(), 'Copied. Send it to anyone you want to show.'); return; }
  if (t.closest('[data-unlock]')) { doUnlock(); return; }
  const lm = t.closest('[data-lock-mode]'); if (lm) { if (AUTO.ctrl) { const c = AUTO.ctrl; AUTO.ctrl = null; AUTO.lastEnd = Date.now(); c.abort(); } S.lockMode = lm.dataset.lockMode; S.lockMsg = ''; render(); const f = $('#enroll-name') || $('#backup-code'); if (f) f.focus(); return; }
  if (t.closest('[data-lock-now]')) { lockNow(''); return; }
  if (t.closest('[data-codes-copy]')) { copyCodes(); return; }
  if (t.closest('[data-codes-download]')) { downloadCodes(); return; }
  if (t.closest('[data-codes-done]')) { S.newCodes = null; render(); window.scrollTo({ top: 0 }); return; }
  if (t.closest('[data-codes-new]')) { confirmNewCodes(); return; }
  if (t.closest('[data-reenroll]')) { openReenroll(); return; }
  if (t.closest('[data-backup-note-close]')) { S.backupNote = false; render(); return; }
  if (t.closest('[data-dev-invite]')) { openInvite(); return; }
  const dr = t.closest('[data-dev-remove]'); if (dr) { confirmRemoveDevice(dr.dataset.devRemove); return; }
  if (!isOpen()) return;
  const nav = t.closest('[data-page]'); if (nav) { e.preventDefault(); go(nav.dataset.page); return; }
  const per = t.closest('[data-period]'); if (per) { S.spendPeriod = per.dataset.period; S.openCat = null; render(); return; }
  const cat = t.closest('[data-cat]'); if (cat) { S.openCat = S.openCat === cat.dataset.cat ? null : cat.dataset.cat; render(); return; }
  if (t.closest('[data-target-edit]')) { openTargetSheet(); return; }
  const sh = t.closest('[data-sheet]'); if (sh) { openSheetFor(sh.dataset.sheet); return; }
  const fix = t.closest('[data-fix]'); if (fix) { openFixSheet(fix.dataset.fix, fix.dataset.label, fix.dataset.cur); return; }
  const unfix = t.closest('[data-unfix]'); if (unfix) {
    const key = unfix.dataset.unfix; const f = S.data.fixes.find((x) => x.merchant_key === key);
    const prev = S.data.fixes.slice(); S.data.fixes = S.data.fixes.filter((x) => x.merchant_key !== key); setData(S.data); render();
    rpc('ours_fix_clear', { p_merchant_key: key }).then(() => { saveCache(); toast(`${f ? f.merchant_label : 'It'} is back to automatic.`); })
      .catch(() => { S.data.fixes = prev; setData(S.data); render(); toast("Couldn't undo that fix. Try again."); });
    return;
  }
  const shape = t.closest('[data-shape]'); if (shape) {
    const form = $('#item-form'); const keep = { name: form.name.value, amount: form.amount.value };
    if (S.editing) S.editing.shape = shape.dataset.shape; else S.draftShape = shape.dataset.shape;
    render(); const f2 = $('#item-form'); f2.name.value = keep.name; f2.amount.value = keep.amount; return;
  }
  const ed = t.closest('[data-edit]'); if (ed) { const it = S.data.items.find((i) => i.id === ed.dataset.edit); S.editing = { ...it }; render(); $('#things').scrollIntoView({ behavior: 'smooth', block: 'start' }); $('#item-name').focus({ preventScroll: true }); return; }
  if (t.closest('[data-cancel-edit]')) { S.editing = null; render(); return; }
  const del = t.closest('[data-del]'); if (del) { confirmDelete(del.dataset.del); return; }
  const act = t.closest('[data-act]'); if (act) { S.actFilter = act.dataset.act; S.actLimit = 80; render(); return; }
  if (t.closest('[data-more]')) { S.actLimit += 120; render(); return; }
});
document.addEventListener('submit', (e) => {
  if (e.target.id === 'item-form') { e.preventDefault(); submitItem(e.target); }
  if (e.target.id === 'target-form') {
    e.preventDefault();
    const raw = String(e.target.amount.value).replace(/[$,\s]/g, '');
    if (raw === '') return toast('Type a dollar amount, like 400.');
    const n = Number(raw);
    if (!isFinite(n) || n < 1 || n > 1000000) return toast('Use a dollar amount, like 400.');
    saveTarget(Math.round(n * 100) / 100);
  }
  if (e.target.id === 'enroll') { e.preventDefault(); doEnroll(e.target); }
  if (e.target.id === 'backup-form') { e.preventDefault(); doBackup(e.target); }
  if (e.target.id === 'reenroll-form') { e.preventDefault(); doReenroll(e.target); }
});
$('#refresh').addEventListener('click', () => { if (!isOpen()) return; if (!S.facts) loadFacts(); load({ manual: true }); });
window.addEventListener('popstate', () => {
  const { p, tour } = readHash();
  if (S.demo && !tour) return exitTour();
  if (!S.demo && !S.session && tour) { S.wantTour = true; S.page = PAGES.some(([id]) => id === p) ? p : 'week'; if (S.tourOn) startTour(); else { render(); checkTour(); } return; }
  S.page = PAGES.some(([id]) => id === p) ? p : 'week'; render();
});
window.addEventListener('scroll', () => $('.top').classList.toggle('scrolled', window.scrollY > 4), { passive: true });
// Lock again after 5 minutes in the background, or when the 12-hour sign-in runs out.
function checkAway() {
  if (!S.session) return;
  if (S.hiddenAt && Date.now() - S.hiddenAt > LOCK_AFTER_MS) return lockNow('Locked after a few minutes away.');
  if (!sessionLive()) return lockNow('Signed out after 12 hours. Unlock again to keep going.', { revoke: false });
  S.hiddenAt = 0;
  if (S.data && Date.now() - (S.lastLoad || 0) > 5 * 60e3) { S.lastLoad = Date.now(); load(); }
}
// Coming back into view while locked (or locking now because we were away 5+ minutes) earns one automatic Face ID try.
// A hide that happened while a prompt was up (the system sheet itself) doesn't count, and neither does one right after a cancel.
function backInView() {
  const hiddenFor = AUTO.hiddenAt ? Date.now() - AUTO.hiddenAt : 0;
  const duringPrompt = AUTO.hiddenDuringPrompt;
  AUTO.hiddenAt = 0; AUTO.hiddenDuringPrompt = false;
  checkAway();
  if (!S.session && hiddenFor > 0 && !duringPrompt) { armAuto(); maybeAutoUnlock(); }
}
function wentAway() {
  if (S.session && !S.hiddenAt) S.hiddenAt = Date.now();
  if (!AUTO.hiddenAt) { AUTO.hiddenAt = Date.now(); AUTO.hiddenDuringPrompt = !!(AUTO.ctrl || S.lockBusy); }
}
document.addEventListener('visibilitychange', () => {
  // Blur the numbers while away, so the app switcher's snapshot doesn't show them.
  document.body.classList.toggle('away', document.visibilityState === 'hidden');
  if (document.visibilityState === 'hidden') return wentAway();
  backInView();
});
window.addEventListener('pagehide', wentAway);
window.addEventListener('pageshow', (e) => { if (e.persisted) backInView(); });
window.addEventListener('focus', checkAway);

// ---------------------------------------------------------------- boot
$('.brand-name').textContent = BRAND_NAME; $('.brand-sub').textContent = SUBTITLE;
document.title = `${BRAND_NAME} · ${SUBTITLE}`;
initKey();
loadFacts();
render();
checkTour();
Auth.supported().then((r) => { if (!r.ok && !S.session) { S.lockMsg = r.why; render(); } });
// First open: try Face ID straight away (Safari may want a tap instead; then the button says so quietly).
if (!window.__OURS_TEST_SESSION__) { armAuto(); maybeAutoUnlock(); }
// Test hook for the box's headless checks: a token set before load is still checked by the server like any other.
if (window.__OURS_TEST_SESSION__) S.testSession = true, startSession({ session: window.__OURS_TEST_SESSION__, expires_at: new Date(Date.now() + 3600e3).toISOString() });
