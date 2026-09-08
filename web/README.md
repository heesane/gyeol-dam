# gyeoldam/web

결담 프론트. Next.js 16 (App Router). **Vercel 배포** (GPT Sites 아님).

- `middleware.ts` — HTTP Basic 비밀번호 게이트. 아이디 아무거나, 비번은 `SITE_PASSWORD`(기본값 코드에 내장). 실제값은 CONNECTION.md.
- `app/api/reading/route.ts` — POST. `GYEOLDAM_API_TOKEN` 을 서버에서만 들고 gyeoldam-api 로 프록시. 즉시 `{id}` 반환.
- `app/api/reading/[id]/route.ts` — GET. 상태 폴링.
- `app/page.tsx` — 폼 → POST → 4초 간격 폴링 → 결과(5섹션 + 3행동 + 요약 + 고지) 렌더.

## 환경변수 (Vercel Project → Settings → Environment Variables)

| 키 | 값 |
| --- | --- |
| `SITE_PASSWORD` | 브라우저 게이트 비번 (CONNECTION.md) |
| `GYEOLDAM_API_BASE` | `https://gyeoldam-api.152-67-197-159.sslip.io` |
| `GYEOLDAM_API_TOKEN` | 서버 `/data/gyeoldam/.env` 의 `GYEOLDAM_API_TOKEN` |

## 배포

```bash
cd gyeoldam/web
npx vercel login          # 최초 1회 (브라우저 인증)
npx vercel link           # 프로젝트 생성/연결
npx vercel env add SITE_PASSWORD production
npx vercel env add GYEOLDAM_API_BASE production
npx vercel env add GYEOLDAM_API_TOKEN production
npx vercel --prod
```

또는 GitHub 연동: Vercel 대시보드에서 `heesane/Oracle` import → Root Directory `gyeoldam/web` → 위 env 3개 등록 → Deploy.

## 로컬

```bash
cp .env.example .env.local   # 값 채우기
npm install && npm run dev
```

## 주의

- 모델 호출이 1~3분 → API 는 비동기(202 + 폴링). `/api/reading` POST 는 짧게 끝나므로 Vercel Hobby 60s 제한 안에 들어옴.
- gyeoldam-api 레이트리밋: client IP 10분 3회.
