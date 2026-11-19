'use client';

import { useState } from 'react';
import { PLAN_IDS, PLAN_NAMES, type FeatureId, type PlanId } from '@/lib/plans';
import { learnAccess } from '@/lib/learn/access';
import {
  COLLECTION_LABELS,
  LEARN_COLLECTIONS,
  LEARN_MODULE,
  firstN,
  groupItems,
  orderedItems,
  selectionDrift,
  type ContentOutline,
  type LearnCollection,
  type LearnRule,
  type LearnSection,
} from '@/lib/learn/model';

// The catalog's Learn access (ADR-0017), per collection and plan: All, None
// or Selected, and what locked items show in lists. A Selected list is made
// with First N, a whole group, or by picking, and is frozen as it is: the
// server opens exactly the listed items, so reordering or adding content
// never changes anyone's access. When the order or a group changed since a
// list was made, this says so and offers the new list, which takes a new
// publication like any change.

interface Props {
  section: LearnSection;
  outline: ContentOutline;
  contentVersion: number | null;
  /** Each plan's features in the form (a collection opens nothing without its module). */
  features: Record<PlanId, FeatureId[]>;
  disabled: FeatureId[];
  editable: boolean;
  onChange: (section: LearnSection) => void;
}

const inputClass = 'h-9 rounded-lg border border-border bg-background px-2 text-base text-foreground md:text-sm';

