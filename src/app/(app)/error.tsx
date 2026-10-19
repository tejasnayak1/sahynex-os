'use client';
import { useEffect } from 'react';
import { buttonClass } from '@/components/ui';

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => console.error(error), [error]);
  return (
    <div className="max-w-lg py-10">
      <h1 className="text-[20px] font-semibold">This page couldn’t load</h1>
      <p className="mt-2 text-muted">
        Something failed while loading data. Nothing you saved earlier is affected. Try again; if it keeps
        failing, share reference {error.digest ?? 'n/a'} with your administrator.
      </p>
      <button onClick={reset} className={buttonClass('primary') + ' mt-4'}>
        Try again
      </button>
    </div>
  );
}
