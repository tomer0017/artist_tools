/**
 * The page's side of the sketch worker.
 *
 *   const client = new SketchClient(spawnSketchWorker, encodePng);
 *   client.load(pixels, width, height, compact);    // once per picture
 *   const image = await client.render(style, controls, 'drawing');
 *
 * A slider produces far more changes than the engine can draw, so renders are
 * coalesced: at most one is in the worker at a time, and while it runs only the
 * newest request waits (older ones resolve to null). Nothing queues up, and
 * the picture always catches up with the latest settings.
 */

import type { RenderTimings, SketchRequest, SketchResponse, SketchView } from './protocol';
import type { SketchControls, SketchStyle } from './styles';
import type { PathLayer } from './vector';

export interface SketchImage {
  imageId: number;
  blob: Blob;
  width: number;
  height: number;
  timings: RenderTimings;
}

export interface WorkerLike {
  postMessage(message: SketchRequest, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<SketchResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}

/** Encodes RGBA pixels as PNG on the page, for a worker that could not. */
export type PixelEncoder = (pixels: Uint8ClampedArray, width: number, height: number) => Promise<Blob>;

export class SketchError extends Error {
  constructor(
    message: string,
    /** True when the worker itself failed (e.g. ran out of memory) and was restarted. */
    readonly crashed = false,
  ) {
    super(message);
    this.name = 'SketchError';
  }
}

interface Job {
  resolve: (response: SketchResponse) => void;
  reject: (error: unknown) => void;
}

interface RenderRequest {
  style: SketchStyle;
  controls: SketchControls;
  view: SketchView;
  resolve: (image: SketchImage | null) => void;
  reject: (error: unknown) => void;
}

export class SketchClient {
  private worker: WorkerLike | null = null;
  private readonly jobs = new Map<number, Job>();
  private nextJob = 1;
  private images = 0;
  private picture: { imageId: number; width: number; height: number } | null = null;
  private rendering = false;
  private waiting: RenderRequest | null = null;
  private held = false;
  private disposed = false;

  /** Called when the worker failed and was discarded; the picture must be loaded again. */
  onCrash: ((error: SketchError) => void) | null = null;

  constructor(
    private readonly spawn: () => WorkerLike,
    private readonly encode: PixelEncoder,
  ) {}

  /** The loaded picture, if any. */
  get loaded(): { imageId: number; width: number; height: number } | null {
    return this.picture;
  }

  private ensureWorker(): WorkerLike {
    if (this.worker) return this.worker;
    const worker = this.spawn();
    worker.onmessage = (event) => this.receive(event.data);
    worker.onerror = (event) => {
      event.preventDefault?.();
      this.crash(new SketchError(event.message || 'The sketch worker stopped', true));
    };
    this.worker = worker;
    return worker;
  }

  private receive(response: SketchResponse): void {
    const job = this.jobs.get(response.jobId);
    if (!job) return;
    this.jobs.delete(response.jobId);
    job.resolve(response);
  }

  private request(message: SketchRequest & { jobId: number }, transfer: Transferable[] = []): Promise<SketchResponse> {
    return new Promise((resolve, reject) => {
      this.jobs.set(message.jobId, { resolve, reject });
      try {
        this.ensureWorker().postMessage(message, transfer);
      } catch (error) {
        this.jobs.delete(message.jobId);
        reject(error);
      }
    });
  }

  /** Throw away the worker and everything it was doing. */
  private reset(reason: SketchError | null): void {
    this.worker?.terminate();
    this.worker = null;
    this.picture = null;
    this.rendering = false;
    this.held = false;
    const jobs = [...this.jobs.values()];
    this.jobs.clear();
    const waiting = this.waiting;
    this.waiting = null;
    for (const job of jobs) {
      if (reason) job.reject(reason);
      else job.reject(new SketchError('cancelled'));
    }
    waiting?.resolve(null);
  }

  private crash(error: SketchError): void {
    this.reset(error);
    this.onCrash?.(error);
  }

  /**
   * Send a picture (RGBA, transferred: `pixels` is unusable afterwards).
   * Work still running for a previous picture is abandoned.
   */
  load(pixels: Uint8ClampedArray, width: number, height: number, compact: boolean): number {
    if (this.disposed) throw new SketchError('disposed');
    if (this.jobs.size || this.rendering) this.reset(null);
    const imageId = ++this.images;
    const buffer = pixels.buffer as ArrayBuffer;
    this.ensureWorker().postMessage({ kind: 'load', imageId, width, height, pixels: buffer, compact }, [buffer]);
    this.picture = { imageId, width, height };
    return imageId;
  }

  /** The drawing (or its overlay on the photo) for these settings; null when superseded or cancelled. */
  render(style: SketchStyle, controls: SketchControls, view: SketchView): Promise<SketchImage | null> {
    return new Promise((resolve, reject) => {
      if (!this.picture || this.disposed) {
        resolve(null);
        return;
      }
      const request: RenderRequest = { style, controls: { ...controls }, view, resolve, reject };
      if (this.rendering || this.held) {
        this.waiting?.resolve(null);
        this.waiting = request;
        return;
      }
      void this.run(request);
    });
  }

  private next(): void {
    const next = this.waiting;
    this.waiting = null;
    if (next) void this.run(next);
  }

