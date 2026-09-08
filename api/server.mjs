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
const PROMPT_VERSION = '2026-09-08l';
const AGENTS = {
  codex:  { model: process.env.GYEOLDAM_CODEX_MODEL  ?? 'gpt-5.6-sol',   effort: 'medium' },
  claude: { model: process.env.GYEOLDAM_CLAUDE_MODEL ?? 'claude-opus-5', effort: 'medium' },
};
const AGENT_ORDER = (process.env.GYEOLDAM_AGENT_ORDER ?? 'codex,claude')
  .split(',').map((s) => s.trim()).filter((s) => s in AGENTS);

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE_PROMPT = await readFile(join(HERE, 'prompt.txt'), 'utf8');

const sql = postgres(process.env.DATABASE_URL ?? '', { max: 4, idle_timeout: 30, onnotice: () => {} });
const requestWindows = new Map();

const READING_SECTIONS = [
  { key: 'innate', title: '타고난 성향' },
  { key: 'palm', title: '손에 새겨진 기질' },
  { key: 'currentFlow', title: '지금 들어온 흐름' },
  { key: 'workTalent', title: '일과 재능' },
  { key: 'moneyBusiness', title: '돈과 사업' },
  { key: 'loveMarriage', title: '연애와 결혼' },
  { key: 'futureFlow', title: '앞으로의 큰 흐름' },
  { key: 'choices', title: '지금 해야 할 선택' },
];

