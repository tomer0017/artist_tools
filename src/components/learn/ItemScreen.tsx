import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'use-intl';
import { Camera, ChevronDown, Lock, Maximize2, PencilLine, SearchX, Sparkles, Timer } from 'lucide-react';
import { isLesson } from '@/lib/learn/model';
import { lessonNumbers, unitsOfLessons } from '@/lib/learn/course';
import { itemPath, learnPath } from '@/lib/learn/routes';
import { ProPaywall, proOfferFor } from '@/components/billing/pro';
import { useAccount, useLearnSummary } from '@/components/shell/account';
import { pathForView } from '@/components/shell/tools';
import { assetUrl, useLearnItem, useLearnList, type ItemAnswer, type OpenItem } from './data';
import { useClassMode } from './ClassMode';
import { AnotherOne, Credits, MarkDone, PrepareButton, PrintSheet, ToolShortcuts, useOwnPhotoInput, useWorksheets } from './ItemParts';
import { SaveToggle, useSavedChallenges } from './Playground';
import LessonCard from './LessonCard';
import ZoomViewer from './ZoomViewer';
import { DraftBadge, Failed, LearnHeader, Loading, buttonPrimary, buttonSecondary, chip, useLocalized } from './parts';

// S3 · An exercise, S5 · a challenge, S9 · either one locked. The whole page
// only when the server opens it to this account; otherwise the locked page,
// which never has the instructions, the guide or the reference (the server
// does not send them).
//
// An exercise written as a lesson (ADR-0019, ADR-0020) has its own page
// (LessonCard): one picture, a short task, one button on. A challenge keeps
// the brief: the subject large (full screen and zoom on a tap), the prompt and
// its focus, the lessons it builds on, then what to do — worksheets, a tool
// with the reference already in it, "Mark as completed". An exercise not yet
// written as a lesson keeps M5's card.

export default function ItemScreen({ id, kind }: { id: string; kind: 'exercise' | 'challenge' }) {
  const t = useTranslations('learn');
  // Admin → Learn's Preview link (?preview=1): admins see Blocked and archived items too.
  const preview = useSearchParams()?.get('preview') === '1';
  const query = useLearnItem(id, true, preview);
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
  const note = <AdminNote item={answer.item} />;
  if (answer.item.kind === 'exercise' && isLesson(answer.item)) {
    return (
      <>
        {note}
        <LessonCard item={answer.item} back={back} />
      </>
    );
  }
  return (
    <>
      {note}
      <OpenCard item={answer.item} back={back} />
    </>
  );
}

/** What admins are told above an item: who sees it (ADR-0023). Learners never get an access mode, so never see this. */
function AdminNote({ item }: { item: OpenItem }) {
  const t = useTranslations('learn.adminView');
  if (!item.access) return null;
  const key = item.archived ? 'archived' : item.access;
  const warn = key === 'blocked' || key === 'archived' || key === 'admin';
  return (
    <p data-learn-admin-view={key} className={`mb-3 rounded-xl border px-3 py-2 text-xs font-semibold ${warn ? 'border-primary/50 bg-primary/10 text-primary' : 'border-border bg-card text-muted-foreground'}`}>
      {t(key)}
    </p>
  );
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
  // A Pro item (ADR-0023) says it is part of Pro; a module lock (content before modes) as before.
  const reason = answer.reason === 'module_off' ? (!offered ? 'off' : inPro && account?.plan.effective !== 'pro' ? 'pro' : 'plan') : answer.inPro && account?.plan.effective !== 'pro' ? 'pro' : 'plan';
  const Icon = answer.item?.kind === 'challenge' ? Sparkles : PencilLine;
  const tp = useTranslations('billing.pro');
  // Pro opens it and Pro can be bought: the upgrade, on its own page.
  if (answer.inPro && proOfferFor(account)) {
    const title = answer.item ? tp('itemTitle', { title: loc(answer.item.title) }) : answer.feature === 'learn.challenges' ? tp('challengeTitle') : tp('lessonTitle');
    return <ProPaywall title={title} icon={<Icon className="h-7 w-7" aria-hidden="true" />} back={{ href: learnPath({ screen: 'home' }), label: t('back') }} />;
  }
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
            <div className="flex items-center gap-3 rounded-2xl border border-dashed border-border bg-card p-5 text-sm text-foreground" data-learn-subject>
              {item.kind === 'challenge' ? <Sparkles className="h-6 w-6 shrink-0 text-primary" aria-hidden="true" /> : <PencilLine className="h-6 w-6 shrink-0 text-primary" aria-hidden="true" />}
              <p>{item.kind === 'challenge' ? t(`item.noReference.${item.reference}`) : loc(item.materials)}</p>
            </div>
          )}
        </div>

        <div className="min-w-0">
          <p className="text-lg leading-relaxed text-foreground md:text-xl" data-learn-instruction>
            {item.kind === 'exercise' ? loc(item.instruction) : loc(item.prompt)}
          </p>
          {item.kind === 'challenge' && item.twist && (
            <p className="mt-2 text-[15px] leading-relaxed text-foreground" data-learn-twist>
              <span className="font-semibold text-primary">{t('playground.twist')}:</span> {loc(item.twist)}
            </p>
          )}
          {item.kind === 'challenge' && item.focus && (
            <p className="mt-2 text-[15px] leading-relaxed text-foreground" data-learn-focus>
              <span className="font-semibold text-primary">{t('item.focus')}:</span> {loc(item.focus)}
            </p>
          )}
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
          {item.kind === 'challenge' && item.lessons && item.lessons.length > 0 && <BuildsOn lessons={item.lessons} />}

          <Actions item={item} />
          <ToolShortcuts item={item} back={{ href: itemPath(item.id), kind: item.kind, number: null, title: item.title }} />
          {item.kind === 'exercise' ? <MoreHelp item={item} /> : <Credits images={item.references} />}
        </div>
      </div>
      {zoom && reference && <ZoomViewer src={assetUrl(reference.assetId)} alt={loc(reference.alt)} onClose={() => setZoom(false)} />}
    </article>
  );
}

