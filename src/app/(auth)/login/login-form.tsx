'use client';
import { ActionForm, SubmitButton } from '@/components/client/action-form';
import { inputClass } from '@/components/ui';
import { loginAction } from './actions';

export function LoginForm({ next }: { next: string }) {
  return (
    <ActionForm action={loginAction} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <div className="flex flex-col gap-1">
        <label htmlFor="email" className="text-[13px] font-medium text-ink-2">
          Work email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          autoFocus
          className={inputClass}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="password" className="text-[13px] font-medium text-ink-2">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className={inputClass}
        />
      </div>
      <SubmitButton className="w-full" pendingText="Signing in…">
        Sign in
      </SubmitButton>
    </ActionForm>
  );
}
