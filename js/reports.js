// Monthly and yearly reports. Pure functions over the classified rows, shared by the site (Reports on History), the tour
// and the box scripts that feed the emails (sync/month-summary.mjs, sync/year-summary.mjs). Same rules as everywhere
// else: transfers and card payments are not spending, investing is not spending, tithing comes from tithe.js.
// The returned objects hold no balances, account numbers or net worth, so they are safe to put in an email.
import { CATS, summarize, weekStart, addDays, counts, weekLabel, shortDate } from './logic.js?v=22';
import { computeTithing, titheSettings } from './tithe.js?v=22';

const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const sum = (a, f = (x) => x) => a.reduce((t, x) => t + f(x), 0);
export const ymOf = (d) => d.slice(0, 7);
export const monthEnd = (m) => { const [y, mo] = m.split('-').map(Number); return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10); };
export const nextMonth = (m) => { const [y, mo] = m.split('-').map(Number); return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`; };
export const prevMonth = (m) => { const [y, mo] = m.split('-').map(Number); return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, '0')}`; };
export const monthLabel = (m, style = 'long') => new Date(`${m}-15T12:00:00Z`).toLocaleDateString('en-US', { month: style, year: 'numeric', timeZone: 'UTC' });
const monthShort = (m) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
const $0 = (n) => (n < 0 ? '-' : '') + '$' + Math.round(Math.abs(n)).toLocaleString('en-US');
const WEEKS_PER_MONTH = 52 / 12;   // 4.33

// months we have at least some data for, and which are complete
export function reportMonths(coverageFrom, today) {
  const out = []; let m = ymOf(coverageFrom);
  while (m <= ymOf(today)) { out.push({ month: m, partialStart: `${m}-01` < coverageFrom, done: monthEnd(m) < today }); m = nextMonth(m); }
  return out;
}
export const lastFullMonth = (today) => prevMonth(ymOf(today));

function targets(settings) {
  const s = settings || {};
  const weekly = Number(s.weekly_target) > 0 ? Number(s.weekly_target) : null;
  const monthly = Number(s.monthly_target) > 0 ? Number(s.monthly_target) : weekly ? r2(weekly * WEEKS_PER_MONTH) : null;
  return { weekly, monthly, monthlySource: Number(s.monthly_target) > 0 ? 'monthly target' : weekly ? `weekly ${$0(weekly)} × 4.33` : null };
}

// steady charges from the same place, seen in at least 2 of the 3 months before `m`
function steadyBefore(rows, m) {
  const from = `${prevMonth(prevMonth(prevMonth(m)))}-01`, to = monthEnd(prevMonth(m));
  const g = new Map();
  for (const r of rows) if (r.kind === 'spend' && r.spend > 0 && counts(r) && r.date >= from && r.date <= to) {
    const e = g.get(r.key) || { key: r.key, label: r.label, rows: [] }; e.rows.push(r); g.set(r.key, e);
  }
  return [...g.values()].map((e) => {
    const months = new Set(e.rows.map((r) => ymOf(r.date)));
    const amts = e.rows.map((r) => r.spend); const mean = sum(amts) / amts.length;
    const cv = mean ? Math.sqrt(sum(amts, (a) => (a - mean) ** 2) / amts.length) / mean : 1;
    const last = e.rows.slice().sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    return { ...e, months: months.size, mean, cv, last: last.spend, lastMonth: ymOf(last.date), perMonth: e.rows.length / months.size };
  }).filter((e) => e.months >= 2 && e.cv <= 0.2 && e.perMonth <= 1.5);
}

function titheFor(ctx, from, to) {
  const { rows, coverageFrom, settings, tithing = [] } = ctx;
  const cfg = titheSettings(settings);
  const upto = rows.filter((r) => r.date <= to);
  const T = computeTithing({ rows: upto, today: to, coverageFrom, settings, entries: tithing.filter((e) => e.week <= to) });
  if (T.first > to) return { pct: cfg.pct, not_counted: true, counted_from: T.first, income_counted: 0, due: 0, paid_giving: 0, paid_marked: 0, paid: 0, owed_at_end: 0, ahead_at_end: 0 };
  if (T.first > from) from = T.first;   // tithing is only counted from the week set in Settings
  const s = summarize(rows, from, to);
  const counted = s.incomeRows.filter((r) => !cfg.skip.has(r.key));
  const inc = sum(counted, (r) => r.amount);
  const adj = sum(tithing.filter((e) => e.kind === 'adjust' && e.week >= from && e.week <= to), (e) => Number(e.amount));
  const giving = sum(s.items.filter((r) => r.cat === 'giving'), (r) => r.spend);
  const marked = sum(tithing.filter((e) => e.kind === 'paid' && e.week >= from && e.week <= to), (e) => Number(e.amount));
  const owed = T.withThisWeek > 0.004 ? T.withThisWeek : 0;
  return { pct: cfg.pct, income_counted: r2(inc), due: r2(Math.max(0, inc * cfg.pct / 100 + adj)), paid_giving: r2(giving), paid_marked: r2(marked),
    paid: r2(giving + marked), owed_at_end: r2(owed), ahead_at_end: r2(owed ? 0 : T.pool), counted_from: T.first, from };
}

