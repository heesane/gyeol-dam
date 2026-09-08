import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { computeSaju } from './saju.mjs';

const PORT = Number(process.env.PORT ?? 3110);
const HOST = process.env.HOST ?? '127.0.0.1';
const BODY_LIMIT = 18 * 1024 * 1024;
const AGENT_TIMEOUT_MS = Number(process.env.GYEOLDAM_TIMEOUT_MS ?? 15 * 60_000);

// --- 이 서비스 전용 모델 고정 (전역 CLI 설정과 무관) -----------------------------
const PROMPT_VERSION = '2026-09-08p';
const AGENTS = {
  codex:  { model: process.env.GYEOLDAM_CODEX_MODEL  ?? 'gpt-5.6-sol',   effort: 'low' },
  claude: { model: process.env.GYEOLDAM_CLAUDE_MODEL ?? 'claude-opus-5', effort: 'low' },
};
const AGENT_ORDER = (process.env.GYEOLDAM_AGENT_ORDER ?? 'codex,claude')
  .split(',').map((s) => s.trim()).filter((s) => s in AGENTS);

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE_PROMPT = await readFile(join(HERE, 'prompt.txt'), 'utf8');

const sql = postgres(process.env.DATABASE_URL ?? '', { max: 4, idle_timeout: 30, onnotice: () => {} });
const requestWindows = new Map();

const ALL_SECTIONS = [
  { key: 'innate', title: '타고난 성향' },
  { key: 'palm', title: '손에 새겨진 기질' },
  { key: 'currentFlow', title: '지금 들어온 흐름' },
  { key: 'workTalent', title: '일과 재능' },
  { key: 'moneyBusiness', title: '돈과 사업' },
  { key: 'loveMarriage', title: '연애와 결혼' },
  { key: 'futureFlow', title: '앞으로의 큰 흐름' },
  { key: 'choices', title: '지금 해야 할 선택' },
];
// 손금 사진이 없으면 palm 섹션은 innate 의 재탕이 된다. 아예 빼고 7장으로 낸다.
const sectionsFor = (palm) => ALL_SECTIONS.filter((s) => palm || s.key !== 'palm');

// 섹션 하나의 최소 분량. 이보다 낮추면 근거 없이 얇아지고, 높이면 분량 채우기가 시작된다.
const MIN_SECTION_CHARS = 1200;
const MIN_BLOCK_CHARS = 300;

function send(response, status, payload) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(payload));
}

function authorize(request) {
  const expected = process.env.GYEOLDAM_API_TOKEN;
  return Boolean(expected) && request.headers.authorization === `Bearer ${expected}`;
}

function rateLimited(client) {
  const now = Date.now();
  const recent = (requestWindows.get(client) ?? []).filter((time) => now - time < 10 * 60_000);
  recent.push(now);
  requestWindows.set(client, recent);
  return recent.length > 3;
}

