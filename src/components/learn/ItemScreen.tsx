import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'use-intl';
import { Camera, Check, ChevronDown, Dices, Layers, Loader2, Lock, Maximize2, PencilLine, Printer, SearchX, Sparkles, Timer } from 'lucide-react';
import { useProject } from '@/hooks/useProjectStore';
import { activeControls, resolveSketch } from '@/lib/sketch/settings';
import { DEFAULT_FILTERS, matchesFilters, pickChallenge } from '@/lib/learn/pick';
import { itemPath, learnPath } from '@/lib/learn/routes';
import { useAccount, useHasFeature } from '@/components/shell/account';
import { TOOLS, pathForView } from '@/components/shell/tools';
import PrepareWorksheets from '@/components/worksheets/PrepareWorksheets';
import {
  LearnRequestError,
  assetUrl,
  localDay,
  referenceDataUrl,
  useCompletionChanges,
  useCompletions,
  useLearnItem,
  useLearnList,
  type ItemAnswer,
  type OpenItem,
} from './data';
import { useClassMode } from './ClassMode';
import { ReplaceDialog, useToolHandoff } from './handoff';
import { recentlyDone } from './LearnHome';
import { useStoredFilters } from './ChallengesScreen';
import ZoomViewer from './ZoomViewer';
import { DoneTick, DraftBadge, Failed, LearnHeader, Loading, buttonPrimary, buttonSecondary, chip, useLocalized } from './parts';

// S3 · An exercise, S5 · a challenge, S9 · either one locked. The whole card
// only when the server opens it to this account; otherwise the locked page,
// which never has the instructions, the guide or the reference (the server
// does not send them). Designed for paper: the reference large (full screen
// and zoom on a tap), the short instruction, then what to do — worksheets,
// a tool with the reference already in it, "Mark as completed" — and "More
// help" folded away.

export default function ItemScreen({ id, kind }: { id: string; kind: 'exercise' | 'challenge' }) {
  const t = useTranslations('learn');
  const query = useLearnItem(id);
  const back =
    kind === 'challenge'
      ? { href: learnPath({ screen: 'challenges' }), label: t('places.challenges') }
      : { href: learnPath({ screen: 'curriculum' }), label: t('places.curriculum') };

  if (query.isPending) {
    return (
      <>
        <LearnHeader back={back} title={t('loading')} />
        <Loading />
      </>
    );
  }
  if (query.isError) {
    return (
      <>
        <LearnHeader back={back} title={kind === 'challenge' ? t('item.challenge') : t('item.exercise')} />
        <Failed error={query.error} onRetry={() => void query.refetch()} />
      </>
    );
  }
  const answer = query.data;
  if (answer.status === 'not_found') return <NotFound back={back} />;
  if (answer.status === 'locked') return <LockedItem answer={answer} back={back} />;
  return <OpenCard item={answer.item} back={back} />;
}

function NotFound({ back }: { back: { href: string; label: string } }) {
  const t = useTranslations('learn');
  return (
    <>
      <LearnHeader back={back} title={t('item.notFound')} lead={t('item.notFoundBody')} />
      <SearchX className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
    </>
  );
}

/** S9 · The locked page: what it is (when lists may show it), why it is locked, and the way on. Nothing of its content. */
function LockedItem({ answer, back }: { answer: Extract<ItemAnswer, { status: 'locked' }>; back: { href: string; label: string } }) {
  const t = useTranslations('learn.lockedItem');
  const loc = useLocalized();
  const account = useAccount()?.account;
  const inPro = account?.offer.pro.includes(answer.feature) === true;
  const offered = inPro || account?.offer.free.includes(answer.feature) === true;
  const reason = answer.reason === 'module_off' ? (!offered ? 'off' : inPro && account?.plan.effective !== 'pro' ? 'pro' : 'plan') : 'plan';
  const Icon = answer.item?.kind === 'challenge' ? Sparkles : PencilLine;
  return (
    <section aria-labelledby="learn-locked-title" data-learn-locked={answer.reason} className="flex justify-center py-6">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 text-center shadow-sm md:p-8">
        <div className="relative mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-secondary">
          <Icon className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <span className="absolute -bottom-1.5 -end-1.5 flex h-7 w-7 items-center justify-center rounded-full border-2 border-card bg-primary text-primary-foreground">
            <Lock className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
        </div>
        <p className="mt-5 text-xs font-semibold uppercase tracking-wider text-primary">{reason === 'pro' ? t('badgePro') : t('badge')}</p>
        <h1 id="learn-locked-title" className="mt-1.5 text-xl font-bold leading-snug text-foreground md:text-2xl">
          {answer.item ? t('title', { title: loc(answer.item.title) }) : t('titleUnknown')}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{t(`reason.${reason}`)}</p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Link href={learnPath({ screen: 'home' })} className={buttonPrimary}>
            {t('back')}
          </Link>
          <Link href={pathForView('plans')} className={buttonSecondary}>
            {t('comparePlans')}
          </Link>
        </div>
      </div>
    </section>
  );
}