// 프론트와 LLM이 함께 사용하는 8개 섹션 + "지금 할 일 세 가지" 계약.
const RESULT_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    summary: { type: 'string' },
    sections: {
      type: 'array', minItems: 8, maxItems: 8,
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          key: { type: 'string', enum: READING_SECTIONS.map((section) => section.key) },
          title: { type: 'string' },
          lead: { type: 'string' },
          keywords: { type: 'array', minItems: 2, maxItems: 3, items: { type: 'string' } },
          content: { type: 'string', minLength: 3000 },
        },
        required: ['key', 'title', 'lead', 'keywords', 'content'],
      },
    },
    actions: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'string' } },
    disclaimer: { type: 'string' },
  },
  required: ['summary', 'sections', 'actions', 'disclaimer'],
};

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
// prompt.txt(완성본)를 페르소나·분석 방법·금지사항의 근거로 그대로 쓰고,
// 마지막에 "웹 서비스 출력 형식"만 구조화된 JSON 으로 고정한다 (프론트가 그 구조를 렌더).
function promptFor(input) {
  const palm = input.mode === 'saju_palm';
  let sajuBlock = '';
  try {
    sajuBlock = computeSaju(input).text;
  } catch (error) {
    sajuBlock = `# 명식 자동계산 실패 (${error instanceof Error ? error.message : error}) — 직접 만세력 규칙으로 산출하라.`;
  }
  const parts = [
    BASE_PROMPT.trim(),
    '',
    '---',
    '',
    sajuBlock,
    '',
    '# 사용자 입력',
    `- 분석 모드: ${palm ? '사주·손금' : '사주'}`,
  ];
  if (palm) {
    parts.push(`- 주로 사용하는 손: ${input.dominantHand === 'left' ? '왼손' : '오른손'} (사진 첨부됨)`);
    parts.push('- 반대손: 사진 첨부됨');
  }
  parts.push(
    `- 생년월일: ${input.birthDate} (${input.dateType === 'lunar' ? '음력' : '양력'})`,
    `- 출생시간: ${input.birthTime}`,
    `- 성별: ${input.gender === 'female' ? '여성' : '남성'}`,
    `- 출생지: ${input.birthPlace}`,
    '',
    '# 이 요청의 출력 형식 (웹 서비스용 · 위 문서의 분량/웹조사 규칙보다 우선)',
    'prompt.txt 의 페르소나(#34)·해석 절차(#6·#7·#13~#33)·금지사항은 모두 지킨다.',
    '단, 명식(팔자·대운·오행·십성)은 위 "확정된 명식" 블록이 확정본이다. 만세력을 웹에서 다시 조사하지 않는다.',
    '이번 응답은 아래의 고정된 "여덟 섹션 + 지금 할 일 세 가지"를 JSON 하나로만 낸다.',
    '`여기서 갈린다`, `이게 핵심이야`, `바로 이거야`, `결국 이렇다`, `문제는 이거야`처럼 문맥을 잇지 않고 분위기만 전환하는 생성형 상투어를 쓰지 않는다.',
    '`나는 A보다 B를 보라고 해`, `내가 중요하게 보는 건`, `얼마나 A하느냐보다 언제·어떻게 B하느냐`처럼 화자를 앞세운 인위적인 대비 문장을 쓰지 않는다. 해월의 1인칭은 섹션마다 의무적으로 넣지 않는다.',
    '`나는 네가 ~하는 걸 경계해`, `나는 그게 걱정돼`, `내가 바라는 건`처럼 해월의 감정이나 권위를 내세운 충고를 쓰지 않는다. 위험과 결과를 바로 설명한다.',
    '이 웹 결과에서는 명리 용어 설명이 본문을 차지하게 두지 않는다. 한 섹션에 전문용어는 근거로 꼭 필요한 1~2개만 쓰고, 한자·한글 독음·괄호 뜻을 반복 병기하지 않는다. 처음 나온 용어도 쉬운 말 한 구절로만 풀고 곧바로 사용자의 실제 생활 장면으로 넘어간다.',
    '각 섹션은 사용자가 제목 아래에서 기대하는 세부 질문을 모두 충분히 답한다. 성향을 이름 붙이는 데서 끝내지 말고, 언제 드러나는지, 실제로 어떻게 행동하는지, 잘 쓸 때와 어긋날 때 무엇이 달라지는지, 사용자가 판단할 기준은 무엇인지까지 구체적으로 쓴다.',
    '모든 section.content는 각각 최소 3,000자 이상으로 쓴다. 섹션마다 6~10개 문단으로 나누고 문단 사이는 빈 줄(\\n\\n)로 구분한다. 최대 글자 수는 강제하지 않지만, 같은 근거나 결론을 표현만 바꿔 분량을 채우지 않는다.',
    palm
      ? '양손 사진을 실제로 관찰해 사주와 겹치는 신호를 반영한다.'
      : '손을 봤다고 가정하지 말고, "손에 새겨진 기질" 섹션은 명식에서 드러나는 생각·감정·표현 방식에만 집중한다. 사진이 없다는 사실, 불가능한 관찰, AI의 한계를 사용자에게 해명하지 말고 바로 풀이로 들어간다.',
    `sections는 아래 순서를 바꾸거나 합치거나 생략하지 않는다: ${READING_SECTIONS.map(({ key, title }) => `${key}(${title})`).join(' → ')}.`,
    '각 section의 key와 title은 예시 문자열을 한 글자도 바꾸지 않는다.',
    'JSON 객체 하나만 출력한다. 코드펜스·설명·앞뒤 텍스트 없이. 첫 글자 "{", 마지막 글자 "}".',
    JSON.stringify({
      summary: 'string · 이 사람을 관통하는 결론 2~3문장 (prompt.txt #5)',
      sections: [
        { key: 'innate', title: '타고난 성향', lead: LEAD, keywords: KEY, content: 'string · 최소 3,000자 · 결정을 내리는 방식/잘하는 일/완벽주의가 켜지는 순간을 빠짐없이 깊게 다룸' },
        { key: 'palm', title: '손에 새겨진 기질', lead: LEAD, keywords: KEY, content: palm ? 'string · 최소 3,000자 · 주 손과 반대손/생각하는 방식/감정과 애정 표현을 양손 관찰과 깊게 연결함' : 'string · 최소 3,000자 · 생각하는 방식/감정과 애정 표현 등 타고난 기질을 사주 근거와 현실 장면으로 깊게 풀이함. 사진 미제공이나 관찰 한계는 언급하지 않음' },
        { key: 'currentFlow', title: '지금 들어온 흐름', lead: LEAD, keywords: KEY, content: 'string · 최소 3,000자 · 잘 풀리는 일/늦어지는 일/흐름이 바뀌는 때와 판단 기준을 구체적으로 다룸' },
        { key: 'workTalent', title: '일과 재능', lead: LEAD, keywords: KEY, content: 'string · 최소 3,000자 · 맞는 일의 방식/잘 맞는 조직/리더가 되었을 때의 장단점과 현실 사례를 깊게 다룸' },
        { key: 'moneyBusiness', title: '돈과 사업', lead: LEAD, keywords: KEY, content: 'string · 최소 3,000자 · 돈을 버는 구조/돈이 새는 습관/사업과 투자의 함정 및 판단 기준을 깊게 다룸' },
        { key: 'loveMarriage', title: '연애와 결혼', lead: LEAD, keywords: KEY, content: 'string · 최소 3,000자 · 자꾸 끌리는 사람/반복되는 갈등/오래 갈 수 있는 관계와 실제 대화 패턴을 깊게 다룸' },
        { key: 'futureFlow', title: '앞으로의 큰 흐름', lead: LEAD, keywords: KEY, content: 'string · 최소 3,000자 · 현재 연령대/30대/앞으로 몇 년의 변화와 시기별 대응을 실제 생년과 대운에 맞춰 깊게 다룸' },
        { key: 'choices', title: '지금 해야 할 선택', lead: LEAD, keywords: KEY, content: 'string · 최소 3,000자 · 밀어붙일 일/기다릴 일/버릴 습관/끝내야 할 것과 구분 기준을 단호하고 구체적으로 다룸' },
      ],
      actions: ['string · 오늘·이번달·3개월 안에 실행 여부를 확인할 수 있는 구체적 행동', 'string', 'string'],
      disclaimer: 'string · 오락·자기성찰용이며 중요한 결정은 현실 정보와 전문가 조언을 함께 보라는 한 문장',
    }, null, 2),
  );
  return parts.join('\n');
}