async function readJson(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > BODY_LIMIT) throw new Error('사진 용량이 너무 커.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

// --- 프롬프트 --------------------------------------------------------------------
// prompt.txt(완성본)를 페르소나·분석 방법·금지사항의 근거로 쓰고, 웹 출력은 단계로 나눈다.
//  1단계 core   : 원국 판정 + 섹션별로 무엇을 맡을지 배분 (중복의 원인을 여기서 끊는다)
//  2단계 group  : 배분받은 축으로 섹션 2~3개씩 나눠 생성 (한 번에 2만 자를 쓰지 않는다)
//  4단계 fix    : 검수에 걸린 섹션만 다시 쓴다
// 3단계 검수는 reviewSection()·duplicateSections() 가 코드로 한다.

function sajuBlockFor(input) {
  try {
    return computeSaju(input).text;
  } catch (error) {
    return `# 명식 자동계산 실패 (${error instanceof Error ? error.message : error}) — 직접 만세력 규칙으로 산출하라.`;
  }
}

// 모든 단계가 공유하는 머리말: 페르소나 + 확정 명식 + 사용자 입력.
function contextBlock(input) {
  const palm = input.mode === 'saju_palm';
  const parts = [
    BASE_PROMPT.trim(), '', '---', '', sajuBlockFor(input), '',
    '# 사용자 입력',
    `- 분석 모드: ${palm ? '사주·손금' : '사주'}`,
  ];
  if (palm) {
    parts.push(`- 주로 사용하는 손: ${input.dominantHand === 'left' ? '왼손' : '오른손'} (사진 첨부됨)`, '- 반대손: 사진 첨부됨');
  }
  parts.push(
    `- 생년월일: ${input.birthDate} (${input.dateType === 'lunar' ? '음력' : '양력'})`,
    `- 출생시간: ${input.birthTime}`,
    `- 성별: ${input.gender === 'female' ? '여성' : '남성'}`,
    `- 출생지: ${input.birthPlace}`,
  );
  return parts.join('\n');
}

// 모든 단계에 공통으로 붙는 규칙. 나쁜 예문은 적지 않는다 (모델이 문체 재료로 쓴다).
const COMMON_RULES = [
  'prompt.txt 의 페르소나(#34)·해석 절차(#6·#7·#13~#33)·금지사항은 모두 지킨다.',
  '단, 명식(팔자·대운·오행·십성)은 위 "확정된 명식" 블록이 확정본이다. 만세력을 웹에서 다시 조사하지 않는다.',
  '대운의 나이와 시작연도는 위 표의 숫자를 그대로 옮긴다. 다시 계산하지 않고, "일곱 살"·"스물일곱"처럼 한글 수사로 바꾸지도 않는다. 반드시 "19세(2018년~)" 형태의 숫자로 쓴다. 같은 숫자가 사용자 화면의 명식 카드에 나란히 표시되므로 틀리면 바로 드러난다.',
  '분위기만 전환하는 접속 상투어 없이, 앞 문장의 근거를 이어받아 다음 문장을 쓴다.',
  '해월을 화자로 앞세우지 않는다. 해월의 감정이나 권위 대신 위험과 결과를 바로 설명한다.',
  '글 자체를 언급하지 않는다. 방금 쓴 문장을 되짚거나, 어떤 표현이 필요하다/불필요하다고 평가하는 문장을 본문에 남기지 않는다. 사용자에게 하는 말만 쓴다.',
  '명리 용어 설명이 본문을 차지하게 두지 않는다. 한 섹션에 전문용어는 근거로 꼭 필요한 1~2개만 쓰고, 한자·독음·괄호 뜻을 반복 병기하지 않는다.',
  'summary·lead·evidence·caution 에는 한자를 쓰지 않는다. 한글 독음만 쓰거나(을목, 유금) 생활 언어로 바꾼다.',
  'JSON 객체 하나만 출력한다. 코드펜스·설명·앞뒤 텍스트 없이. 첫 글자 "{", 마지막 글자 "}".',
];

// 섹션별로 반드시 답해야 하는 것. blocks 소제목의 뼈대가 된다.
const SECTION_BRIEF = {
  innate: '결정을 내리는 방식 / 잘하는 일 / 완벽주의가 켜지는 순간',
  palm: '주 손과 반대손의 차이 / 생각하는 방식 / 감정과 애정 표현을 양손 관찰과 연결',
  currentFlow: '지금 잘 풀리는 일 / 늦어지는 일 / 앞으로 2~3년 안의 전환점과 판단 기준',
  workTalent: '맞는 일의 방식 / 잘 맞는 조직 / 리더가 되었을 때의 장단점',
  moneyBusiness: '돈을 버는 구조 / 돈이 새는 습관 / 사업과 투자의 함정',
  loveMarriage: '자꾸 끌리는 사람 / 반복되는 갈등 / 오래 가는 관계의 조건',
  futureFlow: 'currentFlow 이후의 대운 / 30대·40대의 변화 / 시기별 대응',
  choices: '밀어붙일 일 / 기다릴 일 / 버릴 습관과 그 구분 기준',
};
// 시기를 다루는 섹션에만 타임라인을 붙인다.
const TIMELINE_KEYS = new Set(['currentFlow', 'futureFlow']);

// ── 1단계: 공통 핵심 분석 + 섹션별 축 배분 ──────────────────────────────────────
const coreSchema = (palm) => ({
  type: 'object', additionalProperties: false,
  properties: {
    summary: { type: 'string' },
    verdict: { type: 'string', minLength: 200 },
    assignments: {
      type: 'array', minItems: sectionsFor(palm).length, maxItems: sectionsFor(palm).length,
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          key: { type: 'string', enum: sectionsFor(palm).map((section) => section.key) },
          angle: { type: 'string' },
          evidence: { type: 'string' },
          avoid: { type: 'string' },
        },
        required: ['key', 'angle', 'evidence', 'avoid'],
      },
    },
    actions: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'string' } },
    disclaimer: { type: 'string' },
  },
  required: ['summary', 'verdict', 'assignments', 'actions', 'disclaimer'],
});

