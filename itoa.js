// ITOA 부문: 통합 유지보수 ITOA 서비스 주간 보고 (엑셀, A4 세로 한 장)
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const Ops = require('./public/ops.js');

const LOGO = path.join(__dirname, 'public', 'img', 'dkgroup.png');
const FONT = '맑은 고딕';
const BLUE = 'FF1F3FD6', RED = 'FFE00000', GRAY = 'FFBFBFBF', CYAN = 'FF00FFFF';
const thin = { style: 'thin', color: { argb: 'FF000000' } };
const box = { top: thin, left: thin, bottom: thin, right: thin };
const fmtDot = s => (s ? s.replaceAll('-', '.') : '');
// 줄 목록을 최소 n줄로 채운다 (양식의 빈 칸)
const pad = (a, n) => { a = a.slice(); while (a.length < n) a.push(''); return a; };
const num = v => (v === '' || v == null ? 0 : Number(v) || 0);

// 관리자: DK_ITOA_서비스일지_주간보고_20261021.xlsx (주간 마지막 날)
// 일반 사용자: 동국제강그룹_ITOA_주간보고서_202610_포항.xlsx (주간 마지막 날의 연월, 담당 사업장 이름)
const safe = t => String(t).replace(/[\\/:*?"<>|]/g, '').trim();
function fileName(r) {
  if (!r.mineOnly) return `DK_ITOA_서비스일지_주간보고_${r.end.replaceAll('-', '')}.xlsx`;
  return `동국제강그룹_ITOA_주간보고서_${r.end.slice(0, 7).replace('-', '')}_${(r.siteNames || []).map(safe).join('_') || '담당없음'}.xlsx`;
}
// 관리자 엑셀의 사업장 시트 이름: 동국제강-페럼, 동국홀딩스 (회사 약칭은 정식 이름으로)
const COMPANY = { 제강: '동국제강', 씨엠: '동국씨엠', 홀딩스: '동국홀딩스' };
function siteSheetName(g, s) {
  const company = COMPANY[g.name] || g.name;
  return g.name === s.name ? company : `${company}-${s.name}`;
}
// 사업장 시트 순서 (이 목록에 없는 사업장은 뒤에 사업장 관리 순서대로)
const SHEET_ORDER = ['동국홀딩스', '동국제강-페럼', '동국씨엠-페럼', '동국제강-포항', '동국제강-인천', '동국제강-신평', '동국제강-당진', '동국씨엠-부산', '동국씨엠-도성센터', '동국시스템즈', '인터지스'];
const sheetRank = n => { const i = SHEET_ORDER.indexOf(n); return i < 0 ? SHEET_ORDER.length : i; };

// 시트 이름: 일반 사용자 = 주간보고_1021 (주간 마지막 날의 월 · 일 두 자리), 관리자 = 통합주간보고
const sheetName = r => (r.mineOnly ? `주간보고_${r.end.slice(5, 7)}${r.end.slice(8, 10)}` : '통합주간보고');
// 엑셀 시트 이름에 못 쓰는 글자 빼고 31자까지
const sheetSafe = t => String(t).replace(/[\\/:*?[\]]/g, '').slice(0, 31);

// extra: 뒤에 붙일 시트 [{ name, view }] (관리자 엑셀의 사업장별 시트)
async function itoaXlsx(db, r, extra = []) {
  const wb = new ExcelJS.Workbook();
  drawSheet(wb, sheetName(r), db, r);
  // 통합 보고서 시트 탭: 빨강
  if (!r.mineOnly) wb.getWorksheet(sheetName(r)).properties.tabColor = { argb: 'FFFF0000' };
  const used = new Set([sheetName(r)]);
  // 통합 보고서(관리자): 2번째 시트 = 사업장별 V3 백신 최신 업데이트 현황 (별첨 자료)
  if (!r.mineOnly) { drawV3Sheet(wb, db, r); used.add('V3업데이트현황'); }
  for (const x of extra.slice().sort((a, b) => sheetRank(a.name) - sheetRank(b.name))) {
    let name = sheetSafe(x.name);
    for (let i = 2; used.has(name); i++) name = sheetSafe(`${x.name}(${i})`);
    used.add(name);
    drawSheet(wb, name, db, x.view);
  }
  // 마지막 시트: 요청 분야 · 처리 구분 색인
  drawIndexSheet(wb);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// 별첨 시트: V3 백신 최신 업데이트 현황 (사업장별 설치 수량 · 최신 업데이트 · 미적용 · 사유)
function drawV3Sheet(wb, db, r) {
  const ws = wb.addWorksheet('V3업데이트현황', {
    properties: { tabColor: { argb: 'FFFFFF00' } },   // 시트 탭: 노랑
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 1, horizontalCentered: true },
    views: [{ showGridLines: false }],
  });
  ws.columns = [20, 13, 11, 11, 13, 52].map(width => ({ width }));
  const med = { style: 'thin', color: { argb: 'FF000000' } };
  const put = (ref, value, o = {}) => {
    const c = ws.getCell(ref);
    c.value = value;
    c.font = { name: FONT, size: o.size || 10, bold: o.bold !== false, color: o.color ? { argb: o.color } : undefined };
    c.alignment = { horizontal: o.h || 'center', vertical: 'middle', wrapText: true };
    c.border = { top: med, left: med, bottom: med, right: med };
    if (o.fill) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: o.fill } };
    if (o.fmt) c.numFmt = o.fmt;
  };
  const GREEN = 'FFA6F5A1', SKY = 'FFD7EEFE', LEMON = 'FFFFFCB8', YELLOW = 'FFFFFF00';
  ws.mergeCells('A1:F1');
  const t = ws.getCell('A1');
  t.value = 'V3 백신 최신 업데이트 현황';
  t.font = { name: FONT, size: 16, bold: true };
  t.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 34;
  // 머리글 (2줄)
  ws.mergeCells('A3:A4'); ws.mergeCells('B3:B4'); ws.mergeCells('C3:D3'); ws.mergeCells('E3:E4'); ws.mergeCells('F3:F4');
  [['A3', '계열사/사업장'], ['B3', 'V3 설치 수량'], ['C3', '최신 업데이트 완료'], ['E3', '최신 업데이트\n미적용'], ['F3', '최신 업데이트 불가 PC, 사용자 및 사유'], ['C4', '수량'], ['D4', '완료율']]
    .forEach(([ref, v]) => put(ref, v, { fill: GREEN }));
  ['A4', 'B4', 'D3', 'E4', 'F4'].forEach(ref => put(ref, ws.getCell(ref).value, { fill: GREEN }));
  ws.getRow(3).height = 22; ws.getRow(4).height = 22;
  // 사용 중인 사업장 + 이 보고서에 백신 내용이 있는 사업장 (사업장 관리 순서)
  const it = db.itoa || {};
  const rows = (it.groups || []).flatMap(g => (it.sites || []).filter(s => s.groupId === g.id).map(s => ({ g, s, v: r.v3s?.[s.id] || {} })))
    .filter(x => x.s.active || Object.values(x.v).some(v => String(v ?? '').trim()));
  // 예전에 사업장 없이 넣은 값도 합계와 맞도록 맨 위에
  if (Object.values(r.v3s?._ || {}).some(v => String(v ?? '').trim())) rows.unshift({ g: { name: '' }, s: { name: '사업장 미지정' }, v: r.v3s._ });
  let row = 5;
  for (const { g, s, v } of rows) {
    const inst = num(v.installed), lat = num(v.latest);
    ws.getRow(row).height = 26;
    put(`A${row}`, !g.name || g.name === s.name ? s.name : `${g.name} ${s.name}`, { h: 'left' });
    put(`B${row}`, inst, { fmt: '#,##0' });
    put(`C${row}`, lat, { fmt: '#,##0' });
    put(`D${row}`, inst ? lat / inst : '-', { fill: SKY, fmt: '0.0%' });
    put(`E${row}`, num(v.fail), { fill: LEMON, color: RED, fmt: '#,##0' });
    put(`F${row}`, v.note || '', { h: 'left', size: 9.5 });
    row++;
  }
  const sum = k => rows.reduce((a, x) => a + num(x.v[k]), 0), ti = sum('installed'), tl = sum('latest');
  ws.getRow(row).height = 26;
  put(`A${row}`, '합 계', { fill: YELLOW });
  put(`B${row}`, ti, { fill: YELLOW, fmt: '#,##0' });
  put(`C${row}`, tl, { fill: YELLOW, fmt: '#,##0' });
  put(`D${row}`, ti ? tl / ti : '-', { fill: YELLOW, fmt: '0.0%' });
  put(`E${row}`, sum('fail'), { fill: YELLOW, color: RED, fmt: '#,##0' });
  put(`F${row}`, '', { fill: YELLOW });
  ws.pageSetup.printArea = `A1:F${row}`;
}

