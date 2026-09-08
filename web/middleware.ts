import { NextRequest, NextResponse } from 'next/server';

// 프론트 레벨 암호 게이트. /gate UI 에서 코드를 받고 httpOnly 쿠키를 심는다.
const PASS = process.env.SITE_PASSWORD ?? 'deTmaDloeyG';

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname === '/gate' || pathname === '/api/gate') return NextResponse.next();
  if (req.cookies.get('gd_gate')?.value === PASS) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = '/gate';
  url.search = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|images/).*)'],
};
