import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { I18nProvider } from '@/i18n/client';
import { en } from '@/i18n/messages/en';
import { he } from '@/i18n/messages/he';
import { PROJECT_STORAGE_KEY, ProjectProvider, useProject } from '@/hooks/useProjectStore';
import { drawExport } from '@/lib/grid/draw';
import { previewSize } from '@/lib/grid/geometry';
import GridTab from './GridTab';

// Create a Grid in the browser's DOM (jsdom), with the real project store:
// a grid saved before M1 opens and saves exactly as it did; the image turns
// without the photo ever changing; A4, square cells, exact zoom and moves;
// the blank grid; drag, wheel and pinch as before; every save goes through
// the authorized save (SaveMedia), in English and Hebrew, desktop and phone.

const mobile = vi.hoisted(() => ({ value: false }));
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => mobile.value }));
const save = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => true));
const authorize = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => true));
vi.mock('@/components/common/SaveMedia', () => ({ useSaveMedia: () => ({ save, authorize }) }));
// What the account has, and what each plan offers (the PDF is in no plan unless a test says so).
const account = vi.hoisted(() => ({ features: [] as string[], offer: { free: [] as string[], pro: [] as string[] } }));
vi.mock('@/components/shell/account', () => ({
  useHasFeature: (feature: string) => account.features.includes(feature),
  useAccount: () => ({ account: { offer: account.offer } }),
}));
// The PDF itself is built by jsPDF (tested on its own, src/lib/print): here, what Create a Grid hands it.
const buildGridPdf = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => new ArrayBuffer(8)));
vi.mock('@/lib/print/gridPdf', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/print/gridPdf')>()), buildGridPdf }));
vi.mock('jspdf', () => ({ jsPDF: class {}, GState: class {} }));
// The PDF button is hidden in the product (src/lib/print/ui.ts); the tests of the code behind it turn it on.
const ui = vi.hoisted(() => ({ GRID_PDF_BUTTON: false }));
vi.mock('@/lib/print/ui', () => ui);
vi.mock('@/lib/saveMedia', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/saveMedia')>()),
  canvasToBlob: vi.fn(async () => new Blob(['png'], { type: 'image/png' })),
}));
vi.mock('@/components/shell/ToolHeader', () => ({
  default: ({ task, actions }: { task?: React.ReactNode; actions?: React.ReactNode }) => (
    <header>
      <p data-testid="task">{task}</p>
      {actions}
    </header>
  ),
}));
vi.mock('@/components/shell/ToolEmptyState', () => ({
  default: ({ heading, children }: { heading: string; children?: React.ReactNode }) => (
    <section>
      <h2>{heading}</h2>
      {children}
    </section>
  ),
}));
vi.mock('@/components/common/ImageUploader', () => ({ default: ({ label }: { label?: string }) => <button type="button">{label ?? 'Replace'}</button> }));

// ─── A canvas that records its calls, images that load at a known size ───
type Call = [string, ...unknown[]];
const logs = new Map<HTMLCanvasElement, Call[]>();
function recorder(log: Call[]) {
  return new Proxy({} as Record<string, unknown>, {
    get: (_, prop) => (typeof prop === 'string' ? (...args: unknown[]) => void log.push([prop, ...args]) : undefined),
    set: (_, prop, value) => {
      log.push([`set ${String(prop)}`, value]);
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}
const PHOTO = 'data:image/png;base64,cGhvdG8=';
class FakeImage {
  onload: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  naturalWidth = 0;
  naturalHeight = 0;
  #src = '';
  set src(value: string) {
    this.#src = value;
    this.naturalWidth = 1200;
    this.naturalHeight = 800;
    queueMicrotask(() => this.onload?.());
  }
  get src() {
    return this.#src;
  }
}
/** Image arguments are compared as one placeholder: the decoded photo itself is not the point. */
const withoutImage = (log: Call[]) => log.map((c) => (c[0] === 'drawImage' ? ['drawImage', 'IMAGE', ...c.slice(2)] : c));

beforeEach(() => {
  logs.clear();
  save.mockClear();
  authorize.mockClear();
  authorize.mockResolvedValue(true);
  buildGridPdf.mockClear();
  account.features = [];
  account.offer = { free: [], pro: [] };
  ui.GRID_PDF_BUTTON = false;
  mobile.value = false;
  localStorage.clear();
  vi.stubGlobal('Image', FakeImage);
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    if (!logs.has(this)) logs.set(this, []);
    return recorder(logs.get(this)!) as never;
  });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 1016 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 716 });
  HTMLElement.prototype.setPointerCapture = vi.fn();
  // jsdom has no PointerEvent: a mouse event with a pointer id carries the coordinates.
  vi.stubGlobal('PointerEvent', class extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
    }
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (HTMLElement.prototype as Partial<HTMLElement>).setPointerCapture;
});

