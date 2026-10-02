// The Plan page's analysis. Pure functions over the live snapshot (already classified rows) plus the
// public, sourced facts in data/facts.json. Nothing household-specific is hard-coded here.
import { counts, shortDate } from './logic.js?v=10';

const sum = (a, f = (x) => x) => a.reduce((t, x) => t + f(x), 0);
const ym = (d) => d.slice(0, 7);
const monthEnd = (m) => { const [y, mo] = m.split('-').map(Number); return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10); };
const nextMonth = (m) => { const [y, mo] = m.split('-').map(Number); return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`; };
export const monthName = (m, long = false) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString('en-US', { month: long ? 'long' : 'short', timeZone: 'UTC' });

const ONE_OFF = 1500;                     // a single purchase this big is treated as a one-time item, not a usual month
const BUSINESS = /\b(llc|l\.l\.c|inc|ltd|pllc)\b/i;
const TAX_PAY = /\birs\b|\btax payment\b|\btreasury\b|estimated tax/i;
const TUITION = /tuition|universit|college|\bbyu/i;
const CASH_ADV = /cash advance|overdraft/i;
const APPS = /x money|venmo|cash app|paypal|apple cash|chime|wise/i;

export function analyze({ snapshot, rows, items = [], today, facts }) {
  const R = rows.filter(counts);
  const accts = snapshot.accounts || [];
  const cov = snapshot.coverage || {};
  // full calendar months inside the data, newest last (at most 6)
  let m = ym(cov.from); if (!cov.from.endsWith('-01')) m = nextMonth(m);
  const months = [];
  while (monthEnd(m) < today && m <= ym(today)) { months.push(m); m = nextMonth(m); }
  const window = months.slice(-6);
  const wFrom = window.length ? `${window[0]}-01` : cov.from;
  const wTo = window.length ? monthEnd(window[window.length - 1]) : today;
  const inW = (r) => r.date >= wFrom && r.date <= wTo;

  const liabNames = accts.filter((a) => a.class === 'liability').map((a) => (a.display || '').split(/\s+/)[0].toLowerCase()).filter(Boolean);
  const unseenCard = (r) => r.kind === 'card_payment' && r.src !== 'card' && r.amount < 0 && !liabNames.some((n) => r.label.toLowerCase().includes(n));

  const byMonth = window.map((mm) => {
    const rs = R.filter((r) => ym(r.date) === mm);
    const spendRows = rs.filter((r) => r.kind === 'spend');
    const oneOffs = spendRows.filter((r) => r.spend >= ONE_OFF);
    return {
      month: mm, from: `${mm}-01`, to: monthEnd(mm),
      income: sum(rs.filter((r) => r.kind === 'income'), (r) => r.amount),
      spend: sum(spendRows, (r) => r.spend),
      oneOff: sum(oneOffs, (r) => r.spend), oneOffs,
      unseen: sum(rs.filter(unseenCard), (r) => -r.amount),
      invest: sum(rs.filter((r) => r.kind === 'investing'), (r) => -r.amount),
      giving: sum(spendRows.filter((r) => r.cat === 'giving'), (r) => r.spend),
    };
  });
  const n = byMonth.length || 1;
  const avg = (k) => sum(byMonth, (x) => x[k]) / n;
  const income = avg('income');
  const usualSpend = sum(byMonth, (x) => x.spend - x.oneOff) / n;   // what we saw, without one-time items
  const unseen = avg('unseen');                                     // paid to cards we can't see inside
  const living = usualSpend + unseen;                               // our best guess at a usual month
  const invested = avg('invest');
  const saved = income - living - invested;
  const savingsRate = income > 0 ? (income - living) / income : null;   // investing counts as saving
  const oneOffs = byMonth.flatMap((x) => x.oneOffs);
  const incomeLow = Math.min(...byMonth.map((x) => x.income)), incomeHigh = Math.max(...byMonth.map((x) => x.income));
  const variableIncome = incomeHigh > incomeLow * 1.6;

  // where cash sits, with yield seen in the data
  const cashAccts = accts.filter((a) => a.class === 'cash');
  const cash = sum(cashAccts, (a) => Number(a.balance) || 0);
  const interestRows = R.filter((r) => r.kind === 'income' && /interest/i.test(r.label));
  const cashSpots = cashAccts.map((a) => {
    const ir = interestRows.filter((r) => r.account_id === a.id).sort((x, y) => (x.date < y.date ? 1 : -1));
    const lastPaid = ir[0] || null;
    const est = lastPaid && a.balance > 100 ? (lastPaid.amount * 12) / a.balance : null;   // rough: last month's interest x 12 / today's balance
    return { id: a.id, name: a.display, nickname: a.nickname, balance: Number(a.balance) || 0, interest6: sum(ir, (r) => r.amount), payments: ir.length, lastPaid, estYield: est,
      app: APPS.test(a.display || ''), noInterestSeen: !ir.length };
  }).sort((a, b) => b.balance - a.balance);
  const idle = cashSpots.filter((s) => s.noInterestSeen && s.balance > 0);
  const interest12 = sum(cashSpots, (s) => (s.lastPaid ? s.lastPaid.amount * 12 : 0));

  // what we own
  const invest = accts.filter((a) => a.class === 'investment');
  const investTotal = sum(invest, (a) => Number(a.balance) || 0);
  const stuff = sum(items.filter((i) => i.side === 'own'), (i) => Number(i.amount));
  const owe = sum(accts.filter((a) => a.class === 'liability'), (a) => Math.abs(Number(a.balance) || 0)) + sum(items.filter((i) => i.side === 'owe'), (i) => Number(i.amount));
  const holdings = (snapshot.holdings || []).slice().sort((a, b) => b.value - a.value);
  const topHolding = holdings[0] || null;
  const topShare = topHolding && investTotal > 0 ? topHolding.value / investTotal : 0;
  const cryptoShare = investTotal > 0 ? sum(holdings.filter((h) => /crypto/i.test(h.type || '') || /^(BTC|ETH)$/i.test(h.ticker || '')), (h) => h.value) / investTotal : 0;

  // regular charges: same place in 3+ months with steady amounts (or any steady investing)
  const groups = new Map();
  for (const r of R.filter((x) => inW(x) && (x.kind === 'spend' || x.kind === 'investing') && (x.kind === 'investing' ? x.amount < 0 : x.spend > 0))) {
    const g = groups.get(r.key) || { key: r.key, label: r.label, kind: r.kind, cat: r.cat, rows: [] }; g.rows.push(r); groups.set(r.key, g);
  }
  const recurring = [...groups.values()].map((g) => {
    const amts = g.rows.map((r) => (r.kind === 'investing' ? -r.amount : r.spend));
    const mean = sum(amts) / amts.length; const sd = Math.sqrt(sum(amts, (a) => (a - mean) ** 2) / amts.length);
    const ms = new Set(g.rows.map((r) => ym(r.date))).size;
    const perMonth = sum(amts) / n;
    const weekly = g.rows.length >= ms * 3.5;
    return { ...g, mean, cv: mean ? sd / mean : 1, months: ms, count: g.rows.length, perMonth, cadence: weekly ? 'weekly' : g.rows.length >= ms * 1.5 ? 'a few times a month' : 'monthly' };
  }).filter((g) => g.months >= 3 && (g.cv <= 0.25 || g.kind === 'investing')).sort((a, b) => b.perMonth - a.perMonth);

  // signals for advice
  const bizRows = R.filter((r) => r.kind === 'income' && BUSINESS.test(r.label));
  const taxRows = R.filter((r) => r.kind === 'spend' && TAX_PAY.test(r.label));
  const tuitionRows = R.filter((r) => r.kind === 'spend' && r.cat !== 'eating_out' && TUITION.test(r.label));
  const advRows = R.filter((r) => CASH_ADV.test(r.label) && r.kind === 'transfer' && r.amount < 0);   // the card side of each advance / overdraft cover
  const advFees = R.filter((r) => r.kind === 'spend' && /(cash advance|overdraft).*fee|fee.*(cash advance|overdraft)/i.test(r.label));
  const unseenRows = R.filter(unseenCard);
  const givingAvg = avg('giving');

  return {
    window, wFrom, wTo, byMonth, months: n, income, incomeLow, incomeHigh, variableIncome, usualSpend, unseen, living, invested, saved, savingsRate, oneOffs,
    cash, cashSpots, idle, interest12, investTotal, stuff, owe, holdings, topHolding, topShare, cryptoShare, recurring,
    bizRows, taxRows, tuitionRows, advRows, advFees, unseenRows, givingAvg, coverFrom: cov.from,
    unseenName: unseenRows.length ? unseenRows[0].label.replace(/\s*payment.*$/i, '') : null,
    today, cushionMonths: living > 0 ? cash / living : null,
  };
}

// Prioritised next steps, most important first. Each: { id, title, why, amount, amountLabel, link, link2?, sheet? }
// Only steps the data supports are included; every public figure comes from facts.json.
export function nextSteps(A, facts) {
  const F = facts.facts; const out = [];
  const $ = (x) => '$' + Math.round(x).toLocaleString('en-US');
  const longDate = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const since = shortDate(A.coverFrom);
  const em = F.emergency_months || { low: 3, high: 6 };
  const months = A.variableIncome ? em.high : Math.round((em.low + em.high) / 2);
  const cushion = A.living * months;
  const bizTotal = sum(A.bizRows, (r) => r.amount);
  const seTax = F.se_tax_base && F.se_tax_rate ? bizTotal * F.se_tax_base.value * F.se_tax_rate.value : 0;
  const tuition = sum(A.tuitionRows.filter((r) => r.date >= A.wFrom && r.date <= A.wTo), (r) => r.spend);
  const tuitionMonthly = tuition / Math.max(1, A.months);
  const keep = cushion + seTax + tuition / 2;   // cushion + taxes we may owe + about half a semester of school
  const extra = A.cash - keep;
  const unseenNote = A.unseen > 0 ? `, counting what we pay the ${A.unseenName}` : '';

  try {
    // 1. the cushion
    if (A.cushionMonths !== null) {
      if (A.cushionMonths < em.low) out.push({ id: 'cushion', title: `Build the cushion to ${months} months`, amount: cushion - A.cash, amountLabel: 'still to add', sheet: 'plan-months',
        why: `Cash covers about ${A.cushionMonths.toFixed(1)} months of a usual month (${$(A.living)}${unseenNote}). ${em.low} to ${em.high} months is the usual guide${A.variableIncome ? ', and our income moves around a lot' : ''}.`, link: F.emergency_months });
      else out.push({ id: 'cushion', title: `Keep ${months} months of spending in savings`, amount: cushion, amountLabel: `our cushion, ${months} × ${$(A.living)}`, sheet: 'plan-months',
        why: `We have ${$(A.cash)} in cash, about ${A.cushionMonths.toFixed(1)} months of a usual month (${$(A.living)}${unseenNote}). ${A.variableIncome ? `Income ran from ${$(A.incomeLow)} to ${$(A.incomeHigh)} a month, so the top of the ${em.low} to ${em.high} month range fits us.` : `${em.low} to ${em.high} months is the usual guide.`} We're already there.`, link: F.emergency_months });
    }
  } catch { /* a figure is missing from facts.json: skip this step */ }
  try {
    // 2. taxes on self-employment income
    if (A.bizRows.length) {
      const next = F.est_tax_dates.dates.find((d) => d >= A.today) || null;
      const names = [...new Set(A.bizRows.map((r) => r.label))].join(', ');
      const irs = A.taxRows.length ? ` We paid the IRS ${$(sum(A.taxRows, (r) => r.spend))} on ${A.taxRows.map((r) => shortDate(r.date)).join(', ')}. If that was a balance due, quarterly payments help avoid a repeat and a possible penalty.` : '';
      out.push({ id: 'tax', title: `Set aside tax on ${names} income`, amount: seTax, amountLabel: 'self-employment tax, at least',
        why: `${names} paid us ${$(bizTotal)} since ${since}. Self-employment tax alone is ${(F.se_tax_rate.value * 100).toFixed(1)}% of ${(F.se_tax_base.value * 100).toFixed(2)}% of profit: about ${$(seTax)}, before income tax.${irs}${next ? ` Next estimated-tax date: ${longDate(next)}.` : ''}`,
        link: F.est_tax_dates, link2: F.se_tax_rate });
    }
  } catch { /* a figure is missing from facts.json: skip this step */ }
  try {
    // 3. see the whole picture
    if (A.unseenRows.length) {
      const t = sum(A.unseenRows, (r) => -r.amount);
      out.push({ id: 'unseen', title: `Link the ${A.unseenName}`, amount: t, amountLabel: `paid to it since ${since}`, sheet: 'plan-unseen',
        why: `We paid ${$(t)} to a card that isn't linked (about ${$(A.unseen)} a month). Its purchases never show up in spending, the letter, or the target, so those look better than real life. This page adds the payments back in as a stand-in.`, link: F.budget });
    }
  } catch { /* a figure is missing from facts.json: skip this step */ }
  try {
    // 4. extra cash to retirement
    const limit = F.ira_limit.value;
    if (extra > 1000) {
      const roth = Math.min(extra, limit * 2);
      const yr = A.income * 12;
      out.push({ id: 'roth', title: 'Put the extra cash into Roth IRAs', amount: roth, amountLabel: `of the ${$(limit * 2)} the two of us can add for ${F.ira_limit.year}`, sheet: 'plan-extra',
        why: `After the cushion${seTax > 0 ? ', the tax set-aside' : ''}${tuition > 0 ? ' and half a semester of school' : ''}, about ${$(extra)} is extra cash. Each of us can put up to ${$(limit)} in an IRA for ${F.ira_limit.year}, until the April 2027 tax deadline${yr < F.roth_mfj_phaseout_start.value ? `, and our income (about ${$(yr)} a year here) is well under the ${$(F.roth_mfj_phaseout_start.value)} Roth limit for couples` : ''}. No retirement accounts are linked, so first ask whether either job offers a match.`,
        link: F.ira_limit, link2: F.spousal_ira });
    }
  } catch { /* a figure is missing from facts.json: skip this step */ }
  try {
    // 5. spread the risk
    if (A.investTotal > 0 && A.topShare > 0.8 && A.topHolding) {
      out.push({ id: 'diversify', title: `Add a broad index fund next to the ${A.topHolding.name}`, amount: A.investTotal, amountLabel: `${Math.round(A.topShare * 100)}% of what we've invested`,
        why: `Everything we've invested (${$(A.investTotal)}) is ${A.topHolding.name}${A.invested > 0 ? `, plus about ${$(A.invested)} a month` : ''}. Keeping that habit is fine; a low-cost total-market or target-date fund inside the Roth would carry the bigger share and spread the risk.`, link: F.diversify, link2: F.crypto_risk });
    }
  } catch { /* a figure is missing from facts.json: skip this step */ }
  try {
    // 6. school bills
    if (tuition > 300) out.push({ id: 'tuition', title: 'Give tuition its own savings bucket', amount: tuitionMonthly, amountLabel: 'a month', sheet: 'plan-tuition',
      why: `School charges were ${$(tuition)} over the last ${A.months} months. Putting about ${$(tuitionMonthly)} a month into a separate savings account means the semester bill is already covered when it comes.`, link: F.budget });
  } catch { /* a figure is missing from facts.json: skip this step */ }
  try {
    // 7. where the cash sits
    const appCash = A.cashSpots.filter((s) => s.app).reduce((t, s) => t + s.balance, 0);
    const big = A.cashSpots.find((s) => s.app && s.balance > 5000);
    if (big) out.push({ id: 'apps', title: `Confirm how ${big.name.replace(/\s+(Checking|Personal|Savings).*$/, '')} is insured`, amount: big.balance, amountLabel: 'held there', sheet: 'plan-cash',
      why: `${$(big.balance)} sits in ${big.name}${big.estYield ? `, earning roughly ${(big.estYield * 100).toFixed(1)}% a year judging by its last interest` : ''}. Money in an app is FDIC-insured only through its partner bank, and only if that bank fails, not the app. Worth checking before it holds half the cushion.`, link: F.fdic_apps });
  } catch { /* a figure is missing from facts.json: skip this step */ }
  try {
    // 8. cash advances / overdraft covers
    if (A.advRows.length) {
      const t = sum(A.advRows, (r) => -r.amount), fees = sum(A.advFees, (r) => r.spend);
      out.push({ id: 'advance', title: 'Skip card cash advances', amount: t, amountLabel: `in ${A.advRows.length} advances or covers${fees ? `, ${$(fees)} in fees` : ''}`,
        why: `Checking ran short ${A.advRows.length} times and a card covered it. Advances usually carry a fee and interest that starts right away. Keeping a few hundred extra in checking avoids it.`, link: F.cash_advance });
    }
  } catch { /* a figure is missing from facts.json: skip this step */ }
  try {
    // 9. giving as a planned line
    if (A.givingAvg > A.usualSpend * 0.08) out.push({ id: 'giving', title: 'Plan giving as its own monthly line', amount: A.givingAvg, amountLabel: 'a month on average',
      why: `Giving averages ${$(A.givingAvg)} a month and comes in lumps, so a big giving week can look like overspending against the target. Setting it aside each month keeps both honest.`, link: F.budget });
  } catch { /* a figure is missing from facts.json: skip this step */ }
  out.calc = { months, cushion, seTax, tuition, keep, extra };
  return out;
}

