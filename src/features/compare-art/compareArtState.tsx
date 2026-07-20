// Compare Art — isolated state provider.
//
// Owns the entire comparison session, its own undo/redo history and autosave.
// It shares nothing mutable with the global project store, so it cannot affect
// Measure / Value / Color / Grid. Live gesture updates are intentionally NOT
// routed through here on every pointer move — the canvas mutates a local ref
// during a gesture and commits ONE history step at the end (see CompareCanvas).

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  CompareMode,
  CompareSession,
  CropRect,
  DifferenceConfig,
  GifConfig,
  GridConfig,
  ImageMeta,
  NUDGE,
  NudgeStep,
  Transform,
  defaultSession,
} from './compareArtTypes';
import {
  clampScale,
  fillTransform,
  fitTransform,
  matchArtworkBounds,
  sanitizeCrop,
} from './compareArtGeometry';
import {
  compactForStorage,
  loadSession,
  saveSession,
  clearSession,
} from './compareArtStorage';

/** Fields captured by undo/redo (everything meaningful except image payloads). */
interface HistorySnapshot {
  artworkTransform: Transform;
  referenceTransform: Transform;
  artworkLocked: boolean;
  referenceHidden: boolean;
  crop: CropRect;
  opacity: number;
  mode: CompareMode;
  grayscale: boolean;
  grid: GridConfig;
  difference: DifferenceConfig;
}

function snapshotOf(s: CompareSession): HistorySnapshot {
  return {
    artworkTransform: { ...s.artworkTransform },
    referenceTransform: { ...s.referenceTransform },
    artworkLocked: s.artworkLocked,
    referenceHidden: s.referenceHidden,
    crop: { ...s.crop },
    opacity: s.opacity,
    mode: s.mode,
    grayscale: s.grayscale,
    grid: { ...s.grid },
    difference: { ...s.difference },
  };
}

interface Store {
  session: CompareSession;
  imagesDropped: boolean;
  hasArtwork: boolean;
  hasReference: boolean;
  bothLoaded: boolean;
  canUndo: boolean;
  canRedo: boolean;

  setArtwork: (dataUrl: string, meta: ImageMeta) => void;
  setReference: (dataUrl: string, meta: ImageMeta) => void;
  removeArtwork: () => void;
  removeReference: () => void;

  /** Commit a new reference transform as ONE undo step (from a finished gesture). */
  commitReferenceTransform: (t: Transform) => void;
  /** Commit a new artwork transform as one undo step. */
  commitArtworkTransform: (t: Transform) => void;
  nudgeReference: (step: NudgeStep, action: NudgeAction) => void;
  flipReference: () => void;
  resetReferenceTransform: () => void;

  fitReference: () => void;
  fillReference: () => void;
  matchArtworkBounds: () => void;

  setOpacity: (v: number) => void;
  commitOpacity: (v: number) => void;
  setMode: (m: CompareMode) => void;
  setGrayscale: (v: boolean) => void;
  toggleArtworkLock: () => void;
  toggleReferenceHidden: () => void;
  setSplit: (pos: number) => void;
  setSplitOrientation: (o: 'horizontal' | 'vertical') => void;
  setBlinkSpeed: (s: CompareSession['blinkSpeed']) => void;

  /** Update crop without recording history (during a drag). */
  setCropLive: (c: CropRect) => void;
  /** Commit the crop as one undo step (at the end of a drag). */
  setCrop: (c: CropRect) => void;
  resetCrop: () => void;

  setGrid: (partial: Partial<GridConfig>) => void;
  setDifference: (partial: Partial<DifferenceConfig>) => void;
  setGif: (partial: Partial<GifConfig>) => void;

  undo: () => void;
  redo: () => void;
  resetComparison: () => void;
  acknowledgeDroppedImages: () => void;
}

export type NudgeAction =
  | 'left'
  | 'right'
  | 'up'
  | 'down'
  | 'scaleUp'
  | 'scaleDown'
  | 'rotateCw'
  | 'rotateCcw';

const Ctx = createContext<Store | null>(null);

