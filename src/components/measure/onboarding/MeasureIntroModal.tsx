import { useEffect } from 'react';
import { Ruler, X, RectangleHorizontal, Frame, BookOpen, DoorOpen } from 'lucide-react';
import MeasureWorkflowArt from './MeasureWorkflowArt';

// A handful of everyday, known-size objects a painter can measure against.
// Shown as quiet chips — examples, not instructions.
const KNOWN_OBJECTS: { icon: React.ReactNode; label: string }[] = [
  { icon: <RectangleHorizontal className="w-3.5 h-3.5" />, label: 'Canvas' },
  { icon: <Frame className="w-3.5 h-3.5" />, label: 'Frame' },
  { icon: <Ruler className="w-3.5 h-3.5" />, label: 'Ruler' },
  { icon: <BookOpen className="w-3.5 h-3.5" />, label: 'Book' },
  { icon: <DoorOpen className="w-3.5 h-3.5" />, label: 'Door' },
];

/**
 * Step 1 of the redesigned Measure onboarding. The very first time the tool has
 * an image but no scale, this single, illustration-led card appears. It answers
 * exactly one question — "what do I do first?" — with a large storyboard, one
 * line of copy and one obvious call to action. There is no multi-screen tour:
 * closing it drops the painter straight onto the canvas to draw.
 *
 * Presentational only. The owning surface decides how "start drawing" behaves
 * (mobile tool state vs. desktop interaction mode).
 */
export default function MeasureIntroModal({
  open,
  onStart,
  onClose,
}: {
  open: boolean;
  /** Primary action: begin drawing the reference line. */
  onStart: () => void;
  /** Dismiss without drawing (both paths mark the intro as seen). */
  onClose: () => void;
}) {
  // Close on Escape for keyboard/desktop users.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div role="dialog" aria-modal="true" aria-label="Set your measurement scale"
      className="fixed inset-0 z-[70] flex items-center justify-center px-5 py-6">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm animate-fade-in" onClick={onClose} />

      <div className="relative w-full max-w-md max-h-full overflow-y-auto rounded-3xl border border-border bg-card shadow-2xl animate-slide-up">
        {/* Quiet dismiss — the whole card is once-ever and replayable from Help. */}
        <button onClick={onClose} aria-label="Close"
          className="absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground active:bg-secondary">
          <X className="w-4 h-4" />
        </button>

        <div className="p-5 sm:p-6 space-y-5">
          {/* Hero storyboard — carries the entire explanation on its own, so no
              paragraph of copy is needed beneath it. */}
          <MeasureWorkflowArt />

          {/* One short headline — the picture already showed the "how". */}
          <h2 className="text-center text-xl font-bold text-foreground">
            First, measure something you know the size&nbsp;of
          </h2>

          {/* Known-object examples — the visual answer to "measure what?" */}
          <div className="flex flex-wrap justify-center gap-2">
            {KNOWN_OBJECTS.map(o => (
              <span key={o.label}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/40 px-2.5 py-1 text-xs font-medium text-muted-foreground">
                <span className="text-primary">{o.icon}</span>{o.label}
              </span>
            ))}
          </div>

          {/* One clear call to action — dismissal lives on the ✕ / backdrop. */}
          <button onClick={onStart}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-base font-semibold text-primary-foreground shadow-lg shadow-primary/20 active:opacity-90">
            <Ruler className="w-5 h-5" />
            Draw my reference line
          </button>
        </div>
      </div>
    </div>
  );
}
