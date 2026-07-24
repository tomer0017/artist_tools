import { useCallback } from 'react';
import { Upload, Image as ImageIcon } from 'lucide-react';

interface Props {
  onImageLoad: (dataUrl: string) => void;
  compact?: boolean;
  disabled?: boolean;
  onUploadStart?: () => void;
  onUploadError?: (message: string) => void;
  /** When set (with `compact`), render a labelled pill instead of an icon-only button. */
  label?: string;
  /** Optional custom leading icon for the labelled/compact button. */
  icon?: React.ReactNode;
}

export default function ImageUploader({ onImageLoad, compact, disabled, onUploadStart, onUploadError, label, icon }: Props) {
  const handleFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) {
      onUploadError?.('Unsupported file type. Please choose an image.');
      return;
    }
    // Signal loading immediately — before FileReader/decoding work begins.
    onUploadStart?.();
    try {
      const reader = new FileReader();
      reader.onload = (e) => {
        if (e.target?.result) onImageLoad(e.target.result as string);
      };
      reader.onerror = (e) => {
        console.error('[ImageUploader] FileReader failed to read image file:', e);
        onUploadError?.('Failed to read image file.');
      };
      reader.readAsDataURL(file);
    } catch (error) {
      console.error('[ImageUploader] Failed to start reading image file:', error);
      onUploadError?.('Failed to read image file.');
    }
  }, [onImageLoad, onUploadStart, onUploadError]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleClick = useCallback(() => {
    if (disabled) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    // iOS Safari requires the input to be in the DOM for `.click()` to fire
    // the picker and for `onchange` to dispatch reliably.
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    input.style.top = '0';
    input.style.opacity = '0';

    // Cancelling the picker is a normal action — it must always tear down
    // cleanly (no lingering hidden input, no stuck state), whether the browser
    // reports it via `change` (no file), the native `cancel` event, or only by
    // returning focus. Guarded so teardown runs exactly once.
    let settled = false;
    const teardown = () => {
      if (settled) return;
      settled = true;
      window.removeEventListener('focus', onFocus);
      if (input.parentNode) input.parentNode.removeChild(input);
    };
    const onFocus = () => {
      window.setTimeout(() => {
        if (!settled && !(input.files && input.files.length)) teardown();
      }, 500);
    };

    input.onchange = () => {
      const file = input.files?.[0];
      teardown();
      if (file) handleFile(file);
    };
    input.addEventListener('cancel', teardown);

    document.body.appendChild(input);
    window.addEventListener('focus', onFocus);
    input.click();
  }, [handleFile, disabled]);

  if (compact) {
    // Labelled pill (e.g. "Upload Image" / "Replace Image") when a label is given;
    // otherwise the original icon-only tool button.
    if (label) {
      return (
        <button onClick={handleClick} disabled={disabled} title={label}
          className={`flex items-center gap-1.5 rounded-lg border border-border bg-card/95 px-3 py-2 text-xs font-medium text-foreground shadow-sm active:scale-95 transition-transform ${disabled ? 'opacity-40 pointer-events-none' : ''}`}>
          {icon ?? <Upload className="w-4 h-4" />}
          <span>{label}</span>
        </button>
      );
    }
    return (
      <button onClick={handleClick} className={`btn-tool ${disabled ? 'opacity-40 pointer-events-none' : ''}`} title="Upload image" disabled={disabled}>
        {icon ?? <Upload className="w-4 h-4" />}
      </button>
    );
  }

  return (
    <div
      onClick={disabled ? undefined : handleClick}
      onDrop={disabled ? undefined : handleDrop}
      onDragOver={(e) => e.preventDefault()}
      className={`flex flex-col items-center justify-center gap-4 p-12 border-2 border-dashed border-border rounded-lg cursor-pointer transition-colors hover:border-primary/50 hover:bg-secondary/30 animate-fade-in ${disabled ? 'opacity-50 pointer-events-none' : ''}`}
    >
      <div className="w-16 h-16 rounded-full bg-secondary flex items-center justify-center">
        <ImageIcon className="w-7 h-7 text-muted-foreground" />
      </div>
      <div className="text-center">
        <p className="text-sm font-medium text-foreground">Drop an image here or click to upload</p>
        <p className="text-xs text-muted-foreground mt-1">PNG, JPG, WEBP supported</p>
      </div>
    </div>
  );
}
