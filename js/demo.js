// The demo tour's made-up household. Everything here is fictional: the couple, employers, banks, stores and
// numbers. Nothing is read from or derived from our real data; it is built in the browser from this file alone,
// with dates relative to today, in the same shape as a real bank pull so every page runs the same code.
import { addDays, weekStart } from './logic.js?v=19';

// Wording the pages use where the real app names our own investing account.
export const DEMO_WORDS = {
  invInto: 'into index funds (Northpeak). Not spending.',
  invStory: 'the index funds',
  invBuys: 'Index fund buys',
  invBuysMid: 'index fund buys',
  invHow: 'Index fund buys through Northpeak Brokerage. Counted once, from the bank side. Not spending.',
  invInside: 'The funds are counted once, inside the Northpeak account balance.',
  holdNote: 'Counted once, as part of the Northpeak Brokerage account balance.',
  incomeNote: 'including small paybacks from friends',
};

// Small seeded random generator so the tour looks the same until someone shuffles it.
function rng(seed) {
  let a = (seed >>> 0) || 1;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const lastDay = (d) => { const [y, m] = d.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };

const ACCTS = [
  { id: 'demo-chk', class: 'cash', institution: 'Pinecrest Credit Union', mask: '0101', subtype: 'checking', display: 'Pinecrest Checking', nickname: 'Bills', balance: 3842.17, available: 3842.17 },
  { id: 'demo-sav', class: 'cash', institution: 'Cedar Online Bank', mask: '0202', subtype: 'savings', display: 'Cedar High-Yield Savings', nickname: 'Cushion', balance: 14615.4, available: 14615.4 },
  { id: 'demo-brk', class: 'investment', institution: 'Northpeak Brokerage', mask: '0303', subtype: 'brokerage', display: 'Northpeak Brokerage', nickname: '', balance: 0, available: null },
  { id: 'demo-card', class: 'liability', institution: 'Summit Bank', mask: '0404', subtype: 'credit card', display: 'Summit Visa', nickname: '', balance: 612.4, available: null },
];

export function makeDemo(today, seed = 1) {
  const R = rng(seed * 7919 + 17);
  const amt = (lo, hi) => Math.round((lo + R() * (hi - lo)) * 100) / 100;
  const pick = (a) => a[Math.floor(R() * a.length)];
  const txns = []; let n = 0;
  const add = (date, account_id, src, label, amount, kind0, cat0 = null, extra = {}) =>
    txns.push({ id: `demo-${++n}`, src, account_id, date, amount: Math.round(amount * 100) / 100, pending: false, label, key: label.toLowerCase(), kind0, cat0, ...extra });
  const card = (d, label, lo, hi, cat) => add(d, 'demo-card', 'card', label, -amt(lo, hi), 'spend', cat);
  const debit = (d, label, a, cat) => add(d, 'demo-chk', 'cash', label, -a, 'spend', cat);

  // about six full months back, from the 1st
  const [ty, tm] = today.split('-').map(Number);
  const back = new Date(Date.UTC(ty, tm - 1 - 6, 1)).toISOString().slice(0, 10);
  const from = back;
  const payAnchor = weekStart(from); // payday Fridays every other week from here
  for (let d = from; d <= today; d = addDays(d, 1)) {
    const dow = new Date(d + 'T12:00:00Z').getUTCDay();
    const dom = Number(d.slice(8, 10)); const last = lastDay(d); const mo = Number(d.slice(5, 7));
    // income
    if (dow === 5 && (Math.round((Date.parse(d) - Date.parse(payAnchor)) / 864e5 / 7) % 2 === 0)) add(d, 'demo-chk', 'cash', 'Harbor & Pine Design payroll', 2236.18 + (R() < 0.15 ? amt(40, 160) : 0), 'income');
    if (dom === 15 || dom === last) add(d, 'demo-chk', 'cash', 'Lakeview School District payroll', 962.75, 'income');
    if (dom === 9 && mo % 2 === 0) add(d, 'demo-chk', 'cash', 'Fernwood Studio LLC', amt(420, 880), 'income');
    if (dom === last) add(d, 'demo-sav', 'cash', 'Interest paid', amt(46, 51), 'income');
    if (R() < 0.025) add(d, 'demo-chk', 'cash', 'Zelle from Dana K.', pick([24, 38.5, 45, 60]), 'income');
    // bills and moves
    if (dom === 3) debit(d, 'Cedar Valley Power', amt(68, 112), 'home');
    if (dom === 5) add(d, 'demo-chk', 'cash', 'Northpeak Brokerage transfer', -400, 'investing');
    if (dom === 8) card(d, 'Brightline Internet', 65, 65, 'home');
    if (dom === 10) card(d, 'Northwind Mobile', 72.4, 72.4, 'other');
    if (dom === 12) { const p = amt(1350, 1850); add(d, 'demo-chk', 'cash', 'Summit Visa payment', -p, 'card_payment'); add(d, 'demo-card', 'card', 'Summit Visa payment', p, 'card_payment'); }
    if (dom === 14) card(d, 'StreamBox', 15.99, 15.99, 'fun');
    if (dom === 16) card(d, 'Trailhead Climbing Gym', 68, 68, 'fun');
    if (dom === 18) add(d, 'demo-chk', 'cash', 'Juniper Store Card payment', -amt(85, 140), 'card_payment');
    if (dom === 20) { add(d, 'demo-chk', 'cash', 'Transfer to Cedar Savings', -500, 'transfer'); add(d, 'demo-sav', 'cash', 'Transfer from Pinecrest Checking', 500, 'transfer'); }
    if (dom === 22) debit(d, 'Granite Auto Insurance', 112, 'gas');
    if (dom === 26) card(d, 'Community Food Bank', 40, 40, 'giving');
    // everyday purchases
    if (dow === 6) card(d, 'Hilltop Market', 72, 158, 'groceries');
    if (dow === 3) card(d, 'Green Basket Co-op', 24, 71, 'groceries');
    if (dow === 1) card(d, 'Ridgeline Fuel', 34, 58, 'gas');
    if (R() < 0.33) card(d, pick(['Copper Kettle Diner', 'Little Fig Tacos', 'Saffron House', 'Slice & Co. Pizza']), 11, 52, 'eating_out');
    if (R() < 0.25) card(d, 'Bluebird Coffee', 4.5, 9.75, 'eating_out');
    if (R() < 0.08) card(d, 'Orbit Online Store', 18, 92, 'shopping');
    if (R() < 0.04) card(d, 'Maple & Main Goods', 25, 120, 'shopping');
    if (R() < 0.05) card(d, 'Starlight Cinema', 24, 36, 'fun');
    if (R() < 0.03) card(d, 'Willow Pharmacy', 8, 40, 'health');
    if (R() < 0.035) card(d, 'Corner Hardware', 12, 64, 'other');
  }
  // weekly tithing at the church, a day after the week closes: about 10% of that week's income, a little off some weeks
  const wk = {}; for (const t of txns) if (t.kind0 === 'income') { const k = weekStart(t.date); wk[k] = (wk[k] || 0) + t.amount; }
  let skipped = 0;
  for (const k of Object.keys(wk).sort()) {
    const pay = addDays(k, 7 + (R() < 0.3 ? 1 : 0)); if (pay >= addDays(today, -6) || k <= addDays(from, 6)) continue;   // the newest week is still to pay
    const due = wk[k] * 0.1; const roll = R();
    if (roll < 0.10 && skipped < 2 && pay < addDays(today, -21)) { skipped++; continue; }   // a missed week, caught up later
    const give = Math.round(roll > 0.78 ? due * 1.25 : roll > 0.5 ? due * 0.95 : due);
    if (give >= 5) add(pay, 'demo-chk', 'cash', 'Hillcrest Community Church', -give, 'spend', 'giving');
  }
  // a few one-time moments
  const couch = addDays(today, -52);
  add(couch, 'demo-card', 'card', 'Maple & Main Goods', -1640, 'spend', 'shopping', { note: 'New couch' });
  add(addDays(today, -96), 'demo-card', 'card', 'Brookside Dental', -185, 'spend', 'health');
  add(addDays(today, -31), 'demo-card', 'card', 'Orbit Online Store', 32.5, 'spend', 'shopping', { note: 'Returned the lamp' });
  add(addDays(today, -40), 'demo-card', 'card', 'Hope Family Shelter', -150, 'spend', 'giving');
  // the newest purchase is still pending
  const lastBuy = txns.filter((t) => t.src === 'card' && t.kind0 === 'spend' && t.amount < 0).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  if (lastBuy && lastBuy.date >= addDays(today, -2)) lastBuy.pending = true;

  const holdings = [
    { account_id: 'demo-brk', ticker: 'NPTM', name: 'Northpeak Total Market Index', type: 'mutual fund', quantity: 142.318, price: 118.42, value: 0 },
    { account_id: 'demo-brk', ticker: 'NPBD', name: 'Northpeak Total Bond Index', type: 'mutual fund', quantity: 210.5, price: 48.17, value: 0 },
  ];
  for (const h of holdings) h.value = Math.round(h.quantity * h.price * 100) / 100;
  const accounts = ACCTS.map((a) => ({ ...a }));
  const wiggle = seed === 1 ? 0 : amt(-900, 900);
  accounts[0].balance = accounts[0].available = Math.round((3842.17 + wiggle) * 100) / 100;
  accounts[2].balance = Math.round(holdings.reduce((t, h) => t + h.value, 0) * 100) / 100;
  const pulled = new Date(Date.now() - 2 * 3600e3).toISOString();
  const data = {
    version: 1, pulled_at: pulled, coverage: { from, to: today, note: 'About 6 months of made-up activity' },
    connections: ['Pinecrest Credit Union', 'Cedar Online Bank', 'Northpeak Brokerage', 'Summit Bank'].map((name) => ({ name, status: 'active', updated_at: pulled })),
    accounts, holdings, txns,
  };
  const made = new Date(Date.now() - 40 * 864e5).toISOString();
  return {
    server_time: new Date().toISOString(),
    snapshot: { id: `demo-${seed}`, pulled_at: pulled, saved_at: pulled, data },
    items: [
      { id: 'demo-item-1', shape: 'car', side: 'own', name: 'Our Subaru', amount: 14500, created_at: made },
      { id: 'demo-item-2', shape: 'loan', side: 'owe', name: 'Car loan', amount: 6180, created_at: made },
    ],
    fixes: [{ merchant_key: 'corner hardware', merchant_label: 'Corner Hardware', set_to: 'home' }],
    settings: { weekly_target: 500 },
    tithing: [],
    open_request: null,
  };
}

// In-memory stand-ins for every write the real app makes. Nothing leaves the browser; it all vanishes on exit.
let nextItem = 100;
export function demoWrite(data, fn, body) {
  if (fn === 'ours_item_save') {
    const side = body.p_shape === 'loan' ? 'owe' : 'own';
    const old = (data.items || []).find((i) => i.id === body.p_id);
    return { ...(old || { id: `demo-item-${++nextItem}`, created_at: new Date().toISOString() }), shape: body.p_shape, side, name: String(body.p_name).trim(), amount: Math.round(body.p_amount * 100) / 100 };
  }
  if (fn === 'ours_item_delete') return true;
  if (fn === 'ours_fix_set') return { merchant_key: body.p_merchant_key, merchant_label: body.p_merchant_label, set_to: body.p_set_to };
  if (fn === 'ours_fix_clear') return true;
  if (fn === 'ours_setting_set') { if (!['weekly_target', 'tithing_pct', 'tithing_start', 'tithing_skip'].includes(body.p_name)) throw new Error('not in the tour'); return { name: body.p_name, value: body.p_value }; }
  if (fn === 'ours_tithe_save') return { id: `demo-tithe-${++nextItem}`, week: body.p_week, kind: body.p_kind, amount: body.p_amount, note: body.p_note, created_at: new Date().toISOString() };
  if (fn === 'ours_tithe_delete') return true;
  if (fn === 'ours_request_refresh' || fn === 'ours_latest') return null;
  throw new Error('not in the tour');
}
