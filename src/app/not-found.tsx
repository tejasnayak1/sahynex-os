import { LinkButton } from '@/components/ui';

export default function NotFound() {
  return (
    <div className="grid min-h-[60vh] place-items-center px-6">
      <div className="max-w-md">
        <h1 className="text-[22px] font-semibold">Not found</h1>
        <p className="mt-2 text-muted">This record doesn’t exist, was archived, or isn’t shared with you.</p>
        <div className="mt-5">
          <LinkButton href="/dashboard" variant="primary">
            Go to dashboard
          </LinkButton>
        </div>
      </div>
    </div>
  );
}