function OpenCard({ item, back }: { item: OpenItem; back: { href: string; label: string } }) {
  const t = useTranslations('learn');
  const loc = useLocalized();
  const classMode = useClassMode();
  const reference = item.references[0] ?? null;
  const [zoom, setZoom] = useState(false);

  // Challenges shown in this tab are remembered here, so Random and "Another one" do not repeat them.
  const { seen } = classMode;
  useEffect(() => {
    if (item.kind === 'challenge') seen(item.id);
  }, [item.id, item.kind, seen]);

  const eyebrow = (
    <div className="mb-2 flex flex-wrap items-center gap-1.5">
      <span className="text-xs font-semibold uppercase tracking-wider text-primary">{item.kind === 'challenge' ? t('item.challenge') : t('item.exercise')}</span>
      {item.kind === 'challenge' && (
        <>
          <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-foreground/80">{t(`challenges.levels.${item.level}`)}</span>
          {item.quick && (
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold text-foreground">
              <Timer className="h-3 w-3" aria-hidden="true" /> {t('challenges.quickBadge')}
            </span>
          )}
        </>
      )}
      {item.published === false && <DraftBadge />}
    </div>
  );

  return (
    <article data-learn-card={item.id}>
      <LearnHeader back={back} title={loc(item.title)} eyebrow={eyebrow} />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-start lg:gap-8">
        <div className="lg:sticky lg:top-4">
          {reference ? (
            <figure>
              <div className="relative overflow-hidden rounded-2xl border border-border bg-secondary">
                {/* eslint-disable-next-line @next/next/no-img-element -- a private image from the authorized Learn route */}
                <img
                  src={assetUrl(reference.assetId)}
                  alt={loc(reference.alt)}
                  width={reference.width ?? undefined}
                  height={reference.height ?? undefined}
                  decoding="async"
                  className="mx-auto h-auto max-h-[32vh] w-auto max-w-full object-contain sm:max-h-[42vh] md:max-h-[55vh] lg:max-h-[72vh]"
                  data-learn-reference
                />
                <button
                  type="button"
                  onClick={() => setZoom(true)}
                  aria-label={t('item.openFull')}
                  className="absolute inset-0 flex items-end justify-end p-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-background/80 text-foreground shadow" aria-hidden="true">
                    <Maximize2 className="h-5 w-5" />
                  </span>
                </button>
              </div>
            </figure>
          ) : (
            <div className="flex items-center gap-3 rounded-2xl border border-dashed border-border bg-card p-5 text-sm text-foreground">
              {item.kind === 'challenge' ? <Sparkles className="h-6 w-6 shrink-0 text-primary" aria-hidden="true" /> : <PencilLine className="h-6 w-6 shrink-0 text-primary" aria-hidden="true" />}
              <p>{item.kind === 'challenge' ? t(`item.noReference.${item.reference}`) : loc(item.materials)}</p>
            </div>
          )}
        </div>

        <div className="min-w-0">
          <p className="text-lg leading-relaxed text-foreground md:text-xl" data-learn-instruction>
            {item.kind === 'exercise' ? loc(item.instruction) : loc(item.prompt)}
          </p>
          <dl className="mt-3 space-y-1 text-sm text-muted-foreground">
            <div className="flex gap-1.5">
              <dt className="font-semibold text-foreground/90">{item.kind === 'exercise' ? t('item.materials') : t('item.skill')}:</dt>
              <dd>{item.kind === 'exercise' ? loc(item.materials) : loc(item.skill)}</dd>
            </div>
          </dl>
          {item.kind === 'challenge' && (
            <p className="mt-1 text-sm text-muted-foreground">
              {t(`item.referenceKinds.${item.reference}`)} · {t(`item.mediums.${item.medium}`)}
            </p>
          )}

          <Actions item={item} />
          <ToolShortcuts item={item} />
          <MoreHelp item={item} />
        </div>
      </div>
      {zoom && reference && <ZoomViewer src={assetUrl(reference.assetId)} alt={loc(reference.alt)} onClose={() => setZoom(false)} />}
    </article>
  );
}

