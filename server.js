// 주간업무보고 서버  —  실행: node server.js (상시 실행은 supervisor.js)
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const Ops = require('./public/ops.js');
const { buildBuffer: buildPptx } = require('./pptx.js');
const { createAuth } = require('./auth.js');
const { createChecker } = require('./check.js');
const { createMailer } = require('./mailer.js');
const { createBoard } = require('./board.js');
const { ruleGuide } = require('./rules.js');
const { mergeMonth, monthXlsx } = require('./export.js');
const { itoaXlsx, fileName: itoaFileName, siteSheetName } = require('./itoa.js');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, 'data');
const BACKUP_DIR = path.join(DATA_DIR, 'backup');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const MAX_BODY = 20 * 1024 * 1024;

fs.mkdirSync(BACKUP_DIR, { recursive: true });
const auth = createAuth(DATA_DIR);
const checker = createChecker(DATA_DIR);
const mailer = createMailer(DATA_DIR, PORT);
const board = createBoard(DATA_DIR, mailer);

function load() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') {
      // 파일이 깨졌을 때 덮어쓰지 않도록 중단
      console.error(`데이터 파일을 읽을 수 없습니다: ${DB_FILE}\n${e.message}\n백업 폴더(${BACKUP_DIR})의 파일로 복구하세요.`);
      process.exit(1);
    }
    return { version: 1, db: Ops.seed() };
  }
}

let state = load();
// ITOA 데이터를 최신 형식(사업장별 글 항목)으로 맞춘다
Ops.normalizeItoa(state.db);

function save() {
  // 하루 한 번, 덮어쓰기 전 상태를 백업
  const backup = path.join(BACKUP_DIR, `db-${Ops.toISO(new Date())}.json`);
  if (fs.existsSync(DB_FILE) && !fs.existsSync(backup)) fs.copyFileSync(DB_FILE, backup);
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, DB_FILE);
}
if (!fs.existsSync(DB_FILE)) save();

const MIME = { '.jpg': 'image/jpeg', '.webp': 'image/webp', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

function sendJSON(res, code, obj, headers = {}) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('요청이 너무 큽니다.')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}

// 접속자 현황 (메모리에만 보관, 창을 닫으면 즉시, 신호가 70초간 없으면 퇴장 처리)
const PRESENCE_TTL = 70000;
const presence = new Map();
function presenceList() {
  const now = Date.now();
  for (const [k, p] of presence) if (now - p.seen > PRESENCE_TTL) presence.delete(k);
  return [...presence.values()].sort((a, b) => a.since - b.since);
}

// 작업을 적용하고 버전을 올린다. 실패하면 Error(status 409)
function applyOp(op, user) {
  op.ts = Date.now();
  op.by = user.name;
  op.role = user.role;
  op.empNo = user.empNo;   // 사업장 담당자 권한 확인용 (화면이 보낸 값은 무시)
  const next = structuredClone(state.db);
  try { Ops.apply(next, op); } catch (e) { e.status = 409; throw e; }
  state = { version: state.version + 1, db: next };
  save();
  return state.version;
}

