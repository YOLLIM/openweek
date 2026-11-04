// 접속 통계: data/stats/YYYY-MM.jsonl 에 한 줄씩 기록한다 (13개월 보관).
// 조회는 전산개발담당자(auth.isStatsViewer)만 할 수 있다.
// 기록 종류(k): login(비밀번호 로그인) · auto(자동 로그인) · continue([계속하기]) · fail(로그인 실패)
//              logout · visit(화면을 새로 연 것) · view(메뉴 이동, v = 화면 이름)
const fs = require('fs');
const path = require('path');

const KEEP_MONTHS = 13;
const MAX_DAYS = 400;
const MAX_FAIL_PER_DAY = 2000;   // 없는 계정으로 마구 시도해도 기록 파일이 커지지 않게

function createStats(dataDir) {
  const DIR = path.join(dataDir, 'stats');
  fs.mkdirSync(DIR, { recursive: true });
  const ym = t => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
  const fileOf = m => path.join(DIR, `${m}.jsonl`);

  // 오래된 달 정리
  function purge() {
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - KEEP_MONTHS);
    const oldest = ym(d);
    for (const f of fs.readdirSync(DIR)) { const m = /^(\d{4}-\d{2})\.jsonl$/.exec(f); if (m && m[1] < oldest) fs.rmSync(path.join(DIR, f), { force: true }); }
  }
  purge(); setInterval(purge, 24 * 3600 * 1000).unref();

  const device = ua => (/iPad|Tablet/i.test(ua) ? 'tablet' : /Mobi|Android|iPhone/i.test(ua) ? 'mobile' : 'pc');
  const browser = ua => (/Edg\//.test(ua) ? 'Edge' : /Whale\//.test(ua) ? 'Whale' : /SamsungBrowser/.test(ua) ? 'Samsung' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '기타');
  // 운영 서버는 Caddy 뒤(127.0.0.1)에서만 받으므로 X-Forwarded-For 첫 값이 실제 접속 주소
  const ipOf = req => (String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || '').replace(/^::ffff:/, '').slice(0, 45);

  let buf = [], timer = null, failDay = '', failCount = 0;
  function flush() {
    timer = null;
    const byMonth = new Map();
    for (const x of buf) { const m = ym(x.t); if (!byMonth.has(m)) byMonth.set(m, []); byMonth.get(m).push(JSON.stringify(x)); }
    buf = [];
    for (const [m, lines] of byMonth) { try { fs.appendFileSync(fileOf(m), lines.join('\n') + '\n'); } catch (e) { console.error('[접속 통계 기록 실패]', e.message); } }
  }
  function log(req, empNo, k, v) {
    try {
      const t = Date.now();
      if (k === 'fail') {
        const day = new Date(t).toDateString();
        if (day !== failDay) { failDay = day; failCount = 0; }
        if (++failCount > MAX_FAIL_PER_DAY) return;
      }
      const ua = String(req.headers['user-agent'] || '');
      buf.push({ t, e: String(empNo || ''), k, ...(v ? { v: String(v).slice(0, 40) } : {}), d: device(ua), b: browser(ua), ip: ipOf(req) });
      if (!timer) timer = setTimeout(flush, 2000);
    } catch (e) { console.error('[접속 통계]', e.message); }
  }

  // 최근 days 일의 기록
  function read(days) {
    days = Math.min(Math.max(parseInt(days, 10) || 30, 1), MAX_DAYS);
    flush();
    const from = new Date(); from.setHours(0, 0, 0, 0); from.setDate(from.getDate() - (days - 1));
    const out = [];
    const d = new Date(from); d.setDate(1);
    for (; ym(d) <= ym(Date.now()); d.setMonth(d.getMonth() + 1)) {
      let text = '';
      try { text = fs.readFileSync(fileOf(ym(d)), 'utf8'); } catch { continue; }
      for (const line of text.split('\n')) {
        if (!line) continue;
        try { const x = JSON.parse(line); if (x.t >= from.getTime()) out.push(x); } catch { /* 깨진 줄은 건너뜀 */ }
      }
    }
    return { from: from.getTime(), days, events: out };
  }

  process.on('exit', flush);
  return { log, read, flush };
}

module.exports = { createStats };
