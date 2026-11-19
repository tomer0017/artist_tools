import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'use-intl';
import type { ToolId } from '@/lib/account';
import { useProject } from '@/hooks/useProjectStore';
import { handOff } from '@/hooks/useLearnHandoff';
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

export function useToolHandoff() {
  const router = useRouter();
  const t = useTranslations('learn.item');
  const { image, gridImage, imageLearnItem, gridImageLearnItem, setImage, setGridImage } = useProject();
  const allowed = useToolAllowed();
  const [busy, setBusy] = useState<ToolId | null>(null);
  const [confirming, setConfirming] = useState<{ tool: ToolId; item: OpenItem } | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    async (tool: ToolId, item: OpenItem, confirmed = false) => {
      setError(null);
      const reference = item.references[0];
      // Nothing to hand over (no reference, or Color & Mixing), or a tool the plan
      // does not include (it opens on its locked page): just open the tool.
      if (!reference || tool === 'color' || !allowed(tool)) {
        router.push(pathForView(tool));
        return;
      }
      if (!confirmed && replacesPicture(tool, item.id)) {
        setConfirming({ tool, item });
        return;
      }
      setConfirming(null);
      setBusy(tool);
      try {
        const picture = await referenceDataUrl(reference.assetId);
        if (tool === 'measure') setImage(picture, item.id);
        else if (tool === 'grid') setGridImage(picture, item.id);
        else handOff({ tool, image: picture, learnItem: item.id });
        router.push(pathForView(tool));
      } catch (failure) {
        setError(failure instanceof LearnRequestError && failure.status === 403 ? t('handoffLocked') : t('handoffFailed'));
      } finally {
        setBusy(null);
      }
    },
    [allowed, replacesPicture, router, setGridImage, setImage, t],
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
