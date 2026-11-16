// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { SketchClient, SketchError } from './client';
import { createSketchWorker } from './worker-core';
import type { SketchResponse } from './protocol';
import { DEFAULT_CONTROLS } from './styles';
import { FakeWorker, testPicture } from './testing';

const W = 64;
const H = 48;
const picture = () => testPicture(W, H);

function setup(encode = true) {
  const workers: FakeWorker[] = [];
  const encodeOnPage = vi.fn(async (pixels: Uint8ClampedArray) => new Blob([`page:${pixels.length}`]));
  const client = new SketchClient(() => {
    const worker = new FakeWorker(encode);
    workers.push(worker);
    return worker;
  }, encodeOnPage);
  return { client, workers, encodeOnPage };
}

const renders = (w: FakeWorker) => w.received.filter((m) => m.kind === 'render');

describe('sketch client', () => {
  it('coalesces a slider drag: one render in flight, only the newest waits, superseded ones resolve to null', async () => {
    const { client, workers } = setup();
    client.load(picture(), W, H, false);
    const results = [10, 20, 30, 40, 50].map((detail) => client.render('outline', { ...DEFAULT_CONTROLS, detail }, 'drawing'));
    const done = await Promise.all(results);
    expect(done.map((r) => (r ? 'image' : null))).toEqual(['image', null, null, null, 'image']);
    const sent = renders(workers[0]).map((m) => (m.kind === 'render' ? m.controls.detail : -1));
    expect(sent).toEqual([10, 50]);
    expect(done[4]!.width).toBe(W);
    expect(done[4]!.timings.total).toBeGreaterThanOrEqual(0);
  });

  it('a save-time render does not take the place of the on-screen one', async () => {
    const { client, workers } = setup();
    client.load(picture(), W, H, false);
    const first = client.render('pencil', DEFAULT_CONTROLS, 'drawing');
    const waiting = client.render('pencil', { ...DEFAULT_CONTROLS, shading: 90 }, 'drawing');
    const once = client.renderOnce('pencil', { ...DEFAULT_CONTROLS, shading: 10 }, 'drawing');
    expect(await first).not.toBeNull();
    expect(await waiting).not.toBeNull();
    expect(await once).not.toBeNull();
    expect(renders(workers[0])).toHaveLength(3);
  });

  it('a new picture abandons the old one’s work and starts a fresh worker', async () => {
    const { client, workers } = setup();
    client.load(picture(), W, H, false);
    const old = client.render('outline', DEFAULT_CONTROLS, 'drawing');
    const id = client.load(picture(), W, H, false);
    expect(await old).toBeNull();
    expect(workers[0].terminated).toBe(true);
    const fresh = await client.render('outline', DEFAULT_CONTROLS, 'drawing');
    expect(fresh?.imageId).toBe(id);
    expect(workers).toHaveLength(2);
  });

  it('a crashed worker rejects what was pending, reports it, and the next picture gets a new worker', async () => {
    const { client, workers } = setup();
    const onCrash = vi.fn();
    client.onCrash = onCrash;
    client.load(picture(), W, H, false);
    const svg = client.svg(DEFAULT_CONTROLS, W, H);
    workers[0].crash();
    await expect(svg).rejects.toBeInstanceOf(SketchError);
    expect(onCrash).toHaveBeenCalledTimes(1);
    expect(client.loaded).toBeNull();
    expect(await client.render('outline', DEFAULT_CONTROLS, 'drawing')).toBeNull();
    client.load(picture(), W, H, true);
    expect(await client.render('outline', DEFAULT_CONTROLS, 'drawing')).not.toBeNull();
    expect(workers).toHaveLength(2);
  });

  it('returns vector paths and an SVG with no raster in it', async () => {
    const { client } = setup();
    client.load(picture(), W, H, false);
    const paths = await client.paths(DEFAULT_CONTROLS);
    expect(paths.width).toBe(W);
    expect(paths.layers.some((l) => l.loops > 0)).toBe(true);
    const svg = await client.svg(DEFAULT_CONTROLS, 640, 480);
    expect(svg).toContain('viewBox="0 0 64 48"');
    expect(svg).toContain('width="640"');
    expect(svg).not.toMatch(/<image|base64/);
  });

  it('saves at another size in a separate worker that is shut down afterwards', async () => {
    const { client, workers } = setup();
    client.load(picture(), W, H, false);
    const big = new Uint8ClampedArray(W * 2 * H * 2 * 4).fill(200);
    const result = await client.exportImage(big, W * 2, H * 2, 'pencil', DEFAULT_CONTROLS);
    expect(result.width).toBe(W * 2);
    expect(workers).toHaveLength(2);
    expect(workers[1].terminated).toBe(true);
    expect(workers[0].terminated).toBe(false);
  });

  it('encodes on the page when the worker cannot', async () => {
    const { client, encodeOnPage } = setup(false);
    client.load(picture(), W, H, false);
    const image = await client.render('outline', DEFAULT_CONTROLS, 'overlay');
    expect(encodeOnPage).toHaveBeenCalledTimes(1);
    expect(await image!.blob.text()).toBe(`page:${W * H * 4}`);
  });

  it('holds on-screen renders during an export, after freeing the caches behind any running render', async () => {
    const { client, workers } = setup();
    client.load(picture(), W, H, false);
    const running = client.render('pencil', DEFAULT_CONTROLS, 'drawing');
    client.hold();
    const waiting = client.render('pencil', { ...DEFAULT_CONTROLS, shading: 80 }, 'drawing');
    await client.release();
    const kinds = () => workers[0].received.map((m) => m.kind);
    // The release went after the running render, and the waiting one was not sent.
    expect(kinds()).toEqual(['load', 'render', 'release']);
    expect(await running).not.toBeNull();
    await new Promise((r) => setTimeout(r, 20));
    expect(kinds()).toEqual(['load', 'render', 'release']);
    client.resume();
    expect(await waiting).not.toBeNull();
    expect(kinds()).toEqual(['load', 'render', 'release', 'render']);
  });

  it('after dispose nothing runs', async () => {
    const { client, workers } = setup();
    client.load(picture(), W, H, false);
    client.dispose();
    expect(workers[0].terminated).toBe(true);
    expect(await client.render('outline', DEFAULT_CONTROLS, 'drawing')).toBeNull();
    expect(() => client.load(picture(), W, H, false)).toThrow(SketchError);
  });
});

