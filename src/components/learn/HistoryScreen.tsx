import { useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'use-intl';
import { Loader2, Trash2 } from 'lucide-react';
import { itemPath, learnPath } from '@/lib/learn/routes';
import { useCompletionChanges, useCompletionPages } from './data';
import { useClassMode } from './ClassMode';
import { Failed, LearnHeader, Loading, buttonSecondary, useLocalized } from './parts';

// S8 · My history: the person's own completions, newest first (date and
// item), each removable with one tap. No streaks, targets or penalties; a
// plain count only here. Never asked for in class mode. In the account's data
// download; removed with the account (ADR-0010).

export default function HistoryScreen() {
  const t = useTranslations('learn');
  const locale = useLocale();
  const loc = useLocalized();
  const classMode = useClassMode();
  const pages = useCompletionPages(!classMode.on);
  const { remove } = useCompletionChanges();
  const [status, setStatus] = useState<'removed' | 'failed' | null>(null);
  const back = { href: learnPath({ screen: 'home' }), label: t('places.learn') };
  const date = new Intl.DateTimeFormat(locale === 'he' ? 'he-IL' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  if (classMode.on) {
    return (
      <>
        <LearnHeader back={back} title={t('history.title')} />
        <p className="text-sm text-muted-foreground">{t('classMode.historyHidden')}</p>
      </>
    );
  }

  const first = pages.data?.pages[0];
  const entries = pages.data?.pages.flatMap((page) => page.completions) ?? [];
  const titles = Object.assign({}, ...(pages.data?.pages.map((page) => page.titles) ?? [])) as NonNullable<typeof first>['titles'];

  return (
    <>
      <LearnHeader back={back} title={t('history.title')} lead={t('history.lead')} />
      {pages.isPending ? (
        <Loading />
      ) : pages.isError ? (
        <Failed error={pages.error} onRetry={() => void pages.refetch()} />
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-history-empty>
          {t('history.empty')}
        </p>
      ) : (
        <>
          <p className="mb-3 text-sm font-medium text-foreground" data-history-total={first?.summary.total ?? 0}>
            {t('history.total', { count: first?.summary.total ?? entries.length })}
          </p>
          <ol className="overflow-hidden rounded-2xl border border-border bg-card" data-history>
            {entries.map((entry) => {
              const known = titles[entry.itemId];
              const title = known ? loc(known.title) : t('history.unavailable', { id: entry.itemId });
              const when = date.format(new Date(entry.completedAt));
              return (
                <li key={entry.id} className="flex min-h-[60px] items-center gap-3 border-b border-border px-3 py-2 last:border-b-0 md:px-4" data-history-entry={entry.itemId}>
                  <span className="min-w-0 flex-1">
                    {known ? (
                      <Link href={itemPath(entry.itemId)} className="block text-[15px] font-semibold leading-snug text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        {title}
                      </Link>
                    ) : (
                      <span className="block text-[15px] leading-snug text-muted-foreground">{title}</span>
                    )}
                    <span className="block text-xs text-muted-foreground">{when}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      remove.mutate(entry.id, {
                        onSuccess: () => setStatus('removed'),
                        onError: () => setStatus('failed'),
                      })
                    }
                    disabled={remove.isPending}
                    aria-label={t('history.removeLabel', { title, date: when })}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                  >
                    {remove.isPending && remove.variables === entry.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Trash2 className="h-4 w-4" aria-hidden="true" />}
                  </button>
                </li>
              );
            })}
          </ol>
          {pages.hasNextPage && (
            <button type="button" onClick={() => void pages.fetchNextPage()} disabled={pages.isFetchingNextPage} className={`${buttonSecondary} mt-4`}>
              {pages.isFetchingNextPage && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {t('history.more')}
            </button>
          )}
        </>
      )}
      <p aria-live="polite" className="mt-3 min-h-[20px] text-sm">
        {status === 'removed' && <span className="text-foreground">{t('history.removed')}</span>}
        {status === 'failed' && <span className="text-destructive">{t('history.removeFailed')}</span>}
      </p>
    </>
  );
}
