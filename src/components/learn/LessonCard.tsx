import { useRef, useState, type RefObject } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'use-intl';
import { ArrowRight, Check, CircleAlert, CircleHelp, Layers, Loader2, Lock, Maximize2, Printer, Sparkles, X } from 'lucide-react';
import { toast } from '@/components/ui/sonner';
import type { LearnReturn } from '@/hooks/useLearnReturn';
import { lessonNumbers, neighbours } from '@/lib/learn/course';
import { itemPath, learnPath } from '@/lib/learn/routes';
import { useLearnSummary } from '@/components/shell/account';
import { assetUrl, localDay, undoCompletion, useCompletionChanges, useCompletions, useLearnList, type ImageView, type ListEntry, type OpenExercise } from './data';
import { useClassMode } from './ClassMode';
import { Credits, StepToolLink, ToolShortcuts, useWorksheets } from './ItemParts';
import ZoomViewer from './ZoomViewer';
import { DraftBadge, LearnHeader, buttonPrimary, chip, useLocalized } from './parts';

// S3 · A lesson (ADR-0019, revised by ADR-0020): one small skill for someone
// who has never drawn. The page holds only what the lesson needs: its
// objective, one picture, the task on paper in one to three short lines, one
// small thing to make with the new skill, "Done when", and one button on:
// "I did it — next lesson". That records the person's own word that they did
// it (nothing judges the drawing), with Undo for a few seconds, and never in
// class mode. The rest waits behind "Need help?": the common mistake, why it
// works, what you need, tools, more practice, credits. The practice sheet is
// optional: every task works on any paper. On a wide screen the picture
// stays beside the task.

const sectionTitle = 'text-sm font-bold uppercase tracking-wider text-primary';
const quietButton =
  'inline-flex min-h-[44px] items-center gap-2 rounded-lg px-2 text-[15px] font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60';

