// Weekly tithing. Pure functions over the classified rows, so the site, the demo tour and the box's letter-summary
// script all work out the same numbers.
//
// What counts: every deposit the app already calls income for that Monday-Sunday week (paychecks, interest, cashback,
// other money in). Transfers between our accounts, card payments and refunds are not income, so they never count.
// Sources can be left out one by one (settings.tithing_skip). Pending deposits count and are tagged.
// What was paid: purchases already sorted into Giving (so a payment is seen in spending too, as before), plus any
// payments marked by hand. Adjustments (+/-) change what a week owes. Payments are applied to the oldest unpaid
// week first, so paying a little more or less one week carries over and evens out.
import { summarize, weekStart, addDays } from './logic.js?v=17';

export const DEFAULT_PCT = 10;
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const sum = (a, f = (x) => x) => a.reduce((t, x) => t + f(x), 0);

export function titheSettings(settings) {
  const s = settings || {};
  const p = Number(s.tithing_pct);
  const skip = Array.isArray(s.tithing_skip) ? s.tithing_skip.map(String) : [];
  const start = typeof s.tithing_start === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s.tithing_start) ? s.tithing_start : null;
  return { pct: p >= 0 && p <= 100 && s.tithing_pct !== undefined && s.tithing_pct !== null ? p : DEFAULT_PCT, skip: new Set(skip), start, customPct: s.tithing_pct !== undefined && s.tithing_pct !== null };
}

export function computeTithing({ rows, today, coverageFrom, settings, entries = [] }) {
  const cfg = titheSettings(settings);
  let first = weekStart(coverageFrom); if (first < coverageFrom) first = addDays(first, 7);   // first full week we have
  if (cfg.start) { const s = weekStart(cfg.start); if (s > first) first = s; }
  const thisWs = weekStart(today);
  const weeks = [];
  for (let ws = first; ws <= thisWs; ws = addDays(ws, 7)) {
    const we = addDays(ws, 6);
    const s = summarize(rows, ws, we);
    const counted = s.incomeRows.filter((r) => !cfg.skip.has(r.key));
    const skipped = s.incomeRows.filter((r) => cfg.skip.has(r.key));
    const income = r2(sum(counted, (r) => r.amount));
    const giveRows = s.items.filter((r) => r.cat === 'giving');
    const adjusts = entries.filter((e) => e.week === ws && e.kind === 'adjust');
    const manuals = entries.filter((e) => e.week === ws && e.kind === 'paid');
    const bySrc = new Map(); for (const r of counted) bySrc.set(r.key, (bySrc.get(r.key) || 0) + r.amount);
    const base = r2(sum([...bySrc.values()], (v) => r2(v * cfg.pct / 100)));   // sum of each source's share, so the sheet adds up to the cent
    const adj = r2(sum(adjusts, (e) => Number(e.amount)));
    weeks.push({
      ws, we, current: ws === thisWs, income, counted, skipped, incomeAll: r2(sum(s.incomeRows, (r) => r.amount)),
      pending: r2(sum(counted.filter((r) => r.pending), (r) => r.amount)),
      base, adj, adjusts, due: Math.max(0, r2(base + adj)), manuals, manual: r2(sum(manuals, (e) => Number(e.amount))),
      giveRows, giving: r2(sum(giveRows, (r) => r.spend)), alloc: 0, paid: 0, owed: 0,
    });
  }
  // Payments go to the oldest unpaid week first. A hand-marked payment goes to its own week.
  let pool = sum(weeks, (w) => w.giving) + sum(weeks, (w) => Math.max(0, w.manual - w.due));
  pool = r2(Math.max(0, pool));
  for (const w of weeks) {
    const need = Math.max(0, r2(w.due - w.manual));
    w.alloc = r2(Math.min(need, pool)); pool = r2(pool - w.alloc);
    w.paid = r2(Math.min(w.due, w.manual) + w.alloc);
    w.owed = r2(w.due - w.paid);
    w.status = w.due < 0.005 ? 'none' : w.owed < 0.005 ? 'paid' : w.paid > 0.005 ? 'partly' : 'unpaid';
  }
  const cur = weeks[weeks.length - 1] || null;
  const completed = weeks.filter((w) => !w.current);
  const last = completed[completed.length - 1] || null;
  const before = completed.slice(0, -1);
  const owedCompleted = r2(sum(completed, (w) => w.owed));
  return {
    cfg, pct: cfg.pct, first, weeks, cur, last, pool,                       // pool: paid beyond every week so far
    carried: r2(sum(before, (w) => w.owed)),                               // unpaid from weeks before last week
    toPay: owedCompleted,                                                  // what's still to pay for weeks that are over
    withThisWeek: r2(owedCompleted + (cur ? cur.owed : 0)),
    dueTotal: r2(sum(weeks, (w) => w.due)), paidTotal: r2(sum(weeks, (w) => w.paid) + pool),
    givingTotal: r2(sum(weeks, (w) => w.giving)), incomeTotal: r2(sum(weeks, (w) => w.income)),
  };
}

// One plain sentence for the letter and the Monday message.
export function titheSentence(T, m2 = (n) => '$' + n.toFixed(2)) {
  const w = T.last; if (!w) return 'Tithing: not enough weeks yet.';
  const head = w.due < 0.005 ? `Tithing for last week: nothing, since no income counted.`
    : `Tithing for last week: ${m2(w.due)} (${T.pct}% of ${m2(w.income)}).`;
  const tail = T.toPay > 0.004 ? ` ${m2(T.toPay)} still to pay${T.carried > 0.004 ? `, including ${m2(T.carried)} carried over` : ''}.`
    : T.pool > 0.004 ? ` All paid, ${m2(T.pool)} ahead.` : ' All paid up.';
  return head + tail;
}
