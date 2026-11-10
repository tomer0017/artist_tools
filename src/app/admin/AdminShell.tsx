import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { BrandMark } from '@/components/shell/BrandMark';

// The frame of every admin page: brand (back to the studio), the two admin
// sections, and room for the page. Pages call requireAdmin() themselves.

const TABS = [
  { id: 'users', href: '/admin', label: 'Users' },
  { id: 'activity', href: '/admin/activity', label: 'Activity' },
] as const;

export function AdminShell({ active, children }: { active: (typeof TABS)[number]['id'] | null; children: React.ReactNode }) {
  return (
    <main
      className="min-h-[100dvh] bg-background px-4 pb-12 md:px-8"
      style={{ paddingTop: 'max(1.25rem, env(safe-area-inset-top))', paddingBottom: 'max(3rem, env(safe-area-inset-bottom))' }}
    >
      <div className="mx-auto max-w-6xl">
        <header className="flex items-center justify-between gap-4">
          <Link href="/app" aria-label="Back to the studio" className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <BrandMark compact />
          </Link>
          <span className="rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">Admin</span>
        </header>

        <nav aria-label="Admin sections" className="mt-5 flex items-center gap-1 rounded-xl border border-border bg-card p-1 text-sm">
          {TABS.map((tab) => (
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

        {children}
      </div>
    </main>
  );
}
