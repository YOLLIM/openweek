// 사용 설문조사: 설문을 여러 개 만들고(문항 · 기간), 기간 안의 설문은 로그인할 때 팝업으로 묻는다.
// 만들기 · 고치기 · 결과 보기는 전산개발담당자(auth.isStatsViewer)만.
// data/survey.json = { surveys: [{ id, title, intro, questions, from, to, open, created, by }], responses: { [설문 id]: { [empNo]: { at, answers } } } }
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// 처음 설문 (예전 형식 파일이나 빈 파일에서 시작할 때 넣는다)
const FIRST = {
  id: '2026-11-open',
  title: '주간업무보고 사용 설문',
  intro: '이번 주부터 주간업무보고 사이트를 실제로 쓰기 시작했습니다. 사용해 보신 느낌을 알려 주시면 개선에 반영하겠습니다. (1~2분)',
  questions: [
    { id: 'q1', type: 'scale', required: true, text: '전반적으로 얼마나 만족하셨나요?', labels: ['매우 불만족', '불만족', '보통', '만족', '매우 만족'] },
    { id: 'q2', type: 'scale', required: true, text: '작성 화면은 쓰기 쉬웠나요?', labels: ['매우 어려움', '어려움', '보통', '쉬움', '매우 쉬움'] },
    { id: 'q3', type: 'choice', required: true, text: '예전 방식(엑셀 · PPT 직접 작성)과 비교해 주간보고 작성 시간은 어땠나요?', options: ['많이 줄었다', '조금 줄었다', '비슷하다', '조금 늘었다', '많이 늘었다'] },
    { id: 'q4', type: 'multi', required: false, text: '도움이 된 기능을 모두 골라 주세요.', options: ['전주 불러오기', '미리보기 · 인쇄', 'PPT · 엑셀 자동 생성', '주간보고 점검', '주간보고 Wiki 검색', '그림 붙여넣기', '아이디 저장 · 자동 로그인', '현재 접속자 표시', '문의 및 제안'] },
    { id: 'q5', type: 'text', required: false, text: '불편했거나 오류가 있었던 점을 적어 주세요.' },
    { id: 'q6', type: 'text', required: false, text: '추가되었으면 하는 기능이나 바라는 점을 적어 주세요.' },
    { id: 'q7', type: 'choice', required: true, text: '앞으로도 이 사이트로 주간보고를 작성하시겠어요?', options: ['계속 쓰고 싶다', '보완되면 쓰겠다', '예전 방식이 낫다'] },
  ],
};
const TYPES = ['scale', 'choice', 'multi', 'text'];
const MAX_TEXT = 2000, MAX_Q = 30, MAX_OPT = 20, MAX_SURVEYS = 200;

