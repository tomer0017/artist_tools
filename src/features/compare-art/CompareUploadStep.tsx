// Compare Art — empty / one-image state.
//
// Two clearly-labelled slots so it is always obvious which image is the artwork
// (the painting) and which is the reference. Picking an image opens the crop
// screen first (via onRequestCrop) so the painter can frame the region to
// compare before the workspace opens. The comparison canvas only opens once
// BOTH cropped images exist; a single loaded image is preserved if the painter
// leaves and returns.

import { useState } from 'react';
import { Camera, Crop, ImagePlus, RefreshCw, Check } from 'lucide-react';
import { useCompare } from './compareArtState';
import { openImagePicker, ImagePickError } from './compareArtImage';
import { ImageCrop } from './compareArtTypes';

interface SlotProps {
  role: 'artwork' | 'reference';
  titleEn: string;
  titleHe: string;
  hint: string;
  dataUrl: string | null;
  original: string | null;
  crop: ImageCrop | null;
  onRequestCrop: (role: 'artwork' | 'reference', original: string, initialCrop?: ImageCrop | null) => void;
}

function UploadSlot({ role, titleEn, titleHe, hint, dataUrl, original, crop, onRequestCrop }: SlotProps) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pick = async (capture: boolean) => {
    setError(null);
    setBusy(true);
    try {
      const res = await openImagePicker(capture);
      if (res) onRequestCrop(role, res.dataUrl, null);
    } catch (e) {
      setError(e instanceof ImagePickError ? e.message : 'Could not load image.');
    } finally {
      setBusy(false);
    }
  };

  const accent = role === 'artwork' ? 'primary' : 'blue';
  return (
    <div
      className={`relative flex flex-col rounded-2xl border-2 p-4 transition-colors ${
        dataUrl ? 'border-border bg-card' : 'border-dashed border-border bg-card/40'
      }`}
    >
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-foreground flex items-center gap-1.5">
            <span
              className={`inline-block h-2.5 w-2.5 rounded-full ${
                accent === 'primary' ? 'bg-primary' : 'bg-blue-500'
              }`}
            />
            {titleEn}
          </p>
          <p className="text-[11px] text-muted-foreground" dir="rtl">{titleHe}</p>
        </div>
        {dataUrl && <Check className="h-4 w-4 text-green-500" aria-label="Loaded" />}
      </div>

      {dataUrl ? (
        <div className="space-y-2">
          <div className="relative overflow-hidden rounded-lg bg-black/30">
            <img
              src={dataUrl}
              alt={`${titleEn} thumbnail`}
              className="mx-auto max-h-40 w-auto object-contain"
            />
            <button
              onClick={() => pick(false)}
              disabled={busy}
              className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-card/95 px-2.5 py-1.5 text-[11px] font-medium text-foreground shadow active:scale-95"
            >
              <RefreshCw className="h-3 w-3" /> Replace
            </button>
          </div>
          <button
            onClick={() => onRequestCrop(role, original ?? dataUrl, crop)}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-secondary px-3 py-2 text-xs font-medium text-foreground active:scale-95"
          >
            <Crop className="h-3.5 w-3.5" /> Edit crop
          </button>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center gap-3 py-6">
          <p className="text-center text-xs text-muted-foreground">{hint}</p>
          <div className="flex gap-2">
            <button
              onClick={() => pick(false)}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-lg bg-secondary px-3 py-2 text-xs font-medium text-foreground active:scale-95 disabled:opacity-50"
            >
              <ImagePlus className="h-4 w-4" /> Choose
            </button>
            <button
              onClick={() => pick(true)}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-lg bg-secondary px-3 py-2 text-xs font-medium text-foreground active:scale-95 disabled:opacity-50"
              title="Camera (mobile)"
            >
              <Camera className="h-4 w-4" /> Camera
            </button>
          </div>
        </div>
      )}
      {error && <p className="mt-2 text-[11px] text-destructive">{error}</p>}
    </div>
  );
}

interface Props {
  onRequestCrop: (role: 'artwork' | 'reference', original: string, initialCrop?: ImageCrop | null) => void;
}

export default function CompareUploadStep({ onRequestCrop }: Props) {
  const store = useCompare();
  const { session } = store;

  const needBoth = !session.artwork || !session.reference;

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6">
      <div className="mx-auto max-w-md">
        <h2 className="text-lg font-semibold text-foreground">Compare Art</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Compare proportions, values, and colors by aligning your reference over your painting.
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground" dir="rtl">
          השוואת ציור — יישרו את הרפרנס מעל הציור כדי להשוות פרופורציות, ערכים וצבע.
        </p>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Tip: crop each image to the region you want to compare (an eye, the nose, a hand).
        </p>

        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <UploadSlot
            role="artwork"
            titleEn="Artwork"
            titleHe="הציור שלי"
            hint="A photo of your current physical painting."
            dataUrl={session.artwork}
            original={session.artworkOriginal}
            crop={session.artworkCrop}
            onRequestCrop={onRequestCrop}
          />
          <UploadSlot
            role="reference"
            titleEn="Reference"
            titleHe="רפרנס"
            hint="The original reference image."
            dataUrl={session.reference}
            original={session.referenceOriginal}
            crop={session.referenceCrop}
            onRequestCrop={onRequestCrop}
          />
        </div>

        {store.imagesDropped && (
          <div className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-[11px] text-amber-300">
            Your previous settings were restored, but the images were too large to save.
            Please re-select them to continue.
          </div>
        )}

        {needBoth && (
          <p className="mt-4 text-center text-xs text-muted-foreground">
            {session.artwork || session.reference
              ? 'Add the second image to open the comparison.'
              : 'Add both images to begin.'}
          </p>
        )}
      </div>
    </div>
  );
}
