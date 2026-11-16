import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONTROLS, type SketchControls, type SketchStyle } from '@/lib/sketch/styles';
import type { SketchView } from '@/lib/sketch/protocol';
import { useSketchDrawing } from './useSketchDrawing';

// The hook against the real worker handler (run in-process by FakeWorker) and
// the real client; only the browser pieces (Worker, image decoding, canvas)
// are replaced.

const state = vi.hoisted(() => ({
  workers: [] as { received: { kind: string }[]; terminated: boolean }[],
  log: [] as string[],
  photo: { width: 64, height: 48 },
  encodeInWorker: true,
  encodeDelay: 0,
  encodeCalls: 0,
}));

vi.mock('@/lib/sketch/browser', async () => {
  const { FakeWorker, testPicture } = await import('@/lib/sketch/testing');
  const { DESKTOP_LIMITS } = await import('@/lib/sketch/sizing');
  return {
    spawnSketchWorker: () => {
      const worker = new FakeWorker(state.encodeInWorker);
      const index = state.workers.length;
      const post = worker.postMessage.bind(worker);
      worker.postMessage = (message) => {
        state.log.push(`${index}:${message.kind}`);
        post(message);
      };
      state.workers.push(worker);
      return worker;
    },
    isConstrainedDevice: () => false,
    // Tiny limits keep the real engine fast here: 64 × 48 on screen, 96 × 72 saved.
    sketchLimits: () => ({ ...DESKTOP_LIMITS, previewPixels: 64 * 48, previewSide: 64, pencilExportPixels: 96 * 72 }),
    decodeImage: async () => ({ naturalWidth: state.photo.width, naturalHeight: state.photo.height }),
    readPixels: (_img: unknown, size: { width: number; height: number }) => testPicture(size.width, size.height),
    encodePng: async () => {
      state.encodeCalls++;
      await new Promise((r) => setTimeout(r, state.encodeDelay));
      return new Blob(['page']);
    },
    pathsToPng: async () => new Blob(['vector png']),
  };
});

interface Props {
  enabled: boolean;
  image: string | null;
  style: SketchStyle;
  controls: SketchControls;
  view: SketchView;
}

const blobs = new Map<string, Blob>();
let urls = 0;
const revoked: string[] = [];

