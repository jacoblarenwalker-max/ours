// Ours: shared money logic. Used by the site (browser) and by the sync script (Node) so both
// classify every transaction exactly the same way.

export const TZ = 'America/Denver';

export const CATS = {
  groceries:  { label: 'Groceries',     color: '#16382c' },
  eating_out: { label: 'Eating out',    color: '#d4c6a4' },
  gas:        { label: 'Gas & car',     color: '#c47a62' },
  shopping:   { label: 'Shopping',      color: '#a89a82' },
  home:       { label: 'Home',          color: '#7f979c' },
  giving:     { label: 'Giving',        color: '#b8ad6a' },
  fun:        { label: 'Fun',           color: '#8c7f6b' },
  health:     { label: 'Health & care', color: '#9db3a3' },
  other:      { label: 'Other',         color: '#6f685e' },
};
export const CAT_KEYS = Object.keys(CATS);
export const KINDS = {
  spend: 'Spend', income: 'Income', investing: 'Investing', transfer: 'Transfer', card_payment: 'Card payment',
};
export const FIX_TARGETS = [...CAT_KEYS, 'transfer', 'income', 'investing'];

// ---------- dates (all dates are plain YYYY-MM-DD in Mountain time) ----------
const DAY = 86400000;
const toUTC = (d) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
const fromUTC = (ms) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (d, n) => fromUTC(toUTC(d) + n * DAY);
export const daysBetween = (a, b) => Math.round((toUTC(b) - toUTC(a)) / DAY);
export const weekStart = (d) => addDays(d, -((new Date(toUTC(d)).getUTCDay() + 6) % 7)); // Monday
export const todayLocal = (now = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
export const weekdayName = (d) => new Date(toUTC(d)).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
export const shortDate = (d) => new Date(toUTC(d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
export const weekLabel = (ws) => {
  const we = addDays(ws, 6);
  const a = shortDate(ws), b = shortDate(we);
  return ws.slice(5, 7) === we.slice(5, 7) ? `${a} – ${b.split(' ')[1]}` : `${a} – ${b}`;
};

// ---------- classification ----------
// Each snapshot transaction arrives with label/key/note and a base kind0/cat0 worked out by the
// private sync rules. Our saved Fix rules (by merchant) override that here, in the browser.
export function classify(t, fixes) {
  const fix = fixes && fixes.get(t.key);
  let kind = t.kind0, cat = t.cat0, why = 'rule';
  if (fix) { why = 'fix'; if (CATS[fix]) { kind = 'spend'; cat = fix; } else { kind = fix; cat = null; } }
  return { kind, cat: kind === 'spend' ? (CATS[cat] ? cat : 'other') : null, label: t.label, key: t.key, note: t.note || null, why,
    spend: kind === 'spend' ? -t.amount : 0 };
}

// Classify a whole snapshot. Adds dup/mirror flags so nothing is counted twice.
export function classifyAll(snapshot, fixesList = []) {
  const fixes = new Map(fixesList.map((f) => [f.merchant_key, f.set_to]));
  const accts = new Map((snapshot.accounts || []).map((a) => [a.id, a]));
  const rows = (snapshot.txns || []).map((t) => {
    const acct = accts.get(t.account_id);
    return { ...t, acct, ...classify(t, fixes), dup: false, mirror: false };
  });
  // 1) a card purchase that also shows on the bank side (same amount, merchant, within 3 days): keep the card copy
  const cardSpends = rows.filter((r) => r.src === 'card' && r.kind === 'spend');
  for (const r of rows) {
    if (r.src !== 'cash' || r.kind !== 'spend') continue;
    if (cardSpends.some((c) => c.key === r.key && Math.abs(c.amount - r.amount) < 0.005 && Math.abs(daysBetween(c.date, r.date)) <= 3)) r.dup = true;
  }
  // 2) a pending charge that has already posted on the same account
  for (const r of rows) {
    if (!r.pending) continue;
    if (rows.some((p) => !p.pending && p.account_id === r.account_id && p.key === r.key && Math.abs(p.amount - r.amount) < 0.005 && Math.abs(daysBetween(r.date, p.date)) <= 7)) r.dup = true;
  }
  // 3) the River side of a Bitcoin buy mirrors the bank debit; count the bank debit only
  const bankBuys = rows.filter((r) => r.src !== 'invest' && r.kind === 'investing' && r.amount < 0);
  const used = new Set();
  for (const r of rows.filter((x) => x.src === 'invest' && x.type === 'buy')) {
    const m = bankBuys.find((b) => !used.has(b.id) && Math.abs(b.amount - r.amount) < 0.005 && Math.abs(daysBetween(b.date, r.date)) <= 4);
    if (m) { used.add(m.id); r.mirror = true; }
  }
  rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (a.amount - b.amount)));
  return rows;
}
export const counts = (r) => !r.dup && !r.mirror;

// ---------- summaries ----------
export function summarize(rows, from, to) {
  const s = { from, to, spend: 0, pending: 0, income: 0, investing: 0, transfers: 0, cardPayments: 0, byCat: {}, merchants: {}, items: [], incomeRows: [], investRows: [], transferRows: [], cardRows: [] };
  for (const r of rows) {
    if (r.date < from || r.date > to || !counts(r)) continue;
    if (r.kind === 'spend') {
      s.spend += r.spend;
      if (r.pending) s.pending += r.spend;
      s.byCat[r.cat] = (s.byCat[r.cat] || 0) + r.spend;
      const m = (s.merchants[r.cat] ||= {});
      const e = (m[r.key] ||= { key: r.key, label: r.label, total: 0, count: 0, rows: [] });
      e.total += r.spend; e.count += 1; e.rows.push(r);
      s.items.push(r);
    } else if (r.kind === 'income') { s.income += r.amount; s.incomeRows.push(r); }
    else if (r.kind === 'investing') { s.investing += -r.amount; s.investRows.push(r); }
    else if (r.kind === 'transfer' && r.amount < 0) { s.transfers += -r.amount; s.transferRows.push(r); }
    else if (r.kind === 'card_payment' && r.src !== 'card' && r.amount < 0) { s.cardPayments += -r.amount; s.cardRows.push(r); }
  }
  s.cats = Object.entries(s.byCat).filter(([, v]) => Math.abs(v) >= 0.005).sort((a, b) => b[1] - a[1]);
  return s;
}

export function weeksBack(rows, today, count) {
  const ws = weekStart(today);
  return Array.from({ length: count }, (_, i) => {
    const start = addDays(ws, -7 * i);
    return summarize(rows, start, addDays(start, 6));
  });
}

const money0 = (n) => '$' + Math.round(Math.abs(n)).toLocaleString('en-US');
const money2 = (n) => '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// The Monday letter for the most recent full week.
export function buildLetter(rows, today, coverageFrom) {
  const thisWs = weekStart(today);
  const lastWs = addDays(thisWs, -7);
  const last = summarize(rows, lastWs, addDays(lastWs, 6));
  const prev = summarize(rows, addDays(lastWs, -7), addDays(lastWs, -1));
  const usualWeeks = [1, 2, 3, 4].map((i) => summarize(rows, addDays(lastWs, -7 * i), addDays(lastWs, -7 * i + 6)))
    .filter((w) => !coverageFrom || w.from >= coverageFrom);
  const usual = usualWeeks.length ? usualWeeks.reduce((a, w) => a + w.spend, 0) / usualWeeks.length : null;
  const usualCat = (c) => usualWeeks.length ? usualWeeks.reduce((a, w) => a + (w.byCat[c] || 0), 0) / usualWeeks.length : 0;

  let verdict = 'none', normal;
  if (usual === null || usual < 1) normal = 'Not enough history yet to say what a usual week looks like.';
  else {
    const diff = last.spend - usual;
    const ratio = last.spend / usual;
    if (ratio > 1.15) {
      verdict = 'more';
      const driver = last.cats.map(([c, v]) => [c, v - usualCat(c)]).sort((a, b) => b[1] - a[1])[0];
      normal = `More than usual. A usual week is about ${money0(usual)}, so this was ${money0(diff)} higher` +
        (driver && driver[1] > diff * 0.4 ? `, mostly ${CATS[driver[0]].label.toLowerCase()}.` : '.');
    } else if (ratio < 0.85) {
      verdict = 'less';
      const driver = CAT_KEYS.map((c) => [c, (last.byCat[c] || 0) - usualCat(c)]).sort((a, b) => a[1] - b[1])[0];
      normal = `Less than usual. A usual week is about ${money0(usual)}, so this was ${money0(diff)} lower` +
        (driver && -driver[1] > -diff * 0.4 ? `, mostly from less ${CATS[driver[0]].label.toLowerCase()}.` : '.');
    } else {
      verdict = 'same';
      normal = `About the same as a usual week (about ${money0(usual)}).`;
    }
  }
  const purchases = last.items.filter((r) => r.spend > 0);
  // The purchase worth talking about: the biggest one that isn't giving, wasn't refunded,
  // and isn't a place we go most weeks (falls back to the biggest purchase).
  const regular = new Set();
  const seen = {};
  for (const w of usualWeeks) for (const k of new Set(w.items.map((r) => r.key))) seen[k] = (seen[k] || 0) + 1;
  for (const [k, n] of Object.entries(seen)) if (n >= 3) regular.add(k);
  const refunded = (r) => rows.some((x) => x.key === r.key && x.kind === 'spend' && x.amount > 0 && Math.abs(x.amount + r.amount) < 0.005 && daysBetween(r.date, x.date) >= 0 && daysBetween(r.date, x.date) <= 21);
  const ranked = purchases.filter((r) => r.cat !== 'giving' && !refunded(r)).sort((a, b) => b.spend - a.spend);
  const storyPick = ranked.find((r) => !regular.has(r.key)) || ranked[0] || null;
  const giving = last.byCat.giving || 0;
  const story = [];
  story.push(`We spent ${money0(last.spend)} on real purchases${last.pending > 0 ? `, ${money0(last.pending)} of it still pending` : ''}.`);
  if (giving > last.spend * 0.3) story.push(`${money0(giving)} of that was giving.`);
  if (storyPick) story.push(`The one worth talking about: ${money2(storyPick.spend)} at ${storyPick.label} on ${weekdayName(storyPick.date)}.`);
  story.push(last.income > 0.5 ? `${money0(last.income)} came in.` : 'No paychecks landed.');
  if (last.investing > 0) story.push(`${money0(last.investing)} went into Bitcoin.`);

  return { lastWs, last, prev, usual, usualWeeks: usualWeeks.length, verdict, normal, story, storyPick,
    vsPrev: last.spend - prev.spend };
}

// ---------- weekly target ----------
// Consumer spending (same number as the letter) against our one shared weekly target.
export function vsTarget(spend, target) {
  if (!(Number(target) > 0)) return null;
  const diff = Number(target) - spend;
  if (Math.abs(diff) < 0.5) return { state: 'at', diff: 0, target: Number(target) };
  return { state: diff > 0 ? 'under' : 'over', diff: Math.abs(diff), target: Number(target) };
}
export function targetSentence(spend, target, { week = 'Last week' } = {}) {
  const v = vsTarget(spend, target);
  if (!v) return null;
  if (v.state === 'at') return `${week} landed right on our ${money0(v.target)} target.`;
  return v.state === 'under' ? `${week} came in ${money0(v.diff)} under our ${money0(v.target)} target.`
    : `${week} went ${money0(v.diff)} over our ${money0(v.target)} target.`;
}

// ---------- net worth ----------
export function worth(snapshot, items = []) {
  const accts = snapshot ? snapshot.accounts || [] : [];
  const bal = (a) => Number(a.balance) || 0;
  const cash = accts.filter((a) => a.class === 'cash').reduce((s, a) => s + bal(a), 0);
  const invest = accts.filter((a) => a.class === 'investment').reduce((s, a) => s + bal(a), 0); // holdings are inside this
  const cards = accts.filter((a) => a.class === 'liability').reduce((s, a) => s + Math.abs(bal(a)), 0);
  const stuff = items.filter((i) => i.side === 'own').reduce((s, i) => s + Number(i.amount), 0);
  const owedItems = items.filter((i) => i.side === 'owe').reduce((s, i) => s + Number(i.amount), 0);
  const own = cash + invest + stuff;
  const owe = cards + owedItems;
  return { cash, invest, stuff, cards, owedItems, own, owe, left: own - owe };
}

// One-line notes about what the data can't show.
export function gaps(snapshot, rows) {
  const notes = [];
  if (!snapshot) return notes;
  const names = (snapshot.accounts || []).map((a) => a.display.toLowerCase()).join(' | ');
  if (rows.some((r) => r.key === 'apple card payment') && !names.includes('apple')) notes.push('Apple Card is not linked, so its purchases do not show here. Payments to it are counted as card payments, not spending.');
  for (const c of snapshot.connections || []) if (c.status && c.status !== 'active') notes.push(`${c.name} needs to be reconnected; its numbers may be old.`);
  return notes;
}
