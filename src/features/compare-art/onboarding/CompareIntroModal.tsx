import { useEffect } from 'react';
import { Layers, X, Sparkles } from 'lucide-react';
import CompareWorkflowArt from './CompareWorkflowArt';

/**
 * First-run onboarding for Compare Art — a single visual card, in the same
 * spirit as the Measure intro. It demonstrates the two ways to compare with
 * looping animations instead of paragraphs, shows the one continuous flow as a
 * quiet ribbon, and offers one call to action. No multi-screen tour.
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
      className="fixed inset-0 z-[70] flex items-center justify-center px-5 py-6">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm animate-fade-in" onClick={onClose} />

      <div className="relative w-full max-w-md max-h-full overflow-y-auto rounded-3xl border border-border bg-card shadow-2xl animate-slide-up">
        <button onClick={onClose} aria-label="Close"
          className="absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground active:bg-secondary">
          <X className="h-4 w-4" />
        </button>

        <div className="space-y-4 p-5 sm:p-6">
          <h2 className="text-center text-xl font-bold text-foreground">
            Two ways to spot what to fix
          </h2>

          {/* Workflow A — overlay & fade → GIF */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-secondary text-[11px] font-bold text-foreground">A</span>
              <span className="text-sm font-semibold text-foreground">Overlay &amp; fade</span>
              <span className="text-xs text-muted-foreground">— mistakes show through</span>
            </div>
            <CompareWorkflowArt scene="overlay" />
          </div>

          {/* Workflow B — smart align */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-secondary text-[11px] font-bold text-foreground">B</span>
              <span className="inline-flex items-center gap-1 text-sm font-semibold text-foreground">
                <Sparkles className="h-3.5 w-3.5 text-primary" /> Smart Align
              </span>
              <span className="text-xs text-muted-foreground">— tap, and it snaps</span>
            </div>
            <CompareWorkflowArt scene="align" />
          </div>

          {/* The one continuous flow — a quiet ribbon, not a paragraph */}
          <div className="flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1 text-[11px] font-medium text-muted-foreground">
            {['Load', 'Align', 'Compare', 'Grid (optional)', 'Export GIF'].map((step, i, a) => (
              <span key={step} className="inline-flex items-center gap-1.5">
                <span className={step === 'Grid (optional)' ? 'text-muted-foreground/70' : 'text-foreground'}>{step}</span>
                {i < a.length - 1 && <span className="text-muted-foreground/50">→</span>}
              </span>
            ))}
          </div>

          <button onClick={onStart}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-base font-semibold text-primary-foreground shadow-lg shadow-primary/20 active:opacity-90">
            <Layers className="h-5 w-5" />
            Start comparing
          </button>
        </div>
      </div>
    </div>
  );
}