beforeEach(() => {
  state.workers.length = 0;
  state.log.length = 0;
  state.photo = { width: 64, height: 48 };
  state.encodeInWorker = true;
  state.encodeDelay = 0;
  state.encodeCalls = 0;
  blobs.clear();
  revoked.length = 0;
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
    const url = `blob:test/${++urls}`;
    blobs.set(url, blob as Blob);
    return url;
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url) => {
    revoked.push(url);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const start: Props = { enabled: true, image: 'data:image/png;base64,AAAA', style: 'outline', controls: DEFAULT_CONTROLS, view: 'drawing' };
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** A blob's text (jsdom's Blob has no .text()). */
const readText = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
/** What the worker drew for the image on screen (the stand-in PNG names its settings). */
const drawn = async (url: string | null) => (url ? readText(blobs.get(url)!) : null);

describe('useSketchDrawing', () => {
  it('draws the photo, and redraws when a control changes', async () => {
    const { result, rerender } = renderHook((p: Props) => useSketchDrawing(p), { initialProps: start });
    await waitFor(() => expect(result.current.url).not.toBeNull());
    expect(result.current.shown).toEqual({ style: 'outline', view: 'drawing' });
    expect(result.current.working).toEqual({ width: 64, height: 48 });
    const first = result.current.url;
    rerender({ ...start, controls: { ...DEFAULT_CONTROLS, detail: 80 } });
    await waitFor(() => expect(result.current.url).not.toBe(first));
    expect(await drawn(result.current.url)).toContain('"detail":80');
    expect(revoked).toContain(first);
    await waitFor(() => expect(result.current.busy).toBe(false));
  });

  it('switching style and straight back keeps the drawing on screen: a late result for the other style never replaces it', async () => {
    const { result, rerender } = renderHook((p: Props) => useSketchDrawing(p), { initialProps: start });
    await waitFor(() => expect(result.current.url).not.toBeNull());
    const outline = result.current.url;
    rerender({ ...start, style: 'pencil' });
    rerender({ ...start, style: 'outline' });
    // The Pencil render had already been sent; let it finish and arrive.
    await waitFor(() => expect(state.workers[0].received.filter((m) => m.kind === 'render')).toHaveLength(2));
    await pause(150);
    expect(result.current.url).toBe(outline);
    expect(result.current.shown).toEqual({ style: 'outline', view: 'drawing' });
    expect(await drawn(result.current.url)).toMatch(/^outline\|drawing/);
    expect(result.current.busy).toBe(false);
  });

  it('a new photo never shows the old photo’s drawing, not even for one frame', async () => {
    const seen: { image: string | null; url: string | null }[] = [];
    const { result, rerender } = renderHook(
      (p: Props) => {
        const r = useSketchDrawing(p);
        seen.push({ image: p.image, url: r.url });
        return r;
      },
      { initialProps: start },
    );
    await waitFor(() => expect(result.current.url).not.toBeNull());
    const old = result.current.url;
    rerender({ ...start, image: 'data:image/png;base64,BBBB' });
    await waitFor(() => expect(result.current.url).not.toBeNull());
    expect(result.current.url).not.toBe(old);
    expect(seen.filter((s) => s.image === 'data:image/png;base64,BBBB').map((s) => s.url)).not.toContain(old);
  });

  it('closing the tool stops the worker and creates no image afterwards, even mid-encode on the page', async () => {
    state.encodeInWorker = false;
    // Long enough that the unmount below surely lands while the page is
    // still encoding the second drawing.
    state.encodeDelay = 300;
    const { result, rerender, unmount } = renderHook((p: Props) => useSketchDrawing(p), { initialProps: start });
    await waitFor(() => expect(result.current.url).not.toBeNull());
    rerender({ ...start, controls: { ...DEFAULT_CONTROLS, detail: 70 } });
    await waitFor(() => expect(state.encodeCalls).toBe(2));
    const made = urls;
    unmount();
    await pause(450);
    expect(urls).toBe(made);
    expect(state.workers[0].terminated).toBe(true);
    expect(revoked).toContain(result.current.url);
  });

  it('a large Pencil save frees the on-screen caches first and holds on-screen renders until it is done', async () => {
    state.photo = { width: 400, height: 300 };
    const props: Props = { ...start, style: 'pencil' };
    const { result, rerender } = renderHook((p: Props) => useSketchDrawing(p), { initialProps: props });
    await waitFor(() => expect(result.current.url).not.toBeNull());
    const saving = result.current.savePng();
    rerender({ ...props, controls: { ...DEFAULT_CONTROLS, shading: 80 } });
    const saved = await saving;
    expect(saved?.size).toEqual({ width: 96, height: 72 });
    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(await drawn(result.current.url)).toContain('"shading":80');
    // Order of what the workers received: free the caches, export in a second
    // worker (then shut down), and only then the on-screen render.
    const release = state.log.indexOf('0:release');
    const exported = state.log.indexOf('1:export');
    const shading = state.log.lastIndexOf('0:render');
    expect(release).toBeGreaterThan(-1);
    expect(exported).toBeGreaterThan(release);
    expect(shading).toBeGreaterThan(exported);
    expect(state.workers[1].terminated).toBe(true);
  });

  it('a Clean Outline save is drawn from the vector paths; the SVG is for Clean Outline only', async () => {
    const { result, rerender } = renderHook((p: Props) => useSketchDrawing(p), { initialProps: start });
    await waitFor(() => expect(result.current.url).not.toBeNull());
    const png = await result.current.savePng();
    expect(await readText(png!.blob)).toBe('vector png');
    const svg = await result.current.saveSvg();
    expect(svg?.type).toBe('image/svg+xml');
    expect(await readText(svg!)).toMatch(/^<svg /);
    rerender({ ...start, style: 'pencil' });
    await waitFor(() => expect(result.current.shown?.style).toBe('pencil'));
    expect(await result.current.saveSvg()).toBeNull();
  });
});
