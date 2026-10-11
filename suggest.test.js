// node suggest.test.js — leave-one-out check on the built-in examples + number extraction
const assert = require('assert');
const S = require('./kaizen-suggest');
const seeds = S.SEEDS.splice(0); let exact = 0, topRight = 0;
seeds.forEach((e, i) => {
  const m = S.train(seeds.filter((_, j) => j !== i));
  const got = S.suggest(m, e.text).types.map(t => t.type);
  const want = Object.keys(e.labels).filter(l => l.startsWith('type:')).map(l => l.slice(5));
  if (got.slice().sort().join() === want.slice().sort().join()) exact++;
  if (got.length && want.includes(got[0])) topRight++;
});
S.SEEDS.push(...seeds);
console.log(`saving types, leave-one-out: exact ${exact}/${seeds.length}, top suggestion right ${topRight}/${seeds.length}`);
assert.ok(topRight >= seeds.length - 1);
const n = S.extractNumbers('Winding wire breakage caused 20 coils rejected per month, loss Rs 3500 per coil. Tension controller installed, investment Rs 45000.');
assert.deepStrictEqual([n.before, n.cost, n.inv], [20, 3500, 45000]);
const t = S.extractNumbers('Saved 1 hour per day for 1 operator, wage Rs 800 per day, 8 hour shift.');
assert.deepStrictEqual([t.t, t.tUnit, t.ops, t.wage, t.shift], [1, 'hr', 1, 800, 8]);
const l = S.extractNumbers('25 tonnes of scrap sold, generating Rs 10.5 lakh.');
assert.deepStrictEqual([l.amount, l.once], [1050000, true]);
console.log('suggest tests passed');
