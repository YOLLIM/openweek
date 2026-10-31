// 서버와 브라우저가 함께 쓰는 데이터 모델 / 변경 연산
(function (root) {
  const COLS = [
    { key: 'swg', label: 'SWG' },
    { key: 'ipt', label: 'IPT' },
    { key: 'vpnAdd', label: '추가(연장)', parent: 'VPN [본사]' },
    { key: 'vpnDel', label: '삭제', parent: 'VPN [본사]', white: true },
    { key: 'req', label: '정보처리의뢰서 처리' },
    { key: 'cabling', label: 'Cabling' },
  ];
  // 사업장별 글 항목: 2. 변경 및 신규 업무, 3. 장애 및 이슈 사항
  const KINDS = ['works', 'issues'];
  // 확정(잠금)된 보고서에서 막는 작업
  const LOCKED_BLOCKS = ['report.date', 'report.period', 'report.cell', 'report.text', 'report.done', 'report.delete'];
  const SETTING_KEYS = ['dept', 'company', 'author', 'title', 's1Title', 'footer', 'hideEmpty'];

  // ITOA 부문: 통합 유지보수 ITOA 서비스 주간 보고
  const ITOA_ROWS = [
    { key: 'hw', label: 'H/W' }, { key: 'sw', label: 'S/W' }, { key: 'nw', label: 'N/W' }, { key: 'ipt', label: 'IPT' },
    { key: 'mps', label: 'MPS' }, { key: 'edu', label: '교육' }, { key: 'sec', label: '보안점검' }, { key: 'etc', label: '기타' },
  ];
  // itoa.set 으로 고칠 수 있는 칸 (숫자 칸은 0 이상의 정수)
  const ITOA_NUM = new Set([
  ]);
  const ITOA_TEXT = new Set([
    ...ITOA_ROWS.flatMap(r => [`rows.${r.key}.reason`, `rows.${r.key}.note`]),
    'site', 'manager', 'sign.staff', 'sign.lead', 'sign.pm',
  ]);
  // 적기 처리율(%) = 완료 / (완료 + 지연 완료) × 100, 건수가 없으면 100
  const itoaRate = (done, late) => { const d = Number(done) || 0, l = Number(late) || 0; return d + l ? (d / (d + l)) * 100 : 100; };
  // 처리 실적은 사업장별로 입력한다: r.cnt[사업장id][구분] = { done, late } → 보고서에는 구분별 합계
  function itoaRowSum(r, key) {
    let done = 0, late = 0;
    for (const c of Object.values(r.cnt || {})) { done += Number(c?.[key]?.done) || 0; late += Number(c?.[key]?.late) || 0; }
    return { done, late, rate: itoaRate(done, late) };
  }
  // 출력용 지연 완료 사유 · 비고(f): 관리자가 구분별로 쓴 글 + 사업장별로 쓴 글 ("회사_사업장: 내용")
  function itoaRowText(db, r, key, f) {
    const it = db.itoa || {}, parts = [];
    const own = String(r.rows?.[key]?.[f] || '').trim();
    if (own) parts.push(own);
    const _ = String(r.cnt?._?.[key]?.[f] || '').trim();
    if (_) parts.push(_);
    const sites = [];
    for (const g of it.groups || []) for (const s of (it.sites || []).filter(x => x.groupId === g.id)) {
      const t = String(r.cnt?.[s.id]?.[key]?.[f] || '').trim();
      if (t) sites.push([itoaSiteLabel(g, s), t]);
    }
    // 사업장 글이 하나뿐이고 다른 글이 없으면 이름 없이
    if (sites.length === 1 && !parts.length) return sites[0][1];
    return [...parts, ...sites.map(([l, t]) => `${l}: ${t}`)].join(' / ');
  }
  function itoaTotals(r) {
    const sums = ITOA_ROWS.map(x => itoaRowSum(r, x.key));
    const done = sums.reduce((a, x) => a + x.done, 0), late = sums.reduce((a, x) => a + x.late, 0);
    return { done, late, rate: itoaRate(done, late) };
  }
  // ITOA 담당자(부문 전체): 관리자와 함께 보고서 전체를 작성
  const canEditItoa = (db, who) => who.role === 'admin' || (db.itoa?.assignees || []).includes(who.empNo);
  // 일반 업무 실적 · 특이 사항 · 차주 계획은 ITOA 사업장별로 쓴다 (r.general[사업장id] ...)
  const ITOA_KINDS = ['general', 'special', 'plans'];
  // 사업장 칸: 그 사업장 담당자만 (관리자·ITOA 담당자 포함). 담당자가 없는 사업장과 '_'(사업장 미지정) 칸은 관리자·ITOA 담당자
  function canEditItoaSite(db, who, sid) {
    const s = (db.itoa?.sites || []).find(x => x.id === sid);
    if (s && (s.assignees || []).length) return s.assignees.includes(who.empNo);
    return canEditItoa(db, who);
  }
  // 줄 앞에 붙는 사업장 이름: 회사_사업장 (회사와 이름이 같으면 하나만) 예) 제강_인천, 인터지스
  const itoaSiteLabel = (g, s) => (!g || g.name === s.name ? s.name : `${g.name}_${s.name}`);
  // 예전 형식(글 항목이 하나의 글) → 사업장별로 옮긴다. "제강_인천-내용" 처럼 사업장 이름으로 시작하는 줄은 그 사업장으로.
  // 서버가 읽을 때 한 번 실행하며, 처음에는 보고서 예시의 회사·사업장을 기본으로 넣는다 (사업장 관리에서 변경)
  function normalizeItoa(db) {
    const it = (db.itoa ||= { assignees: [], reports: [] });
    it.assignees ||= [];
    it.reports ||= [];
    if (!it.groups) {
      const G = [['itg-holdings', '홀딩스', ['홀딩스']], ['itg-steel', '제강', ['페럼', '포항', '인천', '신평', '당진']], ['itg-cm', '씨엠', ['페럼', '부산', '도성센터']],
        ['itg-systems', '동국시스템즈', ['동국시스템즈']], ['itg-intergis', '인터지스', ['인터지스']]];
      it.groups = G.map(([id, name]) => ({ id, name }));
      it.sites = G.flatMap(([gid, , names]) => names.map((name, i) => ({ id: `${gid}-${i + 1}`, groupId: gid, name, active: true, assignees: [] })));
    }
    it.sites ||= [];
    const labels = it.sites.map(s => [itoaSiteLabel(it.groups.find(g => g.id === s.groupId), s), s.id]).sort((a, b) => b[0].length - a[0].length);
    // 예전에 구분별 합계로만 입력한 처리 실적 → '사업장 미지정' 칸으로
    for (const r of it.reports) {
      if (r.cnt) continue;
      r.cnt = {};
      for (const x of ITOA_ROWS) {
        const v = r.rows?.[x.key];
        if (!v) continue;
        if (v.done !== '' && v.done != null || v.late !== '' && v.late != null) (r.cnt._ ||= {})[x.key] = { done: v.done ?? '', late: v.late ?? '' };
        delete v.done; delete v.late;
      }
    }
    // 예전 V3(보고서에 한 줄) → '사업장 미지정'
    for (const r of it.reports) {
      if (r.v3s) continue;
      r.v3s = hasV3(r.v3) ? { _: { ...r.v3 } } : {};
      delete r.v3;
    }
    // 예전 근무 현황(보고서에 한 줄) → '사업장 미지정'
    for (const r of it.reports) {
      if (r.atts) continue;
      r.atts = hasAtt(r.att) ? { _: { ...r.att } } : {};
      delete r.att;
    }
    for (const r of it.reports) for (const k of ITOA_KINDS) {
      if (typeof r[k] !== 'string') { r[k] ||= {}; continue; }
      const by = {};
      for (const line of r[k].split('\n')) {
        if (!line.trim()) continue;
        const hit = labels.find(([l]) => line.startsWith(l + '-'));
        const key = hit ? hit[1] : '_';
        by[key] = (by[key] ? by[key] + '\n' : '') + (hit ? line.slice(hit[0].length + 1) : line);
      }
      r[k] = by;
    }
    return db;
  }
  // 근무 현황도 사업장별: r.atts[사업장id] = { work, present, etcDays, etcReason, emDate, emContent, note }
  const ITOA_ATT_NUM = ['work', 'present', 'etcDays'], ITOA_ATT_TEXT = ['etcReason', 'emDate', 'emContent', 'note'];
  const hasAtt = a => [...ITOA_ATT_NUM, ...ITOA_ATT_TEXT].some(k => String(a?.[k] ?? '').trim());
  // 출력용 근무 현황 줄: 내용이 있는 사업장만 순서대로, label = 회사_사업장 ('' = 사업장 미지정)
  function itoaAttRows(db, r) {
    const it = db.itoa || {}, out = [];
    if (hasAtt(r.atts?._)) out.push({ label: '', ...r.atts._ });
    for (const g of it.groups || []) for (const s of (it.sites || []).filter(x => x.groupId === g.id)) if (hasAtt(r.atts?.[s.id])) out.push({ label: r.mineOnly ? '' : itoaSiteLabel(g, s), ...r.atts[s.id] });
    return out;
  }
  // 출력용 근무 현황 한 줄 집계: 일수는 사업장 합계, 글은 "회사_사업장: 내용" (사업장 하나뿐이거나 내 사업장 보고서면 내용만)
  function itoaAttTotal(db, r) {
    const rows = itoaAttRows(db, r);
    const sum = k => { const v = rows.filter(x => String(x[k] ?? '').trim() !== ''); return v.length ? v.reduce((a, x) => a + (Number(x[k]) || 0), 0) : ''; };
    const join = k => { const t = rows.filter(x => String(x[k] ?? '').trim()); return t.length === 1 ? String(t[0][k]) : t.map(x => (x.label ? `${x.label}: ${x[k]}` : x[k])).join(' / '); };
    return { work: sum('work'), present: sum('present'), etcDays: sum('etcDays'), etcReason: join('etcReason'), emDate: join('emDate'), emContent: join('emContent'), note: join('note') };
  }
  // V3 백신 운영 현황도 사업장별: r.v3s[사업장id] = { installed, latest, fail, clean, note }
  // 건수 칸과 글 칸 (note = 업데이트 불가 PC · 사용자 및 사유, clean = 방역 활동 실시 내용)
  const ITOA_V3_NUM = ['installed', 'latest', 'fail'], ITOA_V3_TEXT = ['note', 'clean'];
  const ITOA_V3_NOTE_ALL = '별첨 자료 참조';
  const NO_CONTENT = /^(특이\s*사항\s*없음|해당\s*없음|없음|-)\.?$/;
  const hasV3 = a => [...ITOA_V3_NUM, ...ITOA_V3_TEXT].some(k => String(a?.[k] ?? '').trim());
  // 출력용 V3: 건수는 사업장 합계, 글은 "회사_사업장: 내용" (사업장 하나뿐이면 내용만)
  function itoaV3(db, r) {
    const it = db.itoa || {}, out = { installed: 0, latest: 0, fail: 0 }, texts = { note: [], clean: [] };
    const add = (label, a) => {
      if (!a) return;
      ITOA_V3_NUM.forEach(k => { out[k] += Number(a[k]) || 0; });
      // 방역 활동은 '특이 사항 없음' 같은 내용 없는 입력을 빼서, 남는 게 없으면 빈칸
      ITOA_V3_TEXT.forEach(k => { const t = String(a[k] ?? '').trim(); if (t && !(k === 'clean' && NO_CONTENT.test(t))) texts[k].push([label, t]); });
    };
    add('', r.v3s?._);
    for (const g of it.groups || []) for (const s of (it.sites || []).filter(x => x.groupId === g.id)) add(itoaSiteLabel(g, s), r.v3s?.[s.id]);
    ITOA_V3_TEXT.forEach(k => { const t = texts[k]; out[k] = t.length === 1 ? t[0][1] : t.map(([l, x]) => (l ? `${l}: ${x}` : x)).join(' / '); });
    // 전체(통합) 보고서의 업데이트 불가 사유는 사업장별 사유 대신 "별첨 자료 참조"로 고정
    if (!r.mineOnly) out.note = ITOA_V3_NOTE_ALL;
    return out;
  }
  // ITOA 사업장별 미작성 항목 (전체 현황 · 독촉 메일)
  function itoaSiteMissing(r, sid) {
    const has = o => Object.values(o || {}).some(v => (v && typeof v === 'object') ? has(v) : String(v ?? '').trim());
    const cnt = Object.values(r.cnt?.[sid] || {}).some(v => Number(v.done) || Number(v.late));
    const line = k => String(r[k]?.[sid] || '').trim();
    return [!cnt && '1. 처리 실적', !has(r.v3s?.[sid]) && '2. 백신 현황 및 방역 활동', !line('general') && '3. 일반 업무 실적', !line('special') && '4. 특이 사항', !line('plans') && '5. 차주 계획', !has(r.atts?.[sid]) && '6. 근무 현황'].filter(Boolean);
  }
  // 출력(미리보기·엑셀)용 보고서: 관리자는 전체, 그 외에는 자기가 담당인 사업장 내용만 (사업장 칸 = 담당 사업장 이름)
  // nameOf(사번) → 이름: 담당 칸에 담당 사업장의 담당자 이름을 넣는다
  function itoaView(db, r, who, nameOf = x => x) {
    // 관리자: 전체 내용, 담당 = 접속한 관리자 이름
    if (who.role === 'admin') return { ...r, manager: who.name || r.manager || '' };
    const mine = (db.itoa?.sites || []).filter(s => (s.assignees || []).includes(who.empNo));
    return itoaSitesView(db, r, mine, nameOf);
  }
  // 주어진 사업장들의 내용만 담은 보고서 (사업장 칸 = 그 사업장 이름, 담당 = 그 사업장 담당자)
  function itoaSitesView(db, r, mine, nameOf = x => x) {
    const it = db.itoa || {};
    const ids = new Set(mine.map(s => s.id));
    const pick = o => Object.fromEntries(Object.entries(o || {}).filter(([k]) => ids.has(k)));
    const v = { ...r, cnt: pick(r.cnt), atts: pick(r.atts), v3s: pick(r.v3s) };
    ITOA_KINDS.forEach(k => { v[k] = pick(r[k]); });
    // 지연 완료 사유는 보고서 전체에 쓰는 글이므로 내 사업장에 지연 완료가 있는 구분만 남긴다
    // 관리자가 쓴 지연 완료 사유 · 비고는 빼고 내 사업장에 쓴 것만
    v.rows = {};
    v.site = mine.map(s => itoaSiteLabel((it.groups || []).find(g => g.id === s.groupId), s)).join(', ') || '(담당 사업장 없음)';
    v.manager = [...new Set(mine.flatMap(s => s.assignees || []))].map(nameOf).filter(Boolean).join(', ');
    const ss = mine.map(x => r.siteSign?.[x.id]).find(x => x && (x.staff || x.lead)) || {};
    v.signImg = { ...(ss.staff ? { staff: ss.staff } : {}), ...(ss.lead ? { lead: ss.lead } : {}) };
    v.sign = {};
    v.siteNames = mine.map(s => s.name);
    v.mineOnly = true;
    return v;
  }
  // 출력용 줄 목록: 사업장 순서대로 "회사_사업장-내용"
  function itoaLines(db, r, kind) {
    const it = db.itoa || {}, out = [];
    const add = (label, text) => String(text || '').split('\n').filter(l => l.trim()).forEach(l => out.push(label ? `${label}-${l.trim()}` : l.trim()));
    add('', r[kind]?._);
    // 관리자가 아닌 사용자의 보고서(자기 사업장만)는 줄 앞에 회사_사업장을 붙이지 않는다
    for (const g of it.groups || []) for (const s of (it.sites || []).filter(x => x.groupId === g.id)) add(r.mineOnly ? '' : itoaSiteLabel(g, s), r[kind]?.[s.id]);
    return out;
  }

  const uid = () =>Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  const pad = n => String(n).padStart(2, '0');
  const toISO = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const fromISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (s, n) => { const d = fromISO(s); d.setDate(d.getDate() + n); return toISO(d); };
  const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
  // 새로 만드는 항목의 id: 화면이 만들어 보내는 값이라 영문 · 숫자 · _ · - 만 받는다 (HTML 속성과 주소에 그대로 쓰인다)
  const isId = s => typeof s === 'string' && /^[\w-]{1,40}$/.test(s);

  function seed() {
    const g1 = uid(), g2 = uid(), g3 = uid();
    return {
      settings: { dept: '네트워크부문', company: '㈜열림데이터시스템', author: '이재호', title: '주간업무보고', s1Title: '1. DK GROUP 운영 업무', footer: 'DONGKUK SYSTEMS', hideEmpty: true },
      groups: [{ id: g1, name: 'DK GROUP' }, { id: g2, name: 'DKS' }, { id: g3, name: 'DKCM' }],
      sites: [
        { id: uid(), groupId: g1, name: '본사', active: true },
        { id: uid(), groupId: g2, name: '인천', active: true },
        { id: uid(), groupId: g2, name: '당진', active: true },
        { id: uid(), groupId: g2, name: '포항', active: true },
        { id: uid(), groupId: g3, name: '부산', active: true },
      ],
      reports: [],
      itoa: { assignees: [], reports: [] },
    };
  }

  // 사업장 세부 구분 (예: 본사 → DKS / DKCM / DKHD): 2. 변경 및 신규 업무를 구분별로 따로 쓴다.
  // 구분별 글은 works["<사업장id>:<구분id>"] 에 저장한다.
  const subKey = (sid, subId) => `${sid}:${subId}`;
  // 사업장의 변경/신규 업무 칸 목록: [{ key, name, text }] (구분이 없으면 칸 하나, name = null)
  function workParts(r, s) {
    const subs = s.subs || [];
    const own = r.works?.[s.id] || '';
    if (!subs.length) return [{ key: s.id, name: null, text: own }];
    const parts = subs.map(sb => ({ key: subKey(s.id, sb.id), name: sb.name, text: r.works?.[subKey(s.id, sb.id)] || '' }));
    // 구분을 만들기 전에 쓴 글이 있으면 사라지지 않도록 '기타' 칸으로 보여준다
    if (own.trim()) parts.push({ key: s.id, name: '기타', text: own });
    return parts;
  }
  // 구분별 글을 하나로 합친 글 (검색·점검·엑셀용): [DKS] ... [DKCM] ...
  function worksText(r, s) {
    const parts = workParts(r, s);
    if (parts.length === 1 && !parts[0].name) return parts[0].text;
    return parts.filter(p => p.text.trim()).map(p => `[${p.name}]\n${p.text.replace(/\s+$/, '')}`).join('\n');
  }

  function siteHasData(r, sid) {
    const st = r.stats[sid] || {};
    const has = (k, key) => !!(r[k]?.[key] || '').trim();
    return COLS.some(c => st[c.key]) || KINDS.some(k => has(k, sid)) || Object.keys(r.works || {}).some(key => key.startsWith(sid + ':') && has('works', key));
  }

  const fail = msg => { throw new Error(msg); };
  const name = v => (typeof v === 'string' && v.trim()) || fail('이름이 비어 있습니다.');
  function swap(arr, i, j) { if (arr[i] && arr[j]) [arr[i], arr[j]] = [arr[j], arr[i]]; }

  // 사업장 칸을 고치는 작업 (sid 가 "사업장id" 또는 "사업장id:세부구분id")
  const SITE_WRITE = ['report.cell', 'report.text', 'report.done'];
  // 관리자이거나 그 사업장의 담당자면 작성 가능
  function canEditSite(db, who, sid) {
    if (who.role === 'admin') return true;
    const s = db.sites.find(x => x.id === String(sid || '').split(':')[0]);
    return !!s && (s.assignees || []).includes(who.empNo);
  }

  // db를 직접 변경한다. 검증 실패 시 Error를 던진다.
  function apply(db, op) {
    const rep = () => db.reports.find(x => x.id === op.id) || fail('보고서를 찾을 수 없습니다. (다른 사용자가 삭제했을 수 있음)');
    const grp = () => db.groups.find(x => x.id === op.id) || fail('회사를 찾을 수 없습니다.');
    const site = () => db.sites.find(x => x.id === op.id) || fail('사업장을 찾을 수 없습니다.');
    const touch = r => { r.updated = op.ts || Date.now(); if (op.by) r.updatedBy = op.by; };
    if (LOCKED_BLOCKS.includes(op.type)) {
      const r = db.reports.find(x => x.id === op.id);
      if (r?.locked) fail('확정된 보고서는 수정할 수 없습니다. 관리자가 확정을 해제해야 합니다.');
    }
    // 사업장별 작성 권한: 관리자가 아니면 담당자로 지정된 사업장만 작성할 수 있다 (op.role·op.empNo 는 서버가 채움)
    if (SITE_WRITE.includes(op.type) && !canEditSite(db, op, op.sid)) {
      fail('담당 사업장만 작성할 수 있습니다. 담당자 지정은 관리자에게 요청하세요.');
    }
    // 사업장·회사 관리(담당자 지정 포함)는 관리자만
    if (/^(site|group)\./.test(op.type) && op.role !== 'admin') fail('사업장 관리는 관리자만 할 수 있습니다.');
    // 보고서 삭제 · 보고일과 기간 변경 · 기본 정보 설정은 관리자만
    if (['report.delete', 'report.date', 'report.period', 'settings.set'].includes(op.type) && op.role !== 'admin') fail('관리자만 할 수 있습니다.');
    if (['report.create', 'itoa.create', 'group.add', 'site.add'].includes(op.type) && !isId(op.id)) fail('id 형식이 올바르지 않습니다.');
    // ITOA 부문: 담당자 지정·사업장 관리는 관리자만, 작성은 관리자·ITOA 담당자 (사업장 칸은 그 사업장 담당자도)
    const itoa = () => normalizeItoa(db).itoa;
    const irep = () => itoa().reports.find(x => x.id === op.id) || fail('ITOA 보고서를 찾을 수 없습니다. (다른 사용자가 삭제했을 수 있음)');
    if (/^itoa\.(assign|group\.|site\.)/.test(op.type) && op.role !== 'admin') fail('ITOA 담당자 지정과 사업장 관리는 관리자만 할 수 있습니다.');
    if (op.type === 'itoa.done' && op.role !== 'admin') fail('ITOA 전체 현황의 완료 표시는 관리자만 할 수 있습니다.');
    if (op.type === 'itoa.remind' && op.role !== 'admin') fail('독촉 메일은 관리자만 보낼 수 있습니다.');
    if (/^itoa\.(set|delete)$/.test(op.type) && !canEditItoa(db, op)) fail('ITOA 주간보고는 관리자와 ITOA 담당자만 작성할 수 있습니다.');
    if (op.type === 'itoa.create' && !canEditItoa(db, op) && !itoa().sites.some(s => (s.assignees || []).includes(op.empNo))) fail('ITOA 주간보고는 관리자와 ITOA 담당자만 만들 수 있습니다.');
    if (['itoa.text', 'itoa.cnt', 'itoa.att', 'itoa.v3', 'itoa.ssign'].includes(op.type) && !canEditItoaSite(db, op, op.sid)) fail('담당 사업장만 작성할 수 있습니다. 담당자 지정은 관리자에게 요청하세요.');
    // ITOA 회사·사업장 관리: 네트워크부문과 같은 작업을 ITOA 목록에 적용
    if (/^itoa\.(group|site)\./.test(op.type)) {
      const it = itoa(), sub = { groups: it.groups, sites: it.sites, reports: [] };
      apply(sub, { ...op, type: op.type.slice(5) });
      it.groups = sub.groups; it.sites = sub.sites;
      if (op.type === 'itoa.site.delete') it.reports.forEach(r => { ITOA_KINDS.forEach(k => { if (r[k]) delete r[k][op.id]; }); if (r.cnt) delete r.cnt[op.id]; if (r.atts) delete r.atts[op.id]; if (r.v3s) delete r.v3s[op.id]; if (r.siteSign) delete r.siteSign[op.id]; });
      return;
    }

    switch (op.type) {
      case 'settings.set':
        if (!SETTING_KEYS.includes(op.key)) fail('알 수 없는 설정');
        db.settings[op.key] = op.value;
        break;

      case 'report.create': {
        if (!isDate(op.date)) fail('보고일이 올바르지 않습니다.');
        if (db.reports.some(r => r.date === op.date)) fail(`${op.date} 보고서가 이미 있습니다.`);
        if (db.reports.some(r => r.id === op.id)) fail('이미 있는 보고서 id 입니다.');
        const r = { id: op.id, date: op.date, start: addDays(op.date, -7), end: addDays(op.date, -1), stats: {}, works: {}, issues: {} };
        touch(r); db.reports.push(r);
        break;
      }
      case 'report.date': {
        const r = rep();
        if (!isDate(op.value)) fail('보고일이 올바르지 않습니다.');
        if (db.reports.some(x => x.id !== r.id && x.date === op.value)) fail('해당 보고일의 보고서가 이미 있습니다.');
        r.date = op.value; r.start = addDays(op.value, -7); r.end = addDays(op.value, -1); touch(r);
        break;
      }
      case 'report.period': {
        const r = rep();
        if (!['start', 'end'].includes(op.field) || !isDate(op.value)) fail('기간이 올바르지 않습니다.');
        r[op.field] = op.value; touch(r);
        break;
      }
      case 'report.cell': {
        const r = rep();
        if (!COLS.some(c => c.key === op.col)) fail('알 수 없는 항목');
        (r.stats[op.sid] ||= {})[op.col] = op.value === '' ? '' : Math.max(0, Number(op.value) || 0);
        touch(r);
        break;
      }
      case 'report.text': {
        const r = rep();
        if (!KINDS.includes(op.kind)) fail('알 수 없는 항목');
        (r[op.kind] ||= {})[op.sid] = String(op.value ?? ''); touch(r);
        break;
      }
      case 'report.done': {
        // 전체 현황의 사업장별 작성 완료 표시
        const r = rep();
        r.done ||= {};
        if (op.value) r.done[op.sid] = { by: op.by || '', at: op.ts || Date.now() };
        else delete r.done[op.sid];
        break;
      }
      case 'report.remind': {
        // 독촉 메일 보낸 기록 (서버가 메일을 보낸 뒤 남김, 관리자만)
        if (op.role !== 'admin') fail('독촉 메일은 관리자만 보낼 수 있습니다.');
        const r = rep();
        r.reminded ||= {};
        for (const sid of op.sids || []) {
          const prev = r.reminded[sid];
          r.reminded[sid] = { at: op.ts || Date.now(), by: op.by || '', count: (prev?.count || 0) + 1 };
        }
        break;
      }
      case 'report.lock': {
        // 확정과 확정 해제 모두 관리자만
        const r = rep();
        if (op.role !== 'admin') fail('보고서 확정과 해제는 관리자만 할 수 있습니다.');
        if (op.value) r.locked = { by: op.by || '', at: op.ts || Date.now() };
        else delete r.locked;
        break;
      }
      case 'report.delete':
        rep();
        db.reports = db.reports.filter(x => x.id !== op.id);
        break;

      case 'group.add':
        if (db.groups.some(g => g.name === name(op.name).trim())) fail('같은 이름의 회사가 있습니다.');
        db.groups.push({ id: op.id, name: op.name.trim() });
        break;
      case 'group.rename': grp().name = name(op.name).trim(); break;
      case 'group.move': {
        const i = db.groups.indexOf(grp());
        swap(db.groups, i, i + (op.dir < 0 ? -1 : 1));
        break;
      }
      case 'group.delete':
        grp();
        if (db.sites.some(s => s.groupId === op.id)) fail('사업장이 남아 있는 회사는 삭제할 수 없습니다.');
        db.groups = db.groups.filter(g => g.id !== op.id);
        break;

      case 'site.add':
        if (!db.groups.some(g => g.id === op.groupId)) fail('회사를 찾을 수 없습니다.');
        if (db.sites.some(s => s.groupId === op.groupId && s.name === name(op.name).trim())) fail('같은 이름의 사업장이 있습니다.');
        db.sites.push({ id: op.id, groupId: op.groupId, name: op.name.trim(), active: true });
        break;
      case 'site.rename': site().name = name(op.name).trim(); break;
      case 'site.active': site().active = !!op.value; break;
      case 'site.subs': {
        // 세부 구분 목록 [{ id, name }]
        const s = site(), names = new Set();
        s.subs = (op.subs || []).map(x => ({ id: String(x.id || uid()), name: String(x.name || '').trim().slice(0, 20) })).filter(x => x.name && !names.has(x.name) && names.add(x.name)).slice(0, 10);
        break;
      }
      case 'site.assign': {
        // 사업장 담당자 (사번 목록)
        const s = site();
        s.assignees = [...new Set((op.empNos || []).map(String).filter(Boolean))].slice(0, 20);
        break;
      }
      case 'site.move': {
        const s = site();
        const same = db.sites.map((x, i) => [x, i]).filter(([x]) => x.groupId === s.groupId);
        const k = same.findIndex(([x]) => x === s), t = same[k + (op.dir < 0 ? -1 : 1)];
        if (t) swap(db.sites, same[k][1], t[1]);
        break;
      }
      case 'site.regroup': {
        const s = site();
        if (!db.groups.some(g => g.id === op.groupId)) fail('회사를 찾을 수 없습니다.');
        db.sites.splice(db.sites.indexOf(s), 1);
        s.groupId = op.groupId;
        db.sites.push(s);
        break;
      }
      case 'site.delete':
        site();
        db.sites = db.sites.filter(s => s.id !== op.id);
        db.reports.forEach(r => {
          delete r.stats[op.id];
          KINDS.forEach(k => { if (r[k]) delete r[k][op.id]; });
          for (const key of Object.keys(r.works || {})) if (key.startsWith(op.id + ':')) delete r.works[key];
        });
        break;

      case 'itoa.create': {
        // 주간 = 시작일 ~ 종료일(7일), 같은 종료일 보고서는 하나만
        if (!isDate(op.end)) fail('기간이 올바르지 않습니다.');
        if (itoa().reports.some(r => r.end === op.end)) fail('해당 주의 ITOA 보고서가 이미 있습니다.');
        if (itoa().reports.some(r => r.id === op.id)) fail('이미 있는 보고서 id 입니다.');
        const prev = itoa().reports.slice().sort((a, b) => a.end.localeCompare(b.end)).pop();
        const r = { id: op.id, start: addDays(op.end, -6), end: op.end, site: prev?.site || '동국제강그룹 전체', manager: op.by || prev?.manager || '', sign: { ...(prev?.sign || {}) }, rows: {}, cnt: {}, v3s: {}, atts: {}, general: {}, special: {}, plans: {} };
        touch(r); itoa().reports.push(r);
        break;
      }
      case 'itoa.set': {
        const r = irep(), p = String(op.path || '');
        if (p === 'start' || p === 'end') {
          if (!isDate(op.value)) fail('기간이 올바르지 않습니다.');
          if (p === 'end' && itoa().reports.some(x => x.id !== r.id && x.end === op.value)) fail('해당 주의 ITOA 보고서가 이미 있습니다.');
          r[p] = op.value;
        } else {
          if (!ITOA_NUM.has(p) && !ITOA_TEXT.has(p)) fail('알 수 없는 항목');
          const keys = p.split('.'), last = keys.pop();
          let o = r;
          for (const k of keys) o = (o[k] ||= {});
          o[last] = ITOA_NUM.has(p) ? (op.value === '' || op.value == null ? '' : Math.max(0, Math.floor(Number(op.value)) || 0)) : String(op.value ?? '').slice(0, 5000);
        }
        touch(r);
        break;
      }
      case 'itoa.sign': {
        // 결재란 손글씨 서명 (PNG). ITOA 부문을 볼 수 있는 사람은 서명할 수 있고, 남의 서명은 본인·관리자만 바꾸거나 지운다
        const r = irep();
        if (!['staff', 'lead', 'pm'].includes(op.slot)) fail('알 수 없는 결재란');
        const prev = r.signImg?.[op.slot];
        if (prev && prev.empNo !== op.empNo && op.role !== 'admin') fail(`${prev.by}님의 서명은 본인이나 관리자만 바꾸거나 지울 수 있습니다.`);
        if (!op.value) { if (r.signImg) delete r.signImg[op.slot]; }
        else {
          if (typeof op.value !== 'string' || op.value.length > 200000 || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(op.value)) fail('서명 이미지가 올바르지 않습니다.');
          (r.signImg ||= {})[op.slot] = { img: op.value, by: op.by || '', empNo: op.empNo || '', at: op.ts || Date.now() };
        }
        touch(r);
        break;
      }
      case 'itoa.cnt': {
        // 사업장별 처리 실적 (완료 · 지연 완료 건수, 지연 완료 사유 · 비고)
        const r = irep();
        if (!ITOA_ROWS.some(x => x.key === op.cat) || !['done', 'late', 'reason', 'note'].includes(op.field)) fail('알 수 없는 항목');
        const c = ((r.cnt ||= {})[String(op.sid)] ||= {});
        (c[op.cat] ||= {})[op.field] = ['reason', 'note'].includes(op.field) ? String(op.value ?? '').slice(0, 1000)
          : op.value === '' || op.value == null ? '' : Math.max(0, Math.floor(Number(op.value)) || 0);
        touch(r);
        break;
      }
      case 'itoa.ssign': {
        // 사업장 담당자 보고서의 결재란 서명 (담당 · 팀장). 남의 서명은 본인 · 관리자만 바꾸거나 지운다
        const r = irep(), sid = String(op.sid);
        if (!['staff', 'lead'].includes(op.slot)) fail('알 수 없는 결재란');
        const prev = r.siteSign?.[sid]?.[op.slot];
        if (prev && prev.empNo !== op.empNo && op.role !== 'admin') fail(`${prev.by}님의 서명은 본인이나 관리자만 바꾸거나 지울 수 있습니다.`);
        if (!op.value) { if (r.siteSign?.[sid]) delete r.siteSign[sid][op.slot]; }
        else {
          if (typeof op.value !== 'string' || op.value.length > 200000 || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(op.value)) fail('서명 이미지가 올바르지 않습니다.');
          ((r.siteSign ||= {})[sid] ||= {})[op.slot] = { img: op.value, by: op.by || '', empNo: op.empNo || '', at: op.ts || Date.now() };
        }
        // 담당 · 팀장 서명이 모두 있으면 전체 현황에서 자동 완료, 서명이 빠지면 자동 완료만 해제 (관리자가 표시한 완료는 유지)
        const both = r.siteSign?.[sid]?.staff && r.siteSign?.[sid]?.lead;
        r.done ||= {};
        if (both && !r.done[sid]) r.done[sid] = { by: op.by || '', at: op.ts || Date.now(), auto: true };
        else if (!both && r.done[sid]?.auto) delete r.done[sid];
        touch(r);
        break;
      }
      case 'itoa.v3': {
        // 사업장별 V3 백신 운영 현황
        const r = irep();
        if (![...ITOA_V3_NUM, ...ITOA_V3_TEXT].includes(op.field)) fail('알 수 없는 항목');
        const a = ((r.v3s ||= {})[String(op.sid)] ||= {});
        a[op.field] = ITOA_V3_TEXT.includes(op.field) ? String(op.value ?? '').slice(0, 1000) : op.value === '' || op.value == null ? '' : Math.max(0, Math.floor(Number(op.value)) || 0);
        touch(r);
        break;
      }
      case 'itoa.att': {
        // 사업장별 근무 현황
        const r = irep();
        if (![...ITOA_ATT_NUM, ...ITOA_ATT_TEXT].includes(op.field)) fail('알 수 없는 항목');
        const a = ((r.atts ||= {})[String(op.sid)] ||= {});
        a[op.field] = ITOA_ATT_NUM.includes(op.field) ? (op.value === '' || op.value == null ? '' : Math.max(0, Math.floor(Number(op.value)) || 0)) : String(op.value ?? '').slice(0, 1000);
        touch(r);
        break;
      }
      case 'itoa.text': {
        const r = irep();
        if (!ITOA_KINDS.includes(op.kind)) fail('알 수 없는 항목');
        (r[op.kind] ||= {})[String(op.sid)] = String(op.value ?? '').slice(0, 5000);
        touch(r);
        break;
      }
      case 'itoa.remind': {
        // 독촉 메일 보낸 기록 (서버가 메일을 보낸 뒤 남김)
        const r = irep();
        r.reminded ||= {};
        for (const sid of op.sids || []) {
          const prev = r.reminded[sid];
          r.reminded[sid] = { at: op.ts || Date.now(), by: op.by || '', count: (prev?.count || 0) + 1 };
        }
        break;
      }
      case 'itoa.done': {
        // 전체 현황의 사업장별 완료 표시
        const r = irep();
        r.done ||= {};
        if (op.value) r.done[String(op.sid)] = { by: op.by || '', at: op.ts || Date.now() };
        else delete r.done[String(op.sid)];
        break;
      }
      case 'itoa.delete':
        irep();
        db.itoa.reports = db.itoa.reports.filter(x => x.id !== op.id);
        break;
      case 'itoa.assign':
        itoa().assignees = [...new Set((op.empNos || []).map(String).filter(Boolean))].slice(0, 20);
        break;

      case 'import': {
        const d = op.data || {};
        if (!Array.isArray(d.groups) || !Array.isArray(d.sites) || !Array.isArray(d.reports)) fail('형식이 올바르지 않습니다.');
        db.settings = { ...seed().settings, ...(d.settings || {}) };
        db.groups = d.groups; db.sites = d.sites; db.reports = d.reports;
        // 예전 백업 파일에는 ITOA 데이터가 없으므로 있을 때만 바꾼다
        if (d.itoa && Array.isArray(d.itoa.reports)) { db.itoa = d.itoa; normalizeItoa(db); }
        break;
      }
      default:
        fail('알 수 없는 작업: ' + op.type);
    }
  }

  const api = { COLS, KINDS, ITOA_ROWS, uid, toISO, addDays, seed, siteHasData, workParts, worksText, subKey, canEditSite, canEditItoa, canEditItoaSite, itoaSiteLabel, normalizeItoa, itoaLines, itoaAttRows, itoaAttTotal, itoaV3, itoaSiteMissing, itoaView, itoaSitesView, ITOA_KINDS, itoaRate, itoaRowSum, itoaRowText, itoaTotals, apply };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Ops = api;
})(this);