export function monthReport(ctx, m, { words = { invest: 'into Bitcoin' } } = {}) {
  const { rows, coverageFrom, today, settings } = ctx;
  const from = `${m}-01`, to = monthEnd(m);
  const s = summarize(rows, from, to);
  const pm = prevMonth(m); const pFrom = `${pm}-01`;
  const p = pFrom >= ymOf(coverageFrom) + '-01' && monthEnd(pm) >= coverageFrom ? summarize(rows, pFrom, monthEnd(pm)) : null;
  const priorPartial = p && pFrom < coverageFrom;
  const tg = targets(settings);
  const kept = s.income - s.spend - s.investing;
  const cats = s.cats.slice(0, 5).map(([c, v]) => { const pv = p ? p.byCat[c] || 0 : null; return { key: c, name: CATS[c].label, amount: r2(v), prior: pv === null ? null : r2(pv), change: pv === null ? null : r2(v - pv) }; });
  const biggest = s.items.filter((r) => r.cat !== 'giving' && r.spend > 0).sort((a, b) => b.spend - a.spend).slice(0, 3)
    .map((r) => ({ label: r.label, amount: r2(r.spend), date: r.date, category: CATS[r.cat].label, pending: !!r.pending }));
  // recurring: changed amount, or a steady charge that looks new (this month and last, not before)
  const steady = steadyBefore(rows, m);
  const thisBy = new Map(); for (const r of s.items) if (r.spend > 0) { const e = thisBy.get(r.key) || { label: r.label, total: 0, n: 0 }; e.total += r.spend; e.n++; thisBy.set(r.key, e); }
  const changed = steady.filter((e) => thisBy.has(e.key) && thisBy.get(e.key).n === 1 && Math.abs(thisBy.get(e.key).total - e.last) > Math.max(1, e.last * 0.08))
    .map((e) => ({ label: e.label, from: r2(e.last), to: r2(thisBy.get(e.key).total) }));
  const before = new Set(rows.filter((r) => r.kind === 'spend' && counts(r) && r.date < pFrom && r.date >= `${prevMonth(prevMonth(prevMonth(pm)))}-01`).map((r) => r.key));
  const fresh = p ? [...thisBy.entries()].filter(([k, e]) => e.n === 1 && !before.has(k) && pFrom >= coverageFrom && (() => {
    const pr = p.items.filter((r) => r.key === k); return pr.length === 1 && Math.abs(pr[0].spend - e.total) <= Math.max(1, e.total * 0.05) && e.total < 300;
  })()).map(([, e]) => ({ label: e.label, amount: r2(e.total) })) : [];
  const weeks = [];
  for (let ws = weekStart(from) < from ? addDays(weekStart(from), 7) : from; ws <= to; ws = addDays(ws, 7)) {
    const we = addDays(ws, 6); if (we >= today) break;
    const w = summarize(rows, ws, we);
    weeks.push({ from: ws, to: we, label: weekLabel(ws), spend: r2(w.spend), state: tg.weekly ? (w.spend > tg.weekly + 0.5 ? 'over' : 'under') : null });
  }
  const tithe = titheFor(ctx, from, to);
  const over = tg.monthly ? s.spend - tg.monthly : null;
  const mood = over === null ? 'Here is the month.' : over > tg.monthly * 0.15 ? 'A full month.' : over > 0 ? 'A little over.' : -over > tg.monthly * 0.2 ? 'A calm month.' : 'A steady month.';
  const headline = over === null ? `${mood} ${$0(s.spend)} spent.` : `${mood} ${$0(Math.abs(over))} ${over > 0 ? 'over' : 'under'} our monthly target.`;
  const top = cats.find((c) => c.key !== 'giving');
  const giving = s.byCat.giving || 0;
  const grown = cats.filter((c) => c.key !== 'giving' && c.change !== null && c.change > 50).sort((a, b) => b.change - a.change)[0];
  const next = tithe.owed_at_end > 1 ? `Set aside ${$0(tithe.owed_at_end)} for tithing when you can; that clears what's owed through ${shortDate(to)}.`
    : over !== null && over > 0 && grown ? `${grown.name} ran ${$0(grown.change)} above ${monthShort(pm)}. Watching that one would bring the month back near target.`
      : over !== null && over > 0 && top ? `Most went to ${top.name.toLowerCase()} (${$0(top.amount)}). A lighter week or two there would bring the month back near target.`
        : kept > 0 ? `We kept ${$0(kept)}. Same plan next month.` : 'More went out than came in. A quieter month next month would even it out.';
  const partialStart = from < coverageFrom;
  return {
    kind: 'month', month: m, label: monthLabel(m), from: partialStart ? coverageFrom : from, to, partial_start: partialStart, complete: to < today,
    headline, spending_note: giving > s.spend * 0.15 ? `Includes ${$0(giving)} in Giving, which counts as spending like always.` : null, spending: r2(s.spend), pending: r2(s.pending), income: r2(s.income), investing: r2(s.investing), invest_words: words.invest, kept: r2(kept),
    target: tg.monthly ? { monthly: r2(tg.monthly), source: tg.monthlySource, weekly: tg.weekly, diff: r2(Math.abs(over)), state: over > 0 ? 'over' : 'under' } : null,
    prior: p ? { month: pm, label: monthLabel(pm), spending: r2(p.spend), income: r2(p.income), partial: !!priorPartial } : null,
    top_categories: cats, biggest, recurring: { changed, new: fresh }, weeks, tithing: tithe, next_step: next,
    subject: `Ours · ${monthLabel(m)}: ${$0(s.spend)} spent${over === null ? '' : `, ${$0(Math.abs(over))} ${over > 0 ? 'over' : 'under'}`}`,
    preheader: `${$0(s.income)} came in, ${kept >= 0 ? `${$0(kept)} kept` : `${$0(-kept)} more out than in`}, tithing ${tithe.owed_at_end > 1 ? $0(tithe.owed_at_end) + ' to set aside' : 'paid up'}.`,
  };
}

