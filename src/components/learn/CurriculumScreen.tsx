import Link from 'next/link';
import { useTranslations } from 'use-intl';
import { ChevronRight } from 'lucide-react';
import type { LearnCollection } from '@/lib/learn/model';
import { itemPath, learnPath } from '@/lib/learn/routes';
import { useLearnSummary } from '@/components/shell/account';
import { useCompletions, useLearnList, type ListAnswer } from './data';
import { useClassMode } from './ClassMode';
import { useModuleLock } from './LearnHome';
import { DoneTick, DraftBadge, Failed, LearnHeader, Loading, LockBadge, Thumb, useLocalized } from './parts';

// S2 · The drawing course: its groups in the recommended order (Core, Next
// steps, then Color, which is a module of its own). Each exercise shows its
// title, a small picture, a tick with how many times it was completed, and a
// lock when the plan does not include it. A recommendation, never a forced order.

export default function CurriculumScreen() {
  const t = useTranslations('learn');
  const summary = useLearnSummary();
  const classMode = useClassMode();
  const curriculum = useLearnList('curriculum', summary.modules.curriculum !== null);
  const color = useLearnList('color', summary.modules.color !== null);
  const completions = useCompletions(!classMode.on);
  const counts = classMode.on ? {} : (completions.data?.summary.items ?? {});
  const lists = [
    { collection: 'curriculum' as const, query: curriculum, shown: summary.modules.curriculum !== null },
    { collection: 'color' as const, query: color, shown: summary.modules.color !== null },
  ].filter((list) => list.shown);
  let number = 0;

  return (
    <>
      <LearnHeader back={{ href: learnPath({ screen: 'home' }), label: t('places.learn') }} title={t('curriculum.title')} lead={t('curriculum.lead')} />
      {lists.map(({ collection, query }) => {
        if (query.isPending) return <Loading key={collection} />;
        if (query.isError) return <Failed key={collection} error={query.error} onRetry={() => void query.refetch()} />;
        const data = query.data;
        if (data.items.length === 0) return collection === 'curriculum' ? <p key={collection} className="text-sm text-muted-foreground">{t('curriculum.empty')}</p> : null;
        return (
          <div key={collection} className="space-y-6">
            {groupsOf(data).map((group) => (
              <section key={group.id} aria-labelledby={`group-${group.id}`} data-learn-group={group.id}>
                <h2 id={`group-${group.id}`} className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  <GroupTitle collection={collection} title={group.title} />
                </h2>
                <ol className="overflow-hidden rounded-2xl border border-border bg-card">
                  {group.items.map((item) => {
                    number += 1;
                    return (
                      <li key={item.id} className="border-b border-border last:border-b-0">
                        <ExerciseRow
                          id={item.id}
                          number={number}
                          title={item.title}
                          thumbnail={item.thumbnailAssetId}
                          open={item.open}
                          collection={collection}
                          count={counts[item.id]?.count ?? 0}
                          draft={item.published === false}
                        />
                      </li>
                    );
                  })}
                </ol>
              </section>
            ))}
          </div>
        );
      })}
    </>
  );
}

/** A list's groups in order, each with its items in order; items of a group the list does not name come last. */
function groupsOf(data: ListAnswer) {
  const known = data.groups.map((group) => ({ id: group.id, title: group.title, items: data.items.filter((item) => item.groupId === group.id) }));
  const rest = data.items.filter((item) => !data.groups.some((group) => group.id === item.groupId));
  return [...known, ...(rest.length ? [{ id: `${data.collection}-other`, title: null, items: rest }] : [])].filter((group) => group.items.length > 0);
}

function GroupTitle({ collection, title }: { collection: LearnCollection; title: { en: string; he: string } | null }) {
  const loc = useLocalized();
  const t = useTranslations('learn');
  return <>{title ? loc(title) : t(collection === 'challenges' ? 'places.challenges' : 'places.curriculum')}</>;
}

function ExerciseRow({
  id,
  number,
  title,
  thumbnail,
  open,
  collection,
  count,
  draft,
}: {
  id: string;
  number: number;
  title: { en: string; he: string };
  thumbnail: string | null;
  open: boolean;
  collection: LearnCollection;
  count: number;
  draft: boolean;
}) {
  const t = useTranslations('learn');
  const loc = useLocalized();
  const lock = useModuleLock(collection);
  return (
    <Link
      href={itemPath(id)}
      data-learn-item={id}
      data-open={open}
      className="group flex min-h-[72px] items-center gap-3 px-3 py-2.5 transition-colors hover:bg-secondary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring md:px-4"
    >
      <Thumb assetId={thumbnail} kind="exercise" className="h-14 w-14" />
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-medium text-muted-foreground">{t('curriculum.number', { number })}</span>
        <span className="block text-[15px] font-semibold leading-snug text-foreground">{loc(title)}</span>
        <span className="mt-1 flex flex-wrap items-center gap-1.5">
          {!open && <LockBadge pro={lock === 'pro'} />}
          {draft && <DraftBadge />}
          <DoneTick count={count} />
        </span>
      </span>
      <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:text-primary rtl:-scale-x-100" aria-hidden="true" />
    </Link>
  );
}