/** Prepare worksheets (or the static sheet), Use my photo, Mark as completed, Another one. */
function Actions({ item }: { item: OpenItem }) {
  const t = useTranslations('learn.item');
  const tw = useTranslations('worksheets');
  const router = useRouter();
  const classMode = useClassMode();
  const { gridSettings, valueSettings } = useProject();
  const offer = useAccount()?.account.offer;
  const canWorksheets = useHasFeature('export.worksheets');
  // Offered as in the tools: shown if any plan has it (locked when this one does not), hidden otherwise.
  const worksheetsOffered = canWorksheets || offer?.free.includes('export.worksheets') === true || offer?.pro.includes('export.worksheets') === true;
  const reference = item.references[0] ?? null;
  const generated = reference !== null && (item.kind === 'exercise' ? item.worksheet.kind === 'generated' : item.reference === 'provided');
  const staticSheet = item.kind === 'exercise' && item.worksheet.kind === 'static' ? item.worksheet.assetId : null;
  const ownPhoto = item.kind === 'challenge' && item.reference === 'own_photo';
  const [sheet, setSheet] = useState<{ image: string; learnItem: string | null } | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);

  // The canvas and grid are Create a Grid's; the picture is fitted to the canvas (as from Study).
  const settings = useMemo(() => ({ ...gridSettings, rotation: 0 as const, imageScale: 1, imageOffsetX: 0, imageOffsetY: 0 }), [gridSettings]);
  const outline = useMemo(() => activeControls({ ...resolveSketch(valueSettings), style: 'outline' }), [valueSettings]);

  const openWorksheets = async () => {
    if (!reference || preparing) return;
    setError(null);
    setPreparing(true);
    try {
      setSheet({ image: await referenceDataUrl(reference.assetId), learnItem: item.id });
    } catch (failure) {
      setError(failure instanceof LearnRequestError && failure.status === 403 ? t('handoffLocked') : t('handoffFailed'));
    } finally {
      setPreparing(false);
    }
  };
  const onPhoto = (file: File | undefined) => {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => setSheet({ image: reader.result as string, learnItem: null });
    reader.readAsDataURL(file);
  };
  // Class mode: the next student starts from the library again, with the same sheet choices.
  const nextStudent = () => {
    setSheet(null);
    router.push(learnPath({ screen: item.kind === 'challenge' ? 'challenges' : 'curriculum' }));
  };

  return (
    <div className="mt-5 space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-start">
        {generated && worksheetsOffered && (
          <button type="button" onClick={() => void openWorksheets()} disabled={preparing} className={buttonPrimary} data-learn-worksheets>
            {preparing ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : canWorksheets ? <Layers className="h-5 w-5" aria-hidden="true" /> : <Lock className="h-5 w-5" aria-hidden="true" />}
            {canWorksheets ? t('worksheets') : t('worksheetsLocked')}
          </button>
        )}
        {staticSheet && (
          <a href={assetUrl(staticSheet)} download className={buttonPrimary}>
            <Printer className="h-5 w-5" aria-hidden="true" /> {t('printWorksheet')}
          </a>
        )}
        {ownPhoto && worksheetsOffered && (
          <>
            <button type="button" onClick={() => photoInput.current?.click()} className={generated ? buttonSecondary : buttonPrimary} aria-describedby="learn-own-photo-hint">
              <Camera className="h-5 w-5" aria-hidden="true" /> {t('useMyPhoto')}
            </button>
            <input
              ref={photoInput}
              type="file"
              accept="image/*"
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(event) => {
                onPhoto(event.target.files?.[0]);
                event.target.value = '';
              }}
            />
          </>
        )}
        {!classMode.on && <MarkDone itemId={item.id} />}
        {item.kind === 'challenge' && <AnotherOne currentId={item.id} />}
      </div>
      {ownPhoto && worksheetsOffered && (
        <p id="learn-own-photo-hint" className="text-xs text-muted-foreground">
          {t('useMyPhotoHint')}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {sheet && (
        <PrepareWorksheets
          from="grid"
          image={sheet.image}
          settings={settings}
          fitted
          outline={outline}
          learnItem={sheet.learnItem}
          lead={sheet.learnItem ? tw('fromReference') : undefined}
          onNext={classMode.on ? nextStudent : undefined}
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  );
}

/** "Mark as completed": optional; once a day; "Undo" for a few seconds afterwards. Never shown in class mode. */
function MarkDone({ itemId }: { itemId: string }) {
  const t = useTranslations('learn.item');
  const completions = useCompletions(true);
  const { mark, remove } = useCompletionChanges();
  const [undoable, setUndoable] = useState<string | null>(null);
  const [status, setStatus] = useState<'marked' | 'undone' | 'failed' | null>(null);
  const entry = completions.data?.summary.items[itemId];
  const today = entry ? localDay(entry.last) === localDay(new Date()) : false;

  useEffect(() => {
    if (!undoable) return;
    const timer = window.setTimeout(() => setUndoable(null), 8000);
    return () => window.clearTimeout(timer);
  }, [undoable]);

  const onMark = () =>
    mark.mutate(itemId, {
      onSuccess: ({ completion }) => {
        setUndoable(completion.id);
        setStatus('marked');
      },
      onError: () => setStatus('failed'),
    });
  const onUndo = () => {
    if (!undoable) return;
    remove.mutate(undoable, {
      onSuccess: () => {
        setUndoable(null);
        setStatus('undone');
      },
      onError: () => setStatus('failed'),
    });
  };

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={onMark}
        disabled={today || mark.isPending || completions.isPending}
        className={buttonSecondary}
        data-mark-done={today ? 'today' : 'ready'}
      >
        {mark.isPending ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : <Check className="h-5 w-5" aria-hidden="true" />}
        {mark.isPending ? t('marking') : today ? t('doneToday') : t('markDone')}
      </button>
      <span className="flex min-h-[20px] flex-wrap items-center gap-2" aria-live="polite">
        {entry && <DoneTick count={entry.count} />}
        {status === 'marked' && undoable && (
          <>
            <span className="text-sm text-foreground">{t('marked')}</span>
            <button type="button" onClick={onUndo} disabled={remove.isPending} className="min-h-[36px] rounded-lg px-2 text-sm font-semibold text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-undo>
              {t('undo')}
            </button>
          </>
        )}
        {status === 'undone' && <span className="text-sm text-foreground">{t('undone')}</span>}
        {status === 'failed' && <span className="text-sm text-destructive">{t('markFailed')}</span>}
      </span>
    </div>
  );
}

/** "Another one": a new pick the way this one was reached (all challenges, or the filters; quick or not), never this one. */
function AnotherOne({ currentId }: { currentId: string }) {
  const t = useTranslations('learn.item');
  const router = useRouter();
  const params = useSearchParams();
  const classMode = useClassMode();
  const list = useLearnList('challenges');
  const completions = useCompletions(!classMode.on);
  const [stored] = useStoredFilters();
  // How this challenge was reached, from a fixed set (anything else is ignored).
  const asked = params.get('pick');
  const how = asked === 'all' || asked === 'quick' || asked === 'filters' || asked === 'filters-quick' ? asked : null;
  const quickOnly = how === 'quick' || how === 'filters-quick';
  const filters = how === 'all' || how === 'quick' ? DEFAULT_FILTERS : stored;
  const items = list.data?.items ?? [];
  const another = items.some((e) => e.open && e.id !== currentId && matchesFilters(e, quickOnly ? { ...filters, quick: true } : filters));
  const go = () => {
    const id = pickChallenge(items, {
      filters,
      quickOnly,
      exclude: currentId,
      recentlyDone: classMode.on ? [] : recentlyDone(completions.data),
      recentlySeen: classMode.recent,
    });
    if (id && id !== currentId) router.push(`${itemPath(id)}${how ? `?pick=${how}` : ''}`);
  };
  return (
    <button type="button" onClick={go} disabled={!another} className={buttonSecondary} data-another>
      <Dices className="h-5 w-5" aria-hidden="true" /> {t('another')}
    </button>
  );
}

/** Tool shortcuts: each opens its tool with the reference already in it. */
function ToolShortcuts({ item }: { item: OpenItem }) {
  const t = useTranslations('learn.item');
  const tg = useTranslations();
  const handoff = useToolHandoff();
  if (item.tools.length === 0) return null;
  return (
    <section aria-labelledby="learn-tools-title" className="mt-6">
      <h2 id="learn-tools-title" className="mb-2 text-sm font-semibold text-muted-foreground">
        {t('tools')}
      </h2>
      <div className="flex flex-wrap gap-2">
        {item.tools.map((tool) => {
          const Icon = TOOLS[tool].icon;
          return (
            <button key={tool} type="button" onClick={() => void handoff.open(tool, item)} disabled={handoff.busy !== null} className={chip} data-open-in={tool}>
              {handoff.busy === tool ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Icon className="h-4 w-4 text-primary" aria-hidden="true" />}
              {handoff.busy === tool ? t('opening') : t('openIn', { tool: tg(`tools.${tool}.title`) })}
            </button>
          );
        })}
      </div>
      {handoff.error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {handoff.error}
        </p>
      )}
      {handoff.confirming && (
        <ReplaceDialog
          toolName={tg(`tools.${handoff.confirming.tool}.title`)}
          onReplace={() => void handoff.open(handoff.confirming!.tool, handoff.confirming!.item, true)}
          onCancel={handoff.cancel}
        />
      )}
    </section>
  );
}