const sendFile = (res, name, type, buf) => {
  res.writeHead(200, { 'Content-Type': type, 'Content-Disposition': `attachment; filename="report${path.extname(name)}"; filename*=UTF-8''${encodeURIComponent(name)}`, 'Cache-Control': 'no-store' });
  res.end(buf);
};
const PPTX_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const redirect = (res, to) => { res.writeHead(302, { Location: to, 'Cache-Control': 'no-store' }); res.end(); };
const body = async req => JSON.parse((await readBody(req)) || '{}');

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const P = url.pathname, M = req.method;
  // 기본 보안 헤더: 형식 추측 금지 · 다른 사이트 안에 넣기 금지 · 주소 전달 최소화
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  try {
    const user = auth.sessionUser(req);

    // ---- 로그인 관련 (로그인 없이 접근 가능) ----
    if (P === '/api/auth/info' && M === 'GET') {
      // browserUser: 이 브라우저에서 마지막으로 로그인한 계정 (새 창의 [계속하기] 버튼용, 이름·사번만)
      const bu = !user && auth.cookieUser(req);
      return sendJSON(res, 200, {
        needSetup: auth.needSetup(),
        randomInitialPw: auth.randomInitial,
        user: auth.pub(user),
        browserUser: bu ? { empNo: bu.empNo, email: bu.email || '', name: bu.name } : null,
        stats: { reports: state.db.reports.length, sites: state.db.sites.filter(x => x.active).length, groups: state.db.groups.length },
      });
    }
    if (P === '/api/auth/setup' && M === 'POST') {
      return sendJSON(res, 200, { user: auth.pub(auth.setup(await body(req))) });
    }
    if (P === '/api/auth/login' && M === 'POST') {
      const { user: u, token, setCookie } = auth.login(await body(req));
      return sendJSON(res, 200, { user: auth.pub(u), token }, { 'Set-Cookie': setCookie });
    }
    // 새 창에서 [○○○으로 계속하기]
    if (P === '/api/auth/fork' && M === 'POST') {
      const { user: u, token } = auth.fork(req);
      return sendJSON(res, 200, { user: auth.pub(u), token });
    }
    if (P === '/api/auth/logout' && M === 'POST') {
      const sc = auth.logout(req);
      return sendJSON(res, 200, { ok: true }, sc ? { 'Set-Cookie': sc } : {});
    }
    if (P === '/api/auth/password' && M === 'POST') {
      if (!user) return sendJSON(res, 401, { error: '로그인이 필요합니다.' });
      auth.changePassword(user, await body(req));
      return sendJSON(res, 200, { user: auth.pub(user) });
    }

    // ---- 화면: 메인 페이지는 로그인 필요 ----
    if (M === 'GET' && !P.startsWith('/api/')) {
      // 메인 페이지의 로그인 확인은 화면이 창별 토큰으로 직접 한다
      return serveStatic(req, res, P);
    }

    // ---- 이하 API는 로그인(비밀번호 변경 완료) 필요 ----
    // 창을 닫을 때 보내는 '나감' 신호는 창별 로그인 헤더를 실을 수 없어서 로그인 없이 받는다 (해당 창 번호만 지움)
    if (P === '/api/presence/leave' && M === 'POST') {
      const cid = String((await body(req)).cid || '').slice(0, 40);
      if (cid) presence.delete(cid);
      res.writeHead(204); return res.end();
    }

    // 프로필 사진: <img> 는 헤더를 못 보내므로 주소의 t(창 토큰) 또는 쿠키로 확인
    const am = P.match(/^\/api\/avatar\/([A-Za-z0-9_-]+)$/);
    if (am && M === 'GET') {
      if (!user && !auth.userOfToken(url.searchParams.get('t')) && !auth.cookieUser(req)) return sendJSON(res, 401, { error: '로그인이 필요합니다.' });
      const file = auth.avatarFile(am[1]);
      if (!file) return sendJSON(res, 404, { error: '사진이 없습니다.' });
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'image/' + path.extname(file).slice(1), 'Cache-Control': 'private, max-age=86400' });
      return fs.createReadStream(file).pipe(res);
    }

    // 문의 및 제안 첨부파일: <img> · 링크는 헤더를 못 보내므로 주소의 t(창 토큰)로도 확인
    const bf = P.match(/^\/api\/board\/file\/([a-f0-9]+)\/([a-f0-9]+)$/);
    if (bf && M === 'GET') {
      if (!user && !auth.userOfToken(url.searchParams.get('t'))) return sendJSON(res, 401, { error: '로그인이 필요합니다.' });
      const f = board.file(bf[1], bf[2]);
      if (!f) return sendJSON(res, 404, { error: '파일을 찾을 수 없습니다.' });
      const inline = /^image\//.test(f.type) && !url.searchParams.has('download');
      res.writeHead(200, { 'Content-Type': f.type, 'Content-Length': f.size, 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="file"; filename*=UTF-8''${encodeURIComponent(f.name)}` });
      return fs.createReadStream(f.path).pipe(res);
    }

    if (!user || user.mustChange) return sendJSON(res, 401, { error: '로그인이 필요합니다.' });

    if (P === '/api/avatar' && M === 'POST') {
      const b = await body(req);
      auth.setAvatar(user, b.empNo, b.data);
      return sendJSON(res, 200, { me: auth.pub(user), users: user.role === 'admin' ? auth.list() : undefined });
    }
    if (P === '/api/users') {
      if (user.role !== 'admin') return sendJSON(res, 403, { error: '관리자만 사용할 수 있습니다.' });
      // 공개 서버: 새 계정 · 비밀번호 초기화 때 만든 임시 비밀번호를 관리자에게 한 번만 돌려준다
      const out = M === 'POST' ? auth.admin(user, await body(req)) : null;
      return sendJSON(res, 200, { users: auth.list(), tempPassword: out?.tempPassword || null });
    }
    if (P === '/api/presence' && M === 'POST') {
      const p = await body(req);
      const cid = String(p.cid || '').slice(0, 40);
      if (cid) {
        if (p.leave) presence.delete(cid);
        else presence.set(cid, {
          cid, since: presence.get(cid)?.since || Date.now(), seen: Date.now(),
          name: user.name, empNo: user.empNo, avatar: user.avatar || null,
          view: String(p.view || ''), rid: String(p.rid || ''), field: String(p.field || '').slice(0, 200),
        });
      }
      return sendJSON(res, 200, { presence: presenceList(), me: auth.pub(user) });
    }
    // 부문: 사용자 관리에서 정한 부문의 데이터만 보내고, 다른 부문의 작업·파일은 막는다
    const depts = auth.deptsOf(user);
    const DEPT_DENY = '설정된 부문이 아니어서 열 수 없습니다. 부문은 관리자가 사용자 관리에서 정합니다.';
    if ((/^\/api\/(monthly|report)\//.test(P) && !depts.includes('net')) || (/^\/api\/itoa\//.test(P) && !depts.includes('itoa'))) return sendJSON(res, 403, { error: DEPT_DENY });
    if (P === '/api/state' && M === 'GET') {
      if (url.searchParams.get('v') === String(state.version)) return sendJSON(res, 200, { unchanged: true, version: state.version });
      const db = { ...state.db };
      if (!depts.includes('net')) db.reports = [];
      if (!depts.includes('itoa')) db.itoa = { assignees: [], groups: [], sites: [], reports: [] };
      return sendJSON(res, 200, { version: state.version, db });
    }
    if (P === '/api/op' && M === 'POST') {
      const op = await body(req);
      if (op.type === 'import' && user.role !== 'admin') return sendJSON(res, 403, { error: '데이터 가져오기는 관리자만 할 수 있습니다.' });
      if (!depts.includes(String(op.type || '').startsWith('itoa.') ? 'itoa' : 'net')) return sendJSON(res, 403, { error: DEPT_DENY, version: state.version });
      try { return sendJSON(res, 200, { version: applyOp(op, user) }); } catch (e) { return sendJSON(res, e.status || 500, { error: e.message, version: state.version }); }
    }
    // 담당자 지정 화면에서 쓰는 사용자 목록 (이름·사진만)
    // 문의 및 제안 게시판 (모든 사용자)
    if (P === '/api/board') {
      if (M === 'GET') return sendJSON(res, 200, { posts: board.list(), categories: board.CATEGORIES, statuses: board.STATUSES });
      const result = await board.act(user, await body(req), mailer.status().baseUrl);
      return sendJSON(res, 200, { ...result, posts: board.list() });
    }
    if (P === '/api/users/brief' && M === 'GET') {
      return sendJSON(res, 200, { users: auth.list().filter(u => u.active).map(u => ({ empNo: u.empNo, email: u.email, name: u.name, avatar: u.avatar })) });
    }
    // 백업 목록 · 복원 (관리자)
    if (P === '/api/backups' && M === 'GET') {
      if (user.role !== 'admin') return sendJSON(res, 403, { error: '관리자만 사용할 수 있습니다.' });
      const list = fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.json')).map(f => {
        const st = fs.statSync(path.join(BACKUP_DIR, f));
        return { name: f, size: st.size, mtime: st.mtimeMs };
      }).sort((a, b) => b.mtime - a.mtime);
      return sendJSON(res, 200, { backups: list });
    }
    if (P === '/api/backups/restore' && M === 'POST') {
      if (user.role !== 'admin') return sendJSON(res, 403, { error: '관리자만 사용할 수 있습니다.' });
      const name = String((await body(req)).name || '');
      if (!/^[\w.-]+\.json$/.test(name) || !fs.existsSync(path.join(BACKUP_DIR, name))) return sendJSON(res, 400, { error: '백업 파일을 찾을 수 없습니다.' });
      const raw = JSON.parse(fs.readFileSync(path.join(BACKUP_DIR, name), 'utf8'));
      const db = raw.db || raw;
      if (!Array.isArray(db.groups) || !Array.isArray(db.sites) || !Array.isArray(db.reports)) return sendJSON(res, 400, { error: '백업 파일 형식이 올바르지 않습니다.' });
      // 복원 전 현재 상태를 따로 보관
      const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
      fs.writeFileSync(path.join(BACKUP_DIR, `db-before-restore-${stamp}.json`), JSON.stringify(state));
      state = { version: state.version + 1, db };
      save();
      console.log(`[복원] ${user.name}(${user.empNo}) 이(가) ${name} 으로 복원`);
      return sendJSON(res, 200, { version: state.version });
    }

    // 월간보고: 엑셀 · PPT
    const mm = P.match(/^\/api\/monthly\/(xlsx|pptx)$/);
    if (mm && M === 'GET') {
      const month = url.searchParams.get('month') || '';
      if (!/^\d{4}-\d{2}$/.test(month)) return sendJSON(res, 400, { error: '월을 선택하세요.' });
      const title = `월간업무보고_${month}`;
      if (mm[1] === 'xlsx') return sendFile(res, title + '.xlsx', XLSX_TYPE, await monthXlsx(state.db, month));
      const mg = mergeMonth(state.db, month);
      if (!mg) return sendJSON(res, 404, { error: '해당 월의 주간보고가 없습니다.' });
      const [y, mo] = month.split('-');
      const buf = await buildPptx(state.db, mg.merged, { title: '월간업무보고', dateLabel: `${y}/${mo}`, periodLabel: `${mg.merged.start.slice(5).replace('-', '/')} ~ ${mg.merged.end.slice(5).replace('-', '/')} (주간보고 ${mg.reports.length}건)` });
      return sendFile(res, title + '.pptx', PPTX_TYPE, buf);
    }
    if (P === '/api/check/rules' && M === 'GET') return sendJSON(res, 200, { rules: ruleGuide() });
    // 메일 발송 설정 · 테스트 (관리자)
    if (P === '/api/config/mail' || P === '/api/config/mail/test') {
      if (user.role !== 'admin') return sendJSON(res, 403, { error: '관리자만 사용할 수 있습니다.' });
      if (P.endsWith('/test') && M === 'POST') return sendJSON(res, 200, await mailer.test(user));
      if (M === 'POST') return sendJSON(res, 200, mailer.save(await body(req)));
      return sendJSON(res, 200, mailer.status());
    }
    // 독촉 메일: 미완 사업장 담당자에게 발송하고 기록을 남긴다 (관리자)
    const rm = P.match(/^\/api\/report\/([\w-]+)\/remind$/);
    if (rm && M === 'POST') {
      if (user.role !== 'admin') return sendJSON(res, 403, { error: '독촉 메일은 관리자만 보낼 수 있습니다.' });
      const r = state.db.reports.find(x => x.id === rm[1]);
      if (!r) return sendJSON(res, 404, { error: '보고서를 찾을 수 없습니다.' });
      const { sids } = await body(req);
      const result = await mailer.remind(state.db, r, Array.isArray(sids) ? sids.map(String) : [], auth.list(), user);
      const done = [...new Set(result.sent.flatMap(x => x.sids))];
      const version = done.length ? applyOp({ type: 'report.remind', id: r.id, sids: done }, user) : state.version;
      console.log(`[독촉 메일] ${user.name}: ${result.sent.map(x => x.to).join(', ') || '(보낸 메일 없음)'}`);
      return sendJSON(res, 200, { ...result, version });
    }
    const irm = P.match(/^\/api\/itoa\/([\w-]+)\/remind$/);
    if (irm && M === 'POST') {
      if (user.role !== 'admin') return sendJSON(res, 403, { error: '독촉 메일은 관리자만 보낼 수 있습니다.' });
      const r = (state.db.itoa?.reports || []).find(x => x.id === irm[1]);
      if (!r) return sendJSON(res, 404, { error: 'ITOA 보고서를 찾을 수 없습니다.' });
      const { sids } = await body(req);
      const result = await mailer.remindItoa(state.db, r, Array.isArray(sids) ? sids.map(String) : [], auth.list(), user);
      const done = [...new Set(result.sent.flatMap(x => x.sids))];
      const version = done.length ? applyOp({ type: 'itoa.remind', id: r.id, sids: done }, user) : state.version;
      console.log(`[ITOA 독촉 메일] ${user.name}: ${result.sent.map(x => x.to).join(', ') || '(보낸 메일 없음)'}`);
      return sendJSON(res, 200, { ...result, version });
    }
    // AI 점검 설정 (관리자)
    if (P === '/api/config/ai') {
      if (user.role !== 'admin') return sendJSON(res, 403, { error: '관리자만 사용할 수 있습니다.' });
      if (M === 'POST') return sendJSON(res, 200, checker.setKey((await body(req)).key));
      return sendJSON(res, 200, checker.status());
    }
    // 주간보고 점검: 변경/신규 업무와 장애/이슈 문장을 AI로 교정
    const cm = P.match(/^\/api\/report\/([\w-]+)\/check$/);
    if (cm && M === 'POST') {
      const r = state.db.reports.find(x => x.id === cm[1]);
      if (!r) return sendJSON(res, 404, { error: '보고서를 찾을 수 없습니다.' });
      const KIND = { works: '변경 / 신규 업무', issues: '장애 및 이슈 사항' };
      const entries = [];
      state.db.groups.forEach(g => state.db.sites.filter(x => x.groupId === g.id).forEach(site => {
        for (const p of Ops.workParts(r, site)) {
          if (p.text.trim()) entries.push({ id: String(entries.length + 1), kind: 'works', sid: p.key, label: `${g.name} ${site.name}${p.name ? ' ' + p.name : ''} · ${KIND.works}`, text: p.text });
        }
        for (const kind of ['issues']) {
          const text = r[kind]?.[site.id] || '';
          if (text.trim()) entries.push({ id: String(entries.length + 1), kind, sid: site.id, label: `${g.name} ${site.name} · ${KIND[kind]}`, text });
        }
      }));
      const result = await checker.check(entries);
      const byId = new Map(entries.map(e => [e.id, e]));
      return sendJSON(res, 200, {
        checked: entries.length,
        mode: result.mode,
        warning: result.warning,
        issues: result.issues.map(i => { const e = byId.get(i.id); return { kind: e.kind, sid: e.sid, label: e.label, original: i.original, suggestion: i.suggestion, type: i.type, reason: i.reason }; }),
      });
    }
    // ITOA 주간보고 점검: 글 칸 전체 (관리자는 모든 사업장, 그 외에는 쓸 수 있는 사업장만)
    const icm = P.match(/^\/api\/itoa\/([\w-]+)\/check$/);
    if (icm && M === 'POST') {
      const it = state.db.itoa || {};
      const r = (it.reports || []).find(x => x.id === icm[1]);
      if (!r) return sendJSON(res, 404, { error: 'ITOA 보고서를 찾을 수 없습니다.' });
      const entries = [];
      // kind: general · special · plans (글 항목), cnt · v3 · att (field 가 그 안의 칸)
      const add = (kind, sid, field, label, text) => { if (String(text || '').trim()) entries.push({ id: String(entries.length + 1), kind, sid, field, label, text: String(text) }); };
      const TEXT = { general: '일반 업무 실적', special: '특이 사항', plans: '차주 계획' };
      for (const g of it.groups || []) for (const s of (it.sites || []).filter(x => x.groupId === g.id)) {
        if (user.role !== 'admin' && !Ops.canEditItoaSite(state.db, user, s.id)) continue;
        const L = Ops.itoaSiteLabel(g, s);
        for (const [k, n] of Object.entries(TEXT)) add(k, s.id, '', `${L} · ${n}`, r[k]?.[s.id]);
        for (const x of Ops.ITOA_ROWS) {
          add('cnt', s.id, `${x.key}.reason`, `${L} · 처리 실적 ${x.label} 지연 완료 사유`, r.cnt?.[s.id]?.[x.key]?.reason);
          add('cnt', s.id, `${x.key}.note`, `${L} · 처리 실적 ${x.label} 비고`, r.cnt?.[s.id]?.[x.key]?.note);
        }
        add('v3', s.id, 'note', `${L} · 업데이트 불가 사유`, r.v3s?.[s.id]?.note);
        add('v3', s.id, 'clean', `${L} · 방역 활동 실시`, r.v3s?.[s.id]?.clean);
        for (const [f, n] of [['etcReason', '지각/조퇴 사유'], ['emContent', '긴급 장애 내용'], ['note', '근무 특이 사항']]) add('att', s.id, f, `${L} · ${n}`, r.atts?.[s.id]?.[f]);
      }
      const result = await checker.check(entries);
      const byId = new Map(entries.map(e => [e.id, e]));
      return sendJSON(res, 200, {
        checked: entries.length,
        mode: result.mode,
        warning: result.warning,
        issues: result.issues.map(i => { const e = byId.get(i.id); return { kind: e.kind, sid: e.sid, field: e.field, label: e.label, original: i.original, suggestion: i.suggestion, type: i.type, reason: i.reason }; }),
      });
    }
    // ITOA 주간보고 엑셀
    const im = P.match(/^\/api\/itoa\/([\w-]+)\/xlsx$/);
    if (im && M === 'GET') {
      const r = (state.db.itoa?.reports || []).find(x => x.id === im[1]);
      if (!r) return sendJSON(res, 404, { error: 'ITOA 보고서를 찾을 수 없습니다.' });
      // 관리자가 아니면 자기 담당 사업장 내용만
      const nameOf = e => auth.list().find(u => u.empNo === e)?.name || '';
      const v = Ops.itoaView(state.db, r, user, nameOf);
      // 관리자: 통합주간보고 시트 + 사업장마다 한 시트 (회사_사업장, 사용 중이거나 이 보고서에 내용이 있는 사업장)
      const it = state.db.itoa || {};
      const extra = user.role !== 'admin' ? [] : (it.groups || []).flatMap(g => (it.sites || []).filter(s => s.groupId === g.id)
        .map(s => ({ s, view: Ops.itoaSitesView(state.db, r, [s], nameOf) }))
        .filter(({ s, view }) => s.active || Ops.itoaTotals(view).done || Ops.itoaTotals(view).late || Ops.ITOA_KINDS.some(k => Object.keys(view[k] || {}).length))
        .map(({ s, view }) => ({ name: siteSheetName(g, s), view })));
      return sendFile(res, itoaFileName(v), XLSX_TYPE, await itoaXlsx(state.db, v, extra));
    }
    const pm = P.match(/^\/api\/report\/([\w-]+)\/pptx$/);
    if (pm && M === 'GET') {
      const r = state.db.reports.find(x => x.id === pm[1]);
      if (!r) return sendJSON(res, 404, { error: '보고서를 찾을 수 없습니다.' });
      const buf = await buildPptx(state.db, r);
      const fname = `${state.db.settings.title || '주간업무보고'}_${r.date}.pptx`;
      res.writeHead(200, {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'Content-Disposition': `attachment; filename="weekly_${r.date}.pptx"; filename*=UTF-8''${encodeURIComponent(fname)}`,
        'Cache-Control': 'no-store',
      });
      return res.end(buf);
    }
    sendJSON(res, 404, { error: 'Not found' });
  } catch (e) {
    if (e.status) return sendJSON(res, e.status, { error: e.message });
    if (e instanceof SyntaxError) return sendJSON(res, 400, { error: '잘못된 요청입니다.' });
    console.error(e);
    sendJSON(res, 500, { error: e.message });
  }
});

// HOST: 인터넷 서버에서는 127.0.0.1 로 두고 앞의 HTTPS 프록시(Caddy)만 접속하게 한다
server.listen(PORT, process.env.HOST || '0.0.0.0', () => {
  console.log('주간업무보고 서버 실행 중');
  console.log(`  이 PC:      http://localhost:${PORT}`);
  for (const list of Object.values(os.networkInterfaces()))
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) console.log(`  다른 PC:    http://${a.address}:${PORT}`);
  console.log(`  데이터 파일: ${DB_FILE}`);
  if (auth.needSetup()) console.log('  ※ 등록된 사용자가 없습니다. 브라우저로 접속해 최초 관리자를 등록하세요.');
});