/** A project saved before M1: no rotation, no square cells. */
const OLD_GRID = { canvasWidth: 40, canvasHeight: 50, unit: 'cm', columns: 3, rows: 5, lineColor: '#ef4444', lineOpacity: 0.7, lineWidth: 2, imageOffsetX: 1.5, imageOffsetY: -2, imageScale: 1.3 };
const oldProject = (gridSettings: Record<string, unknown> = OLD_GRID) => ({
  image: PHOTO,
  calibration: null,
  measurements: [],
  sampledColors: [],
  gridSettings,
  gridImage: PHOTO,
  gridImageInitialized: true,
  savedAt: 1_731_000_000_000,
});

let store: ReturnType<typeof useProject> | null = null;
function Probe() {
  store = useProject();
  return null;
}
/** Rendered with the project saved in this browser, once its photo has loaded. */
async function renderGrid(project: unknown = oldProject(), locale: 'en' | 'he' = 'en') {
  localStorage.setItem(PROJECT_STORAGE_KEY, JSON.stringify(project));
  const view = render(
    <I18nProvider locale={locale} messages={locale === 'he' ? he : en}>
      <ProjectProvider>
        <GridTab />
        <Probe />
      </ProjectProvider>
    </I18nProvider>,
  );
  await act(async () => {});
  return view;
}
const settings = () => store!.gridSettings;
const exportLog = () => [...logs.entries()].filter(([c]) => c.width === 2400);

async function saveVia(name: string) {
  const before = exportLog().length;
  fireEvent.click(screen.getByRole('button', { name }));
  await waitFor(() => expect(save).toHaveBeenCalled());
  const [canvas, log] = exportLog()[before];
  return { canvas, log, media: save.mock.calls.at(-1)![0] as Record<string, unknown> };
}

describe('a grid saved before M1', () => {
  it('opens and saves exactly as it did: same settings, same file, the same canvas calls', async () => {
    await renderGrid();
    expect(settings()).toEqual({ ...OLD_GRID, rotation: 0, cellMode: 'divisions', cellSize: 3 });
    expect(screen.getByText('40×50 cm · 3×5 grid')).toBeInTheDocument();
    expect(screen.getByTestId('task')).toHaveTextContent('3×5 grid on a 40×50 cm canvas — draw the same grid on yours');

    const { canvas, log, media } = await saveVia('Save grid image');
    expect(media).toEqual({ blob: expect.any(Blob), filename: 'grid-3x5-40x50cm.png', mime: 'image/png', title: 'Save grid', tool: 'grid' });
    expect([canvas.width, canvas.height]).toEqual([2400, 3000]);
    const expected: Call[] = [];
    drawExport(recorder(expected), settings(), { source: new FakeImage() as unknown as HTMLImageElement, naturalWidth: 1200, naturalHeight: 800 });
    expect(withoutImage(log)).toStrictEqual(withoutImage(expected));
  });

  it('the preview is drawn the same way, at the size that fits', async () => {
    await renderGrid();
    const preview = [...logs.entries()].find(([c]) => c.width !== 2400)!;
    await waitFor(() => expect(preview[1].some((c) => c[0] === 'strokeRect')).toBe(true));
    const size = previewSize(settings(), 1000, 700);
    expect([preview[0].width, preview[0].height]).toEqual([size.w, size.h]);
    expect(preview[1].filter((c) => c[0] === 'drawImage')).toHaveLength(1);
  });
});

