/*
 * kaizen-xlsx.js — builds the Kaizen sheet as a real .xlsx file, with no libraries.
 * Works in the browser (window.KaizenXlsx) and in Node (require('./kaizen-xlsx')).
 *
 *   const bytes = KaizenXlsx.build(kaizen);   // Uint8Array, save as "Kaizen-05.xlsx"
 *
 * Layout follows the plant's existing Kaizen sheet (columns B–W, rows 2–46):
 * header with logo, Kaizen No / Department / Line / Machine / Date, team, theme,
 * problem, counter measure, before / after with photos, waste attacked, PQCDSM,
 * horizontal deployment, analysis, root cause, benefits (with the savings
 * working), idea and implemented-by. Fits on one A4 page when printed.
 *
 * kaizen = {
 *   kaizenNo, date, department, line, machine, company, team, theme, target,
 *   problem, counter, before, after, analysis, rootCause, benefits, savingsText,
 *   idea, implementedBy,
 *   wastes: [8 booleans], pqcdsm: [6 booleans], horizontal: 'yes' | 'no' | '',
 *   logo / photoBefore / photoAfter: { bytes: Uint8Array, ext: 'png'|'jpeg', width, height } | null
 * }
 */
(function (root) {
  'use strict';

  var WASTES = ['1. Defects', '2. Overproduction', '3. Waiting Time', '4. Non-utilized talent',
    '5. Transportation', '6. Inventory', '7. Motion', '8. Extra processing'];
  var PQCDSM = ['Productivity', 'Quality', 'Cost', 'Delivery', 'Safety', 'Morale'];
  var TICK_ON = '☑', TICK_OFF = '☐';

  // ---------- geometry ----------
  var FIRST_COL = 2, LAST_COL = 23, FIRST_ROW = 2, LAST_ROW = 46;
  var COL_WIDTH = {}; // Excel width units
  for (var c = 1; c <= 26; c++) COL_WIDTH[c] = 8.43;
  COL_WIDTH[2] = 1.71; COL_WIDTH[6] = 23.71; COL_WIDTH[23] = 1.86;
  function colPx(c) { return Math.floor(COL_WIDTH[c] * 7 + 5); }
  function ptToPx(pt) { return pt * 96 / 72; }
  var EMU_PX = 9525;

  function colLetter(n) { var s = ''; while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
  function colNum(L) { var n = 0; for (var i = 0; i < L.length; i++) n = n * 26 + (L.charCodeAt(i) - 64); return n; }
  function parseRange(ref) { // "C11:F22" -> {c1,r1,c2,r2}
    var m = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(ref);
    return { c1: colNum(m[1]), r1: +m[2], c2: colNum(m[3] || m[1]), r2: +(m[4] || m[2]) };
  }
  function widthPx(rg) { var w = 0; for (var c = rg.c1; c <= rg.c2; c++) w += colPx(c); return w; }

  // ---------- text helpers ----------
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function clean(s) { return String(s == null ? '' : s).replace(/\r\n?/g, '\n').trim(); }
  // rough wrap estimate for Calibri 11: ~6.6 px per character
  function lineCount(text, px) {
    var per = Math.max(8, Math.floor((px - 10) / 6.6)), n = 0;
    clean(text).split('\n').forEach(function (p) { n += Math.max(1, Math.ceil(p.length / per)); });
    return n;
  }

  // ---------- rich text runs ----------
  // run: { t: text, b: bold, sym: tick font, sz: size }
  function runXml(run) {
    var rpr = (run.b ? '<b/>' : '') + '<sz val="' + (run.sz || 11) + '"/>' +
      (run.grey ? '<color rgb="FF5A6672"/>' : '<color theme="1"/>') +
      '<rFont val="' + (run.sym ? 'Segoe UI Symbol' : 'Calibri') + '"/><family val="2"/>';
    return '<r><rPr>' + rpr + '</rPr><t xml:space="preserve">' + esc(run.t) + '</t></r>';
  }

  // ---------- styles ----------
  // fonts: 0 Calibri 11 · 1 Calibri 18 bold · 2 Segoe UI Symbol 13 · 3 Calibri 11 bold · 4 Calibri 14 bold
  var FONTS = [
    '<font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>',
    '<font><b/><sz val="18"/><color theme="1"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>',
    '<font><sz val="13"/><color theme="1"/><name val="Segoe UI Symbol"/><family val="2"/></font>',
    '<font><b/><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>',
    '<font><b/><sz val="14"/><color theme="1"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>'
  ];
  var ALIGN = {
    tl: '<alignment horizontal="left" vertical="top" wrapText="1"/>',
    cl: '<alignment horizontal="left" vertical="center" wrapText="1"/>',
    cc: '<alignment horizontal="center" vertical="center" wrapText="1"/>'
  };

  function makeStyles() {
    var borders = ['<border><left/><right/><top/><bottom/><diagonal/></border>'], borderIdx = { '||||': 0 };
    var xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'], xfIdx = { '0|0|': 0 };
    function borderId(b) {
      var key = [b.l || '', b.r || '', b.t || '', b.b || ''].join('|');
      if (borderIdx[key] === undefined) {
        var side = function (tag, v) { return v ? '<' + tag + ' style="' + v + '"><color indexed="64"/></' + tag + '>' : '<' + tag + '/>'; };
        borders.push('<border>' + side('left', b.l) + side('right', b.r) + side('top', b.t) + side('bottom', b.b) + '<diagonal/></border>');
        borderIdx[key] = borders.length - 1;
      }
      return borderIdx[key];
    }
    function xf(font, b, align) {
      var bid = borderId(b || {}), key = font + '|' + bid + '|' + (align || '');
      if (xfIdx[key] === undefined) {
        xfs.push('<xf numFmtId="0" fontId="' + font + '" fillId="0" borderId="' + bid + '" xfId="0"' +
          (font ? ' applyFont="1"' : '') + (bid ? ' applyBorder="1"' : '') +
          (align ? ' applyAlignment="1">' + ALIGN[align] + '</xf>' : '/>'));
        xfIdx[key] = xfs.length - 1;
      }
      return xfIdx[key];
    }
    function xml() {
      return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        '<fonts count="' + FONTS.length + '">' + FONTS.join('') + '</fonts>' +
        '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
        '<borders count="' + borders.length + '">' + borders.join('') + '</borders>' +
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
        '<cellXfs count="' + xfs.length + '">' + xfs.join('') + '</cellXfs>' +
        '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
        '</styleSheet>';
    }
    return { xf: xf, xml: xml };
  }

  // ---------- sheet model ----------
  function build(k) {
    k = k || {};
    var wastes = k.wastes || [], pq = k.pqcdsm || [];
    var H = {}; // row heights in points
    for (var r = FIRST_ROW; r <= LAST_ROW; r++) H[r] = 16;
    H[2] = 6; H[3] = 6; H[46] = 6;
    for (r = 4; r <= 8; r++) H[r] = 17;
    H[9] = 20; H[10] = 20;

    var blocks = []; // { ref, runs:[...] | text, font, align }
    function block(ref, runs, opt) { opt = opt || {}; blocks.push({ ref: ref, rg: parseRange(ref), runs: runs, font: opt.font || 0, align: opt.align || 'tl', sym: opt.sym }); }
    function labelled(label, value) { var v = clean(value); return [{ t: label + ' : ', b: true }, { t: v }]; }
    function textOf(runs) { return runs.map(function (x) { return x.t; }).join(''); }

    var hasBefore = !!(k.photoBefore && k.photoBefore.bytes), hasAfter = !!(k.photoAfter && k.photoAfter.bytes);
    var hasLogo = !!(k.logo && k.logo.bytes);

    // header
    block('C4:F8', hasLogo ? [{ t: '' }] : [{ t: clean(k.company) || 'Company Logo', b: true, grey: !clean(k.company) }], { align: 'cc' });
    block('G4:P8', [{ t: 'KAIZEN SHEET', b: true, sz: 20 }], { font: 1, align: 'cc' });
    block('Q4:V4', labelled('Kaizen No.', k.kaizenNo), { align: 'cl' });
    block('Q5:V5', labelled('Department', k.department), { align: 'cl' });
    block('Q6:V6', labelled('Line / Area', k.line), { align: 'cl' });
    block('Q7:V7', labelled('Machine', k.machine), { align: 'cl' });
    block('Q8:V8', labelled('Date', k.date), { align: 'cl' });
    // team, theme
    block('C9:V9', labelled('Team Members', k.team), { align: 'cl' });
    block('C10:K10', labelled('Kaizen Theme', k.theme), { align: 'cl' });
    block('L10:V10', labelled('Target & Target Date', k.target), { align: 'cl' });
    // problem / counter / before / after
    block('C11:F22', labelled('Problem [5W1H]', k.problem));
    block('G11:V13', labelled('Counter Measure', k.counter));
    block('G14:L33', labelled('Before Counter Measure', k.before));
    block('M14:R33', labelled('After Counter Measure', k.after));
    block('C23:F33', labelled('Analysis [7 QC Tools]', k.analysis));
    // waste attacked
    block('S14:V14', [{ t: 'Waste Attacked', b: true }], { align: 'cl' });
    WASTES.forEach(function (w, i) {
      block('S' + (15 + i) + ':U' + (15 + i), [{ t: w }], { align: 'cl' });
      block('V' + (15 + i), [{ t: wastes[i] ? TICK_ON : TICK_OFF, sym: true, sz: 13 }], { font: 2, align: 'cc' });
    });
    PQCDSM.forEach(function (p, i) {
      block('S' + (23 + i) + ':T' + (23 + i), [{ t: p }], { align: 'cl' });
      block('U' + (23 + i) + ':V' + (23 + i), [{ t: pq[i] ? TICK_ON : TICK_OFF, sym: true, sz: 13 }], { font: 2, align: 'cc' });
    });
    var hz = (k.horizontal || '').toLowerCase();
    block('S29:V33', [{ t: 'Scope and plan for horizontal deployment :\n', b: true },
      { t: (hz === 'yes' ? TICK_ON : TICK_OFF), sym: true, sz: 13 }, { t: ' Yes      ' },
      { t: (hz === 'no' ? TICK_ON : TICK_OFF), sym: true, sz: 13 }, { t: ' No' }]);
    // benefits (with savings working) and root cause
    var ben = [{ t: 'Benefits / Results After Implementation :', b: true }];
    if (clean(k.benefits)) ben.push({ t: '\n' + clean(k.benefits) });
    if (clean(k.savingsText)) { ben.push({ t: '\n\nSavings calculation', b: true }); ben.push({ t: '\n' + clean(k.savingsText) }); }
    block('G34:V43', ben);
    block('C34:F43', labelled('Root Cause [4M]', k.rootCause));
    block('C44:F45', labelled('Idea', k.idea));
    block('G44:V45', labelled('Implemented By', k.implementedBy));

    // ---- grow rows so text fits (only ever grows) ----
    function sumH(r1, r2) { var s = 0; for (var i = r1; i <= r2; i++) s += H[i]; return s; }
    function fit(ref, text, r1, r2) {
      var rg = parseRange(ref), need = lineCount(text, widthPx(rg)) * 15 + 6;
      var have = sumH(r1, r2);
      if (need > have) { var add = (need - have) / (r2 - r1 + 1); for (var i = r1; i <= r2; i++) H[i] = Math.ceil((H[i] + add) * 4) / 4; }
    }
    function blockText(ref) { for (var i = 0; i < blocks.length; i++) if (blocks[i].ref === ref) return textOf(blocks[i].runs); return ''; }
    fit('C9:V9', blockText('C9:V9'), 9, 9);
    fit('C10:K10', blockText('C10:K10'), 10, 10);
    fit('L10:V10', blockText('L10:V10'), 10, 10);
    fit('G11:V13', blockText('G11:V13'), 11, 13);
    // with a photo the text must fit above it (rows 14–20); the photo uses rows 21–33
    fit('G14:L33', blockText('G14:L33'), 14, hasBefore ? 20 : 33);
    fit('M14:R33', blockText('M14:R33'), 14, hasAfter ? 20 : 33);
    fit('C11:F22', blockText('C11:F22'), 11, 22);
    fit('C23:F33', blockText('C23:F33'), 23, 33);
    fit('G34:V43', blockText('G34:V43'), 34, 43);
    fit('C34:F43', blockText('C34:F43'), 34, 43);
    fit('C44:F45', blockText('C44:F45'), 44, 45);
    fit('G44:V45', blockText('G44:V45'), 44, 45);
    if (hasBefore || hasAfter) { var ph = sumH(21, 33); if (ph < 200) for (r = 21; r <= 33; r++) H[r] += (200 - ph) / 13; }

    // ---- per-cell style: borders ----
    var styles = makeStyles();
    var cell = {}; // "r,c" -> { font, align, b:{l,r,t,b} }
    function cs(r, c) { var key = r + ',' + c; return cell[key] || (cell[key] = { font: 0, align: '', b: {} }); }
    blocks.forEach(function (bk) {
      var g = bk.rg;
      for (var r = g.r1; r <= g.r2; r++) for (var c = g.c1; c <= g.c2; c++) {
        var s = cs(r, c); s.font = bk.font; s.align = bk.align;
        if (c === g.c1) s.b.l = 'thin'; if (c === g.c2) s.b.r = 'thin';
        if (r === g.r1) s.b.t = 'thin'; if (r === g.r2) s.b.b = 'thin';
      }
    });
    for (c = FIRST_COL; c <= LAST_COL; c++) { cs(FIRST_ROW, c).b.t = 'medium'; cs(LAST_ROW, c).b.b = 'medium'; }
    for (r = FIRST_ROW; r <= LAST_ROW; r++) { cs(r, FIRST_COL).b.l = 'medium'; cs(r, LAST_COL).b.r = 'medium'; }

    var topLeft = {};
    blocks.forEach(function (bk) { topLeft[bk.rg.r1 + ',' + bk.rg.c1] = bk; });

    // ---- sheet XML ----
    var rowsXml = '';
    for (r = FIRST_ROW; r <= LAST_ROW; r++) {
      var cx = '';
      for (c = FIRST_COL; c <= LAST_COL; c++) {
        var s = cell[r + ',' + c]; if (!s) continue;
        var sid = styles.xf(s.font, s.b, s.align), ref = colLetter(c) + r, bk = topLeft[r + ',' + c];
        if (bk && textOf(bk.runs) !== '') cx += '<c r="' + ref + '" s="' + sid + '" t="inlineStr"><is>' + bk.runs.map(runXml).join('') + '</is></c>';
        else cx += '<c r="' + ref + '" s="' + sid + '"/>';
      }
      rowsXml += '<row r="' + r + '" spans="2:23" ht="' + H[r] + '" customHeight="1">' + cx + '</row>';
    }
    var merges = blocks.filter(function (b) { return b.ref.indexOf(':') > 0; }).map(function (b) { return '<mergeCell ref="' + b.ref + '"/>'; });
    var colsXml = '<cols><col min="1" max="1" width="2.7109375" customWidth="1"/><col min="2" max="2" width="1.7109375" customWidth="1"/>' +
      '<col min="6" max="6" width="23.7109375" customWidth="1"/><col min="23" max="23" width="1.85546875" customWidth="1"/></cols>';

    // ---- pictures ----
    var pics = [];
    function px2colrow(x, y) { // absolute px from sheet origin -> anchor
      var c = 1, cxp = 0; while (cxp + colPx(c) <= x) { cxp += colPx(c); c++; }
      var r = 1, ryp = 0; while (ryp + ptToPx(r in H ? H[r] : 15) <= y) { ryp += ptToPx(r in H ? H[r] : 15); r++; }
      return { col: c - 1, colOff: Math.round((x - cxp) * EMU_PX), row: r - 1, rowOff: Math.round((y - ryp) * EMU_PX) };
    }
    function originOf(col, row) { var x = 0, y = 0, i; for (i = 1; i < col; i++) x += colPx(i); for (i = 1; i < row; i++) y += ptToPx(i in H ? H[i] : 15); return { x: x, y: y }; }
    function place(img, ref, rowFrom, pad) {
      var g = parseRange(ref), o = originOf(g.c1, rowFrom);
      var boxW = widthPx(g) - 2 * pad, boxH = 0;
      for (var i = rowFrom; i <= g.r2; i++) boxH += ptToPx(H[i]);
      boxH -= 2 * pad;
      var sc = Math.min(boxW / img.width, boxH / img.height), w = img.width * sc, h = img.height * sc;
      var a = px2colrow(o.x + pad + (boxW - w) / 2, o.y + pad + (boxH - h) / 2);
      pics.push({ img: img, anchor: a, cx: Math.round(w * EMU_PX), cy: Math.round(h * EMU_PX) });
    }
    if (hasLogo) place(k.logo, 'C4:F8', 4, 6);
    if (hasBefore) place(k.photoBefore, 'G14:L33', 21, 8);
    if (hasAfter) place(k.photoAfter, 'M14:R33', 21, 8);

    var sheetXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="B2:W46"/>' +
      '<sheetViews><sheetView showGridLines="0" tabSelected="1" zoomScale="80" zoomScaleNormal="80" workbookViewId="0"><selection activeCell="A1" sqref="A1"/></sheetView></sheetViews>' +
      '<sheetFormatPr defaultRowHeight="15"/>' + colsXml + '<sheetData>' + rowsXml + '</sheetData>' +
      '<mergeCells count="' + merges.length + '">' + merges.join('') + '</mergeCells>' +
      '<printOptions horizontalCentered="1"/>' +
      '<pageMargins left="0.25" right="0.25" top="0.4" bottom="0.4" header="0.2" footer="0.2"/>' +
      '<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="1"/>' +
      (pics.length ? '<drawing r:id="rId1"/>' : '') + '</worksheet>';

    var drawingXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      pics.map(function (p, i) {
        var a = p.anchor;
        return '<xdr:oneCellAnchor editAs="oneCell"><xdr:from><xdr:col>' + a.col + '</xdr:col><xdr:colOff>' + a.colOff + '</xdr:colOff><xdr:row>' + a.row + '</xdr:row><xdr:rowOff>' + a.rowOff + '</xdr:rowOff></xdr:from>' +
          '<xdr:ext cx="' + p.cx + '" cy="' + p.cy + '"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="' + (i + 2) + '" name="Picture ' + (i + 1) + '"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>' +
          '<xdr:blipFill><a:blip r:embed="rId' + (i + 1) + '"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>' +
          '<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + p.cx + '" cy="' + p.cy + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>';
      }).join('') + '</xdr:wsDr>';

    var sheetName = ('Kaizen ' + clean(k.kaizenNo)).trim().replace(/[\\\/\?\*\[\]:]/g, '-').slice(0, 31) || 'Kaizen';
    var files = [];
    function add(name, data) { files.push({ name: name, data: typeof data === 'string' ? utf8(data) : data }); }
    add('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
      '<Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      (pics.length ? '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>' : '') +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>');
    add('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
      '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>');
    var now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    add('docProps/core.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      '<dc:title>' + esc('Kaizen ' + clean(k.kaizenNo)) + '</dc:title><dc:creator>Kaizen Sheet Maker</dc:creator>' +
      '<dcterms:created xsi:type="dcterms:W3CDTF">' + now + '</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">' + now + '</dcterms:modified></cp:coreProperties>');
    add('docProps/app.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Microsoft Excel</Application></Properties>');
    add('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<bookViews><workbookView/></bookViews><sheets><sheet name="' + esc(sheetName) + '" sheetId="1" r:id="rId1"/></sheets>' +
      '<definedNames><definedName name="_xlnm.Print_Area" localSheetId="0">\'' + esc(sheetName.replace(/'/g, "''")) + '\'!$B$2:$W$46</definedName></definedNames></workbook>');
    add('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
    add('xl/worksheets/sheet1.xml', sheetXml);
    add('xl/styles.xml', styles.xml());
    if (pics.length) {
      add('xl/worksheets/_rels/sheet1.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>');
      add('xl/drawings/drawing1.xml', drawingXml);
      add('xl/drawings/_rels/drawing1.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        pics.map(function (p, i) { return '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image' + (i + 1) + '.' + (p.img.ext === 'png' ? 'png' : 'jpeg') + '"/>'; }).join('') +
        '</Relationships>');
      pics.forEach(function (p, i) { add('xl/media/image' + (i + 1) + '.' + (p.img.ext === 'png' ? 'png' : 'jpeg'), p.img.bytes); });
    }
    return zip(files);
  }

  // ---------- Kaizen register: one row per Kaizen, with totals ----------
  /**
   * buildRegister({ title, subtitle, columns: [{ h, w, num }], rows: [[...]], totalCols: [colIndex...] })
   * Numbers use Indian digit grouping (1,24,800). A TOTAL row with SUM formulas is added for totalCols.
   */
  function buildRegister(opt) {
    var cols = opt.columns, rows = opt.rows || [], first = 4, last = first + rows.length - 1;
    var INR = '[&gt;=10000000]##\\,##\\,##\\,##0;[&gt;=100000]##\\,##\\,##0;##,##0';
    var thin = '<left style="thin"><color rgb="FFBFC7CF"/></left><right style="thin"><color rgb="FFBFC7CF"/></right><top style="thin"><color rgb="FFBFC7CF"/></top><bottom style="thin"><color rgb="FFBFC7CF"/></bottom><diagonal/>';
    var styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<numFmts count="2"><numFmt numFmtId="164" formatCode="' + INR + '"/><numFmt numFmtId="165" formatCode="0.0"/></numFmts>' +
      '<fonts count="4"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font>' +
      '<font><b/><sz val="15"/><name val="Calibri"/><family val="2"/></font><font><sz val="10"/><color rgb="FF5A6672"/><name val="Calibri"/><family val="2"/></font></fonts>' +
      '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE3EDF8"/><bgColor indexed="64"/></patternFill></fill></fills>' +
      '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border>' + thin + '</border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="8">' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +                                                                                   // 0 default
      '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +                                                                      // 1 title
      '<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +                                                                      // 2 subtitle
      '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>' + // 3 header
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +      // 4 text
      '<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment vertical="top"/></xf>' + // 5 rupees
      '<xf numFmtId="164" fontId="1" fillId="2" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>' +                 // 6 total
      '<xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment vertical="top"/></xf>' + // 7 one decimal
      '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
    function cellTxt(ref, s, v) { return v === '' || v == null ? '<c r="' + ref + '" s="' + s + '"/>' : '<c r="' + ref + '" s="' + s + '" t="inlineStr"><is><t xml:space="preserve">' + esc(v) + '</t></is></c>'; }
    function cellNum(ref, s, v) { return (v === '' || v == null || !isFinite(v)) ? '<c r="' + ref + '" s="' + s + '"/>' : '<c r="' + ref + '" s="' + s + '"><v>' + Number(v) + '</v></c>'; }
    var L = function (i) { return colLetter(i + 1); }, lastCol = L(cols.length - 1);
    var xml = '<row r="1" ht="22" customHeight="1">' + cellTxt('A1', 1, opt.title || 'Kaizen register') + '</row>' +
      '<row r="2">' + cellTxt('A2', 2, opt.subtitle || '') + '</row>' +
      '<row r="3" ht="32" customHeight="1">' + cols.map(function (c, i) { return cellTxt(L(i) + '3', 3, c.h); }).join('') + '</row>';
    rows.forEach(function (r, ri) {
      var rn = first + ri;
      xml += '<row r="' + rn + '">' + cols.map(function (c, i) {
        return c.num ? cellNum(L(i) + rn, c.dec ? 7 : 5, r[i]) : cellTxt(L(i) + rn, 4, r[i]);
      }).join('') + '</row>';
    });
    var tr = last + 1;
    if (rows.length && opt.totalCols && opt.totalCols.length) {
      xml += '<row r="' + tr + '">' + cols.map(function (c, i) {
        var ref = L(i) + tr;
        if (i === 0) return cellTxt(ref, 3, 'TOTAL (' + rows.length + ' Kaizens)');
        if (opt.totalCols.indexOf(i) >= 0) return '<c r="' + ref + '" s="6"><f>SUM(' + L(i) + first + ':' + L(i) + last + ')</f></c>';
        return '<c r="' + ref + '" s="3"/>';
      }).join('') + '</row>';
    }
    var sheet = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:' + lastCol + Math.max(tr, 3) + '"/>' +
      '<sheetViews><sheetView tabSelected="1" workbookViewId="0"><pane ySplit="3" topLeftCell="A4" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
      '<sheetFormatPr defaultRowHeight="15"/><cols>' + cols.map(function (c, i) { return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + (c.w || 14) + '" customWidth="1"/>'; }).join('') + '</cols>' +
      '<sheetData>' + xml + '</sheetData>' + (rows.length ? '<autoFilter ref="A3:' + lastCol + last + '"/>' : '') +
      '<pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/>' +
      '<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>';
    var files = [];
    function add(name, data) { files.push({ name: name, data: utf8(data) }); }
    add('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>');
    add('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
    add('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets><sheet name="Kaizen register" sheetId="1" r:id="rId1"/></sheets>' +
      (rows.length ? '<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">\'Kaizen register\'!$A$3:$' + lastCol + '$' + last + '</definedName></definedNames>' : '') + '</workbook>');
    add('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
    add('xl/worksheets/sheet1.xml', sheet);
    add('xl/styles.xml', styles);
    return zip(files);
  }

  // ---------- minimal ZIP writer (stored, no compression) ----------
  function utf8(s) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s);
    return Uint8Array.from(Buffer.from(s, 'utf8'));
  }
  var CRC = (function () { var t = new Uint32Array(256); for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(b) { var c = 0xFFFFFFFF; for (var i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function zip(files) {
    var d = new Date(), time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
      date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    var parts = [], central = [], offset = 0;
    files.forEach(function (f) {
      var name = utf8(f.name), data = f.data, crc = crc32(data);
      var h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
      h.setUint16(10, time, true); h.setUint16(12, date, true); h.setUint32(14, crc, true);
      h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
      parts.push(new Uint8Array(h.buffer), name, data);
      var ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
      ch.setUint16(12, time, true); ch.setUint16(14, date, true); ch.setUint32(16, crc, true);
      ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true);
      ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + data.length;
    });
    var cdSize = central.reduce(function (s, p) { return s + p.length; }, 0);
    var e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
    e.setUint32(12, cdSize, true); e.setUint32(16, offset, true);
    var all = parts.concat(central, [new Uint8Array(e.buffer)]);
    var total = all.reduce(function (s, p) { return s + p.length; }, 0), out = new Uint8Array(total), pos = 0;
    all.forEach(function (p) { out.set(p, pos); pos += p.length; });
    return out;
  }

  var api = { build: build, buildRegister: buildRegister, WASTES: WASTES, PQCDSM: PQCDSM };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.KaizenXlsx = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
