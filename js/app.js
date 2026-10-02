import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, STALE_AFTER_HOURS } from './config.js';
import {
  TZ, CATS, CAT_KEYS, KINDS, classifyAll, summarize, buildLetter, worth, gaps, weekStart, addDays,
  todayLocal, weekLabel, shortDate, weekdayName, counts,
} from './logic.js?v=3';

// ---------------------------------------------------------------- state
const CACHE = 'ours.cache.v1';
const KEYSTORE = 'ours.key';
const PAGES = [
  ['week', 'Week'], ['spend', 'Spend'], ['worth', 'Worth'], ['activity', 'Activity'], ['history', 'History'],
];
const S = {
  key: null, page: 'week', data: null, rows: [], busy: false, fromCache: false, loadError: null,
  spendPeriod: 'this', openCat: null, actFilter: 'all', actLimit: 80, editing: null, draftShape: 'car',
};

// ---------------------------------------------------------------- utils
const $ = (s, el = document) => el.querySelector(s);
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
  return { k: h.get('k'), p: h.get('p') };
}
function writeHash(replace = false) {
  const h = new URLSearchParams();
  if (S.key) h.set('k', S.key);
  if (S.page !== 'week') h.set('p', S.page);
  const url = `${location.pathname}${location.search}#${h.toString()}`;
  if (replace) history.replaceState(null, '', url); else history.pushState(null, '', url);
}
function initKey() {
  const { k, p } = readHash();
  if (k) { S.key = k; try { localStorage.setItem(KEYSTORE, k); } catch {} }
  else { try { S.key = localStorage.getItem(KEYSTORE); } catch {} }
  if (p && PAGES.some(([id]) => id === p)) S.page = p;
  if (S.key && !k) writeHash(true); // keep the key in the link so a home-screen copy opens straight in
}

// ---------------------------------------------------------------- api
async function rpc(fn, body, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST', signal: ctrl.signal, cache: 'no-store',
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_key: S.key, ...body }),
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
function saveCache() { try { localStorage.setItem(CACHE, JSON.stringify(S.data)); } catch {} }
function loadCache() { try { const c = localStorage.getItem(CACHE); return c ? JSON.parse(c) : null; } catch { return null; } }

