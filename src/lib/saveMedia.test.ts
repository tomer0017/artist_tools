import { describe, expect, it, vi } from 'vitest';
import {
  canShareFile,
  downloadBlob,
  extForMime,
  isGif,
  makeShareFile,
  mimeForFilename,
  shareFile,
} from './saveMedia';

function pngFile(name = 'x.png') {
  return makeShareFile(new Blob(['x'], { type: 'image/png' }), name, 'image/png');
}

describe('saveMedia — MIME + filename', () => {
  it('infers MIME from the filename extension', () => {
    expect(mimeForFilename('a.png')).toBe('image/png');
    expect(mimeForFilename('a.gif')).toBe('image/gif');
    expect(mimeForFilename('a.jpg')).toBe('image/jpeg');
    expect(mimeForFilename('a.jpeg')).toBe('image/jpeg');
    expect(mimeForFilename('a.unknown')).toBe('application/octet-stream');
  });

  it('maps MIME back to a canonical extension', () => {
    expect(extForMime('image/png')).toBe('png');
    expect(extForMime('image/gif')).toBe('gif');
    expect(extForMime('image/jpeg')).toBe('jpg');
  });

  it('flags GIFs', () => {
    expect(isGif('image/gif')).toBe(true);
    expect(isGif('image/png')).toBe(false);
  });

  it('builds a File with the correct name and MIME', () => {
    const f = makeShareFile(new Blob(['x']), 'compare.gif', 'image/gif');
    expect(f.name).toBe('compare.gif');
    expect(f.type).toBe('image/gif');
  });
});

describe('saveMedia — canShareFile', () => {
  it('is true when the platform can share the file', () => {
    const nav = { share: vi.fn(), canShare: vi.fn(() => true) } as unknown as Navigator;
    expect(canShareFile(pngFile(), nav)).toBe(true);
  });

  it('is false when Web Share (files) is unsupported', () => {
    expect(canShareFile(pngFile(), {} as Navigator)).toBe(false);
    const noFiles = { share: vi.fn(), canShare: vi.fn(() => false) } as unknown as Navigator;
    expect(canShareFile(pngFile(), noFiles)).toBe(false);
  });

  it('is false when canShare throws', () => {
    const nav = { share: vi.fn(), canShare: () => { throw new Error('boom'); } } as unknown as Navigator;
    expect(canShareFile(pngFile(), nav)).toBe(false);
  });
});

describe('saveMedia — shareFile', () => {
  it('shares the FILE ONLY (no title/text/url) and reports success', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const nav = { share, canShare: vi.fn(() => true) } as unknown as Navigator;
    const file = pngFile();
    const result = await shareFile(file, nav);
    expect(result).toBe('shared');
    expect(share).toHaveBeenCalledTimes(1);
    // Exactly { files: [file] } — nothing else.
    expect(share).toHaveBeenCalledWith({ files: [file] });
    expect(Object.keys(share.mock.calls[0][0])).toEqual(['files']);
  });

  it('reports "cancelled" when the user dismisses the sheet (AbortError)', async () => {
    const err = new Error('cancelled');
    err.name = 'AbortError';
    const nav = { share: vi.fn().mockRejectedValue(err), canShare: vi.fn(() => true) } as unknown as Navigator;
    expect(await shareFile(pngFile(), nav)).toBe('cancelled');
  });

  it('reports "error" on a real share failure', async () => {
    const nav = { share: vi.fn().mockRejectedValue(new Error('nope')), canShare: vi.fn(() => true) } as unknown as Navigator;
    expect(await shareFile(pngFile(), nav)).toBe('error');
  });

  it('reports "unsupported" when the Web Share API is missing', async () => {
    expect(await shareFile(pngFile(), {} as Navigator)).toBe('unsupported');
  });
});

describe('saveMedia — downloadBlob', () => {
  it('creates and revokes an object URL', () => {
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    vi.useFakeTimers();
    downloadBlob(new Blob(['x'], { type: 'image/png' }), 'x.png');
    expect(create).toHaveBeenCalledTimes(1);
    vi.runAllTimers();
    expect(revoke).toHaveBeenCalledWith('blob:mock');
    vi.useRealTimers();
    create.mockRestore();
    revoke.mockRestore();
    click.mockRestore();
  });
});
