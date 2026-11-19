import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'use-intl';
import { ArrowLeft, ArrowRight, Check, CircleAlert, Clock, Lock, Maximize2, Sparkles } from 'lucide-react';
import type { LearnReturn } from '@/hooks/useLearnReturn';
import { lessonNumbers, neighbours, unitNumbers } from '@/lib/learn/course';
import { itemPath, learnPath } from '@/lib/learn/routes';
import { useLearnSummary } from '@/components/shell/account';
import { assetUrl, useLearnList, type ImageView, type OpenExercise } from './data';
import { useClassMode } from './ClassMode';
import DemoCarousel from './DemoCarousel';
import { Credits, MarkDone, PrepareButton, PrintSheet, StepToolLink, ToolShortcuts, useDoneToday, useWorksheets } from './ItemParts';
import ZoomViewer from './ZoomViewer';
import { DraftBadge, LearnHeader, buttonPrimary, buttonSecondary, chip, useLocalized } from './parts';

// S3 · A lesson (ADR-0019, docs/learn/08 §3): one skill, taught on the page.
// Its parts, always in this order: what you will learn; "See it", the
// demonstration; "Do it", the steps on paper, with the subject and the tools
// where they help; "Check it", questions for the learner (ticked for oneself,
// never saved); the common mistake; "Done when", then the next lesson.
// Nothing a learner needs is folded away: only the picture credits are.
// On a tablet in landscape and on desktop, "See it" stays in view beside the
// steps; on a phone it comes first, small enough to leave the steps in reach.

const sectionTitle = 'text-sm font-bold uppercase tracking-wider text-primary';

