import Link from 'next/link';
import { useTranslations } from 'use-intl';
import { useProject } from '@/hooks/useProjectStore';
import type { NavViewId } from '@/types/project';
import { AccountButton } from './account';
import { BrandMark } from './BrandMark';
import { NAV_ORDER, navItem, pathForView } from './tools';

// ─── Global navigation ────────────────────────────────────────────────────────
// Every destination always shows an icon AND a readable label — usability
// testing showed icon-only tabs left first-time users guessing. Items are real
// links (one URL per tool), so the browser / iOS back gesture moves between
// tools the way people expect.

/** Mobile: a labelled six-item bar pinned above the home indicator. */
export function BottomNav() {
  const { activeTab } = useProject();
  const t = useTranslations('studio');
  return (
    <nav
      aria-label={t('navTools')}
      className="shrink-0 border-t border-border bg-[hsl(var(--toolbar-bg))]"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <ul className="grid grid-cols-6">
        {NAV_ORDER.map((id) => (
          <li key={id}>
            <NavItemLink id={id} active={activeTab === id} variant="bottom" />
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Tablet / desktop: brand at the start, the same six destinations at the end, then the account. */
export function TopNav() {
  const { activeTab } = useProject();
  const t = useTranslations('studio');
  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-border px-4 toolbar-surface lg:px-6">
      <Link href={pathForView('home')} aria-label={t('homeLink')} className="shrink-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <BrandMark compact />
      </Link>
      <nav aria-label={t('navTools')} className="ms-auto min-w-0">
        <ul className="flex items-center gap-0.5 lg:gap-1">
          {NAV_ORDER.map((id) => (
            <li key={id}>
              <NavItemLink id={id} active={activeTab === id} variant="top" />
            </li>
          ))}
        </ul>
      </nav>
      <AccountButton />
    </header>
  );
}

function NavItemLink({ id, active, variant }: { id: NavViewId; active: boolean; variant: 'bottom' | 'top' }) {
  const t = useTranslations();
  const Icon = navItem(id).icon;
  const label = id === 'home' ? t('studio.home') : t(`tools.${id}.navLabel`);
  if (variant === 'bottom') {
    return (
      <Link
        href={pathForView(id)}
        aria-current={active ? 'page' : undefined}
        className={`flex h-14 w-full flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
          active ? 'text-primary' : 'text-muted-foreground active:text-foreground'
        }`}
      >
        <span className={`flex h-7 w-11 items-center justify-center rounded-full transition-colors ${active ? 'bg-primary/15' : ''}`}>
          <Icon className="h-[18px] w-[18px]" strokeWidth={active ? 2.3 : 2} aria-hidden="true" />
        </span>
        <span className="leading-none">{label}</span>
      </Link>
    );
  }
  return (
    <Link
      href={pathForView(id)}
      aria-current={active ? 'page' : undefined}
      className={`flex h-10 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:px-3.5 lg:text-sm ${
        active
          ? 'bg-primary/15 text-primary'
          : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
      }`}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{label}</span>
    </Link>
  );
}
