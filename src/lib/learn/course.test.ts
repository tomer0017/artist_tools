import { describe, expect, it } from 'vitest';
import { firstLesson, lessonNumbers, neighbours, started, unitNumbers, unitProgress, unitsOfLessons, upNext, type CourseEntry } from './course';

// The course's rules (ADR-0019, the owner's refinement 2; ADR-0020): the
// optional baseline drawing and drafts have no number and are skipped by
// Start, Continue, Next and the unit counts; nothing is a prerequisite;
// locked lessons keep their place.

const entry = (id: string, groupId: string, traits: Partial<CourseEntry> = {}): CourseEntry => ({ id, groupId, open: true, ...traits });

const course: CourseEntry[] = [
  entry('D-START-01', 'start', { optional: true }),
  entry('D-LINE-04', 'start'),
  entry('D-SHAPE-01', 'shapes'),
  entry('D-OBS-02', 'shapes', { open: false }),
  entry('D-COPY-01', 'measuring'),
];
const doneOf = (ids: string[]) => (id: string) => ids.includes(id);

describe('the course', () => {
  it('numbers lessons in order, the optional baseline without a number', () => {
    expect([...lessonNumbers(course)]).toEqual([
      ['D-LINE-04', 1],
      ['D-SHAPE-01', 2],
      ['D-OBS-02', 3],
      ['D-COPY-01', 4],
    ]);
  });

  it('starts at Lesson 1 (pencil control), not at the optional baseline', () => {
    expect(firstLesson(course)?.id).toBe('D-LINE-04');
    // A locked first lesson: the first one that opens.
    expect(firstLesson([entry('D-LINE-04', 'start', { open: false }), entry('D-SHAPE-01', 'shapes')])?.id).toBe('D-SHAPE-01');
    expect(firstLesson([entry('D-START-01', 'start', { optional: true })])).toBeNull();
  });

  it('"Up next" is the first open, numbered lesson not done; the baseline never counts as starting', () => {
    expect(started(course, doneOf(['D-START-01']))).toBe(false);
    expect(upNext(course, doneOf(['D-START-01']))?.id).toBe('D-LINE-04');
    expect(started(course, doneOf(['D-SHAPE-01']))).toBe(true);
    // Lessons done out of order: the first one not done.
    expect(upNext(course, doneOf(['D-SHAPE-01']))?.id).toBe('D-LINE-04');
    // A locked lesson is skipped, never offered.
    expect(upNext(course, doneOf(['D-LINE-04', 'D-SHAPE-01']))?.id).toBe('D-COPY-01');
    expect(upNext(course, doneOf(['D-LINE-04', 'D-SHAPE-01', 'D-COPY-01']))).toBeNull();
  });

  it('Next and Previous follow the numbered lessons, locked ones included; after the baseline comes Lesson 1', () => {
    expect(neighbours(course, 'D-SHAPE-01')).toEqual({ previous: course[1], next: course[3] });
    expect(neighbours(course, 'D-LINE-04').previous).toBeNull();
    expect(neighbours(course, 'D-COPY-01').next).toBeNull();
    expect(neighbours(course, 'D-START-01')).toEqual({ previous: null, next: course[1] });
    expect(neighbours(course, 'D-UNKNOWN-01')).toEqual({ previous: null, next: null });
  });

  it('numbers units in order and counts each unit’s numbered lessons done', () => {
    const groups = [{ id: 'start' }, { id: 'shapes' }, { id: 'empty' }, { id: 'measuring' }];
    expect([...unitNumbers(groups, course)]).toEqual([
      ['start', 1],
      ['shapes', 2],
      ['measuring', 3],
    ]);
    expect(Object.fromEntries(unitProgress(course, doneOf(['D-START-01', 'D-LINE-04', 'D-OBS-02'])))).toEqual({
      start: { done: 1, total: 1 },
      shapes: { done: 1, total: 2 },
      measuring: { done: 0, total: 1 },
    });
  });

  it('drafts, which only admins see, have no number and are skipped like the baseline, so an admin sees the numbers learners will (ADR-0020)', () => {
    const admin: CourseEntry[] = [
      entry('D-HAND-01', 'lines'),
      entry('D-LINE-01', 'lines'),
      entry('D-FLAT-01', 'flat'),
      entry('D-LINE-04', 'forms', { published: false }),
      entry('D-START-01', 'observe', { optional: true, published: false }),
      entry('D-SHAPE-01', 'observe', { published: false }),
    ];
    expect([...lessonNumbers(admin)]).toEqual([
      ['D-HAND-01', 1],
      ['D-LINE-01', 2],
      ['D-FLAT-01', 3],
    ]);
    // The last published lesson leads back to the course, not into the drafts.
    expect(neighbours(admin, 'D-FLAT-01')).toEqual({ previous: admin[1], next: null });
    // A draft opened by an admin: the numbered lessons around it.
    expect(neighbours(admin, 'D-LINE-04')).toEqual({ previous: admin[2], next: null });
    expect(firstLesson([entry('D-LINE-04', 'forms', { published: false }), ...admin])?.id).toBe('D-HAND-01');
    expect(upNext(admin, doneOf(['D-HAND-01', 'D-LINE-01', 'D-FLAT-01']))).toBeNull();
    expect(started(admin, doneOf(['D-SHAPE-01']))).toBe(false);
    // Units of drafts only have no number and no count.
    expect([...unitNumbers([{ id: 'lines' }, { id: 'flat' }, { id: 'forms' }, { id: 'observe' }], admin)]).toEqual([
      ['lines', 1],
      ['flat', 2],
    ]);
    expect(Object.fromEntries(unitProgress(admin, doneOf(['D-HAND-01'])))).toEqual({ lines: { done: 1, total: 2 }, flat: { done: 0, total: 1 } });
  });

  it('an optional lesson later in the course leads to the numbered lesson after it', () => {
    const later: CourseEntry[] = [entry('D-HAND-01', 'lines'), entry('D-START-01', 'observe', { optional: true }), entry('D-OBS-02', 'observe')];
    expect(neighbours(later, 'D-START-01')).toEqual({ previous: later[0], next: later[2] });
  });

  it('a challenge’s skills are the units of the lessons it builds on, as this list shows them', () => {
    expect(unitsOfLessons(['D-LINE-04', 'D-SHAPE-01', 'D-OBS-02'], course)).toEqual(['start', 'shapes']);
    expect(unitsOfLessons(['D-HIDDEN-01'], course)).toEqual([]);
    expect(unitsOfLessons(undefined, course)).toEqual([]);
  });
});
