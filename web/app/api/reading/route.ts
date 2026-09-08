import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';

const API_BASE = process.env.GYEOLDAM_API_BASE ?? 'https://gyeoldam-api.152-67-197-159.sslip.io';
const TOKEN = process.env.GYEOLDAM_API_TOKEN ?? '';

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

function str(form: FormData, key: string) {
  const v = form.get(key);
  return typeof v === 'string' ? v.trim() : '';
}

async function imageEntry(file: FormDataEntryValue | null, role: string) {
  if (!(file instanceof File) || file.size === 0) return null;
  if (!IMAGE_TYPES.has(file.type)) throw new Error('JPG, PNG, WEBP, HEIC 사진만 올릴 수 있어.');
  if (file.size > MAX_IMAGE_BYTES) throw new Error('사진 한 장은 8MB보다 작아야 해.');
  const bytes = Buffer.from(await file.arrayBuffer());
  return { role, contentType: file.type, data: bytes.toString('base64'), objectKey: `${role}` };
}

// 브라우저에 토큰을 노출하지 않도록 서버에서 프록시. POST 는 즉시 202 + id.
export async function POST(req: NextRequest) {
  if (!TOKEN) return NextResponse.json({ error: '풀이 서버가 아직 연결되지 않았어.' }, { status: 503 });
  try {
    const form = await req.formData();
    const mode = str(form, 'mode');
    const birthDate = str(form, 'birthDate');
    const dateType = str(form, 'dateType');
    const birthTime = str(form, 'birthTime');
    const gender = str(form, 'gender');
    const birthPlace = str(form, 'birthPlace');
    const dominantHand = str(form, 'dominantHand');

    if (!['saju', 'saju_palm'].includes(mode) || !/^\d{4}\.\d{2}\.\d{2}$/.test(birthDate) ||
        !['solar', 'lunar'].includes(dateType) || !/^\d{2}:\d{2}$/.test(birthTime) ||
        !['female', 'male'].includes(gender) || birthPlace.length < 2 || birthPlace.length > 80) {
      return NextResponse.json({ error: '입력한 출생정보를 다시 확인해줘.' }, { status: 400 });
    }

    const images = [];
    const main = await imageEntry(form.get('mainPalm'), 'main');
    const other = await imageEntry(form.get('otherPalm'), 'other');
    if (mode === 'saju_palm') {
      if (!main || !other || !['right', 'left'].includes(dominantHand)) {
        return NextResponse.json({ error: '손금을 같이 보려면 양손 사진과 주로 쓰는 손을 알려줘.' }, { status: 400 });
      }
      images.push(main, other);
    }

    const id = randomUUID();
    const upstream = await fetch(`${API_BASE.replace(/\/$/, '')}/v1/readings`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${TOKEN}`,
        'x-client-ip': (req.headers.get('x-forwarded-for') ?? 'web').split(',')[0].trim(),
      },
      body: JSON.stringify({
        id, mode, birthDate, dateType, birthTime, gender, birthPlace,
        dominantHand: mode === 'saju_palm' ? dominantHand : null, images,
      }),
    });
    const data = await upstream.json().catch(() => ({ error: 'upstream 오류' }));
    return NextResponse.json({ id, ...data }, { status: upstream.status });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '풀이를 만들지 못했어.' }, { status: 502 });
  }
}
