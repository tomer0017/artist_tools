'use client';

import { useState } from 'react';
import { Eye, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  ACCESS_MODES,
  ACTION_LABELS,
  ACTION_TYPES,
  ANIMATION_LABELS,
  AUDIENCES,
  AUDIENCE_LABELS,
  CATEGORY_LABELS,
  LEARN_PAGES,
  LIMITS,
  MOODS,
  SCREENS,
  SCREEN_LABELS,
  TIP_ANIMATIONS,
  TIP_CATEGORIES,
  TOOL_IDS,
  TRIGGERS,
  TRIGGER_LABELS,
  type ActionType,
  type CompanionTip,
} from '@/lib/companion/model';
import { ACCESS_LABELS } from '@/lib/learn/model';
import { TOOLS } from '@/components/shell/tools';
import { saveCompanionTip, type CompanionActionResult } from './actions';

// One tip, added or edited (ADR-0024): its words in English and Hebrew (both
// needed before anyone sees it), where and when it comes up, for whom, the
// move Sketchy makes, its one button (an action from the fixed list, never
// code or an address) and who may see it. Saved live at once.

export interface EditorTarget {
  /** null: a new tip (`tip` then holds the starting values). */
  id: string | null;
  tip: CompanionTip;
  hash?: string;
}

const input = 'w-full rounded-lg border border-border bg-background px-3 py-2 text-base text-foreground md:text-sm disabled:opacity-60';
const label = 'text-sm font-medium text-foreground';
const MOOD_LABELS = { light: 'Something light', create: 'Let me create', challenge: 'Challenge me!', surprise: 'Surprise me' } as const;
const PAGE_LABELS = { home: 'Learn home', curriculum: 'The drawing course', challenges: 'The challenges', history: 'My history' } as const;

const length = (text: string) => [...text].length;

export const blankTip = (): CompanionTip => ({
  id: 'T-000',
  order: 0,
  category: 'tools',
  text: { en: '', he: '' },
  screens: ['home'],
  audience: [],
  trigger: 'idle',
  animation: 'holdSign',
  action: { type: 'none', label: { en: '', he: '' } },
  access: 'admin',
  weight: 5,
});

