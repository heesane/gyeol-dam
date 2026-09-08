'use client';

import { use, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { ArrowLeft, Check, Link2, Sparkle } from 'lucide-react';

type Pillar = { gan: string; ganKo: string; zhi: string; zhiKo: string };
type Chart = {
  solar: string;
  pillars: { year: Pillar; month: Pillar; day: Pillar; time: Pillar };
  dayGan: string; dayGanKo: string; dayElement: string;
  wuxing: Record<'목' | '화' | '토' | '금' | '수', number>;
  sipseong: { year: string; month: string; time: string };
  daYunDir: string;
  daYun: Array<{ age: number; year: number; gz: string; gzKo: string }>;
};
type Reading = {
  status?: string; error?: string;
  summary: string;
  sections: Array<{ title: string; content: string }>;
  actions: string[];
  disclaimer: string;
  chart?: Chart | null;
};

const MARK = ['一', '二', '三', '四', '五'];
const WX = ['목', '화', '토', '금', '수'] as const;

function MyeongsikCard({ c }: { c: Chart }) {
  const cols: Array<[string, Pillar, string]> = [
    ['년', c.pillars.year, c.sipseong.year],
    ['월', c.pillars.month, c.sipseong.month],
    ['일', c.pillars.day, '일간'],
    ['시', c.pillars.time, c.sipseong.time],
  ];
  const maxWx = Math.max(1, ...WX.map((k) => c.wuxing[k]));
  return (
    <section className="myeongsik">
      <div className="ms-head">
        <span className="ms-tag">명식</span>
        <span className="ms-meta">{c.solar.replaceAll('-', '.')} · 일간 {c.dayGan}({c.dayGanKo}) {c.dayElement}</span>
      </div>
      <div className="ms-grid">
        {cols.map(([label, p, ss]) => (
          <div className={`ms-col${label === '일' ? ' is-day' : ''}`} key={label}>
            <span className="ms-label">{label}주</span>
            <span className="ms-ss">{ss || ' '}</span>
            <span className="ms-han">{p.gan}</span>
            <span className="ms-ko">{p.ganKo}</span>
            <span className="ms-han">{p.zhi}</span>
            <span className="ms-ko">{p.zhiKo}</span>
          </div>
        ))}
      </div>
      <div className="ms-wx">
        {WX.map((k) => (
          <div className="ms-wx-row" key={k} data-el={k}>
            <span className="ms-wx-key">{k}</span>
            <span className="ms-wx-bar"><span style={{ width: `${(c.wuxing[k] / maxWx) * 100}%` }} /></span>
            <span className="ms-wx-n">{c.wuxing[k]}</span>
          </div>
        ))}
      </div>
      {c.daYun.length > 0 && (
        <div className="ms-dayun">
          <span className="ms-dayun-key">대운 <b>{c.daYunDir}</b></span>
          <div className="ms-dayun-list">
            {c.daYun.map((d) => (
              <span className="ms-dayun-chip" key={d.age}><b>{d.age}세</b> {d.gz}({d.gzKo})</span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function Result({ id }: { id: string }) {
  const [data, setData] = useState<Reading | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [bar, setBar] = useState(0);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/reading/${id}`)
      .then((r) => r.json())
      .then((res: Reading) => {
        if (!alive) return;
        if (res.status === 'completed' && res.sections?.length) setData(res);
        else if (res.status === 'processing') setError('아직 풀이 중이야. 잠시 뒤 다시 열어줘.');
        else setError(res.error ?? '풀이를 찾지 못했어.');
      })
      .catch(() => alive && setError('풀이를 불러오지 못했어.'));
    return () => { alive = false; };
  }, [id]);

  useEffect(() => {
    const onScroll = () => {
      const el = bodyRef.current;
      if (!el) return;
      const total = el.scrollHeight - window.innerHeight;
      setBar(total > 0 ? Math.min(100, Math.max(0, (window.scrollY - el.offsetTop + 80) / total * 100)) : 0);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, [data]);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/?id=${id}`);
      setCopied(true); setTimeout(() => setCopied(false), 1600);
    } catch { /* noop */ }
  };

  return (
    <main className="reading-page">
      <div className="rpg-bar" style={{ width: `${bar}%` }} />
      <header className="rpg-top">
        <Link href="/" className="rpg-back"><ArrowLeft size={15} /> 처음으로</Link>
        <span className="rpg-mark">結談 · 해월의 풀이</span>
      </header>

      {!data && !error && <p className="rpg-loading">풀이를 펼치는 중…</p>}
      {error && <p className="rpg-error">{error}</p>}

      {data && (
        <div className="rpg-body" ref={bodyRef}>
          <div className="rpg-lead">
            <div className="rpg-persona"><Image src="/images/haewol-main.webp" alt="해월" fill sizes="88px" /></div>
            <blockquote>{data.summary}</blockquote>
          </div>

          {data.chart && <MyeongsikCard c={data.chart} />}

          <nav className="rpg-toc" aria-label="풀이 목차">
            {data.sections.map((s, i) => (
              <a key={s.title} href={`#sec-${i}`}><span>{MARK[i]}</span>{s.title}</a>
            ))}
          </nav>

          <article className="rpg-sections">
            {data.sections.map((s, i) => (
              <section id={`sec-${i}`} key={s.title}>
                <h2><span className="rpg-num">{MARK[i]}</span>{s.title}</h2>
                <p>{s.content}</p>
              </section>
            ))}
          </article>

          <section className="rpg-actions">
            <h2><Sparkle size={16} /> 지금 할 일 세 가지</h2>
            <ol>{data.actions.map((a, i) => <li key={i}>{a}</li>)}</ol>
          </section>

          <p className="rpg-disclaimer">{data.disclaimer}</p>
          <div className="rpg-foot">
            <button type="button" className="rpg-copy" onClick={copyLink}>
              {copied ? <><Check size={14} /> 복사됨</> : <><Link2 size={14} /> 이 풀이 링크 복사</>}
            </button>
            <Link href="/#reading" className="rpg-again">다시 보기 →</Link>
          </div>
        </div>
      )}
    </main>
  );
}

export default function ResultPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <Result id={id} />;
}
