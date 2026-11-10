import type { Metadata } from 'next';
import Link from 'next/link';
import { PlanComparison } from '@/components/plans/PlanComparison';
import { BrandMark } from '@/components/shell/BrandMark';
import { registrationMode } from '@/server/auth';

// Public plan comparison, linked from the landing page. No prices and nothing
// to buy: Free is available, Pro is coming soon.

export const metadata: Metadata = {
  title: 'Plans · Studio Companion',
  description: 'Studio Companion is free, with all five tools. Pro is coming soon.',
};

// The call to action follows the server's registration setting.
export const dynamic = 'force-dynamic';

export default function PricingPage() {
  const registration = registrationMode();
  return (
    <main className="min-h-[100dvh] bg-background" style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="mx-auto w-full max-w-4xl px-4 pb-12 pt-5 md:px-6 md:pt-8">
        <header className="flex items-center justify-between gap-4">
          <Link href="/" aria-label="Studio Companion home" className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <BrandMark />
          </Link>
          <Link href="/app" className="rounded-lg px-3 py-2 text-sm font-medium text-foreground hover:bg-secondary">
            Open the studio
          </Link>
        </header>

        <h1 className="mt-10 text-[30px] font-bold leading-tight tracking-tight text-foreground md:text-[40px]">Plans</h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground md:text-base">
          Start free with all five tools. Pro, with larger and richer exports, is coming soon.
        </p>

        <div className="mt-6">
          <PlanComparison
            current={null}
            freeAction={registration === 'open' ? { href: '/sign-in?callbackURL=%2Fapp', label: 'Start free with Google' } : { href: '/app', label: 'Open the studio' }}
            registration={registration}
          />
        </div>
      </div>
    </main>
  );
}
