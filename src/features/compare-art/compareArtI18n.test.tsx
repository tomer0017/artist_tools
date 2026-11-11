import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render as rtlRender, screen, within } from '@testing-library/react';
import { I18nProvider } from '@/i18n/client';
import { en } from '@/i18n/messages/en';
import { he } from '@/i18n/messages/he';
import { CompareProvider } from './compareArtState';
import { STORAGE_KEY } from './compareArtStorage';
import CompareArt from './CompareArt';
import CompareUploadStep from './CompareUploadStep';
import CompareExportSheet from './CompareExportSheet';
import { AlignSheet, ModeSheet } from './CompareSheets';
import { CompareIntroModal } from './onboarding';

// Shared studio chrome is not under test here: the save sheet (the export
// sheet only needs `save`), the tool header (it needs the onboarding engine)
// and the canvas (jsdom cannot draw).
vi.mock('@/components/common/SaveMedia', () => ({ useSaveMedia: () => ({ save: vi.fn() }) }));
vi.mock('@/components/shell/ToolHeader', () => ({
  default: ({ actions }: { actions?: React.ReactNode }) => <div>{actions}</div>,
  HeaderIconButton: ({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) => (
    <button aria-label={label} onClick={onClick}>{children}</button>
  ),
  StepIndicator: ({ steps, onSelect }: { steps: string[]; onSelect?: (i: number) => void }) => (
    <ol aria-label="Progress">{steps.map((s, i) => <li key={s}><button onClick={() => onSelect?.(i)}>{s}</button></li>)}</ol>
  ),
}));
vi.mock('./CompareCanvas', () => ({ default: () => <div dir="ltr" />, computeAnchorTransform: () => null }));

const render = (ui: React.ReactElement, locale: 'en' | 'he' = 'en') =>
  rtlRender(
    <I18nProvider locale={locale} messages={locale === 'he' ? he : en}>
      <CompareProvider>{ui}</CompareProvider>
    </I18nProvider>,
  );

/** A saved session with both images in Split mode: the workspace opens on the Compare step. */
function restoreSplitComparison() {
  const meta = { width: 100, height: 80 };
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ version: 1, artwork: 'data:a', reference: 'data:r', artworkMeta: meta, referenceMeta: meta, mode: 'split' }),
  );
}

const upload = <CompareUploadStep onRequestCrop={() => {}} onContinue={() => {}} />;
const align = (
  <AlignSheet
    selectedLayer="reference"
    setSelectedLayer={() => {}}
    nudgeStep="normal"
    setNudgeStep={() => {}}
    cropActive={false}
    onToggleCrop={() => {}}
    onRecrop={() => {}}
  />
);