let pollTimer = null;
async function load({ manual = false } = {}) {
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
    if (e.message === 'locked') { S.busy = false; S.key = null; try { localStorage.removeItem(KEYSTORE); } catch {} render(); return; }
    S.loadError = e;
    if (S.data) toast(`Couldn't reach our notebook. Showing the last copy, from ${fmtStamp(S.data.snapshot ? S.data.snapshot.pulled_at : S.data.server_time, false)}.`, 6000);
  } finally {
    S.busy = false; render(); schedulePoll();
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
  if (!snap) { el.textContent = S.key ? 'No bank pull yet' : ''; return; }
  const shortD = new Date(snap.pulled_at).toLocaleDateString('en-US', { timeZone: TZ, month: 'short', day: 'numeric' });
  el.innerHTML = `<span class="s-long">Updated ${fmtStamp(snap.pulled_at)}</span><span class="s-short">Updated ${shortD}</span>`;
  el.title = `Balances as of ${fmtStamp(snap.pulled_at)} Mountain time`;
  if (hoursOld(snap.pulled_at) > STALE_AFTER_HOURS || S.loadError) el.classList.add('old');
}
function render() {
  renderNav(); renderStatus();
  const main = $('#main');
  if (!S.key) { main.innerHTML = lockedView(); return; }
  if (!S.data) { main.innerHTML = `<div class="page"><p class="empty">${S.busy ? 'Opening our notebook…' : "Couldn't reach our notebook. Check the connection and tap the refresh button."}</p></div>`; return; }
  const view = { week: weekView, spend: spendView, worth: worthView, activity: activityView, history: historyView }[S.page];
  main.innerHTML = `<div class="page">${view()}</div>`;
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
  return `
  <section class="hero">
    <p class="kicker">What's left</p>
    <p class="big">${bigMoney(w.left)}</p>
    <p class="hero-note">What we own minus what we owe${w.stuff || w.owedItems ? ', including the things we added' : ''}.</p>
    <div class="tiles">
      <div class="tile"><div class="label">We own</div><div class="num">${m0(w.own)}</div></div>
      <div class="tile"><div class="label">We owe</div><div class="num ${w.owe > 0 ? 'down' : ''}">${m0(w.owe)}</div></div>
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
      const a = `<circle cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke="${p.color}" stroke-width="16" stroke-dasharray="${Math.max(0, len - gap)} ${c}" stroke-dashoffset="${-off}" transform="rotate(-90 ${cx} ${cx})"/>`;
      off += len; return a;
    }).join('');
  const top = parts.filter((p) => p.value > 0).sort((a, b) => b.value - a.value)[0];
  const center = top && total > 0 ? `<text x="${cx}" y="${cx - 2}" text-anchor="middle" font-size="26">${Math.round((top.value / total) * 100)}%</text><text x="${cx}" y="${cx + 18}" text-anchor="middle" font-size="11.5" style="font-family:var(--body);fill:var(--muted)">${esc(top.short)}</text>` : '';
  return `<svg class="donut" viewBox="0 0 ${size} ${size}" role="img" aria-label="What we own, split by kind">${arcs}${center}</svg>`;
}
function ownBlock(w, onWorth = false) {
  const parts = [
    { name: 'Cash in the bank', short: 'cash', value: w.cash, color: '#5b8f47' },
    { name: 'Investments', short: 'invested', value: w.invest, color: '#d4c6a4' },
    { name: 'Things we added', short: 'things', value: w.stuff, color: '#b3a892' },
  ];
  const total = parts.reduce((s, p) => s + Math.max(0, p.value), 0) || 1;
  return `
  <section class="section">
    <p class="kicker">What we own</p>
    <div class="card own">
      ${donut(parts)}
      <ul class="rows">
        ${parts.map((p) => `<li><span class="dot" style="background:${p.color}"></span><span class="name">${p.name}</span><span class="amt">${m0(p.value)}</span><span class="pct">${Math.round((Math.max(0, p.value) / total) * 100)}%</span></li>`).join('')}
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
  const w = worth(snap(), S.data.items || []);
  let html = staleBanner() + heroBlock(w) + ownBlock(w);
  if (!snap()) return html + '<section class="section"><p class="empty">The weekly letter shows up after the first bank pull.</p></section>';
  const L = buildLetter(S.rows, today(), snap().coverage && snap().coverage.from);
  const last = L.last;
  const top = last.cats.slice(0, 3).map(([c, v]) => `${CATS[c].label} ${m0(v)}`).join(' · ') || 'Nothing yet';
  const verdictClass = { more: 'down', less: 'up', same: '', none: 'muted' }[L.verdict];
  const pick = L.storyPick;
  const tw = summarize(S.rows, weekStart(today()), today());
  html += `
  <section class="section">
    <article class="letter">
      <div class="letter-head"><h3>Last week's letter</h3><span class="letter-dates">${weekLabel(L.lastWs)}</span></div>
      <p class="story">${L.story.map(esc).join(' ')}</p>
      <p class="normal"><b class="${verdictClass}">Is this normal?</b> ${esc(L.normal)}</p>
      <ol class="numbered">
        <li><span class="t">Consumer spending</span><span class="v">${m2(last.spend)}${last.pending > 0 ? ` <small class="warn">Includes ${m2(last.pending)} still pending</small>` : ''}</span></li>
        <li><span class="t">vs last week</span><span class="v ${L.vsPrev > 0.5 ? 'down' : L.vsPrev < -0.5 ? 'up' : ''}">${Math.abs(L.vsPrev) < 0.5 ? 'About the same' : `${m2(Math.abs(L.vsPrev))} ${L.vsPrev > 0 ? 'more' : 'less'}`} <small>than the week before (${m2(L.prev.spend)})</small></span></li>
        <li><span class="t">Top categories</span><span class="v">${esc(top)}</span></li>
        <li><span class="t">Story item</span><span class="v">${pick ? `${esc(pick.label)} · ${m2(pick.spend)} <small>${weekdayName(pick.date)}${pick.note ? ` · “${esc(pick.note)}”` : ''}</small>` : 'Nothing stood out.'}</span></li>
        <li><span class="t">Investing</span><span class="v">${last.investing > 0 ? `${m2(last.investing)} <small>into Bitcoin (River). Not spending.</small>` : 'Nothing this week.'}</span></li>
        <li><span class="t">Income received</span><span class="v"><button type="button" class="linkish ${last.income > 0 ? 'up' : ''}" data-income="${L.lastWs}|${addDays(L.lastWs, 6)}|Last week">${m2(last.income)}</button> <small>${last.incomeRows.length ? 'Tap to see who paid us.' : 'Nothing came in.'}</small></span></li>
        <li><span class="t">Transfers and card payments</span><span class="v">${m2(last.transfers)} <small>moved between our accounts</small> · ${m2(last.cardPayments)} <small>paid to cards. Not new spending.</small></span></li>
      </ol>
    </article>
  </section>
  <section class="section">
    <p class="kicker">This week so far · ${shortDate(weekStart(today()))} to today</p>
    <div class="sofar">
      <div class="tile"><div class="label">Spent</div><div class="num">${m0(tw.spend)}</div>${tw.pending > 0 ? `<div class="warn" style="font-size:13px;margin-top:4px">Includes ${m2(tw.pending)} still pending</div>` : ''}</div>
      <button type="button" class="tile" data-income="${weekStart(today())}|${today()}|This week so far"><div class="label">Earned</div><div class="num ${tw.income > 0 ? 'up' : ''}">${m0(tw.income)}</div><div class="tap-hint">${tw.incomeRows.length ? 'See sources' : 'Nothing in yet'} <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5"/></svg></div></button>
    </div>
  </section>
  ${gapsBlock()}`;
  return html;
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
    ${holdings.length ? '<p class="faint" style="font-size:13px;margin:10px 0 0">Counted once, as part of the River Bitcoin account balance.</p>' : ''}</div>
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
  return html;
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
  html += `<table class="hist"><thead><tr><th>Week</th><th>Spending</th><th>vs week before</th><th>Income</th><th>Investing</th></tr></thead><tbody>
    ${rowsData.map((r) => `<tr class="${r.current ? 'current' : ''}"><td>${weekLabel(r.w.from)}</td><td>${m0(r.w.spend)}</td><td>${vs(r)}</td><td><button type="button" class="linkish ${r.w.income > 0 ? 'up' : 'faint'}" data-income="${r.w.from}|${r.w.to}|${r.current ? 'This week so far' : 'Week'}">${m0(r.w.income)}</button></td><td class="${r.w.investing > 0 ? 'warn' : 'faint'}">${m0(r.w.investing)}</td></tr>`).join('')}
  </tbody></table>
  <div class="hist-cards">${rowsData.map((r) => `<div class="hcard"><div class="top-row"><span class="wk">${weekLabel(r.w.from)}${r.current ? ' <span class="faint">· so far</span>' : ''}</span><span class="sp">${m0(r.w.spend)}</span></div>
    <div class="meta"><span>vs before ${vs(r)}</span><span>In <button type="button" class="linkish ${r.w.income > 0 ? 'up' : ''}" data-income="${r.w.from}|${r.w.to}|${r.current ? 'This week so far' : 'Week'}">${m0(r.w.income)}</button></span><span>Invested <span class="${r.w.investing > 0 ? 'warn' : ''}">${m0(r.w.investing)}</span></span></div></div>`).join('')}</div>
  <p class="foot">Activity starts ${shortDate(from)}${from.slice(0, 4) !== t.slice(0, 4) ? ' ' + from.slice(0, 4) : ''}, so the oldest week may be partial.</p>`;
  return html;
}