function RuleEditor({
  planId,
  collection,
  rule,
  outline,
  contentVersion,
  editable,
  onChange,
}: {
  planId: PlanId;
  collection: LearnCollection;
  rule: LearnRule;
  outline: ContentOutline;
  contentVersion: number | null;
  editable: boolean;
  onChange: (rule: LearnRule) => void;
}) {
  const items = orderedItems(outline, collection);
  const groups = outline.groups.filter((g) => g.collection === collection).sort((a, b) => a.order - b.order);
  const [n, setN] = useState(rule.mode === 'selected' && rule.made?.by === 'first' ? rule.made.n : 1);
  const [groupId, setGroupId] = useState(groups[0]?.id ?? '');
  const label = `${PLAN_NAMES[planId]} · ${COLLECTION_LABELS[collection]}`;
  const selected = rule.mode === 'selected' ? rule.items : [];
  const drift = selectionDrift(outline, collection, rule);
  const byId = new Map(items.map((item) => [item.id, item]));

  return (
    <div role="group" aria-label={label} className="rounded-xl border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-14 text-sm font-medium text-foreground">{PLAN_NAMES[planId]}</span>
        <select
          aria-label={`${label}: rule`}
          disabled={!editable}
          value={rule.mode}
          onChange={(e) => {
            const mode = e.target.value as LearnRule['mode'];
            onChange(mode === 'selected' ? { mode, items: selected, made: { by: 'pick' } } : { mode });
          }}
          className={inputClass}
        >
          <option value="none">None</option>
          <option value="all">All, including items published later</option>
          <option value="selected">Selected items only</option>
        </select>
      </div>
      {rule.mode === 'selected' && (
        <div className="mt-3 space-y-3 text-sm">
          <p className="text-foreground">
            Opens{' '}
            {selected.length === 0
              ? 'no items yet'
              : selected.map((id) => `${id}${byId.get(id)?.published === false ? ' (unpublished: hidden from everyone)' : ''}`).join(', ')}
            {rule.made?.by === 'first' && <span className="text-muted-foreground"> — First {rule.made.n}{rule.made.contentVersion ? `, content version ${rule.made.contentVersion}` : ''}</span>}
            {rule.made?.by === 'group' && <span className="text-muted-foreground"> — the group {rule.made.groupId}{rule.made.contentVersion ? `, content version ${rule.made.contentVersion}` : ''}</span>}
          </p>
          {drift && (
            <div role="status" className="rounded-lg border border-primary/40 bg-primary/5 p-2 text-foreground">
              The content changed since this list was made: it would now be {drift.length ? drift.join(', ') : 'empty'}. The list stays exactly as it is until you
              apply the new one and publish.
              {editable && (
                <button
                  type="button"
                  className="ml-2 h-8 rounded-lg border border-border px-3 text-xs hover:bg-secondary"
                  onClick={() => rule.made && rule.made.by !== 'pick' && onChange({ mode: 'selected', items: drift, made: { ...rule.made, contentVersion } })}
                >
                  Apply the new list
                </button>
              )}
            </div>
          )}
          {editable && (
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1.5 text-muted-foreground">
                First
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={n}
                  aria-label={`${label}: how many of the first items`}
                  onChange={(e) => setN(Math.max(1, Math.floor(Number(e.target.value)) || 1))}
                  className={`${inputClass} w-20`}
                />
              </label>
              <button type="button" className="h-9 rounded-lg border border-border px-3 hover:bg-secondary" onClick={() => onChange({ mode: 'selected', items: firstN(outline, collection, n), made: { by: 'first', n, contentVersion } })}>
                Use the first {n}
              </button>
              {groups.length > 0 && (
                <>
                  <select aria-label={`${label}: group`} value={groupId} onChange={(e) => setGroupId(e.target.value)} className={inputClass}>
                    {groups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.title.en}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="h-9 rounded-lg border border-border px-3 hover:bg-secondary"
                    onClick={() => groupId && onChange({ mode: 'selected', items: groupItems(outline, collection, groupId), made: { by: 'group', groupId, contentVersion } })}
                  >
                    Use this group
                  </button>
                </>
              )}
            </div>
          )}
          {n > items.filter((i) => i.published).length && editable && (
            <p className="text-xs text-muted-foreground">First {n} is more than the {items.filter((i) => i.published).length} published items: it gives every current item, but never items published later (All does that).</p>
          )}
          <fieldset disabled={!editable}>
            <legend className="sr-only">{label}: pick items</legend>
            <ul className="grid gap-1 sm:grid-cols-2">
              {items.map((item) => {
                const on = selected.includes(item.id);
                const allowed = item.published || on;
                return (
                  <li key={item.id}>
                    <label className={`flex items-start gap-2 ${allowed ? '' : 'opacity-50'}`}>
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={!allowed}
                        onChange={(e) => {
                          const next = new Set(selected);
                          if (e.target.checked) next.add(item.id);
                          else next.delete(item.id);
                          onChange({ mode: 'selected', items: items.filter((i) => next.has(i.id)).map((i) => i.id), made: { by: 'pick' } });
                        }}
                        className="mt-0.5 h-4 w-4"
                      />
                      <span>
                        <span className="font-mono text-xs">{item.id}</span> {item.title.en}
                        <span className="text-muted-foreground">
                          {' '}
                          · {item.groupId}
                          {item.kind === 'challenge' ? ` · ${item.level}` : ''}
                          {item.published ? '' : ' · unpublished'}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </fieldset>
        </div>
      )}
    </div>
  );
}

export function LearnAccessEditor({ section, outline, contentVersion, features, disabled, editable, onChange }: Props) {
  const setRule = (planId: PlanId, collection: LearnCollection, rule: LearnRule) =>
    onChange({ ...section, access: { ...section.access, [planId]: { ...section.access[planId], [collection]: rule } } });
  const opens = Object.fromEntries(
    PLAN_IDS.map((planId) => {
      const modules = features[planId].filter((f) => !disabled.includes(f));
      const view = learnAccess({ active: true, admin: false, modules, offered: [], access: { rules: section.access[planId], previews: section.previews } }, outline);
      return [planId, LEARN_COLLECTIONS.flatMap((c) => view.opens(c))];
    }),
  ) as Record<PlanId, string[]>;

  return (
    <section id="learn-access" aria-labelledby="learn-access-title" className="mt-6 rounded-2xl border border-border bg-card p-4">
      <h2 id="learn-access-title" className="text-base font-semibold text-foreground">
        Learn access
      </h2>
      <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
        Which published items each plan opens, per collection. A plan also needs the collection&apos;s module above (Drawing curriculum, Color module,
        Challenges): without it every item of the collection stays locked. A Selected list is frozen as it is when you publish: reordering or adding
        content never changes anyone&apos;s access. Admins always open everything.
        {contentVersion === null && ' No Learn content is published yet, so only All and None mean anything for now.'}
      </p>
      <div className="mt-4 space-y-5">
        {LEARN_COLLECTIONS.map((collection) => (
          <fieldset key={collection} className="space-y-2">
            <legend className="text-sm font-semibold text-foreground">{COLLECTION_LABELS[collection]}</legend>
            {PLAN_IDS.map((planId) => (
              <RuleEditor
                key={`${planId}-${collection}`}
                planId={planId}
                collection={collection}
                rule={section.access[planId][collection]}
                outline={outline}
                contentVersion={contentVersion}
                editable={editable}
                onChange={(rule) => setRule(planId, collection, rule)}
              />
            ))}
            {PLAN_IDS.filter((p) => !features[p].includes(LEARN_MODULE[collection]) || disabled.includes(LEARN_MODULE[collection])).length > 0 && (
              <p className="text-xs text-muted-foreground">
                Without the {COLLECTION_LABELS[collection]} module:{' '}
                {PLAN_IDS.filter((p) => !features[p].includes(LEARN_MODULE[collection]) || disabled.includes(LEARN_MODULE[collection])).map((p) => PLAN_NAMES[p]).join(', ')}{' '}
                (every item locked whatever the rule).
              </p>
            )}
          </fieldset>
        ))}
        <fieldset disabled={!editable}>
          <legend className="text-sm font-semibold text-foreground">What locked items show in lists</legend>
          <div className="mt-2 flex flex-wrap gap-4 text-sm text-foreground">
            {(['title', 'thumbnail'] as const).map((value) => (
              <label key={value} className="flex items-center gap-2">
                <input type="radio" name="learn-previews" value={value} checked={section.previews === value} onChange={() => onChange({ ...section, previews: value })} className="h-4 w-4" />
                {value === 'title' ? 'The title only' : 'The title and a small thumbnail'}
              </label>
            ))}
          </div>
        </fieldset>
        <div role="group" aria-label="Effective access" className="rounded-xl border border-border bg-background p-3 text-sm">
          <p className="font-semibold text-foreground">Effective access with these settings</p>
          <ul className="mt-1 space-y-0.5 text-foreground">
            {PLAN_IDS.map((planId) => (
              <li key={planId}>
                {PLAN_NAMES[planId]} will open: {opens[planId].length > 0 ? opens[planId].join(', ') : 'nothing'}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
