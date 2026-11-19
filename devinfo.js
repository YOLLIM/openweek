// 개발구성 화면: 사이트 인프라 구성과 서버 실시간 상태 (전산개발담당자만, 별도 비밀번호)
// 주의: 401 은 앱 전체에서 "로그인 만료"로 처리되므로 여기서는 쓰지 않는다 (틀린 비밀번호 · 토큰 만료는 403)
// 비밀번호는 data/devgate.json 에 scrypt 해시로만 저장한다 (공개 저장소에 넣지 않음). 처음 열 때 화면에서 정한다.
// 운영 주소 같은 운영 정보는 코드에 적지 않고 서버 설정(메일 설정의 접속 주소)에서 읽는다.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const LOCK_LIMIT = 5, LOCK_MS = 10 * 60 * 1000;   // 5번 틀리면 10분 잠금
const TOKEN_TTL = 30 * 60 * 1000;                  // 비밀번호 확인 후 30분 (쓰는 동안 연장)

// data 폴더 안 파일 · 폴더와 역할
const DATA_ITEMS = [
  ['db.json', '주간보고 데이터 (네트워크부문 · ITOA 보고서, 사업장, 설정)'],
  ['users.json', '사용자 계정 (비밀번호는 scrypt 해시)'],
  ['sessions.json', '로그인 세션'],
  ['config.json', '메일 발송 설정'],
  ['board.json', '문의 및 제안 게시판 글 · 댓글'],
  ['board', '게시판 첨부파일'],
  ['report-img', '보고서 2 · 3번 칸 그림'],
  ['avatars', '프로필 사진'],
  ['survey.json', '설문조사와 응답'],
  ['stats', '접속 통계 (월별 기록, 13개월 보관)'],
  ['backup', '주간보고 데이터 하루 한 번 자동 백업'],
  ['devgate.json', '개발구성 화면 비밀번호 (해시)'],
];

