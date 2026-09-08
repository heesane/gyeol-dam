# 결담 (gyeol-dam)

사주/손금 풀이 서비스. 서버의 로그인된 `codex` / `claude` CLI 토큰으로 풀이를 생성한다.

```
브라우저 ─(비번 게이트)→ Vercel(web) ─(server, 토큰 보관)→ gyeoldam-api(api) ─→ codex|claude
                                                          └→ Postgres(gyeoldam) readings
```

## web/ — 프론트 (Vercel 배포)

- Next.js 16 App Router. `heesane/gyeol-dam` 연결, **Root Directory = `web`**.
- `middleware.ts` + `app/gate/` — 암호 게이트 UI (쿠키 기반).
- `app/api/reading[/id]` — `GYEOLDAM_API_TOKEN` 을 서버에서만 들고 gyeoldam-api 로 프록시. POST 즉시 `{id}`, GET 폴링.
- `app/page.tsx` — 해월 페르소나 랜딩 + 입력 폼 → 폴링 → 결과 화면(8섹션 + 3액션).

**Vercel 환경변수** (Production/Preview/Development):

| 키 | 값 |
| --- | --- |
| `SITE_PASSWORD` | 브라우저 게이트 비번 |
| `GYEOLDAM_API_BASE` | `https://gyeoldam-api.<host>.sslip.io` |
| `GYEOLDAM_API_TOKEN` | 서버 `/data/gyeoldam/.env` 의 값 |

## api/ — 풀이 API (서버 상주)

- `/data/gyeoldam/app/` 에 배포, `gyeoldam-api.service` (systemd, `127.0.0.1:3110`).
- `POST /v1/readings` → `202 {id}` · `GET /v1/readings/:id` 폴링 · `GET /health`.
- `saju.mjs` — `lunar-javascript` 로 팔자·오행·십성·대운을 **서버에서 결정론적 계산** → 프롬프트에 "확정된 명식"으로 주입. LLM 은 만세력 웹조사 안 함 (시간·비용↓, 명식 고정).
- 모델 고정: codex `gpt-5.6-sol` medium → 실패 시 claude `claude-opus-5` medium. 전역 CLI 설정과 분리.
- 출력: `{summary, sections[8], actions[3], disclaimer}`. 섹션은 `innate → palm → currentFlow → workTalent → moneyBusiness → loveMarriage → futureFlow → choices` 순서로 고정하며 API와 프론트가 같은 계약을 검증한다.

### prompt.txt (비공개)

해월 페르소나·분석 규칙 원본. **repo 에 커밋하지 않음** (`.gitignore`). `api/prompt.txt` 로 로컬에 두고
`deploy.sh` 가 서버로 rsync. 없으면 `gyeoldam-api` 기동 실패.

### 배포

```bash
cd api && DEPLOY_TARGET=ubuntu@<host> ./deploy.sh
```

`.env` (`DATABASE_URL`, `GYEOLDAM_API_TOKEN`, `PORT`, `HOST`, `CODEX_HOME`, `GYEOLDAM_AGENT_ORDER`) 는 서버에만.
