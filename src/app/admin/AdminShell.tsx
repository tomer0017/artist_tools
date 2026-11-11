import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { BrandMark } from '@/components/shell/BrandMark';
import { I18nProvider } from '@/i18n/client';
import { en } from '@/i18n/messages/en';
import { authConfig } from '@/server/env';

// The frame of every admin page: brand (back to the studio), the admin
// sections, and room for the page. Pages call requireAdmin() themselves.

const TABS = [
  { id: 'users', href: '/admin', label: 'Users' },
  { id: 'analytics', href: '/admin/analytics', label: 'Analytics' },
  { id: 'plans', href: '/admin/plans', label: 'Plans' },
  { id: 'pricing', href: '/admin/pricing', label: 'Pricing' },
  { id: 'coupons', href: '/admin/coupons', label: 'Coupons' },
  { id: 'billing', href: '/admin/billing', label: 'Billing' },
  { id: 'activity', href: '/admin/activity', label: 'Activity' },
  { id: 'security', href: '/admin/security', label: 'Security' },
  // Only where test emails are kept instead of sent (staging, development).
  { id: 'mail', href: '/admin/mail', label: 'Test mail' },
] as const;

/** `bare`: without the section tabs (the two-factor check, before admin access). */
export function AdminShell({ active, bare = false, children }: { active: (typeof TABS)[number]['id'] | null; bare?: boolean; children: React.ReactNode }) {
  const outbox = authConfig().mail.transport === 'outbox';
  const tabs = TABS.filter((tab) => tab.id !== 'mail' || outbox);
  return (
    // English and left-to-right: the admin dashboard is not translated (its
    // shared parts, like "Confirm it is you", read English messages here).
    <I18nProvider locale="en" messages={en}>
      <main
        lang="en"
        dir="ltr"
        className="min-h-[100dvh] bg-background px-4 pb-12 md:px-8"
        style={{ paddingTop: 'max(1.25rem, env(safe-area-inset-top))', paddingBottom: 'max(3rem, env(safe-area-inset-bottom))' }}
      >
        <div className="mx-auto max-w-6xl">
          <header className="flex items-center justify-between gap-4">
            <Link href="/app" className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <BrandMark compact />
              <span className="sr-only">: back to the studio</span>
            </Link>
            <span className="rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">Admin</span>
          </header>

          {!bare && (
            <nav aria-label="Admin sections" className="mt-5 flex items-center gap-1 overflow-x-auto whitespace-nowrap rounded-xl border border-border bg-card p-1 text-sm">
              {tabs.map((tab) => (
                <Link
                  key={tab.id}
                  href={tab.href}
                  aria-current={active === tab.id ? 'page' : undefined}
                  className={`rounded-lg px-3.5 py-2 font-medium transition-colors ${
                    active === tab.id ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                  }`}
                >
                  {tab.label}
                </Link>
              ))}
              <Link href="/app" className="ml-auto flex items-center gap-1.5 rounded-lg px-3 py-2 text-muted-foreground hover:bg-secondary hover:text-foreground">
                <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Studio
              </Link>
            </nav>
          )}

          {children}
        </div>
      </main>
    </I18nProvider>
  );
}
