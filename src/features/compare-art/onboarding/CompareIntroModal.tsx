import { useEffect } from 'react';
import { Layers, X, Sparkles } from 'lucide-react';
import { FlowRibbon, WorkflowA, WorkflowB, WhyGifBlink } from './CompareOnboardingArt';

/**
 * First-run onboarding for Compare Art. It doesn't present features — it tells
 * the whole workflow as pictures: a Load → Align → Compare → Grid → Export GIF
 * ribbon, then the SAME journey shown two ways (manual overlay vs. Smart Align)
 * as numbered comic-strips, and finally *why* a GIF helps (a real blink). A
 * painter should follow it with the captions removed.
 */
export default function CompareIntroModal({
  open,
  onStart,
  onClose,
}: {
  open: boolean;
  onStart: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div role="dialog" aria-modal="true" aria-label="How Compare Art works"
      className="fixed inset-0 z-[70] flex items-center justify-center px-4 py-6">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm animate-fade-in" onClick={onClose} />

      <div className="relative flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-border bg-card shadow-2xl animate-slide-up">
        <button onClick={onClose} aria-label="Close"
          className="absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground active:bg-secondary">
          <X className="h-4 w-4" />
        </button>

        <div className="overflow-y-auto px-5 py-6 sm:px-7">
          {/* Header */}
          <div className="text-center">
            <h2 className="text-2xl font-bold text-foreground">Compare your art. See what to fix.</h2>
            <p className="mx-auto mt-1.5 max-w-md text-sm text-muted-foreground">
              Load your painting and a reference, then pick one of two ways to align and compare them.
            </p>
          </div>

          {/* The whole flow at a glance */}
          <div className="mt-5">
            <FlowRibbon />
          </div>

          {/* Two ways to align */}
          <p className="mt-5 text-center text-sm font-medium text-foreground">Choose how you want to align</p>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {/* Workflow A */}
            <section className="rounded-2xl border border-primary/50 bg-primary/[0.04] p-3">
              <header className="mb-2 flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">A</span>
                <div className="min-w-0">
                  <div className="text-sm font-bold text-primary">Overlay &amp; fade</div>
                  <div className="text-[11px] leading-tight text-muted-foreground">Drag, fade, reveal mistakes</div>
                </div>
              </header>
              <WorkflowA />
            </section>

            {/* Workflow B */}
            <section className="rounded-2xl border border-blue-500/50 bg-blue-500/[0.05] p-3">
              <header className="mb-2 flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-500 text-[11px] font-bold text-white">B</span>
                <div className="min-w-0">
                  <div className="inline-flex items-center gap-1 text-sm font-bold text-blue-400">
                    <Sparkles className="h-3.5 w-3.5" /> Smart Align
                  </div>
                  <div className="text-[11px] leading-tight text-muted-foreground">Tap matching points — it snaps</div>
                </div>
              </header>
              <WorkflowB />
            </section>
          </div>

          {/* Why GIF */}
          <div className="mt-4 rounded-2xl border border-border bg-secondary/25 p-3">
            <WhyGifBlink />
          </div>
        </div>

        {/* Sticky action footer */}
        <div className="shrink-0 border-t border-border bg-card px-5 py-3 sm:px-7">
          <button onClick={onStart}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-base font-semibold text-primary-foreground shadow-lg shadow-primary/20 active:opacity-90">
            <Layers className="h-5 w-5" />
            Start comparing
          </button>
          <p className="mt-1.5 text-center text-[11px] text-muted-foreground">You can switch methods anytime.</p>
        </div>
      </div>
    </div>
  );
}
