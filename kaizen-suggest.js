/*
 * kaizen-suggest.js — small text classifier for Kaizen sheets (no dependencies).
 * Works in the browser (window.KaizenSuggest) and in Node (require('./kaizen-suggest')).
 *
 * Reads the Kaizen's own words (problem, counter measure, before, after, benefits)
 * and suggests:
 *   - saving types   (manpower, rejection, electricity, material, safety)
 *   - waste attacked (8 wastes)
 *   - PQCDSM boxes   (6)
 *   - numbers it can find in the text, to pre-fill a saving line
 *
 * Two layers:
 *   1. Keyword rules — useful from the first Kaizen.
 *   2. Naive Bayes per label — learns from confirmed Kaizens (seed examples
 *      from the plant's sheets + every Kaizen the team downloads). The more
 *      examples a label has, the more the learned model counts.
 */
(function (root) {
  'use strict';

  var TYPES = ['manpower', 'rejection', 'electricity', 'material', 'safety', 'other'];
  var WASTES = ['Defects', 'Overproduction', 'Waiting Time', 'Non-utilized talent', 'Transportation', 'Inventory', 'Motion', 'Extra processing'];
  var PQCDSM = ['Productivity', 'Quality', 'Cost', 'Delivery', 'Safety', 'Morale'];
  var LABELS = TYPES.map(function (t) { return 'type:' + t; })
    .concat(WASTES.map(function (w, i) { return 'waste:' + i; }))
    .concat(PQCDSM.map(function (p, i) { return 'pq:' + i; }));

  // ---------- keyword rules (stems; phrases allowed) ----------
  var RULES = {
    'type:manpower': ['operator', 'manpower', 'labour', 'labor', 'worker', 'man hour', 'manhour', 'helper', 'wage', 'shift', 'minute', 'min', 'time consuming', 'time saved', 'saving time', 'manual', 'cycle time', 'faster', 'productiv', 'handling'],
    'type:rejection': ['burr', 'deburr', 'edge defect', 'cutting quality', 'reject', 'rejection', 'scrap', 'defect', 'rework', 'ppm', 'failure', 'leak', 'pd value', 'complaint', 'yield', 'not ok', 'ng part', 'quality issue'],
    'type:electricity': ['fuel', 'heating', 'burner', 'torch', 'power', 'electric', 'kw', 'kwh', 'energy', 'motor', 'compressor', 'light', 'led', 'vfd', 'idle running', 'unit consumption', 'heater', 'fan'],
    'type:material': ['material saving', 'consumable', 'wastage', 'copper', 'oil', 'tape', 'paper', 'kg', 'litre', 'reuse', 'recycle', 'raw material', 'purchase', 'supplier', 'ready made', 'in house'],
    'type:safety': ['accident', 'injur', 'safety', 'safe', 'hazard', 'guard', 'sensor', 'ppe', 'fall', 'fire', 'shock', 'burn', 'ergonom', 'lifting', 'heavy', 'partition', 'staircase', 'ladder', 'strain', 'risk', 'handrail', 'slip'],
    'type:other': ['scrap sold', 'sold it', 'and sold', 'sale', 'revenue', 'space', 'sq ft', 'sqft', 'floor space', '1s', '5s', 'sort', 'seiri', 'one time', 'lakh', 'disposal', 'clutter'],
    'waste:0': ['defect', 'reject', 'rework', 'quality issue', 'pd value', 'burr', 'deburr'],
    'waste:1': ['overproduction', 'excess production', 'produced more', 'extra quantity'],
    'waste:2': ['bottleneck', 'slow', 'speed', 'waiting', 'wait', 'idle', 'delay', 'time consuming', 'cycle time', 'time loss', 'take long', 'took long'],
    'waste:3': ['skill', 'idea', 'training', 'underutili', 'non utili', 'talent'],
    'waste:4': ['transfer', 'handoff', 'hand off', 'handover', 'transport', 'movement of material', 'trolley', 'pallet', 'carry', 'shifting', 'material handling', 'moved manually', 'move'],
    'waste:5': ['stock', 'inventory', 'storage', 'rack', 'wip', 'accumulat', 'clutter', 'obsolete'],
    'waste:6': ['walking', 'search', 'bending', 'reach', 'lifting', 'identify', 'motion', 'exertion', 'mixed up', 'differentiat'],
    'waste:7': ['extra processing', 'extraprocessing', 'over processing', 'overprocessing', 'twice', 'double', 'repeat', 'in house', 'preparation', 'testing cycle', 'unnecessary'],
    'pq:0': ['productiv', 'output', 'cycle time', 'faster', 'time saved', 'hour', 'minute', 'jobs in'],
    'pq:1': ['quality', 'defect', 'reject', 'pd value', 'consistency', 'uniform', 'accuracy', 'reliab'],
    'pq:2': ['cost', 'saving', 'rs', 'rupee', 'wage', 'reduce manpower', 'manpower'],
    'pq:3': ['delivery', 'dispatch', 'lead time', 'on time', 'schedule'],
    'pq:4': ['accident', 'injur', 'safety', 'safe', 'hazard', 'guard', 'sensor', 'ergonom', 'heavy', 'partition', 'staircase', 'strain', 'fall', 'risk', 'handrail', 'slip', 'fire', 'shock', 'burn'],
    'pq:5': ['confiden', 'fatigue', 'morale', 'comfort', 'ergonom', 'aesthetic', 'motivat', 'easy', 'without any disturbance']
  };

  // ---------- seed examples from the plant's 8 Kaizen sheets ----------
  function ex(text, types, wastes, pq) {
    var labels = {};
    types.forEach(function (t) { labels['type:' + t] = 1; });
    wastes.forEach(function (i) { labels['waste:' + i] = 1; });
    pq.forEach(function (i) { labels['pq:' + i] = 1; });
    return { text: text, labels: labels, seed: true };
  }
  var SEEDS = [
    ex('An accident could have occurred while testing. Sensors were installed in the testing area to prevent accidents. Test set up will get auto shut off if anyone enters the test area. Test engineer can perform any test without any disturbance.', ['safety'], [], [4, 5]),
    ex('The PD value was getting high and the required air pressure was not being achieved; the operator was fluctuating the air pressure. PLC was installed to achieve the required PD value and air pressure. Improvement in quality, reliability, consistency in air pressure. Wastage per rejection Rs 15000 per job, 15 jobs rejected per month.', ['rejection'], [0], [1, 2]),
    ex('PD value could not be maintained due to dust and moisture content. PVC curtains were installed to reduce dust and moisture, thereby lowering the PD value. Improved quality, control on dust, moisture under control, improved aesthetics.', ['rejection'], [0], [1, 5]),
    ex('It was time consuming to identify and differentiate the cores. Movable racks prepared to place the CT cores so that cores do not get mixed up. Identifying the core has become easy. Productivity increased. Saving 2 hours of 2 operators, per day wages Rs 800.', ['manpower'], [2, 5, 6], [0, 2]),
    ex('It was time consuming to cut primary copper by manual cutting; some quality issue was there. Primary copper cutting machine installed, which increased productivity. Improved quality, reduction in fatigue of operator. Earlier 50 jobs in 10 hours, now 50 jobs in 8 hours. Saving 2 hours of 2 operators.', ['manpower'], [0, 2, 6], [0, 1, 2, 5]),
    ex('An accident could have occurred while soldering. A partition was installed next to the solder pot to prevent accidents. Improved safety. Operator can now do their work confidently.', ['safety'], [], [4, 5]),
    ex('In-house preparation of primary insulation required additional time and manpower. Use ready-made primary insulation by ordering from the supplier. Manual preparation, handling and preparation time eliminated. Saving of manpower and process time, 25 mins saved, manpower cost Rs 600 per day.', ['manpower', 'material'], [2, 6, 7], [0, 2]),
    ex('Material handling was done manually, leading to excessive physical exertion and significant time loss during component movement. Procured and deployed a hydraulic pallet truck material handler. Single operator moves heavy items safely and quickly. Reduced testing cycles from 2 times to 1 time. Total time saved 30 mins per round, manpower cost Rs 400 per day.', ['manpower', 'safety'], [4, 6, 7], [0, 2, 4, 5]),
    ex('Multiple transfers and repeated handling were required between winding, testing and tapping operations, resulting in additional process time and operator movement. Single winding and tapping combined under one operator to eliminate unnecessary transfers. Core was sent to testing, then transferred to another person for tapping, then again for double winding and another testing. Reduced testing cycles from 2 times to 1 time. Total time saved in winding 45 mins. Manpower cost Rs 400 per day.', ['manpower'], [2, 4, 6, 7], [0, 2]),
    ex('During the pressing process the component required manual pre-heating because cold forming was not possible, causing low production speed, long cycle times, additional fuel and energy consumption, and two operators instead of one. Modified the pressing fixture and tooling to enable cold pressing without heating. Heating with a torch or burner caused bottlenecks and burn risks. Direct saving of 1 manpower. Zero heating fuel or power required. Manpower cost Rs 600 per day.', ['manpower', 'electricity', 'safety'], [2, 6, 7], [0, 2, 4, 5]),
    ex('The shop floor was cluttered with accumulated scrap material, creating safety hazards and restricting operational space. Executed a 1S sort drive to segregate scrap, removed 25 tonnes of accumulated scrap and sold it. Scrap utilized generating a financial benefit of Rs 10.5 lakh. Floor space saving 400 sq ft. Improved 5S compliance, eliminated tripping hazards.', ['other', 'safety'], [5, 6], [0, 2, 4, 5]),
    ex('The laser cutting machine resting plate was worn out, which degraded cutting sharpness, increased burr formation and reduced operating speed. Replaced the damaged resting plate with a new slat bed. Restored cutting sharpness and eliminated edge defects and burrs. Cutting speed restored, saving 20 to 30% cycle time per job. Eliminated post-cutting manual deburring and rework, saving 1 operator manual effort per shift. Manpower cost Rs 400 per day.', ['rejection', 'manpower'], [0, 2, 7], [0, 1, 2, 4])
  ];

  // ---------- text processing ----------
  var STOP = {};
  ('a an the and or of to in on at for from by with was were is are be been it its this that these those as into than then there their they them we our us he she his her has have had not no do does did can could will would should may might also all any each per while after before now earlier').split(' ').forEach(function (w) { STOP[w] = 1; });
  function norm(text) { return ' ' + String(text || '').toLowerCase().replace(/[^a-z0-9.]+/g, ' ').replace(/\s+/g, ' ') + ' '; }
  function stem(w) { return w.replace(/(ations?|ings?|ed|es|s)$/, '') || w; }
  function tokens(text) {
    var words = norm(text).replace(/\./g, ' ').trim().split(' ').filter(function (w) { return w && !STOP[w] && !/^\d+$/.test(w); }).map(stem);
    var set = {};
    words.forEach(function (w, i) { set[w] = 1; if (i > 0) set[words[i - 1] + '_' + w] = 1; });
    return Object.keys(set);
  }
  function ruleScore(label, text) {
    var t = norm(text).replace(/\./g, ' '), s = 0, hits = [];
    (RULES[label] || []).forEach(function (k) {
      var re = new RegExp('(^|\\s)' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[a-z]*(\\s|$)');
      if (re.test(t)) { s += k.indexOf(' ') > 0 ? 1.5 : 1; hits.push(k); }
    });
    return { score: s, hits: hits };
  }

  // ---------- model ----------
  function emptyModel() {
    var m = { n: 0, labels: {} };
    LABELS.forEach(function (l) { m.labels[l] = { pos: {}, neg: {}, nPos: 0, nNeg: 0 }; });
    return m;
  }
  function trainOne(m, example) {
    var toks = tokens(example.text);
    m.n++;
    LABELS.forEach(function (l) {
      var L = m.labels[l], side = example.labels[l] ? 'pos' : 'neg';
      if (side === 'pos') L.nPos++; else L.nNeg++;
      toks.forEach(function (t) { L[side][t] = (L[side][t] || 0) + 1; });
    });
  }
  /** Build a model from the seed examples plus any confirmed examples. */
  function train(examples) {
    var m = emptyModel();
    SEEDS.concat(examples || []).forEach(function (e) { trainOne(m, e); });
    return m;
  }
  function nbProb(L, toks) {
    if (!L.nPos || !L.nNeg) return null;
    // Bernoulli-style presence model with Laplace smoothing
    var lp = Math.log((L.nPos + 1) / (L.nNeg + 1));
    toks.forEach(function (t) {
      var pp = ((L.pos[t] || 0) + 1) / (L.nPos + 2), pn = ((L.neg[t] || 0) + 1) / (L.nNeg + 2);
      if ((L.pos[t] || 0) + (L.neg[t] || 0) > 0) lp += Math.log(pp / pn);
    });
    return 1 / (1 + Math.exp(-lp));
  }

  /**
   * Suggest labels for a Kaizen text.
   * Returns { types:[{type, p, why}], wastes:[{index, p}], pqcdsm:[{index, p}], numbers:{...}, learnedFrom }
   */
  function suggest(model, text, threshold) {
    threshold = threshold || 0.5;
    var toks = tokens(text), out = { types: [], wastes: [], pqcdsm: [], numbers: extractNumbers(text), learnedFrom: model.n };
    if (!String(text || '').trim()) return out;
    var nb = out.numbers, boost = {
      'type:manpower': (nb.t !== undefined ? 2 : 0) + (nb.ops !== undefined ? 1 : 0) + (nb.wage !== undefined ? 1 : 0),
      'type:electricity': nb.kw !== undefined ? 2 : 0,
      'type:rejection': (nb.before !== undefined ? 2 : 0) + (nb.cost !== undefined ? 1 : 0)
    };
    LABELS.forEach(function (l) {
      var r = ruleScore(l, text); r.score += boost[l] || 0;
      var pr = 1 - Math.exp(-0.7 * r.score);
      var L = model.labels[l], pn = nbProb(L, toks);
      var alpha = pn === null ? 0 : Math.min(0.7, L.nPos / 25); // learned model counts more as examples grow
      var p = pn === null ? pr : alpha * pn + (1 - alpha) * pr;
      if (p < threshold) return;
      var parts = l.split(':');
      var item = { p: p, why: r.hits.slice(0, 4) };
      if (parts[0] === 'type') { item.type = parts[1]; out.types.push(item); }
      else if (parts[0] === 'waste') { item.index = +parts[1]; out.wastes.push(item); }
      else { item.index = +parts[1]; out.pqcdsm.push(item); }
    });
    var byP = function (a, b) { return b.p - a.p; };
    out.types.sort(byP);
    return out;
  }

  // ---------- numbers in the text, to pre-fill a saving line ----------
  function n(s) { return parseFloat(String(s).replace(/,/g, '')); }
  function extractNumbers(text) {
    var t = String(text || '').toLowerCase().replace(/\s+/g, ' '), f = {}, m;
    // operators
    if ((m = /(\d+)\s*(?:nos?\.?\s*)?(?:operators?|workers?|persons?|people|men|helpers?)\b/.exec(t))) f.ops = n(m[1]);
    else if ((m = /\b(?:of|by)\s*(\d+)\s*operators?\b/.exec(t))) f.ops = n(m[1]);
    // time saved: "saved 30 mins", "saving 2 hours", "25 mins saved", "time saved - 30 mins"
    if ((m = /(?:sav(?:e|ed|ing)|reduc(?:e|ed|tion)(?: of)?)\D{0,25}?(\d+(?:\.\d+)?)\s*(hours?|hrs?|minutes?|mins?)\b/.exec(t)) ||
        (m = /(\d+(?:\.\d+)?)\s*(hours?|hrs?|minutes?|mins?)\s*(?:is |are |were )?(?:saved|reduced)/.exec(t))) {
      f.t = n(m[1]); f.tUnit = /^h/.test(m[2]) ? 'hr' : 'min';
    } else if ((m = /in\s*(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)\b.{0,60}?in\s*(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)\b/.exec(t)) && n(m[1]) > n(m[2])) {
      f.t = n(m[1]) - n(m[2]); f.tUnit = 'hr'; f.tNote = 'from ' + m[1] + ' hr → ' + m[2] + ' hr';
    }
    // wage per day
    if ((m = /(?:rs\.?|₹|inr)\s*(\d[\d,]*(?:\.\d+)?)\s*(?:\/|per)\s*day/.exec(t)) || (m = /(?:wages?|salary|manpower cost)\D{0,30}?(?:rs\.?|₹)?\s*(\d[\d,]*)/.exec(t))) f.wage = n(m[1]);
    // shift
    if ((m = /(\d{1,2})\s*(?:hours?|hrs?|hr)\s*shift/.exec(t))) f.shift = n(m[1]);
    // rejections per month
    if ((m = /(\d+)\s*(?:[a-z]+\s*)?(?:rejected|rejections?)\s*(?:per|\/|a|in a)\s*month/.exec(t)) ||
        (m = /(?:rejected|rejections?)\D{0,20}?(\d+)\s*(?:jobs?|nos?|pcs)?\s*(?:\/|per|a)\s*month/.exec(t))) f.before = n(m[1]);
    // cost per rejection
    if ((m = /(?:loss|cost|wastage|scrap value)\D{0,25}?(?:rs\.?|₹)\s*(\d[\d,]*)\s*(?:\/|per)\s*[a-z]+/.exec(t)) || (m = /(?:rs\.?|₹)\s*(\d[\d,]*)\s*(?:\/|per)\s*(?:job|rejection|piece|pc|part|unit|coil|set)/.exec(t)) || (m = /(?:per rejection|each rejection)\D{0,15}?(?:rs\.?|₹)?\s*(\d[\d,]*)/.exec(t))) f.cost = n(m[1]);
    // power
    if ((m = /(\d+(?:\.\d+)?)\s*kw\b/.exec(t))) f.kw = n(m[1]);
    // a rupee amount in lakh (e.g. "Rs 10.5 lakh") and whether it is one-time
    if ((m = /(?:rs\.?|₹)\s*(\d+(?:\.\d+)?)\s*(?:lakhs?|lacs?)\b/.exec(t))) f.amount = Math.round(n(m[1]) * 100000);
    if (/\b(sold|sale of|one time|one-time|disposed)\b/.test(t)) f.once = true;
    // investment
    if ((m = /(?:installation cost|investment|cost of (?:the )?(?:machine|fix|installation)|cost was|costing)\D{0,15}?(?:rs\.?|₹)?\s*(\d[\d,]*)/.exec(t))) f.inv = n(m[1]);
    return f;
  }

  /** Which fields of a saving type the extracted numbers can fill. */
  var FILLS = { manpower: ['t', 'tUnit', 'ops', 'wage', 'shift', 'inv'], rejection: ['before', 'cost', 'inv'], electricity: ['kw', 'inv'], material: ['inv'], safety: ['inv'], other: ['inv'] };
  function prefill(type, numbers) {
    var v = {};
    (FILLS[type] || []).forEach(function (k) { if (numbers[k] !== undefined) v[k] = numbers[k]; });
    if (type === 'rejection' && v.before !== undefined) v.after = 0;
    if (type === 'other' && numbers.amount !== undefined) { v.monthly = numbers.amount; v.freq = numbers.once ? 'once' : 'month'; }
    return v;
  }

  /** Turn a finished Kaizen into a training example (what the team confirmed). */
  function exampleFrom(text, lineTypes, wastes, pqcdsm) {
    var labels = {};
    (lineTypes || []).forEach(function (t) { if (TYPES.indexOf(t) >= 0) labels['type:' + t] = 1; });
    (wastes || []).forEach(function (on, i) { if (on) labels['waste:' + i] = 1; });
    (pqcdsm || []).forEach(function (on, i) { if (on) labels['pq:' + i] = 1; });
    return { text: String(text || ''), labels: labels };
  }

  var api = { TYPES: TYPES, WASTES: WASTES, PQCDSM: PQCDSM, SEEDS: SEEDS, train: train, suggest: suggest,
    extractNumbers: extractNumbers, prefill: prefill, exampleFrom: exampleFrom, tokens: tokens };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.KaizenSuggest = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
