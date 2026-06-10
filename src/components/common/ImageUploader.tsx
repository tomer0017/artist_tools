import { useCallback } from 'react';
import { Upload, Image as ImageIcon } from 'lucide-react';

interface Props {
  onImageLoad: (dataUrl: string) => void;
  compact?: boolean;
  disabled?: boolean;
  onUploadStart?: () => void;
  onUploadError?: (message: string) => void;
}

export default function ImageUploader({ onImageLoad, compact, disabled, onUploadStart, onUploadError }: Props) {
  const handleFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) {
      onUploadError?.('Unsupported file type. Please choose an image.');
      return;
    }
    // Signal loading immediately — before FileReader/decoding work begins.
    onUploadStart?.();
    const reader = new FileReader();
    reader.onload = (e) => {
      if (e.target?.result) onImageLoad(e.target.result as string);
    };
    reader.onerror = () => onUploadError?.('Failed to read image file.');
    reader.readAsDataURL(file);
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
    const cleanup = () => {
      if (input.parentNode) input.parentNode.removeChild(input);
    };
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) handleFile(file);
      cleanup();
    };
    document.body.appendChild(input);
    input.click();
    // Safety cleanup if the user cancels (no change event on iOS in that case).
    setTimeout(cleanup, 60_000);
  }, [handleFile, disabled]);

  if (compact) {
    return (
      <button onClick={handleClick} className={`btn-tool ${disabled ? 'opacity-40 pointer-events-none' : ''}`} title="Upload image" disabled={disabled}>
        <Upload className="w-4 h-4" />
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
