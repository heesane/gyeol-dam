'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import { ArrowRight, KeyRound } from 'lucide-react';

function Gate() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') || '/';
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/gate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      if (!res.ok) throw new Error('암호가 틀렸어.');
      router.replace(next);
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '다시 시도해줘.');
      setBusy(false);
    }
  };

  return (
    <div className="gate">
      <figure className="gate-figure">
        <Image src="/images/haewol-main.webp" alt="결담의 무당 해월" fill priority sizes="(max-width: 640px) 100vw, 420px" />
      </figure>
      <div className="gate-panel">
        <span className="gate-mark">結談 · 결담</span>
        <h1>아무나<br />들이지는 않아.</h1>
        <p>받은 암호를 넣어. 없으면 여기서 돌아가.</p>
        <form onSubmit={submit}>
          <div className="gate-input">
            <KeyRound size={16} />
            <input
              autoFocus
              type="password"
              inputMode="text"
              autoComplete="off"
              placeholder="암호 코드"
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          </div>
          <button type="submit" disabled={busy || !code}>
            {busy ? '확인 중…' : '들어가기'} {!busy && <ArrowRight size={18} />}
          </button>
          {error && <p className="gate-error" role="alert">{error}</p>}
        </form>
      </div>
    </div>
  );
}

export default function GatePage() {
  return <Suspense fallback={null}><Gate /></Suspense>;
}