export default function LessonCard({ item, back }: { item: OpenExercise; back: { href: string; label: string } }) {
  const t = useTranslations('learn.lesson');
  const ti = useTranslations('learn.item');
  const loc = useLocalized();
  const router = useRouter();
  const client = useQueryClient();
  const classMode = useClassMode();
  const summary = useLearnSummary();
  const course = useLearnList(item.collection, summary.modules[item.collection] !== null);
  const challenges = useLearnList('challenges', summary.modules.challenges !== null);
  const completions = useCompletions(!classMode.on);
  const { mark } = useCompletionChanges();
  const sheets = useWorksheets(item);
  const [zoom, setZoom] = useState<ImageView | null>(null);
  const [help, setHelp] = useState(false);
  const helpButton = useRef<HTMLButtonElement>(null);
  const [failed, setFailed] = useState(false);

  const entries = course.data?.items ?? [];
  const numbers = lessonNumbers(entries);
  const number = numbers.get(item.id) ?? null;
  const { next } = neighbours(entries, item.id);
  const picture = item.demo?.[0] ?? null;
  const steps = item.steps ?? [];
  const practise = (challenges.data?.items ?? []).filter((challenge) => challenge.lessons?.includes(item.id));
  const returnTo: LearnReturn = { href: itemPath(item.id), kind: 'exercise', number, title: item.title };
  const last = completions.data?.summary.items[item.id]?.last;
  const doneToday = !classMode.on && last !== undefined && localDay(last) === localDay(new Date());
  // "I did it" records once a day, never in class mode; otherwise the button only moves on.
  const records = !classMode.on && !doneToday;
  const onward = next ? itemPath(next.id) : learnPath({ screen: 'curriculum' });
  const ready = !course.isLoading && !completions.isLoading;

  const done = async () => {
    setFailed(false);
    try {
      const { completion } = await mark.mutateAsync(item.id);
      toast(t('marked', { title: loc(item.title) }), {
        position: 'top-center',
        duration: 6000,
        action: {
          label: ti('undo'),
          onClick: () => void undoCompletion(client, completion.id).then((removed) => toast(removed ? ti('undone') : t('undoFailed'), { position: 'top-center' })),
        },
      });
    } catch {
      setFailed(true);
      return;
    }
    router.push(onward);
  };

  const eyebrow = (
    <div className="mb-2 flex flex-wrap items-center gap-1.5">
      <span className="text-xs font-semibold uppercase tracking-wider text-primary" data-lesson-place>
        {item.optional ? t('eyebrowOptional') : number !== null ? t('eyebrow', { number, total: numbers.size }) : t('lesson')}
      </span>
      {item.published === false && <DraftBadge />}
    </div>
  );
  const label = records ? (next ? t('doneNext') : t('doneLast')) : next ? t('next') : t('backToCourse');
  const primaryContent = (
    <>
      {mark.isPending && <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />}
      {label}
      {!mark.isPending && <ArrowRight className="h-5 w-5 shrink-0 rtl:-scale-x-100" aria-hidden="true" />}
    </>
  );
  const primaryClass = `${buttonPrimary} w-full text-base sm:w-auto sm:min-w-[18rem]`;

  return (
    <article data-learn-card={item.id} data-learn-lesson>
      <LearnHeader back={back} title={loc(item.title)} eyebrow={eyebrow}>
        <p className="mt-2 max-w-2xl text-lg leading-relaxed text-foreground" data-learn-objective>
          {loc(item.objective)}
        </p>
      </LearnHeader>

      <div className="grid gap-6 lg:grid-cols-2 lg:items-start lg:gap-10">
        {picture && <LessonPicture image={picture.image} caption={loc(picture.caption)} onOpen={() => setZoom(picture.image)} />}

        <div className="min-w-0 space-y-6">
          <section aria-labelledby="lesson-task-title" data-lesson-task>
            <h2 id="lesson-task-title" className={sectionTitle}>
              {t('task')}
            </h2>
            <ol role="list" className="mt-3 space-y-3">
              {steps.map((step, i) => (
                <li key={i} className="flex gap-3" data-lesson-step={i + 1}>
                  {steps.length > 1 && (
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-bold tabular-nums text-primary" aria-hidden="true">
                      {i + 1}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-[17px] leading-relaxed text-foreground">
                      {steps.length > 1 && <span className="sr-only">{t('step', { number: i + 1 })}: </span>}
                      {loc(step.text)}
                    </p>
                    {step.image && <StepPicture image={step.image} onOpen={() => setZoom(step.image!)} />}
                    {step.tool && <StepToolLink item={item} link={step.tool} back={returnTo} />}
                  </div>
                </li>
              ))}
            </ol>
          </section>

          {item.create && (
            <section aria-labelledby="lesson-create-title" className="rounded-2xl border border-primary/25 bg-primary/10 p-4" data-lesson-create>
              <h2 id="lesson-create-title" className={`${sectionTitle} flex items-center gap-1.5`}>
                <Sparkles className="h-4 w-4 shrink-0" aria-hidden="true" /> {t('create')}
              </h2>
              <p className="mt-1.5 text-[17px] leading-relaxed text-foreground">{loc(item.create)}</p>
            </section>
          )}

          <p className="text-[15px] leading-relaxed text-foreground" data-lesson-done-when>
            <span className="font-semibold">{t('doneWhen')}:</span> {loc(item.success)}
          </p>

          <div>
            {records ? (
              <button type="button" onClick={() => void done()} disabled={!ready || mark.isPending} className={primaryClass} data-lesson-next={next?.id ?? 'course'} data-records="true">
                {primaryContent}
              </button>
            ) : (
              <Link href={onward} className={primaryClass} data-lesson-next={next?.id ?? 'course'} data-records="false">
                {primaryContent}
              </Link>
            )}
            {failed && (
              <p role="alert" className="mt-2 text-sm text-destructive">
                {ti('markFailed')}
              </p>
            )}
            {doneToday && (
              <p className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground" data-lesson-done-today>
                <Check className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" /> {ti('doneToday')}
              </p>
            )}

            <div className="-ms-2 mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
              {sheets.staticSheet && (
                <a href={assetUrl(sheets.staticSheet)} download={`${item.id}-practice-sheet.pdf`} className={quietButton} data-lesson-sheet>
                  <Printer className="h-5 w-5 shrink-0" aria-hidden="true" /> {t('sheet')}
                </a>
              )}
              {sheets.generated && (
                <button type="button" onClick={() => void sheets.prepare()} disabled={sheets.preparing} className={quietButton} data-learn-worksheets>
                  {sheets.preparing ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : sheets.canWorksheets ? <Layers className="h-5 w-5" aria-hidden="true" /> : <Lock className="h-5 w-5" aria-hidden="true" />}
                  {sheets.canWorksheets ? ti('worksheets') : ti('worksheetsLocked')}
                </button>
              )}
              <button ref={helpButton} type="button" onClick={() => setHelp(true)} className={quietButton} aria-haspopup="dialog" data-lesson-help-open>
                <CircleHelp className="h-5 w-5 shrink-0" aria-hidden="true" /> {t('help')}
              </button>
            </div>
            {(sheets.staticSheet || sheets.generated) && <p className="mt-0.5 text-sm text-muted-foreground">{t('sheetHint')}</p>}
            {sheets.error && (
              <p role="alert" className="mt-2 text-sm text-destructive">
                {sheets.error}
              </p>
            )}
          </div>
        </div>
      </div>

      <LessonHelp open={help} onClose={() => setHelp(false)} opener={helpButton} item={item} returnTo={returnTo} practise={practise} />
      {sheets.view}
      {zoom && <ZoomViewer src={assetUrl(zoom.assetId)} alt={loc(zoom.alt)} title={t('zoomTitle')} onClose={() => setZoom(null)} />}
    </article>
  );
}

/** The lesson's one picture, large; a tap opens it full screen. The button sits outside it: pictures never mirror, so a corner may hold content in either direction. */
function LessonPicture({ image, caption, onOpen }: { image: ImageView; caption: string; onOpen: () => void }) {
  const t = useTranslations('learn.lesson');
  const loc = useLocalized();
  return (
    <figure className="lg:sticky lg:top-4" data-lesson-picture>
      <button
        type="button"
        onClick={onOpen}
        tabIndex={-1}
        aria-label={`${t('zoomPicture')}: ${loc(image.alt)}`}
        className="block w-full cursor-zoom-in overflow-hidden rounded-2xl border border-border bg-[#f6f3ec] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- a private image from the authorized Learn route */}
        <img
          src={assetUrl(image.assetId)}
          alt={loc(image.alt)}
          width={image.width ?? undefined}
          height={image.height ?? undefined}
          decoding="async"
          className="mx-auto h-auto w-full object-contain lg:max-h-[70vh]"
        />
      </button>
      <figcaption className="mt-2 flex items-start gap-2">
        <span className="min-w-0 flex-1 pt-1 text-[15px] leading-relaxed text-muted-foreground" data-lesson-caption>
          {caption}
        </span>
        <button
          type="button"
          onClick={onOpen}
          aria-label={t('zoomPicture')}
          className="-me-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-lesson-zoom
        >
          <Maximize2 className="h-4 w-4" aria-hidden="true" />
        </button>
      </figcaption>
    </figure>
  );
}

/**
 * "Need help?": what the page leaves out, in a sheet over it (from the bottom
 * on a phone). The lesson's own mistake and how to avoid it, why it works,
 * what you need, the tools that help (only if the lesson names any), the
 * challenges that practise the skill, and the picture credits.
 */
function LessonHelp({
  open,
  onClose,
  opener,
  item,
  returnTo,
  practise,
}: {
  open: boolean;
  onClose: () => void;
  /** The button that opened it: focus goes back to it on closing. */
  opener: RefObject<HTMLButtonElement | null>;
  item: OpenExercise;
  returnTo: LearnReturn;
  practise: ListEntry[];
}) {
  const t = useTranslations('learn.lesson');
  const loc = useLocalized();
  const images = [...(item.demo ?? []).map((frame) => frame.image), ...(item.steps ?? []).flatMap((step) => (step.image ? [step.image] : [])), ...(item.mistake.image ? [item.mistake.image] : []), ...item.references];
  const subTitle = 'text-sm font-bold text-foreground';
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            opener.current?.focus();
          }}
          // No transform once open, so a dialog inside (Replace the photo?) still covers the screen.
          className="fixed inset-x-0 bottom-0 z-50 max-h-[88dvh] overflow-y-auto overscroll-contain rounded-t-2xl border border-border bg-card shadow-2xl outline-none data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom md:bottom-auto md:top-[8vh] md:mx-auto md:max-h-[84vh] md:max-w-lg md:rounded-2xl md:data-[state=open]:fade-in-0 md:data-[state=open]:slide-in-from-bottom-0"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
          data-lesson-help
        >
          <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-border bg-card px-5 py-2">
            <DialogPrimitive.Title className="text-lg font-semibold text-foreground">{t('helpTitle')}</DialogPrimitive.Title>
            <DialogPrimitive.Close
              aria-label={t('close')}
              className="-me-2 flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </DialogPrimitive.Close>
          </div>

          <div className="space-y-6 px-5 pb-6 pt-4">
            <section aria-labelledby="lesson-mistake-title" data-lesson-mistake>
              <h3 id="lesson-mistake-title" className={subTitle}>
                {t('mistake')}
              </h3>
              {item.mistake.image && (
                // eslint-disable-next-line @next/next/no-img-element -- a private image from the authorized Learn route
                <img
                  src={assetUrl(item.mistake.image.assetId)}
                  alt={loc(item.mistake.image.alt)}
                  width={item.mistake.image.width ?? undefined}
                  height={item.mistake.image.height ?? undefined}
                  loading="lazy"
                  decoding="async"
                  className="mt-3 h-auto w-full rounded-xl border border-border bg-[#f6f3ec]"
                />
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

            {item.guide && (
              <section aria-labelledby="lesson-why-title" data-lesson-why>
                <h3 id="lesson-why-title" className={subTitle}>
                  {t('why')}
                </h3>
                <p className="mt-1 text-[15px] leading-relaxed text-foreground/90">{loc(item.guide)}</p>
              </section>
            )}

            <section aria-labelledby="lesson-materials-title" data-lesson-materials>
              <h3 id="lesson-materials-title" className={subTitle}>
                {t('materials')}
              </h3>
              <p className="mt-1 text-[15px] leading-relaxed text-foreground/90">
                {loc(item.materials)}
                {item.minutes !== undefined && <span className="text-muted-foreground"> · {t('minutes', { minutes: item.minutes })}</span>}
              </p>
            </section>

            <ToolShortcuts item={item} back={returnTo} />

            {practise.length > 0 && (
              <section aria-labelledby="lesson-practise-title" data-lesson-practise>
                <h3 id="lesson-practise-title" className={subTitle}>
                  {t('practise')}
                </h3>
                <p className="mt-0.5 text-sm text-muted-foreground">{t('practiseLead')}</p>
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

            <Credits images={images} />
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** A task line's small picture (the subject, say), opening full screen on a tap. */
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
      <img src={assetUrl(image.thumbnailAssetId ?? image.assetId)} alt={loc(image.alt)} loading="lazy" decoding="async" className="h-24 w-auto max-w-[60vw] object-contain sm:h-28" />
      <span className="absolute bottom-1 end-1 flex h-7 w-7 items-center justify-center rounded-full bg-background/80 text-foreground shadow" aria-hidden="true">
        <Maximize2 className="h-3.5 w-3.5" />
      </span>
    </button>
  );
}
