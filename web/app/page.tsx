'use client';

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { ArrowDown, ArrowRight, Check, ImagePlus, LockKeyhole, ScanLine, ShieldCheck, Sparkle } from 'lucide-react';

type HandSide = '오른손' | '왼손';
type ReadingMode = '사주' | '사주·손금';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function formatBirthDate(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 4) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 4)}.${digits.slice(4)}`;
  return `${digits.slice(0, 4)}.${digits.slice(4, 6)}.${digits.slice(6)}`;
}

function HandPhoto({ name, label, note, file, required = false, onChange }: { name: string; label: string; note: string; file: File | null; required?: boolean; onChange: (file: File | null) => void }) {
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : ''), [file]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  return <label className={`photo-drop ${file ? 'is-ready' : ''}`}>
    <input name={name} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" required={required} onChange={(event) => onChange(event.target.files?.[0] ?? null)} />
    {preview ? <><Image src={preview} alt={`${label} 미리보기`} fill unoptimized sizes="(max-width: 600px) 50vw, 320px" /><span className="photo-status"><Check size={15} /> 사진 올렸어</span></> : <><ImagePlus className="photo-icon" size={25} strokeWidth={1.7} /><span className="photo-label">{label}</span><span className="photo-note">{note}</span><span className="photo-action">사진 고르기 <ArrowRight size={14} /></span></>}
  </label>;
}

export default function Home() {
  const [readingMode, setReadingMode] = useState<ReadingMode>('사주');
  const [birthDate, setBirthDate] = useState('');
  const [dominant, setDominant] = useState<HandSide>('오른손');
  const [mainPhoto, setMainPhoto] = useState<File | null>(null);
  const [otherPhoto, setOtherPhoto] = useState<File | null>(null);
  const [calendar, setCalendar] = useState<'양력' | '음력'>('양력');
  const [doneId, setDoneId] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [phase, setPhase] = useState('');
  const [progress, setProgress] = useState(0); // 0~100, 대략치
  const [elapsed, setElapsed] = useState(0); // 초
  const [error, setError] = useState('');
  const router = useRouter();
  const otherHand = dominant === '오른손' ? '왼손' : '오른손';
  const includesPalm = readingMode === '사주·손금';

  const chooseReadingMode = (mode: ReadingMode) => {
    setReadingMode(mode);
    if (mode === '사주') {
      setMainPhoto(null);
      setOtherPhoto(null);
    }
  };

  const submitReading = async (event: React.SyntheticEvent<HTMLFormElement, SubmitEvent>) => {
    event.preventDefault();
    setIsLoading(true);
    setError('');
    setDoneId('');
    setPhase('입력 확인 중');
    setProgress(4);
    setElapsed(0);
    const TARGET = includesPalm ? 210 : 150; // 대략 완료 예상(초) — 바 채우는 기준일 뿐
    try {
      const form = new FormData(event.currentTarget);
      form.set('mode', includesPalm ? 'saju_palm' : 'saju');
      form.set('birthDate', birthDate);
      form.set('dateType', calendar === '양력' ? 'solar' : 'lunar');
      form.set('gender', form.get('gender') === '여성' ? 'female' : 'male');
      form.set('dominantHand', dominant === '오른손' ? 'right' : 'left');

      const start = await fetch('/api/reading', { method: 'POST', body: form }).then((r) => r.json());
      if (!start.id) throw new Error(start.error ?? '풀이를 시작하지 못했어.');

      setPhase('명식을 세우는 중');
      setProgress(12);
      const started = Date.now();
      while (Date.now() - started < 20 * 60_000) {
        await wait(3000);
        const sec = Math.round((Date.now() - started) / 1000);
        setElapsed(sec);
        setProgress(Math.min(94, 12 + (sec / TARGET) * 82));
        setPhase(sec < 12 ? '명식을 세우는 중' : '해월이 흐름을 읽는 중');

        const res = await fetch(`/api/reading/${start.id}`).then((r) => r.json());
        if (res.status === 'completed') {
          setProgress(100);
          setPhase('풀이 완성');
          await wait(500);
          setDoneId(start.id);
          return;
        }
        if (res.status === 'failed') throw new Error(res.error ?? '풀이 생성 실패');
      }
      throw new Error('시간이 너무 걸려. 잠시 뒤 다시 해줘.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '풀이를 만들지 못했어. 잠시 뒤 다시 해줘.');
    } finally {
      setIsLoading(false);
      setPhase('');
      setProgress(0);
    }
  };

  const elapsedLabel = elapsed >= 60 ? `${Math.floor(elapsed / 60)}분 ${elapsed % 60}초` : `${elapsed}초`;

  return <main id="top">
    <header className="nav"><a className="wordmark" href="#top" aria-label="결담 처음으로"><span>結談</span><strong>결담</strong></a><p>해월의 사주 · 손금</p><a className="nav-cta" href="#reading">내 사주 보기 <ArrowDown size={15} /></a></header>

    <section className="hero">
      <div className="hero-index" aria-hidden="true">PALM<br />&amp; TIME<br />READING</div>
      <div className="hero-main"><div className="hook-line"><Sparkle size={17} /> 요즘 왜 자꾸 꼬이는지, 이유는 있어</div><h1>너 요즘,<br /><em>되는 일이 없지?</em></h1><p className="hero-copy">운이 나쁜 건지, 같은 선택을 반복한 건지.<br className="desktop-only" /> 태어난 때와 손에 남은 걸 같이 보자.</p><a className="hero-cta" href="#reading">뭐가 문제인지 봐줘 <ArrowRight size={19} /></a></div>
      <figure className="hero-figure"><Image src="/images/haewol-main.webp" alt="결담의 무당 해월" fill priority sizes="(max-width: 920px) 100vw, 34vw" /><figcaption><span><b>해월</b> · 결담의 무당</span><strong>좋은 말만 골라 하진 않아.<br />보이는 대로 말해줄게.</strong></figcaption></figure>
      <div className="hero-bottom"><span>타고난 성향</span><span>요즘 들어온 흐름</span><span>반복하는 선택</span></div>
    </section>

    <section className="persona"><div className="persona-name"><span>海月 · 해월</span><h2>둘러대도<br />다 보여.</h2></div><div className="persona-voice"><blockquote>“좋은 얘기만 들으러 왔으면<br />잘못 찾아왔어.”</blockquote><p>해월은 말을 돌리지 않아. 네가 자꾸 같은 데서 막힌다면, 운부터 탓하기 전에 반복해 온 선택을 먼저 봐. 그리고 지금 당장 바꿀 수 있는 것만 남겨.</p></div><dl><div><dt>보는 것</dt><dd>성향, 인연, 돈 쓰는 습관, 일의 흐름, 움직일 때와 버틸 때</dd></div><div><dt>말하지 않는 것</dt><dd>수명, 질병, 사고 시점, 투자 수익처럼 함부로 단정하면 안 되는 것</dd></div><div><dt>풀이 방식</dt><dd>반복되는 문제를 찾고, 원인을 짚고, 지금 바꿀 수 있는 걸 말해줘</dd></div></dl></section>

    <section className="reading-intro" id="reading"><div><h2>태어난 때부터<br />먼저 보자</h2></div><p>출생정보는 꼭 필요해. 손금도 보고 싶으면 손 사진을 올려. 사진 없이 사주만 봐도 돼.</p></section>

    <section className="reading-layout">
      <form onSubmit={submitReading}>
        <section className="form-section"><div className="section-title"><span>풀이 선택</span><div><h3>어디까지 볼까?</h3><p>손금까지 보려면 손 사진이 필요해.</p></div></div><fieldset className="reading-mode" aria-label="풀이 방식 선택"><button type="button" className={readingMode === '사주' ? 'active' : ''} aria-pressed={readingMode === '사주'} onClick={() => chooseReadingMode('사주')}><strong>사주만 볼래요</strong><span>출생정보만 입력하면 돼</span></button><button type="button" className={readingMode === '사주·손금' ? 'active' : ''} aria-pressed={readingMode === '사주·손금'} onClick={() => chooseReadingMode('사주·손금')}><strong>손금도 같이 볼래요</strong><span>사주와 손금을 함께 봐</span></button></fieldset>{includesPalm && <div className="palm-fields"><div className="palm-guide"><strong>손 사진을 올려줘</strong><span>손가락 끝부터 손목까지 나오면 돼.</span></div><div className="hand-choice"><span>주로 쓰는 손</span><fieldset aria-label="주로 사용하는 손">{(['오른손', '왼손'] as const).map((hand) => <button type="button" key={hand} className={dominant === hand ? 'active' : ''} onClick={() => setDominant(hand)}>{hand}</button>)}</fieldset><small>주로 쓰는 손에서 요즘의 변화를 봐.</small></div><div className="photo-grid"><HandPhoto name="mainPalm" label={`${dominant} · 주로 쓰는 손`} note="요즘의 선택과 변화" file={mainPhoto} required onChange={setMainPhoto} /><HandPhoto name="otherPalm" label={`${otherHand} · 반대 손`} note="타고난 성향" file={otherPhoto} required onChange={setOtherPhoto} /></div></div>}</section>

        <section className="form-section birth-section"><div className="section-title"><span>출생 정보 <b>필수</b></span><div><h3>태어난 때를 알려줘</h3><p>아는 만큼 정확하게 적어줘.</p></div></div><div className="field-grid"><label className="field wide"><span>생년월일</span><div className="date-row"><input name="birthDate" required type="text" inputMode="numeric" autoComplete="bday" placeholder="예: 1999.09.30" value={birthDate} maxLength={10} pattern="\d{4}\.\d{2}\.\d{2}" title="생년월일 8자리를 입력해줘" onChange={(event) => setBirthDate(formatBirthDate(event.target.value))} /><div className="calendar-type">{(['양력', '음력'] as const).map((item) => <button type="button" key={item} className={calendar === item ? 'active' : ''} onClick={() => setCalendar(item)}>{item}</button>)}</div></div><small>숫자 8자리로 입력해줘. 예: 19990930</small></label><label className="field"><span>태어난 시간</span><input name="birthTime" required type="time" /><small>모르면 가까운 시간으로 적어줘.</small></label><label className="field"><span>성별</span><select name="gender" required defaultValue=""><option value="" disabled>선택</option><option>여성</option><option>남성</option></select></label><label className="field wide"><span>태어난 곳</span><input name="birthPlace" required placeholder="예: 서울특별시" /><small>시·군까지 적으면 돼.</small></label></div></section>

        <div className="privacy-note"><ShieldCheck size={20} /><p><strong>올린 사진은 분석이 끝나면 바로 지워.</strong> 출생정보와 결과는 서비스 운영을 위해 저장돼. 사주와 손금은 자기성찰을 위한 오락 콘텐츠야.</p></div>{error && <p className="form-error" role="alert">{error}</p>}
        {doneId ? (
          <div className="reading-done">
            <div className="rp-track done"><div className="rp-fill" style={{ width: '100%' }} /></div>
            <p className="rd-msg">해월이 다 봤어.</p>
            <button className="submit" type="button" onClick={() => router.push(`/result/${doneId}`)}>결과 보러가기 <ArrowRight size={20} /></button>
          </div>
        ) : isLoading ? (
          <div className="reading-progress" role="status" aria-live="polite">
            <div className="rp-head"><span>{phase || '해월이 흐름을 읽는 중'}</span><span className="rp-time">{elapsedLabel}</span></div>
            <div className="rp-track"><div className="rp-fill" style={{ width: `${progress}%` }} /></div>
            <p className="rp-note"><LockKeyhole size={12} /> 보통 2~3분. 창을 닫지 마.</p>
          </div>
        ) : (
          <>
            <button className="submit" type="submit" disabled={isLoading}>{includesPalm ? '사주·손금 같이 보기' : '사주만 보기'} <ArrowRight size={20} /></button>
            <p className="submit-note"><LockKeyhole size={13} /> {includesPalm ? '태어난 때와 손에 겹쳐 보이는 부분을 찾아볼게.' : '손 사진 없이 바로 볼 수 있어.'}</p>
          </>
        )}
      </form>

      <aside className="reading-preview"><div className="preview-head"><span>해월의 풀이</span><span>결과에서 보는 것</span></div><h3>네가 궁금한 걸<br />이렇게 풀어줄게.</h3><p className="preview-lede">{includesPalm ? '사주와 손금에서 같은 신호가 나오는지 먼저 확인하고, 지금 생활에서 바로 써먹을 수 있게 정리해.' : '태어난 때를 바탕으로 타고난 성향과 지금 들어온 흐름을 나눠서 봐.'}</p><ol><li><span>一</span><p><strong>타고난 성향</strong><span className="detail-stack"><span>결정을 내리는 방식</span><span>잘하는 일</span><span>유독 흔들리는 순간</span></span></p></li><li><span>二</span><p><strong>{includesPalm ? '손에 나타난 변화' : '지금 들어온 흐름'}</strong><span className="detail-stack">{includesPalm ? <><span>원래 성향과 달라진 점</span><span>요즘 마음이 향하는 곳</span><span>손에 새로 나타난 신호</span></> : <><span>잘 풀리는 일</span><span>자꾸 늦어지는 일</span><span>흐름이 바뀌는 때</span></>}</span></p></li><li><span>三</span><p><strong>일과 돈</strong><span className="detail-stack"><span>나한테 맞는 일의 방식</span><span>돈이 새는 습관</span><span>욕심내도 되는 때</span></span></p></li><li><span>四</span><p><strong>연애와 인간관계</strong><span className="detail-stack"><span>자꾸 끌리는 사람</span><span>반복되는 갈등</span><span>거리를 둬야 할 관계</span></span></p></li><li><span>五</span><p><strong>지금 해야 할 선택</strong><span className="detail-stack"><span>밀어붙일 일</span><span>기다릴 일</span><span>먼저 끊어야 할 습관</span></span></p></li></ol><div className="cross-check"><ScanLine size={18} /><span>결과를 다 보고 나면<br /><strong>지금 할 일 세 가지만 남겨줄게.</strong></span></div></aside>
    </section>

    <section className="closing"><p>같은 일로 또 후회하고 싶진 않잖아.</p><h2>이번엔 왜 꼬였는지<br />제대로 보자.</h2><a href="#reading">내 사주 보기 <ArrowRight size={18} /></a></section>
    <footer><span>結談 · 결담</span><p>태어난 때와 손에 남은 변화를 같이 봐.</p><a href="#top">맨 위로</a></footer>
  </main>;
}
