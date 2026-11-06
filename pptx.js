// 주간업무보고 PPT 생성 (A4 가로, 보고서 양식 그대로)
const PptxGenJS = require('pptxgenjs');
const path = require('path');
const Ops = require('./public/ops.js');

const LOGO = path.join(__dirname, 'public', 'img', 'dongkuk.png');  // 295×64

const W = 11.69, H = 8.27;           // A4 가로 (inch)
const FONT = '맑은 고딕';
const BLUE = '2F5F97';
const X = 0.7, TW = W - 1.4;          // 표 위치/폭
const BORDER = { type: 'solid', pt: 1.5, color: '000000' };
const TEXT_PT = 11;
const LINE_H = TEXT_PT * 1.25 / 72;  // 한 줄 높이 (inch)
const BODY_TOP = 1.35, BODY_BOTTOM = H - 0.75;

const fmtFull = s => (s || '').replaceAll('-', '/');
const fmtMD = s => (s || '').slice(5).replace('-', '/');

function reportSites(db, r) {
  const out = [];
  db.groups.forEach(g => db.sites.filter(s => s.groupId === g.id && (s.active || Ops.siteHasData(r, s.id))).forEach(s => out.push(s)));
  return out;
}

// 줄바꿈 추정: 한글/전각 1, 그 외 0.55 폭
function wrapCount(line, widthIn) {
  const cap = widthIn / (TEXT_PT / 72);
  let w = 0;
  for (const ch of line) w += /[ᄀ-ᇿ　-鿿가-힯＀-￯]/.test(ch) ? 1 : 0.55;
  return Math.max(1, Math.ceil(w / cap));
}

// 텍스트를 슬라이드 높이에 맞게 줄 단위로 잘라 [{lines, h}] 반환
function splitText(text, widthIn, maxH) {
  const chunks = [];
  let cur = [], h = 0;
  for (const line of text.replace(/\s+$/, '').split('\n')) {
    const lh = wrapCount(line, widthIn) * LINE_H;
    if (cur.length && h + lh > maxH) { chunks.push({ lines: cur, h }); cur = []; h = 0; }
    cur.push(line); h += lh;
  }
  if (cur.length) chunks.push({ lines: cur, h });
  return chunks;
}

