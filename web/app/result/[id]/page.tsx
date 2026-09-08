'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { ArrowLeft, Sparkle } from 'lucide-react';

type ReadingResult = {
  status?: string;
  error?: string;
  summary: string;
  sections: Array<{ title: string; content: string }>;
  actions: string[];
  disclaimer: string;
};

const MARK = ['一', '二', '三', '四', '五'];

export default function ResultPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<ReadingResult | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    fetch(`/api/reading/${id}`)
      .then((r) => r.json())
      .then((res: ReadingResult) => {
        if (!alive) return;
        if (res.status === 'completed' && res.sections?.length) setData(res);
        else if (res.status === 'processing') setError('아직 풀이 중이야. 잠시 뒤 다시 열어줘.');
        else setError(res.error ?? '풀이를 찾지 못했어.');
      })
      .catch(() => alive && setError('풀이를 불러오지 못했어.'));
    return () => { alive = false; };
  }, [id]);

  return (
    <main className="reading-page">
      <header className="rpg-top">
        <Link href="/" className="rpg-back"><ArrowLeft size={15} /> 처음으로</Link>
        <span className="rpg-mark">結談 · 해월의 풀이</span>
      </header>

      {!data && !error && <p className="rpg-loading">풀이를 펼치는 중…</p>}
      {error && <p className="rpg-error">{error}</p>}

      {data && (
        <article className="rpg-body">
          <div className="rpg-lead">
            <div className="rpg-persona"><Image src="/images/haewol-main.webp" alt="해월" fill sizes="88px" /></div>
            <p>{data.summary}</p>
          </div>

          <div className="rpg-sections">
            {data.sections.map((s, i) => (
              <section key={s.title}>
                <span className="rpg-num">{MARK[i]}</span>
                <div>
                  <h2>{s.title}</h2>
                  <p>{s.content}</p>
                </div>
              </section>
            ))}
          </div>

          <section className="rpg-actions">
            <h2><Sparkle size={16} /> 지금 할 일 세 가지</h2>
            <ol>{data.actions.map((a, i) => <li key={i}>{a}</li>)}</ol>
          </section>

          <p className="rpg-disclaimer">{data.disclaimer}</p>
          <Link href="/#reading" className="rpg-again">다시 보고 싶으면 처음으로 →</Link>
        </article>
      )}
    </main>
  );
}
