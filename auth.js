// 사용자 계정 / 로그인 세션 (data/users.json, data/sessions.json)
// 비밀번호는 scrypt 해시로만 저장한다. 로그인 ID 는 메일 주소, 초기 비밀번호 = 메일 주소 @ 앞부분, 첫 로그인 시 변경 필요.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SESSION_TTL = 7 * 24 * 3600 * 1000;      // 마지막 사용 후 7일
const LOCK_LIMIT = 5, LOCK_MS = 5 * 60 * 1000;  // 5회 실패 시 5분 잠금
const MIN_PW = 6;

function createAuth(dataDir) {
  const USERS_FILE = path.join(dataDir, 'users.json');
  const SESS_FILE = path.join(dataDir, 'sessions.json');

  const readJSON = (file, fallback) => {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {
      if (e.code === 'ENOENT') return fallback;
      console.error(`읽을 수 없습니다: ${file}\n${e.message}`);
      process.exit(1);
    }
  };
  const writeJSON = (file, obj) => { fs.writeFileSync(file + '.tmp', JSON.stringify(obj, null, 1)); fs.renameSync(file + '.tmp', file); };

  let users = readJSON(USERS_FILE, []);
  let sessions = readJSON(SESS_FILE, {});
  const fails = new Map();   // 로그인 ID(메일) → { count, until }

  const saveUsers = () => writeJSON(USERS_FILE, users);
  let sessTimer = null;
  const saveSessions = () => { clearTimeout(sessTimer); sessTimer = setTimeout(() => writeJSON(SESS_FILE, sessions), 1000); };

  const hash = (pw, salt) => crypto.scryptSync(String(pw), salt, 32).toString('hex');
  function setPassword(u, pw, mustChange) {
    u.salt = crypto.randomBytes(16).toString('hex');
    u.hash = hash(pw, u.salt);
    u.mustChange = mustChange;
  }
  function checkPassword(u, pw) {
    const a = Buffer.from(hash(pw, u.salt), 'hex'), b = Buffer.from(u.hash, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  // empNo 는 내부 ID(담당자 지정·프로필 사진 파일명에 사용). 로그인과 화면 표시는 메일 주소(email)로 한다.
  const find = empNo => users.find(u => u.empNo === String(empNo || '').trim());
  const normEmail = v => String(v || '').trim().toLowerCase();
  // 로그인 ID: 메일 주소. 아직 메일을 등록하지 않은 기존 계정은 예전 사번으로도 로그인할 수 있다.
  const findLogin = id => { const e = normEmail(id); return users.find(u => u.email === e) || users.find(u => !u.email && u.empNo === String(id || '').trim()); };
  // 초기 비밀번호 = 메일 주소 @ 앞부분 (메일이 없는 기존 계정은 사번)
  const initialPw = u => u.email ? u.email.split('@')[0] : u.empNo;
  // 인터넷에 공개하는 서버(RANDOM_INITIAL_PW=1): 새 계정 · 비밀번호 초기화 때 무작위 임시 비밀번호를 만들어 관리자에게 한 번만 보여 준다
  const RANDOM_INITIAL = process.env.RANDOM_INITIAL_PW === '1';
  const tempPw = () => crypto.randomBytes(12).toString('base64').replace(/[+/=]/g, '').slice(0, 10);
  // 임시 비밀번호를 정하고 그 값을 돌려준다 (처음 로그인할 때 바꾸게 함)
  function startPassword(u) { const pw = RANDOM_INITIAL ? tempPw() : initialPw(u); setPassword(u, pw, true); return pw; }
  // 부문: 정하지 않은 계정은 관리자 = 둘 다, 일반 = 네트워크부문
  const deptOf = u => u.dept || (u.role === 'admin' ? 'all' : 'net');
  const deptsOf = u => (deptOf(u) === 'all' ? ['net', 'itoa'] : [deptOf(u)]);
  const pub = u => u && ({ empNo: u.empNo, email: u.email || '', name: u.name, role: u.role, dept: deptOf(u), active: u.active, mustChange: !!u.mustChange, lastLogin: u.lastLogin || null, created: u.created, avatar: u.avatar || null });

  // 프로필 사진: data/avatars/<내부ID>.<확장자>, u.avatar = 버전(저장 시각)
  const AVATAR_DIR = path.join(dataDir, 'avatars');
  const AVATAR_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
  const MAX_AVATAR = 512 * 1024;
  const avatarFiles = empNo => Object.values(AVATAR_TYPES).map(ext => path.join(AVATAR_DIR, `${empNo}.${ext}`));
  const removeAvatarFiles = empNo => avatarFiles(empNo).forEach(f => fs.rmSync(f, { force: true }));
  const fail = msg => { const e = new Error(msg); e.status = 400; throw e; };
  const cleanName = v => { const s = String(v || '').trim().slice(0, 20); if (!s) fail('이름을 입력하세요.'); return s; };
  // 메일 주소 확인 + 다른 계정과 중복 확인
  function cleanEmail(v, exceptEmpNo) {
    const e = normEmail(v);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) || e.length > 100) fail('메일 주소 형식이 올바르지 않습니다.');
    if (users.some(u => u.email === e && u.empNo !== exceptEmpNo)) fail('이미 등록된 메일 주소입니다.');
    return e;
  }
  // 새 계정의 내부 ID
  const newId = () => { let id; do { id = 'u' + crypto.randomBytes(5).toString('hex'); } while (find(id)); return id; };

  // 부문: net(네트워크부문) · itoa(ITOA) · all(둘 다)
  const DEPTS = ['net', 'itoa', 'all'];
  const cleanDept = v => (DEPTS.includes(v) ? v : 'net');
  function addUser(email, name, role, dept) {
    const u = { empNo: newId(), email: cleanEmail(email), name: cleanName(name), role: role === 'admin' ? 'admin' : 'user', dept: cleanDept(dept), active: true, created: Date.now() };
    const pw = startPassword(u);
    users.push(u);
    saveUsers();
    return { user: u, tempPassword: RANDOM_INITIAL ? pw : null };
  }

  // ---- 세션 ----
  // 창(탭)마다 자기 로그인 토큰을 X-OW-Session 헤더로 보낸다. 그래서 같은 브라우저의 창 두 개에서
  // 서로 다른 사람으로 로그인하거나 한쪽만 로그아웃해도 다른 창은 영향을 받지 않는다.
  // 쿠키는 "이 브라우저에서 마지막으로 로그인한 계정"만 기억하며, 새 창의 로그인 화면에서
  // [○○○으로 계속하기] 버튼에만 쓰인다 (새 창이 몰래 다른 사람으로 열리지 않도록).
  function parseCookie(req) {
    const m = /(?:^|;\s*)ow_sid=([a-f0-9]{64})/.exec(req.headers.cookie || '');
    return m ? m[1] : null;
  }
  const headerToken = req => { const t = String(req.headers['x-ow-session'] || ''); return /^[a-f0-9]{64}$/.test(t) ? t : null; };
  const newSession = empNo => { const tok = crypto.randomBytes(32).toString('hex'); sessions[tok] = { empNo, seen: Date.now() }; saveSessions(); return tok; };
  function userOfToken(tok) {
    const s = tok && sessions[tok];
    if (!s) return null;
    const u = find(s.empNo);
    if (!u || !u.active || Date.now() - s.seen > SESSION_TTL) { delete sessions[tok]; saveSessions(); return null; }
    if (Date.now() - s.seen > 60000) { s.seen = Date.now(); saveSessions(); }
    return u;
  }
  // 이 창의 로그인 사용자 (창 토큰 기준)
  const sessionUser = req => userOfToken(headerToken(req));
  // 이 브라우저의 마지막 로그인 사용자 (쿠키 기준)
  const cookieUser = req => userOfToken(parseCookie(req));
  // HTTPS 로만 접속하는 서버(COOKIE_SECURE=1)는 쿠키를 암호화된 연결에서만 보내게 한다
  const cookie = (tok, maxAge) => `ow_sid=${tok}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${process.env.COOKIE_SECURE === '1' ? '; Secure' : ''}`;

  // ---- 처리 함수 (server.js에서 호출) ----
  return {
    sessionUser,
    pub,
    needSetup: () => users.length === 0,

    setup(body) {
      if (users.length) fail('이미 관리자 계정이 있습니다.');
      // 첫 관리자는 설정 화면에서 바로 비밀번호를 바꾸므로 메일 주소 @ 앞부분으로 시작
      const { user: u } = addUser(body.email, body.name, 'admin');
      setPassword(u, initialPw(u), true);
      saveUsers();
      return u;
    },

    login(body) {
      const id = normEmail(body.email);
      const f = fails.get(id);
      if (f && f.until > Date.now()) fail(`로그인 시도가 너무 많습니다. ${Math.ceil((f.until - Date.now()) / 60000)}분 후 다시 시도하세요.`);
      const u = findLogin(body.email);
      if (!u || !u.active || !checkPassword(u, body.password || '')) {
        // 잠금이 풀린 뒤에는 횟수를 새로 센다
        const n = (f && !(f.until && f.until <= Date.now()) ? f.count : 0) + 1;
        fails.set(id, { count: n, until: n >= LOCK_LIMIT ? Date.now() + LOCK_MS : 0 });
        fail(u && !u.active ? '사용이 중지된 계정입니다. 관리자에게 문의하세요.' : '메일 주소 또는 비밀번호가 올바르지 않습니다.');
      }
      // 공개 서버에서는 추측하기 쉬운 예전 초기 비밀번호(메일 주소 @ 앞부분)로 로그인할 수 없다
      // (처음 만든 관리자 한 명뿐일 때는 설정 화면 흐름을 위해 허용)
      if (RANDOM_INITIAL && u.mustChange && users.length > 1 && String(body.password) === initialPw(u)) fail('보안을 위해 예전 초기 비밀번호로는 로그인할 수 없습니다. 관리자에게 비밀번호 초기화를 요청하세요.');
      fails.delete(id);
      u.lastLogin = Date.now();
      saveUsers();
      // 창 토큰과 쿠키 토큰은 따로 발급한다
      return { user: u, token: newSession(u.empNo), setCookie: cookie(newSession(u.empNo), SESSION_TTL / 1000) };
    },

    // 이 창만 로그아웃. 쿠키가 같은 사람이면 [계속하기]에도 다시 뜨지 않도록 쿠키도 지운다.
    // 다른 창들은 각자의 토큰을 쓰므로 그대로 로그인 상태가 유지된다.
    logout(req) {
      const tok = headerToken(req), mine = tok && sessions[tok];
      if (mine) delete sessions[tok];
      const ctok = parseCookie(req), c = ctok && sessions[ctok];
      let setCookie = null;
      if (c && (!mine || c.empNo === mine.empNo)) { delete sessions[ctok]; setCookie = cookie('', 0); }
      saveSessions();
      return setCookie;
    },

    // [○○○으로 계속하기]: 쿠키의 계정으로 이 창 전용 토큰을 새로 발급
    fork(req) {
      const u = cookieUser(req);
      if (!u) { const e = new Error('이전 로그인 정보가 없습니다. 다시 로그인하세요.'); e.status = 401; throw e; }
      return { user: u, token: newSession(u.empNo) };
    },
    cookieUser,
    userOfToken,

    changePassword(u, body) {
      if (!checkPassword(u, body.current || '')) fail('현재 비밀번호가 올바르지 않습니다.');
      const next = String(body.next || '');
      if (next.length < MIN_PW) fail(`새 비밀번호는 ${MIN_PW}자 이상이어야 합니다.`);
      if (next === initialPw(u) || next === u.empNo || (u.email && next === u.email)) fail('초기 비밀번호(메일 주소 @ 앞부분)와 같은 비밀번호는 사용할 수 없습니다.');
      setPassword(u, next, false);
      saveUsers();
    },

    list: () => users.map(pub),
    deptsOf,
    randomInitial: RANDOM_INITIAL,

    // 본인 또는 관리자만. dataUrl 이 비어 있으면 사진 삭제
    setAvatar(me, empNo, dataUrl) {
      const u = find(empNo || me.empNo) || fail('사용자를 찾을 수 없습니다.');
      if (u.empNo !== me.empNo && me.role !== 'admin') { const e = new Error('본인 사진만 바꿀 수 있습니다.'); e.status = 403; throw e; }
      removeAvatarFiles(u.empNo);
      if (dataUrl) {
        const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl));
        if (!m) fail('PNG, JPG, WEBP 이미지만 사용할 수 있습니다.');
        const buf = Buffer.from(m[2], 'base64');
        if (buf.length > MAX_AVATAR) fail('이미지가 너무 큽니다.');
        fs.mkdirSync(AVATAR_DIR, { recursive: true });
        fs.writeFileSync(path.join(AVATAR_DIR, `${u.empNo}.${AVATAR_TYPES[m[1]]}`), buf);
        u.avatar = Date.now();
      } else {
        delete u.avatar;
      }
      saveUsers();
      return u;
    },
    avatarFile(empNo) {
      const u = find(empNo);
      if (!u || !u.avatar) return null;
      return avatarFiles(u.empNo).find(f => fs.existsSync(f)) || null;
    },

    // 관리자 전용 사용자 관리
    admin(me, body) {
      if (body.action === 'add') return addUser(body.email, body.name, body.role, body.dept);
      let tempPassword = null;
      const u = find(body.empNo) || fail('사용자를 찾을 수 없습니다.');
      const self = u.empNo === me.empNo;
      switch (body.action) {
        case 'rename': u.name = cleanName(body.name); break;
        case 'reset': { const pw = startPassword(u); if (RANDOM_INITIAL) tempPassword = pw; break; }
        // 메일 주소 등록·변경 (기존 사번 계정은 이걸로 메일 로그인으로 바뀐다)
        case 'email': u.email = cleanEmail(body.email, u.empNo); break;
        case 'role':
          if (self) fail('자기 자신의 권한은 바꿀 수 없습니다.');
          u.role = body.role === 'admin' ? 'admin' : 'user'; break;
        case 'dept': u.dept = cleanDept(body.dept); break;
        case 'active':
          if (self) fail('자기 자신은 사용 중지할 수 없습니다.');
          u.active = !!body.value;
          if (!u.active) for (const [t, s] of Object.entries(sessions)) if (s.empNo === u.empNo) delete sessions[t];
          break;
        case 'delete':
          if (self) fail('자기 자신은 삭제할 수 없습니다.');
          users = users.filter(x => x !== u);
          removeAvatarFiles(u.empNo);
          for (const [t, s] of Object.entries(sessions)) if (s.empNo === u.empNo) delete sessions[t];
          break;
        default: fail('알 수 없는 작업');
      }
      saveUsers(); saveSessions();
      return { user: u, tempPassword };
    },
  };
}

module.exports = { createAuth };