export function CompareProvider({ children }: { children: React.ReactNode }) {
  const initial = useRef(loadSession());
  const [session, setSession] = useState<CompareSession>(initial.current.session);
  const [imagesDropped, setImagesDropped] = useState(initial.current.imagesDropped);
  const undoStack = useRef<HistorySnapshot[]>([]);
  const redoStack = useRef<HistorySnapshot[]>([]);
  const [historyVersion, setHistoryVersion] = useState(0);

  // Compact (downscaled) copies used ONLY for persistence. The full-resolution
  // originals stay in `session` so rendering and export keep their quality.
  const artworkCompact = useRef<{ src: string; compact: string } | null>(null);
  const referenceCompact = useRef<{ src: string; compact: string } | null>(null);

  // ── Autosave (debounced) ──────────────────────────────────────────────────
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const artwork =
        session.artwork && artworkCompact.current?.src === session.artwork
          ? artworkCompact.current.compact
          : session.artwork;
      const reference =
        session.reference && referenceCompact.current?.src === session.reference
          ? referenceCompact.current.compact
          : session.reference;
      saveSession({ ...session, artwork, reference });
    }, 400);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [session]);

  const bumpHistory = () => setHistoryVersion((v) => v + 1);

  /** Push the CURRENT state onto the undo stack before a discrete change. */
  const pushHistory = useCallback(() => {
    undoStack.current.push(snapshotOf(session));
    if (undoStack.current.length > 60) undoStack.current.shift();
    redoStack.current = [];
    bumpHistory();
  }, [session]);

  const applySnapshot = (snap: HistorySnapshot) =>
    setSession((s) => ({ ...s, ...snap }));

  // ── Images ────────────────────────────────────────────────────────────────
  const setArtwork = useCallback((dataUrl: string, meta: ImageMeta) => {
    setSession((s) => ({ ...s, artwork: dataUrl, artworkMeta: meta }));
    setImagesDropped(false);
    // Compact copy for persistence only (never blocks the UI or lowers quality).
    compactForStorage(dataUrl).then((compact) => {
      artworkCompact.current = { src: dataUrl, compact };
    });
  }, []);

  const setReference = useCallback((dataUrl: string, meta: ImageMeta) => {
    setSession((s) => ({ ...s, reference: dataUrl, referenceMeta: meta }));
    setImagesDropped(false);
    compactForStorage(dataUrl).then((compact) => {
      referenceCompact.current = { src: dataUrl, compact };
    });
  }, []);

  const removeArtwork = useCallback(() => {
    setSession((s) => ({ ...s, artwork: null, artworkMeta: null }));
  }, []);
  const removeReference = useCallback(() => {
    setSession((s) => ({ ...s, reference: null, referenceMeta: null }));
  }, []);

  // ── Transforms (each a single undo step) ───────────────────────────────────
  const commitReferenceTransform = useCallback(
    (t: Transform) => {
      pushHistory();
      setSession((s) => ({ ...s, referenceTransform: { ...t, scale: clampScale(t.scale) } }));
    },
    [pushHistory],
  );

  const commitArtworkTransform = useCallback(
    (t: Transform) => {
      pushHistory();
      setSession((s) => ({ ...s, artworkTransform: { ...t, scale: clampScale(t.scale) } }));
    },
    [pushHistory],
  );

  const nudgeReference = useCallback(
    (step: NudgeStep, action: NudgeAction) => {
      pushHistory();
      const inc = NUDGE[step];
      setSession((s) => {
        const t = { ...s.referenceTransform };
        switch (action) {
          case 'left': t.tx -= inc.move; break;
          case 'right': t.tx += inc.move; break;
          case 'up': t.ty -= inc.move; break;
          case 'down': t.ty += inc.move; break;
          case 'scaleUp': t.scale = clampScale(t.scale * (1 + inc.scale)); break;
          case 'scaleDown': t.scale = clampScale(t.scale * (1 - inc.scale)); break;
          case 'rotateCw': t.rotation += inc.rotate; break;
          case 'rotateCcw': t.rotation -= inc.rotate; break;
        }
        return { ...s, referenceTransform: t };
      });
    },
    [pushHistory],
  );

  const flipReference = useCallback(() => {
    pushHistory();
    setSession((s) => ({
      ...s,
      referenceTransform: { ...s.referenceTransform, flipH: !s.referenceTransform.flipH },
    }));
  }, [pushHistory]);

  const resetReferenceTransform = useCallback(() => {
    pushHistory();
    setSession((s) => ({ ...s, referenceTransform: fitTransform() }));
  }, [pushHistory]);

  const doFit = useCallback(() => {
    pushHistory();
    setSession((s) => ({ ...s, referenceTransform: fitTransform() }));
  }, [pushHistory]);

  const doFill = useCallback(() => {
    pushHistory();
    setSession((s) => {
      if (!s.referenceMeta || !s.artworkMeta) return s;
      const scene = sceneFromMeta(s.artworkMeta);
      return { ...s, referenceTransform: fillTransform(dims(s.referenceMeta), scene) };
    });
  }, [pushHistory]);

  const doMatchBounds = useCallback(() => {
    pushHistory();
    setSession((s) => {
      if (!s.referenceMeta || !s.artworkMeta) return s;
      const scene = sceneFromMeta(s.artworkMeta);
      return { ...s, referenceTransform: matchArtworkBounds(dims(s.referenceMeta), scene) };
    });
  }, [pushHistory]);

  // ── Simple settings ────────────────────────────────────────────────────────
  const setOpacity = useCallback((v: number) => {
    setSession((s) => ({ ...s, opacity: Math.max(0, Math.min(1, v)) }));
  }, []);
  const commitOpacity = useCallback(
    (v: number) => {
      pushHistory();
      setSession((s) => ({ ...s, opacity: Math.max(0, Math.min(1, v)) }));
    },
    [pushHistory],
  );
  const setMode = useCallback((m: CompareMode) => setSession((s) => ({ ...s, mode: m })), []);
  const setGrayscale = useCallback((v: boolean) => setSession((s) => ({ ...s, grayscale: v })), []);
  const toggleArtworkLock = useCallback(
    () => setSession((s) => ({ ...s, artworkLocked: !s.artworkLocked })),
    [],
  );
  const toggleReferenceHidden = useCallback(
    () => setSession((s) => ({ ...s, referenceHidden: !s.referenceHidden })),
    [],
  );
  const setSplit = useCallback(
    (pos: number) => setSession((s) => ({ ...s, splitPosition: Math.max(0, Math.min(1, pos)) })),
    [],
  );
  const setSplitOrientation = useCallback(
    (o: 'horizontal' | 'vertical') => setSession((s) => ({ ...s, splitOrientation: o })),
    [],
  );
  const setBlinkSpeed = useCallback(
    (sp: CompareSession['blinkSpeed']) => setSession((s) => ({ ...s, blinkSpeed: sp })),
    [],
  );

  const setCropLive = useCallback((c: CropRect) => {
    setSession((s) => ({ ...s, crop: sanitizeCrop(c) }));
  }, []);
  const setCrop = useCallback((c: CropRect) => {
    pushHistory();
    setSession((s) => ({ ...s, crop: sanitizeCrop(c) }));
  }, [pushHistory]);
  const resetCrop = useCallback(() => {
    pushHistory();
    setSession((s) => ({ ...s, crop: { x: 0, y: 0, w: 1, h: 1 } }));
  }, [pushHistory]);

  const setGrid = useCallback((partial: Partial<GridConfig>) => {
    pushHistory();
    setSession((s) => ({ ...s, grid: { ...s.grid, ...partial } }));
  }, [pushHistory]);
  const setDifference = useCallback((partial: Partial<DifferenceConfig>) => {
    setSession((s) => ({ ...s, difference: { ...s.difference, ...partial } }));
  }, []);
  const setGif = useCallback((partial: Partial<GifConfig>) => {
    setSession((s) => ({ ...s, gif: { ...s.gif, ...partial } }));
  }, []);

  // ── History ─────────────────────────────────────────────────────────────────
  const undo = useCallback(() => {
    const prev = undoStack.current.pop();
    if (!prev) return;
    redoStack.current.push(snapshotOf(session));
    applySnapshot(prev);
    bumpHistory();
  }, [session]);

  const redo = useCallback(() => {
    const next = redoStack.current.pop();
    if (!next) return;
    undoStack.current.push(snapshotOf(session));
    applySnapshot(next);
    bumpHistory();
  }, [session]);

  const resetComparison = useCallback(() => {
    undoStack.current = [];
    redoStack.current = [];
    bumpHistory();
    setSession(defaultSession());
    setImagesDropped(false);
    clearSession();
  }, []);

  const acknowledgeDroppedImages = useCallback(() => setImagesDropped(false), []);

  const store: Store = {
    session,
    imagesDropped,
    hasArtwork: !!session.artwork,
    hasReference: !!session.reference,
    bothLoaded: !!session.artwork && !!session.reference,
    canUndo: undoStack.current.length > 0,
    canRedo: redoStack.current.length > 0,
    setArtwork,
    setReference,
    removeArtwork,
    removeReference,
    commitReferenceTransform,
    commitArtworkTransform,
    nudgeReference,
    flipReference,
    resetReferenceTransform,
    fitReference: doFit,
    fillReference: doFill,
    matchArtworkBounds: doMatchBounds,
    setOpacity,
    commitOpacity,
    setMode,
    setGrayscale,
    toggleArtworkLock,
    toggleReferenceHidden,
    setSplit,
    setSplitOrientation,
    setBlinkSpeed,
    setCropLive,
    setCrop,
    resetCrop,
    setGrid,
    setDifference,
    setGif,
    undo,
    redo,
    resetComparison,
    acknowledgeDroppedImages,
  };

  // historyVersion is referenced so canUndo/canRedo recompute on stack changes.
  void historyVersion;

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useCompare(): Store {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useCompare must be used inside CompareProvider');
  return ctx;
}

// ── local helpers ─────────────────────────────────────────────────────────────
function dims(meta: ImageMeta) {
  return { width: meta.width, height: meta.height };
}
function sceneFromMeta(meta: ImageMeta) {
  // Scene aspect equals the artwork's; absolute size is irrelevant to the
  // normalised transforms these helpers produce, so natural dims are fine.
  return { width: meta.width, height: meta.height };
}