export function corePrompt(input) {
  const palm = input.mode === 'saju_palm';
  return [
    contextBlock(input), '',
    '# 1단계: 핵심 분석과 축 배분 (본문은 아직 쓰지 않는다)',
    ...COMMON_RULES,
    '이 단계에서는 풀이 본문을 쓰지 않는다. 뒤 단계가 섹션을 나눠 쓸 때 쓸 뼈대만 만든다.',
    'verdict 에 신강/신약, 조후, 용신·희신·기신, 합충형파해 판정을 근거와 함께 적는다. 이후 단계가 이 판정만 근거로 삼는다.',
    `assignments 는 아래 ${sectionsFor(palm).length}개 섹션에 서로 겹치지 않는 축을 하나씩 배분한다. 같은 소재가 두 섹션에 들어가지 않도록, 각 섹션의 avoid 에 "다른 섹션이 맡았으니 여기서는 다루지 않을 소재"를 적는다.`,
    `섹션과 각자 답해야 할 것: ${sectionsFor(palm).map(({ key, title }) => `${key}(${title}) — ${SECTION_BRIEF[key]}`).join(' / ')}`,
    JSON.stringify({
      summary: 'string · 이 사람을 관통하는 결론 2~3문장 (prompt.txt #5). 한자 금지',
      verdict: 'string · 200자 이상 · 원국 판정과 근거. 뒤 단계가 그대로 쓸 재료',
      assignments: sectionsFor(palm).map(({ key, title }) => ({
        key,
        angle: `string · ${title} 이 섹션만 다룰 축 한 문장 (${SECTION_BRIEF[key]})`,
        evidence: 'string · 그 축의 명식 근거 한 문장',
        avoid: 'string · 다른 섹션이 맡았으니 여기서는 쓰지 않을 소재',
      })),
      actions: ['string · 오늘·이번달·3개월 안에 실행 여부를 확인할 수 있는 구체적 행동', 'string', 'string'],
      disclaimer: 'string · 오락·자기성찰용이며 중요한 결정은 현실 정보와 전문가 조언을 함께 보라는 한 문장',
    }, null, 2),
  ].join('\n');
}

// ── 2단계: 섹션 그룹 생성 ───────────────────────────────────────────────────────
// 한 섹션의 스키마. 진단 5단계 요구대로 소제목·강조·근거·주의점·타임라인을 나눠 담는다.
function sectionSchema(key) {
  const properties = {
    key: { type: 'string', enum: [key] },
    title: { type: 'string' },
    lead: { type: 'string' },
    keywords: { type: 'array', minItems: 2, maxItems: 3, items: { type: 'string' } },
    evidence: { type: 'string', minLength: 40 },
    caution: { type: 'string', minLength: 20 },
    blocks: {
      type: 'array', minItems: 3, maxItems: 4,
      items: {
        type: 'object', additionalProperties: false,
        properties: { heading: { type: 'string' }, body: { type: 'string', minLength: MIN_BLOCK_CHARS } },
        required: ['heading', 'body'],
      },
    },
  };
  const required = ['key', 'title', 'lead', 'keywords', 'evidence', 'caution', 'blocks'];
  if (TIMELINE_KEYS.has(key)) {
    properties.timeline = {
      type: 'array', minItems: 3, maxItems: 5,
      items: {
        type: 'object', additionalProperties: false,
        properties: { when: { type: 'string' }, what: { type: 'string' } },
        required: ['when', 'what'],
      },
    };
    required.push('timeline');
  }
  return { type: 'object', additionalProperties: false, properties, required };
}

const groupSchema = (group) => ({
  type: 'object', additionalProperties: false,
  properties: {
    sections: {
      type: 'array', minItems: group.length, maxItems: group.length,
      items: { anyOf: group.map(({ key }) => sectionSchema(key)) },
    },
  },
  required: ['sections'],
});

function sectionSkeleton({ key, title }) {
  const skeleton = {
    key, title,
    lead: 'string · 이 섹션을 한 문장으로 찌르는 해월의 말. 30자 내외, 구어 반말, 요약체 금지',
    keywords: ["array · 짧은 키워드 2~3개 (예: '검수', '유금 셋'). 각 6자 이내, 문장 금지"],
    evidence: 'string · 40자 이상 · 이 섹션 판단의 명식 근거 한두 문장. 화면에 근거 카드로 따로 뜬다. 한자 금지',
    caution: 'string · 20자 이상 · 이 기질이 어긋날 때 실제로 벌어지는 일 한 문장. 화면에 주의 박스로 따로 뜬다',
    blocks: [
      { heading: 'string · 이 덩어리가 답하는 것 12자 이내', body: `string · ${MIN_BLOCK_CHARS}자 이상 · ${SECTION_BRIEF[key]}` },
      { heading: 'string', body: 'string' },
      { heading: 'string', body: `string · 블록 3~4개, 섹션 합계 ${MIN_SECTION_CHARS}자 이상` },
    ],
  };
  if (TIMELINE_KEYS.has(key)) {
    skeleton.timeline = [
      { when: 'string · 시기 (예: "2026년", "29세(2028년~) 경오 대운")', what: 'string · 그때 벌어지는 일과 대응 한 문장' },
      { when: 'string', what: 'string' },
      { when: 'string', what: 'string · 항목 3~5개' },
    ];
  }
  return skeleton;
}