describe('Compare & Correct in English and Hebrew', () => {
  beforeEach(() => localStorage.clear());

  it('keeps the English upload step, with its small Hebrew hints', () => {
    render(upload);
    expect(screen.getByText('Your Artwork')).toBeInTheDocument();
    expect(screen.getByText('הציור שלי')).toHaveAttribute('dir', 'rtl');
    expect(screen.getByText('רפרנס')).toBeInTheDocument();
    expect(screen.getByText('השוואת ציור — הוסיפו צילום של הציור ואת הרפרנס.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Continue to Align/ })).toBeDisabled();
    expect(screen.getByText('Add both images to continue.')).toBeInTheDocument();
  });

  it('speaks Hebrew on Hebrew pages, without repeating the hints, and keeps the two images in place', () => {
    render(upload, 'he');
    expect(screen.getByText('הציור שלך')).toBeInTheDocument();
    expect(screen.queryByText('הציור שלי')).toBeNull();
    expect(screen.queryByText('Your Artwork')).toBeNull();
    expect(screen.getByRole('button', { name: /להמשיך ליישור/ })).toBeDisabled();
    // Artwork on the left, reference on the right, as in the comparison itself.
    const artworkSlot = screen.getByText('הציור שלך').closest('[dir]')!;
    expect(artworkSlot).toHaveAttribute('dir', 'rtl');
    expect(artworkSlot.parentElement).toHaveAttribute('dir', 'ltr');
  });

  it('says the colour note once in Hebrew, and twice (English, then Hebrew) in English', () => {
    const note = 'השוואת הצבע מושפעת מהתאורה ומאיזון הלבן בתצלום הציור.';
    const { unmount } = render(<ModeSheet />);
    fireEvent.click(screen.getByRole('button', { name: 'Difference' }));
    expect(screen.getByText('Color comparison depends on the lighting and white balance of the artwork photo.')).toBeInTheDocument();
    expect(screen.getAllByText(note)).toHaveLength(1);
    unmount();

    render(<ModeSheet />, 'he');
    fireEvent.click(screen.getByRole('button', { name: 'הבדלים' }));
    expect(screen.getByRole('group', { name: 'רגישות' })).toBeInTheDocument();
    expect(screen.getAllByText(note)).toHaveLength(1);
    expect(screen.queryByText(/Color comparison/)).toBeNull();
  });

  it('introduces the tool in both languages, with the blinking words kept', () => {
    const { unmount } = render(<CompareIntroModal open onStart={() => {}} onClose={() => {}} />);
    expect(screen.getByRole('dialog', { name: 'How Compare Art works' })).toBeInTheDocument();
    expect(screen.getByText('jump out').tagName).toBe('SPAN');
    expect(screen.getByRole('button', { name: 'Start comparing' })).toBeInTheDocument();
    unmount();

    render(<CompareIntroModal open onStart={() => {}} onClose={() => {}} />, 'he');
    expect(screen.getByRole('dialog', { name: 'איך עובד כלי ההשוואה' })).toBeInTheDocument();
    expect(screen.getByText('קופץ לעין').tagName).toBe('SPAN');
    expect(screen.getByRole('button', { name: 'להתחיל להשוות' })).toBeInTheDocument();
  });

  it('keeps the precision pad left to right, with translated labels', () => {
    render(align, 'he');
    const left = screen.getByRole('button', { name: 'הזזה שמאלה' });
    expect(left.closest('[dir]')).toHaveAttribute('dir', 'ltr');
    expect(screen.getByRole('button', { name: 'סיבוב עם כיוון השעון' })).toBeInTheDocument();
  });

  it('walks the steps in English, word for word as before', () => {
    restoreSplitComparison();
    render(<CompareArt />);
    const progress = screen.getByRole('list', { name: 'Progress' });
    expect(progress).toHaveTextContent('ImagesAlignCompareSave');
    expect(screen.getByText('Split').parentElement).toHaveTextContent('Split — drag the divider on the image');
    expect(screen.getByRole('group', { name: 'Show' })).toHaveAttribute('dir', 'ltr');
    expect(screen.getByRole('switch', { name: 'Grid off' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Align' }));
    expect(screen.getByText('Align the images')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Smart Align/ }));
    expect(screen.getByText('Smart Align · point 1 of 4')).toBeInTheDocument();
    expect(screen.getByText('Tap a clear feature — e.g. the left eye.')).toBeInTheDocument();
    expect(screen.getAllByText('Your artwork')).toHaveLength(2);
  });

  it('walks the steps in Hebrew', () => {
    restoreSplitComparison();
    render(<CompareArt />, 'he');
    expect(screen.getByRole('list', { name: 'Progress' })).toHaveTextContent('תמונותיישורהשוואהשמירה');
    expect(screen.getByText('מסך מפוצל').parentElement).toHaveTextContent('מסך מפוצל — אפשר לגרור את קו החלוקה על התמונה');
    expect(screen.getByRole('switch', { name: 'רשת כבויה' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'הבא: שמירה' }));
    expect(screen.getByText('יצירת GIF להשוואה')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ליצור ולשמור GIF' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'יישור' }));
    fireEvent.click(screen.getByRole('button', { name: /Smart Align/ }));
    expect(screen.getByText('Smart Align · נקודה 1 מתוך 4')).toBeInTheDocument();
    expect(screen.getByText('להקיש על פרט ברור — למשל העין השמאלית.')).toBeInTheDocument();
  });

  it('keeps the Pro locks and their names on the save sheet', async () => {
    const { unmount } = render(<CompareExportSheet />);
    const size = await screen.findByRole('group', { name: 'GIF output size' });
    expect(within(size).getByRole('button', { name: /^L\s*\(Pro\)$/ })).toBeInTheDocument();
    const animation = screen.getByRole('group', { name: 'GIF animation type' });
    expect(within(animation).getByRole('button', { name: /^Compare\+Diff\s*\(Pro\)$/ })).toBeInTheDocument();
    expect(screen.getByText('Large size and Compare+Diff are Pro features.')).toBeInTheDocument();
    // No image yet: the crop is clamped to one pixel.
    expect(screen.getByText('Output ≈ 1×1px · 11 frames')).toBeInTheDocument();
    unmount();

    render(<CompareExportSheet />, 'he');
    const hebrewSize = await screen.findByRole('group', { name: 'גודל ה-GIF' });
    expect(within(hebrewSize).getByRole('button', { name: /^L\s*\(Pro\)$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'יצירת GIF' })).toBeInTheDocument();
    // The size reads left to right inside the Hebrew sentence.
    expect(screen.getByText('פלט ≈ ⁦1×1px⁩ · 11 פריימים')).toBeInTheDocument();
  });
});