describe('rotation', () => {
  it('turns the image on the grid left, right and half way; the photo itself never changes', async () => {
    await renderGrid();
    fireEvent.click(screen.getByRole('button', { name: 'Rotate right 90°' }));
    expect(settings().rotation).toBe(90);
    fireEvent.click(screen.getByRole('button', { name: 'Rotate 180°' }));
    expect(settings().rotation).toBe(270);
    fireEvent.click(screen.getByRole('button', { name: 'Rotate left 90°' }));
    expect(settings().rotation).toBe(180);
    expect(store!.gridImage).toBe(PHOTO);
    await waitFor(() => expect(JSON.parse(localStorage.getItem(PROJECT_STORAGE_KEY)!).gridSettings.rotation).toBe(180));
    expect(JSON.parse(localStorage.getItem(PROJECT_STORAGE_KEY)!).gridImage).toBe(PHOTO);

    const { log } = await saveVia('Save grid image');
    expect(log.find((c) => c[0] === 'rotate')![1]).toBeCloseTo(Math.PI, 12);
  });
});

describe('canvas size and cells', () => {
  it('A4 portrait and landscape are exactly 21 × 29.7 cm, also from inches', async () => {
    await renderGrid(oldProject({ ...OLD_GRID, unit: 'in' }));
    fireEvent.click(screen.getByText('Customize grid & canvas'));
    fireEvent.click(screen.getByRole('button', { name: 'A4 portrait' }));
    expect(settings()).toMatchObject({ canvasWidth: 21, canvasHeight: 29.7, unit: 'cm' });
    expect(screen.getByRole('button', { name: 'A4 portrait' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('21×29.7 cm · 3×5 grid')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'A4 landscape' }));
    expect(settings()).toMatchObject({ canvasWidth: 29.7, canvasHeight: 21, unit: 'cm' });
    const { canvas } = await saveVia('Save grid image');
    expect([canvas.width, canvas.height]).toEqual([2400, Math.round(2400 / (29.7 / 21))]);
  });

  it('square cells: chosen from the presets, sized by steps or typed, within limits; a preset goes back to columns × rows', async () => {
    await renderGrid(oldProject({ ...OLD_GRID, canvasWidth: 21, canvasHeight: 29.7 }));
    const presets = screen.getByRole('radiogroup', { name: 'Grid preset' });
    fireEvent.click(within(presets).getByRole('radio', { name: 'Square cells of 3 cm' }));
    expect(settings().cellMode).toBe('square');
    expect(screen.getByText('21×29.7 cm · 3 cm squares (7×10)')).toBeInTheDocument();
    expect(screen.getByTestId('task')).toHaveTextContent('3 cm squares on a 21×29.7 cm canvas — draw the same squares on yours');
    expect(screen.getAllByText('7×10 cells. The last column or row is partial.')[0]).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: 'Larger cells' })[0]);
    expect(settings().cellSize).toBe(3.5);
    const field = screen.getAllByRole('spinbutton', { name: 'Cell size in cm' })[0];
    fireEvent.change(field, { target: { value: '2.5' } });
    expect(settings().cellSize).toBe(3.5); // applied on Enter or leaving the field, not while typing
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(settings().cellSize).toBe(2.5);
    fireEvent.change(field, { target: { value: '0.01' } });
    fireEvent.blur(field);
    expect(settings().cellSize).toBe(0.5);
    fireEvent.click(screen.getAllByRole('button', { name: 'Smaller cells' })[0]);
    expect(settings().cellSize).toBe(0.5);

    fireEvent.click(within(presets).getByRole('radio', { name: /4 by 4 grid/ }));
    expect(settings()).toMatchObject({ cellMode: 'divisions', columns: 4, rows: 4 });
    expect(within(presets).getByRole('radio', { name: /Square cells/ })).toHaveAttribute('aria-checked', 'false');
  });
});

