import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'use-intl';
import { ChevronDown, Dices, Timer, X } from 'lucide-react';
import { CHALLENGE_LEVELS } from '@/lib/learn/model';
import { DEFAULT_FILTERS, FILTERS_KEY, filtersActive, matchesFilters, pickChallenge, readFilters, type ChallengeFilters } from '@/lib/learn/pick';
import { itemPath, learnPath } from '@/lib/learn/routes';
import { useCompletions, useLearnList, type ListEntry } from './data';
import { useClassMode } from './ClassMode';
import { recentlyDone, useModuleLock } from './LearnHome';
import { DoneTick, DraftBadge, Failed, LearnHeader, Loading, LockBadge, Thumb, buttonPrimary, buttonSecondary, useLocalized } from './parts';

// S4 · The challenges: filters in one row (level, subject, pencil or color,
// quick only), remembered on this device; Random and Quick pick among the
// challenges this account may open that match them; then every challenge as
// a card, locked ones marked (with a thumbnail only where previews allow).

/** The filters, remembered on this device (never sent anywhere). */
export function useStoredFilters(): [ChallengeFilters, (next: ChallengeFilters) => void] {
  const [filters, setFilters] = useState<ChallengeFilters>(() => {
    try {
      return readFilters(JSON.parse(localStorage.getItem(FILTERS_KEY) ?? 'null'));
    } catch {
      return DEFAULT_FILTERS;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(FILTERS_KEY, JSON.stringify(filters));
    } catch {
      // Private browsing: the filters are simply not remembered.
    }
  }, [filters]);
  return [filters, setFilters];
}

export default function ChallengesScreen() {
  const t = useTranslations('learn');
  const loc = useLocalized();
  const router = useRouter();
  const classMode = useClassMode();
  const list = useLearnList('challenges');
  const completions = useCompletions(!classMode.on);
  const [filters, setFilters] = useStoredFilters();
  const [none, setNone] = useState(false);
  const counts = classMode.on ? {} : (completions.data?.summary.items ?? {});
  const items = list.data?.items ?? [];
  const shown = items.filter((item) => matchesFilters(item, filters));
  const groups = (list.data?.groups ?? []).filter((group) => group.id === filters.group || items.some((item) => item.groupId === group.id));

  const set = (change: Partial<ChallengeFilters>) => {
    setNone(false);
    setFilters({ ...filters, ...change });
  };
  const pick = (quickOnly: boolean) => {
    const id = pickChallenge(items, {
      filters,
      quickOnly,
      recentlyDone: classMode.on ? [] : recentlyDone(completions.data),
      recentlySeen: classMode.recent,
    });
    setNone(id === null);
    if (id) router.push(`${itemPath(id)}?pick=${quickOnly ? 'filters-quick' : 'filters'}`);
  };

  return (
    <>
      <LearnHeader back={{ href: learnPath({ screen: 'home' }), label: t('places.learn') }} title={t('challenges.title')} lead={t('challenges.lead')}>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={() => pick(false)} disabled={!list.data} className={buttonPrimary} data-pick="random">
            <Dices className="h-5 w-5" aria-hidden="true" /> {t('challenges.random')}
          </button>
          <button type="button" onClick={() => pick(true)} disabled={!list.data} className={buttonSecondary} data-pick="quick">
            <Timer className="h-5 w-5" aria-hidden="true" /> {t('challenges.quick')}
          </button>
        </div>
        {none && (
          <p role="status" className="mt-2 text-sm text-muted-foreground">
            {items.some((item) => matchesFilters(item, filters)) ? t('challenges.noneOpen') : t('challenges.noMatch')}
          </p>
        )}
      </LearnHeader>

      <div role="group" aria-label={t('challenges.filters')} className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:mx-0 md:flex-wrap md:overflow-visible md:px-0 [&::-webkit-scrollbar]:hidden" data-learn-filters>
        <FilterSelect
          label={t('challenges.level')}
          value={filters.level}
          onChange={(level) => set({ level: level as ChallengeFilters['level'] })}
          options={[{ value: 'all', label: t('challenges.levels.all') }, ...CHALLENGE_LEVELS.map((level) => ({ value: level, label: t(`challenges.levels.${level}`) }))]}
        />
        <FilterSelect
          label={t('challenges.subject')}
          value={filters.group}
          onChange={(group) => set({ group })}
          options={[{ value: 'all', label: t('challenges.allSubjects') }, ...groups.map((group) => ({ value: group.id, label: loc(group.title) }))]}
        />
        <FilterSelect
          label={t('challenges.medium')}
          value={filters.medium}
          onChange={(medium) => set({ medium: medium as ChallengeFilters['medium'] })}
          options={(['all', 'pencil', 'color'] as const).map((medium) => ({ value: medium, label: t(`challenges.mediums.${medium}`) }))}
        />
        <button
          type="button"
          aria-pressed={filters.quick}
          onClick={() => set({ quick: !filters.quick })}
          className={`inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-full border px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
            filters.quick ? 'border-primary bg-primary/15 text-foreground' : 'border-border bg-card text-foreground hover:bg-secondary'
          }`}
        >
          <Timer className="h-4 w-4" aria-hidden="true" /> {t('challenges.quickOnly')}
        </button>
        {filtersActive(filters) && (
          <button
            type="button"
            onClick={() => set(DEFAULT_FILTERS)}
            className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-4 w-4" aria-hidden="true" /> {t('challenges.clear')}
          </button>
        )}
      </div>

      {list.isPending ? (
        <Loading />
      ) : list.isError ? (
        <Failed error={list.error} onRetry={() => void list.refetch()} />
      ) : (
        <>
          <p aria-live="polite" className="mb-3 text-sm text-muted-foreground">
            {shown.length === 0 ? t('challenges.noMatch') : t('challenges.count', { count: shown.length })}
          </p>
          {shown.length > 0 && (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {shown.map((item) => (
                <li key={item.id}>
                  <ChallengeCard item={item} count={counts[item.id]?.count ?? 0} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </>
  );
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[] }) {
  return (
    <label className="relative inline-flex shrink-0 items-center">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={`min-h-[44px] appearance-none rounded-full border bg-card pe-9 ps-4 [color-scheme:dark] text-sm font-medium text-foreground transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
          value === 'all' ? 'border-border' : 'border-primary bg-primary/15'
        }`}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute end-3 h-4 w-4 text-muted-foreground" aria-hidden="true" />
    </label>
  );
}

function ChallengeCard({ item, count }: { item: ListEntry; count: number }) {
  const t = useTranslations('learn');
  const loc = useLocalized();
  const lock = useModuleLock('challenges');
  return (
    <Link
      href={itemPath(item.id)}
      data-learn-item={item.id}
      data-open={item.open}
      className="group flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Thumb assetId={item.thumbnailAssetId} kind="challenge" className="aspect-[4/3] w-full rounded-none" />
      <span className="flex flex-1 flex-col gap-1.5 p-3">
        <span className="text-[15px] font-semibold leading-snug text-foreground">{loc(item.title)}</span>
        <span className="mt-auto flex flex-wrap items-center gap-1.5">
          {item.level && <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-foreground/80">{t(`challenges.levels.${item.level}`)}</span>}
          {item.quick && (
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold text-foreground">
              <Timer className="h-3 w-3" aria-hidden="true" /> {t('challenges.quickBadge')}
            </span>
          )}
          {!item.open && <LockBadge pro={lock === 'pro'} />}
          {item.published === false && <DraftBadge />}
          <DoneTick count={count} />
        </span>
      </span>
    </Link>
  );
}
