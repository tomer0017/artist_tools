import Link from 'next/link';
import { Lock } from 'lucide-react';
import { useTranslations } from 'use-intl';
import { TOOL_FEATURES } from '@/lib/plans';
import type { TabId } from '@/types/project';
import { useAccount } from './account';
import { TOOLS, pathForView } from './tools';

// ─── A tool the account may not use ───────────────────────────────────────────
// Shown in the tool's place, however it was reached (a link, the address bar,
// a reload, another tool handing off, a tab left open while access changed).
// The tool itself is not mounted, or stays hidden with its work if it was
// already open: nothing is deleted. Why it is locked comes from the published
// plans: part of Pro, or not on any plan right now. Pro cannot be bought yet,
// so the way on is back Home or to the plan comparison, never a payment.

export default function ToolLocked({ tool }: { tool: TabId }) {
  const t = useTranslations('studio.locked');
  const tt = useTranslations(`tools.${tool}`);
  const account = useAccount()?.account;
  const feature = TOOL_FEATURES[tool];
  const inPro = account?.offer.pro.includes(feature) === true;
  const onSomePlan = inPro || account?.offer.free.includes(feature) === true;
  const reason = !onSomePlan ? 'off' : inPro && account?.plan.effective !== 'pro' ? 'pro' : 'plan';
  const Icon = TOOLS[tool].icon;

  return (
    <section
      aria-labelledby="tool-locked-title"
      data-tool-locked={tool}
      className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto overscroll-contain bg-background px-4 py-8"
    >
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 text-center shadow-sm md:p-8">
        <div className="relative mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-secondary">
          <Icon className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <span className="absolute -bottom-1.5 -end-1.5 flex h-7 w-7 items-center justify-center rounded-full border-2 border-card bg-primary text-primary-foreground">
            <Lock className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
        </div>
        <p className="mt-5 text-xs font-semibold uppercase tracking-wider text-primary">{reason === 'pro' ? t('badgePro') : t('badge')}</p>
        <h1 id="tool-locked-title" className="mt-1.5 text-xl font-bold leading-snug text-foreground md:text-2xl">
          {t('title', { tool: tt('title') })}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{t(`reason.${reason}`)}</p>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t('kept')}</p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Link
            href={pathForView('home')}
            className="flex h-12 items-center justify-center rounded-xl bg-primary px-5 text-[15px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
          >
            {t('back')}
          </Link>
          <Link
            href={pathForView('plans')}
            className="flex h-12 items-center justify-center rounded-xl border border-border px-5 text-[15px] font-semibold text-foreground transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t('comparePlans')}
          </Link>
        </div>
      </div>
    </section>
  );
}