export function groupPrompt(input, core, group) {
  const palm = input.mode === 'saju_palm';
  const assigned = (key) => core.assignments.find((a) => a.key === key) ?? {};
  return [
    contextBlock(input), '',
    '# 1단계에서 확정한 분석 (그대로 근거로 쓴다. 다시 판정하지 않는다)',
    `- 관통하는 결론: ${core.summary}`,
    `- 원국 판정: ${core.verdict}`,
    '- 섹션별 축 배분 (다른 섹션이 맡은 소재는 여기서 쓰지 않는다):',
    ...core.assignments.map((a) => `  · ${a.key}: 축=${a.angle} / 근거=${a.evidence} / 여기서 다루지 않을 것=${a.avoid}`),
    '',
    `# 2단계: 아래 ${group.length}개 섹션만 쓴다`,
    ...COMMON_RULES,
    `이번 응답에서 쓸 섹션: ${group.map(({ key, title }) => `${key}(${title})`).join(' → ')}. 순서를 바꾸거나 다른 섹션을 쓰지 않는다.`,
    ...group.map(({ key, title }) => `${key}(${title})는 배분받은 축 "${assigned(key).angle ?? ''}"만 다룬다. "${assigned(key).avoid ?? ''}"는 다른 섹션 몫이니 여기서 쓰지 않는다.`),
    '각 섹션은 제목 아래에서 기대하는 세부 질문을 충분히 답한다. 성향을 이름 붙이는 데서 끝내지 말고, 언제 드러나는지, 실제로 어떻게 행동하는지, 잘 쓸 때와 어긋날 때 무엇이 달라지는지, 판단 기준은 무엇인지까지 쓴다.',
    `block.heading 은 그 덩어리가 답하는 것을 12자 이내로 붙인 소제목이고(번호·"첫째" 금지), block.body 는 ${MIN_BLOCK_CHARS}자 이상이다. body 안에서 문단을 나눌 때만 빈 줄(\\n\\n)을 쓴다.`,
    'body 안에서 그 문단의 판단이 걸린 구절 하나만 **굵게** 표시한다. 문단마다 최대 하나, 한 구절(20자 이내)이고 문장 전체를 감싸지 않는다.',
    `한 섹션의 body 합계는 ${MIN_SECTION_CHARS}자 이상이면 충분하다. 상한은 없지만 분량을 목표로 삼지 않는다. 할 말이 끝나면 그 자리에서 끝낸다. 같은 근거나 결론을 표현만 바꿔 늘리거나, 마무리 문장을 덧붙여 길이를 채우지 않는다.`,
    '문장은 반드시 완결된 문장으로 끝낸다. 인용부호는 열었으면 반드시 닫는다.',
    palm ? '양손 사진을 실제로 관찰해 사주와 겹치는 신호를 반영한다.' : '손금 섹션은 이번 응답에 없다. 손을 봤다고 가정하거나 손금을 언급하지 않는다.',
    JSON.stringify({ sections: group.map(sectionSkeleton) }, null, 2),
  ].join('\n');
}

// ── 4단계: 검수에 걸린 섹션만 다시 쓴다 ─────────────────────────────────────────
function fixPrompt(input, core, section, problems) {
  return [
    contextBlock(input), '',
    `# 원국 판정 (확정): ${core.verdict}`,
    '',
    '# 4단계: 아래 섹션을 고쳐 다시 낸다',
    ...COMMON_RULES,
    '내용과 구조는 그대로 두고, 지적된 문제만 고친다. 분량을 늘리지 않는다.',
    `고칠 점: ${problems.join(' / ')}`,
    '',
    '# 고칠 섹션 (이 JSON 과 같은 구조로 낸다)',
    JSON.stringify({ sections: [section] }, null, 2),
  ].join('\n');
}

const CLAUDE_CONTRACT = [
  '너는 prompt.txt 의 해월로서 분석하되, 최종 출력은 요청의 "출력 형식" JSON 객체 하나만 낸다.',
  '명식은 "확정된 명식" 블록의 값이 확정본이다. 어떤 도구도 호출하지 않는다.',
  '코드펜스·설명 없이 "{" 로 시작해 "}" 로 끝난다.',
].join(' ');

// --- 결과 검수 -------------------------------------------------------------------
// 프롬프트의 부정 지시만으로는 새어 나오는 것들을 여기서 실제로 잡는다.
// 프롬프트에는 나쁜 예문을 적지 않는다 (모델이 그걸 문체 재료로 쓴다).

