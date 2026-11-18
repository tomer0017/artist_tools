import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CatalogReadNotice } from './CatalogReadNotice';

// Admin → Plans on a catalog this release cannot fully use (ADR-0014): what
// it keeps without applying is said quietly; withheld features or a catalog
// it cannot read are alerts, and the draft controls are turned off.

const actions = vi.hoisted(() => ({ startDraft: vi.fn(), publishConfig: vi.fn(), discardConfigDraft: vi.fn(), restoreConfig: vi.fn() }));
vi.mock('../config-actions', () => actions);
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/components/account/parts', () => ({ ReauthPanel: () => null }));

const { DraftBar } = await import('../ConfigControls');
const viewer = { email: 'admin@example.com', hasPassword: false, returnTo: '/admin/plans' };

describe('what Admin → Plans says about a catalog version it read', () => {
  it('nothing, when this release knows and applies all of it', () => {
    const { container } = render(<CatalogReadNotice label="version 6 (live)" status="ok" notes={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('what it keeps without applying: a status, not an alert', () => {
    render(<CatalogReadNotice label="version 7 (live)" status="ok" notes={['Feature ids this version of the app does not know: learn.curriculum.']} />);
    const notice = screen.getByRole('status');
    expect(notice).toHaveTextContent('version 7 (live) also holds settings this version of the app does not use');
    expect(notice).toHaveTextContent('kept exactly as they are when you edit and publish here');
    expect(notice).toHaveTextContent('learn.curriculum');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('features withheld: an alert, and it is not edited here', () => {
    render(<CatalogReadNotice label="version 7 (live)" status="partial" notes={['Free: Saved images is withheld here, because it has a quota this version of the app cannot apply.']} />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('withholds those features (it never grants more than was published)');
    expect(alert).toHaveTextContent('Free: Saved images is withheld here');
  });

  it('a version it cannot read: an alert saying nothing was changed', () => {
    render(<CatalogReadNotice label="version 7 (live)" status="unreadable" notes={['plans.free.features: Expected array, received string']} />);
    expect(screen.getByRole('alert')).toHaveTextContent('so it changed nothing: every account keeps the plans last applied');
  });
});

describe('the draft controls when this release must not write the catalog', () => {
  const blocked = 'A draft cannot be started here: version 7 (live) has settings this version of the app cannot apply in full.';

  it('without a draft: says why and does not start one', () => {
    render(<DraftBar kind="catalog" draftVersion={null} publishedVersion={7} changes={[]} blocked={blocked} viewer={viewer} />);
    expect(screen.getByText(blocked)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start a draft' })).toBeDisabled();
  });

  it('with a draft: publishing is off, discarding stays possible', () => {
    render(<DraftBar kind="catalog" draftVersion={8} publishedVersion={7} changes={['Free: adds Compare & Correct']} blocked="Draft version 8 has settings this version of the app cannot edit or publish." viewer={viewer} />);
    expect(screen.getByRole('button', { name: 'Publish version 8' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Discard draft' })).toBeEnabled();
  });

  it('as before when nothing is blocked', () => {
    render(<DraftBar kind="catalog" draftVersion={8} publishedVersion={7} changes={['Free: adds Compare & Correct']} viewer={viewer} />);
    expect(screen.getByRole('button', { name: 'Publish version 8' })).toBeEnabled();
  });
});
