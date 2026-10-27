// 문의 및 제안 게시판: data/board.json 에 저장. 새 글이 올라오면 정해진 주소로 알림 메일을 보낸다.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// 새 글 알림 메일 받는 사람 (고정)
const NOTIFY_TO = 'upsan77@gmail.com';
const CATEGORIES = ['문의', '개선 제안'];
// 첨부파일: 글 하나에 5개, 파일 하나 10MB, 합계 12MB. 실행 파일은 받지 않는다.
const MAX_FILES = 5, MAX_FILE = 10 * 1024 * 1024, MAX_TOTAL = 12 * 1024 * 1024;
const BLOCKED = /\.(exe|bat|cmd|com|msi|scr|ps1|vbs|vbe|js|jse|wsf|wsh|hta|cpl|jar|lnk|reg|dll)$/i;
// 화면에 바로 보여주는 그림 (그 외는 내려받기)
const IMAGE_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp' };
const OTHER_TYPES = { '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8', '.zip': 'application/zip', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.doc': 'application/msword',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation', '.ppt': 'application/vnd.ms-powerpoint', '.hwp': 'application/x-hwp', '.csv': 'text/csv; charset=utf-8' };
const typeOf = name => { const ext = path.extname(name).toLowerCase(); return IMAGE_TYPES[ext] || OTHER_TYPES[ext] || 'application/octet-stream'; };
const STATUSES = ['접수', '처리 중', '완료'];