// 자기 초안을 검토하는 문장이 본문에 남은 것. 문장 단위로 통째로 지운다.
export const META_SENTENCE = /[^.!?。！？\n]*(?:같은\s*(?:멋진\s*)?(?:말|문장|선언|표현|교훈|격언|얘기)[^.!?\n]{0,30}?(?:필요|덧붙이|반복|남기지|남기고|포장|보다|말고|이유|취하|중요해)|처럼\s*꾸밀\s*필요|(?:으로|로)\s*포장할\s*필요|라는\s*말이\s*네\s*명식)[^.!?。！？\n]*[.!?。！？]?/g;

// 문맥을 잇지 않고 분위기만 바꾸는 상투어 / 화자를 앞세운 문장.
const CLICHES = [
  /여기서\s*갈린다/, /이게\s*핵심이야/, /바로\s*이거야/, /결국\s*이렇다/, /문제는\s*이거야/,
  /내가\s*중요하게\s*보는\s*건/, /나는\s*네가\s*[^.!?\n]{0,20}경계해/, /나는\s*그게\s*걱정/,
];

const sectionTexts = (s) => [s.lead, s.evidence, s.caution, ...s.blocks.map((b) => b.body), ...(s.timeline ?? []).map((t) => t.what)];

// 본문이 쓴 대운 나이가 화면 명식 카드와 어긋나는지 본다.
// 간지(예: 辛未)와 "N세"가 같은 문장에 있을 때만 대조한다.
export function daYunMismatch(text, chart) {
  if (!chart?.daYun?.length) return null;
  const byGz = new Map(chart.daYun.map((d) => [d.gz, d.age]));
  for (const sentence of text.split(/[.!?。！？\n]/)) {
    const gz = [...byGz.keys()].find((key) => sentence.includes(key));
    if (!gz) continue;
    const age = sentence.match(/(\d{1,2})\s*세/);
    if (age && Number(age[1]) !== byGz.get(gz)) {
      return `대운 ${gz} 는 ${byGz.get(gz)}세인데 본문은 ${age[1]}세로 씀`;
    }
  }
  return null;
}

// 섹션 하나의 문제 목록. 4단계가 이걸 그대로 받아 그 섹션만 다시 쓴다.
export function reviewSection(section, chart) {
  const problems = [];
  for (const text of sectionTexts(section)) {
    if (typeof text !== 'string') continue;
    const cliche = CLICHES.find((pattern) => pattern.test(text));
    if (cliche) problems.push(`분위기만 바꾸는 상투어를 지운다: "${text.match(cliche)?.[0]}"`);
    const meta = text.match(META_SENTENCE);
    if (meta) problems.push(`글 자체를 언급하는 문장을 지운다: "${meta[0].trim().slice(0, 40)}"`);
    const mismatch = daYunMismatch(text, chart);
    if (mismatch) problems.push(`${mismatch}. 확정된 명식의 숫자로 고친다`);
  }
  return [...new Set(problems)];
}

// 섹션끼리 같은 문장을 돌려쓰는지 본다. 축 배분이 무너졌다는 신호.
export function duplicateSections(sections) {
  const problems = new Map();
  const seen = new Map();
  for (const section of sections) {
    for (const block of section.blocks) {
      for (const sentence of block.body.split(/[.!?。！？\n]+/)) {
        const key = sentence.replace(/[^가-힣]/g, '');
        if (key.length < 25) continue;
        const owner = seen.get(key);
        if (!owner) { seen.set(key, section.key); continue; }
        if (owner === section.key) continue;
        problems.set(section.key, [...(problems.get(section.key) ?? []),
          `${owner} 섹션과 같은 문장을 반복한다: "${sentence.trim().slice(0, 40)}". 이 섹션의 축으로 다시 쓴다`]);
      }
    }
  }
  return problems;
}

// 열리지 않은 채 남은 닫는 따옴표를 지운다. 분량 채우다 잘린 꼬리의 흔적.
export function stripUnpairedQuotes(text) {
  let open = 0;
  return text.replace(/[\u201C\u201D]/g, (mark) => {
    if (mark === '\u201C') { open += 1; return mark; }
    if (open > 0) { open -= 1; return mark; }
    return '';
  }).replace(/\s+([,.])/g, '$1').trim();
}

const clean = (text) => stripUnpairedQuotes(text.replace(META_SENTENCE, ''));

function sanitizeResult(v) {
  for (const section of v.sections) {
    for (const field of ['lead', 'evidence', 'caution']) section[field] = clean(section[field]);
    for (const block of section.blocks) {
      block.heading = block.heading.trim();
      block.body = clean(block.body);
    }
    for (const item of section.timeline ?? []) { item.when = item.when.trim(); item.what = clean(item.what); }
  }
  v.summary = clean(v.summary);
  return v;
}

