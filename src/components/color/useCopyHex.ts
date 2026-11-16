import { useCallback, useEffect, useRef, useState } from 'react';

// Copying a colour code, with feedback: which swatch was copied (or failed to
// copy) stays known for a moment, so it can show a check mark and a status
// message can be read out.

/** How long a swatch shows "Copied". */
export const COPIED_MS = 1600;

export interface CopyResult {
  /** Which control copied: one swatch ("triadic:1") or the selected colour ("selected"). */
  key: string;
  hex: string;
  ok: boolean;
}

/**
 * Puts text on the clipboard: the Clipboard API, or the older copy command
 * where that API is missing or refused (a page served over plain http, an
 * older browser). True when the text was copied.
 */
export async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (error) {
    console.warn('[ColorTab] Clipboard copy failed:', error);
  }
  return copyWithSelection(text);
}

function copyWithSelection(text: string): boolean {
  if (typeof document.execCommand !== 'function') return false;
  const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.top = '0';
  field.style.opacity = '0';
  document.body.appendChild(field);
  try {
    field.select();
    field.setSelectionRange(0, text.length);
    return document.execCommand('copy');
  } catch (error) {
    console.warn('[ColorTab] Clipboard copy failed:', error);
    return false;
  } finally {
    field.remove();
    focused?.focus({ preventScroll: true });
  }
}

export function useCopyHex() {
  const [copied, setCopied] = useState<CopyResult | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const latest = useRef(0);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = useCallback(async (hex: string, key: string) => {
    const run = ++latest.current;
    const ok = await writeClipboard(hex);
    if (run !== latest.current) return; // a later copy has replaced this one
    setCopied({ key, hex, ok });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(null), COPIED_MS);
  }, []);

  return { copied, copy };
}
