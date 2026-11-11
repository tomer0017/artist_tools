// Compare Art — empty / one-image state.
//
// Two clearly-labelled slots so it is always obvious which image is the artwork
// (the painting) and which is the reference. Picking an image opens the crop
// screen first (via onRequestCrop) so the painter can frame the region to
// compare before the workspace opens. The comparison canvas only opens once
// BOTH cropped images exist; a single loaded image is preserved if the painter
// leaves and returns.
//
// The slots are a physical arrangement of the two images (artwork on the left,
// reference on the right, as in the comparison itself), so their row stays
// left to right in every language; each slot's own text follows the page.

import { useState } from 'react';
import { useLocale, useTranslations } from 'use-intl';
import { ArrowRight, Camera, Crop, ImagePlus, RefreshCw, Check } from 'lucide-react';
import { dirOf } from '@/i18n/config';
import { useCompare } from './compareArtState';
import { openImagePicker, ImagePickError, type ImagePickFailure } from './compareArtImage';
import { ImageCrop } from './compareArtTypes';

interface SlotProps {
  role: 'artwork' | 'reference';
  title: string;
  /** The Hebrew name under the English title (shown on English pages only). */
  titleHe: string;
  hint: string;
  dataUrl: string | null;
  original: string | null;
  crop: ImageCrop | null;
  onRequestCrop: (role: 'artwork' | 'reference', original: string, initialCrop?: ImageCrop | null) => void;
}

function UploadSlot({ role, title, titleHe, hint, dataUrl, original, crop, onRequestCrop }: SlotProps) {
  const t = useTranslations('compareTool');
  const locale = useLocale();
  const [error, setError] = useState<ImagePickFailure | 'other' | null>(null);
  const [busy, setBusy] = useState(false);

  const pick = async (capture: boolean) => {
    setError(null);
    setBusy(true);
    try {
      const res = await openImagePicker(capture);
      if (res) onRequestCrop(role, res.dataUrl, null);
    } catch (e) {
      setError(e instanceof ImagePickError ? e.reason : 'other');
    } finally {
      setBusy(false);
    }
  };

  const accent = role === 'artwork' ? 'primary' : 'blue';
  return (
    <div
      dir={dirOf(locale)}
      className={`relative flex flex-col rounded-2xl border-2 p-3 transition-colors md:p-4 ${
        accent === 'primary' ? 'border-primary/50' : 'border-blue-500/50'
      } ${dataUrl ? 'bg-card' : 'border-dashed bg-card/40'}`}
    >
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-foreground flex items-center gap-1.5">
            <span
              className={`inline-block h-2.5 w-2.5 rounded-full ${
                accent === 'primary' ? 'bg-primary' : 'bg-blue-500'
              }`}
            />
            {title}
          </p>
          {locale === 'en' && <p className="text-[11px] text-muted-foreground" dir="rtl">{titleHe}</p>}
        </div>
        {dataUrl && <Check className="h-4 w-4 text-green-500" aria-label={t('upload.loaded')} />}
      </div>

      {dataUrl ? (
        <div className="space-y-2">
          <div className="relative overflow-hidden rounded-lg bg-black/30">
            <img
              src={dataUrl}
              alt={t('upload.thumbnail', { title })}
              className="mx-auto max-h-40 w-auto object-contain"
            />
            <button
              onClick={() => pick(false)}
              disabled={busy}
              className="absolute end-2 top-2 flex items-center gap-1 rounded-full bg-card/95 px-2.5 py-1.5 text-[11px] font-medium text-foreground shadow active:scale-95"
            >
              <RefreshCw className="h-3 w-3" /> {t('upload.replace')}
            </button>
          </div>
          <button
            onClick={() => onRequestCrop(role, original ?? dataUrl, crop)}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-secondary px-3 py-2 text-xs font-medium text-foreground active:scale-95"
          >
            <Crop className="h-3.5 w-3.5" /> {t('upload.editCrop')}
          </button>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center gap-3 py-3 md:py-6">
          <p className="text-center text-xs text-muted-foreground">{hint}</p>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <button
              onClick={() => pick(false)}
              disabled={busy}
              className="flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg bg-secondary px-3 py-2 text-xs font-medium text-foreground active:scale-95 disabled:opacity-50"
            >
              <ImagePlus className="h-4 w-4" /> {t('upload.choose')}
            </button>
            <button
              onClick={() => pick(true)}
              disabled={busy}
              className="flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg bg-secondary px-3 py-2 text-xs font-medium text-foreground active:scale-95 disabled:opacity-50"
              title={t('upload.cameraHint')}
            >
              <Camera className="h-4 w-4" /> {t('upload.camera')}
            </button>
          </div>
        </div>
      )}
      {error && <p className="mt-2 text-[11px] text-destructive">{t(`upload.errors.${error}`)}</p>}
    </div>
  );
}

interface Props {
  onRequestCrop: (role: 'artwork' | 'reference', original: string, initialCrop?: ImageCrop | null) => void;
  /** Move on to alignment — offered once both images are in. */
  onContinue: () => void;
}

export default function CompareUploadStep({ onRequestCrop, onContinue }: Props) {
  const t = useTranslations('compareTool');
  const locale = useLocale();
  const store = useCompare();
  const { session } = store;

  const needBoth = !session.artwork || !session.reference;

  return (
    <div className="flex flex-1 flex-col min-h-0">
    <div className="flex-1 overflow-y-auto px-4 py-4 md:py-6">
      <div className="mx-auto max-w-2xl">
        <p className="text-sm text-muted-foreground">
          {t('upload.lead')}
        </p>
        {locale === 'en' && (
          <p className="mt-0.5 text-xs text-muted-foreground" dir="rtl">
            השוואת ציור — הוסיפו צילום של הציור ואת הרפרנס.
          </p>
        )}

        <div className="mt-4 grid grid-cols-2 gap-3" dir="ltr">
          <UploadSlot
            role="artwork"
            title={t('upload.artwork')}
            titleHe="הציור שלי"
            hint={t('upload.artworkHint')}
            dataUrl={session.artwork}
            original={session.artworkOriginal}
            crop={session.artworkCrop}
            onRequestCrop={onRequestCrop}
          />
          <UploadSlot
            role="reference"
            title={t('upload.reference')}
            titleHe="רפרנס"
            hint={t('upload.referenceHint')}
            dataUrl={session.reference}
            original={session.referenceOriginal}
            crop={session.referenceCrop}
            onRequestCrop={onRequestCrop}
          />
        </div>

        {store.imagesDropped && (
          <div className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-[11px] text-amber-300">
            {t('upload.imagesDropped')}
          </div>
        )}

      </div>
    </div>
    <div className="shrink-0 border-t border-border bg-card px-4 py-3">
      <div className="mx-auto max-w-2xl">
        <button
          onClick={onContinue}
          disabled={needBoth}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-[15px] font-semibold text-primary-foreground transition-opacity disabled:opacity-40"
        >
          {t('upload.continue')} <ArrowRight className="h-5 w-5 rtl:-scale-x-100" />
        </button>
        {needBoth && (
          <p className="mt-2 text-center text-xs text-muted-foreground">
            {session.artwork || session.reference ? t('upload.addSecond') : t('upload.addBoth')}
          </p>
        )}
      </div>
    </div>
    </div>
  );
}
