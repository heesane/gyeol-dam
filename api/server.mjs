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
const PROMPT_VERSION = '2026-09-08';
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

// 프론트가 렌더하는 구조. prompt.txt #36 "다섯 묶음" + "지금 할 일 세 가지".
const RESULT_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    summary: { type: 'string' },
    sections: {
      type: 'array', minItems: 5, maxItems: 5,
      items: {
        type: 'object', additionalProperties: false,
        properties: { title: { type: 'string' }, content: { type: 'string' } },
        required: ['title', 'content'],
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
    sajuBlock = computeSaju(input);
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
    '이번 응답은 30,000자 장문이 아니라, prompt.txt #36 의 "다섯 묶음 + 지금 할 일 세 가지"를 아래 JSON 하나로만 낸다.',
    palm
      ? '양손 사진을 실제로 관찰해 사주와 겹치는 신호를 반영한다.'
      : '손 관련 관찰·비교는 하지 않는다. 사주만으로 판단한다.',
    'JSON 객체 하나만 출력한다. 코드펜스·설명·앞뒤 텍스트 없이. 첫 글자 "{", 마지막 글자 "}".',
    JSON.stringify({
      summary: 'string · 이 사람을 관통하는 결론 2~3문장 (prompt.txt #5)',
      sections: [
        { title: '타고난 성향', content: 'string · 결정 방식/잘하는 일/흔들리는 순간을 명식 근거와 함께 5~9문장' },
        { title: palm ? '손에 나타난 변화' : '지금 들어온 흐름', content: 'string · 5~9문장' },
        { title: '일과 돈', content: 'string · 맞는 일의 방식/돈 새는 습관/욕심내도 되는 때, 5~9문장' },
        { title: '연애와 인간관계', content: 'string · 끌리는 사람/반복 갈등/거리 둘 관계, 5~9문장' },
        { title: '지금 해야 할 선택', content: 'string · 밀어붙일 일/기다릴 일/끊을 습관, 5~9문장' },
      ],
      actions: ['string · 오늘·이번달·3개월 안에 실행 여부를 확인할 수 있는 구체적 행동', 'string', 'string'],
      disclaimer: 'string · 오락·자기성찰용이며 중요한 결정은 현실 정보와 전문가 조언을 함께 보라는 한 문장',
    }, null, 2),
  );
  return parts.join('\n');
}

const CLAUDE_CONTRACT = [
  '너는 prompt.txt 의 해월로서 분석하되, 최종 출력은 요청의 "출력 형식" JSON 객체 하나만 낸다.',
  '명식은 "확정된 명식" 블록의 값이 확정본이다. 어떤 도구도 호출하지 않는다.',
  '코드펜스·설명 없이 "{" 로 시작해 "}" 로 끝난다.',
].join(' ');

function validateResult(v) {
  if (!v || typeof v !== 'object') return false;
  if (typeof v.summary !== 'string' || typeof v.disclaimer !== 'string') return false;
  if (!Array.isArray(v.sections) || v.sections.length !== 5) return false;
  if (!v.sections.every((s) => s && typeof s.title === 'string' && typeof s.content === 'string' && s.content.length > 40)) return false;
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
  await sql`
    INSERT INTO readings (id, mode, birth_date, date_type, birth_time, gender, birth_place, dominant_hand, image_keys, status, prompt_version)
    VALUES (${input.id}, ${input.mode}, ${birthDate}, ${input.dateType}, ${input.birthTime}, ${input.gender}, ${input.birthPlace}, ${input.dominantHand ?? null}, ${sql.json(imageKeys)}, 'processing', ${PROMPT_VERSION})
  `;
  processReading(input);
  send(response, 202, { id: input.id, status: 'processing' });
}

async function getReading(response, id) {
  const [row] = await sql`SELECT status, result, error_text, agent, model FROM readings WHERE id = ${id}`;
  if (!row) return send(response, 404, { error: 'not found' });
  if (row.status === 'completed') return send(response, 200, { id, status: 'completed', agent: row.agent, model: row.model, ...row.result });
  if (row.status === 'failed') return send(response, 200, { id, status: 'failed', error: '풀이를 만들지 못했어. 잠시 뒤 다시 해줘.' });
  return send(response, 200, { id, status: 'processing' });
}

async function migrate() {
  for (const col of ['agent TEXT', 'model TEXT', 'prompt_version TEXT', 'analysis TEXT']) {
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
