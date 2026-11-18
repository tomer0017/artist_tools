import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render as rtlRender, screen, waitFor } from '@testing-library/react';
import { I18nProvider } from '@/i18n/client';
import { en } from '@/i18n/messages/en';
import { he } from '@/i18n/messages/he';
import SignInCard from './SignInCard';

// The language switch calls a server action; components under test only need it to exist.
vi.mock('@/app/locale-actions', () => ({ chooseLocale: vi.fn(async () => ({ ok: true })) }));

// The auth server is not reached: each test says what it answers.
const auth = vi.hoisted(() => ({
  signInWithUsername: vi.fn(async (_body: { username: string; password: string }) => ({ error: null as { code?: string; status?: number } | null })),
  signInEmail: vi.fn(async (_body: unknown) => ({ error: null as { code?: string; status?: number } | null })),
}));
vi.mock('@/lib/auth-client', () => ({
  signInWithUsername: auth.signInWithUsername,
  authClient: { signIn: { email: auth.signInEmail, social: vi.fn(async () => ({ error: null })) } },
}));
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

/** Type a username (or address) and a password, and submit. */
function submit(identifier: string, password: string) {
  fireEvent.change(screen.getByRole('textbox'), { target: { value: identifier } });
  fireEvent.change(document.querySelector('input[name="password"]')!, { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: /^(Sign in|כניסה)$/ }));
}

const render = (ui: React.ReactElement, locale: 'en' | 'he' = 'en') =>
  rtlRender(
    <I18nProvider locale={locale} messages={locale === 'he' ? he : en}>
      {ui}
    </I18nProvider>,
  );

