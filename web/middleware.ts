import { NextRequest, NextResponse } from "next/server";

// 브라우저 레벨 비밀번호 게이트 (HTTP Basic). 아이디는 아무거나, 비번만 확인.
const PASSWORD = process.env.SITE_PASSWORD ?? "deTmaDloeyG";

export function middleware(req: NextRequest) {
  const header = req.headers.get("authorization");
  if (header?.startsWith("Basic ")) {
    try {
      const decoded = atob(header.slice(6));
      const pass = decoded.slice(decoded.indexOf(":") + 1);
      if (pass === PASSWORD) return NextResponse.next();
    } catch {
      /* fall through */
    }
  }
  return new NextResponse("인증이 필요합니다.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="gyeoldam", charset="UTF-8"' },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
