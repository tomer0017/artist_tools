import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render as rtlRender, screen, within } from '@testing-library/react';
import { I18nProvider } from '@/i18n/client';
import { en } from '@/i18n/messages/en';
import { he } from '@/i18n/messages/he';
import { hexToHsv, hsvToHex } from './colorMath';
import { HARMONY_IDS, harmoniesOf, type HarmonyId } from './harmonies';
import { COPIED_MS } from './useCopyHex';
import ColorTab from './ColorTab';

// Color & Mixing with the wheel and the harmonies on one screen: every
// harmony follows the selected colour as it changes, a card shows its colours
// on the wheel, a swatch copies its HEX with feedback, in English and Hebrew,
// and the rest of the tool (Mixing, Skin Tones, the colour handed over from
// Measure, the photo sampler) works as before.

const project = vi.hoisted(() => ({ image: null as string | null }));
vi.mock('@/hooks/useProjectStore', () => ({ useProject: () => project }));
// The shared tool chrome needs the onboarding engine; only the task line matters here.
vi.mock('@/components/shell/ToolHeader', () => ({ default: ({ task }: { task?: React.ReactNode }) => <p data-testid="task">{task}</p> }));

const render = (locale: 'en' | 'he' = 'en') =>
  rtlRender(
    <I18nProvider locale={locale} messages={locale === 'he' ? he : en}>
      <ColorTab />
    </I18nProvider>,
  );