describe('SignInCard', () => {
  it('offers Google sign-in when the server has it configured', () => {
    render(<SignInCard callbackPath="/app" available error={null} registration="invite" />);
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeEnabled();
    expect(screen.queryByText(/not set up on this server/)).toBeNull();
  });

  it('says plainly when sign-in is not set up yet, instead of failing at Google', () => {
    render(<SignInCard callbackPath="/app" available={false} error={null} registration="invite" />);
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeDisabled();
    expect(screen.getByText('Sign-in is not set up on this server yet. Please check back soon.')).toBeInTheDocument();
  });

  it('shows a sign-in error as an alert', () => {
    render(<SignInCard callbackPath="/app" available error="Sign-in did not complete. Please try again." registration="invite" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Sign-in did not complete');
  });

  it('with open registration, explains that Google creates a free account automatically', () => {
    render(<SignInCard callbackPath="/app" available error={null} registration="open" />);
    expect(screen.getByRole('heading', { name: 'Sign in to Studio Companion' })).toBeInTheDocument();
    expect(screen.getByText(/your free account is created automatically; if you already have one, the same button signs you in/)).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'What you get' })).toHaveTextContent('All five tools, free with no time limit');
    expect(screen.queryByText(/invite-only/)).toBeNull();
  });

  it('offers email and password only where the server has it, with ways to create an account and reset a password', () => {
    const { unmount } = render(<SignInCard callbackPath="/app/compare" available error={null} registration="invite" />);
    expect(screen.queryByRole('form', { name: 'Sign in with email' })).toBeNull();
    expect(screen.getByRole('list', { name: 'What you get' })).toHaveTextContent('No password: Google signs you in');
    unmount();

    render(<SignInCard callbackPath="/app/compare" available error={null} registration="invite" emailPassword />);
    const form = screen.getByRole('form', { name: 'Sign in with email' });
    expect(form).toContainElement(screen.getByLabelText('Email address'));
    expect(screen.getByLabelText('Password', { selector: 'input' })).toHaveAttribute('autocomplete', 'current-password');
    expect(screen.getByRole('button', { name: 'Show password' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('link', { name: 'Forgot password?' })).toHaveAttribute('href', '/forgot-password');
    expect(screen.getByRole('link', { name: 'Create an account' })).toHaveAttribute('href', '/sign-up?callbackURL=%2Fapp%2Fcompare');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled();
    expect(screen.getByRole('list', { name: 'What you get' })).toHaveTextContent('Sign in with Google, or with your email and a password');
  });

  it('while invite-only, says so and still explains the free account', () => {
    render(<SignInCard callbackPath="/app" available error={null} registration="invite" />);
    expect(screen.getByRole('heading', { name: 'Sign in to Studio Companion' })).toBeInTheDocument();
    expect(screen.getByText(/invite-only while we test it/)).toBeInTheDocument();
    expect(screen.getByText(/your free account is created automatically the first time/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'compare plans' })).toHaveAttribute('href', '/pricing');
  });

  it('speaks Hebrew on Hebrew pages, with localized links and an email field that stays left-to-right', () => {
    render(<SignInCard callbackPath="/app" available error={null} registration="invite" emailPassword />, 'he');
    expect(screen.getByRole('heading', { name: 'כניסה ל-Studio Companion' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'המשך עם Google' })).toBeEnabled();
    expect(screen.getByLabelText('כתובת אימייל')).toHaveAttribute('dir', 'ltr');
    expect(screen.getByRole('link', { name: 'שכחת את הסיסמה?' })).toHaveAttribute('href', '/he/forgot-password');
    expect(screen.getByRole('link', { name: 'יצירת חשבון' })).toHaveAttribute('href', '/he/sign-up?callbackURL=%2Fapp');
    expect(screen.getByRole('link', { name: 'השוואת מסלולים' })).toHaveAttribute('href', '/he/pricing');
    expect(screen.getByRole('group', { name: 'בחירת שפה' })).toBeInTheDocument();
  });

  it('Google only and open to all: one action, and no password, registration, reset or invitation', () => {
    const { container } = render(<SignInCard callbackPath="/app" available error={null} registration="open" />);
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeEnabled();
    expect(screen.queryByRole('form')).toBeNull();
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    expect(container.querySelector('input[type="password"]')).toBeNull();
    expect(screen.queryByRole('link', { name: /create an account/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /forgot/i })).toBeNull();
    expect(container.textContent).not.toMatch(/invite|create an account|forgot/i);
  });

  it('offers a username form where the server has username sign-in, with no registration or reset', () => {
    const { container } = render(<SignInCard callbackPath="/app" available error={null} registration="open" usernamePassword />);
    const form = screen.getByRole('form', { name: 'Sign in with a username' });
    const field = screen.getByLabelText('Username');
    expect(form).toContainElement(field);
    expect(field).toHaveAttribute('type', 'text');
    expect(field).toHaveAttribute('autocomplete', 'username');
    expect(field).toHaveAttribute('autocapitalize', 'none');
    expect(field).toHaveAttribute('dir', 'ltr');
    expect(screen.getByLabelText('Password', { selector: 'input' })).toHaveAttribute('autocomplete', 'current-password');
    expect(screen.queryByLabelText('Email address')).toBeNull();
    expect(screen.queryByRole('link', { name: /create an account|forgot/i })).toBeNull();
    expect(screen.getByText(/there is no sign-up with one\. Forgot the password\? Ask the team to reset it\./)).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'What you get' })).toHaveTextContent('Sign in with Google, or with a username from our team');
    expect(container.textContent).not.toMatch(/invite-only|create an account/i);
  });

  it('signs in by username and goes into the studio, with plain words for every refusal', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    render(<SignInCard callbackPath="/app/compare" available error={null} registration="open" usernamePassword />);

    const answers: [{ code?: string; status?: number }, string][] = [
      [{ code: 'INVALID_USERNAME_OR_PASSWORD', status: 401 }, 'That username and password do not match. Check both and try again.'],
      [{ code: 'USERNAME_TOO_SHORT', status: 422 }, 'That username and password do not match. Check both and try again.'],
      [{ code: 'ACCOUNT_SUSPENDED', status: 403 }, 'This account is suspended. Please contact the Studio Companion team.'],
      [{ code: 'TOO_MANY_ATTEMPTS', status: 429 }, 'Too many attempts. Please wait 15 minutes, then try again.'],
      [{ status: 429 }, 'Too many attempts from this network. Please wait a minute and try again.'],
    ];
    for (const [error, message] of answers) {
      auth.signInWithUsername.mockResolvedValueOnce({ error });
      submit('Tomerfree', 'Kp7x-Tq3m-W9fz-Hd2r');
      await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(message));
      // The password is cleared after a refusal; the username stays.
      expect(document.querySelector<HTMLInputElement>('input[name="password"]')!.value).toBe('');
      expect(screen.getByRole<HTMLInputElement>('textbox').value).toBe('Tomerfree');
    }
    expect(assign).not.toHaveBeenCalled();

    submit('  Tomerfree ', 'Kp7x-Tq3m-W9fz-Hd2r');
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/app/compare'));
    expect(auth.signInWithUsername).toHaveBeenLastCalledWith({ username: 'Tomerfree', password: 'Kp7x-Tq3m-W9fz-Hd2r' });
    expect(auth.signInEmail).not.toHaveBeenCalled();
  });

  it('with both kinds of password sign-in, one field takes an email address or a username', async () => {
    vi.stubGlobal('location', { ...window.location, assign: vi.fn() });
    render(<SignInCard callbackPath="/app" available error={null} registration="invite" emailPassword usernamePassword />);
    expect(screen.getByLabelText('Email address or username')).toHaveAttribute('type', 'text');
    expect(screen.getByRole('link', { name: 'Forgot password?' })).toBeInTheDocument();
    // (Refused, so the form is ready again; after a success it stays busy while the page changes.)
    auth.signInWithUsername.mockResolvedValueOnce({ error: { code: 'INVALID_USERNAME_OR_PASSWORD', status: 401 } });
    submit('tomerfree', 'Kp7x-Tq3m-W9fz-Hd2r');
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('That username and password do not match'));
    expect(auth.signInEmail).not.toHaveBeenCalled();
    submit('ada@example.com', 'violet cactus harbor 42');
    await waitFor(() => expect(auth.signInEmail).toHaveBeenCalledWith(expect.objectContaining({ email: 'ada@example.com' })));
  });

  it('in Hebrew the username form is labelled in Hebrew, its field stays left-to-right', async () => {
    render(<SignInCard callbackPath="/app" available error={null} registration="open" usernamePassword />, 'he');
    expect(screen.getByRole('form', { name: 'כניסה עם שם משתמש' })).toBeInTheDocument();
    expect(screen.getByLabelText('שם משתמש')).toHaveAttribute('dir', 'ltr');
    expect(screen.getByText(/אין הרשמה עם שם משתמש/)).toBeInTheDocument();
    auth.signInWithUsername.mockResolvedValueOnce({ error: { code: 'INVALID_USERNAME_OR_PASSWORD', status: 401 } });
    submit('Tomerfree', 'Kp7x-Tq3m-W9fz-Hd2r');
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('שם המשתמש והסיסמה לא תואמים. כדאי לבדוק את שניהם ולנסות שוב.'));
  });

  it('in Hebrew, the one action reads המשך עם Google', () => {
    const { container } = render(<SignInCard callbackPath="/app" available error={null} registration="open" />, 'he');
    expect(screen.getByRole('heading', { name: 'כניסה ל-Studio Companion' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'המשך עם Google' })).toBeEnabled();
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    expect(container.textContent).not.toMatch(/הזמנה|יצירת חשבון|שכחת/);
  });
});
