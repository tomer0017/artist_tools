import { useEffect } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'use-intl';
import { ChevronLeft, X } from 'lucide-react';
import { useProject } from '@/hooks/useProjectStore';
import { clearLearnReturn, useLearnReturn } from '@/hooks/useLearnReturn';
import { isTool } from '@/components/shell/tools';

// "Back to Lesson 2" (ADR-0019): a slim bar above a tool opened from a lesson
// or a challenge, so the way back to the page on paper is one tap. Shown only
// in the tools; leaving them (for Home or Learn) ends it, and so does the ×.
// It takes no room unless it is shown, and covers nothing of the tool.

export default function ReturnBar() {
  const t = useTranslations('learn.returnBar');
  const locale = useLocale();
  const { activeTab } = useProject();
  const back = useLearnReturn();
  const inTool = isTool(activeTab);

  // Out of the tools (Home, Learn, the account), the way back has served its purpose.
  useEffect(() => {
    if (!inTool) clearLearnReturn();
  }, [inTool]);

  if (!back || !inTool) return null;
  const title = locale === 'he' ? back.title.he : back.title.en;
  const label = back.kind === 'exercise' && back.number !== null ? t('lesson', { number: back.number, title }) : t('item', { title });
  return (
    <nav aria-label={t('label')} data-learn-return className="flex shrink-0 items-center gap-1 border-b border-border bg-card/95 px-2 py-1 md:px-4">
      <Link
        href={back.href}
        onClick={() => clearLearnReturn()}
        className="inline-flex min-h-[40px] min-w-0 flex-1 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronLeft className="h-4 w-4 shrink-0 rtl:-scale-x-100" aria-hidden="true" />
        <span className="min-w-0 truncate">{label}</span>
      </Link>
      <button
        type="button"
        onClick={() => clearLearnReturn()}
        aria-label={t('dismiss')}
        className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </nav>
  );
}
