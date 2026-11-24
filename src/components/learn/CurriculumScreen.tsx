import Link from 'next/link';
import { useTranslations } from 'use-intl';
import { ChevronRight } from 'lucide-react';
import { lessonNumbers, unitNumbers, unitProgress, upNext } from '@/lib/learn/course';
import type { LearnCollection, Localized } from '@/lib/learn/model';
import { itemPath, learnPath } from '@/lib/learn/routes';
import { ProMark, proOfferFor } from '@/components/billing/pro';
import { useAccount, useLearnSummary } from '@/components/shell/account';
import { useCompletions, useLearnList, type ListAnswer, type ListEntry, type ListGroup } from './data';
import { useClassMode } from './ClassMode';
import { useModuleLock } from './LearnHome';
import { DoneTick, DraftBadge, Failed, LearnHeader, Loading, LockBadge, Thumb, useLocalized } from './parts';

// S2 · The drawing course (ADR-0019): units in the recommended order, each
// with its level, its one-line goal and a quiet "1 of 2 done" (no bars).
// Lessons are numbered in order; the optional baseline drawing has no number.
// Each row has its title, its one skill, a small picture, a tick with how
// many times it was completed, and a lock when the plan does not include it;
// "Up next" marks the first lesson not done yet. A recommendation, never a
// forced order: every lesson opens. Color, a module of its own, follows.

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

  return (
    <>
      <LearnHeader back={{ href: learnPath({ screen: 'home' }), label: t('places.learn') }} title={t('curriculum.title')} lead={t('curriculum.lead')} />
      <div className="space-y-10">
        {lists.map(({ collection, query }) => {
          if (query.isPending) return <Loading key={collection} />;
          if (query.isError) return <Failed key={collection} error={query.error} onRetry={() => void query.refetch()} />;
          if (query.data.items.length === 0) return collection === 'curriculum' ? <p key={collection} className="text-sm text-muted-foreground">{t('curriculum.empty')}</p> : null;
          return <Course key={collection} collection={collection} data={query.data} counts={counts} history={!classMode.on && completions.isSuccess} />;
        })}
      </div>
    </>
  );
}

function Course({ collection, data, counts, history }: { collection: LearnCollection; data: ListAnswer; counts: Record<string, { count: number }>; history: boolean }) {
  const t = useTranslations('learn.curriculum');
  const loc = useLocalized();
  const done = (id: string) => (counts[id]?.count ?? 0) > 0;
  const entries = data.items;
  const numbers = lessonNumbers(entries);
  const units = unitNumbers(data.groups, entries);
  const progress = unitProgress(entries, done);
  // "Up next" in the drawing course, from the person's own history (never in class mode).
  const next = history && collection === 'curriculum' ? upNext(entries, done) : null;
  const levelled = data.groups.some((group) => group.level);
  const Heading = levelled ? 'h3' : 'h2';
  let level: ListGroup['level'] | undefined;

  return (
    <div className="space-y-6" data-learn-course={collection}>
      {groupsOf(data).map((group) => {
        const newLevel = group.level && group.level !== level ? group.level : null;
        if (group.level) level = group.level;
        const unit = collection === 'curriculum' ? units.get(group.id) : undefined;
        const counted = progress.get(group.id);
        return (
          <div key={group.id} className="space-y-2">
            {newLevel && (
              <h2 className="pt-2 text-xs font-bold uppercase tracking-[0.14em] text-primary" data-learn-level={newLevel}>
                {t(`levels.${newLevel}`)}
              </h2>
            )}
            <section aria-labelledby={`group-${group.id}`} data-learn-group={group.id}>
              <div className="mb-2 flex items-end justify-between gap-3">
                <div className="min-w-0">
                  <Heading id={`group-${group.id}`} className="text-base font-bold text-foreground">
                    {group.title ? (unit ? t('unit', { number: unit, title: loc(group.title) }) : loc(group.title)) : t('other')}
                  </Heading>
                  {group.summary && <p className="mt-0.5 text-sm text-muted-foreground">{loc(group.summary)}</p>}
                </div>
                {history && counted && counted.total > 0 && (
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground" data-unit-progress={`${counted.done}/${counted.total}`}>
                    {t('progress', { done: counted.done, total: counted.total })}
                  </span>
                )}
              </div>
              <ol role="list" className="overflow-hidden rounded-2xl border border-border bg-card">
                {group.items.map((item) => (
                  <li key={item.id} className="border-b border-border last:border-b-0">
                    <LessonRow item={item} number={numbers.get(item.id) ?? null} collection={collection} count={counts[item.id]?.count ?? 0} upNext={next?.id === item.id} />
                  </li>
                ))}
              </ol>
            </section>
          </div>
        );
      })}
    </div>
  );
}

/** A list's groups in order, each with its items in order; items of a group the list does not name come last. */
function groupsOf(data: ListAnswer): (Omit<ListGroup, 'title'> & { title: Localized | null; items: ListEntry[] })[] {
  const known = data.groups.map((group) => ({ ...group, items: data.items.filter((item) => item.groupId === group.id) }));
  const rest = data.items.filter((item) => !data.groups.some((group) => group.id === item.groupId));
  return [...known, ...(rest.length ? [{ id: `${data.collection}-other`, order: Number.MAX_SAFE_INTEGER, title: null, items: rest }] : [])].filter((group) => group.items.length > 0);
}

function LessonRow({ item, number, collection, count, upNext }: { item: ListEntry; number: number | null; collection: LearnCollection; count: number; upNext: boolean }) {
  const t = useTranslations('learn.curriculum');
  const loc = useLocalized();
  const lock = useModuleLock(collection);
  const offerPro = proOfferFor(useAccount()?.account);
  return (
    <Link
      href={itemPath(item.id)}
      data-learn-item={item.id}
      data-open={item.open}
      data-up-next={upNext || undefined}
      className={`group flex min-h-[72px] items-center gap-3 px-3 py-2.5 transition-colors hover:bg-secondary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring md:px-4 ${upNext ? 'bg-primary/5' : ''}`}
    >
      <Thumb assetId={item.thumbnailAssetId} kind="exercise" className="h-14 w-14" />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <span data-lesson-label>{item.optional ? t('optional') : number !== null ? t('number', { number }) : t('unnumbered')}</span>
          {upNext && <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold text-primary-foreground">{t('upNext')}</span>}
        </span>
        <span className="block text-[15px] font-semibold leading-snug text-foreground">{loc(item.title)}</span>
        {item.skill && <span className="block text-[13px] leading-snug text-muted-foreground">{loc(item.skill)}</span>}
        {(!item.open || item.published === false || count > 0) && (
          <span className="mt-1 flex flex-wrap items-center gap-1.5">
            {!item.open && (item.inPro && offerPro ? <ProMark /> : <LockBadge pro={item.inPro === true || lock === 'pro'} />)}
            {item.published === false && <DraftBadge />}
            <DoneTick count={count} />
          </span>
        )}
      </span>
      <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:text-primary rtl:-scale-x-100" aria-hidden="true" />
    </Link>
  );
}
