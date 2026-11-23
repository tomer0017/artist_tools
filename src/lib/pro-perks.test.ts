import { describe, expect, it } from 'vitest';
import type { FeatureRow } from './plans';
import { proPerks } from './pro-perks';

const tool = (id: 'measure' | 'compare'): FeatureRow => ({ kind: 'tool', id, features: [`tool.${id}` as FeatureRow['features'][number]] });
const group = (id: string): FeatureRow => ({ kind: 'group', id: id as Extract<FeatureRow, { kind: 'group' }>['id'], features: [] });

describe('what Pro adds, as the upgrade surfaces list it', () => {
  it('lists tools first, then Learn, then exports', () => {
    const perks = proPerks([group('large'), tool('measure'), group('difference'), tool('compare')], { curriculum: 20 });
    expect(perks.map((p) => p.key)).toEqual(['tool-measure', 'tool-compare', 'count-curriculum', 'group-large', 'group-difference']);
  });

  it('names a Learn module that only Pro has by its count, never both', () => {
    const perks = proPerks([group('learnCurriculum'), group('learnChallenges')], { curriculum: 29, challenges: 0 });
    expect(perks).toEqual([
      { key: 'count-curriculum', kind: 'count', collection: 'curriculum', count: 29 },
      { key: 'group-learnChallenges', kind: 'row', row: group('learnChallenges') },
    ]);
  });

  it('adds the counts Pro opens inside modules both plans have, and nothing when there are none', () => {
    expect(proPerks([], { curriculum: 2, challenges: 5 }).map((p) => p.key)).toEqual(['count-curriculum', 'count-challenges']);
    expect(proPerks([], { curriculum: 0 })).toEqual([]);
    expect(proPerks([], null)).toEqual([]);
  });
});