// ---------------------------------------------------------------- earned sheet
// Uses the same summarize() as the letter and History, so the total here always matches the number tapped.
function openIncomeSheet(from, to, title) {
  const s = summarize(S.rows, from, to);
  const groups = new Map();
  for (const r of s.incomeRows) {
    const g = groups.get(r.key) || { label: r.label, total: 0, rows: [] };
    g.total += r.amount; g.rows.push(r); groups.set(r.key, g);
  }
  const list = [...groups.values()].sort((a, b) => b.total - a.total);
  list.forEach((g) => g.rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)));
  const range = to >= today() && from <= today() ? `${shortDate(from)} to today` : `${shortDate(from)} – ${shortDate(to)}`;
  const n = s.incomeRows.length;
  const body = !n ? '<p class="empty" style="margin-top:18px">Nothing came in during these days. Transfers between our own accounts and card refunds are not counted as income.</p>' :
    list.map((g) => {
      const accts = [...new Set(g.rows.map((r) => (r.acct ? r.acct.display : '')))].filter(Boolean);
      return `<div class="inc-group"><div class="inc-head"><span class="n">${esc(g.label)}<small>${g.rows.length} ${g.rows.length === 1 ? 'deposit' : 'deposits'}${accts.length === 1 ? ` · into ${esc(accts[0])}` : ''}</small></span><span class="t ${g.total > 0 ? 'up' : ''}">${m2(g.total)}</span></div>
        <ul class="inc-rows">${g.rows.map((r) => `<li><span class="w">${weekdayName(r.date).slice(0, 3)} ${shortDate(r.date)}${accts.length === 1 ? '' : ` · ${esc(r.acct ? r.acct.display : '')}`}${r.pending ? ' · pending' : ''}${r.note ? ` · “${esc(r.note)}”` : ''}</span><span class="a">${signed(r.amount)}</span></li>`).join('')}</ul></div>`;
    }).join('');
  openSheet(`<button type="button" class="iconbtn sheet-x" data-close aria-label="Close"><svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3.5 3.5l9 9M12.5 3.5l-9 9"/></svg></button>
    <p class="kicker" style="margin-bottom:4px">${esc(title)} · ${range}</p>
    <h3>Where the money came from</h3>
    <div class="inc-total ${s.income > 0 ? 'up' : ''}">${m2(s.income)}</div>
    <p class="muted" style="margin:0;font-size:14px">${n ? `${n} ${n === 1 ? 'deposit' : 'deposits'} from ${list.length} ${list.length === 1 ? 'source' : 'sources'}. Same income the letter counts. Transfers between our own accounts are left out.` : ''}</p>
    ${body}
    <div class="btns"><button type="button" class="btn ghost" data-close>Done</button></div>`);
}

