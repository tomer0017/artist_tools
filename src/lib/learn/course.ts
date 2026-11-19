// ─── The drawing course: numbers, "Up next", units (ADR-0019) ────────────────
// Pure, so the rules are tested once. A course is a list as the server sends
// it: in order, and only what this account may see. Optional lessons (the
// baseline drawing) have no number, and "Start", "Continue", "Next lesson"
// and the unit counts skip them. Every lesson still opens, in any order:
// nothing here is a prerequisite.

export interface CourseEntry {
  id: string;
  groupId: string;
  open: boolean;
  optional?: boolean;
}

/** Each numbered lesson's number (1, 2, …) in course order; optional lessons have none. */
export function lessonNumbers(entries: readonly CourseEntry[]): Map<string, number> {
  const numbers = new Map<string, number>();
  let next = 1;
  for (const entry of entries) if (!entry.optional) numbers.set(entry.id, next++);
  return numbers;
}

/** The first open, numbered lesson: "Start: Lesson 1". */
export function firstLesson<E extends CourseEntry>(entries: readonly E[]): E | null {
  return entries.find((entry) => !entry.optional && entry.open) ?? null;
}

/** "Up next": the first open, numbered lesson not done yet, or null when every one is done (or none is open). */
export function upNext<E extends CourseEntry>(entries: readonly E[], done: (id: string) => boolean): E | null {
  return entries.find((entry) => !entry.optional && entry.open && !done(entry.id)) ?? null;
}

/** Whether the person has done any numbered lesson (the course has started). */
export const started = (entries: readonly CourseEntry[], done: (id: string) => boolean): boolean => entries.some((entry) => !entry.optional && done(entry.id));

/**
 * The numbered lessons before and after one, open or locked (a locked one
 * shows its locked page). After an optional lesson comes Lesson 1.
 */
export function neighbours<E extends CourseEntry>(entries: readonly E[], id: string): { previous: E | null; next: E | null } {
  const numbered = entries.filter((entry) => !entry.optional);
  const at = numbered.findIndex((entry) => entry.id === id);
  if (at < 0) return { previous: null, next: entries.some((entry) => entry.id === id) ? (numbered[0] ?? null) : null };
  return { previous: numbered[at - 1] ?? null, next: numbered[at + 1] ?? null };
}

/** The course's units in order, numbered 1, 2, …: the groups that have entries in this list. */
export function unitNumbers(groups: readonly { id: string }[], entries: readonly CourseEntry[]): Map<string, number> {
  const numbers = new Map<string, number>();
  let next = 1;
  for (const group of groups) if (entries.some((entry) => entry.groupId === group.id)) numbers.set(group.id, next++);
  return numbers;
}

/** Per unit: its numbered lessons, and how many of them are done ("1 of 2 done"). */
export function unitProgress(entries: readonly CourseEntry[], done: (id: string) => boolean): Map<string, { done: number; total: number }> {
  const progress = new Map<string, { done: number; total: number }>();
  for (const entry of entries) {
    if (entry.optional) continue;
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
