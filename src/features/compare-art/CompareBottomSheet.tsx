// Compare Art — generic mobile-first bottom sheet.
//
// Slides up from the bottom, leaves the comparison canvas visible above it, and
// caps its own height so the important image area is never fully covered.

import { ReactNode } from 'react';
import { X } from 'lucide-react';

interface Props {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  /** Extra actions rendered in the header (right side). */
  headerAction?: ReactNode;
  /**
   * Collapse to a slim header-only strip. Used to get the sheet out of the way
   * while the painter is actively dragging on the canvas, then restore it.
   */
  collapsed?: boolean;
  /** Cap the expanded height (viewport %). Defaults to 60. */
  maxVh?: number;
}

export default function CompareBottomSheet({
  open,
  title,
  subtitle,
  onClose,
  children,
  headerAction,
  collapsed = false,
  maxVh = 60,
}: Props) {
  if (!open) return null;
  return (
    <div
      className="absolute inset-x-0 bottom-0 z-30 overflow-hidden rounded-t-2xl border-t border-border bg-card/98 shadow-2xl backdrop-blur-sm transition-[max-height] duration-150 animate-in slide-in-from-bottom"
      style={{ maxHeight: collapsed ? '3.5rem' : `${maxVh}vh` }}
      role="dialog"
      aria-label={title}
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-foreground">{title}</p>
          {subtitle && !collapsed && <p className="text-[11px] text-muted-foreground">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-2">
          {headerAction}
          <button
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary text-muted-foreground active:scale-95"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      {!collapsed && (
        <div className="overflow-y-auto px-4 py-3" style={{ maxHeight: `calc(${maxVh}vh - 60px)` }}>
          {children}
        </div>
      )}
    </div>
  );
}
