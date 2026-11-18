import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { I18nProvider } from '@/i18n/client';
import { en } from '@/i18n/messages/en';
import { he } from '@/i18n/messages/he';
import { DEFAULT_GRID_SETTINGS, type GridSettings } from '@/types/project';
import { DEFAULT_CONTROLS } from '@/lib/sketch/styles';
import { CHOICES_KEY } from '@/lib/worksheets/sheets';
import type { MakeWorksheetsOptions, WorksheetSheet } from '@/lib/worksheets/browser';

// Prepare Worksheets: choose the sheets (remembered on this device), the
// server is asked first (both tools whose work the sheets are, then
// Worksheets and Saved images), the set is made, then saved: on a computer
// as files, on a phone through one share sheet.

const authorize = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => true));
vi.mock('@/components/common/SaveMedia', () => ({ useSaveMedia: () => ({ save: vi.fn(), authorize }) }));

const making = vi.hoisted(() => ({ calls: [] as { image: string; options: MakeWorksheetsOptions }[], fail: false, hold: null as Promise<void> | null }));
vi.mock('@/lib/worksheets/browser', () => ({
  makeWorksheets: async (image: string, options: MakeWorksheetsOptions): Promise<WorksheetSheet[]> => {
    making.calls.push({ image, options });
    const kinds = ['original', 'outline', 'grid', 'blank', 'values'].filter((k) => options.sheets.includes(k as never));
    for (const [i] of kinds.entries()) {
      options.onProgress?.(i, kinds.length);
      if (making.hold) await making.hold;
      if (options.signal?.aborted) throw new DOMException('stopped', 'AbortError');
    }
    if (making.fail) throw new Error('No 2D canvas');
    options.onProgress?.(kinds.length, kinds.length);
    return kinds.map((kind, i) => ({
      kind: kind as WorksheetSheet['kind'],
      filename: `worksheet-${i + 1}-${kind}.png`,
      blob: new Blob([kind], { type: 'image/png' }),
      thumbnail: new Blob([`small ${kind}`], { type: 'image/png' }),
      width: 2400,
      height: 3360,
    }));
  },
}));
const share = vi.hoisted(() => ({ can: false, touch: false, result: 'shared' as string, downloads: [] as string[], shared: [] as string[][] }));
vi.mock('@/lib/saveMedia', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/saveMedia')>()),
  canShareFiles: () => share.can,
  isTouchDevice: () => share.touch,
  isIOS: () => false,
  downloadBlob: (_blob: Blob, filename: string) => void share.downloads.push(filename),
  shareFiles: async (files: File[]) => {
    share.shared.push(files.map((f) => f.name));
    return share.result;
  },
}));

import PrepareWorksheets from './PrepareWorksheets';

beforeEach(() => {
  localStorage.clear();
  authorize.mockReset();
  authorize.mockResolvedValue(true);
  making.calls = [];
  making.fail = false;
  making.hold = null;
  Object.assign(share, { can: false, touch: false, result: 'shared', downloads: [], shared: [] });
});
afterEach(() => vi.clearAllMocks());

const PHOTO = 'data:image/png;base64,AAAA';
function open(props: Partial<{ from: 'grid' | 'value'; settings: GridSettings; fitted: boolean }> = {}, locale: 'en' | 'he' = 'en') {
  const onClose = vi.fn();
  const view = render(
    <I18nProvider locale={locale} messages={locale === 'he' ? he : en}>
      <PrepareWorksheets from={props.from ?? 'grid'} image={PHOTO} settings={props.settings ?? DEFAULT_GRID_SETTINGS} fitted={props.fitted} outline={DEFAULT_CONTROLS} onClose={onClose} />
    </I18nProvider>,
  );
  return { ...view, onClose, dialog: screen.getByRole('dialog', { name: locale === 'he' ? 'הכנת דפי תרגול' : 'Prepare worksheets' }) };
}
const box = (name: string) => screen.getByRole('checkbox', { name: new RegExp(`^${name}`) });