export function questions(A, facts) {
  const F = facts.facts; const q = [];
  try { q.push({ title: 'Does either job offer a 401(k) or 403(b) match?', why: `A match is free money and comes before the IRA. The ${F.k401_limit.year} employee limit is $${F.k401_limit.value.toLocaleString('en-US')}.`, link: F.k401_limit }); } catch { /* missing figure */ }
  try { q.push({ title: 'Is our health plan HSA-eligible?', why: `Only with a high-deductible plan (family deductible at least $${F.hsa_hdhp_min_family.value.toLocaleString('en-US')}). If so, up to $${F.hsa_family.value.toLocaleString('en-US')} for family coverage in ${F.hsa_family.year}.`, link: F.hsa_rules }); } catch { /* missing figure */ }
  try { if (A.bizRows.length) q.push({ title: 'If the side business grows: Solo 401(k) or SEP-IRA?', why: `Either can shelter business profit, up to $${F.dc_total_limit.value.toLocaleString('en-US')} total in ${F.dc_total_limit.year}. Not urgent at today's size.`, link: F.solo_401k }); } catch { /* missing figure */ }
  try { q.push({ title: 'Do we have term life and disability coverage?', why: 'If one paycheck stopped, how long would the cushion last? Check what work or school already provides before buying anything.', link: F.life_insurance, link2: F.disability_insurance }); } catch { /* missing figure */ }
  return q;
}