// opts: { title, dateLabel, periodLabel } — 월간보고처럼 제목·기간 표기를 바꿀 때 사용
function build(db, r, opts = {}) {
  const S = { ...db.settings, title: opts.title || db.settings.title };
  const pres = new PptxGenJS();
  pres.defineLayout({ name: 'A4L', width: W, height: H });
  pres.layout = 'A4L';
  pres.theme = { headFontFace: FONT, bodyFontFace: FONT };
  pres.title = `${S.title} ${opts.dateLabel || fmtFull(r.date)}`;
  pres.author = S.author || '';

  pres.defineSlideMaster({
    title: 'REPORT',
    background: { color: 'FFFFFF' },
    objects: [{ image: { path: LOGO, x: W - 0.35 - 0.42 * 295 / 64, y: H - 0.6, w: 0.42 * 295 / 64, h: 0.42, altText: 'DONGKUK SYSTEMS' } }],
    slideNumber: { x: W / 2 - 0.3, y: H - 0.5, w: 0.6, h: 0.3, fontFace: FONT, fontSize: 10, color: '999999', align: 'center' },
  });

  const addSlide = () => pres.addSlide({ masterName: 'REPORT' });
  const bar = (slide, y) => slide.addShape(pres.shapes.RECTANGLE, { x: 0, y, w: W, h: 0.06, fill: { color: BLUE }, line: { color: BLUE, width: 0 } });
  const heading = (slide, text, y) => slide.addText(text, { x: X - 0.05, y, w: TW, h: 0.45, fontFace: FONT, fontSize: 16, bold: true, color: '000000', margin: 0, isTextBox: true });
  const sites = reportSites(db, r);

  // ---- 1페이지: 헤더 + 운영 업무 통계 ----
  {
    const s = addSlide();
    s.addText(`[${S.dept}]`, { x: 0.3, y: 0.15, w: 4, h: 0.35, fontFace: FONT, fontSize: 16, bold: true, margin: 0, isTextBox: true });
    s.addText(`${S.company} / ${S.author}`, { x: 0.3, y: 0.52, w: 4.5, h: 0.3, fontFace: FONT, fontSize: 12, margin: 0, isTextBox: true });
    s.addText(S.title, { x: W / 2 - 2, y: 0.25, w: 4, h: 0.55, fontFace: FONT, fontSize: 24, align: 'center', margin: 0, isTextBox: true });
    s.addText([
      { text: '▪보고일: ', options: { fontSize: 13 } },
      { text: opts.dateLabel || fmtFull(r.date), options: { fontSize: 15, bold: true, underline: { style: 'sng' } } },
    ], { x: W - 4.3, y: 0.15, w: 4, h: 0.35, fontFace: FONT, align: 'right', margin: 0, isTextBox: true });
    s.addText(`▪보고 기간: ${opts.periodLabel || `${fmtMD(r.start)} ~ ${fmtMD(r.end)}`}`, { x: W - 4.3, y: 0.52, w: 4, h: 0.3, fontFace: FONT, fontSize: 12, align: 'right', margin: 0, isTextBox: true });
    bar(s, 0.88);
    heading(s, S.s1Title, 1.15);

    const COLS = Ops.COLS;
    // 열 폭 비율: 회사, 사업장, 이후 COLS 순서
    const ratio = { swg: 1.19, ipt: 2.1, vpnAdd: 1.2, vpnDel: 1.0, req: 2.78, cabling: 1.25 };
    const raw = [0.88, 0.88, ...COLS.map(c => ratio[c.key] || 1.2)];
    const sum = raw.reduce((a, b) => a + b, 0);
    const colW = raw.map(v => +(v / sum * TW).toFixed(3));

    const hd = { fill: { color: 'FFFF66' }, color: '0000CC', bold: true, align: 'center', valign: 'middle', border: BORDER, fontSize: 12 };
    const hasParent = COLS.some(c => c.parent);
    const row1 = [{ text: '사업장', options: { ...hd, colspan: 2, rowspan: hasParent ? 2 : 1 } }];
    const row2 = [];
    for (let i = 0; i < COLS.length; i++) {
      const c = COLS[i];
      if (c.parent) {
        const kids = COLS.filter(x => x.parent === c.parent);
        row1.push({ text: c.parent, options: { ...hd, colspan: kids.length } });
        kids.forEach(k => row2.push({ text: k.label, options: { ...hd } }));
        i += kids.length - 1;
      } else row1.push({ text: c.label, options: { ...hd, rowspan: hasParent ? 2 : 1 } });
    }
    const rows = [row1];
    if (hasParent) rows.push(row2);

    const cell = (v, white) => ({ text: v ? String(v) : '', options: { fill: { color: white ? 'FFFFFF' : 'F2F2F2' }, align: 'center', valign: 'middle', border: BORDER, fontSize: 12 } });
    const label = (t, extra = {}) => ({ text: t, options: { fill: { color: 'FFFFFF' }, bold: true, align: 'center', valign: 'middle', border: BORDER, fontSize: 12, ...extra } });
    db.groups.forEach(g => {
      const gs = sites.filter(x => x.groupId === g.id);
      gs.forEach((site, i) => {
        const st = r.stats[site.id] || {};
        const row = [];
        if (i === 0) row.push(label(g.name, { rowspan: gs.length }));
        row.push(label(site.name));
        COLS.forEach(c => row.push(cell(st[c.key], c.white)));
        rows.push(row);
      });
    });
    rows.push([label('계', { colspan: 2 }), ...COLS.map(c => cell(sites.reduce((a, x) => a + (Number(r.stats[x.id]?.[c.key]) || 0), 0), c.white))]);

    const headH = 0.32, rowH = Math.min(0.52, (BODY_BOTTOM - 1.75 - headH * 2) / Math.max(1, rows.length - 2));
    s.addTable(rows, { x: X, y: 1.75, w: TW, colW, rowH: [headH, ...(hasParent ? [headH] : []), ...Array(rows.length - (hasParent ? 2 : 1)).fill(rowH)], fontFace: FONT, margin: 0.04 });
  }

  // ---- 텍스트 표 슬라이드 (2-N, 3) ----
  const SITE_W = 1.45, BODY_W = TW - SITE_W, PAD = 0.2;
  const TABLE_Y = 1.3, HEAD_H = 0.32;
  const maxRowH = BODY_BOTTOM - TABLE_Y - HEAD_H;

  function textSlides(title, colTitle, entries, minRowH) {
    // entries: [{ name, text }] → 슬라이드별로 행 배치 (긴 내용은 줄 단위로 나눠 다음 장으로)
    const pieces = [];
    entries.forEach(e => splitText(e.text, BODY_W - 0.25, maxRowH - PAD).forEach(c => pieces.push({ name: e.name, lines: c.lines, h: Math.max(minRowH, c.h + PAD) })));
    if (!pieces.length) pieces.push({ name: '', lines: [''], h: minRowH });

    const pages = [];
    let cur = [], used = 0;
    pieces.forEach(p => {
      if (cur.length && used + p.h > maxRowH) { pages.push(cur); cur = []; used = 0; }
      cur.push(p); used += p.h;
    });
    pages.push(cur);

    // 한 장에 행이 하나뿐이면 빈 공간을 채워 양식처럼 보이게
    pages.forEach(page => {
      if (page.length === 1 && page[0].h < 2.2) page[0].h = Math.min(maxRowH, Math.max(page[0].h, 2.2));
      const s = addSlide();
      bar(s, 0.55);
      heading(s, title, 0.72);
      const th = { fill: { color: 'D9D9D9' }, bold: true, align: 'center', valign: 'middle', border: BORDER, fontSize: 12 };
      const rows = [[{ text: '사업장', options: th }, { text: colTitle, options: th }]];
      page.forEach(p => rows.push([
        { text: p.name, options: { bold: true, align: 'center', valign: 'middle', border: BORDER, fontSize: 12 } },
        { text: p.lines.join('\n'), options: { align: 'left', valign: 'top', border: BORDER, fontSize: TEXT_PT, margin: [0.08, 0.1, 0.08, 0.1] } },
      ]));
      s.addTable(rows, { x: X, y: TABLE_Y, w: TW, colW: [SITE_W, BODY_W], rowH: [HEAD_H, ...page.map(p => p.h)], fontFace: FONT, valign: 'top' });
    });
  }

  db.groups.forEach((g, gi) => {
    // 세부 구분이 있는 사업장은 구분 이름으로 줄을 나눈다 (예: 본사 → DKS / DKCM / DKHD)
    let entries = sites.filter(x => x.groupId === g.id).flatMap(x => Ops.workParts(r, x).map(p => ({ name: p.name || x.name, text: p.text })));
    if (S.hideEmpty) entries = entries.filter(x => x.text.trim());
    if (!entries.length) return;
    textSlides(`2-${gi + 1}. ${g.name} 변경 및 신규 업무`, '변경 / 신규 업무', entries, 1.2);
  });

  const iss = sites.filter(x => (r.issues[x.id] || '').trim()).map(x => ({ name: x.name, text: r.issues[x.id] }));
  textSlides('3. 장애 및 이슈 사항', '장애 및 이슈 사항', iss, 0.8);

  return pres;
}

async function buildBuffer(db, r, opts) {
  return build(db, r, opts).write({ outputType: 'nodebuffer' });
}

module.exports = { buildBuffer };
