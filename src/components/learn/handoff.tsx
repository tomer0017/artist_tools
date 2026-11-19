import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'use-intl';
import type { ToolId } from '@/lib/account';
import type { ToolPreset } from '@/lib/learn/model';
import { useProject } from '@/hooks/useProjectStore';
import { handOff } from '@/hooks/useLearnHandoff';
import { setLearnReturn, type LearnReturn } from '@/hooks/useLearnReturn';
import { loadSession as loadCompareSession } from '@/features/compare-art/compareArtStorage';
import { useToolAllowed } from '@/components/shell/account';
import { pathForView } from '@/components/shell/tools';
import { LearnRequestError, referenceDataUrl, type OpenItem } from './data';
import { buttonPrimary, buttonSecondary } from './parts';

// Tool shortcuts (S3: "Open in Create a Grid"): the tool opens with the item's
// reference already in it, nothing uploaded. The picture is fetched from the
// authorized route (so a reference no longer open is refused here too) and
// stays on this device, marked with the item's ID: whatever is saved from it
// asks the server whether that item is still open (ADR-0018). A photo already
// open in the tool is replaced only after asking. No tool code is duplicated:
// Measure and Create a Grid take it through the project store, Study &
// Simplify and Compare & Correct when they open (src/hooks/useLearnHandoff.ts).
//
// From a lesson's step (ADR-0019), a link can also set the tool the way the
// step needs it, as if the person had chosen it: Study's values (3, 5 …) or
// Create a Grid's columns and rows. Nothing else in the tool changes. The tool
// then shows the way back to the lesson (src/components/learn/ReturnBar.tsx).

export interface HandoffOptions {
  preset?: ToolPreset;
  /** Where "Back to …" leads from the tool. */
  back?: LearnReturn;
}

export function useToolHandoff() {
  const router = useRouter();
  const t = useTranslations('learn.item');
  const { image, gridImage, imageLearnItem, gridImageLearnItem, setImage, setGridImage, setValueSettings, setGridSettings } = useProject();
  const allowed = useToolAllowed();
  const [busy, setBusy] = useState<ToolId | null>(null);
  const [confirming, setConfirming] = useState<{ tool: ToolId; item: OpenItem; options: HandoffOptions } | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** A step's preset, set as if chosen in the tool: only what the tool has, and only for that tool. */
  const applyPreset = useCallback(
    (tool: ToolId, preset: ToolPreset | undefined) => {
      if (!preset) return;
      if (tool === 'value' && preset.levels !== undefined)
        setValueSettings({ mode: 'grayscale', grayscale: true, levels: preset.levels, posterize: preset.levels, ...(preset.squint !== undefined ? { focus: preset.squint ? 'squint' : 'none' } : {}) });
      if (tool === 'grid' && preset.columns !== undefined && preset.rows !== undefined) setGridSettings({ cellMode: 'divisions', columns: preset.columns, rows: preset.rows });
    },
    [setGridSettings, setValueSettings],
  );

  /** Would handing over replace a picture the person has open in that tool (other than this very reference)? */
  const replacesPicture = useCallback(
    (tool: ToolId, itemId: string): boolean => {
      if (tool === 'measure') return image !== null && imageLearnItem !== itemId;
      if (tool === 'grid') return gridImage !== null && gridImageLearnItem !== itemId;
      if (tool === 'compare') {
        const { session } = loadCompareSession();
        return session.reference !== null && session.referenceLearnItem !== itemId;
      }
      // Study keeps a reference of its own only for the visit; the shared picture is left as it is.
      return false;
    },
    [image, gridImage, imageLearnItem, gridImageLearnItem],
  );

  const open = useCallback(
    async (tool: ToolId, item: OpenItem, options: HandoffOptions = {}, confirmed = false) => {
      setError(null);
      const reference = item.references[0];
      const go = () => {
        if (options.back) setLearnReturn(options.back);
        router.push(pathForView(tool));
      };
      // A tool the plan does not include opens on its locked page: nothing is set or handed over.
      if (!allowed(tool)) {
        go();
        return;
      }
      // Nothing to hand over (no reference, or Color & Mixing): open the tool, as the step sets it.
      if (!reference || tool === 'color') {
        applyPreset(tool, options.preset);
        go();
        return;
      }
      if (!confirmed && replacesPicture(tool, item.id)) {
        setConfirming({ tool, item, options });
        return;
      }
      setConfirming(null);
      setBusy(tool);
      try {
        const picture = await referenceDataUrl(reference.assetId);
        if (tool === 'measure') setImage(picture, item.id);
        else if (tool === 'grid') setGridImage(picture, item.id);
        else handOff({ tool, image: picture, learnItem: item.id });
        applyPreset(tool, options.preset);
        go();
      } catch (failure) {
        setError(failure instanceof LearnRequestError && failure.status === 403 ? t('handoffLocked') : t('handoffFailed'));
      } finally {
        setBusy(null);
      }
    },
    [allowed, applyPreset, replacesPicture, router, setGridImage, setImage, t],
  );

  return { open, busy, error, confirming, cancel: () => setConfirming(null) };
}

/** "Replace the photo in Create a Grid?" — asked before a reference takes the place of the person's own photo. */
export function ReplaceDialog({ toolName, onReplace, onCancel }: { toolName: string; onReplace: () => void; onCancel: () => void }) {
  const t = useTranslations('learn.item');
  return (
    <div className="fixed inset-0 z-[65] flex items-end justify-center sm:items-center">
      <button type="button" className="absolute inset-0 bg-black/60" aria-label={t('cancel')} tabIndex={-1} onClick={onCancel} />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="learn-replace-title"
        aria-describedby="learn-replace-body"
        className="relative z-10 w-full max-w-md rounded-t-2xl border-t border-border bg-card p-5 pb-[calc(env(safe-area-inset-bottom)+20px)] shadow-2xl sm:rounded-2xl sm:border sm:pb-5"
      >
        <p id="learn-replace-title" className="text-base font-semibold text-foreground">
          {t('replaceTitle', { tool: toolName })}
        </p>
        <p id="learn-replace-body" className="mt-1 text-sm leading-relaxed text-muted-foreground">
          {t('replaceBody')}
        </p>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row-reverse">
          <button type="button" autoFocus onClick={onReplace} className={`${buttonPrimary} flex-1`}>
            {t('replace')}
          </button>
          <button type="button" onClick={onCancel} className={`${buttonSecondary} flex-1`}>
            {t('cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}
