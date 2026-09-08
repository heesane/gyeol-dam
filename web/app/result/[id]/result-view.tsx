'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { ArrowLeft, Check, Share2, Sparkle } from 'lucide-react';

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
  sections: Array<{ title: string; content: string; lead?: string; keywords?: string[] }>;
  actions: string[];
  disclaimer: string;
  chart?: Chart | null;
};

const MARK = ['一', '二', '三', '四', '五'];
const WX = ['목', '화', '토', '금', '수'] as const;
// api/saju.mjs 의 GAN_WX / ZHI_WX 와 같은 표 (명식 글자에 오행 색을 입히려고 프론트에도 둔다)
const CHAR_WX: Record<string, string> = {
  甲: '목', 乙: '목', 丙: '화', 丁: '화', 戊: '토', 己: '토', 庚: '금', 辛: '금', 壬: '수', 癸: '수',
  子: '수', 丑: '토', 寅: '목', 卯: '목', 辰: '토', 巳: '화', 午: '화', 未: '토', 申: '금', 酉: '금', 戌: '토', 亥: '수',
};

function MyeongsikCard({ c }: { c: Chart }) {
  const cols: Array<[string, Pillar, string]> = [
    ['년', c.pillars.year, c.sipseong.year],
    ['월', c.pillars.month, c.sipseong.month],
    ['일', c.pillars.day, '일간'],
    ['시', c.pillars.time, c.sipseong.time],
  ];
  const maxWx = Math.max(1, ...WX.map((k) => c.wuxing[k]));
  // 현재 대운 = 시작연도가 올해 이하인 마지막 구간
  const nowYear = new Date().getFullYear();
  const curAge = c.daYun.filter((d) => d.year <= nowYear).at(-1)?.age;
  const nowChip = useRef<HTMLSpanElement>(null);
  // 대운은 가로 스크롤이라 현재 구간이 화면 밖일 수 있다.
  useEffect(() => { nowChip.current?.scrollIntoView({ block: 'nearest', inline: 'center' }); }, [curAge]);
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
            <span className="ms-han" data-el={CHAR_WX[p.gan]}>{p.gan}</span>
            <span className="ms-ko">{p.ganKo}</span>
            <span className="ms-han" data-el={CHAR_WX[p.zhi]}>{p.zhi}</span>
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
              <span
                className={`ms-dayun-chip${d.age === curAge ? ' is-now' : ''}`}
                ref={d.age === curAge ? nowChip : undefined}
                key={d.age}
              >
                <b>{d.age}세</b> {d.gz}({d.gzKo})
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

export default function ResultView({ id }: { id: string }) {
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

  const share = async () => {
    const url = `${window.location.origin}/?id=${id}`;
    // text 를 함께 넘기면 카톡 등에서 URL 과 붙어버려 url 만 공유 (미리보기 카드가 설명을 대신함)
    if (navigator.share) {
      try { await navigator.share({ url }); return; } catch { /* 취소/미지원 → 복사로 폴백 */ }
    }
    try {
      await navigator.clipboard.writeText(url);
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
                {s.keywords && s.keywords.length > 0 && (
                  <div className="rpg-keys">{s.keywords.map((k) => <span key={k}>{k}</span>)}</div>
                )}
                {s.lead && <p className="rpg-lead-line">{s.lead}</p>}
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
            <button type="button" className="rpg-copy" onClick={share}>
              {copied ? <><Check size={14} /> 링크 복사됨</> : <><Share2 size={14} /> 이 풀이 공유</>}
            </button>
            <Link href="/#reading" className="rpg-again">다시 보기 →</Link>
          </div>
        </div>
      )}
    </main>
  );
}

