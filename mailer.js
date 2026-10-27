// 독촉 메일: 회사 메일 서버(SMTP)로 미완 사업장 담당자에게 작성 요청 메일을 보낸다.
// 설정은 data/config.json 의 mail 항목에 저장 (비밀번호는 화면으로 돌려주지 않음).
const fs = require('fs');
const os = require('os');
const path = require('path');
const nodemailer = require('nodemailer');
const Ops = require('./public/ops.js');

function createMailer(dataDir, port) {
  const CONFIG_FILE = path.join(dataDir, 'config.json');
  const readConfig = () => { try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { return {}; } };
  const writeConfig = cfg => { fs.writeFileSync(CONFIG_FILE + '.tmp', JSON.stringify(cfg, null, 1)); fs.renameSync(CONFIG_FILE + '.tmp', CONFIG_FILE); };
  const fail = (msg, status = 400) => { const e = new Error(msg); e.status = status; throw e; };

  // 메일 속 접속 주소 기본값: 이 PC의 사내 IP
  const defaultUrl = () => {
    for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) if (a.family === 'IPv4' && !a.internal && /^(10|172|192)\./.test(a.address)) return `http://${a.address}:${port}`;
    return `http://localhost:${port}`;
  };
  const cfg = () => readConfig().mail || {};

  function status() {
    const m = cfg();
    return { host: m.host || '', port: m.port || 587, secure: !!m.secure, user: m.user || '', from: m.from || '', fromName: m.fromName || '주간업무보고', baseUrl: m.baseUrl || defaultUrl(), hasPass: !!m.pass, configured: !!(m.host && m.from) };
  }

  function save(body) {
    const all = readConfig(), m = all.mail || {};
    const host = String(body.host || '').trim(), from = String(body.from || '').trim();
    if (host && !/^[\w.-]+$/.test(host)) fail('메일 서버 주소가 올바르지 않습니다.');
    if (from && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(from)) fail('보내는 메일 주소 형식이 올바르지 않습니다.');
    const p = Number(body.port) || 587;
    if (p < 1 || p > 65535) fail('포트 번호가 올바르지 않습니다.');
    Object.assign(m, { host, port: p, secure: !!body.secure, user: String(body.user || '').trim(), from, fromName: String(body.fromName || '').trim().slice(0, 40), baseUrl: String(body.baseUrl || '').trim().replace(/\/+$/, '') });
    if (body.pass) m.pass = String(body.pass);
    if (body.clearPass) delete m.pass;
    all.mail = m;
    writeConfig(all);
    return status();
  }

  function transport() {
    const m = cfg();
    if (!m.host || !m.from) fail('메일 발송 설정이 없습니다. 관리자가 [설정 > 메일 발송 설정]에서 메일 서버를 등록해야 합니다.');
    return nodemailer.createTransport({
      host: m.host, port: m.port || 587, secure: !!m.secure,
      auth: m.user ? { user: m.user, pass: m.pass || '' } : undefined,
      tls: { rejectUnauthorized: false },   // 사내 메일 서버의 자체 인증서 허용
      connectionTimeout: 15000,
    });
  }
  const fromHeader = () => { const m = cfg(); return m.fromName ? `"${m.fromName.replace(/"/g, '')}" <${m.from}>` : m.from; };

  async function send(t, to, subject, text, attachments) {
    try { await t.sendMail({ from: fromHeader(), to, subject, text, attachments }); }
    catch (e) { fail(`메일 발송 실패 (${to}): ${e.message}`, 502); }
  }

  async function test(me) {
    if (!me.email) fail('내 계정에 메일 주소가 없습니다. 사용자 관리에서 먼저 등록하세요.');
    const t = transport();
    await send(t, me.email, '[주간업무보고] 테스트 메일', `메일 발송 설정이 정상입니다.\n\n접속 주소: ${status().baseUrl}`);
    return { to: me.email };
  }

  // 사업장별 미작성 항목
  function missing(db, r, s) {
    const st = r.stats[s.id] || {};
    const out = [];
    if (!Ops.COLS.some(c => st[c.key] !== '' && st[c.key] != null)) out.push('1. 운영 업무 (건수)');
    if (!Ops.worksText(r, s).trim()) out.push('2. 변경 및 신규 업무');
    if (!(r.issues?.[s.id] || '').trim()) out.push('3. 장애 및 이슈 사항');
    return out;
  }

  // r: 보고서, sids: 독촉할 사업장, users: 전체 사용자, sender: 보내는 관리자
  const md = d => d.slice(5).replace('-', '/');
  async function remind(db, r, sids, users, sender) {
    const groupName = s => db.groups.find(g => g.id === s.groupId)?.name || '';
    const week = `${md(r.start)}~${md(r.end)}`;
    return remindSites({
      r, users, sender, week,
      sites: db.sites.filter(s => sids.includes(s.id)),
      labelOf: s => `${groupName(s)} ${s.name}`,
      missingOf: s => missing(db, r, s),
      subject: labels => `[주간업무보고] ${week} 주간보고 작성 요청 - ${labels}`,
      when: `보고일 ${r.date.replace(/-/g, '/')} (기간 ${week}) 주간보고에서`,
      how: '작성 후 [전체 현황]에서 [완료로 표시]를 눌러 주세요.',
    });
  }
  // ITOA 주간보고 독촉
  async function remindItoa(db, r, sids, users, sender) {
    const it = db.itoa || {};
    const week = `${md(r.start)}~${md(r.end)}`;
    return remindSites({
      r, users, sender, week,
      sites: (it.sites || []).filter(s => sids.includes(s.id)),
      labelOf: s => Ops.itoaSiteLabel((it.groups || []).find(g => g.id === s.groupId), s),
      missingOf: s => Ops.itoaSiteMissing(r, s.id),
      subject: labels => `[ITOA 주간보고] ${week} 주간보고 작성 요청 - ${labels}`,
      when: `ITOA 주간보고(주간 ${r.start.replace(/-/g, '/')} ~ ${r.end.replace(/-/g, '/')})에서`,
      how: 'ITOA 부문 [주간보고 작성]에서 담당 사업장 내용을 작성해 주세요.',
    });
  }
  async function remindSites({ r, users, sender, sites, labelOf, missingOf, subject, when, how }) {
    if (!sites.length) fail('독촉할 사업장을 선택하세요.');
    // 담당자별로 사업장을 모은다
    const byUser = new Map(), skipped = [];
    for (const s of sites) {
      const label = labelOf(s);
      if (r.done?.[s.id]) { skipped.push({ site: label, reason: '이미 완료로 표시됨' }); continue; }
      const people = (s.assignees || []).map(e => users.find(u => u.empNo === e)).filter(u => u && u.active);
      if (!people.length) { skipped.push({ site: label, reason: '담당자 없음' }); continue; }
      const withMail = people.filter(u => u.email);
      if (!withMail.length) { skipped.push({ site: label, reason: '담당자 메일 미등록' }); continue; }
      for (const u of withMail) {
        if (!byUser.has(u.empNo)) byUser.set(u.empNo, { user: u, items: [] });
        byUser.get(u.empNo).items.push({ s, label, miss: missingOf(s) });
      }
    }
    const sent = [];
    if (byUser.size) {
      const t = transport(), url = status().baseUrl;
      for (const { user, items } of byUser.values()) {
        const lines = items.map(x => `  • ${x.label}${x.miss.length ? ` : 미작성 ${x.miss.join(', ')}` : ' : 작성 완료 표시 필요'}`).join('\n');
        const text = `${user.name}님, 안녕하세요.\n\n${when} 아래 사업장이 아직 완료되지 않았습니다.\n\n${lines}\n\n${how}\n작성하기: ${url}\n\n보낸 사람: ${sender.name}`;
        await send(t, user.email, subject(items.map(x => x.label).join(', ')), text);
        sent.push({ to: user.email, name: user.name, sites: items.map(x => x.label), sids: items.map(x => x.s.id) });
      }
    }
    return { sent, skipped };
  }

  // 알림 메일 한 통 (문의 및 제안 게시판 등). attachments: [{ filename, path }]
  async function notify(to, subject, text, attachments) {
    await send(transport(), to, subject, text, attachments);
  }

  return { status, save, test, remind, remindItoa, notify };
}

module.exports = { createMailer };
