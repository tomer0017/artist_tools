import { describe, expect, it, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { PROJECT_STORAGE_KEY, ProjectProvider, useProject } from './useProjectStore';

// Where the tools' pictures came from (ADR-0018): a Learn reference handed
// over keeps its item's ID, so saves from it ask the server about that item;
// any other picture (an upload) clears it; it survives a reload with the picture.

const wrapper = ({ children }: { children: React.ReactNode }) => <ProjectProvider>{children}</ProjectProvider>;
const saved = () => JSON.parse(localStorage.getItem(PROJECT_STORAGE_KEY) ?? 'null');

beforeEach(() => localStorage.clear());

describe('a picture from Learn', () => {
  it('keeps its item while it is the picture, and loses it with any other', async () => {
    const { result } = renderHook(() => useProject(), { wrapper });
    act(() => result.current.setImage('data:image/png;base64,REF', 'D-START-01'));
    expect(result.current.imageLearnItem).toBe('D-START-01');
    // Create a Grid starts from the shared picture once: with its item.
    act(() => result.current.initGridImageFromReference());
    expect(result.current.gridImage).toBe('data:image/png;base64,REF');
    expect(result.current.gridImageLearnItem).toBe('D-START-01');
    // An upload (no item given) is the person's own.
    act(() => result.current.setImage('data:image/png;base64,MINE'));
    expect(result.current.imageLearnItem).toBeNull();
    expect(result.current.gridImageLearnItem).toBe('D-START-01');
    act(() => result.current.setGridImage('data:image/png;base64,MINE'));
    expect(result.current.gridImageLearnItem).toBeNull();
    act(() => result.current.setGridImage('data:image/png;base64,REF2', 'CH-017'));
    expect(result.current.gridImageLearnItem).toBe('CH-017');
    act(() => result.current.newProject());
    expect([result.current.imageLearnItem, result.current.gridImageLearnItem]).toEqual([null, null]);
  });

  it('is saved with the picture and read back after a reload; never without a picture', async () => {
    const first = renderHook(() => useProject(), { wrapper });
    act(() => first.result.current.setGridImage('data:image/png;base64,REF', 'CH-017'));
    await new Promise((r) => setTimeout(r, 400));
    expect(saved()).toMatchObject({ gridImage: 'data:image/png;base64,REF', gridImageLearnItem: 'CH-017', imageLearnItem: null });
    first.unmount();
    const again = renderHook(() => useProject(), { wrapper });
    expect(again.result.current.gridImageLearnItem).toBe('CH-017');
    again.unmount();
    // A stored item without its picture is not believed.
    localStorage.setItem(PROJECT_STORAGE_KEY, JSON.stringify({ image: null, imageLearnItem: 'D-START-01', gridImage: null, gridImageLearnItem: 'CH-017' }));
    const stale = renderHook(() => useProject(), { wrapper });
    expect([stale.result.current.imageLearnItem, stale.result.current.gridImageLearnItem]).toEqual([null, null]);
  });
});
