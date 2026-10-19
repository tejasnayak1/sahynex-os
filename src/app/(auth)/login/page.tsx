import { redirect } from 'next/navigation';
import { getCurrentActor } from '@/server/auth/current';
import { LoginForm } from './login-form';

export const metadata = { title: 'Sign in' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await getCurrentActor()) redirect('/dashboard');
  const { next } = await searchParams;
  return (
    <main id="main" className="grid min-h-dvh lg:grid-cols-[1fr_minmax(420px,520px)]">
      <section className="relative hidden overflow-hidden bg-[#0d4f53] p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-md bg-white/15 font-bold">S</span>
          <span className="text-[15px] font-semibold">Sahynex OS</span>
        </div>
        <div className="max-w-md">
          <p className="text-[30px] font-semibold leading-[1.15] tracking-[-0.02em]">
            From first enquiry to renewal, one record of the work.
          </p>
          <p className="mt-4 text-[15px] leading-relaxed text-white/75">
            Leads, deals, projects, creative approvals, campaign performance and reporting for the Sahynex
            team and the institutions it serves.
          </p>
        </div>
        <p className="text-[13px] text-white/55">Sahynex TechSolutions Pvt. Ltd. · Mangaluru</p>
        <svg
          aria-hidden
          className="pointer-events-none absolute -right-24 bottom-24 h-[420px] w-[420px] text-white/[0.06]"
          viewBox="0 0 200 200"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
        >
          {Array.from({ length: 9 }, (_, i) => (
            <path
              key={i}
              d={`M0 ${40 + i * 16} C 50 ${20 + i * 16}, 100 ${60 + i * 16}, 200 ${36 + i * 16}`}
            />
          ))}
        </svg>
      </section>
      <section className="flex items-center justify-center bg-surface px-6 py-12">
        <div className="w-full max-w-sm">
          <h1 className="text-[22px] font-semibold tracking-[-0.01em]">Sign in</h1>
          <p className="mb-6 mt-1 text-muted">Use the account your administrator created for you.</p>
          <LoginForm next={next ?? '/dashboard'} />
          <p className="mt-6 text-[12.5px] text-muted">
            Forgot your password? Ask an administrator to reset it in Settings → Users.
          </p>
        </div>
      </section>
    </main>
  );
}
