import { LinkButton } from '@/components/ui';

export const metadata = { title: 'No access' };

export default function Forbidden() {
  return (
    <main id="main" className="grid min-h-dvh place-items-center px-6">
      <div className="max-w-md">
        <h1 className="text-[22px] font-semibold">You don’t have access to this page</h1>
        <p className="mt-2 text-muted">
          Your role doesn’t include this area. If you need it for your work, ask an administrator to update
          your role.
        </p>
        <div className="mt-5">
          <LinkButton href="/dashboard" variant="primary">
            Go to dashboard
          </LinkButton>
        </div>
      </div>
    </main>
  );
}