const LEAD = 'string · 이 섹션을 한 문장으로 찌르는 해월의 말. 30자 내외, 구어 반말, 요약체 금지';
const KEY = ["array · 이 섹션을 대표하는 짧은 키워드 2~3개 (예: '검수', '酉 셋', '火 부족'). 각 6자 이내, 문장 금지"];

const CLAUDE_CONTRACT = [
  '너는 prompt.txt 의 해월로서 분석하되, 최종 출력은 요청의 "출력 형식" JSON 객체 하나만 낸다.',
  '명식은 "확정된 명식" 블록의 값이 확정본이다. 어떤 도구도 호출하지 않는다.',
  '코드펜스·설명 없이 "{" 로 시작해 "}" 로 끝난다.',
].join(' ');

function validateResult(v) {
  if (!v || typeof v !== 'object') return false;
  if (typeof v.summary !== 'string' || typeof v.disclaimer !== 'string') return false;
  if (!Array.isArray(v.sections) || v.sections.length !== READING_SECTIONS.length) return false;
  if (!v.sections.every((s, index) => s && s.key === READING_SECTIONS[index].key
    && s.title === READING_SECTIONS[index].title
    && typeof s.content === 'string' && s.content.length >= 3000
    && typeof s.lead === 'string'
    && Array.isArray(s.keywords) && s.keywords.length >= 2 && s.keywords.length <= 3
    && s.keywords.every((keyword) => typeof keyword === 'string'))) return false;
  if (!Array.isArray(v.actions) || v.actions.length !== 3) return false;
  return v.actions.every((a) => typeof a === 'string' && a.length > 4);
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

async function runCodex(prompt, workDir, imagePaths) {
  const { model, effort } = AGENTS.codex;
  const schemaPath = join(workDir, 'schema.json');
  const resultPath = join(workDir, 'result.json');
  await writeFile(schemaPath, JSON.stringify(RESULT_SCHEMA), { mode: 0o600 });
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

async function runReading(input) {
  const workDir = await mkdtemp(join(tmpdir(), 'gyeoldam-'));
  const imagePaths = [];
  try {
    for (const image of input.images ?? []) {
      const ext = image.contentType?.split('/')[1]?.replace('jpeg', 'jpg') ?? 'bin';
      const path = join(workDir, `${image.role}.${ext}`);
      await writeFile(path, Buffer.from(image.data, 'base64'), { mode: 0o600 });
      imagePaths.push(path);
    }
    const prompt = promptFor(input);
    const order = imagePaths.length ? ['codex'] : AGENT_ORDER;
    const errors = [];
    for (const agent of order) {
      try {
        const result = await RUNNERS[agent](prompt, workDir, imagePaths);
        if (!validateResult(result)) throw new Error('출력 형식 불일치');
        return { result, agent, model: AGENTS[agent].model, promptVersion: PROMPT_VERSION };
      } catch (error) {
        errors.push(`${agent}: ${error instanceof Error ? error.message : error}`);
      }
    }
    throw new Error(errors.join(' | ') || '모든 에이전트 실패');
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
    SELECT status, result, chart, error_text, agent, model, birth_date, date_type, birth_time, gender
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
    return send(response, 200, { id, status: 'completed', agent: row.agent, model: row.model, chart, ...row.result });
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

await migrate();
server.listen(PORT, HOST, () => console.log(`gyeoldam-api on ${HOST}:${PORT} (prompt ${PROMPT_VERSION}, agents ${AGENT_ORDER.join('>')})`));

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    await sql.end({ timeout: 5 });
    server.close(() => process.exit(0));
  });
}
