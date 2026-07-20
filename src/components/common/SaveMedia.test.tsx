import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SaveMediaProvider, useSaveMedia } from './SaveMedia';

function Harness({ filename, mime }: { filename: string; mime?: string }) {
  const { save } = useSaveMedia();
  return (
    <button
      onClick={() => save({ blob: new Blob(['x'], { type: mime ?? 'image/png' }), filename, mime })}
    >
      generate
    </button>
  );
}

function setNavigator(props: Partial<{ userAgent: string; canShare: unknown; share: unknown; maxTouchPoints: number }>) {
  Object.entries(props).forEach(([key, value]) => {
    Object.defineProperty(window.navigator, key, { value, configurable: true });
  });
}

let urlCounter = 0;

beforeEach(() => {
  urlCounter = 0;
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:mock-${++urlCounter}`);
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  setNavigator({ userAgent: 'test', canShare: undefined, share: undefined, maxTouchPoints: 0 });
});

describe('SaveMedia sheet', () => {
  it('renders the ACTUAL media (object URL of the blob), not a generic icon', () => {
    setNavigator({ userAgent: 'Desktop', canShare: undefined, share: undefined });
    render(
      <SaveMediaProvider>
        <Harness filename="value-study.png" mime="image/png" />
      </SaveMediaProvider>,
    );
    fireEvent.click(screen.getByText('generate'));
    const img = screen.getByAltText('Image preview') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('blob:mock-1');
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  });

  it('revokes the object URL when the sheet is closed', () => {
    setNavigator({ userAgent: 'Desktop' });
    render(
      <SaveMediaProvider>
        <Harness filename="grid.png" />
      </SaveMediaProvider>,
    );
    fireEvent.click(screen.getByText('generate'));
    fireEvent.click(screen.getByLabelText('Close'));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-1');
  });

  it('on desktop (no Web Share) shows a download-style Save label', () => {
    setNavigator({ userAgent: 'Desktop', canShare: undefined, share: undefined });
    render(
      <SaveMediaProvider>
        <Harness filename="compare.gif" mime="image/gif" />
      </SaveMediaProvider>,
    );
    fireEvent.click(screen.getByText('generate'));
    // GIF wording, download primary (not "Save to Photos").
    expect(screen.getByRole('button', { name: 'Save GIF' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save to Photos' })).toBeNull();
  });

  it('on iOS with Web Share shows "Save to Photos" and shares the file only', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    setNavigator({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      canShare: () => true,
      share,
    });
    render(
      <SaveMediaProvider>
        <Harness filename="compare.png" mime="image/png" />
      </SaveMediaProvider>,
    );
    fireEvent.click(screen.getByText('generate'));

    // Guidance text (EN) present.
    expect(screen.getByText(/choose Save Image/i)).toBeInTheDocument();

    const btn = screen.getByRole('button', { name: 'Save to Photos' });
    fireEvent.click(btn);

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    // Files only — no title/text/url.
    const arg = share.mock.calls[0][0];
    expect(Object.keys(arg)).toEqual(['files']);
    expect(arg.files[0].name).toBe('compare.png');
    expect(arg.files[0].type).toBe('image/png');

    // Success closes the sheet and revokes the URL.
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Save to Photos' })).toBeNull());
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-1');
  });

  it('opens the full-screen long-press fallback with instructions', () => {
    setNavigator({ userAgent: 'Desktop' });
    render(
      <SaveMediaProvider>
        <Harness filename="grid.png" />
      </SaveMediaProvider>,
    );
    fireEvent.click(screen.getByText('generate'));
    fireEvent.click(screen.getByRole('button', { name: 'Open Image' }));
    expect(screen.getByText(/Press and hold the image/i)).toBeInTheDocument();
  });
});