/** "Builds on: Lesson 2 · Big shapes": the lessons that teach what a challenge practises, as lists show them (a lock when locked). */
function BuildsOn({ lessons }: { lessons: string[] }) {
  const t = useTranslations('learn.item');
  const loc = useLocalized();
  const summary = useLearnSummary();
  const course = useLearnList('curriculum', summary.modules.curriculum !== null);
  const entries = course.data?.items ?? [];
  const numbers = lessonNumbers(entries);
  const linked = lessons.flatMap((id) => entries.filter((entry) => entry.id === id));
  if (linked.length === 0) return null;
  return (
    <section aria-labelledby="learn-builds-on" className="mt-4" data-learn-builds-on>
      <h2 id="learn-builds-on" className="text-sm font-semibold text-muted-foreground">
        {t('buildsOn')}
      </h2>
      <ul className="mt-1.5 flex flex-wrap gap-2">
        {linked.map((entry) => {
          const number = numbers.get(entry.id);
          return (
            <li key={entry.id}>
              <Link href={itemPath(entry.id)} className={chip} data-builds-on={entry.id}>
                {entry.open ? <PencilLine className="h-4 w-4 text-primary" aria-hidden="true" /> : <Lock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />}
                {number ? t('buildsOnLesson', { number, title: loc(entry.title) }) : loc(entry.title)}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Prepare worksheets (or the static sheet), Use my photo, Mark as completed, Another one. */
function Actions({ item }: { item: OpenItem }) {
  const t = useTranslations('learn.item');
  const classMode = useClassMode();
  const summary = useLearnSummary();
  const sheets = useWorksheets(item);
  const photo = useOwnPhotoInput(sheets.usePhoto);
  const [saved, toggleSaved] = useSavedChallenges();
  // Sketchy's class roulette sends ?sheets=1: the practice sheets open at once, as if "Prepare worksheets" were pressed (ADR-0024).
  const wantSheets = useSearchParams()?.get('sheets') === '1';
  const askedSheets = useRef(false);
  useEffect(() => {
    if (!wantSheets || askedSheets.current || !sheets.generated || !sheets.canWorksheets) return;
    askedSheets.current = true;
    void sheets.prepare();
  }, [wantSheets, sheets]);
  // The Skill filter of "Another one" needs the course's units (ignored without them).
  const course = useLearnList('curriculum', item.kind === 'challenge' && summary.modules.curriculum !== null);
  const entries = course.data?.items;
  const unitsOf = entries ? (lessons: string[] | undefined) => unitsOfLessons(lessons, entries) : undefined;

  return (
    <div className="mt-5 space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-start">
        {sheets.generated && <PrepareButton sheets={sheets} />}
        {sheets.staticSheet && <PrintSheet assetId={sheets.staticSheet} />}
        {sheets.ownPhoto && (
          <>
            <button type="button" onClick={photo.open} className={sheets.generated ? buttonSecondary : buttonPrimary} aria-describedby="learn-own-photo-hint">
              <Camera className="h-5 w-5" aria-hidden="true" /> {t('useMyPhoto')}
            </button>
            {photo.element}
          </>
        )}
        {!classMode.on && <MarkDone itemId={item.id} />}
        {item.kind === 'challenge' && <SaveToggle id={item.id} saved={saved.includes(item.id)} onToggle={toggleSaved} />}
        {item.kind === 'challenge' && <AnotherOne currentId={item.id} unitsOf={unitsOf} />}
      </div>
      {sheets.ownPhoto && (
        <p id="learn-own-photo-hint" className="text-xs text-muted-foreground">
          {t('useMyPhotoHint')}
        </p>
      )}
      {sheets.error && (
        <p role="alert" className="text-sm text-destructive">
          {sheets.error}
        </p>
      )}
      {sheets.view}
    </div>
  );
}

/** M5's "More help", folded, for an exercise not yet written as a lesson: why, how, the common mistake and its fix, when it is done, and the picture credits. */
function MoreHelp({ item }: { item: Extract<OpenItem, { kind: 'exercise' }> }) {
  const t = useTranslations('learn.item');
  const loc = useLocalized();
  const credits = item.references.filter((ref) => ref.credit);
  const rows: [string, string][] = [
    [t('objective'), loc(item.objective)],
    ...(item.guide ? ([[t('guide'), loc(item.guide)]] as [string, string][]) : []),
    [t('mistake'), loc(item.mistake.mistake)],
    [t('fix'), loc(item.mistake.fix)],
    [t('success'), loc(item.success)],
  ];
  return (
    <details className="group mt-6 rounded-2xl border border-border bg-card" data-more-help>
      <summary className="flex min-h-[48px] cursor-pointer list-none items-center justify-between gap-2 rounded-2xl px-4 text-[15px] font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        {t('moreHelp')}
        <ChevronDown className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="space-y-4 px-4 pb-4">
        <dl className="space-y-3 text-sm leading-relaxed">
          {rows.map(([term, text]) => (
            <div key={term}>
              <dt className="font-semibold text-foreground">{term}</dt>
              <dd className="mt-0.5 text-muted-foreground">{text}</dd>
            </div>
          ))}
        </dl>
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
