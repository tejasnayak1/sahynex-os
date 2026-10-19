'use client';
import { useEffect, useState } from 'react';

type Toast = { id: number; tone: 'ok' | 'bad' | 'info'; text: string };
const listeners = new Set<(t: Toast) => void>();
let seq = 0;

export function toast(text: string, tone: Toast['tone'] = 'ok') {
  const t = { id: ++seq, tone, text };
  listeners.forEach((l) => l(t));
}

export function Toaster() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => {
    const l = (t: Toast) => {
      setItems((s) => [...s.slice(-3), t]);
      setTimeout(() => setItems((s) => s.filter((x) => x.id !== t.id)), t.tone === 'bad' ? 8000 : 4000);
    };
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(380px,calc(100vw-32px))] flex-col gap-2"
    >
      {items.map((t) => (
        <div
          key={t.id}
          role={t.tone === 'bad' ? 'alert' : 'status'}
          className={`pointer-events-auto rounded-md border px-3.5 py-2.5 text-[13.5px] shadow-[0_6px_24px_rgb(10_20_30/0.12)] ${t.tone === 'bad' ? 'border-bad/40 bg-surface text-bad' : t.tone === 'info' ? 'border-line-strong bg-surface text-ink' : 'border-ok/40 bg-surface text-ink'}`}
        >
          <span
            className={`mr-2 inline-block h-2 w-2 rounded-full align-middle ${t.tone === 'bad' ? 'bg-bad' : t.tone === 'info' ? 'bg-info' : 'bg-ok'}`}
            aria-hidden
          />
          {t.text}
        </div>
      ))}
    </div>
  );
}