/** "More help", folded: why, how, the common mistake and its fix, when it is done, and the picture credits. */
function MoreHelp({ item }: { item: OpenItem }) {
  const t = useTranslations('learn.item');
  const loc = useLocalized();
  const credits = item.references.filter((ref) => ref.credit);
  const rows: [string, string][] =
    item.kind === 'exercise'
      ? [
          [t('objective'), loc(item.objective)],
          ...(item.guide ? ([[t('guide'), loc(item.guide)]] as [string, string][]) : []),
          [t('mistake'), loc(item.mistake.mistake)],
          [t('fix'), loc(item.mistake.fix)],
          [t('success'), loc(item.success)],
        ]
      : [];
  if (rows.length === 0 && credits.length === 0) return null;
  return (
    <details className="group mt-6 rounded-2xl border border-border bg-card" data-more-help>
      <summary className="flex min-h-[48px] cursor-pointer list-none items-center justify-between gap-2 rounded-2xl px-4 text-[15px] font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        {t('moreHelp')}
        <ChevronDown className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="space-y-4 px-4 pb-4">
        {rows.length > 0 && (
          <dl className="space-y-3 text-sm leading-relaxed">
            {rows.map(([term, text]) => (
              <div key={term}>
                <dt className="font-semibold text-foreground">{term}</dt>
                <dd className="mt-0.5 text-muted-foreground">{text}</dd>
              </div>
            ))}
          </dl>
        )}
        {credits.length > 0 && (
          <div className="border-t border-border pt-3 text-xs leading-relaxed text-muted-foreground">
            <p className="font-semibold text-foreground/90">{t('credits')}</p>
            <ul className="mt-1 space-y-1">
              {credits.map((ref) => (
                <li key={ref.assetId}>{loc(ref.credit)}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </details>
  );
}