// 섹션 하나가 계약을 지켰는지. 그룹 응답과 4단계 수정본 모두 이걸로 본다.
function validSection(v, { key, title }) {
  return Boolean(v && v.key === key && v.title === title
    && typeof v.lead === 'string' && v.lead.trim()
    && typeof v.evidence === 'string' && v.evidence.length >= 40
    && typeof v.caution === 'string' && v.caution.length >= 20
    && Array.isArray(v.keywords) && v.keywords.length >= 2 && v.keywords.length <= 3
    && v.keywords.every((keyword) => typeof keyword === 'string' && keyword.trim())
    && Array.isArray(v.blocks) && v.blocks.length >= 3 && v.blocks.length <= 4
    && v.blocks.every((b) => b && typeof b.heading === 'string' && b.heading.trim()
      && typeof b.body === 'string' && b.body.length >= MIN_BLOCK_CHARS)
    && v.blocks.reduce((total, b) => total + b.body.length, 0) >= MIN_SECTION_CHARS
    && (!TIMELINE_KEYS.has(key) || (Array.isArray(v.timeline) && v.timeline.length >= 3
      && v.timeline.every((t) => t && typeof t.when === 'string' && t.when.trim() && typeof t.what === 'string' && t.what.trim()))));
}

function validCore(v, palm) {
  return Boolean(v && typeof v.summary === 'string' && typeof v.disclaimer === 'string'
    && typeof v.verdict === 'string' && v.verdict.length >= 200
    && Array.isArray(v.assignments) && v.assignments.length === sectionsFor(palm).length
    && v.assignments.every((a) => a && typeof a.key === 'string' && typeof a.angle === 'string' && a.angle.trim())
    && Array.isArray(v.actions) && v.actions.length === 3
    && v.actions.every((a) => typeof a === 'string' && a.length > 4));
}

function extractJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('JSON 없음');
  return JSON.parse(text.slice(start, end + 1));
}

// --- 에이전트 실행 -------------------------------------------------------------
function runProcess(bin, args, { cwd, env, stdin }) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), AGENT_TIMEOUT_MS);
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error((stderr.trim() || stdout.trim() || `${bin} 실패`).slice(0, 600)));
    });
    child.stdin.end(stdin);
  });
}

const baseEnv = () => ({
  PATH: process.env.PATH, HOME: process.env.HOME, USER: process.env.USER,
  LANG: process.env.LANG ?? 'C.UTF-8', CODEX_HOME: process.env.CODEX_HOME,
});

let stepSeq = 0;
async function runCodex(prompt, workDir, imagePaths, schema) {
  const { model, effort } = AGENTS.codex;
  // 단계마다 파일이 겹치지 않게 (그룹은 동시에 돈다).
  const step = `${process.pid}-${stepSeq += 1}`;
  const schemaPath = join(workDir, `schema-${step}.json`);
  const resultPath = join(workDir, `result-${step}.json`);
  await writeFile(schemaPath, JSON.stringify(schema), { mode: 0o600 });
  const args = [
    'exec', '--sandbox', 'read-only', '--ephemeral', '--ignore-user-config', '--ignore-rules',
    '--skip-git-repo-check', '--model', model,
    '-c', `model_reasoning_effort="${effort}"`,
    '--output-schema', schemaPath, '--output-last-message', resultPath,
  ];
  for (const path of imagePaths) args.push('--image', path);
  args.push('-');
  await runProcess('/usr/bin/codex', args, { cwd: workDir, env: baseEnv(), stdin: prompt });
  return JSON.parse(await readFile(resultPath, 'utf8'));
}

async function runClaude(prompt, workDir, imagePaths) {
  if (imagePaths.length) throw new Error('claude 경로는 이미지 미지원');
  const { model, effort } = AGENTS.claude;
  const mcpPath = join(workDir, 'mcp.json');
  await writeFile(mcpPath, '{"mcpServers":{}}', { mode: 0o600 });
  const args = [
    '-p', '--model', model, '--effort', effort,
    '--output-format', 'json', '--strict-mcp-config', '--mcp-config', mcpPath,
    '--exclude-dynamic-system-prompt-sections',
    '--permission-mode', 'plan', '--disallowed-tools', '*',
    '--append-system-prompt', CLAUDE_CONTRACT,
  ];
  const raw = await runProcess('/usr/bin/claude', args, { cwd: workDir, env: baseEnv(), stdin: prompt });
  const envelope = JSON.parse(raw);
  if (envelope.is_error || typeof envelope.result !== 'string') {
    throw new Error(String(envelope.result ?? envelope.subtype ?? 'claude 오류').slice(0, 400));
  }
  return extractJson(envelope.result);
}

const RUNNERS = { codex: runCodex, claude: runClaude };

