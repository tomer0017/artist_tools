/**
 * The sketch worker: runs the engine off the page's main thread, so the
 * interface stays responsive while a drawing is computed.
 */

import { createSketchWorker, offscreenEncoder } from './worker-core';
import type { SketchRequest } from './protocol';

const scope = self as unknown as {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<SketchRequest>) => void) | null;
};

const handle = createSketchWorker((message, transfer) => scope.postMessage(message, transfer ?? []), offscreenEncoder());
scope.onmessage = (event) => {
  void handle(event.data);
};