function createBoard(dataDir, mailer) {
  const FILE = path.join(dataDir, 'board.json');
  let posts = [];
  try { posts = JSON.parse(fs.readFileSync(FILE, 'utf8')).posts || []; } catch { /* 처음 */ }
  const save = () => { fs.writeFileSync(FILE + '.tmp', JSON.stringify({ posts }, null, 1)); fs.renameSync(FILE + '.tmp', FILE); };
  const fail = (msg, status = 400) => { const e = new Error(msg); e.status = status; throw e; };
  const text = (v, max, label) => { const t = String(v ?? '').trim(); if (!t) fail(`${label}을(를) 입력하세요.`); return t.slice(0, max); };
  const find = id => posts.find(p => p.id === id) || fail('글을 찾을 수 없습니다. (삭제되었을 수 있음)', 404);
  const newId = () => crypto.randomBytes(6).toString('hex');
  const author = u => ({ empNo: u.empNo, name: u.name });
  const mine = (p, u) => p.by.empNo === u.empNo || u.role === 'admin';
  const FILE_DIR = path.join(dataDir, 'board');
  const fileDir = pid => path.join(FILE_DIR, pid);
  // 첨부 검사 후 저장: files = [{ name, data(base64) }] → [{ id, name, size, type }]
  function saveFiles(pid, files) {
    if (!Array.isArray(files) || !files.length) return [];
    if (files.length > MAX_FILES) fail(`첨부파일은 ${MAX_FILES}개까지 올릴 수 있습니다.`);
    const list = files.map(f => {
      const name = path.basename(String(f.name || 'file')).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 120) || 'file';
      if (BLOCKED.test(name)) fail(`실행 파일은 첨부할 수 없습니다: ${name}`);
      const buf = Buffer.from(String(f.data || ''), 'base64');
      if (!buf.length) fail(`빈 파일입니다: ${name}`);
      if (buf.length > MAX_FILE) fail(`파일 하나는 10MB까지 올릴 수 있습니다: ${name}`);
      return { name, buf };
    });
    if (list.reduce((a, x) => a + x.buf.length, 0) > MAX_TOTAL) fail('첨부파일은 합쳐서 12MB까지 올릴 수 있습니다.');
    fs.mkdirSync(fileDir(pid), { recursive: true });
    return list.map(({ name, buf }) => {
      const id = newId();
      fs.writeFileSync(path.join(fileDir(pid), id), buf);
      return { id, name, size: buf.length, type: typeOf(name) };
    });
  }
  // 내려받기: 글에 등록된 파일만
  function file(pid, fid) {
    const p = posts.find(x => x.id === pid), f = p?.files?.find(x => x.id === fid);
    const fp = f && path.join(fileDir(pid), f.id);
    return f && fs.existsSync(fp) ? { ...f, path: fp } : null;
  }

  // 목록: 최신 글부터
  const list = () => posts.slice().sort((a, b) => b.at - a.at);

  async function act(u, body, baseUrl) {
    switch (body.action) {
      case 'add': {
        const p = {
          id: newId(), no: (posts.reduce((m, x) => Math.max(m, x.no || 0), 0) + 1),
          category: CATEGORIES.includes(body.category) ? body.category : CATEGORIES[0],
          title: text(body.title, 120, '제목'), body: text(body.body, 5000, '내용'),
          by: author(u), at: Date.now(), status: STATUSES[0], comments: [],
        };
        p.files = saveFiles(p.id, body.files);
        posts.push(p);
        save();
        // 알림 메일 (첨부파일 포함): 실패해도 글은 올라간 상태로 두고 안내만 돌려준다
        let mail = 'sent';
        try {
          const fileLines = p.files.length ? `\n\n첨부파일 ${p.files.length}개: ${p.files.map(f => f.name).join(', ')}` : '';
          await mailer.notify(NOTIFY_TO, `[주간업무보고 문의 및 제안] [${p.category}] ${p.title}`,
            `문의 및 제안 게시판에 새 글이 올라왔습니다.\n\n번호: ${p.no}\n구분: ${p.category}\n제목: ${p.title}\n작성자: ${p.by.name}\n작성 시각: ${new Date(p.at).toLocaleString('ko-KR')}\n\n${p.body}${fileLines}\n\n게시판 보기: ${baseUrl}/#board`,
            p.files.map(f => ({ filename: f.name, path: path.join(fileDir(p.id), f.id), contentType: f.type })));
        } catch (e) { mail = e.message; }
        console.log(`[문의 및 제안] ${p.by.name}: ${p.title} · 알림 메일 ${mail === 'sent' ? '보냄' : '실패 - ' + mail}`);
        return { post: p, mail };
      }
      case 'comment': {
        const p = find(body.id);
        p.comments.push({ id: newId(), body: text(body.body, 3000, '댓글'), by: author(u), admin: u.role === 'admin', at: Date.now() });
        save();
        return { post: p };
      }
      case 'uncomment': {
        const p = find(body.id), c = p.comments.find(x => x.id === body.cid) || fail('댓글을 찾을 수 없습니다.', 404);
        if (c.by.empNo !== u.empNo && u.role !== 'admin') fail('본인 댓글만 지울 수 있습니다.', 403);
        p.comments = p.comments.filter(x => x !== c);
        save();
        return { post: p };
      }
      case 'status': {
        if (u.role !== 'admin') fail('처리 상태는 관리자만 바꿀 수 있습니다.', 403);
        const p = find(body.id);
        if (!STATUSES.includes(body.status)) fail('알 수 없는 상태');
        p.status = body.status;
        save();
        return { post: p };
      }
      case 'edit': {
        const p = find(body.id);
        if (p.by.empNo !== u.empNo) fail('본인 글만 고칠 수 있습니다.', 403);
        p.title = text(body.title, 120, '제목'); p.body = text(body.body, 5000, '내용');
        if (CATEGORIES.includes(body.category)) p.category = body.category;
        p.edited = Date.now();
        save();
        return { post: p };
      }
      case 'delete': {
        const p = find(body.id);
        if (!mine(p, u)) fail('본인 글이나 관리자만 지울 수 있습니다.', 403);
        posts = posts.filter(x => x !== p);
        save();
        fs.rmSync(fileDir(p.id), { recursive: true, force: true });   // 첨부파일도 함께
        return { ok: true };
      }
      default: fail('알 수 없는 작업');
    }
  }
  return { list, act, file, NOTIFY_TO, CATEGORIES, STATUSES };
}

module.exports = { createBoard };
