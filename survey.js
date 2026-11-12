// 사용 설문조사: 로그인하면 팝업으로 묻고, 결과는 전산개발담당자(auth.isStatsViewer)만 본다.
// data/survey.json = { open: { [설문 id]: true|false }, responses: { [설문 id]: { [empNo]: { at, answers } } } }
// 설문 문항은 여기(SURVEYS)에 두고, 새 설문은 id 를 바꿔 추가한다 (맨 끝 설문이 진행 대상).
const fs = require('fs');
const path = require('path');

const SURVEYS = [
  {
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
  },
];
const current = () => SURVEYS[SURVEYS.length - 1];
const MAX_TEXT = 2000;

function createSurvey(dataDir) {
  const FILE = path.join(dataDir, 'survey.json');
  let data = { open: {}, responses: {} };
  try { data = { open: {}, responses: {}, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }; } catch {}
  const save = () => { fs.writeFileSync(FILE + '.tmp', JSON.stringify(data, null, 1)); fs.renameSync(FILE + '.tmp', FILE); };
  const fail = (msg, status = 400) => { const e = new Error(msg); e.status = status; throw e; };
  const isOpen = s => data.open[s.id] !== false;   // 처음에는 진행 중
  const resp = s => (data.responses[s.id] ||= {});

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

  return {
    // 로그인한 사용자에게 보여줄 설문 (진행 중이고 아직 안 냈으면). 결과 보는 사람은 팝업 없음.
    pending(user, viewer) {
      const s = current();
      if (viewer || !isOpen(s) || resp(s)[user.empNo]) return null;
      return s;
    },
    submit(user, answers) {
      const s = current();
      if (!isOpen(s)) fail('마감된 설문입니다.');
      const prev = resp(s)[user.empNo];
      resp(s)[user.empNo] = { at: Date.now(), answers: clean(s, answers), ...(prev ? { first: prev.first || prev.at } : {}) };
      save();
      console.log(`[설문] ${user.name} 응답 (${Object.keys(resp(s)).length}명째)`);
    },
    // 결과 (전산개발담당자)
    results() {
      const s = current();
      return { survey: s, open: isOpen(s), responses: resp(s) };
    },
    setOpen(open) { data.open[current().id] = !!open; save(); },
  };
}

module.exports = { createSurvey };