describe('sketch worker handler', () => {
  it('refuses requests for a picture it no longer holds', async () => {
    const posted: SketchResponse[] = [];
    const handle = createSketchWorker((m) => posted.push(m), null);
    await handle({ kind: 'load', imageId: 1, width: W, height: H, pixels: picture().buffer as ArrayBuffer, compact: false });
    await handle({ kind: 'render', jobId: 7, imageId: 2, style: 'outline', controls: DEFAULT_CONTROLS, view: 'drawing' });
    expect(posted).toEqual([{ kind: 'error', jobId: 7, message: 'stale' }]);
  });

  it('reports a picture it could not load as an error (so the page offers Try again), not as stale', async () => {
    const posted: SketchResponse[] = [];
    const handle = createSketchWorker((m) => posted.push(m), null);
    await handle({ kind: 'load', imageId: 1, width: W, height: H, pixels: new ArrayBuffer(16), compact: false });
    await handle({ kind: 'render', jobId: 1, imageId: 1, style: 'outline', controls: DEFAULT_CONTROLS, view: 'drawing' });
    expect(posted[0]).toMatchObject({ kind: 'error', jobId: 1 });
    expect((posted[0] as { message: string }).message).toMatch(/does not match/);
  });

  it('keeps answering after a request fails, even past its own error handling', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    const posted: SketchResponse[] = [];
    // Posting the answer and then the error both fail: the request rejects.
    const handle = createSketchWorker((m) => {
      if (m.kind === 'svg' || m.kind === 'error') throw new Error('posting failed');
      posted.push(m);
    }, null);
    await handle({ kind: 'load', imageId: 1, width: W, height: H, pixels: picture().buffer as ArrayBuffer, compact: false });
    await handle({ kind: 'svg', jobId: 1, imageId: 1, controls: DEFAULT_CONTROLS, width: W, height: H });
    await handle({ kind: 'release', jobId: 2 });
    expect(posted.at(-1)).toEqual({ kind: 'released', jobId: 2 });
    expect(quiet).toHaveBeenCalledWith('[sketch worker]', expect.any(Error));
    quiet.mockRestore();
  });
});
