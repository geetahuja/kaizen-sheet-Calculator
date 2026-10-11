# Kaizen Sheet Maker

One app for the whole Kaizen workflow: write up a Kaizen, calculate its savings the same way every time, keep every Kaizen in a register, and download the Kaizen sheet (in the plant's own format) or the whole register as Excel.

It has no dependencies and no server. Open `app/Kaizen-Sheet-Maker.html` in Chrome or Edge, offline included.

## What it does

The app has three tabs that share the same calculation code:

| Tab | What it is for |
| --- | --- |
| **Kaizen sheet** | The full Kaizen form, savings with suggestions, and "Download Excel sheet". "Save to My Kaizens" keeps it in the register; after that, changes save automatically |
| **Quick calculator** | Try a saving without writing up a Kaizen. "Add to Kaizen sheet" moves the lines into the open Kaizen |
| **My Kaizens** | Every saved Kaizen with grand totals (yearly, hard, soft, one-time, investment), search, open / Excel / delete, "Download register (Excel)", and backup / restore |

In detail:

- **The Kaizen sheet:** company or logo, Kaizen No., date, department, line/area, machine, team, theme, target, problem (5W1H), analysis (7 QC tools), root cause (4M), counter measure, before and after text and photos, waste attacked, PQCDSM, horizontal deployment, benefits, idea and implemented by.
- **Savings:** Manpower, Rejection, Electricity, Material, Other / one-time gain, and Safety (a risk score, no rupees). Several per Kaizen, each with its working written out.
- **Suggestions:** reads what the user wrote and suggests saving types, waste and PQCDSM ticks, and pre-fills numbers it finds (operators, minutes, wage, shift, rejections, loss per rejection, kW, investment, lakh amounts). It learns from every downloaded Kaizen.
- **Excel output:** each Kaizen is one A4 landscape page in the same layout as the plant's Kaizen sheet, with the savings working printed in the Benefits block. The register is one row per Kaizen with filters, frozen headings, Indian digit grouping and a TOTAL row.

## Calculation rules

| Saving | Formula |
| --- | --- |
| Manpower | hourly rate = per-day wage ÷ shift hours; per day = hours saved × operators × hourly rate; per month = per day × working days; per year = per month × 12 |
| Rejection | (rejections per month before − after) × loss per rejected job × 12 |
| Electricity | kW reduced × running hours per day × rate per kWh × working days × 12 |
| Material | quantity saved per day × price per unit × working days × 12 |
| Other | an entered monthly amount × 12, or a **one-time** amount counted once (e.g. scrap sold) |
| Safety | risk = severity (1–5) × likelihood (1–5), before and after |

- Investment is shown as **payback in months**. It is never subtracted from the yearly saving.
- Hard savings, soft savings and one-time gains are totalled separately.
- Shift length (8, 9 or 12 hr) and working days (25, 26 or 30) are set on each saving line.

The tests check these formulas against the plant's own sheets: Movable Rack Rs 83,200, Kaizen 03 Rs 1,87,200, PLC payback 3.7 months, and Kaizen 07 as a one-time Rs 10,50,000.

## Folder layout

```
app/Kaizen-Sheet-Maker.html     the built app, a single file
src/kaizen-calc.js              saving types, formulas, working text, totals
src/kaizen-xlsx.js              builds the Kaizen sheet .xlsx and the register .xlsx (own zip writer, no libraries)
src/kaizen-suggest.js           text classifier: keyword rules + Naive Bayes, number extraction
src/app.src.html                the app's page; tools/build.py inlines the three modules into it
tools/build.py                  python3 tools/build.py  →  app/Kaizen-Sheet-Maker.html
tests/*.test.js                 npm test
tests/e2e_browser.py            browser walkthrough of all three tabs (needs Playwright)
examples/                       an Excel sheet produced by the app
```

## Build and test

```
python3 tools/build.py   # rebuild the app after changing anything in src/
npm test                 # formulas, suggestions, Excel output (Node 18+)
```

## Using the code in the main app

All three modules work in the browser (`window.KaizenCalc`, `window.KaizenXlsx`, `window.KaizenSuggest`) and in Node (`require`).

```js
const KaizenCalc = require('./src/kaizen-calc');
const KaizenXlsx = require('./src/kaizen-xlsx');
const KaizenSuggest = require('./src/kaizen-suggest');

// a saving line: store `type` + `values` in the database, recalculate on read
const line = { type: 'manpower', values: { t: 45, tUnit: 'min', ops: 1, wage: 400, shift: 9, days: 25 } };
const r = KaizenCalc.calcLine(line);        // r.year = 10000, r.working = ['Hourly rate = Rs 400 ÷ 9 hr = Rs 44.44/hr', ...]

// suggestions
const model = KaizenSuggest.train(approvedExamplesFromDb);   // [{ text, labels }]
const s = KaizenSuggest.suggest(model, problem + '\n' + counter + '\n' + before + '\n' + after);
const prefill = KaizenSuggest.prefill(s.types[0].type, s.numbers);
// when a Kaizen is approved, store KaizenSuggest.exampleFrom(text, lineTypes, wastes, pqcdsm)

// Excel
const bytes = KaizenXlsx.build({
  kaizenNo: '05', date: '07-10-2026', department: 'Production', line: '1', machine: '', company: 'Advent Engineers',
  team: '', theme: '', target: '', problem: '', counter: '', before: '', after: '', analysis: '', rootCause: '',
  benefits: '', savingsText: KaizenCalc.savingsText([r]), idea: '', implementedBy: '',
  wastes: [false, false, true, false, true, false, true, false],   // 8, in sheet order
  pqcdsm: [true, false, true, false, false, false],                // P Q C D S M
  horizontal: 'yes',
  logo: null, photoBefore: null, photoAfter: null                  // or { bytes, ext: 'jpeg'|'png', width, height }
});
```

## Notes and limits

- In the standalone app, My Kaizens, drafts and learning are kept in the browser they were made in (IndexedDB and localStorage). Use "Back up all" / "Restore backup" on the My Kaizens tab to move them to another computer, and download Excel files to keep permanent copies.
- In the main app, replace that browser storage with the database: store each Kaizen's fields and its saving lines (`type` + `values`), and rebuild sheets and the register with `KaizenXlsx.build` / `KaizenXlsx.buildRegister`.
- The suggestions start from 12 example Kaizens (Advent Engineers and Advent Powertech sheets). On those, the top suggested saving type was right 12 of 12 times in a leave-one-out test, and the full set of types was exact 9 of 12 times. Expect it to improve noticeably after 100–200 approved Kaizens.
- Suggestions only pre-fill the form. Every value is shown for the user to check, and every rupee figure comes from `kaizen-calc.js`.
- Tick boxes in the Excel file are ☑ / ☐ symbols rather than Excel form controls, so they print reliably. Change them in the app, not in Excel.
- The Excel output has been checked in LibreOffice. Open one file in Microsoft Excel before relying on it for printing.
