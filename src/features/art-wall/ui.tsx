// Small controls of Art on Your Wall, in the studio's look: option chips,
// colour swatches, switches, a centimetre field, and the note shown when an
// option belongs to Pro (it names the option and links to the plans; nothing
// is bought here).

import Link from 'next/link';
import { Check, Crown, X } from 'lucide-react';
import { useTranslations } from 'use-intl';
import { pathForView } from '@/components/shell/tools';

export function Section({ title, children, hint }: { title: string; children: React.ReactNode; hint?: string }) {
  return (
    <section className="space-y-2.5">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
      {hint && <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>}
    </section>
  );
}

export function ProBadge() {
  return (
    <span className="ms-1 inline-flex items-center gap-0.5 rounded-full bg-primary/15 px-1.5 py-px text-[10px] font-bold uppercase tracking-wide text-primary">
      <Crown className="h-2.5 w-2.5" aria-hidden="true" />
      Pro
    </span>
  );
}

export interface ChipOption<T extends string> {
  id: T;
  label: string;
  locked?: boolean;
  icon?: React.ReactNode;
}

/** One choice among a few (aria-pressed buttons). A locked option stays visible; choosing it explains Pro. */
export function Chips<T extends string>({ options, value, onChange, onLocked, label, columns }: {
  options: ChipOption<T>[];
  value: T;
  onChange: (value: T) => void;
  onLocked: (label: string) => void;
  label: string;
  columns?: number;
}) {
  return (
    <div role="group" aria-label={label} className={columns ? 'grid gap-1.5' : 'flex flex-wrap gap-1.5'} style={columns ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : undefined}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={value === o.id}
          onClick={() => (o.locked ? onLocked(o.label) : onChange(o.id))}
          className={`flex min-h-10 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
            value === o.id ? 'border-primary bg-primary/15 text-primary' : 'border-border bg-secondary/40 text-foreground/85 hover:bg-secondary'
          }`}
        >
          {o.icon}
          <span className="truncate">{o.label}</span>
          {o.locked && <Crown className="h-3 w-3 shrink-0 text-primary" aria-label="Pro" />}
        </button>
      ))}
    </div>
  );
}

export interface Swatch {
  id: string;
  color: string;
  label: string;
  locked?: boolean;
  /** A gradient or picture for materials (CSS background). */
  background?: string;
}

/** Colour or material swatches (a radio group), and optionally a custom colour. */
export function Swatches({ swatches, value, onChange, onLocked, label, custom }: {
  swatches: Swatch[];
  value: string;
  onChange: (id: string) => void;
  onLocked: (label: string) => void;
  label: string;
  /** A custom colour picker (value is a hex colour then). */
  custom?: { label: string };
}) {
  const known = swatches.some((s) => s.id === value);
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap items-center gap-2">
      {swatches.map((s) => {
        const on = value === s.id;
        return (
          <button
            key={s.id}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={s.locked ? `${s.label} (Pro)` : s.label}
            title={s.label}
            onClick={() => (s.locked ? onLocked(s.label) : onChange(s.id))}
            className={`relative h-10 w-10 shrink-0 rounded-full border-2 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
              on ? 'scale-105 border-primary' : 'border-border/70 hover:scale-105'
            }`}
            style={{ background: s.background ?? s.color }}
          >
            {on && <Check className="absolute inset-0 m-auto h-4 w-4 text-white mix-blend-difference" aria-hidden="true" />}
            {s.locked && (
              <span className="absolute -end-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-background ring-1 ring-primary/50">
                <Crown className="h-2.5 w-2.5 text-primary" aria-hidden="true" />
              </span>
            )}
          </button>
        );
      })}
      {custom && (
        <label
          className={`relative flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-full border-2 ${!known ? 'border-primary' : 'border-border/70'}`}
          style={{ background: 'conic-gradient(#f87171, #fbbf24, #a3e635, #34d399, #38bdf8, #818cf8, #e879f9, #f87171)' }}
          title={custom.label}
        >
          <span className="sr-only">{custom.label}</span>
          {!known && <span className="h-5 w-5 rounded-full border-2 border-white" style={{ background: value }} aria-hidden="true" />}
          <input type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#cccccc'} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" />
        </label>
      )}
    </div>
  );
}

export function Toggle({ label, checked, onChange, locked, onLocked }: { label: string; checked: boolean; onChange: (on: boolean) => void; locked?: boolean; onLocked?: (label: string) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => (locked ? onLocked?.(label) : onChange(!checked))}
      className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-1 text-start text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="flex items-center">
        {label}
        {locked && <ProBadge />}
      </span>
      <span className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${checked ? 'bg-primary' : 'bg-secondary ring-1 ring-border'}`} aria-hidden="true">
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-[inset-inline-start] ${checked ? 'start-[22px]' : 'start-0.5'}`} />
      </span>
    </button>
  );
}

export function CmField({ id, label, value, onChange, unit, min = 1, max = 1000 }: { id: string; label: string; value: number; onChange: (v: number) => void; unit: string; min?: number; max?: number }) {
  return (
    <label htmlFor={id} className="flex min-w-0 flex-1 flex-col gap-1 text-xs font-medium text-muted-foreground">
      {label}
      <span className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 focus-within:ring-2 focus-within:ring-ring">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          min={min}
          max={max}
          step={0.5}
          value={Number.isFinite(value) ? Math.round(value * 10) / 10 : ''}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (Number.isFinite(v) && v >= min && v <= max) onChange(v);
          }}
          className="h-11 w-full min-w-0 bg-transparent text-base text-foreground outline-none"
        />
        <span className="text-sm text-muted-foreground">{unit}</span>
      </span>
    </label>
  );
}

/** "This option is part of Pro", with the way to the plans. */
export function ProHint({ name, onClose }: { name: string; onClose: () => void }) {
  const t = useTranslations('wallTool.pro');
  return (
    <div role="status" className="flex items-start gap-3 rounded-xl border border-primary/40 bg-card p-3 shadow-lg">
      <Crown className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-semibold text-foreground">{t('part', { name })}</p>
        <Link href={pathForView('plans')} className="mt-1 inline-block text-[13px] font-semibold text-primary underline-offset-2 hover:underline">
          {t('plans')}
        </Link>
      </div>
      <button type="button" onClick={onClose} aria-label={t('close')} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary">
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}
