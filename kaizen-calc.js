/*
 * kaizen-calc.js — Kaizen savings calculations (no dependencies).
 * Works in the browser (window.KaizenCalc) and in Node (require('./kaizen-calc')).
 *
 * Every saving type: a list of input fields + a calc(inputs) function.
 * calc() returns { cls, day?, month, year, inv, payback, roi, working[] }.
 * The arithmetic lives ONLY here so the app, the Excel sheet and any future
 * backend all produce the same numbers.
 */
(function (root) {
  'use strict';

  // ---------- number formatting (Indian grouping: 1,24,800) ----------
  function fmt(n, d) {
    if (d === undefined) d = 0;
    if (!isFinite(n)) return '–';
    return Number(n).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function rs(n, d) {
    d = d === undefined ? 0 : d;
    if (d > 0 && isFinite(n) && Math.abs(n - Math.round(n)) < 0.005) d = 0; // Rs 75, not Rs 75.00
    return 'Rs ' + fmt(n, d);
  }
  function plain(n, d) { // trims trailing zeros: 2, 2.5, 0.42
    if (!isFinite(n)) return '–';
    return Number(Number(n).toFixed(d === undefined ? 2 : d)).toLocaleString('en-IN');
  }
  function num(v) { var x = typeof v === 'string' ? parseFloat(v) : v; return isFinite(x) ? x : NaN; }

  var CLASS_LABEL = { hard: 'Hard saving', soft: 'Soft saving', avoid: 'Safety / cost avoidance' };

  // ---------- saving types ----------
  // field: id, label, sub (help), unit, def (default for a new line), chips (quick picks)
  var TYPES = {
    manpower: {
      label: 'Manpower', title: 'Manpower / labour time saved', cls: 'soft',
      pqcdsm: ['Productivity', 'Cost'],
      note: 'Soft saving unless overtime is cut or a person is released or moved to other work.',
      fields: [
        { id: 't', label: 'Time saved per operator per day', unit: 'time', def: 1 },
        { id: 'ops', label: 'Number of operators', unit: 'operators', def: 1 },
        { id: 'wage', label: 'Per-day wage', sub: 'per operator', unit: 'Rs/day', def: 800 },
        { id: 'shift', label: 'Shift hours', unit: 'hr', def: 8, chips: [8, 9, 12] },
        { id: 'days', label: 'Working days per month', unit: 'days', def: 26, chips: [25, 26, 30] },
        { id: 'inv', label: 'One-time investment', sub: 'optional, for payback', unit: 'Rs', def: 0, optional: true }
      ],
      calc: function (v) {
        var unitMin = v.tUnit === 'min';
        var hrs = unitMin ? v.t / 60 : v.t;
        var rate = v.wage / v.shift;
        var day = hrs * v.ops * rate;
        var month = day * v.days;
        var w = [];
        w.push('Hourly rate = ' + rs(v.wage) + ' ÷ ' + plain(v.shift) + ' hr = ' + rs(rate, 2) + '/hr');
        w.push('Per day = ' + (unitMin ? plain(v.t) + ' min (' + plain(hrs, 3) + ' hr)' : plain(hrs) + ' hr') +
          ' × ' + plain(v.ops) + ' operator' + (v.ops === 1 ? '' : 's') + ' × ' + rs(rate, 2) + ' = ' + rs(day, 2));
        w.push('Per month = ' + rs(day, 2) + ' × ' + plain(v.days) + ' days = ' + rs(month, 2));
        var warn = (v.shift > 0 && hrs > v.shift) ? 'Time saved per operator is more than the shift length.' : '';
        return { day: day, month: month, working: w, warn: warn };
      }
    },
    rejection: {
      label: 'Rejection', title: 'Rejection / scrap reduction', cls: 'hard',
      pqcdsm: ['Quality', 'Cost'],
      note: 'Hard saving: material and labour no longer lost on rejected jobs.',
      fields: [
        { id: 'before', label: 'Rejections per month, before', unit: 'jobs', def: 10 },
        { id: 'after', label: 'Rejections per month, after', unit: 'jobs', def: 0 },
        { id: 'cost', label: 'Loss per rejected job', sub: 'material + labour + overhead − scrap value', unit: 'Rs/job', def: 1000 },
        { id: 'inv', label: 'One-time investment', sub: 'optional, for payback', unit: 'Rs', def: 0, optional: true }
      ],
      calc: function (v) {
        var avoided = v.before - v.after;
        var month = avoided * v.cost;
        return {
          month: month,
          working: ['Rejections avoided = ' + plain(v.before, 0) + ' − ' + plain(v.after, 0) + ' = ' + plain(avoided, 0) + ' jobs/month',
            'Per month = ' + plain(avoided, 0) + ' jobs × ' + rs(v.cost) + ' = ' + rs(month, 2)],
          warn: avoided < 0 ? 'Rejections went up after the change, so this shows a loss.' : ''
        };
      }
    },
    electricity: {
      label: 'Electricity', title: 'Electricity saving', cls: 'hard',
      pqcdsm: ['Cost'],
      note: 'Hard saving: shows on the power bill. Take the rate per unit (kWh) from the latest bill.',
      fields: [
        { id: 'kw', label: 'Power reduced', sub: 'load before − load after', unit: 'kW', def: 1 },
        { id: 'hrs', label: 'Running hours per day', unit: 'hr', def: 8 },
        { id: 'days', label: 'Working days per month', unit: 'days', def: 26, chips: [25, 26, 30] },
        { id: 'tariff', label: 'Rate per unit', sub: 'from your power bill', unit: 'Rs/kWh', def: 9 },
        { id: 'inv', label: 'One-time investment', sub: 'optional, for payback', unit: 'Rs', def: 0, optional: true }
      ],
      calc: function (v) {
        var units = v.kw * v.hrs, day = units * v.tariff, month = day * v.days;
        return {
          day: day, month: month,
          working: ['Units saved per day = ' + plain(v.kw) + ' kW × ' + plain(v.hrs) + ' hr = ' + plain(units, 1) + ' kWh',
            'Per day = ' + plain(units, 1) + ' kWh × ' + rs(v.tariff, 2) + ' = ' + rs(day, 2),
            'Per month = ' + rs(day, 2) + ' × ' + plain(v.days) + ' days = ' + rs(month, 2)]
        };
      }
    },
    material: {
      label: 'Material', title: 'Material / consumable saving', cls: 'hard',
      pqcdsm: ['Cost'],
      note: 'Hard saving: less material bought for the same output.',
      fields: [
        { id: 'qty', label: 'Quantity saved per day', unit: 'qty', def: 1 },
        { id: 'price', label: 'Price per unit', unit: 'Rs', def: 100 },
        { id: 'days', label: 'Working days per month', unit: 'days', def: 26, chips: [25, 26, 30] },
        { id: 'inv', label: 'One-time investment', sub: 'optional, for payback', unit: 'Rs', def: 0, optional: true }
      ],
      calc: function (v) {
        var u = v.qtyUnit || 'units', day = v.qty * v.price, month = day * v.days;
        return {
          day: day, month: month,
          working: ['Per day = ' + plain(v.qty) + ' ' + u + ' × ' + rs(v.price, 2) + ' = ' + rs(day, 2),
            'Per month = ' + rs(day, 2) + ' × ' + plain(v.days) + ' days = ' + rs(month, 2)]
        };
      }
    },
    other: {
      label: 'Other', title: 'Other saving or one-time gain', cls: 'hard',
      pqcdsm: ['Cost'],
      note: 'For savings that do not fit the other types, or one-time gains such as scrap sold. Describe how the figure was worked out.',
      fields: [
        { id: 'desc', label: 'What is saved and how', unit: 'text', def: '' },
        { id: 'freq', label: 'How often', unit: 'freq', def: 'month' },
        { id: 'monthly', label: 'Amount', sub: 'per month, or the one-time total', unit: 'Rs', def: 0 },
        { id: 'kind', label: 'Type of saving', unit: 'class', def: 'hard' },
        { id: 'inv', label: 'One-time investment', sub: 'optional, for payback', unit: 'Rs', def: 0, optional: true }
      ],
      calc: function (v) {
        var cls = v.kind === 'soft' ? 'soft' : 'hard', d = v.desc ? v.desc + ': ' : '';
        if (v.freq === 'once') return { once: v.monthly, cls: cls, working: [d + 'One-time benefit = ' + rs(v.monthly) + ' (not repeated, not multiplied by 12)'] };
        return { month: v.monthly, cls: cls, working: [d + 'Per month = ' + rs(v.monthly, 2) + ' (entered)'] };
      }
    },
    safety: {
      label: 'Safety', title: 'Safety risk reduction', cls: 'avoid', safety: true,
      pqcdsm: ['Safety'],
      note: 'Safety Kaizens are not forced into rupees. Rate severity and likelihood from 1 to 5, before and after.',
      fields: [
        { id: 'sev', label: 'Severity if it happens', sub: '1 first aid · 3 lost-time injury · 5 fatal / permanent', unit: '1–5', def: 3 },
        { id: 'lb', label: 'Likelihood before', sub: '1 rare · 3 possible · 5 almost certain', unit: '1–5', def: 3 },
        { id: 'la', label: 'Likelihood after', unit: '1–5', def: 1 },
        { id: 'inv', label: 'Cost of the fix', sub: 'optional', unit: 'Rs', def: 0, optional: true }
      ]
    }
  };

  function riskLevel(s) { return s >= 12 ? 'High' : s >= 6 ? 'Medium' : 'Low'; }
  function clamp15(n) { return Math.min(5, Math.max(1, Math.round(n))); }

  /** Fill defaults for a new line of the given type. */
  function newLine(type) {
    var T = TYPES[type], v = {};
    T.fields.forEach(function (f) { v[f.id] = f.def; });
    if (type === 'manpower') v.tUnit = 'hr';
    if (type === 'material') v.qtyUnit = 'kg';
    return { type: type, values: v };
  }

  /** Which required inputs are missing or invalid. */
  function missing(line) {
    var T = TYPES[line.type], v = line.values;
    return T.fields.filter(function (f) {
      if (f.optional || f.unit === 'text' || f.unit === 'class' || f.unit === 'freq') return false;
      return !isFinite(num(v[f.id]));
    }).map(function (f) { return f.label; });
  }

  /** Calculate one saving line. Returns null when inputs are missing. */
  function calcLine(line) {
    var T = TYPES[line.type];
    if (!T || missing(line).length) return null;
    var v = {};
    Object.keys(line.values).forEach(function (k) {
      var x = line.values[k];
      v[k] = (k === 'tUnit' || k === 'qtyUnit' || k === 'desc' || k === 'kind' || k === 'freq') ? x : num(x);
    });
    var inv = isFinite(v.inv) ? v.inv : 0;

    if (T.safety) {
      var sev = clamp15(v.sev), lb = clamp15(v.lb), la = clamp15(v.la);
      var b = sev * lb, a = sev * la, pct = b ? (b - a) / b * 100 : 0;
      var work = ['Risk = severity × likelihood',
        'Before = ' + sev + ' × ' + lb + ' = ' + b + ' (' + riskLevel(b) + ')',
        'After = ' + sev + ' × ' + la + ' = ' + a + ' (' + riskLevel(a) + ')',
        'Risk reduced by ' + fmt(pct, 0) + '%'];
      if (inv > 0) work.push('Cost of the fix = ' + rs(inv));
      return { type: line.type, label: T.label, cls: 'avoid', year: 0, month: 0, inv: inv,
        risk: { sev: sev, before: b, after: a, pct: pct, levelBefore: riskLevel(b), levelAfter: riskLevel(a) },
        headline: 'Risk ' + b + ' → ' + a + ' (−' + fmt(pct, 0) + '%)', working: work, warn: '' };
    }

    var r = T.calc(v);
    var cls = r.cls || T.cls;
    if (r.once !== undefined) { // one-time gain: counted once, never × 12
      return { type: line.type, label: T.label, cls: cls, once: r.once, month: 0, year: 0, inv: inv, payback: NaN, roi: NaN,
        headline: rs(r.once) + ' one-time', working: r.working.concat(inv > 0 ? ['Investment = ' + rs(inv)] : []), warn: '' };
    }
    var month = r.month, year = month * 12;
    var working = r.working.slice();
    working.push('Per year = ' + rs(month, 2) + ' × 12 = ' + rs(year));
    var payback = inv > 0 && month > 0 ? inv / month : NaN;
    var roi = inv > 0 ? (year - inv) / inv * 100 : NaN;
    if (inv > 0) {
      working.push('Investment = ' + rs(inv) + (isFinite(payback)
        ? '; payback = ' + rs(inv) + ' ÷ ' + rs(month) + ' per month = ' + fmt(payback, 1) + ' months'
        : '; no payback (saving is zero or negative)'));
    }
    return { type: line.type, label: T.label, cls: cls, day: r.day, month: month, year: year,
      inv: inv, payback: payback, roi: roi, headline: rs(year) + ' per year', working: working, warn: r.warn || '' };
  }

  /** Totals across all lines of one Kaizen. */
  function totals(results) {
    var t = { hard: 0, soft: 0, inv: 0, total: 0, payback: NaN, count: results.length, safety: 0, oneTime: 0 };
    results.forEach(function (r) {
      if (!r) return;
      if (r.once !== undefined) t.oneTime += r.once;
      if (r.cls === 'hard') t.hard += r.year;
      if (r.cls === 'soft') t.soft += r.year;
      if (r.cls === 'avoid') t.safety += 1;
      t.inv += r.inv || 0;
    });
    t.total = t.hard + t.soft;
    if (t.inv > 0 && t.total > 0) t.payback = t.inv / (t.total / 12);
    return t;
  }

  /** Plain-text savings section, as printed in the Benefits block of the Kaizen sheet. */
  function savingsText(results) {
    var rs_ = results.filter(Boolean);
    if (!rs_.length) return '';
    var out = [];
    rs_.forEach(function (r, i) {
      out.push('Saving ' + (i + 1) + ' – ' + TYPES[r.type].title + ' (' + CLASS_LABEL[r.cls] + ')');
      r.working.forEach(function (w) { out.push('   ' + w); });
    });
    var t = totals(rs_);
    if (t.total > 0 || t.inv > 0) {
      var s = 'Total annual saving = ' + rs(t.total);
      if (t.hard && t.soft) s += ' (hard ' + rs(t.hard) + ' + soft ' + rs(t.soft) + ')';
      else if (t.soft && !t.hard) s += ' (soft saving)';
      if (t.inv > 0) s += '; total investment = ' + rs(t.inv) + (isFinite(t.payback) ? '; payback = ' + fmt(t.payback, 1) + ' months' : '');
      out.push(s);
    }
    if (t.oneTime) out.push('One-time benefit = ' + rs(t.oneTime) + ' (shown separately, not part of the yearly saving)');
    return out.join('\n');
  }

  var api = { TYPES: TYPES, CLASS_LABEL: CLASS_LABEL, newLine: newLine, missing: missing, calcLine: calcLine,
    totals: totals, savingsText: savingsText, fmt: fmt, rs: rs, plain: plain };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.KaizenCalc = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
