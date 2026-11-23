import type { FeatureRow } from './plans';

// ─── What Pro adds, in the order the upgrade surfaces list it ─────────────────
// Tools first (what people come for), then Learn (how many more lessons and
// challenges open), then exports. Built from the plan rows that only Pro has
// and the server's count of Learn items Pro opens for this account, so it stays
// true whatever the owner publishes. A Learn row that Pro alone has is shown as
// its count when the count is known ("29 more lessons"), never both.

export type LearnCount = 'curriculum' | 'challenges';

export type ProPerk = { key: string; kind: 'row'; row: FeatureRow } | { key: string; kind: 'count'; collection: LearnCount; count: number };

const COUNTED_ROWS: Partial<Record<string, LearnCount>> = { learnCurriculum: 'curriculum', learnChallenges: 'challenges' };
const COUNTS: readonly LearnCount[] = ['curriculum', 'challenges'];

export function proPerks(rows: readonly FeatureRow[], extra: Partial<Record<LearnCount, number>> | null | undefined): ProPerk[] {
  const tools: ProPerk[] = [];
  const learn: ProPerk[] = [];
  const exports: ProPerk[] = [];
  const counted = new Set<LearnCount>();
  const count = (collection: LearnCount): ProPerk => {
    counted.add(collection);
    return { key: `count-${collection}`, kind: 'count', collection, count: extra?.[collection] ?? 0 };
  };
  for (const row of rows) {
    const perk: ProPerk = { key: `${row.kind}-${row.id}`, kind: 'row', row };
    if (row.kind === 'tool' || row.id === 'tools') tools.push(perk);
    else if (row.id.startsWith('learn')) {
      const collection = COUNTED_ROWS[row.id];
      learn.push(collection && (extra?.[collection] ?? 0) > 0 ? count(collection) : perk);
    } else exports.push(perk);
  }
  for (const collection of COUNTS) if ((extra?.[collection] ?? 0) > 0 && !counted.has(collection)) learn.push(count(collection));
  return [...tools, ...learn, ...exports];
}
