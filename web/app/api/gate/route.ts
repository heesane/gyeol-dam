import { NextRequest, NextResponse } from 'next/server';

const PASS = process.env.SITE_PASSWORD ?? 'deTmaDloeyG';

export async function POST(req: NextRequest) {
  const { code } = await req.json().catch(() => ({ code: '' }));
  if (typeof code !== 'string' || code !== PASS) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set('gd_gate', PASS, {
    httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