export function yearReport(ctx, year, { ytd = false, words = { invest: 'into Bitcoin' } } = {}) {
  const { rows, coverageFrom, today } = ctx;
  const months = reportMonths(coverageFrom, today).filter((x) => x.month.startsWith(`${year}-`) && x.done);
  const ms = months.map((x) => {
    const from = x.partialStart ? coverageFrom : `${x.month}-01`, to = monthEnd(x.month);
    const s = summarize(rows, from, to);
    return { month: x.month, short: monthShort(x.month), partial: x.partialStart, from, to, spending: r2(s.spend), income: r2(s.income), investing: r2(s.investing), kept: r2(s.income - s.spend - s.investing), s };
  });
  if (!ms.length) return { kind: 'year', year, ytd, empty: true, headline: `No months of ${year} in our data yet. Our numbers start ${shortDate(coverageFrom)}, ${coverageFrom.slice(0, 4)}.`, subject: `Ours · ${year}: nothing to report yet` };
  const from = ms[0].from, to = ms[ms.length - 1].to;
  const s = summarize(rows, from, to);
  const totals = { spending: r2(s.spend), income: r2(s.income), investing: r2(s.investing), kept: r2(s.income - s.spend - s.investing) };
  const tithe = titheFor(ctx, from, to);
  const cats = s.cats.slice(0, 6).map(([c, v]) => ({ key: c, name: CATS[c].label, amount: r2(v), share: s.spend > 0 ? Math.round((v / s.spend) * 100) : 0 }));
  const biggest = s.items.filter((r) => r.cat !== 'giving' && r.spend > 0).sort((a, b) => b.spend - a.spend).slice(0, 5)
    .map((r) => ({ label: r.label, amount: r2(r.spend), date: r.date, category: CATS[r.cat].label }));
  const full = ms.filter((x) => !x.partial);
  const best = full.length ? full.reduce((a, b) => (b.kept > a.kept ? b : a)) : null;
  const tough = full.length ? full.reduce((a, b) => (b.kept < a.kept ? b : a)) : null;
  // subscriptions and other steady monthly charges: same place, 3+ months, steady amount, about once a month
  const g = new Map();
  for (const r of s.items) if (r.spend > 0) { const e = g.get(r.key) || { key: r.key, label: r.label, rows: [] }; e.rows.push(r); g.set(r.key, e); }
  const subs = [...g.values()].map((e) => {
    const n = new Set(e.rows.map((r) => ymOf(r.date))).size; const amts = e.rows.map((r) => r.spend); const mean = sum(amts) / amts.length;
    const cv = mean ? Math.sqrt(sum(amts, (a) => (a - mean) ** 2) / amts.length) / mean : 1;
    return { label: e.label, months: n, total: r2(sum(amts)), monthly: r2(mean), cv, perMonth: e.rows.length / n };
  }).filter((e) => e.months >= 3 && e.cv <= 0.2 && e.perMonth <= 1.5 && e.monthly < 500).sort((a, b) => b.total - a.total);
  const subsTotal = r2(sum(subs, (e) => e.total));
  const n = ms.length;
  const oneTime = s.items.filter((r) => r.spend >= 1500).sort((a, b) => b.spend - a.spend).map((r) => ({ label: r.label, amount: r2(r.spend), date: r.date, category: CATS[r.cat].label }));
  const keptUsual = totals.kept + sum(oneTime, (r) => r.amount);
  const coverNote = `${ytd ? `${year} so far` : year}: ${ms[0].partial ? `${shortDate(from)}` : monthShort(ms[0].month)} to ${monthShort(ms[ms.length - 1].month)} (${n} month${n === 1 ? '' : 's'}${ms[0].partial ? `, ${monthShort(ms[0].month)} only from the ${Number(from.slice(8))}th when our data starts` : ''}).`;
  const avgKept = totals.kept / n;
  const take = [];
  const big1 = oneTime[0];
  if (big1) take.push(`Leaving out ${oneTime.length === 1 ? `the one-time ${$0(big1.amount)} ${big1.label} in ${monthShort(ymOf(big1.date))}` : `${oneTime.length} one-time items over $1,500 (${$0(sum(oneTime, (r) => r.amount))})`}, we ${keptUsual >= 0 ? `kept about ${$0(keptUsual / n)} a month` : `ran about ${$0(-keptUsual / n)} a month short`}.${keptUsual >= 0 ? ' Keeping that going is the main thing.' : ''}`);
  else take.push(avgKept > 0 ? `We kept about ${$0(avgKept)} a month on average. Keeping that going is the main thing.` : `More went out than came in, about ${$0(-avgKept)} a month. Next year, aim for months that at least break even.`);
  const usualBy = { ...s.byCat }; for (const r of s.items) if (r.spend >= 1500) usualBy[r.cat] -= r.spend;
  const usualTot = sum(Object.values(usualBy)); const uc = Object.entries(usualBy).filter(([k]) => k !== 'giving').sort((a, b) => b[1] - a[1])[0];
  if (uc && usualTot > 0) take.push(`${oneTime.length ? 'Without one-time items, ' : ''}${CATS[uc[0]].label.toLowerCase()} was our biggest everyday category at ${Math.round((uc[1] / usualTot) * 100)}% of spending (${$0(uc[1])}${(() => { const mm = {}; for (const r of s.items) if (r.cat === uc[0] && r.spend < 1500) mm[r.label] = (mm[r.label] || 0) + r.spend; const t = Object.entries(mm).sort((a, b) => b[1] - a[1])[0]; return t && t[1] > uc[1] * 0.4 ? `, mostly ${t[0]}` : ''; })()}).${uc[0] === 'eating_out' || uc[0] === 'shopping' ? ' An easy place to start if we want more room.' : ''}`.replace(/^./, (c) => c.toUpperCase()));
  if (subs.length) take.push(`Steady monthly charges came to ${$0(subsTotal)} across ${subs.length} place${subs.length === 1 ? '' : 's'}. Worth a once-a-year look at which ones we still use.`);
  if (tithe.owed_at_end > 1) take.push(`Tithing: ${$0(tithe.owed_at_end)} still to pay at the end of ${monthShort(ms[ms.length - 1].month)}.`);
  const label = ytd ? `${year} so far` : String(year);
  return {
    kind: 'year', year, ytd, label, from, to, cover_note: coverNote, months_covered: ms.map((x) => x.month),
    headline: `${label}: ${$0(totals.income)} came in and ${$0(totals.spending)} went to spending${totals.kept >= 0 ? `, so we kept ${$0(totals.kept)}` : `. That is ${$0(-totals.kept)} more than came in`}.${big1 ? ` That includes a one-time ${$0(big1.amount)} ${big1.label}.` : ''}`,
    one_time: oneTime,
    totals: { ...totals, invest_words: words.invest }, tithing: tithe,
    months: ms.map(({ s: _s, ...x }) => x), top_categories: cats, biggest,
    best_month: best ? { month: best.month, label: monthLabel(best.month), kept: best.kept, spending: best.spending } : null,
    toughest_month: tough && tough !== best ? { month: tough.month, label: monthLabel(tough.month), kept: tough.kept, spending: tough.spending } : null,
    subscriptions: { total: subsTotal, places: subs.slice(0, 8).map((e) => ({ label: e.label, total: e.total, monthly: e.monthly, months: e.months })) },
    takeaways: take.slice(0, 3),
    subject: `Ours · ${label}: ${$0(totals.income)} in, ${$0(totals.spending)} out${big1 ? ` (incl. ${$0(big1.amount)} one-time)` : ''}`,
    preheader: coverNote,
  };
}
