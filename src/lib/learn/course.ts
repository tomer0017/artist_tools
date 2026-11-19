// ─── The drawing course: numbers, "Up next", units (ADR-0019, ADR-0020) ──────
// Pure, so the rules are tested once. A course is a list as the server sends
// it: in order, and only what this account may see. Optional lessons (the
// baseline drawing) have no number, and "Start", "Continue", "Next lesson"
// and the unit counts skip them. So do drafts, which only admins see: an
// admin's course has the numbers learners will see. Every lesson still opens,
// in any order: nothing here is a prerequisite.

export interface CourseEntry {
  id: string;
  groupId: string;
  open: boolean;
  optional?: boolean;
  /** Sent to admins only: false for a draft. */
  published?: boolean;
}

/** A lesson of the course proper: neither the optional baseline nor a draft. */
const counted = (entry: CourseEntry): boolean => !entry.optional && entry.published !== false;

/** Each numbered lesson's number (1, 2, …) in course order; optional lessons and drafts have none. */
export function lessonNumbers(entries: readonly CourseEntry[]): Map<string, number> {
  const numbers = new Map<string, number>();
  let next = 1;
  for (const entry of entries) if (counted(entry)) numbers.set(entry.id, next++);
  return numbers;
}

/** The first open, numbered lesson: "Start: Lesson 1". */
export function firstLesson<E extends CourseEntry>(entries: readonly E[]): E | null {
  return entries.find((entry) => counted(entry) && entry.open) ?? null;
}

/** "Up next": the first open, numbered lesson not done yet, or null when every one is done (or none is open). */
export function upNext<E extends CourseEntry>(entries: readonly E[], done: (id: string) => boolean): E | null {
  return entries.find((entry) => counted(entry) && entry.open && !done(entry.id)) ?? null;
}

/** Whether the person has done any numbered lesson (the course has started). */
export const started = (entries: readonly CourseEntry[], done: (id: string) => boolean): boolean => entries.some((entry) => counted(entry) && done(entry.id));

/**
 * The numbered lessons just before and after one in course order, open or
 * locked (a locked one shows its locked page). An unnumbered one (the
 * baseline, a draft) has the numbered lessons around it: after a baseline
 * at the start comes Lesson 1.
 */
export function neighbours<E extends CourseEntry>(entries: readonly E[], id: string): { previous: E | null; next: E | null } {
  const at = entries.findIndex((entry) => entry.id === id);
  if (at < 0) return { previous: null, next: null };
  const previous = entries.slice(0, at).filter(counted).at(-1) ?? null;
  const next = entries.slice(at + 1).find(counted) ?? null;
  return { previous, next };
}

/** The course's units in order, numbered 1, 2, …: the groups with a published entry in this list (a unit of drafts only has no number). */
export function unitNumbers(groups: readonly { id: string }[], entries: readonly CourseEntry[]): Map<string, number> {
  const numbers = new Map<string, number>();
  let next = 1;
  for (const group of groups) if (entries.some((entry) => entry.groupId === group.id && entry.published !== false)) numbers.set(group.id, next++);
  return numbers;
}

/** Per unit: its numbered lessons, and how many of them are done ("1 of 2 done"). */
export function unitProgress(entries: readonly CourseEntry[], done: (id: string) => boolean): Map<string, { done: number; total: number }> {
  const progress = new Map<string, { done: number; total: number }>();
  for (const entry of entries) {
    if (!counted(entry)) continue;
    const unit = progress.get(entry.groupId) ?? { done: 0, total: 0 };
    unit.total += 1;
    if (done(entry.id)) unit.done += 1;
    progress.set(entry.groupId, unit);
  }
  return progress;
}

/** The units a challenge builds on (its skill), through the lessons it names; lessons this list does not show count for nothing. */
export function unitsOfLessons(lessons: readonly string[] | undefined, entries: readonly CourseEntry[]): string[] {
  const units = new Set<string>();
  for (const id of lessons ?? []) {
    const entry = entries.find((e) => e.id === id);
    if (entry) units.add(entry.groupId);
  }
  return [...units];
}