function createDevInfo({ dataDir, appDir, mailer, counts, ai }) {
  const GATE = path.join(dataDir, 'devgate.json');
  const fail = (msg, status = 400) => { const e = new Error(msg); e.status = status; throw e; };
  const readGate = () => { try { return JSON.parse(fs.readFileSync(GATE, 'utf8')); } catch { return null; } };
  const hash = (pin, salt) => crypto.scryptSync(String(pin), salt, 32).toString('hex');
  const tokens = new Map();   // token → { empNo, until }
  let fails = 0, lockUntil = 0;

  const checkPin = pin => { pin = String(pin ?? ''); if (pin.length < 4 || pin.length > 20) fail('비밀번호는 4~20자로 정해 주세요.'); return pin; };
  const issue = user => {
    for (const [k, v] of tokens) if (v.until < Date.now()) tokens.delete(k);
    const t = crypto.randomBytes(24).toString('hex');
    tokens.set(t, { empNo: user.empNo, until: Date.now() + TOKEN_TTL });
    return t;
  };
  const verify = (user, pin) => {
    const g = readGate();
    if (!g) fail('아직 비밀번호를 정하지 않았습니다.');
    if (lockUntil > Date.now()) fail(`비밀번호를 여러 번 틀려 잠겼습니다. ${Math.ceil((lockUntil - Date.now()) / 60000)}분 뒤에 다시 시도하세요.`, 429);
    const ok = crypto.timingSafeEqual(Buffer.from(hash(pin, g.salt), 'hex'), Buffer.from(g.hash, 'hex'));
    if (!ok) {
      fails++;
      if (fails >= LOCK_LIMIT) { lockUntil = Date.now() + LOCK_MS; fails = 0; console.log(`[개발구성] ${user.name} 비밀번호 ${LOCK_LIMIT}번 틀림 → 10분 잠금`); fail('비밀번호를 여러 번 틀려 10분 동안 잠겼습니다.', 429); }
      fail(`비밀번호가 맞지 않습니다. (${fails}/${LOCK_LIMIT})`, 403);
    }
    fails = 0;
  };
  const setPin = (user, pin) => {
    const salt = crypto.randomBytes(16).toString('hex');
    fs.writeFileSync(GATE + '.tmp', JSON.stringify({ salt, hash: hash(pin, salt), at: Date.now(), by: user.name }));
    fs.renameSync(GATE + '.tmp', GATE);
  };

  // 폴더 크기 · 파일 수 · 마지막 변경
  function measure(p) {
    let size = 0, files = 0, mtime = 0;
    const walk = q => {
      let st; try { st = fs.statSync(q); } catch { return; }
      mtime = Math.max(mtime, st.mtimeMs);
      if (st.isDirectory()) { for (const f of fs.readdirSync(q)) walk(path.join(q, f)); }
      else { size += st.size; files++; }
    };
    walk(p);
    return { size, files, mtime };
  }
  // 배포된 코드 버전 (git 로그 마지막 줄)
  function gitInfo() {
    try {
      const log = fs.readFileSync(path.join(appDir, '.git', 'logs', 'HEAD'), 'utf8').trim().split('\n').pop();
      const m = /^\w+ (\w+) .*? (\d+) [+-]\d{4}\t(.*)$/.exec(log);
      const head = fs.readFileSync(path.join(appDir, '.git', 'HEAD'), 'utf8').trim();
      return m ? { commit: m[1].slice(0, 7), at: Number(m[2]) * 1000, action: m[3], branch: head.replace('ref: refs/heads/', '') } : null;
    } catch { return null; }
  }
  function disk() {
    try { const s = fs.statfsSync(dataDir); return { total: s.blocks * s.bsize, free: s.bavail * s.bsize }; } catch { return null; }
  }
  // 서버 전체 백업 (cron 03:00, /opt/openweek-backup) — 권한이 없으면 확인 불가
  function serverBackups() {
    const dir = process.env.SERVER_BACKUP_DIR || '/opt/openweek-backup';
    try {
      const list = fs.readdirSync(dir).filter(f => /^data-\d{8}\.tgz$/.test(f)).sort();
      const last = list.at(-1), st = last && fs.statSync(path.join(dir, last));
      return { dir, count: list.length, last: last || '', lastAt: st?.mtimeMs || 0, lastSize: st?.size || 0 };
    } catch (e) { return { dir, error: e.code === 'ENOENT' ? '폴더 없음 (이 서버에서는 설정 안 됨)' : e.code === 'EACCES' ? '확인 권한 없음 (백업 전용 계정만 읽을 수 있음)' : e.message }; }
  }

  function info() {
    const m = mailer.status();
    const daily = (() => { try { return fs.readdirSync(path.join(dataDir, 'backup')).filter(f => /^db-.*\.json$/.test(f)).sort(); } catch { return []; } })();
    return {
      now: Date.now(),
      address: m.baseUrl,
      ai: (() => { try { const a = ai(); return { configured: a.configured, model: a.model || '' }; } catch { return null; } })(),
      mail: { configured: m.configured, host: m.host, port: m.port, secure: m.secure, from: m.from },
      server: {
        hostname: os.hostname(), platform: `${os.type()} ${os.release()} (${os.arch()})`, node: process.version,
        cpus: os.cpus().length, memTotal: os.totalmem(), memFree: os.freemem(), rss: process.memoryUsage().rss,
        load: os.loadavg(), osUptime: os.uptime() * 1000, started: Date.now() - process.uptime() * 1000, tz: process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone,
        env: { PORT: process.env.PORT || '3000', HOST: process.env.HOST || '0.0.0.0', NODE_ENV: process.env.NODE_ENV || '', COOKIE_SECURE: process.env.COOKIE_SECURE === '1', RANDOM_INITIAL_PW: process.env.RANDOM_INITIAL_PW === '1' },
        disk: disk(),
      },
      git: gitInfo(),
      data: { dir: dataDir, items: DATA_ITEMS.map(([name, role]) => ({ name, role, ...measure(path.join(dataDir, name)), exists: fs.existsSync(path.join(dataDir, name)) })), total: measure(dataDir) },
      backups: { daily: { count: daily.length, first: daily[0] || '', last: daily.at(-1) || '' }, server: serverBackups() },
      counts: counts(),
    };
  }

  return {
    gate() { return { set: !!readGate(), locked: lockUntil > Date.now() ? lockUntil : 0 }; },
    // setup(처음 한 번) · unlock · change
    act(user, b) {
      switch (b?.action) {
        case 'setup': {
          if (readGate()) fail('이미 비밀번호가 있습니다.');
          const pin = checkPin(b.pin);
          setPin(user, pin);
          console.log(`[개발구성] ${user.name} 비밀번호 처음 설정`);
          return { token: issue(user) };
        }
        case 'unlock': verify(user, String(b.pin ?? '')); return { token: issue(user) };
        case 'change': {
          verify(user, String(b.old ?? ''));
          setPin(user, checkPin(b.pin));
          tokens.clear();
          console.log(`[개발구성] ${user.name} 비밀번호 변경`);
          return { token: issue(user) };
        }
        default: fail('알 수 없는 요청');
      }
    },
    // 비밀번호 확인 후 받은 토큰이 있어야 내용을 준다
    read(user, token) {
      const t = tokens.get(String(token || ''));
      if (!t || t.empNo !== user.empNo || t.until < Date.now()) fail('비밀번호를 다시 입력해 주세요.', 403);
      t.until = Date.now() + TOKEN_TTL;
      return info();
    },
  };
}

module.exports = { createDevInfo };
