import { redirect } from 'next/navigation';
import { ShieldCheck } from 'lucide-react';
import { getCurrentActor } from '@/server/auth/current';
import { googleConfigured } from '@/server/integrations/google-user';
import { LoginForm } from './login-form';

export const metadata = { title: 'Sign in' };

const FEATURES: Array<[string, string]> = [
  ['Plan', 'Better'],
  ['Execute', 'Faster'],
  ['Track', 'Everything'],
  ['Grow', 'Together'],
];

const GOOGLE_NOTICE: Record<string, string> = {
  cancelled: 'Google sign-in was cancelled.',
  invalid: 'That Google sign-in link expired. Try again.',
  unverified: 'Google hasn’t verified that email address, so it can’t be used to sign in.',
  no_account: 'There’s no active Sahynex OS account for that Google email. Ask an administrator to add you.',
  failed: 'Google sign-in didn’t complete. Try again or use your password.',
  not_configured: 'Google sign-in isn’t set up on this server.',
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; google?: string }>;
}) {
  if (await getCurrentActor()) redirect('/home');
  const { next, google } = await searchParams;
  return (
    <main id="main" className="grid min-h-dvh bg-[#0d171d] lg:grid-cols-[minmax(0,1.85fr)_minmax(460px,1fr)]">
      {/* Photo panel */}
      <section
        className="relative flex min-h-[340px] flex-col overflow-hidden bg-[#e9ecee] bg-cover bg-[position:62%_center] px-7 pt-8 pb-7 text-[#1d2a30] sm:px-12 lg:min-h-dvh lg:px-[5.5%] lg:pt-[4.5%] lg:pb-[4%]"
        style={{ backgroundImage: 'url(/brand/login-hero.jpg)' }}
      >
        {/* Keeps the left-hand copy readable on every crop of the photo */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgb(241,243,244,0.85)_0%,rgb(241,243,244,0.4)_36%,transparent_58%)] [mask-image:linear-gradient(180deg,#000_0%,#000_55%,transparent_72%)]"
        />
        <div className="relative flex items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/logo-mark.png" alt="" className="h-14 w-auto lg:h-[76px]" />
          <div>
            <p className="text-[24px] leading-none font-semibold tracking-[-0.02em] lg:text-[32px]">
              Sahynex <span className="font-normal">OS</span>
            </p>
            <p className="mt-2 text-[11px] font-medium tracking-[0.32em] text-[#4b5a61] lg:text-[12.5px]">
              PLAN · EXECUTE · GROW
            </p>
          </div>
        </div>

        <div className="relative mt-10 max-w-[780px] lg:mt-auto lg:mb-auto">
          <h1 className="text-[40px] leading-[1.04] font-light tracking-[-0.035em] sm:text-[52px] lg:text-[clamp(52px,5.2vw,82px)]">
            Ideas today.
            <br />
            Greater outcomes
            <br />
            <span className="font-semibold">tomorrow.</span>
          </h1>
          <div aria-hidden className="mt-8 hidden h-px w-12 bg-[#1d2a30]/60 lg:block" />
          <p className="mt-6 hidden max-w-[27rem] text-[17px] lg:block leading-relaxed text-[#2c3a41] lg:text-[20px]">
            A unified workspace to grow brands, drive admissions and create real impact.
          </p>
        </div>

        <ul className="relative mt-8 hidden max-w-[640px] grid-cols-4 lg:grid">
          {FEATURES.map(([a, b], i) => (
            <li
              key={a}
              className={`px-6 text-[16px] leading-snug font-medium text-white drop-shadow-[0_1px_2px_rgb(0_0_0/0.4)] first:pl-0 ${i ? 'border-l border-white/35' : ''}`}
            >
              {a}
              <br />
              {b}
            </li>
          ))}
        </ul>
        <p className="relative mt-8 hidden text-[14px] text-white/80 drop-shadow lg:block">
          Sahynex TechSolutions Pvt. Ltd. · Mangaluru
        </p>
      </section>

      {/* Sign-in panel */}
      <section className="relative flex flex-col bg-[radial-gradient(120%_80%_at_100%_0%,#16262c_0%,#0d171d_55%)] px-7 py-10 text-[#e8eef0] sm:px-12 lg:px-[13%]">
        <div className="flex flex-1 flex-col justify-center">
          <div className="w-full max-w-[460px]">
            <h2 className="text-[30px] font-semibold tracking-[-0.02em] lg:text-[34px]">Welcome back</h2>
            <p className="mt-2 text-[16px] text-[#9fb0b6]">Sign in to your workspace.</p>
            {google && GOOGLE_NOTICE[google] ? (
              <p
                role="alert"
                className="mt-5 rounded-lg border border-[#ff7b72]/30 bg-[#3d1a1a] px-3.5 py-2.5 text-[13.5px]"
              >
                {GOOGLE_NOTICE[google]}
              </p>
            ) : null}
            <div className="mt-8">
              <LoginForm next={next ?? '/home'} google={googleConfigured().ok} />
            </div>
          </div>
        </div>
        <p className="mt-10 flex items-center gap-2.5 text-[14px] text-[#9fb0b6]">
          <ShieldCheck size={18} aria-hidden /> Secure access. Your data stays private.
        </p>
        <p className="mt-3 text-[12.5px] text-[#7d8f96] lg:hidden">
          Sahynex TechSolutions Pvt. Ltd. · Mangaluru
        </p>
      </section>
    </main>
  );
}
