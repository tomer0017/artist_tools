import { useEffect, useRef, useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { HelpCircle, X } from 'lucide-react';
import { useTranslations } from 'use-intl';
import { useProject } from '@/hooks/useProjectStore';
import type { TabId } from '@/types/project';
import { introSeenLocally, useAccount } from './account';
import { TOOLS, TOOL_ART, isTool } from './tools';

// ─── First-visit tool introductions ───────────────────────────────────────────
// The first time someone opens a tool, a short card says what it is for, how
// it works in three steps, and gives one button to start. It is shown once per
// tool per account (remembered on the account, so not again on another
// device), never on later visits, and can be brought back from the account
// page. The tool's own screen is unchanged underneath; the guided tours stay
// behind each tool's Help button.

/** One tool's introduction. Closing it in any way (Start, ✕, Escape, tapping outside) counts as seen. */
export function ToolIntro({ tool, onClose }: { tool: TabId; onClose: () => void }) {
  const t = useTranslations('studio.intro');
  const tt = useTranslations(`tools.${tool}`);
  const art = TOOL_ART[tool];
  const Icon = TOOLS[tool].icon;
  const start = useRef<HTMLButtonElement>(null);
  return (
    <DialogPrimitive.Root open onOpenChange={(open) => !open && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-describedby="tool-intro-lead"
          // Focus the way forward (Enter starts), not the close button.
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            start.current?.focus({ preventScroll: true });
          }}
          className="fixed inset-x-0 bottom-0 z-50 max-h-[92dvh] overflow-y-auto rounded-t-2xl border border-border bg-card shadow-2xl outline-none data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom md:inset-x-auto md:bottom-auto md:left-1/2 md:top-1/2 md:w-full md:max-w-md md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-2xl md:data-[state=open]:fade-in-0 md:data-[state=open]:slide-in-from-bottom-0 md:data-[state=open]:zoom-in-95"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          <div className="relative aspect-[21/9] w-full overflow-hidden rounded-t-2xl bg-secondary">
            <img
              src={art.src}
              alt=""
              width={art.width}
              height={art.height}
              decoding="async"
              className="absolute inset-0 h-full w-full object-cover"
              style={{ objectPosition: art.position }}
            />
            <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-card to-transparent" />
            <DialogPrimitive.Close
              aria-label={t('close')}
              className="absolute end-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-background/75 text-foreground backdrop-blur-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </DialogPrimitive.Close>
          </div>

          <div className="px-5 pb-5 pt-1">
            <div className="flex items-center gap-2">
              <Icon className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
              <DialogPrimitive.Title className="text-xl font-semibold tracking-tight text-foreground">{tt('title')}</DialogPrimitive.Title>
            </div>
            <p id="tool-intro-lead" className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              {tt('description')}
            </p>

            <p className="mt-5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{t('howItWorks')}</p>
            <ol className="mt-2 space-y-2.5">
              {[tt('step1'), tt('step2'), tt('step3')].map((step, i) => (
                <li key={step} className="flex gap-3 text-sm leading-snug text-foreground">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary" aria-hidden="true">
                    {i + 1}
                  </span>
                  <span className="pt-0.5">{step}</span>
                </li>
              ))}
            </ol>

            <button
              ref={start}
              type="button"
              onClick={onClose}
              className="mt-6 flex h-12 w-full items-center justify-center rounded-xl bg-primary text-[15px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {tt('start')}
            </button>
            <p className="mt-3 flex items-center justify-center gap-1 text-center text-xs text-muted-foreground">
              {t.rich('helpHint', { icon: () => <HelpCircle className="h-3.5 w-3.5" aria-label={t('help')} /> })}
            </p>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** Shows the open tool's introduction the first time this account opens it. */
export function ToolIntroHost() {
  const { activeTab } = useProject();
  const state = useAccount();
  const [showing, setShowing] = useState<TabId | null>(null);
  const seen = state?.account.introsSeen;
  const userId = state?.account.id;

  useEffect(() => {
    if (!isTool(activeTab) || !seen || !userId) return;
    if (seen.includes(activeTab) || introSeenLocally(userId, activeTab)) return;
    // Let the tool's own screen appear first, then introduce it.
    const timer = window.setTimeout(() => setShowing(activeTab), 300);
    return () => window.clearTimeout(timer);
  }, [activeTab, seen, userId]);

  // Leaving the tool (e.g. the Back gesture) closes its introduction without dismissing it.
  useEffect(() => {
    if (showing && showing !== activeTab) setShowing(null);
  }, [activeTab, showing]);

  if (!showing || !state) return null;
  return (
    <ToolIntro
      tool={showing}
      onClose={() => {
        state.markIntroSeen(showing);
        setShowing(null);
      }}
    />
  );
}
