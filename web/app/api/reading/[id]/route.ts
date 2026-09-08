import { NextRequest, NextResponse } from "next/server";

const API_BASE = process.env.GYEOLDAM_API_BASE ?? "https://gyeoldam-api.152-67-197-159.sslip.io";
const TOKEN = process.env.GYEOLDAM_API_TOKEN ?? "";

// 풀이 상태 폴링용 프록시.
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const upstream = await fetch(`${API_BASE}/v1/readings/${id}`, {
    headers: { authorization: `Bearer ${TOKEN}` },
    cache: "no-store",
  });
  const data = await upstream.json().catch(() => ({ error: "upstream 오류" }));
  return NextResponse.json(data, { status: upstream.status });
}
