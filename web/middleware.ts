import { NextRequest, NextResponse } from 'next/server';

// 프론트 레벨 암호 게이트. /gate UI 에서 코드를 받고 httpOnly 쿠키를 심는다.
const PASS = process.env.SITE_PASSWORD ?? 'deTmaDloeyG';

// SNS 링크 미리보기 크롤러 — HTML(og 메타)만 필요하니 게이트 통과시킨다.
// 풀이 본문은 클라이언트에서 /api/reading 으로 가져오고 그건 여전히 쿠키가 필요하므로,
// 크롤러는 일반 메타(layout.tsx) + OG 이미지만 본다.
const CRAWLER = /facebookexternalhit|Facebot|Twitterbot|Slackbot|TelegramBot|WhatsApp|kakaotalk-scrap|Discordbot|LinkedInBot|Applebot|Pinterest|redditbot|Googlebot|bingbot|Yeti/i;

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname === '/gate' || pathname === '/api/gate') return NextResponse.next();
  if (req.cookies.get('gd_gate')?.value === PASS) return NextResponse.next();
  if (!pathname.startsWith('/api/') && CRAWLER.test(req.headers.get('user-agent') ?? '')) {
    return NextResponse.next();
  }

  const url = req.nextUrl.clone();
  url.pathname = '/gate';
  url.search = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|images/|opengraph-image|twitter-image).*)'],
};
