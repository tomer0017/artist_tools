/**
 * Test support: a Web Worker stand-in that runs the real worker handler
 * in-process, asynchronously, the way a browser delivers messages. Used by
 * the client and hook tests; nothing in the app imports it.
 */

import type { WorkerLike } from './client';
import type { SketchRequest, SketchResponse } from './protocol';
import { createSketchWorker } from './worker-core';

export class FakeWorker implements WorkerLike {
  onmessage: ((event: MessageEvent<SketchResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminated = false;
  readonly received: SketchRequest[] = [];
  private readonly handle;

  /** @param encode encode PNGs "in the worker" (a stand-in blob naming what was drawn), or hand back raw pixels */
  constructor(encode = true) {
    let last: SketchRequest | null = null;
    this.handle = createSketchWorker(
      (message) =>
        setTimeout(() => {
          if (!this.terminated) this.onmessage?.({ data: message } as MessageEvent<SketchResponse>);
        }, 0),
      encode
        ? async () => new Blob([last && last.kind === 'render' ? `${last.style}|${last.view}|${JSON.stringify(last.controls)}` : 'png'])
        : null,
    );
    const handle = this.handle;
    this.handle = (req: SketchRequest) => {
      last = req;
      return handle(req);
    };
  }

  postMessage(message: SketchRequest): void {
    if (this.terminated) throw new Error('terminated');
    this.received.push(message);
    setTimeout(() => {
      if (!this.terminated) void this.handle(message);
    }, 0);
  }

  terminate(): void {
    this.terminated = true;
  }

  crash(): void {
    this.onerror?.({ message: 'out of memory', preventDefault() {} } as ErrorEvent);
  }
}

/** A small test picture: a dark disc on a light ground. */
export function testPicture(w = 64, h = 48): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = (x - w / 2) ** 2 + (y - h / 2) ** 2 < (Math.min(w, h) / 3) ** 2 ? 50 : 210;
      const i = (y * w + x) * 4;
      rgba[i] = rgba[i + 1] = rgba[i + 2] = v;
      rgba[i + 3] = 255;
    }
  }
  return rgba;
}
