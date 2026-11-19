// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { defaultLearnSection, NO_LEARN_ACCESS } from '@/lib/learn/model';
import { LearnSectionSchema, learnAccessOf, mergeLearnSection, readLearnSection } from './learn-access';

// The catalog's Learn section read like the rest of the catalog (ADR-0014,
// ADR-0017): what this release does not know is kept and never applied; a
// rule it cannot apply in full is None; a catalog without the section opens
// nothing.

describe('reading the Learn section', () => {
  it('a catalog without it (every catalog before M4) opens nothing and shows titles only', () => {
    expect(readLearnSection(undefined)).toEqual({ section: defaultLearnSection(), present: false, withheld: [], unknown: [] });
  });

  it('reads every rule it knows', () => {
    const read = readLearnSection({
      access: {
        free: { curriculum: { mode: 'selected', items: ['D-START-01', 'D-START-01', 'D-SHAPE-01'], made: { by: 'first', n: 2, contentVersion: 3 } }, color: { mode: 'none' }, challenges: { mode: 'selected', items: ['CH-017'] } },
        pro: { curriculum: { mode: 'all' }, color: { mode: 'all' }, challenges: { mode: 'all' } },
      },
      previews: 'thumbnail',
    });
    expect(read.withheld).toEqual([]);
    expect(read.section.access.free.curriculum).toEqual({ mode: 'selected', items: ['D-START-01', 'D-SHAPE-01'], made: { by: 'first', n: 2, contentVersion: 3 } });
    expect(read.section.access.pro.color).toEqual({ mode: 'all' });
    expect(read.section.previews).toBe('thumbnail');
  });

  it('keeps what it does not know without applying it, and withholds rules it cannot apply in full (None)', () => {
    const read = readLearnSection({
      access: {
        free: { curriculum: { mode: 'all', until: '2027-01-01' }, color: { mode: 'random' }, challenges: { mode: 'selected', items: ['D-START-01'] }, sculpture: { mode: 'all' } },
        pro: { curriculum: { mode: 'selected', items: 'all' }, color: { mode: 'all' }, challenges: { mode: 'all' } },
        team: { curriculum: { mode: 'all' } },
      },
      previews: 'big',
      schedule: { weekly: true },
    });
    expect(read.unknown).toEqual(['learn.access.free.sculpture', 'learn.access.team', 'learn.schedule']);
    expect(read.section.access.free).toEqual({ curriculum: { mode: 'none' }, color: { mode: 'none' }, challenges: { mode: 'none' } });
    expect(read.section.access.pro).toEqual({ curriculum: { mode: 'none' }, color: { mode: 'all' }, challenges: { mode: 'all' } });
    expect(read.section.previews).toBe('title');
    expect(read.withheld.map((w) => `${w.plan}/${w.collection}`)).toEqual(['free/curriculum', 'free/color', 'free/challenges', 'pro/curriculum', 'null/null']);
  });

  it('a section that is not a section at all opens nothing, and says so', () => {
    for (const broken of ['everything', [], { access: 'all' }, { access: { free: 'all' } }]) {
      const read = readLearnSection(broken);
      expect(read.section).toEqual(defaultLearnSection());
      expect(read.withheld.length).toBeGreaterThan(0);
    }
  });
});

describe('the editor', () => {
  it('validates the section strictly: rules it knows, IDs of the right collection, each once', () => {
    const ok = { access: { free: { curriculum: { mode: 'selected', items: ['D-START-01'], made: { by: 'pick' } }, color: { mode: 'none' }, challenges: { mode: 'all' } }, pro: defaultLearnSection().access.pro }, previews: 'title' };
    expect(LearnSectionSchema.safeParse(ok).success).toBe(true);
    const wrongCollection = structuredClone(ok);
    wrongCollection.access.free.curriculum.items = ['CH-017'];
    expect(LearnSectionSchema.safeParse(wrongCollection).success).toBe(false);
    const twice = structuredClone(ok);
    twice.access.free.curriculum.items = ['D-START-01', 'D-START-01'];
    expect(LearnSectionSchema.safeParse(twice).success).toBe(false);
    expect(LearnSectionSchema.safeParse({ ...ok, extra: 1 }).success).toBe(false);
    const firstZero = structuredClone(ok) as unknown as { access: { free: { curriculum: { made: unknown } } } };
    firstZero.access.free.curriculum.made = { by: 'first', n: 0, contentVersion: 1 };
    expect(LearnSectionSchema.safeParse(firstZero).success).toBe(false);
  });

  it('merging keeps what this release does not know, and leaves a catalog without the section without one while it says nothing', () => {
    const section = defaultLearnSection();
    expect(mergeLearnSection(undefined, section)).toBeUndefined();
    expect(mergeLearnSection(undefined, undefined)).toBeUndefined();
    const stored = { access: { free: { curriculum: { mode: 'all' }, sculpture: { mode: 'all' } }, team: {} }, previews: 'title', schedule: 1 };
    const edited = defaultLearnSection();
    edited.access.free.challenges = { mode: 'selected', items: ['CH-017'] };
    expect(mergeLearnSection(stored, edited)).toEqual({
      access: { free: { ...edited.access.free, sculpture: { mode: 'all' } }, pro: edited.access.pro, team: {} },
      previews: 'title',
      schedule: 1,
    });
    const opened = defaultLearnSection();
    opened.previews = 'thumbnail';
    expect(mergeLearnSection(undefined, opened)).toEqual(opened);
  });
});

describe('a plan document’s Learn access', () => {
  it('missing (every plan before M4) or malformed opens nothing; reported once', () => {
    const report = vi.fn();
    expect(learnAccessOf(undefined, 'free', report)).toEqual(NO_LEARN_ACCESS());
    expect(learnAccessOf('all', 'free', report)).toEqual(NO_LEARN_ACCESS());
    expect(learnAccessOf({ rules: { curriculum: { mode: 'all' }, color: { mode: 'magic' } }, previews: 'thumbnail' }, 'pro', report)).toEqual({
      rules: { curriculum: { mode: 'all' }, color: { mode: 'none' }, challenges: { mode: 'none' } },
      previews: 'thumbnail',
    });
    expect(report).toHaveBeenCalledTimes(2);
  });
});
