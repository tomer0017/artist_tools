import { describe, expect, it, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { CompareProvider, useCompare } from './compareArtState';
import { STORAGE_KEY } from './compareArtStorage';

const meta = { width: 1000, height: 800 };

function setup() {
  return renderHook(() => useCompare(), { wrapper: CompareProvider });
}

describe('compare store', () => {
  beforeEach(() => localStorage.clear());

  it('starts empty with the artwork locked and reference selected by default', () => {
    const { result } = setup();
    expect(result.current.hasArtwork).toBe(false);
    expect(result.current.hasReference).toBe(false);
    expect(result.current.bothLoaded).toBe(false);
    expect(result.current.session.artworkLocked).toBe(true);
    expect(result.current.session.opacity).toBe(0.5);
    expect(result.current.session.mode).toBe('overlay');
  });

  it('loads artwork and reference independently', () => {
    const { result } = setup();
    act(() => result.current.setArtwork('data:artwork', meta));
    expect(result.current.hasArtwork).toBe(true);
    expect(result.current.bothLoaded).toBe(false);
    act(() => result.current.setReference('data:reference', meta));
    expect(result.current.bothLoaded).toBe(true);
  });

  it('commits a reference transform as one undo step and can undo/redo it', () => {
    const { result } = setup();
    act(() => result.current.setArtwork('data:a', meta));
    act(() => result.current.setReference('data:r', meta));
    expect(result.current.canUndo).toBe(false);

    act(() => result.current.commitReferenceTransform({ tx: 0.2, ty: 0, scale: 1.5, rotation: 0, flipH: false }));
    expect(result.current.session.referenceTransform.tx).toBeCloseTo(0.2);
    expect(result.current.canUndo).toBe(true);

    act(() => result.current.undo());
    expect(result.current.session.referenceTransform.tx).toBeCloseTo(0);
    expect(result.current.canRedo).toBe(true);

    act(() => result.current.redo());
    expect(result.current.session.referenceTransform.tx).toBeCloseTo(0.2);
  });

  it('resets the reference transform to identity', () => {
    const { result } = setup();
    act(() => result.current.commitReferenceTransform({ tx: 0.3, ty: 0.3, scale: 2, rotation: 1, flipH: true }));
    act(() => result.current.resetReferenceTransform());
    const t = result.current.session.referenceTransform;
    expect(t.tx).toBe(0);
    expect(t.scale).toBe(1);
    expect(t.rotation).toBe(0);
    expect(t.flipH).toBe(false);
  });

  it('switches modes and toggles grayscale', () => {
    const { result } = setup();
    act(() => result.current.setMode('difference'));
    expect(result.current.session.mode).toBe('difference');
    act(() => result.current.setGrayscale(true));
    expect(result.current.session.grayscale).toBe(true);
  });

  it('persists opacity and grid to localStorage', async () => {
    const { result } = setup();
    act(() => result.current.commitOpacity(0.8));
    act(() => result.current.setGrid({ enabled: true, rows: 8, columns: 8 }));
    // Autosave is debounced (400ms).
    await new Promise((r) => setTimeout(r, 500));
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    const saved = JSON.parse(raw!);
    expect(saved.opacity).toBeCloseTo(0.8);
    expect(saved.grid.rows).toBe(8);
    expect(saved.grid.enabled).toBe(true);
  });

  it('restores a persisted session on mount', async () => {
    const first = setup();
    act(() => first.result.current.setMode('blink'));
    act(() => first.result.current.commitOpacity(0.9));
    await new Promise((r) => setTimeout(r, 500));

    const second = setup();
    expect(second.result.current.session.mode).toBe('blink');
    expect(second.result.current.session.opacity).toBeCloseTo(0.9);
  });

  it('nudges the reference and records history', () => {
    const { result } = setup();
    const before = result.current.session.referenceTransform.tx;
    act(() => result.current.nudgeReference('normal', 'right'));
    expect(result.current.session.referenceTransform.tx).toBeGreaterThan(before);
    expect(result.current.canUndo).toBe(true);
  });

  it('toggles the artwork lock', () => {
    const { result } = setup();
    expect(result.current.session.artworkLocked).toBe(true);
    act(() => result.current.toggleArtworkLock());
    expect(result.current.session.artworkLocked).toBe(false);
  });

  it('applyImageCrop stores the cropped image plus original + crop params', () => {
    const { result } = setup();
    const crop = { rect: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 }, shape: 'rect' as const, preset: 'square' as const };
    act(() =>
      result.current.applyImageCrop('artwork', {
        cropped: 'data:cropped',
        meta: { width: 500, height: 500 },
        original: 'data:original',
        crop,
      }),
    );
    expect(result.current.session.artwork).toBe('data:cropped');
    expect(result.current.session.artworkOriginal).toBe('data:original');
    expect(result.current.session.artworkCrop).toEqual(crop);
    expect(result.current.hasArtwork).toBe(true);
  });

  it('resetComparison clears everything', () => {
    const { result } = setup();
    act(() => result.current.setArtwork('data:a', meta));
    act(() => result.current.setMode('split'));
    act(() => result.current.resetComparison());
    expect(result.current.hasArtwork).toBe(false);
    expect(result.current.session.mode).toBe('overlay');
    expect(result.current.canUndo).toBe(false);
  });
});