// 마지막 시트: 서비스 요청 분야 · 처리 구분 색인 (샘플 엑셀의 "색인" 시트 내용)
const INDEX_REQ = [
  ['Hardware', [['H/W(PC,NB)', 'DeskTop, Notebook의 Hardware 장애, 부품 교체'], ['H/W(Monitor)', 'Monitor의 Hardware 장애 및 교체'], ['H/W(Printer)', '자체 보유 Printer 장애, 드라이브 설치 등 일체'],
    ['H/W(주변장치)', '키보드, 마우스, 스캐너 등 주변장치의 장애 및 교체'], ['H/W 설치', 'O/S 설치를 포함한 신규 장비 설치, 이전 설치, 초기화 후 재설치 등']]],
  ['Software', [['O/S', '기존 장비에 O/S 재설치'], ['드라이버/패치', '주변장치의 드라이브 설치, 각종 패치'], ['상용S/W', '일반적인 S/W 설치, Office, 한글, MS제공 각 S/W, 기타 상용'],
    ['업무용S/W', 'Internet Exploer 장애(IRIS), SAP, C/S 프로그램, 백신 등 업무용 S/W']]],
  ['MPS', [['MPS', 'HP MPS용 Printer 관련 일체']]],
  ['IPT', [['IPT', 'IPT 관련 업무 일체']]],
  ['보안', [['보안점검', '보안관련 업무, 트러스가드 결과에 따른 점검 업무']]],
  ['교육', [['사용자교육', '사용 미숙에 따른 교육, 간단한 사용자 교육 등']]],
  ['기타', [['기타', '색인에 설명되지 않은 업무, 비정기적 업무 등']]],
];
const INDEX_DONE = [
  ['처리 완료', '부품교체없이 단순 지원 및 설치로 처리완료'],
  ['부품교체 처리완료', '부품교체를 하여 처리완료'],
  ['사용미숙완료', 'HW 또는 SW상 이상없이 사용자가 운영방법 미숙한 경우 교육으로 처리 완료'],
  ['이관처리완료', '협력업체 또는 본사로 이관하여 처리 완료된 경우'],
  ['처리중', '시간이 필요한 작업 또는 타 기관으로 이관하여 처리 중인 경우\n사용자의 사정으로 처리 작업을 진행하지 못하는 경우 등'],
  ['완료불가', '처리가 불가한 경우, 사용자 과실등으로 인해 비용 발생 시 비용 처리가 문제되는 경우, 개인 장비에 대해 서비스를 요청하는 경우 등, 이러한 내용은 참고 사항 또는 비고란에 기재하기 바람'],
  ['기타', '위 구분의 어떤 사항에도 포함되지 않는 경우, 그 내용을 참고 사항에 기재하기 바람'],
];
function drawIndexSheet(wb) {
  const ws = wb.addWorksheet('색인', {
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 1, horizontalCentered: true },
    views: [{ showGridLines: false }],
  });
  ws.columns = [14, 18, 64].map(width => ({ width }));
  const thinB = { style: 'thin', color: { argb: 'FF000000' } };
  const HEAD = 'FF0000FF', SIDE = 'FFCCFFFF';
  const put = (a, b, value, o = {}) => {
    if (a !== b) ws.mergeCells(`${a}:${b}`);
    const c = ws.getCell(a);
    c.value = value;
    c.font = { name: FONT, size: o.size || 10, bold: !!o.bold, color: { argb: o.color || 'FF000000' } };
    c.alignment = { horizontal: o.h || 'left', vertical: 'middle', wrapText: true };
    if (o.fill) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: o.fill } };
    if (o.border !== false) {
      const cols = 'ABC', [c1, r1] = [cols.indexOf(a[0]), Number(a.slice(1))], [c2, r2] = [cols.indexOf(b[0]), Number(b.slice(1))];
      for (let y = r1; y <= r2; y++) for (let x = c1; x <= c2; x++) ws.getCell(`${cols[x]}${y}`).border = { top: thinB, left: thinB, bottom: thinB, right: thinB };
    }
  };
  let row = 1;
  // 1) 서비스 접수 [요청 분야] 색인
  ws.getRow(row).height = 40;
  put(`A${row}`, `C${row}`, '서비스 접수 [요청 분야]에 대한 상세 분야 색인', { size: 14, bold: true, h: 'center', border: false });
  row += 2;
  ws.getRow(row).height = 22;
  put(`A${row}`, `A${row}`, '구 분', { bold: true, h: 'center', fill: HEAD, color: 'FFFFFFFF' });
  put(`B${row}`, `B${row}`, '요청 분야', { bold: true, h: 'center', fill: HEAD, color: 'FFFFFFFF' });
  put(`C${row}`, `C${row}`, '상 세   분 야', { bold: true, h: 'center', fill: HEAD, color: 'FFFFFFFF' });
  row++;
  for (const [group, items] of INDEX_REQ) {
    put(`A${row}`, `A${row + items.length - 1}`, group, { bold: true, fill: SIDE });
    items.forEach(([k, d], i) => {
      ws.getRow(row + i).height = 22;
      put(`B${row + i}`, `B${row + i}`, k, { bold: true });
      put(`C${row + i}`, `C${row + i}`, d, { bold: true });
    });
    row += items.length;
  }
  row += 2;
  // 2) 서비스 처리 [처리 구분] 색인
  ws.getRow(row).height = 40;
  put(`A${row}`, `C${row}`, '서비스 처리 [처리 구분]에 대한 상세 분야 색인', { size: 14, bold: true, h: 'center', border: false });
  row += 2;
  ws.getRow(row).height = 22;
  put(`A${row}`, `B${row}`, '처리 구분', { bold: true, h: 'center', fill: HEAD, color: 'FFFFFFFF' });
  put(`C${row}`, `C${row}`, '상 세   분 야', { bold: true, h: 'center', fill: HEAD, color: 'FFFFFFFF' });
  row++;
  for (const [k, d] of INDEX_DONE) {
    ws.getRow(row).height = d.length > 70 || d.includes('\n') ? 44 : 22;
    put(`A${row}`, `B${row}`, k, { bold: true });
    put(`C${row}`, `C${row}`, d, { bold: true });
    row++;
  }
  ws.pageSetup.printArea = `A1:C${row - 1}`;
}

