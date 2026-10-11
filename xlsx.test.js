// node tests/xlsx.test.js — builds a sample Kaizen sheet and checks the file is a valid zip with the expected parts
const assert = require('assert'), fs = require('fs'), path = require('path');
const K = require('../src/kaizen-calc'), X = require('../src/kaizen-xlsx');
const r = K.calcLine({ type: 'manpower', values: { t: 2, tUnit: 'hr', ops: 2, wage: 800, shift: 12, days: 26 } });
const bytes = X.build({ kaizenNo: 'T-1', date: '07-10-2026', department: 'Production', company: 'Test Co', team: 'A, B',
  problem: 'Cores were mixed up.', counter: 'Movable racks.', before: 'Searching.', after: 'Easy to find.',
  benefits: '1) Faster.', savingsText: K.savingsText([r]), wastes: [0,0,1,0,0,1,1,0].map(Boolean), pqcdsm: [1,0,1,0,0,0].map(Boolean), horizontal: 'yes' });
const buf = Buffer.from(bytes);
assert.strictEqual(buf.readUInt32LE(0), 0x04034b50);
['[Content_Types].xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml', 'xl/styles.xml'].forEach(p => assert.ok(buf.includes(Buffer.from(p)), p));
assert.ok(buf.includes(Buffer.from('Rs 83,200')));
fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'out', 'Kaizen-T-1.xlsx'), bytes);
console.log('xlsx test passed → tests/out/Kaizen-T-1.xlsx');

// register workbook with a SUM total row
const reg = X.buildRegister({ title: 'Kaizen register', columns: [{ h: 'Kaizen No.' }, { h: 'Total / year', num: true }], rows: [['01', 10000], ['02', 187200]], totalCols: [1] });
const rb = Buffer.from(reg);
assert.ok(rb.includes(Buffer.from('SUM(B4:B5)')));
fs.writeFileSync(path.join(__dirname, 'out', 'register.xlsx'), reg);
console.log('register test passed → tests/out/register.xlsx');
