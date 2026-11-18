import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render as rtlRender, screen, waitFor } from '@testing-library/react';
import { I18nProvider } from '@/i18n/client';
import { en } from '@/i18n/messages/en';
import type { ToolId } from '@/lib/account';
import type { ExportFeatureId } from '@/lib/plans';
import { SaveMediaProvider, useSaveMedia } from './SaveMedia';

/** Rendered on an English page, as the studio does. */
const render = (ui: React.ReactElement) =>
  rtlRender(ui, {
    wrapper: ({ children }) => (
      <I18nProvider locale="en" messages={en}>
        {children}
      </I18nProvider>
    ),
  });

function Harness({
  filename,
  mime,
  tool = 'grid',
  features,
  authorized,
}: {
  filename: string;
  mime?: string;
  tool?: ToolId;
  features?: ExportFeatureId[];
  authorized?: boolean;
}) {
  const { save } = useSaveMedia();
  return (
    <button onClick={() => void save({ blob: new Blob(['x'], { type: mime ?? 'image/png' }), filename, mime, tool, features, authorized })}>
      generate
    </button>
  );
}

/** The server's answers to /api/usage, in order (the last one repeats); a thrown error is a network failure. */
function serverSays(...answers: (number | Error)[]) {
  const calls: { url: string; body: unknown }[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
    const answer = answers[Math.min(calls.length - 1, answers.length - 1)];
    if (answer instanceof Error) throw answer;
    const body = answer === 403 ? { error: 'not_included', features: refused } : answer === 429 ? { error: 'limit_reached', features: refused } : { ok: answer === 200 };
    return new Response(JSON.stringify(body), { status: answer, headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}
/** What a 403 or 429 names. */
let refused: string[] = [];

function setNavigator(props: Partial<{ userAgent: string; canShare: unknown; share: unknown; maxTouchPoints: number }>) {
  Object.entries(props).forEach(([key, value]) => {
    Object.defineProperty(window.navigator, key, { value, configurable: true });
  });
}

let urlCounter = 0;

beforeEach(() => {
  urlCounter = 0;
  refused = [];
  // The server allows the save unless a test says otherwise.
  serverSays(200);
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:mock-${++urlCounter}`);
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  setNavigator({ userAgent: 'test', canShare: undefined, share: undefined, maxTouchPoints: 0 });
});

describe('SaveMedia sheet', () => {
  it('renders the ACTUAL media (object URL of the blob), not a generic icon', async () => {
    setNavigator({ userAgent: 'Desktop', canShare: undefined, share: undefined });
    render(
      <SaveMediaProvider>
        <Harness filename="value-study.png" mime="image/png" />
      </SaveMediaProvider>,
    );
    fireEvent.click(screen.getByText('generate'));
    const img = (await screen.findByAltText('Image preview')) as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('blob:mock-1');
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  });

  it('revokes the object URL when the sheet is closed', async () => {
    setNavigator({ userAgent: 'Desktop' });
    render(
      <SaveMediaProvider>
        <Harness filename="grid.png" />
      </SaveMediaProvider>,
    );
    fireEvent.click(screen.getByText('generate'));
    fireEvent.click(await screen.findByLabelText('Close'));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-1');
  });

  it('on desktop (no Web Share) shows a download-style Save label', async () => {
    setNavigator({ userAgent: 'Desktop', canShare: undefined, share: undefined });
    render(
      <SaveMediaProvider>
        <Harness filename="compare.gif" mime="image/gif" />
      </SaveMediaProvider>,
    );
    fireEvent.click(screen.getByText('generate'));
    // GIF wording, download primary (not "Save to Photos").
    expect(await screen.findByRole('button', { name: 'Save GIF' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save to Photos' })).toBeNull();
  });

  it('on iOS with Web Share shows "Save to Photos" and shares the file only', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    setNavigator({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      canShare: () => true,
      share,
    });
    render(
      <SaveMediaProvider>
        <Harness filename="compare.png" mime="image/png" />
      </SaveMediaProvider>,
    );
    fireEvent.click(screen.getByText('generate'));

    // Guidance text (EN) present.
    expect(await screen.findByText(/choose Save Image/i)).toBeInTheDocument();

    const btn = screen.getByRole('button', { name: 'Save to Photos' });
    fireEvent.click(btn);

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    // Files only — no title/text/url.
    const arg = share.mock.calls[0][0];
    expect(Object.keys(arg)).toEqual(['files']);
    expect(arg.files[0].name).toBe('compare.png');
    expect(arg.files[0].type).toBe('image/png');

    // Success closes the sheet and revokes the URL.
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Save to Photos' })).toBeNull());
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-1');
  });

  it('opens the full-screen long-press fallback with instructions', async () => {
    setNavigator({ userAgent: 'Desktop' });
    render(
      <SaveMediaProvider>
        <Harness filename="grid.png" />
      </SaveMediaProvider>,
    );
    fireEvent.click(screen.getByText('generate'));
    fireEvent.click(await screen.findByRole('button', { name: 'Open Image' }));
    expect(screen.getByText(/Press and hold the image/i)).toBeInTheDocument();
  });
});

// Every save is authorized by the server first (src/app/api/usage/route.ts):
// the tool must still be in the plan and saving must be too. Only a yes
// opens the sheet; anything else saves nothing and says why.
describe('SaveMedia authorization', () => {
  const sheet = () => screen.queryByAltText(/preview/i);
  const refusal = () => screen.findByRole('alertdialog');

  it('asks the server with the tool and what is saved before showing anything', async () => {
    const calls = serverSays(200);
    render(
      <SaveMediaProvider>
        <Harness filename="compare.gif" mime="image/gif" tool="compare" features={['export.gif_large']} />
      </SaveMediaProvider>,
    );
    fireEvent.click(screen.getByText('generate'));
    expect(await screen.findByAltText('GIF preview')).toBeInTheDocument();
    expect(calls).toEqual([{ url: '/api/usage', body: { tool: 'tool.compare', features: ['export.gif', 'export.gif_large'] } }]);
  });

  it('saves nothing when the plan does not include saving images, and says so', async () => {
    refused = ['export.image'];
    serverSays(403);
    render(
      <SaveMediaProvider>
        <Harness filename="grid.png" />
      </SaveMediaProvider>,
    );
    fireEvent.click(screen.getByText('generate'));
    const dialog = await refusal();
    expect(dialog).toHaveTextContent('Not included in your plan');
    expect(dialog).toHaveTextContent('Saved images are not part of your plan right now, so nothing was saved.');
    expect(screen.getByRole('link', { name: 'Compare plans' })).toHaveAttribute('href', '/app/plans');
    expect(sheet()).toBeNull();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('saves nothing from a tool the plan no longer includes', async () => {
    refused = ['tool.measure'];
    serverSays(403);
    render(
      <SaveMediaProvider>
        <Harness filename="measure.png" tool="measure" />
      </SaveMediaProvider>,
    );
    fireEvent.click(screen.getByText('generate'));
    expect(await refusal()).toHaveTextContent('Measure & Plan is no longer included in your plan, so nothing was saved. Nothing you made is deleted.');
    expect(sheet()).toBeNull();
  });

  it('saves nothing when the limit is used up', async () => {
    refused = ['export.gif'];
    serverSays(429);
    render(
      <SaveMediaProvider>
        <Harness filename="compare.gif" mime="image/gif" tool="compare" />
      </SaveMediaProvider>,
    );
    fireEvent.click(screen.getByText('generate'));
    expect(await refusal()).toHaveTextContent('The limit of your plan for GIFs is used up for now, so nothing was saved.');
    expect(sheet()).toBeNull();
  });

  it('fails closed when the server cannot be asked, and can try again', async () => {
    const calls = serverSays(new TypeError('Failed to fetch'), 200);
    render(
      <SaveMediaProvider>
        <Harness filename="grid.png" />
      </SaveMediaProvider>,
    );
    fireEvent.click(screen.getByText('generate'));
    const dialog = await refusal();
    expect(dialog).toHaveTextContent('Your plan could not be checked');
    expect(sheet()).toBeNull();
    expect(URL.createObjectURL).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByAltText('Image preview')).toBeInTheDocument();
    expect(calls).toHaveLength(2);
  });

  it('fails closed on a server error', async () => {
    serverSays(503);
    render(
      <SaveMediaProvider>
        <Harness filename="grid.png" />
      </SaveMediaProvider>,
    );
    fireEvent.click(screen.getByText('generate'));
    expect(await refusal()).toHaveTextContent('Nothing was saved: the server could not confirm your plan just now.');
    expect(sheet()).toBeNull();
  });

  it('does not ask twice for an export the server already authorized (a GIF, before encoding)', async () => {
    const calls = serverSays(503);
    render(
      <SaveMediaProvider>
        <Harness filename="compare.gif" mime="image/gif" tool="compare" authorized />
      </SaveMediaProvider>,
    );
    fireEvent.click(screen.getByText('generate'));
    expect(await screen.findByAltText('GIF preview')).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });
});