// 시트 한 장 = 보고서 양식 한 장
function drawSheet(wb, name, db, r) {
  const ws = wb.addWorksheet(name, {
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 1, horizontalCentered: true, margins: { left: 0.4, right: 0.4, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 } },
    views: [{ showGridLines: false }],
  });
  ws.columns = [15.5, 13.5, 13.5, 13.5, 12, 9.5, 9.5, 9.5].map(width => ({ width }));
  const C = 'ABCDEFGH';
  let row = 1;
  const cell = (ref, value, o = {}) => {
    const c = ws.getCell(ref);
    c.value = value;
    c.font = { name: FONT, size: o.size || 10, bold: !!o.bold, color: o.color ? { argb: o.color } : undefined };
    c.alignment = { horizontal: o.h || 'center', vertical: 'middle', wrapText: true, indent: o.indent || 0 };
    if (o.fill) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: o.fill } };
    if (o.fmt) c.numFmt = o.fmt;
    return c;
  };
  // 범위를 합치고 모든 칸에 테두리
  const area = (a, b, value, o = {}) => {
    if (a !== b) ws.mergeCells(`${a}:${b}`);
    const c = cell(a, value, o);
    if (o.border !== false) {
      const [c1, r1] = [C.indexOf(a[0]), Number(a.slice(1))], [c2, r2] = [C.indexOf(b[0]), Number(b.slice(1))];
      for (let y = r1; y <= r2; y++) for (let x = c1; x <= c2; x++) ws.getCell(`${C[x]}${y}`).border = box;
    }
    return c;
  };
  const gap = h => { ws.getRow(row).height = h; row++; };

  // 로고 · 제목
  ws.getRow(1).height = 26;
  if (fs.existsSync(LOGO)) ws.addImage(wb.addImage({ filename: LOGO, extension: 'png' }), { tl: { col: 0.05, row: 0.15 }, ext: { width: 160, height: 34 } });
  ws.getRow(2).height = 36;
  area('A2', 'H2', '통합 유지보수 ITOA 서비스 주간 보고', { size: 18, bold: true, border: false });
  row = 3; gap(8);
  ws.getRow(row).height = 20;
  // 결재란: 전체 보고서는 담당 · 팀장 · PM, 사업장 보고서는 담당 · 팀장 (오른쪽 끝에 붙임)
  const SIGN = r.mineOnly ? [['G', 'staff', '담 당'], ['H', 'lead', '팀 장']] : [['F', 'staff', '담 당'], ['G', 'lead', '팀 장'], ['H', 'pm', 'P M']];
  SIGN.map(([c, , t]) => [c, t]).forEach(([c, t]) => area(`${c}${row}`, `${c}${row}`, t, { size: 9 }));
  row++;
  ws.getRow(row).height = 42;
  SIGN.map(([c, k]) => [c, k]).forEach(([c, k]) => {
    const sg = r.signImg?.[k];
    area(`${c}${row}`, `${c}${row}`, sg ? '' : r.sign?.[k] || '', { size: 9, bold: true, color: BLUE });
    if (!sg) return;
    // 손글씨 서명: 칸(약 68×52px) 안에 비율을 지켜 가운데 배치
    const buf = Buffer.from(sg.img.split(',')[1], 'base64');
    const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20), s = Math.min(64 / w, 50 / h);
    const id = wb.addImage({ base64: sg.img, extension: 'png' });
    const col = C.indexOf(c);
    ws.addImage(id, { tl: { col: col + (1 - (w * s) / 68) / 2, row: row - 1 + (1 - (h * s) / 56) / 2 }, ext: { width: w * s, height: h * s } });
  });
  row++;
  ws.getRow(row).height = 22;
  area(`A${row}`, `B${row}`, `사 업 장 : ${r.site || ''}`, { h: 'left', bold: true, border: false });
  area(`C${row}`, `E${row}`, `담   당 : ${r.manager || ''}`, { h: 'left', bold: true, border: false });
  row++;
  ws.getRow(row).height = 22;
  area(`A${row}`, `E${row}`, `주     간 : ${fmtDot(r.start)}. ~ ${fmtDot(r.end)}`, { h: 'left', bold: true, border: false });
  row++; gap(10);

  // 처리 실적
  ws.getRow(row).height = 26;
  [['A', '구분'], ['B', '완료'], ['C', '지연 완료'], ['D', '적기 처리율(%)']].forEach(([c, t]) => area(`${c}${row}`, `${c}${row}`, t, { bold: true, fill: GRAY }));
  area(`E${row}`, `G${row}`, '지연 완료 사유', { bold: true, fill: GRAY, color: RED });
  area(`H${row}`, `H${row}`, '비 고', { bold: true, fill: GRAY });
  row++;
  for (const x of Ops.ITOA_ROWS) {
    // 건수는 사업장별 입력의 합계, 사유·비고는 관리자 글 + 사업장별 글
    const sum = Ops.itoaRowSum(r, x.key);
    ws.getRow(row).height = 24;
    area(`A${row}`, `A${row}`, x.label, { bold: true });
    area(`B${row}`, `B${row}`, sum.done, { color: BLUE });
    area(`C${row}`, `C${row}`, sum.late, { color: RED });
    area(`D${row}`, `D${row}`, sum.rate, { fmt: '0.0' });
    area(`E${row}`, `G${row}`, Ops.itoaRowText(db, r, x.key, 'reason'), { h: 'left', size: 9 });
    area(`H${row}`, `H${row}`, Ops.itoaRowText(db, r, x.key, 'note'), { size: 9 });
    row++;
  }
  const t = Ops.itoaTotals(r);
  ws.getRow(row).height = 26;
  area(`A${row}`, `A${row}`, '계', { bold: true, fill: GRAY, size: 11 });
  area(`B${row}`, `B${row}`, t.done, { bold: true, color: BLUE, size: 12 });
  area(`C${row}`, `C${row}`, t.late, { bold: true, color: RED, size: 12 });
  area(`D${row}`, `D${row}`, t.rate, { fmt: '0.0' });
  area(`E${row}`, `G${row}`, '');
  area(`H${row}`, `H${row}`, '');
  row++; gap(18);

  // V3 백신 운영 현황
  const v3 = Ops.itoaV3(db, r);
  ws.getRow(row).height = 26; ws.getRow(row + 1).height = 24; ws.getRow(row + 2).height = 26;
  area(`A${row}`, `A${row + 2}`, '백신 현황 및\n방역 활동 내역', { bold: true, fill: GRAY });
  [['B', 'V3 설치 수량'], ['C', '최신 업데이트'], ['D', '업데이트 불가']].forEach(([c, tt]) => area(`${c}${row}`, `${c}${row}`, tt, { bold: true, size: 9 }));
  area(`E${row}`, `H${row}`, '최신 업데이트 불가 PC, 사용자 및 사유', { bold: true, size: 9 });
  area(`B${row + 1}`, `B${row + 1}`, num(v3.installed), { bold: true, fmt: '#,##0' });
  area(`C${row + 1}`, `C${row + 1}`, num(v3.latest), { bold: true, color: BLUE, fmt: '#,##0' });
  area(`D${row + 1}`, `D${row + 1}`, num(v3.fail), { bold: true, color: RED, fmt: '#,##0' });
  area(`E${row + 1}`, `H${row + 1}`, v3.note || '', { bold: true, color: BLUE, size: 9 });
  // 방역 활동 실시: 한 줄 전체
  area(`B${row + 2}`, `B${row + 2}`, '방역 활동 실시', { bold: true, size: 9 });
  area(`C${row + 2}`, `H${row + 2}`, v3.clean || '', { h: 'left', size: 9 });
  row += 3; gap(18);

  // 일반 업무 실적 · 특이 사항 · 차주 계획: 한 줄에 한 항목
  const block = (label, kind, n, rich) => {
    const ls = pad(Ops.itoaLines(db, r, kind), n);
    area(`A${row}`, `A${row + ls.length - 1}`, rich || label, { bold: true, fill: GRAY });
    ls.forEach((l, i) => { ws.getRow(row + i).height = 22; area(`B${row + i}`, `H${row + i}`, l, { h: 'left', size: 9 }); });
    row += ls.length; gap(18);
  };
  block('일반 업무 실적', 'general', 3, { richText: [
    { text: '일반 업무 실적\n(입고/출고설치)\n', font: { name: FONT, size: 10, bold: true } },
    { text: '* 사업장 상호 이동\n현황은 기재 요망', font: { name: FONT, size: 9, bold: true, color: { argb: RED } } },
  ] });
  block('특이 사항', 'special', 4);
  block('차주 계획', 'plans', 3);
  gap(10);

  // 근무 현황
  ws.getRow(row).height = 20; ws.getRow(row + 1).height = 20;
  area(`A${row}`, `A${row + 1}`, '근무 일수', { bold: true, fill: CYAN });
  area(`B${row}`, `B${row + 1}`, '출근 일수', { bold: true, fill: CYAN });
  area(`C${row}`, `D${row}`, '기타(지각/조퇴)', { bold: true, fill: CYAN });
  area(`E${row}`, `F${row}`, '긴급 장애(근무시간외)', { bold: true, fill: CYAN, size: 9 });
  area(`G${row}`, `H${row + 1}`, '특이 사항', { bold: true, fill: CYAN });
  [['C', '일수'], ['D', '사 유'], ['E', '일시'], ['F', '내 용']].forEach(([c, tt]) => area(`${c}${row + 1}`, `${c}${row + 1}`, tt, { bold: true, fill: CYAN, size: 9 }));
  row += 2;
  // 사업장마다 한 줄, 특이 사항 앞에 "회사_사업장" (내용이 없으면 빈 줄 하나)
  // 근무 현황: 한 줄 집계
  const at = Ops.itoaAttTotal(db, r);
  ws.getRow(row).height = 24;
  area(`A${row}`, `A${row}`, at.work, { bold: true });
  area(`B${row}`, `B${row}`, at.present, { bold: true });
  area(`C${row}`, `C${row}`, at.etcDays);
  area(`D${row}`, `D${row}`, at.etcReason, { size: 9 });
  area(`E${row}`, `E${row}`, at.emDate, { size: 9 });
  area(`F${row}`, `F${row}`, at.emContent, { size: 9 });
  area(`G${row}`, `H${row}`, at.note, { size: 9 });

  ws.pageSetup.printArea = `A1:H${row}`;
}

module.exports = { itoaXlsx, fileName, siteSheetName };