describe('the image: exact zoom and moves, and the gestures as before', () => {
  it('zooms by 1 %, to a typed value within 25–800 %, and moves by 0.1 of the unit', async () => {
    await renderGrid(oldProject({ ...OLD_GRID, imageScale: 1, imageOffsetX: 0, imageOffsetY: 0 }));
    fireEvent.click(screen.getByText('Customize grid & canvas'));
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in by 1%' }));
    expect(settings().imageScale).toBe(1.01);
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out by 1%' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out by 1%' }));
    expect(settings().imageScale).toBe(0.99);
    const percent = screen.getByRole('spinbutton', { name: 'Image scale in percent' });
    fireEvent.change(percent, { target: { value: '150' } });
    fireEvent.keyDown(percent, { key: 'Enter' });
    expect(settings().imageScale).toBe(1.5);
    fireEvent.change(percent, { target: { value: '5000' } });
    fireEvent.blur(percent);
    expect(settings().imageScale).toBe(8);

    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole('button', { name: 'Move the image right by 0.1 cm' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move the image up by 0.1 cm' }));
    expect(settings()).toMatchObject({ imageOffsetX: 0.3, imageOffsetY: -0.1 });
    fireEvent.click(screen.getByRole('button', { name: 'Move the image left by 0.1 cm' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move the image down by 0.1 cm' }));
    expect(settings()).toMatchObject({ imageOffsetX: 0.2, imageOffsetY: 0 });
    fireEvent.click(screen.getByText('Center image'));
    expect(settings()).toMatchObject({ imageOffsetX: 0, imageOffsetY: 0 });
  });

  it('drag, wheel and pinch still move and zoom the image as before', async () => {
    const { container } = await renderGrid(oldProject({ ...OLD_GRID, imageScale: 1, imageOffsetX: 0, imageOffsetY: 0 }));
    const canvas = container.querySelector('canvas')!;
    const scale = Math.min(1000 / 40, 700 / 50);
    fireEvent.pointerDown(canvas, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 170, clientY: 72, pointerId: 1 });
    fireEvent.pointerUp(canvas, { pointerId: 1 });
    expect(settings().imageOffsetX).toBeCloseTo(70 / scale, 9);
    expect(settings().imageOffsetY).toBeCloseTo(-28 / scale, 9);

    fireEvent.wheel(canvas, { deltaY: -100 });
    expect(settings().imageScale).toBeCloseTo(1.05, 12);
    fireEvent.wheel(canvas, { deltaY: 100 });
    expect(settings().imageScale).toBeCloseTo(1.05 * 0.95, 12);

    const start = settings().imageScale;
    fireEvent.touchStart(canvas, { touches: [{ clientX: 0, clientY: 0 }, { clientX: 100, clientY: 0 }] });
    fireEvent.touchMove(canvas, { touches: [{ clientX: 0, clientY: 0 }, { clientX: 200, clientY: 0 }] });
    fireEvent.touchEnd(canvas, { touches: [] });
    expect(settings().imageScale).toBeCloseTo(start * 2, 12);
    fireEvent.touchStart(canvas, { touches: [{ clientX: 0, clientY: 0 }, { clientX: 100, clientY: 0 }] });
    fireEvent.touchMove(canvas, { touches: [{ clientX: 0, clientY: 0 }, { clientX: 5000, clientY: 0 }] });
    expect(settings().imageScale).toBe(8);
  });
});

describe('the blank grid', () => {
  it('is the same grid on white, without the photo, saved through the same authorized save', async () => {
    await renderGrid(oldProject({ ...OLD_GRID, canvasWidth: 21, canvasHeight: 29.7, cellMode: 'square', cellSize: 3 }));
    const { canvas, log, media } = await saveVia('Save blank grid');
    expect(media).toEqual({ blob: expect.any(Blob), filename: 'grid-blank-3cm-squares-21x29.7cm.png', mime: 'image/png', title: 'Save blank grid', tool: 'grid' });
    expect([canvas.width, canvas.height]).toEqual([2400, 3394]);
    expect(log.slice(0, 3)).toStrictEqual([['set fillStyle', '#ffffff'], ['fillRect', 0, 0, 2400, 3394], ['set strokeStyle', '#000000']]);
    expect(log.some((c) => c[0] === 'drawImage')).toBe(false);
    // Six vertical lines (7 whole cells of 3 cm across 21 cm), nine horizontal.
    expect(log.filter((c) => c[0] === 'moveTo')).toHaveLength(15);

    // The grid image itself is saved the same way, with the photo.
    const saved = await saveVia('Save grid image');
    expect(saved.media).toMatchObject({ filename: 'grid-3cm-squares-21x29.7cm.png', tool: 'grid' });
    expect(saved.log.some((c) => c[0] === 'drawImage')).toBe(true);
  });

  it('a refused save saves nothing: the tool never writes a file itself', async () => {
    save.mockResolvedValueOnce(false);
    const createObjectURL = vi.spyOn(URL, 'createObjectURL');
    await renderGrid();
    await saveVia('Save blank grid');
    expect(save).toHaveBeenCalledTimes(1);
    expect(createObjectURL).not.toHaveBeenCalled();
  });
});

describe('on a phone, and in Hebrew', () => {
  it('phone: presets with square cells, the rotations and both saves under the grid', async () => {
    mobile.value = true;
    await renderGrid();
    const presets = screen.getByRole('radiogroup', { name: 'Grid preset' });
    expect(within(presets).getAllByRole('radio')).toHaveLength(4);
    fireEvent.click(within(presets).getByRole('radio', { name: 'Square cells of 3 cm' }));
    expect(screen.getByRole('spinbutton', { name: 'Cell size in cm' })).toBeInTheDocument();
    for (const name of ['Rotate left 90°', 'Rotate 180°', 'Rotate right 90°', 'Save grid image', 'Save blank grid']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole('tab', { name: 'Customize' }));
    expect(screen.getByRole('button', { name: 'A4 portrait' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move the image left by 0.1 cm' })).toBeInTheDocument();
  });

  it('Hebrew: every new control is translated; numbers and the canvas stay left to right', async () => {
    await renderGrid(oldProject(), 'he');
    for (const name of ['סיבוב שמאלה ב־90°', 'סיבוב ב־180°', 'סיבוב ימינה ב־90°', 'שמירת רשת ריקה', 'שמירת תמונת הרשת']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    expect(screen.getByRole('radio', { name: 'משבצות ריבועיות של 3 cm' })).toBeInTheDocument();
    fireEvent.click(screen.getByText('התאמת הרשת והבד'));
    for (const name of ['A4 לאורך', 'A4 לרוחב', 'הקטנה ב־1%', 'הגדלה ב־1%', 'הזזת התמונה ימינה ב־0.1 cm']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    expect(screen.getByRole('tab', { name: 'משבצות ריבועיות' })).toBeInTheDocument();
    const { media } = await saveVia('שמירת רשת ריקה');
    expect(media).toMatchObject({ title: 'שמירת רשת ריקה', filename: 'grid-blank-3x5-40x50cm.png' });
  });
});

describe('the A4 PDF', () => {
  const pdfButton = () => screen.queryByRole('button', { name: 'Save PDF (A4)' });

  it('is not in the interface, whatever the account has (the owner kept the PNG): saving images is as before', async () => {
    account.features = ['export.pdf'];
    account.offer = { free: ['export.pdf'], pro: ['export.pdf'] };
    await renderGrid(oldProject());
    expect(screen.queryByRole('button', { name: /PDF/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Save grid image' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save blank grid' })).toBeInTheDocument();
  });

  describe('the code behind it, kept for later (with the button switched on)', () => {
    beforeEach(() => {
      ui.GRID_PDF_BUTTON = true;
    });

    it('is offered only where it can be had: hidden while no plan has it, locked where another plan does, ready where included', async () => {
      const view = await renderGrid();
      expect(pdfButton()).toBeNull();
      view.unmount();
      account.offer = { free: [], pro: ['export.pdf'] };
      const locked = await renderGrid();
      // Locked in words as well as by the icon.
      expect(pdfButton()).toBeNull();
      const lockedButton = screen.getByRole('button', { name: 'Save PDF (A4) (Locked)' });
      expect(lockedButton.querySelector('.lucide-lock')).not.toBeNull();
      locked.unmount();
      account.features = ['export.pdf'];
      await renderGrid();
      expect(pdfButton()!.querySelector('.lucide-lock')).toBeNull();
    });

    it('asks the server first: a refusal makes nothing; a yes makes both pages and saves them as one authorized PDF', async () => {
      account.features = ['export.pdf'];
      authorize.mockResolvedValueOnce(false);
      await renderGrid(oldProject({ ...OLD_GRID, canvasWidth: 21, canvasHeight: 29.7, cellMode: 'square', cellSize: 3 }));
      fireEvent.click(pdfButton()!);
      await waitFor(() => expect(authorize).toHaveBeenCalledWith({ tool: 'grid', features: ['export.pdf'] }));
      await act(async () => {});
      expect(buildGridPdf).not.toHaveBeenCalled();
      expect(save).not.toHaveBeenCalled();

      fireEvent.click(pdfButton()!);
      await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
      expect(authorize).toHaveBeenCalledTimes(2);
      const input = buildGridPdf.mock.calls[0][1] as { layout: { orientation: string; scale: number }; reference: Uint8Array; words: Record<string, string>; rtl: boolean };
      expect(input.layout.orientation).toBe('portrait');
      expect(input.reference).toBeInstanceOf(Uint8Array);
      expect(input.rtl).toBe(false);
      expect(input.words).toEqual({
        title: 'Grid for a 21×29.7 cm canvas',
        reference: 'Reference with grid',
        blank: 'Blank grid',
        detail: ['3 cm squares (25.3 mm on this page)', '84.4% of 21×29.7 cm'],
        print: 'Print at 100% (Actual size). The bar below must measure 50 mm.',
        bar: '50 mm',
      });
      const media = save.mock.calls[0][0] as Record<string, unknown>;
      expect(media).toMatchObject({ filename: 'grid-3cm-squares-21x29.7cm-a4.pdf', mime: 'application/pdf', title: 'Save PDF (A4)', tool: 'grid', authorized: true });
      expect((media.blob as Blob).type).toBe('application/pdf');
      expect(media.preview).toBeInstanceOf(Blob);
    });

    it('in Hebrew: the words on the pages are Hebrew, right to left', async () => {
      account.features = ['export.pdf'];
      await renderGrid(oldProject(), 'he');
      fireEvent.click(screen.getByRole('button', { name: 'שמירת PDF\u200f (A4)' }));
      await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
      const input = buildGridPdf.mock.calls[0][1] as { words: Record<string, string>; rtl: boolean };
      expect(input.rtl).toBe(true);
      expect(input.words.print).toBe('להדפיס ב־100%, בגודל אמיתי. הפס שלמטה צריך להיות באורך 50 מ״מ.');
      expect(input.words.reference).toBe('תמונת הייחוס עם הרשת');
    });

    it('on a phone: short labels under the grid, their full names kept', async () => {
      mobile.value = true;
      account.features = ['export.pdf'];
      await renderGrid();
      expect(screen.getByRole('button', { name: 'Save blank grid' })).toHaveTextContent('Blank grid');
      expect(screen.getByRole('button', { name: 'Save PDF (A4)' })).toHaveTextContent('PDF');
    });
  });
});

describe('Prepare Worksheets (M3)', () => {
  const button = (name = 'Prepare worksheets') => screen.queryByRole('button', { name });

  it('is offered only where it can be had: hidden while no plan has it, locked where another plan does, ready where included', async () => {
    const view = await renderGrid(oldProject());
    expect(screen.queryByRole('button', { name: /worksheets/i })).toBeNull();
    view.unmount();
    account.offer = { free: [], pro: ['export.worksheets'] };
    const locked = await renderGrid(oldProject());
    expect(button()).toBeNull();
    expect(button('Prepare worksheets (Locked)')!.querySelector('.lucide-lock')).not.toBeNull();
    locked.unmount();
    account.features = ['export.worksheets'];
    await renderGrid(oldProject());
    expect(button()!.querySelector('.lucide-lock')).toBeNull();
  });

  it('opens with this grid: its canvas and grid, the image saves unchanged beside it', async () => {
    account.features = ['export.worksheets'];
    await renderGrid(oldProject());
    expect(screen.getByRole('button', { name: 'Save grid image' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save blank grid' })).toBeInTheDocument();
    fireEvent.click(button()!);
    const dialog = screen.getByRole('dialog', { name: 'Prepare worksheets' });
    expect(within(dialog).getByRole('checkbox', { name: /^Reference with grid/ })).toHaveAccessibleName(/3×5 grid on a 40×50 cm canvas/);
    expect(dialog).toHaveTextContent('The canvas, grid and framing come from Create a Grid.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog', { name: 'Prepare worksheets' })).toBeNull();
  });

  it('on a phone: a short label beside the saves, its full name kept; in Hebrew too', async () => {
    mobile.value = true;
    account.features = ['export.worksheets'];
    const view = await renderGrid(oldProject());
    expect(button()).toHaveTextContent('Worksheets');
    view.unmount();
    await renderGrid(oldProject(), 'he');
    expect(screen.getByRole('button', { name: 'הכנת דפי תרגול' })).toHaveTextContent('דפי תרגול');
  });
});