function Checks<T extends string>({ legend, options, labels, value, onChange, name }: { legend: string; options: readonly T[]; labels: Record<T, string>; value: T[]; onChange: (v: T[]) => void; name: string }) {
  return (
    <fieldset>
      <legend className={label}>{legend}</legend>
      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
        {options.map((o) => (
          <label key={o} className="flex min-h-[36px] items-center gap-2 text-sm text-foreground">
            <input type="checkbox" name={name} checked={value.includes(o)} onChange={(e) => onChange(e.target.checked ? [...value, o] : value.filter((x) => x !== o))} className="h-4 w-4 accent-[hsl(var(--primary))]" />
            {labels[o]}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Bilingual({ id, legend, value, onChange, max, multiline = false, hint }: { id: string; legend: string; value: { en: string; he: string }; onChange: (v: { en: string; he: string }) => void; max: number; multiline?: boolean; hint?: string }) {
  const Field = multiline ? 'textarea' : 'input';
  return (
    <fieldset>
      <legend className={label}>{legend}</legend>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      <div className="mt-1.5 grid gap-2 md:grid-cols-2">
        {(['en', 'he'] as const).map((lang) => (
          <div key={lang}>
            <label htmlFor={`${id}-${lang}`} className="text-xs text-muted-foreground">
              {lang === 'en' ? 'English' : 'Hebrew'} · {length(value[lang])}/{max}
            </label>
            <Field
              id={`${id}-${lang}`}
              dir={lang === 'he' ? 'rtl' : 'ltr'}
              lang={lang}
              value={value[lang]}
              maxLength={max}
              rows={multiline ? 3 : undefined}
              onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange({ ...value, [lang]: e.target.value })}
              className={input}
              data-field={`${id}-${lang}`}
            />
          </div>
        ))}
      </div>
    </fieldset>
  );
}

export function TipEditor({ target, onClose, onSaved, onPreview }: { target: EditorTarget; onClose: () => void; onSaved: (result: CompanionActionResult) => void; onPreview: (tip: CompanionTip) => void }) {
  const start = target.tip;
  const [tip, setTip] = useState<CompanionTip>(() => structuredClone(start));
  const [title, setTitle] = useState(start.title ?? { en: '', he: '' });
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<{ message: string; issues: string[] } | null>(null);
  const set = <K extends keyof CompanionTip>(key: K, value: CompanionTip[K]) => setTip((t) => ({ ...t, [key]: value }));
  const setAction = (change: Partial<CompanionTip['action']>) => setTip((t) => ({ ...t, action: { ...t.action, ...change } }));
  const type = tip.action.type;

  const fields = () => ({
    category: tip.category,
    ...(title.en.trim() || title.he.trim() ? { title } : {}),
    text: tip.text,
    screens: tip.screens,
    ...(tip.afterTools?.length ? { afterTools: tip.afterTools } : {}),
    audience: tip.audience,
    trigger: tip.trigger,
    animation: tip.animation,
    action: {
      type,
      label: type === 'none' ? { en: '', he: '' } : tip.action.label,
      ...(type === 'openTool' ? { tool: tip.action.tool ?? 'value' } : {}),
      ...((type === 'roulette' || type === 'classRoulette') && tip.action.mood ? { mood: tip.action.mood } : {}),
      ...(type === 'openLearn' ? { page: tip.action.page ?? 'home' } : {}),
      ...(type === 'openItem' ? { itemId: (tip.action.itemId ?? '').trim() } : {}),
    },
    access: tip.access,
    weight: tip.weight,
  });

  async function save() {
    setSaving(true);
    setProblem(null);
    try {
      const result = await saveCompanionTip({ id: target.id, baseHash: target.hash, fields: fields() });
      if (result.ok) onSaved(result);
      else setProblem({ message: result.message, issues: result.issues ?? [] });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="max-h-[92dvh] max-w-3xl overflow-y-auto" data-tip-editor={target.id ?? 'new'}>
        <DialogHeader>
          <DialogTitle>{target.id ? `Edit tip ${target.id}` : 'Add a tip'}</DialogTitle>
          <DialogDescription>Live in the studio as soon as you save. Admin only lets you check it in the studio before anyone else sees it.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Bilingual id="tip-text" legend="What Sketchy says" value={tip.text} onChange={(v) => set('text', v)} max={LIMITS.text} multiline />
          <Bilingual id="tip-title" legend="A short heading (optional)" value={title} onChange={setTitle} max={LIMITS.title} hint="Both languages, or neither." />
          <div className="grid gap-3 md:grid-cols-3">
            <label className="block">
              <span className={label}>Category</span>
              <select value={tip.category} onChange={(e) => set('category', e.target.value as CompanionTip['category'])} className={`${input} mt-1.5`} data-field="category">
                {TIP_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className={label}>When it comes up</span>
              <select value={tip.trigger} onChange={(e) => set('trigger', e.target.value as CompanionTip['trigger'])} className={`${input} mt-1.5`} data-field="trigger">
                {TRIGGERS.map((t) => (
                  <option key={t} value={t}>
                    {TRIGGER_LABELS[t]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className={label}>His move</span>
              <select value={tip.animation} onChange={(e) => set('animation', e.target.value as CompanionTip['animation'])} className={`${input} mt-1.5`} data-field="animation">
                {TIP_ANIMATIONS.map((a) => (
                  <option key={a} value={a}>
                    {ANIMATION_LABELS[a]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <Checks legend="Screens" name="screens" options={SCREENS} labels={SCREEN_LABELS} value={tip.screens} onChange={(v) => set('screens', v)} />
          <Checks legend="For (none ticked: everyone)" name="audience" options={AUDIENCES} labels={AUDIENCE_LABELS} value={tip.audience} onChange={(v) => set('audience', v)} />
          <Checks
            legend="Only right after using (none ticked: any time)"
            name="afterTools"
            options={TOOL_IDS}
            labels={Object.fromEntries(TOOL_IDS.map((t) => [t, TOOLS[t].title])) as Record<(typeof TOOL_IDS)[number], string>}
            value={tip.afterTools ?? []}
            onChange={(v) => set('afterTools', v)}
          />
          <fieldset className="rounded-xl border border-border p-3">
            <legend className={`${label} px-1`}>The button</legend>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="block">
                <span className={label}>What it does</span>
                <select value={type} onChange={(e) => setAction({ type: e.target.value as ActionType })} className={`${input} mt-1.5`} data-field="action">
                  {ACTION_TYPES.map((a) => (
                    <option key={a} value={a}>
                      {ACTION_LABELS[a]}
                    </option>
                  ))}
                </select>
              </label>
              {type === 'openTool' && (
                <label className="block">
                  <span className={label}>Tool</span>
                  <select value={tip.action.tool ?? 'value'} onChange={(e) => setAction({ tool: e.target.value as (typeof TOOL_IDS)[number] })} className={`${input} mt-1.5`} data-field="tool">
                    {TOOL_IDS.map((t) => (
                      <option key={t} value={t}>
                        {TOOLS[t].title}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {(type === 'roulette' || type === 'classRoulette') && (
                <label className="block">
                  <span className={label}>Start the roulette on</span>
                  <select value={tip.action.mood ?? 'surprise'} onChange={(e) => setAction({ mood: e.target.value as (typeof MOODS)[number] })} className={`${input} mt-1.5`} data-field="mood">
                    {MOODS.map((m) => (
                      <option key={m} value={m}>
                        {MOOD_LABELS[m]}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {type === 'openLearn' && (
                <label className="block">
                  <span className={label}>Learn page</span>
                  <select value={tip.action.page ?? 'home'} onChange={(e) => setAction({ page: e.target.value as (typeof LEARN_PAGES)[number] })} className={`${input} mt-1.5`} data-field="page">
                    {LEARN_PAGES.map((p) => (
                      <option key={p} value={p}>
                        {PAGE_LABELS[p]}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {type === 'openItem' && (
                <label className="block">
                  <span className={label}>Lesson or challenge ID</span>
                  <input value={tip.action.itemId ?? ''} onChange={(e) => setAction({ itemId: e.target.value })} placeholder="D-LINE-01 or CH-017" className={`${input} mt-1.5`} dir="ltr" data-field="itemId" />
                </label>
              )}
            </div>
            {type !== 'none' && (
              <div className="mt-3">
                <Bilingual id="tip-label" legend="The button's words" value={tip.action.label} onChange={(v) => setAction({ label: v })} max={LIMITS.label} />
              </div>
            )}
          </fieldset>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="block">
              <span className={label}>Who sees it</span>
              <select value={tip.access} onChange={(e) => set('access', e.target.value as CompanionTip['access'])} className={`${input} mt-1.5`} data-field="access">
                {ACCESS_MODES.map((m) => (
                  <option key={m} value={m}>
                    {ACCESS_LABELS[m]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className={label}>How often, compared with others (1–10)</span>
              <input type="number" min={LIMITS.weight.min} max={LIMITS.weight.max} value={tip.weight} onChange={(e) => set('weight', Math.max(1, Math.min(10, Number(e.target.value) || 1)))} className={`${input} mt-1.5`} data-field="weight" />
            </label>
          </div>
          {problem && (
            <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm text-foreground">
              <p className="font-semibold">{problem.message}</p>
              {problem.issues.length > 1 && (
                <ul className="mt-1 list-disc ps-5">
                  {problem.issues.slice(0, 8).map((i) => (
                    <li key={i}>{i}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
            <button type="button" onClick={() => void save()} disabled={saving} className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60" data-tip-save>
              {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {target.id ? 'Save · live now' : 'Add · live now'}
            </button>
            <button type="button" onClick={() => onPreview({ ...tip, ...(title.en || title.he ? { title } : {}) })} className="inline-flex h-10 items-center gap-2 rounded-lg border border-border px-4 text-sm font-semibold text-foreground hover:bg-secondary" data-tip-preview>
              <Eye className="h-4 w-4" aria-hidden="true" /> Preview
            </button>
            <button type="button" onClick={onClose} disabled={saving} className="ms-auto inline-flex h-10 items-center rounded-lg px-3 text-sm font-medium text-muted-foreground hover:text-foreground">
              Cancel
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
