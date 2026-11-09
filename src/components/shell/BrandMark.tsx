import { Layers } from 'lucide-react';

// The Studio Companion logo and wordmark. Has no state, so it renders the same
// on the server (landing page) and inside the studio.
export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <Layers className={compact ? 'h-6 w-6 text-primary' : 'h-7 w-7 text-primary'} strokeWidth={2.2} aria-hidden="true" />
      <span className={`font-semibold leading-[1.05] tracking-tight text-foreground ${compact ? 'text-sm' : 'text-[15px]'}`}>
        Studio<br />Companion
      </span>
    </span>
  );
}