  /**
   * Hold on-screen renders (they wait, newest only) until `resume`. Used while
   * a large export runs, so the on-screen caches are not rebuilt beside it.
   */
  hold(): void {
    this.held = true;
  }

  resume(): void {
    this.held = false;
    if (!this.rendering) this.next();
  }

  private async run(request: RenderRequest): Promise<void> {
    const picture = this.picture;
    if (!picture) {
      request.resolve(null);
      return;
    }
    this.rendering = true;
    try {
      const response = await this.request({
        kind: 'render',
        jobId: this.nextJob++,
        imageId: picture.imageId,
        style: request.style,
        controls: request.controls,
        view: request.view,
      });
      if (response.kind === 'error') {
        if (response.message === 'stale') request.resolve(null);
        else request.reject(new SketchError(response.message));
      } else if (response.kind === 'image') {
        const blob = response.png ?? (await this.encode(new Uint8ClampedArray(response.pixels!), response.width, response.height));
        request.resolve({ imageId: response.imageId, blob, width: response.width, height: response.height, timings: response.timings });
      } else {
        request.resolve(null);
      }
    } catch (error) {
      if (error instanceof SketchError && error.message === 'cancelled') request.resolve(null);
      else request.reject(error);
    } finally {
      // A reset (new picture, crash) clears `rendering` itself; only continue
      // with the waiting request if this render is still the current one.
      if (this.picture?.imageId === picture.imageId) {
        this.rendering = false;
        if (!this.held) this.next();
      }
    }
  }

  /**
   * One render outside the coalescing queue (for saving), so it never takes
   * the place of the on-screen request.
   */
  async renderOnce(style: SketchStyle, controls: SketchControls, view: SketchView): Promise<SketchImage | null> {
    const picture = this.picture;
    if (!picture) return null;
    const response = await this.request({ kind: 'render', jobId: this.nextJob++, imageId: picture.imageId, style, controls: { ...controls }, view });
    if (response.kind === 'error') {
      if (response.message === 'stale') return null;
      throw new SketchError(response.message);
    }
    if (response.kind !== 'image') return null;
    const blob = response.png ?? (await this.encode(new Uint8ClampedArray(response.pixels!), response.width, response.height));
    return { imageId: response.imageId, blob, width: response.width, height: response.height, timings: response.timings };
  }

  /** Clean Outline's vector layers in working pixels. */
  async paths(controls: SketchControls): Promise<{ width: number; height: number; layers: PathLayer[] }> {
    const picture = this.picture;
    if (!picture) throw new SketchError('No picture loaded');
    const response = await this.request({ kind: 'paths', jobId: this.nextJob++, imageId: picture.imageId, controls: { ...controls } });
    if (response.kind === 'error') throw new SketchError(response.message);
    if (response.kind !== 'paths') throw new SketchError('Unexpected reply');
    return { width: response.width, height: response.height, layers: response.layers };
  }

  /** Clean Outline as an SVG document that opens at `width` × `height`. */
  async svg(controls: SketchControls, width: number, height: number): Promise<string> {
    const picture = this.picture;
    if (!picture) throw new SketchError('No picture loaded');
    const response = await this.request({ kind: 'svg', jobId: this.nextJob++, imageId: picture.imageId, controls: { ...controls }, width, height });
    if (response.kind === 'error') throw new SketchError(response.message);
    if (response.kind !== 'svg') throw new SketchError('Unexpected reply');
    return response.svg;
  }

  /**
   * Free the worker's caches; the next render rebuilds them. Resolves once the
   * worker has done it (after anything it was already working on).
   */
  async release(): Promise<void> {
    if (!this.worker) return;
    try {
      await this.request({ kind: 'release', jobId: this.nextJob++ });
    } catch {
      /* the worker is gone, and its memory with it */
    }
  }

  /**
   * A drawing at another size (for saving), computed in a separate worker that
   * is shut down afterwards, so its memory is returned at once. `pixels` is
   * transferred.
   */
  async exportImage(pixels: Uint8ClampedArray, width: number, height: number, style: SketchStyle, controls: SketchControls): Promise<SketchImage> {
    const worker = this.spawn();
    try {
      const response = await new Promise<SketchResponse>((resolve, reject) => {
        worker.onmessage = (event) => resolve(event.data);
        worker.onerror = (event) => {
          event.preventDefault?.();
          reject(new SketchError(event.message || 'The sketch worker stopped', true));
        };
        const buffer = pixels.buffer as ArrayBuffer;
        worker.postMessage({ kind: 'export', jobId: 0, width, height, pixels: buffer, style, controls: { ...controls } }, [buffer]);
      });
      if (response.kind === 'error') throw new SketchError(response.message);
      if (response.kind !== 'image') throw new SketchError('Unexpected reply');
      const blob = response.png ?? (await this.encode(new Uint8ClampedArray(response.pixels!), response.width, response.height));
      return { imageId: -1, blob, width: response.width, height: response.height, timings: response.timings };
    } finally {
      worker.terminate();
    }
  }

  /** Stop the worker for good (the tool was closed). */
  dispose(): void {
    this.disposed = true;
    this.reset(null);
  }

  /** Stop the worker but stay usable: the next load starts a new one (frees all of its memory). */
  suspend(): void {
    this.reset(null);
  }
}