// ---------------------------------------------------------------- locked
function lockedView() {
  return `<div class="locked page">
    <img class="mono" src="icons/icon-192.png" alt="">
    <h2>This notebook is private.</h2>
    <p>Open it from the link we saved, or paste that link here.</p>
    <form id="unlock" class="form"><div class="field"><label for="unlock-key">Link or key</label><input id="unlock-key" required autocomplete="off" spellcheck="false"></div><button class="btn" type="submit">Open</button></form>
  </div>`;
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
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });

// ---------------------------------------------------------------- events
document.addEventListener('click', (e) => {
  const t = e.target;
  const nav = t.closest('[data-page]'); if (nav) { e.preventDefault(); go(nav.dataset.page); return; }
  const per = t.closest('[data-period]'); if (per) { S.spendPeriod = per.dataset.period; S.openCat = null; render(); return; }
  const cat = t.closest('[data-cat]'); if (cat) { S.openCat = S.openCat === cat.dataset.cat ? null : cat.dataset.cat; render(); return; }
  const inc = t.closest('[data-income]'); if (inc) { const [f, to, title] = inc.dataset.income.split('|'); openIncomeSheet(f, to, title); return; }
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
  if (e.target.id === 'unlock') {
    e.preventDefault();
    const v = $('#unlock-key').value.trim();
    const m = v.match(/[#&]k=([^&\s]+)/); const key = m ? decodeURIComponent(m[1]) : v;
    if (!key) return;
    S.key = key; try { localStorage.setItem(KEYSTORE, key); } catch {}
    writeHash(true); load();
  }
});
$('#refresh').addEventListener('click', () => load({ manual: true }));
window.addEventListener('popstate', () => { const { p } = readHash(); S.page = PAGES.some(([id]) => id === p) ? p : 'week'; render(); });
window.addEventListener('scroll', () => $('.top').classList.toggle('scrolled', window.scrollY > 4), { passive: true });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && S.key && S.data && Date.now() - (S.lastLoad || 0) > 5 * 60e3) { S.lastLoad = Date.now(); load(); }
});

// ---------------------------------------------------------------- boot
initKey();
if (S.key) {
  const cached = loadCache();
  if (cached) setData(cached, { fromCache: true });
  S.lastLoad = Date.now();
  load();
} else render();
