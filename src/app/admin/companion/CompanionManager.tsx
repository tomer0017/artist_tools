'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Archive, ArrowDown, ArrowUp, Copy, Eye, Loader2, Pencil, Plus, RotateCcw, Search } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Toaster } from '@/components/ui/sonner';
import {
  ACCESS_MODES,
  ACTION_LABELS,
  ANIMATIONS,
  ANIMATION_LABELS,
  AUDIENCE_LABELS,
  CATEGORY_LABELS,
  COMPANION_FEATURES,
  COMPANION_FEATURE_LABELS,
  FREQUENCIES,
  FREQUENCY_PRESETS,
  LIMITS,
  SCREEN_LABELS,
  TIP_CATEGORIES,
  TRIGGERS,
  TRIGGER_LABELS,
  type AccessMode,
  type AnimationId,
  type CompanionFeature,
  type CompanionSettings,
  type CompanionTip,
  type Frequency,
} from '@/lib/companion/model';
import { ACCESS_LABELS } from '@/lib/learn/model';
import { TOOLS } from '@/components/shell/tools';
import { useReleaseAfterDialogs } from '../learn/fields';
import { ACCESS_HINTS, accessStyle } from '../learn/LearnManager';
import { utcStamp } from '../when';
import {
  archiveCompanionTip,
  duplicateCompanionTip,
  moveCompanionTip,
  restoreCompanionVersionAction,
  saveCompanionAccess,
  saveCompanionSettings,
  type CompanionActionResult,
} from './actions';
import { CompanionPreview, type PreviewRequest } from './Preview';
import { TipEditor, blankTip, type EditorTarget } from './TipEditor';

// Admin → Companion's screen (ADR-0024). Settings, animations, access and
// tips each save on their own, live at once; the preview shows the real
// Sketchy and sign without saving anything.

interface VersionRow {
  version: number;
  live: boolean;
  at: string | null;
  by: string;
  note: string | null;
}

const CARD = 'rounded-2xl border border-border bg-card p-4 md:p-5';
const field = 'h-9 w-full rounded-lg border border-border bg-background px-2 text-base text-foreground md:text-sm disabled:opacity-60';
const smallButton = 'inline-flex h-8 items-center gap-1 rounded-lg border border-border px-2.5 text-xs font-semibold text-foreground hover:bg-secondary disabled:pointer-events-none disabled:opacity-50';
const primary = 'inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60';

const NUMBERS: { key: keyof CompanionSettings & keyof typeof LIMITS; label: string; unit: string }[] = [
  { key: 'firstDelaySec', label: 'Walks in after', unit: 'seconds on Home' },
  { key: 'tipAfterSec', label: 'First suggestion after', unit: 'quiet seconds' },
  { key: 'cooldownMin', label: 'Between two suggestions', unit: 'minutes' },
  { key: 'maxPerDay', label: 'Suggestions per day, at most', unit: 'per person' },
  { key: 'snoozeHours', label: 'Quiet after “Not now”', unit: 'hours' },
  { key: 'wanderEverySec', label: 'Walks to another spot every', unit: 'seconds' },
  { key: 'restAfterSec', label: 'Sits down to rest after', unit: 'quiet seconds' },
  { key: 'speed', label: 'Walking speed', unit: '% (100 = normal)' },
];

const frequencyOf = (s: CompanionSettings): Frequency | 'custom' => {
  for (const f of FREQUENCIES) {
    const p = FREQUENCY_PRESETS[f];
    if (p.tipAfterSec === s.tipAfterSec && p.cooldownMin === s.cooldownMin && p.maxPerDay === s.maxPerDay) return f;
  }
  return 'custom';
};