describe('choosing the sheets', () => {
  it('offers the five sheets, the blank grid off at first, 5 values, and says where the canvas and grid come from', () => {
    const { dialog } = open();
    expect(within(dialog).getAllByRole('checkbox').map((b) => [b.closest('label')!.textContent, (b as HTMLInputElement).checked])).toEqual([
      ['OriginalYour photo, framed as on the canvas', true],
      ['OutlineA clean outline of the photo', true],
      ['Reference with grid4×4 grid on a 50×70 cm canvas', true],
      ['Blank gridThe same grid on white, to draw on', false],
      ['ValuesThe photo in a few grays', true],
    ]);
    expect(screen.getByRole('radio', { name: '5 values' })).toBeChecked();
    expect(dialog).toHaveTextContent('The canvas, grid and framing come from Create a Grid.');
    expect(screen.getByRole('button', { name: 'Make sheets (4)' })).toBeEnabled();
  });

  it('remembers the choices on this device (never the photo); with none chosen nothing can be made', () => {
    const first = open({ settings: { ...DEFAULT_GRID_SETTINGS, cellMode: 'square', cellSize: 3, canvasWidth: 21, canvasHeight: 29.7 } });
    expect(box('Reference with grid')).toHaveAccessibleName(/3 cm squares on a 21×29.7 cm canvas/);
    fireEvent.click(box('Blank grid'));
    fireEvent.click(screen.getByRole('radio', { name: '3 values' }));
    expect(JSON.parse(localStorage.getItem(CHOICES_KEY)!)).toEqual({ sheets: ['original', 'outline', 'grid', 'blank', 'values'], levels: 3 });
    expect(localStorage.getItem(CHOICES_KEY)).not.toContain('data:');
    first.unmount();

    open();
    expect(box('Blank grid')).toBeChecked();
    expect(screen.getByRole('radio', { name: '3 values' })).toBeChecked();
    for (const name of ['Original', 'Outline', 'Reference with grid', 'Blank grid', 'Values']) fireEvent.click(box(name));
    expect(screen.queryByRole('radio', { name: '3 values' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Make sheets (0)' })).toBeDisabled();
  });

  it('a photo fitted to the canvas (from Study & Simplify) is said so', () => {
    const { dialog } = open({ from: 'value', fitted: true });
    expect(dialog).toHaveTextContent('The canvas and grid come from Create a Grid. The photo is fitted to the canvas.');
  });
});

describe('making a set', () => {
  it('asks the server first: the other tool alone, then this tool with Worksheets and Saved images; then makes and shows the sheets', async () => {
    open({ from: 'grid' });
    fireEvent.click(screen.getByRole('button', { name: 'Make sheets (4)' }));
    await screen.findByText('Sheets ready: 4');
    expect(authorize.mock.calls).toEqual([[{ tool: 'value', features: [] }], [{ tool: 'grid', features: ['export.worksheets', 'export.image'] }]]);
    expect(making.calls).toHaveLength(1);
    expect(making.calls[0].image).toBe(PHOTO);
    expect(making.calls[0].options).toMatchObject({ gs: DEFAULT_GRID_SETTINGS, sheets: ['original', 'outline', 'grid', 'values'], levels: 5, outline: DEFAULT_CONTROLS });
    expect(screen.getAllByRole('img').map((i) => i.getAttribute('alt'))).toEqual(['1. Original', '2. Outline', '3. Reference with grid', '4. Values']);
  });

  it('needs only the tool it was opened from when the sheets are all its own work', async () => {
    open({ from: 'value' });
    fireEvent.click(box('Reference with grid'));
    fireEvent.click(screen.getByRole('button', { name: 'Make sheets (3)' }));
    await screen.findByText('Sheets ready: 3');
    expect(authorize.mock.calls).toEqual([[{ tool: 'value', features: ['export.worksheets', 'export.image'] }]]);
  });

  it('makes nothing when the server says no, at either question, or does not answer', async () => {
    for (const refusedCall of [0, 1]) {
      const view = open({ from: 'grid' });
      authorize.mockReset();
      authorize.mockResolvedValue(true);
      authorize.mockResolvedValueOnce(refusedCall === 0 ? false : true);
      if (refusedCall === 1) authorize.mockResolvedValueOnce(false);
      fireEvent.click(screen.getByRole('button', { name: 'Make sheets (4)' }));
      await waitFor(() => expect(authorize).toHaveBeenCalledTimes(refusedCall + 1));
      await act(async () => {});
      expect(making.calls).toHaveLength(0);
      expect(screen.getByRole('button', { name: 'Make sheets (4)' })).toBeEnabled();
      view.unmount();
    }
  });

  it('says so when the sheets cannot be made, and they can be tried again', async () => {
    making.fail = true;
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Make sheets (4)' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The sheets could not be made. Please try again.');
    expect(screen.getByRole('button', { name: 'Make sheets (4)' })).toBeEnabled();
  });

  it('shows its progress, and closing stops it between sheets', async () => {
    let release!: () => void;
    making.hold = new Promise<void>((resolve) => (release = resolve));
    const view = open();
    fireEvent.click(screen.getByRole('button', { name: 'Make sheets (4)' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Making sheet 1 of 4…');
    view.unmount();
    release();
    await act(async () => {});
    expect(making.calls[0].options.signal!.aborted).toBe(true);
  });

  it('Escape closes it', () => {
    const { onClose } = open();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});

describe('saving a set', () => {
  it('on a computer: Save all downloads every sheet, in order; one sheet can be saved alone', async () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Make sheets (4)' }));
    await screen.findByText('Sheets ready: 4');
    fireEvent.click(screen.getByRole('button', { name: 'Save all' }));
    // The first at once, the others 400 ms apart (WebKit keeps only the last of downloads started together).
    expect(share.downloads).toEqual(['worksheet-1-original.png']);
    await waitFor(() => expect(share.downloads).toEqual(['worksheet-1-original.png', 'worksheet-2-outline.png', 'worksheet-3-grid.png', 'worksheet-4-values.png']), { timeout: 3000 });
    fireEvent.click(screen.getByRole('button', { name: 'Save Outline' }));
    expect(share.downloads.at(-1)).toBe('worksheet-2-outline.png');
    expect(share.shared).toEqual([]);
  });

  it('on a phone: one share sheet for all of them (or for one); files can still be saved; a failed share says so', async () => {
    Object.assign(share, { can: true, touch: true });
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Make sheets (4)' }));
    await screen.findByText('Sheets ready: 4');
    expect(screen.getByRole('dialog')).toHaveTextContent('In the next screen, choose Save Images, Save to Files or Print.');
    fireEvent.click(screen.getByRole('button', { name: 'Share or save all' }));
    await waitFor(() => expect(share.shared).toEqual([['worksheet-1-original.png', 'worksheet-2-outline.png', 'worksheet-3-grid.png', 'worksheet-4-values.png']]));
    fireEvent.click(screen.getByRole('button', { name: 'Save Values' }));
    await waitFor(() => expect(share.shared.at(-1)).toEqual(['worksheet-4-values.png']));
    fireEvent.click(screen.getByRole('button', { name: 'Save files' }));
    await waitFor(() => expect(share.downloads).toHaveLength(4), { timeout: 3000 });
    share.result = 'error';
    fireEvent.click(screen.getByRole('button', { name: 'Share or save all' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Sharing did not work here. Use Save files instead.');
  });

  it('Change sheets goes back to the choices', async () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Make sheets (4)' }));
    await screen.findByText('Sheets ready: 4');
    fireEvent.click(screen.getByRole('button', { name: 'Change sheets' }));
    expect(screen.getByRole('button', { name: 'Make sheets (4)' })).toBeEnabled();
  });
});

describe('in Hebrew', () => {
  it('the sheets, the grid and the buttons are in Hebrew', async () => {
    const { dialog } = open({}, 'he');
    expect(within(dialog).getAllByRole('checkbox').map((b) => b.closest('label')!.querySelector('span span')!.textContent)).toEqual([
      'המקור', 'קו מתאר', 'תמונת ייחוס עם רשת', 'רשת ריקה', 'ערכים',
    ]);
    expect(box('תמונת ייחוס עם רשת')).toHaveAccessibleName(/רשת 4‎×4 על בד 50‎×70 cm/);
    fireEvent.click(screen.getByRole('button', { name: 'הכנת הדפים (4)' }));
    expect(await screen.findByText('דפים מוכנים: 4')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'שמירת הכול' })).toBeInTheDocument();
  });
});