// 한 단계를 에이전트 순서대로 시도한다. 형식이 맞는 첫 결과를 쓴다.
async function runStep(label, prompt, schema, isValid, ctx) {
  const errors = [];
  for (const agent of ctx.order) {
    try {
      const value = await RUNNERS[agent](prompt, ctx.workDir, ctx.imagePaths, schema);
      if (!isValid(value)) throw new Error('출력 형식 불일치');
      ctx.used.add(agent);
      return value;
    } catch (error) {
      errors.push(`${agent}: ${error instanceof Error ? error.message : error}`);
    }
  }
  throw new Error(`${label} — ${errors.join(' | ')}`);
}

// 섹션을 2~3개씩 묶는다. 한 번에 2만 자를 쓰게 하지 않으려는 것이 목적이라
// 마지막 그룹만 1개가 되지 않게 고르게 자른다 (7개 -> 2·2·3, 8개 -> 2·3·3).
export function groupSections(palm) {
  const all = sectionsFor(palm);
  const count = Math.ceil(all.length / 3);
  return Array.from({ length: count }, (_, i) =>
    all.slice(Math.floor((i * all.length) / count), Math.floor(((i + 1) * all.length) / count)));
}

async function runReading(input) {
  const palm = input.mode === 'saju_palm';
  const workDir = await mkdtemp(join(tmpdir(), 'gyeoldam-'));
  const imagePaths = [];
  try {
    for (const image of input.images ?? []) {
      const ext = image.contentType?.split('/')[1]?.replace('jpeg', 'jpg') ?? 'bin';
      const path = join(workDir, `${image.role}.${ext}`);
      await writeFile(path, Buffer.from(image.data, 'base64'), { mode: 0o600 });
      imagePaths.push(path);
    }
    let chart = null;
    try { chart = computeSaju(input).chart; } catch { /* 교차검증만 생략 */ }
    const ctx = {
      workDir, imagePaths, used: new Set(),
      order: imagePaths.length ? ['codex'] : AGENT_ORDER,
    };

    // 1단계 — 원국 판정과 섹션별 축 배분. 이후 단계는 이 결과만 근거로 삼는다.
    const core = await runStep('1단계 핵심 분석', corePrompt(input), coreSchema(palm),
      (v) => validCore(v, palm), ctx);

    // 2단계 — 그룹을 동시에 쓴다. 축은 1단계가 갈라 놨으니 서로를 볼 필요가 없다.
    const groups = groupSections(palm);
    const written = await Promise.all(groups.map((group) => runStep(
      `2단계 ${group.map((g) => g.key).join('·')}`,
      groupPrompt(input, core, group),
      groupSchema(group),
      (v) => Array.isArray(v?.sections) && v.sections.length === group.length
        && group.every((meta, index) => validSection(v.sections[index], meta)),
      // 손금 사진은 palm 섹션이 든 그룹에만 넘긴다.
      { ...ctx, imagePaths: group.some((g) => g.key === 'palm') ? imagePaths : [] },
    )));
    let sections = written.flatMap((v) => v.sections);

    // 3단계 — 코드 검수. 섹션별 문제 + 섹션 간 중복.
    const duplicates = duplicateSections(sections);
    const flagged = new Map();
    for (const section of sections) {
      const problems = [...reviewSection(section, chart), ...(duplicates.get(section.key) ?? [])];
      if (problems.length) flagged.set(section.key, problems);
    }

    // 4단계 — 걸린 섹션만 다시 쓴다. 실패하면 원본을 정리해서 쓴다.
    if (flagged.size) {
      console.warn(`[${input.id}] 검수 지적 ${flagged.size}개 섹션 — ${[...flagged.keys()].join(', ')}`);
      sections = await Promise.all(sections.map(async (section) => {
        const problems = flagged.get(section.key);
        if (!problems) return section;
        const meta = sectionsFor(palm).find((m) => m.key === section.key);
        try {
          const fixed = await runStep(`4단계 ${section.key}`, fixPrompt(input, core, section, problems),
            groupSchema([meta]), (v) => validSection(v?.sections?.[0], meta),
            { ...ctx, imagePaths: section.key === 'palm' ? imagePaths : [] });
          return reviewSection(fixed.sections[0], chart).length ? section : fixed.sections[0];
        } catch (error) {
          console.warn(`[${input.id}] ${section.key} 재작성 실패 — ${error instanceof Error ? error.message : error}`);
          return section;
        }
      }));
    }

    const result = sanitizeResult({
      summary: core.summary, sections, actions: core.actions, disclaimer: core.disclaimer,
    });
    const agent = [...ctx.used].join('+') || ctx.order[0];
    return { result, agent, model: [...ctx.used].map((a) => AGENTS[a].model).join('+'), promptVersion: PROMPT_VERSION };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

async function processReading(input) {
  try {
    const { result, agent, model, promptVersion } = await runReading(input);
    await sql`
      UPDATE readings SET status = 'completed', result = ${sql.json(result)},
        agent = ${agent}, model = ${model}, prompt_version = ${promptVersion}, completed_at = NOW()
      WHERE id = ${input.id}
    `;
  } catch (error) {
    const message = error instanceof Error ? error.message : '풀이 생성 실패';
    await sql`UPDATE readings SET status = 'failed', error_text = ${message.slice(0, 1000)} WHERE id = ${input.id}`;
  }
}

async function createReading(request, response) {
  const client = String(request.headers['x-client-ip'] ?? 'unknown').slice(0, 80);
  if (rateLimited(client)) return send(response, 429, { error: '요청이 너무 많아. 10분 뒤에 다시 해줘.' });
  const input = await readJson(request);
  const birthDate = String(input.birthDate ?? '').replaceAll('.', '-');
  const imageKeys = (input.images ?? []).map((image) => image.objectKey ?? null);
  let chart = null;
  try { chart = computeSaju(input).chart; } catch { /* 카드 없이 진행 */ }
  await sql`
    INSERT INTO readings (id, mode, birth_date, date_type, birth_time, gender, birth_place, dominant_hand, image_keys, status, prompt_version, chart)
    VALUES (${input.id}, ${input.mode}, ${birthDate}, ${input.dateType}, ${input.birthTime}, ${input.gender}, ${input.birthPlace}, ${input.dominantHand ?? null}, ${sql.json(imageKeys)}, 'processing', ${PROMPT_VERSION}, ${chart ? sql.json(chart) : null})
  `;
  processReading(input);
  send(response, 202, { id: input.id, status: 'processing' });
}

// DATE 컬럼이 Date 로 오면 UTC 변환에서 하루 밀릴 수 있어 로컬 값으로 포맷한다.
const ymd = (v) => (v instanceof Date
  ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
  : String(v).slice(0, 10));

async function getReading(response, id) {
  const [row] = await sql`
    SELECT status, mode, result, chart, error_text, agent, model, birth_date, date_type, birth_time, gender
    FROM readings WHERE id = ${id}`;
  if (!row) return send(response, 404, { error: 'not found' });
  if (row.status === 'completed') {
    // chart 컬럼이 생기기 전에 만든 풀이는 null 이라 명식 카드가 안 뜬다. 조회 때 채워 넣는다.
    let chart = row.chart;
    if (!chart) {
      try {
        chart = computeSaju({
          birthDate: ymd(row.birth_date),
          birthTime: String(row.birth_time).slice(0, 5),
          dateType: row.date_type,
          gender: row.gender,
        }).chart;
        await sql`UPDATE readings SET chart = ${sql.json(chart)} WHERE id = ${id}`;
      } catch { chart = null; }
    }
    return send(response, 200, { id, status: 'completed', mode: row.mode, agent: row.agent, model: row.model, chart, ...row.result });
  }
  if (row.status === 'failed') return send(response, 200, { id, status: 'failed', error: '풀이를 만들지 못했어. 잠시 뒤 다시 해줘.' });
  return send(response, 200, { id, status: 'processing' });
}

async function migrate() {
  for (const col of ['agent TEXT', 'model TEXT', 'prompt_version TEXT', 'analysis TEXT', 'chart JSONB']) {
    await sql.unsafe(`ALTER TABLE readings ADD COLUMN IF NOT EXISTS ${col}`);
  }
}

const server = createServer(async (request, response) => {
  try {
    if (request.method === 'GET' && request.url === '/health') {
      return send(response, 200, { status: 'ok', promptVersion: PROMPT_VERSION, agents: AGENT_ORDER });
    }
    if (!authorize(request)) return send(response, 401, { error: 'unauthorized' });
    if (request.method === 'POST' && request.url === '/v1/readings') return await createReading(request, response);
    const match = request.method === 'GET' && request.url.match(/^\/v1\/readings\/([0-9a-fA-F-]{36})$/);
    if (match) return await getReading(response, match[1]);
    send(response, 404, { error: 'not found' });
  } catch (error) {
    console.error(error);
    send(response, 500, { error: 'server error' });
  }
});

// GYEOLDAM_NO_LISTEN=1 이면 서버를 띄우지 않는다 (테스트에서 함수만 import 하려고).
if (!process.env.GYEOLDAM_NO_LISTEN) {
  await migrate();
  server.listen(PORT, HOST, () => console.log(`gyeoldam-api on ${HOST}:${PORT} (prompt ${PROMPT_VERSION}, agents ${AGENT_ORDER.join('>')})`));

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, async () => {
      await sql.end({ timeout: 5 });
      server.close(() => process.exit(0));
    });
  }
}