function Toggle({ id, label, detail, checked, onChange }: { id: string; label: string; detail?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <div className="min-w-0">
        <p id={`${id}-label`} className="text-sm font-medium text-foreground">
          {label}
        </p>
        {detail && <p className="text-xs text-muted-foreground">{detail}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-label`}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${checked ? 'bg-primary' : 'bg-secondary ring-1 ring-border'}`}
        data-setting={id}
      >
        <span className={`inline-block h-5 w-5 rounded-full bg-background shadow transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
      </button>
    </div>
  );
}

function toastResult(result: CompanionActionResult) {
  if (result.ok) toast.success(result.message);
  else toast.error(result.message, { description: result.issues?.slice(0, 4).join(' · ') });
}

export function CompanionManager({
  config,
  hashes,
  liveVersion,
  versions,
}: {
  config: { settings: CompanionSettings; access: Record<string, string>; tips: CompanionTip[] };
  hashes: Record<string, string>;
  liveVersion: number | null;
  versions: VersionRow[];
}) {
  const router = useRouter();
  const [, startRefresh] = useTransition();
  const refresh = () => startRefresh(() => router.refresh());

  const [settings, setSettings] = useState<CompanionSettings>(config.settings);
  const [savingSettings, setSavingSettings] = useState(false);
  const [access, setAccess] = useState<Record<CompanionFeature, AccessMode>>(
    () => Object.fromEntries(COMPANION_FEATURES.map((f) => [f, (ACCESS_MODES as readonly string[]).includes(config.access[f]) ? config.access[f] : 'free'])) as Record<CompanionFeature, AccessMode>,
  );
  const [savingAccess, setSavingAccess] = useState(false);
  const [preview, setPreview] = useState<PreviewRequest>({ animation: 'wave', tip: null, nonce: 0 });
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const [restoring, setRestoring] = useState<number | null>(null);
  const [archiving, setArchiving] = useState<CompanionTip | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<'all' | CompanionTip['category']>('all');
  const [trigger, setTrigger] = useState<'all' | CompanionTip['trigger']>('all');
  const [status, setStatus] = useState<'live' | 'archived' | 'all'>('live');
  useReleaseAfterDialogs(editor !== null || restoring !== null || archiving !== null);

  const settingsChanged = JSON.stringify(settings) !== JSON.stringify(config.settings);
  const accessChanged = COMPANION_FEATURES.some((f) => access[f] !== config.access[f]);
  const ordered = useMemo(() => [...config.tips].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)), [config.tips]);
  const shown = ordered.filter((tip) => {
    if (status === 'live' && tip.archived) return false;
    if (status === 'archived' && !tip.archived) return false;
    if (category !== 'all' && tip.category !== category) return false;
    if (trigger !== 'all' && tip.trigger !== trigger) return false;
    const q = query.trim().toLowerCase();
    return !q || tip.id.toLowerCase().includes(q) || tip.text.en.toLowerCase().includes(q) || tip.text.he.includes(query.trim());
  });
  const liveTips = ordered.filter((t) => !t.archived);

  const play = (animation: AnimationId) => setPreview((p) => ({ animation, tip: null, nonce: p.nonce + 1 }));
  const showTip = (tip: CompanionTip) => setPreview((p) => ({ animation: tip.animation, tip, nonce: p.nonce + 1 }));

  async function saveSettings() {
    setSavingSettings(true);
    try {
      const result = await saveCompanionSettings(settings);
      toastResult(result);
      if (result.ok) refresh();
    } finally {
      setSavingSettings(false);
    }
  }

  async function saveAccessForm() {
    setSavingAccess(true);
    try {
      const result = await saveCompanionAccess(access);
      toastResult(result);
      if (result.ok) refresh();
    } finally {
      setSavingAccess(false);
    }
  }

  async function act(id: string, work: () => Promise<CompanionActionResult>) {
    setBusy(id);
    try {
      const result = await work();
      toastResult(result);
      if (result.ok) refresh();
    } finally {
      setBusy(null);
    }
  }

  const set = <K extends keyof CompanionSettings>(key: K, value: CompanionSettings[K]) => setSettings((s) => ({ ...s, [key]: value }));
  const frequency = frequencyOf(settings);

  return (
    <div className="mt-5 space-y-5">
      <Toaster position="top-center" />
      <p className="text-sm text-muted-foreground" data-companion-live={liveVersion ?? 'defaults'}>
        {liveVersion === null ? 'Live: the built-in defaults (nothing saved yet; your first save becomes version 1).' : `Live: version ${liveVersion}.`} Sketchy is{' '}
        <strong className="text-foreground">{config.settings.enabled ? 'on' : 'off'}</strong> · {liveTips.length} tips ({ordered.length - liveTips.length} archived).
      </p>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* ── Settings ── */}
        <section aria-label="Settings" className={CARD}>
          <h2 className="text-base font-semibold text-foreground">Settings</h2>
          <Toggle id="enabled" label="Sketchy is on" detail="Off: he is not shown to anyone, admins included." checked={settings.enabled} onChange={(v) => set('enabled', v)} />
          <div className="py-2">
            <label htmlFor="size" className="text-sm font-medium text-foreground">
              Size: {settings.size}%
            </label>
            <input id="size" type="range" min={LIMITS.size.min} max={LIMITS.size.max} step={5} value={settings.size} onChange={(e) => set('size', Number(e.target.value))} className="mt-1 w-full accent-[hsl(var(--primary))]" data-setting="size" />
            <p className="text-xs text-muted-foreground">He also gets smaller on his own when a screen has little room.</p>
          </div>
          <div className="py-2">
            <label htmlFor="frequency" className="text-sm font-medium text-foreground">
              How often he speaks up
            </label>
            <select
              id="frequency"
              value={frequency}
              onChange={(e) => {
                const f = e.target.value as Frequency | 'custom';
                if (f === 'custom') return;
                setSettings((s) => ({ ...s, frequency: f, ...FREQUENCY_PRESETS[f] }));
              }}
              className={`${field} mt-1`}
              data-setting="frequency"
            >
              <option value="quiet">Quiet (2 a day, 4 hours apart)</option>
              <option value="balanced">Balanced (5 a day, 45 minutes apart)</option>
              <option value="chatty">Chatty (12 a day, 10 minutes apart)</option>
              <option value="custom" disabled>
                Custom (the numbers below)
              </option>
            </select>
          </div>
          <div className="grid gap-x-4 gap-y-2 py-2 sm:grid-cols-2">
            {NUMBERS.map(({ key, label, unit }) => (
              <label key={key} className="block">
                <span className="text-sm font-medium text-foreground">{label}</span>
                <input
                  type="number"
                  min={LIMITS[key].min}
                  max={LIMITS[key].max}
                  value={settings[key] as number}
                  onChange={(e) => {
                    const v = Math.round(Number(e.target.value));
                    if (!Number.isFinite(v)) return;
                    setSettings((s) => ({ ...s, [key]: Math.max(LIMITS[key].min, Math.min(LIMITS[key].max, v)) }));
                  }}
                  className={`${field} mt-1`}
                  data-setting={key}
                />
                <span className="text-xs text-muted-foreground">
                  {unit} ({LIMITS[key].min}–{LIMITS[key].max})
                </span>
              </label>
            ))}
          </div>
          <Toggle id="wander" label="Walks between free spots" detail="Only where a screen has room; on phones he mostly stays put." checked={settings.wander} onChange={(v) => set('wander', v)} />
          <Toggle id="idleLife" label="Blinks, breathes, moves his tail and ears" checked={settings.idleLife} onChange={(v) => set('idleLife', v)} />
          <Toggle id="celebrate" label="Celebrates saves and completed lessons and challenges" checked={settings.celebrate} onChange={(v) => set('celebrate', v)} />

          <h3 className="mt-3 text-sm font-semibold text-foreground">Animations</h3>
          <p className="text-xs text-muted-foreground">Off: he does something calmer instead (running → walking, celebrating → a jump or a wave…). Walking off: he appears and disappears gently.</p>
          <ul className="mt-2 grid gap-1 sm:grid-cols-2">
            {ANIMATIONS.map((id) => (
              <li key={id} className="flex items-center justify-between gap-2 rounded-lg border border-border px-2 py-1">
                <label className="flex min-h-[36px] items-center gap-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={settings.animations[id] !== false}
                    disabled={id === 'idle'}
                    onChange={(e) => setSettings((s) => ({ ...s, animations: { ...s.animations, [id]: e.target.checked } }))}
                    className="h-4 w-4 accent-[hsl(var(--primary))]"
                    data-animation={id}
                  />
                  {ANIMATION_LABELS[id]}
                </label>
                <button type="button" onClick={() => play(id)} className={smallButton} aria-label={`Preview: ${ANIMATION_LABELS[id]}`}>
                  <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => void saveSettings()} disabled={!settingsChanged || savingSettings} className={primary} data-save-settings>
              {savingSettings && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              Save settings · live now
            </button>
            {settingsChanged && (
              <button type="button" onClick={() => setSettings(config.settings)} className="text-sm font-medium text-muted-foreground hover:text-foreground">
                Undo changes
              </button>
            )}
          </div>
        </section>

        <div className="space-y-5">
          <CompanionPreview request={preview} onPlay={play} size={settings.size} reducedMotion={false} />

          {/* ── Access ── */}
          <section aria-label="Access" className={CARD}>
            <h2 className="text-base font-semibold text-foreground">Who may use what</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Like Learn&apos;s items: Free (everyone signed in), Pro (Pro accounts; nobody else sees it), Admin only (to check first), Blocked (nobody). Today
              everything is Free. Billing and PayPal are not affected.
            </p>
            <ul className="mt-3 space-y-2">
              {COMPANION_FEATURES.map((f) => (
                <li key={f} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-foreground">{COMPANION_FEATURE_LABELS[f].title}</span>
                    <span className="block text-xs text-muted-foreground">{COMPANION_FEATURE_LABELS[f].detail}</span>
                  </span>
                  <select value={access[f]} onChange={(e) => setAccess((a) => ({ ...a, [f]: e.target.value as AccessMode }))} className={`${field} w-40`} aria-label={`Access: ${COMPANION_FEATURE_LABELS[f].title}`} data-access={f}>
                    {ACCESS_MODES.map((m) => (
                      <option key={m} value={m} title={ACCESS_HINTS[m]}>
                        {ACCESS_LABELS[m]}
                      </option>
                    ))}
                  </select>
                </li>
              ))}
            </ul>
            <button type="button" onClick={() => void saveAccessForm()} disabled={!accessChanged || savingAccess} className={`${primary} mt-4`} data-save-access>
              {savingAccess && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              Save access · live now
            </button>
          </section>
        </div>
      </div>

      {/* ── Tips ── */}
      <section aria-label="Tips" className={CARD}>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="me-auto text-base font-semibold text-foreground">Tips ({shown.length})</h2>
          <button type="button" onClick={() => setEditor({ id: null, tip: blankTip() })} className={primary} data-add-tip>
            <Plus className="h-4 w-4" aria-hidden="true" /> Add a tip
          </button>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <label className="relative block">
            <Search className="pointer-events-none absolute start-2 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search text or ID" aria-label="Search tips" className={`${field} ps-8`} />
          </label>
          <select value={category} onChange={(e) => setCategory(e.target.value as typeof category)} aria-label="Category" className={field}>
            <option value="all">Every category</option>
            {TIP_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
          <select value={trigger} onChange={(e) => setTrigger(e.target.value as typeof trigger)} aria-label="When" className={field}>
            <option value="all">Any moment</option>
            {TRIGGERS.map((t) => (
              <option key={t} value={t}>
                {TRIGGER_LABELS[t]}
              </option>
            ))}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} aria-label="Status" className={field}>
            <option value="live">Not archived</option>
            <option value="archived">Archived</option>
            <option value="all">All</option>
          </select>
        </div>
        <ul className="mt-3 divide-y divide-border" data-tips>
          {shown.map((tip) => {
            const at = liveTips.findIndex((t) => t.id === tip.id);
            return (
              <li key={tip.id} className="flex flex-col gap-2 py-3 md:flex-row md:items-start" data-tip={tip.id}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="font-mono font-semibold text-foreground">{tip.id}</span>
                    <span className={`rounded-full border px-2 py-0.5 font-semibold ${accessStyle[tip.access as AccessMode] ?? ''}`}>{ACCESS_LABELS[tip.access as AccessMode] ?? tip.access}</span>
                    {tip.archived && <span className="rounded-full border border-border px-2 py-0.5 text-muted-foreground">Archived</span>}
                    <span className="text-muted-foreground">
                      {CATEGORY_LABELS[tip.category] ?? tip.category} · {TRIGGER_LABELS[tip.trigger] ?? tip.trigger}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-foreground">{tip.text.en || <em className="text-muted-foreground">No English yet</em>}</p>
                  <p className="mt-0.5 text-sm text-foreground/80" dir="rtl" lang="he">
                    {tip.text.he || <em className="text-muted-foreground">אין עדיין עברית</em>}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {tip.trigger === 'menu' ? 'From his menu' : tip.screens.map((s) => SCREEN_LABELS[s] ?? s).join(', ')} · {tip.audience.length ? tip.audience.map((a) => AUDIENCE_LABELS[a] ?? a).join(', ') : 'Everyone'}
                    {tip.afterTools?.length ? ` · after ${tip.afterTools.map((t) => TOOLS[t]?.title ?? t).join(', ')}` : ''} · {ANIMATION_LABELS[tip.animation] ?? tip.animation} · Button: {ACTION_LABELS[tip.action.type] ?? tip.action.type}
                    {tip.action.tool ? ` (${TOOLS[tip.action.tool]?.title ?? tip.action.tool})` : ''}
                    {tip.action.itemId ? ` (${tip.action.itemId})` : ''} · weight {tip.weight}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                  <button type="button" onClick={() => showTip(tip)} className={smallButton} data-tip-action="preview">
                    <Eye className="h-3.5 w-3.5" aria-hidden="true" /> Preview
                  </button>
                  <button type="button" onClick={() => setEditor({ id: tip.id, tip, hash: hashes[tip.id] })} className={smallButton} data-tip-action="edit">
                    <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> Edit
                  </button>
                  <button type="button" disabled={busy !== null} onClick={() => void act(tip.id, () => duplicateCompanionTip({ id: tip.id }))} className={smallButton} data-tip-action="duplicate">
                    <Copy className="h-3.5 w-3.5" aria-hidden="true" /> Copy
                  </button>
                  {tip.archived ? (
                    <button type="button" disabled={busy !== null} onClick={() => void act(tip.id, () => archiveCompanionTip({ id: tip.id, archived: false }))} className={smallButton} data-tip-action="restore">
                      <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Restore
                    </button>
                  ) : (
                    <>
                      <button type="button" disabled={busy !== null} onClick={() => setArchiving(tip)} className={smallButton} data-tip-action="archive">
                        <Archive className="h-3.5 w-3.5" aria-hidden="true" /> Archive
                      </button>
                      <button type="button" disabled={busy !== null || at <= 0} onClick={() => void act(tip.id, () => moveCompanionTip({ id: tip.id, direction: 'up' }))} className={smallButton} aria-label={`Move ${tip.id} up`}>
                        <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                      <button type="button" disabled={busy !== null || at < 0 || at >= liveTips.length - 1} onClick={() => void act(tip.id, () => moveCompanionTip({ id: tip.id, direction: 'down' }))} className={smallButton} aria-label={`Move ${tip.id} down`}>
                        <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </>
                  )}
                  {busy === tip.id && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {/* ── History ── */}
      <section aria-label="Version history" className={CARD}>
        <h2 className="text-base font-semibold text-foreground">History</h2>
        <p className="mt-1 text-sm text-muted-foreground">Every save is a version, kept for good. Restoring one makes everything as it was then, live at once (tip IDs are never reused).</p>
        {versions.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">Nothing saved yet: the built-in defaults are live.</p>
        ) : (
          <ul className="mt-2 divide-y divide-border">
            {versions.map((v) => (
              <li key={v.version} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm">
                <span className="min-w-0">
                  <span className="font-medium text-foreground">Version {v.version}</span>{' '}
                  <span className="text-muted-foreground">
                    · {v.live ? 'live' : 'earlier'} · {utcStamp(v.at)} by {v.by}
                    {v.note ? ` · ${v.note}` : ''}
                  </span>
                </span>
                {!v.live && (
                  <button type="button" onClick={() => setRestoring(v.version)} className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-secondary" data-restore-version={v.version}>
                    Restore this version
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {editor && (
        <TipEditor
          target={editor}
          onClose={() => setEditor(null)}
          onPreview={showTip}
          onSaved={(result) => {
            setEditor(null);
            toastResult(result);
            refresh();
          }}
        />
      )}

      <AlertDialog open={archiving !== null} onOpenChange={(open) => !open && setArchiving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive {archiving?.id}?</AlertDialogTitle>
            <AlertDialogDescription>Nobody sees it any more, at once. It stays under Archived and can be restored.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const tip = archiving;
                setArchiving(null);
                if (tip) void act(tip.id, () => archiveCompanionTip({ id: tip.id, archived: true }));
              }}
            >
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={restoring !== null} onOpenChange={(open) => !open && setRestoring(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore version {restoring}?</AlertDialogTitle>
            <AlertDialogDescription>Settings, access and every tip become as they were in that version, live as soon as you confirm. This is itself saved as a new version.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const version = restoring;
                setRestoring(null);
                if (version) void act(`v${version}`, () => restoreCompanionVersionAction({ version }));
              }}
            >
              Restore
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
