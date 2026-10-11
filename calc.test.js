// node tests/calc.test.js — checks the formulas against the plant's own Kaizen sheets
const assert = require('assert');
const K = require('../src/kaizen-calc');
const year = (type, values) => Math.round(K.calcLine({ type, values }).year);
// Movable Rack: 2 hr × 2 operators, Rs 800 on a 12-hr shift, 26 days → Rs 83,200
assert.strictEqual(year('manpower', { t: 2, tUnit: 'hr', ops: 2, wage: 800, shift: 12, days: 26 }), 83200);
// Kaizen 02 corrected: 25 min, Rs 600 on an 8-hr shift, 26 days → Rs 9,750
assert.strictEqual(year('manpower', { t: 25, tUnit: 'min', ops: 1, wage: 600, shift: 8, days: 26 }), 9750);
// Kaizen 01: 45 min, Rs 400 on a 9-hr shift, 25 days → Rs 10,000 (sheet shows 9,900 because Rs 44.44/hr was rounded to 44)
assert.strictEqual(year('manpower', { t: 45, tUnit: 'min', ops: 1, wage: 400, shift: 9, days: 25 }), 10000);
// Kaizen 03: 1 manpower released (full 9-hr shift), Rs 600/day, 26 days → Rs 1,87,200
assert.strictEqual(year('manpower', { t: 9, tUnit: 'hr', ops: 1, wage: 600, shift: 9, days: 26 }), 187200);
// PLC: 15 rejections × Rs 15,000 → Rs 27,00,000; payback 3.7 months on Rs 8,40,000
const plc = K.calcLine({ type: 'rejection', values: { before: 15, after: 0, cost: 15000, inv: 840000 } });
assert.strictEqual(Math.round(plc.year), 2700000); assert.strictEqual(plc.payback.toFixed(1), '3.7');
// Kaizen 07: scrap sold for Rs 10.5 lakh is one-time, never × 12
const scrap = K.calcLine({ type: 'other', values: { desc: 'scrap sold', freq: 'once', monthly: 1050000, kind: 'hard' } });
assert.strictEqual(scrap.once, 1050000); assert.strictEqual(scrap.year, 0);
assert.strictEqual(K.totals([scrap]).oneTime, 1050000);
// Safety: 4 × 4 = 16 → 4 × 1 = 4, 75% lower
const s = K.calcLine({ type: 'safety', values: { sev: 4, lb: 4, la: 1 } });
assert.strictEqual(s.risk.before, 16); assert.strictEqual(s.risk.after, 4); assert.strictEqual(Math.round(s.risk.pct), 75);
console.log('calc tests passed');
