// 주간보고 점검: 기본 규칙(rules.js)으로 오타·띄어쓰기·맞춤법을 찾고,
// API 키가 설정돼 있으면 Claude 점검 결과를 더해 "원문 → 수정안" 목록으로 돌려준다.
const fs = require('fs');
const path = require('path');
const { Anthropic } = require('@anthropic-ai/sdk');
const { ruleCheck } = require('./rules.js');

const MODEL = 'claude-opus-5-5';
const TYPES = ['오타', '띄어쓰기', '맞춤법', '문장부호', '표현'];

const SYSTEM = `당신은 한국어 업무 보고서 교정 담당자입니다. 네트워크/IT 운영 부서의 주간업무보고 문장을 점검합니다.

찾을 것:
- 오타 (잘못 입력된 글자)
- 띄어쓰기 오류 (한글 맞춤법 기준)
- 맞춤법 오류 (되/돼, 안/않, 로서/로써 등)
- 문장부호 오류 (괄호 짝, 중복 기호 등)
- 의미가 모호하거나 어색한 표현 (꼭 필요할 때만)

바꾸지 말 것:
- 장비·제품·모델명, 영문 약어, IP 주소, 포트, 시스템명 (예: HPE 5140, Aruba 6000, NAC, AP, PLC, rommon, NextU)
- 사람 이름, 부서·공장·설비 이름
- 줄 번호, 들여쓰기, 줄바꿈, "- " 같은 목록 기호, 날짜 표기 방식(9/26, 09/28 등)
- 보고서 특유의 개조식 문체 ("~완료", "~점검", "~교체" 같은 명사형 끝맺음)
- 취향 차이일 뿐 틀리지 않은 부분

출력 규칙:
- original 은 해당 항목 원문에 글자 그대로(공백 포함) 들어 있는 부분이어야 합니다. 원문에서 한 번만 나오도록 앞뒤 단어를 조금 포함해 짧게 잡으세요. 한 줄을 넘기지 마세요.
- suggestion 은 original 을 대체할 고친 문구입니다. 고칠 부분 외에는 original 과 같아야 합니다.
- reason 은 왜 고치는지 한 문장으로 짧게 씁니다.
- 고칠 것이 없으면 빈 목록을 돌려주세요. 확실하지 않은 것은 넣지 마세요.`;

const SCHEMA = {
  type: 'object',
  properties: {
    issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '항목 번호 (입력의 [#번호])' },
          original: { type: 'string' },
          suggestion: { type: 'string' },
          type: { type: 'string', enum: TYPES },
          reason: { type: 'string' },
        },
        required: ['id', 'original', 'suggestion', 'type', 'reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['issues'],
  additionalProperties: false,
};

function createChecker(dataDir) {
  const CONFIG_FILE = path.join(dataDir, 'config.json');
  const readConfig = () => { try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { return {}; } };
  const apiKey = () => readConfig().anthropicApiKey || process.env.ANTHROPIC_API_KEY || '';
  const fail = (msg, status = 400) => { const e = new Error(msg); e.status = status; throw e; };

  return {
    status() {
      const k = apiKey();
      return { configured: !!k, masked: k ? k.slice(0, 7) + '…' + k.slice(-4) : '', fromEnv: !readConfig().anthropicApiKey && !!process.env.ANTHROPIC_API_KEY };
    },

    setKey(key) {
      key = String(key || '').trim();
      const cfg = readConfig();
      if (key) cfg.anthropicApiKey = key; else delete cfg.anthropicApiKey;
      fs.writeFileSync(CONFIG_FILE + '.tmp', JSON.stringify(cfg, null, 1));
      fs.renameSync(CONFIG_FILE + '.tmp', CONFIG_FILE);
      return this.status();
    },

    // 기본 규칙 점검은 항상, AI 점검은 API 키가 있을 때만 더한다.
    // entries: [{ id, label, text }]  →  { mode, warning, issues: [{ id, original, suggestion, type, reason }] }
    async check(entries) {
      const issues = ruleCheck(entries);
      const key = apiKey();
      if (!key || !entries.length) return { mode: 'rules', issues };
      let ai;
      try {
        ai = await this.aiCheck(entries, key);
      } catch (e) {
        if (!e.status) throw e;
        return { mode: 'rules', warning: `AI 점검은 하지 못해 기본 규칙으로만 점검했습니다. (${e.message})`, issues };
      }
      // 같은 곳을 AI와 규칙이 모두 찾았으면 규칙 결과는 뺀다
      const aiKeys = new Set(ai.map(i => i.id + '|' + i.original));
      return { mode: 'ai', issues: [...ai, ...issues.filter(i => !aiKeys.has(i.id + '|' + i.original))] };
    },

    async aiCheck(entries, key) {
      const input = entries.map(e => `[#${e.id}] ${e.label}\n${e.text}`).join('\n\n-----\n\n');
      const client = new Anthropic({ apiKey: key });
      let res;
      try {
        res = await client.beta.messages.create({
          model: MODEL,
          max_tokens: 16000,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
          system: SYSTEM,
          messages: [{ role: 'user', content: `다음 주간업무보고 항목들을 점검하세요.\n\n${input}` }],
        });
      } catch (e) {
        if (e instanceof Anthropic.AuthenticationError) fail('API 키가 올바르지 않습니다. 설정에서 키를 확인하세요.');
        if (e instanceof Anthropic.PermissionDeniedError) fail('이 API 키로는 점검 모델을 사용할 수 없습니다.');
        if (e instanceof Anthropic.RateLimitError) fail('요청이 많아 잠시 제한되었습니다. 잠시 후 다시 시도하세요.', 429);
        if (e instanceof Anthropic.APIConnectionError) fail('AI 서버에 연결할 수 없습니다. 이 서버 PC의 인터넷 연결을 확인하세요.', 502);
        if (e instanceof Anthropic.APIError) fail(`AI 점검 오류 (${e.status}): ${e.message}`, 502);
        throw e;
      }
      if (res.stop_reason === 'refusal') fail('AI가 이 내용의 점검을 거절했습니다.', 502);
      if (res.stop_reason === 'max_tokens') fail('점검 결과가 너무 길어 중단되었습니다. 내용을 나눠서 점검하세요.', 502);

      const text = res.content.filter(b => b.type === 'text').map(b => b.text).join('');
      let parsed;
      try { parsed = JSON.parse(text); } catch { fail('AI 응답을 해석하지 못했습니다. 다시 시도하세요.', 502); }

      // 원문에 실제로 있고 실제로 바뀌는 제안만 남긴다
      const byId = new Map(entries.map(e => [String(e.id), e]));
      const seen = new Set();
      return (parsed.issues || []).filter(i => {
        const e = byId.get(String(i.id).replace(/^#/, ''));
        if (!e || !i.original || i.original === i.suggestion || !e.text.includes(i.original)) return false;
        const k = e.id + '|' + i.original;
        if (seen.has(k)) return false;
        seen.add(k);
        i.id = e.id;
        return true;
      });
    },
  };
}

module.exports = { createChecker };
