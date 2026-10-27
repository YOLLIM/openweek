// 서버 상시 실행: server.js 를 띄우고, 꺼지면 다시 실행한다. 로그는 data/logs/ 에 날짜별로 남긴다.
// 실행: node supervisor.js  (Windows 시작 시 자동 실행은 install-autostart.bat)
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const LOG_DIR = path.join(DIR, 'data', 'logs');
const PID_FILE = path.join(DIR, 'data', 'supervisor.pid');
fs.mkdirSync(LOG_DIR, { recursive: true });

// 이미 실행 중이면 하나만 유지
try {
  const old = Number(fs.readFileSync(PID_FILE, 'utf8'));
  if (old && old !== process.pid) { process.kill(old, 0); console.log(`이미 실행 중입니다 (PID ${old}).`); process.exit(0); }
} catch { /* 실행 중인 것 없음 */ }
fs.writeFileSync(PID_FILE, String(process.pid));

const logFile = () => path.join(LOG_DIR, `server-${new Date().toISOString().slice(0, 10)}.log`);
const log = msg => fs.appendFileSync(logFile(), `[${new Date().toLocaleString()}] ${msg}\n`);

let child = null, delay = 1000, startedAt = 0, stopping = false;
function start() {
  startedAt = Date.now();
  child = spawn(process.execPath, [path.join(DIR, 'server.js')], { cwd: DIR, windowsHide: true });
  log(`서버 시작 (PID ${child.pid})`);
  child.stdout.on('data', d => fs.appendFileSync(logFile(), d));
  child.stderr.on('data', d => fs.appendFileSync(logFile(), d));
  child.on('exit', code => {
    if (stopping) return;
    // 금방 다시 죽으면 재시작 간격을 늘린다 (최대 60초)
    delay = Date.now() - startedAt > 60000 ? 1000 : Math.min(delay * 2, 60000);
    log(`서버 종료 (코드 ${code}) → ${delay / 1000}초 후 다시 시작`);
    setTimeout(start, delay);
  });
}
function stop() {
  stopping = true;
  log('관리 프로그램 종료');
  try { child?.kill(); } catch { /* 이미 종료 */ }
  try { if (Number(fs.readFileSync(PID_FILE, 'utf8')) === process.pid) fs.rmSync(PID_FILE); } catch { /* 없음 */ }
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
start();
