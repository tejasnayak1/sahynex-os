'use client';
import { useState } from 'react';
import { ArrowRight, Eye, EyeOff, Lock, Mail } from 'lucide-react';
import { ActionForm, SubmitButton } from '@/components/client/action-form';
import { cn } from '@/components/ui';
import { loginAction } from './actions';

/** The sign-in panel is always dark, so inputs carry their own colours rather than theme tokens. */
const field =
  'h-14 w-full rounded-xl border border-white/[0.12] bg-[#111d23] pl-12 pr-4 text-[15.5px] text-[#e8eef0] placeholder:text-[#7d8f96] transition-colors hover:border-white/20 focus:border-[#4fb3b8] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4fb3b8]/35';

export function LoginForm({ next, google }: { next: string; google: boolean }) {
  const [show, setShow] = useState(false);
  const [remember, setRemember] = useState(true);
  const [forgot, setForgot] = useState(false);
  return (
    <>
      <ActionForm action={loginAction} className="space-y-4">
        <input type="hidden" name="next" value={next} />
        <div className="relative">
          <label htmlFor="email" className="sr-only">
            Work email
          </label>
          <Mail
            size={20}
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-[#8aa0a7]"
          />
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            required
            autoFocus
            placeholder="Work email"
            className={field}
          />
        </div>
        <div className="relative">
          <label htmlFor="password" className="sr-only">
            Password
          </label>
          <Lock
            size={20}
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-[#8aa0a7]"
          />
          <input
            id="password"
            name="password"
            type={show ? 'text' : 'password'}
            autoComplete="current-password"
            required
            placeholder="Password"
            className={cn(field, 'pr-14')}
          />
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            aria-pressed={show}
            aria-controls="password"
            aria-label={show ? 'Hide password' : 'Show password'}
            className="absolute top-1/2 right-2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-lg text-[#9fb0b6] hover:bg-white/[0.06] hover:text-white"
          >
            {show ? <EyeOff size={20} /> : <Eye size={20} />}
          </button>
        </div>
        <div className="flex items-center justify-between gap-3 pt-1 text-[14.5px]">
          <label className="flex cursor-pointer items-center gap-2.5 text-[#c9d5d9]">
            <input
              type="checkbox"
              name="remember"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="h-[18px] w-[18px] rounded accent-[#4fb3b8]"
            />
            Remember me
          </label>
          <button
            type="button"
            onClick={() => setForgot((f) => !f)}
            aria-expanded={forgot}
            className="text-[#5fc7cc] underline-offset-4 hover:underline"
          >
            Forgot password?
          </button>
        </div>
        {forgot ? (
          <p
            role="status"
            className="rounded-lg border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-[13.5px] text-[#c9d5d9]"
          >
            Passwords are reset by your administrator in Settings → Users. They’ll give you a temporary
            password.
          </p>
        ) : null}
        <SubmitButton
          className="!mt-6 h-14 w-full rounded-xl bg-[#4aa7ab] text-[16px] font-semibold text-[#06191b] hover:bg-[#5bb8bc]"
          pendingText="Signing in…"
        >
          Sign in <ArrowRight size={18} aria-hidden />
        </SubmitButton>
      </ActionForm>
      {google ? (
        <>
          <div className="my-7 flex items-center gap-4 text-[13.5px] text-[#8aa0a7]">
            <span className="h-px flex-1 bg-white/10" /> or continue with{' '}
            <span className="h-px flex-1 bg-white/10" />
          </div>
          <a
            href={`/api/auth/google?remember=${remember ? '1' : '0'}`}
            className="flex h-14 w-full items-center justify-center gap-3 rounded-xl border border-white/[0.12] bg-[#111d23] text-[15px] font-medium text-[#e8eef0] transition-colors hover:border-white/25"
          >
            <svg aria-hidden viewBox="0 0 48 48" className="h-5 w-5">
              <path
                fill="#FFC107"
                d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"
              />
              <path
                fill="#FF3D00"
                d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
              />
              <path
                fill="#4CAF50"
                d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"
              />
              <path
                fill="#1976D2"
                d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"
              />
            </svg>
            Sign in with Google
          </a>
          <p className="mt-3 text-[12.5px] text-[#7d8f96]">
            Works for people who already have a Sahynex OS account.
          </p>
        </>
      ) : null}
    </>
  );
}