function createSurvey(dataDir) {
  const FILE = path.join(dataDir, 'survey.json');
  let data = null;
  try { data = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch {}
  // 예전 형식(설문 하나: open · period) → 설문 목록으로
  if (!data || !Array.isArray(data.surveys)) {
    const old = data || {};
    data = { surveys: [{ ...FIRST, from: old.period?.[FIRST.id]?.from || '', to: old.period?.[FIRST.id]?.to || '', open: old.open?.[FIRST.id] !== false, created: Date.now(), by: '' }], responses: old.responses || {} };
  }
  data.responses ||= {};
  const save = () => { fs.writeFileSync(FILE + '.tmp', JSON.stringify(data, null, 1)); fs.renameSync(FILE + '.tmp', FILE); };
  if (!fs.existsSync(FILE)) save();
  const fail = (msg, status = 400) => { const e = new Error(msg); e.status = status; throw e; };
  const resp = s => (data.responses[s.id] ||= {});
  const find = id => data.surveys.find(s => s.id === id) || fail('설문을 찾을 수 없습니다.', 404);
  // 한국 날짜 기준
  const today = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  // 상태: open(진행 중) · before(시작 전) · ended(기간 끝) · closed(마감)
  const state = s => { const t = today(); return !s.open ? 'closed' : s.from && t < s.from ? 'before' : s.to && t > s.to ? 'ended' : 'open'; };
  const pub = s => ({ id: s.id, title: s.title, intro: s.intro, questions: s.questions, from: s.from, to: s.to });

  // 답 검사: 문항에 맞는 값만 남긴다
  function clean(s, answers) {
    const out = {};
    for (const q of s.questions) {
      const v = answers?.[q.id];
      if (q.type === 'scale') { const n = Number(v); if (Number.isInteger(n) && n >= 1 && n <= q.labels.length) out[q.id] = n; }
      else if (q.type === 'choice') { if (q.options.includes(v)) out[q.id] = v; }
      else if (q.type === 'multi') { if (Array.isArray(v)) { const pick = q.options.filter(o => v.includes(o)); if (pick.length) out[q.id] = pick; } }
      else if (q.type === 'text') { const t = String(v ?? '').trim().slice(0, MAX_TEXT); if (t) out[q.id] = t; }
      if (q.required && out[q.id] == null) fail(`"${q.text}" 에 답해 주세요.`);
    }
    return out;
  }
  // 설문 내용 검사 (만들기 · 고치기)
  function form(b, keepIds) {
    const str = (v, n) => String(v ?? '').trim().slice(0, n);
    const date = v => { v = str(v, 10); if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) fail('날짜 형식이 맞지 않습니다.'); return v; };
    const title = str(b.title, 100) || fail('설문 제목을 적어 주세요.');
    const from = date(b.from), to = date(b.to);
    if (from && to && from > to) fail('시작일이 종료일보다 늦습니다.');
    const qs = Array.isArray(b.questions) ? b.questions.slice(0, MAX_Q) : [];
    if (!qs.length) fail('문항을 하나 이상 넣어 주세요.');
    const used = new Set();
    const questions = qs.map((q, i) => {
      const type = TYPES.includes(q.type) ? q.type : fail(`${i + 1}번 문항의 종류가 맞지 않습니다.`);
      const text = str(q.text, 300) || fail(`${i + 1}번 문항 내용을 적어 주세요.`);
      const list = a => [...new Set((Array.isArray(a) ? a : []).map(x => str(x, 100)).filter(Boolean))].slice(0, MAX_OPT);
      let id = keepIds && typeof q.id === 'string' && /^q[\w-]{1,20}$/.test(q.id) && !used.has(q.id) ? q.id : '';
      if (!id) do id = 'q' + crypto.randomBytes(3).toString('hex'); while (used.has(id));
      used.add(id);
      const out = { id, type, required: !!q.required, text };
      if (type === 'scale') { out.labels = list(q.labels); if (out.labels.length < 2) fail(`${i + 1}번 문항: 점수 단계를 2개 이상 적어 주세요.`); }
      if (type === 'choice' || type === 'multi') { out.options = list(q.options); if (out.options.length < 2) fail(`${i + 1}번 문항: 보기를 2개 이상 적어 주세요.`); }
      return out;
    });
    return { title, intro: str(b.intro, 1000), from, to, questions };
  }

  return {
    // 로그인한 사용자에게 보여줄 설문: 기간 안이고 아직 안 낸 설문 중 먼저 만든 것. 결과 보는 사람은 팝업 없음.
    pending(user, viewer) {
      if (viewer) return null;
      const s = data.surveys.slice().sort((a, b) => a.created - b.created).find(x => state(x) === 'open' && !resp(x)[user.empNo]);
      return s ? pub(s) : null;
    },
    submit(user, id, answers) {
      const s = find(String(id || ''));
      if (state(s) !== 'open') fail('설문 기간이 아니거나 마감된 설문입니다.');
      resp(s)[user.empNo] = { at: Date.now(), answers: clean(s, answers) };
      save();
      console.log(`[설문] ${user.name} 응답: ${s.title} (${Object.keys(resp(s)).length}명째)`);
    },
    // 결과 (전산개발담당자): 설문 목록 + 고른 설문(없으면 가장 최근)의 응답
    results(id) {
      const list = data.surveys.slice().sort((a, b) => b.created - a.created);
      const s = list.find(x => x.id === id) || list[0] || null;
      return {
        list: list.map(x => ({ id: x.id, title: x.title, from: x.from, to: x.to, state: state(x), count: Object.keys(resp(x)).length, created: x.created })),
        survey: s && { ...pub(s), open: s.open, state: state(s), created: s.created, by: s.by },
        responses: s ? resp(s) : {},
        today: today(),
      };
    },
    // 만들기 · 고치기 · 지우기 · 진행/마감 (전산개발담당자). 고른 설문 id 를 돌려준다.
    admin(user, b) {
      switch (b?.action) {
        case 'create': {
          if (data.surveys.length >= MAX_SURVEYS) fail('설문이 너무 많습니다. 오래된 설문을 지워 주세요.');
          let id; do id = 's' + crypto.randomBytes(5).toString('hex'); while (data.surveys.some(s => s.id === id));
          data.surveys.push({ id, ...form(b, false), open: true, created: Date.now(), by: user.name });
          save(); console.log(`[설문] ${user.name} 새 설문: ${b.title}`);
          return id;
        }
        case 'update': {
          const s = find(String(b.id || ''));
          const f = form(b, true);
          // 응답이 있으면 문항은 그대로 (제목 · 안내 · 기간만 고침)
          if (Object.keys(resp(s)).length) { s.title = f.title; s.intro = f.intro; s.from = f.from; s.to = f.to; }
          else Object.assign(s, f);
          save();
          return s.id;
        }
        case 'delete': {
          const s = find(String(b.id || ''));
          data.surveys = data.surveys.filter(x => x !== s);
          delete data.responses[s.id];
          save(); console.log(`[설문] ${user.name} 설문 삭제: ${s.title}`);
          return null;
        }
        case 'open': {
          const s = find(String(b.id || ''));
          s.open = !!b.open;
          save();
          return s.id;
        }
        default: fail('알 수 없는 요청');
      }
    },
  };
}

module.exports = { createSurvey };