const hexField = () => screen.getByRole('textbox', { name: /HEX/ }) as HTMLInputElement;
const card = (id: HarmonyId) => document.querySelector<HTMLElement>(`[data-harmony="${id}"]`)!;
/** The colours a card shows, read from its swatches (each shows its HEX). */
const shown = (id: HarmonyId) =>
  within(card(id))
    .getAllByRole('button')
    .filter((b) => !b.hasAttribute('aria-pressed'))
    .map((b) => b.textContent!.match(/#[0-9A-F]{6}/)![0]);
/** What every card should show for a selected colour. */
const expected = (hex: string) =>
  Object.fromEntries(harmoniesOf(hex).map((h) => [h.id, h.colors.map((c) => c.hex.toUpperCase())]));
const allShown = () => Object.fromEntries(HARMONY_IDS.map((id) => [id, shown(id)]));
const dots = () => [...document.querySelectorAll<HTMLElement>('[data-harmony-dot]')].map((d) => d.dataset.harmonyDot);

let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  project.image = null;
  sessionStorage.clear();
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Wheel & Harmonies', () => {
  it('shows the wheel, the HEX field and all six harmonies on one screen; there is no Harmonies tab', () => {
    render();
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Wheel & Harmonies', 'Mixing', 'Skin Tones']);
    expect(screen.getByTestId('task')).toHaveTextContent('Pick a color and see every harmony at once');
    expect(screen.getByRole('slider', { name: 'Hue' })).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Saturation and brightness' })).toBeInTheDocument();
    expect(hexField().value).toBe('#D4827A');
    for (const name of ['Complementary', 'Split Complementary', 'Analogous', 'Triadic', 'Warm Version', 'Cool Version']) {
      expect(screen.getByRole('button', { name, pressed: false })).toBeInTheDocument();
    }
    expect(allShown()).toEqual(expected('#D4827A'));
    expect(screen.getByText('Choose a harmony to see it on the wheel')).toBeInTheDocument();
    expect(dots()).toEqual([]);
  });

  it('updates every harmony at once as a HEX code is typed', () => {
    render();
    fireEvent.change(hexField(), { target: { value: '#3366CC' } });
    expect(allShown()).toEqual(expected('#3366CC'));
    // Half-typed codes change nothing.
    fireEvent.change(hexField(), { target: { value: '#33' } });
    expect(allShown()).toEqual(expected('#3366CC'));
    fireEvent.change(hexField(), { target: { value: '#2a5faa' } });
    expect(allShown()).toEqual(expected('#2a5faa'));
  });

  it('turns the ring and moves through the square from the keyboard, and the harmonies follow', () => {
    render();
    const [h, s, v] = hexToHsv('#D4827A');
    const hue = screen.getByRole('slider', { name: 'Hue' });
    expect(hue).toHaveAttribute('aria-valuenow', String(h));
    fireEvent.keyDown(hue, { key: 'ArrowRight', shiftKey: true });
    expect(hue).toHaveAttribute('aria-valuenow', String(h + 10));
    expect(hexField().value).toBe(hsvToHex(h + 10, s, v));
    expect(allShown()).toEqual(expected(hsvToHex(h + 10, s, v)));

    const square = screen.getByRole('slider', { name: 'Saturation and brightness' });
    fireEvent.keyDown(square, { key: 'ArrowUp' });
    fireEvent.keyDown(square, { key: 'ArrowLeft' });
    expect(square).toHaveAttribute('aria-valuetext', `Saturation ${s - 1}%, brightness ${v + 1}%`);
    expect(hexField().value).toBe(hsvToHex(h + 10, s - 1, v + 1));
    expect(allShown()).toEqual(expected(hsvToHex(h + 10, s - 1, v + 1)));

    // Past 0° the ring wraps round.
    fireEvent.keyDown(hue, { key: 'Home' });
    fireEvent.keyDown(hue, { key: 'ArrowLeft' });
    expect(hue).toHaveAttribute('aria-valuenow', '359');
  });

  it('shows a chosen harmony on the wheel, one at a time; a dot makes its colour the base', () => {
    render();
    fireEvent.click(screen.getByRole('button', { name: 'Triadic' }));
    expect(screen.getByRole('button', { name: 'Triadic' })).toHaveAttribute('aria-pressed', 'true');
    const triadic = harmoniesOf('#D4827A')[3].colors;
    expect(dots()).toEqual([triadic[1].hex, triadic[2].hex]);
    expect(screen.getByText('Triadic: tap a dot to make it the base color')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Complementary' }));
    expect(screen.getByRole('button', { name: 'Triadic' })).toHaveAttribute('aria-pressed', 'false');
    const comp = harmoniesOf('#D4827A')[0].colors[1].hex;
    expect(dots()).toEqual([comp]);

    // The dot is the old "click a harmony colour to use it": the comp becomes the base.
    fireEvent.click(screen.getByRole('button', { name: `Make Comp (${comp.toUpperCase()}) the base color` }));
    expect(hexField().value).toBe(comp);
    expect(allShown()).toEqual(expected(comp));
    expect(dots()).toEqual([harmoniesOf(comp)[0].colors[1].hex]);

    // Pressed again, the card takes its colours off the wheel.
    fireEvent.click(screen.getByRole('button', { name: 'Complementary' }));
    expect(dots()).toEqual([]);
    expect(screen.getByText('Choose a harmony to see it on the wheel')).toBeInTheDocument();
  });

  it('says so when a grey has no hue to show', () => {
    render();
    fireEvent.change(hexField(), { target: { value: '#808080' } });
    fireEvent.click(screen.getByRole('button', { name: 'Triadic' }));
    expect(dots()).toEqual([]);
    expect(screen.getByText('Triadic: a gray has no hue to show on the wheel')).toBeInTheDocument();
  });
});

describe('copying a colour', () => {
  it('copies a swatch’s HEX, marks it Copied and reads it out, then returns to the HEX', async () => {
    vi.useFakeTimers();
    render();
    const triA = harmoniesOf('#D4827A')[3].colors[1].hex;
    const swatch = screen.getByRole('button', { name: `Copy Tri A ${triA.toUpperCase()}` });
    await act(async () => {
      fireEvent.click(swatch);
    });
    expect(writeText).toHaveBeenCalledWith(triA);
    expect(within(swatch).getByText('Copied')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(`Copied ${triA.toUpperCase()}`);
    // Only that swatch: the same colour elsewhere is not marked.
    expect(screen.getAllByText('Copied')).toHaveLength(1);
    // Copying is not choosing: the selected colour stays.
    expect(hexField().value).toBe('#D4827A');

    // The HEX is only hidden from sight meanwhile: the button keeps its name.
    expect(within(swatch).getByText(triA.toUpperCase())).toHaveClass('sr-only');
    act(() => vi.advanceTimersByTime(COPIED_MS));
    expect(within(swatch).queryByText('Copied')).toBeNull();
    expect(within(swatch).getByText(triA.toUpperCase())).not.toHaveClass('sr-only');
  });

  it('copies the selected colour from its Copy HEX button', async () => {
    render();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy HEX' }));
    });
    expect(writeText).toHaveBeenCalledWith('#D4827A');
    expect(screen.getByRole('status')).toHaveTextContent('Copied #D4827A');
  });

  it('falls back to the copy command without the Clipboard API (a page on plain http)', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true });
    render();
    const swatch = within(card('complementary')).getByRole('button', { name: 'Copy Base #D4827A' });
    await act(async () => {
      fireEvent.click(swatch);
    });
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(within(swatch).getByText('Copied')).toBeInTheDocument();
  });

  it('says Not copied when the clipboard refuses', async () => {
    writeText.mockRejectedValue(new Error('denied'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    Object.defineProperty(document, 'execCommand', { value: vi.fn(() => false), configurable: true });
    render();
    const comp = harmoniesOf('#D4827A')[0].colors[1].hex.toUpperCase();
    const swatch = screen.getByRole('button', { name: `Copy Comp ${comp}` });
    await act(async () => {
      fireEvent.click(swatch);
    });
    expect(within(swatch).getByText('Not copied')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(`Could not copy ${comp}`);
  });
});

describe('in Hebrew', () => {
  it('reads right to left around a wheel that stays left to right', () => {
    render('he');
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['גלגל והרמוניות', 'ערבוב', 'גווני עור']);
    expect(screen.getByRole('tablist').closest('[dir]')).toHaveAttribute('dir', 'rtl');
    expect(screen.getByTestId('task')).toHaveTextContent('לבחור צבע ולראות מיד את כל ההרמוניות שלו');
    // The wheel is positioned by pointer coordinates: left to right in every language.
    expect(screen.getByRole('slider', { name: 'גוון' }).closest('[dir]')).toHaveAttribute('dir', 'ltr');
    expect(screen.getByRole('slider', { name: 'רוויה ובהירות' })).toHaveAttribute('aria-valuetext', 'רוויה 42%, בהירות 83%');
    expect(screen.getByRole('button', { name: 'משלים', pressed: false })).toBeInTheDocument();
    expect(screen.getByText('הקשה על צבע מעתיקה את קוד ה-HEX שלו')).toBeInTheDocument();
    expect(screen.getByText('לבחור הרמוניה כדי לראות אותה על הגלגל')).toBeInTheDocument();
    // Colour codes and the analogous offsets stay left to right.
    const comp = harmoniesOf('#D4827A')[0].colors[1].hex.toUpperCase();
    expect(within(card('complementary')).getByText(comp)).toHaveAttribute('dir', 'ltr');
    expect(within(card('analogous')).getByText('−30°')).toHaveAttribute('dir', 'ltr');
    expect(within(card('triadic')).getByText('טריאדי א׳')).not.toHaveAttribute('dir');

    fireEvent.click(screen.getByRole('button', { name: 'טריאדי' }));
    expect(screen.getByText('טריאדי: הקשה על נקודה הופכת אותה לצבע הבסיס')).toBeInTheDocument();
    expect(dots()).toHaveLength(2);
  });

  it('copies with feedback in Hebrew', async () => {
    render('he');
    const comp = harmoniesOf('#D4827A')[0].colors[1].hex.toUpperCase();
    const swatch = screen.getByRole('button', { name: `העתקת משלים ${comp}` });
    await act(async () => {
      fireEvent.click(swatch);
    });
    expect(within(swatch).getByText('הועתק')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(`הועתק ${comp}`);
  });
});

describe('the rest of Color & Mixing, unchanged', () => {
  it('a Mixing recipe and a skin tone still become the selected colour, harmonies included', () => {
    render();
    fireEvent.click(screen.getByRole('button', { name: 'Triadic' }));
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Mixing' }));
    expect(screen.getByText('Grass Green')).toBeInTheDocument();
    fireEvent.click(screen.getByTitle('#4A8C2A'));
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Skin Tones' }));
    expect(screen.getByText('Light Skin')).toBeInTheDocument();
    expect(screen.getByText('Dark Skin')).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Wheel & Harmonies' }));
    expect(hexField().value).toBe('#4A8C2A');
    expect(allShown()).toEqual(expected('#4A8C2A'));
    // The harmony shown on the wheel is still shown after the visit.
    expect(screen.getByRole('button', { name: 'Triadic' })).toHaveAttribute('aria-pressed', 'true');
    expect(dots()).toHaveLength(2);
  });

  it('a colour sampled in Measure arrives on the wheel with all its harmonies', () => {
    sessionStorage.setItem('use-color-in-tab', '#112233');
    render();
    expect(hexField().value).toBe('#112233');
    expect(allShown()).toEqual(expected('#112233'));
    expect(sessionStorage.getItem('use-color-in-tab')).toBeNull();
  });

  it('with a photo loaded, the eyedropper opens the photo to sample', () => {
    project.image = 'data:image/png;base64,iVBORw0KGgo=';
    render();
    fireEvent.click(screen.getByRole('button', { name: 'Pick from image' }));
    expect(screen.getByRole('button', { name: 'Tap on image below ↓' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Pick color' })).toBeInTheDocument();
  });
});
