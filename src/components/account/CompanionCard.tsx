'use client';

import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { AUDIENCES, type Audience } from '@/lib/companion/model';
import type { StudioAccount } from '@/components/shell/account';
import { useCompanionPrefs } from '@/components/companion/state';
import { CARD, StatusLine, type Status } from './parts';

// The account page's Sketchy section (ADR-0024): show or hide him on every
// device, and say what brings the person here (for his suggestions). Shown
// whenever he is open to the account, so someone who hid him can bring him back.

export function CompanionCard({ account }: { account: StudioAccount }) {
  const t = useTranslations('companion');
  const { save, saving } = useCompanionPrefs();
  const [status, setStatus] = useState<Status>(null);
  const companion = account.companion;
  if (!companion?.available) return null;
  const shown = !companion.hidden;

  const change = async (prefs: { hidden?: boolean; audience?: Audience | null }) => {
    const ok = await save(prefs);
    setStatus(ok ? { tone: 'ok', text: t('preferences.saved') } : { tone: 'error', text: t('preferences.failed') });
  };

  return (
    <section aria-label={t('preferences.title')} className={CARD} data-companion-preferences>
      <p className="font-semibold text-foreground">{t('preferences.title')}</p>
      <p className="mt-1 text-sm text-muted-foreground">{t('preferences.lead')}</p>
      <div className="mt-4 flex items-center justify-between gap-4">
        <p id="companion-show-label" className="text-sm font-medium text-foreground">
          {t('preferences.show')}
        </p>
        <button
          type="button"
          role="switch"
          aria-checked={shown}
          aria-labelledby="companion-show-label"
          disabled={saving}
          onClick={() => void change({ hidden: shown })}
          className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 ${shown ? 'bg-primary' : 'bg-secondary ring-1 ring-border'}`}
          data-companion-show
        >
          <span className={`inline-block h-5 w-5 rounded-full bg-background shadow transition-transform ${shown ? 'translate-x-6 rtl:-translate-x-6' : 'translate-x-1 rtl:-translate-x-1'}`} />
        </button>
      </div>
      <div className="mt-4">
        <label htmlFor="companion-audience" className="text-sm font-medium text-foreground">
          {t('preferences.audience')}
        </label>
        <select
          id="companion-audience"
          value={companion.audience ?? ''}
          disabled={saving}
          onChange={(e) => void change({ audience: (e.target.value || null) as Audience | null })}
          className="mt-1.5 block h-11 w-full rounded-xl border border-border bg-background px-3 text-base text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 sm:w-80"
          data-companion-audience
        >
          <option value="">{t('preferences.none')}</option>
          {AUDIENCES.map((a) => (
            <option key={a} value={a}>
              {t(`about.${a}`)}
            </option>
          ))}
        </select>
      </div>
      <StatusLine status={status} />
    </section>
  );
}
