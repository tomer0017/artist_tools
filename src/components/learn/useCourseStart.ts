import { useTranslations } from 'use-intl';
import { firstLesson, lessonNumbers, started, unitNumbers, upNext } from '@/lib/learn/course';
import { itemPath, learnPath } from '@/lib/learn/routes';
import { useLearnSummary } from '@/components/shell/account';
import { useCompletions, useLearnList, type ListEntry } from './data';
import { useLocalized } from './parts';

// The course's way in (ADR-0019), on the Learn home and on Home: "Start:
// Lesson 1 · …" before any numbered lesson is done, "Continue: Lesson 4 · …"
// after, and "Open the course" when every open lesson is done. The optional
// baseline drawing is offered beside Lesson 1 until the course has started.
// `history` is false in class mode: nothing about the person's history is
// asked for then, so the course simply starts at Lesson 1.

export interface CourseStart {
  href: string;
  label: string;
  /** "Unit 2 of 6 · Seeing shapes": where the next lesson sits. */
  where: string | null;
  /** The optional baseline drawing, offered before the course starts. */
  baseline: ListEntry | null;
  loading: boolean;
}

export function useCourseStart(history: boolean): CourseStart {
  const t = useTranslations('learn.home');
  const loc = useLocalized();
  const summary = useLearnSummary();
  const course = useLearnList('curriculum', summary.modules.curriculum !== null);
  const completions = useCompletions(history);
  const counts = history ? (completions.data?.summary.items ?? {}) : {};
  const done = (id: string) => (counts[id]?.count ?? 0) > 0;
  const entries = course.data?.items ?? [];
  const numbers = lessonNumbers(entries);
  const units = unitNumbers(course.data?.groups ?? [], entries);
  const begun = started(entries, done);
  const target = begun ? upNext(entries, done) : firstLesson(entries);
  const number = target ? numbers.get(target.id) : undefined;
  const group = target ? course.data?.groups.find((g) => g.id === target.groupId) : undefined;
  const unit = group ? units.get(group.id) : undefined;
  return {
    href: target ? itemPath(target.id) : learnPath({ screen: 'curriculum' }),
    label: target && number ? t(begun ? 'continueLesson' : 'startLesson', { number, title: loc(target.title) }) : t('openCourse'),
    where: group && unit ? t('where', { unit, units: units.size, title: loc(group.title) }) : null,
    baseline: begun ? null : (entries.find((entry) => entry.optional && entry.open && !done(entry.id)) ?? null),
    loading: course.isPending,
  };
}