export default function LessonCard({ item, back }: { item: OpenExercise; back: { href: string; label: string } }) {
  const t = useTranslations('learn.lesson');
  const loc = useLocalized();
  const classMode = useClassMode();
  const summary = useLearnSummary();
  const course = useLearnList(item.collection, summary.modules[item.collection] !== null);
  const challenges = useLearnList('challenges', summary.modules.challenges !== null);
  const sheets = useWorksheets(item);
  const doneToday = useDoneToday(item.id, !classMode.on);
  const [zoom, setZoom] = useState<ImageView | null>(null);

  const entries = course.data?.items ?? [];
  const numbers = lessonNumbers(entries);
  const number = numbers.get(item.id) ?? null;
  const units = unitNumbers(course.data?.groups ?? [], entries);
  const unit = item.collection === 'curriculum' ? (units.get(item.groupId) ?? null) : null;
  const { previous, next } = neighbours(entries, item.id);
  const practise = (challenges.data?.items ?? []).filter((challenge) => challenge.lessons?.includes(item.id));
  const returnTo: LearnReturn = { href: itemPath(item.id), kind: 'exercise', number, title: item.title };
  const steps = item.steps ?? [];
  const images = [...(item.demo ?? []).map((frame) => frame.image), ...steps.flatMap((step) => (step.image ? [step.image] : [])), ...(item.mistake.image ? [item.mistake.image] : []), ...item.references];

  const eyebrow = (
    <div className="mb-2 flex flex-wrap items-center gap-1.5">
      <span className="text-xs font-semibold uppercase tracking-wider text-primary" data-lesson-place>
        {item.optional ? t('eyebrowOptional') : number !== null ? (unit !== null ? t('eyebrow', { unit, number, total: numbers.size }) : t('eyebrowNoUnit', { number, total: numbers.size })) : t('lesson')}
      </span>
      {item.published === false && <DraftBadge />}
    </div>
  );

  return (
    <article data-learn-card={item.id} data-learn-lesson>
      <LearnHeader back={back} title={loc(item.title)} eyebrow={eyebrow}>
        <p className="mt-2 max-w-2xl text-base leading-relaxed text-foreground md:text-lg" data-learn-objective>
          {loc(item.objective)}
        </p>
        <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          {item.minutes !== undefined && (
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" aria-hidden="true" /> {t('minutes', { minutes: item.minutes })}
            </span>
          )}
          <span>
            <span className="font-semibold text-foreground/90">{t('materials')}:</span> {loc(item.materials)}
          </span>
        </p>
      </LearnHeader>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:items-start lg:gap-8">
        <div className="lg:sticky lg:top-4">
          <DemoCarousel frames={item.demo ?? []} />
        </div>

        <div className="min-w-0 space-y-6">
          <section aria-labelledby="lesson-do-title" data-lesson-steps>
            <h2 id="lesson-do-title" className={sectionTitle}>
              {t('doIt')}
            </h2>
            <ol role="list" className="mt-3 space-y-4">
              {steps.map((step, i) => (
                <li key={i} className="flex gap-3" data-lesson-step={i + 1}>
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-bold tabular-nums text-primary" aria-hidden="true">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1 pt-0.5">
                    <p className="text-[15px] leading-relaxed text-foreground">
                      <span className="sr-only">{t('step', { number: i + 1 })}: </span>
                      {loc(step.text)}
                    </p>
                    {step.image && <StepPicture image={step.image} onOpen={() => setZoom(step.image!)} />}
                    {step.tool && <StepToolLink item={item} link={step.tool} back={returnTo} />}
                    {step.worksheet && (sheets.generated || sheets.staticSheet) && (
                      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                        {sheets.generated && <PrepareButton sheets={sheets} primary={false} />}
                        {sheets.staticSheet && <PrintSheet assetId={sheets.staticSheet} primary={false} />}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ol>
            {sheets.error && (
              <p role="alert" className="mt-2 text-sm text-destructive">
                {sheets.error}
              </p>
            )}
          </section>

          {item.checks && item.checks.length > 0 && (
            <section aria-labelledby="lesson-check-title" className="rounded-2xl border border-border bg-card p-4" data-lesson-checks>
              <h2 id="lesson-check-title" className={sectionTitle}>
                {t('checkIt')}
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">{t('checkItHint')}</p>
              <ul role="list" className="mt-2 space-y-0.5">
                {item.checks.map((check, i) => (
                  <li key={i}>
                    <label className="flex min-h-[44px] cursor-pointer items-start gap-3 rounded-lg py-2 text-[15px] leading-snug text-foreground">
                      <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-primary" data-lesson-check={i + 1} />
                      <span>{loc(check)}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section aria-labelledby="lesson-mistake-title" data-lesson-mistake>
            <h2 id="lesson-mistake-title" className={sectionTitle}>
              {t('mistake')}
            </h2>
            {item.mistake.image && (
              <button
                type="button"
                onClick={() => setZoom(item.mistake.image!)}
                aria-label={`${t('zoomPicture')}: ${loc(item.mistake.image.alt)}`}
                className="group relative mt-3 block w-full overflow-hidden rounded-xl bg-[#f4f1ea] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- a private image from the authorized Learn route */}
                <img
                  src={assetUrl(item.mistake.image.assetId)}
                  alt={loc(item.mistake.image.alt)}
                  width={item.mistake.image.width ?? undefined}
                  height={item.mistake.image.height ?? undefined}
                  loading="lazy"
                  decoding="async"
                  className="mx-auto h-auto max-h-[30vh] w-auto max-w-full object-contain"
                />
                <span className="absolute bottom-2 end-2 flex h-9 w-9 items-center justify-center rounded-full bg-background/80 text-foreground shadow" aria-hidden="true">
                  <Maximize2 className="h-4 w-4" />
                </span>
              </button>
            )}
            <div className="mt-3 space-y-2 text-[15px] leading-relaxed">
              <p className="flex gap-2">
                <CircleAlert className="mt-1 h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />
                <span>
                  <span className="font-semibold text-foreground">{t('mistakeLabel')}:</span> <span className="text-foreground/90">{loc(item.mistake.mistake)}</span>
                </span>
              </p>
              <p className="flex gap-2">
                <Check className="mt-1 h-4 w-4 shrink-0 text-emerald-300" aria-hidden="true" />
                <span>
                  <span className="font-semibold text-foreground">{t('fixLabel')}:</span> <span className="text-foreground/90">{loc(item.mistake.fix)}</span>
                </span>
              </p>
            </div>
          </section>

          <section aria-labelledby="lesson-done-title" className="rounded-2xl border border-primary/30 bg-primary/5 p-4" data-lesson-done>
            <h2 id="lesson-done-title" className={sectionTitle}>
              {t('doneWhen')}
            </h2>
            <p className="mt-1.5 text-[15px] leading-relaxed text-foreground">{loc(item.success)}</p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-start">
              {!classMode.on && <MarkDone itemId={item.id} />}
              {next && (
                <Link href={itemPath(next.id)} className={doneToday || classMode.on ? buttonPrimary : buttonSecondary} data-lesson-next={next.id}>
                  {t('next', { number: numbers.get(next.id) ?? 1 })}
                  <ArrowRight className="h-5 w-5 rtl:-scale-x-100" aria-hidden="true" />
                </Link>
              )}
            </div>
          </section>

          {practise.length > 0 && (
            <section aria-labelledby="lesson-practise-title" data-lesson-practise>
              <h2 id="lesson-practise-title" className="text-sm font-semibold text-muted-foreground">
                {t('practise')}
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">{t('practiseLead')}</p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {practise.map((challenge) => (
                  <li key={challenge.id}>
                    <Link href={itemPath(challenge.id)} className={chip} data-practise={challenge.id}>
                      {challenge.open ? <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" /> : <Lock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />}
                      {loc(challenge.title)}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <ToolShortcuts item={item} back={returnTo} />

          {item.guide && (
            <section aria-labelledby="lesson-why-title" data-lesson-why>
              <h2 id="lesson-why-title" className="text-sm font-semibold text-muted-foreground">
                {t('why')}
              </h2>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{loc(item.guide)}</p>
            </section>
          )}

          <Credits images={images} />

          <nav aria-label={t('lessons')} className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4 text-sm">
            {previous ? (
              <Link href={itemPath(previous.id)} className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-1 font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-lesson-previous={previous.id}>
                <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" aria-hidden="true" /> {t('previous', { number: numbers.get(previous.id) ?? 1 })}
              </Link>
            ) : (
              <span />
            )}
            <Link href={learnPath({ screen: 'curriculum' })} className="inline-flex min-h-[44px] items-center rounded-lg px-1 font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {t('allLessons')}
            </Link>
          </nav>
        </div>
      </div>
      {sheets.view}
      {zoom && <ZoomViewer src={assetUrl(zoom.assetId)} alt={loc(zoom.alt)} title={t('zoomTitle')} onClose={() => setZoom(null)} />}
    </article>
  );
}

/** A step's small picture (the subject, say), opening full screen on a tap. */
function StepPicture({ image, onOpen }: { image: ImageView; onOpen: () => void }) {
  const t = useTranslations('learn.lesson');
  const loc = useLocalized();
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${t('zoomPicture')}: ${loc(image.alt)}`}
      className="group relative mt-2 block overflow-hidden rounded-xl border border-border bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      data-step-picture
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- a private image from the authorized Learn route */}
      <img
        src={assetUrl(image.thumbnailAssetId ?? image.assetId)}
        alt={loc(image.alt)}
        loading="lazy"
        decoding="async"
        className="h-24 w-auto max-w-[60vw] object-contain sm:h-28"
      />
      <span className="absolute bottom-1 end-1 flex h-7 w-7 items-center justify-center rounded-full bg-background/80 text-foreground shadow" aria-hidden="true">
        <Maximize2 className="h-3.5 w-3.5" />
      </span>
    </button>
  );
}

