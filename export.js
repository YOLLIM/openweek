// 월간보고: 한 달 동안의 주간보고를 합치고, 엑셀로 내보낸다.
const ExcelJS = require('exceljs');
const Ops = require('./public/ops.js');

const KIND_NAME = { works: '변경 및 신규 업무', issues: '장애 및 이슈 사항' };

// 보고일이 해당 월(YYYY-MM)에 속하는 주간보고
const monthReports = (db, month) => db.reports.filter(r => r.date.startsWith(month)).sort((a, b) => a.date.localeCompare(b.date));
const weekTag = r => `${r.start.slice(5).replace('-', '/')}~${r.end.slice(5).replace('-', '/')}`;

function orderedSites(db) {
  const out = [];
  db.groups.forEach(g => db.sites.filter(s => s.groupId === g.id).forEach(s => out.push({ ...s, group: g.name })));
  return out;
}

// 한 달 치를 보고서 하나처럼 합친다: 건수는 합계, 글은 주차 머리말을 달아 이어 붙인다
function mergeMonth(db, month) {
  const reps = monthReports(db, month);
  if (!reps.length) return null;
  const m = { id: 'month-' + month, date: reps[reps.length - 1].date, start: reps[0].start, end: reps[reps.length - 1].end, stats: {}, works: {}, issues: {} };
  for (const s of db.sites) {
    for (const c of Ops.COLS) {
      const vals = reps.map(r => r.stats[s.id]?.[c.key]).filter(v => v !== '' && v != null);
      if (vals.length) (m.stats[s.id] ||= {})[c.key] = vals.reduce((a, v) => a + (Number(v) || 0), 0);
    }
    // 변경/신규 업무는 세부 구분 칸별로, 장애/이슈는 사업장별로 주차를 이어 붙인다
    const keys = [s.id, ...(s.subs || []).map(sb => Ops.subKey(s.id, sb.id))];
    for (const [k, list] of [['works', keys], ['issues', [s.id]]]) {
      for (const key of list) {
        const parts = reps.filter(r => (r[k]?.[key] || '').trim()).map(r => `[${weekTag(r)}]\n${r[k][key].replace(/\s+$/, '')}`);
        if (parts.length) m[k][key] = parts.join('\n');
      }
    }
  }
  return { merged: m, reports: reps };
}

async function monthXlsx(db, month) {
  const reps = monthReports(db, month);
  const sites = orderedSites(db).filter(s => s.active || reps.some(r => Ops.siteHasData(r, s.id)));
  const wb = new ExcelJS.Workbook();
  wb.creator = db.settings.author || '';
  const head = ws => {
    const row = ws.getRow(1);
    row.font = { bold: true };
    row.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    row.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDEDED' } }; });
    row.height = 22;
    ws.views = [{ state: 'frozen', ySplit: 1 }];
  };
  const border = ws => ws.eachRow(row => row.eachCell(c => { c.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } }; }));
  const colName = c => (c.parent ? `${c.parent} ` : '') + c.label;

  // 1) 운영 업무 건수: 사업장 × 항목, 월 합계
  const ws1 = wb.addWorksheet('운영 업무(월 합계)');
  ws1.columns = [{ header: '회사', width: 12 }, { header: '사업장', width: 12 }, ...Ops.COLS.map(c => ({ header: colName(c), width: 14 })), { header: '합계', width: 10 }];
  const tot = Ops.COLS.map(() => 0);
  for (const s of sites) {
    const vals = Ops.COLS.map(c => reps.reduce((a, r) => a + (Number(r.stats[s.id]?.[c.key]) || 0), 0));
    vals.forEach((v, i) => { tot[i] += v; });
    // 0은 빈칸으로 (보고서 양식과 같게)
    ws1.addRow([s.group, s.name, ...vals.map(v => v || null), vals.reduce((a, v) => a + v, 0) || null]);
  }
  const trow = ws1.addRow(['계', '', ...tot.map(v => v || null), tot.reduce((a, v) => a + v, 0) || null]);
  trow.font = { bold: true };
  head(ws1); border(ws1);

  // 2) 주차별 건수
  const ws2 = wb.addWorksheet('운영 업무(주차별)');
  ws2.columns = [{ header: '보고일', width: 12 }, { header: '기간', width: 14 }, { header: '회사', width: 12 }, { header: '사업장', width: 12 }, ...Ops.COLS.map(c => ({ header: colName(c), width: 14 }))];
  for (const r of reps) for (const s of sites) {
    const st = r.stats[s.id] || {};
    if (Ops.COLS.some(c => st[c.key] !== '' && st[c.key] != null)) ws2.addRow([r.date, weekTag(r), s.group, s.name, ...Ops.COLS.map(c => st[c.key] === '' || st[c.key] == null ? null : Number(st[c.key]))]);
  }
  head(ws2); border(ws2);

  // 3~4) 글 항목: 한 줄에 한 항목
  for (const k of ['works', 'issues']) {
    const ws = wb.addWorksheet(KIND_NAME[k]);
    ws.columns = [{ header: '보고일', width: 12 }, { header: '기간', width: 14 }, { header: '회사', width: 12 }, { header: '사업장', width: 12 }, { header: KIND_NAME[k], width: 100 }];
    for (const r of reps) for (const s of sites) {
      const t = (k === 'works' ? Ops.worksText(r, s) : r[k]?.[s.id] || '').replace(/\s+$/, '');
      if (!t.trim()) continue;
      const row = ws.addRow([r.date, weekTag(r), s.group, s.name, t]);
      row.getCell(5).alignment = { wrapText: true, vertical: 'top' };
      row.height = Math.min(400, 16 * t.split('\n').length + 4);
    }
    head(ws); border(ws);
  }
  return wb.xlsx.writeBuffer();
}

module.exports = { mergeMonth, monthXlsx, monthReports };
