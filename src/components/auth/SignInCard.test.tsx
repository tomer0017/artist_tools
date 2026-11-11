import { describe, expect, it, vi } from 'vitest';
import { render as rtlRender, screen } from '@testing-library/react';
import { I18nProvider } from '@/i18n/client';
import { en } from '@/i18n/messages/en';
import { he } from '@/i18n/messages/he';
import SignInCard from './SignInCard';

// The language switch calls a server action; components under test only need it to exist.
vi.mock('@/app/locale-actions', () => ({ chooseLocale: vi.fn(async () => ({ ok: true })) }));

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
    expect(screen.getByRole('heading', { name: 'Sign in or create your free account' })).toBeInTheDocument();
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
    expect(screen.getByRole('button', { name: 'כניסה עם Google' })).toBeEnabled();
    expect(screen.getByLabelText('כתובת אימייל')).toHaveAttribute('dir', 'ltr');
    expect(screen.getByRole('link', { name: 'שכחת את הסיסמה?' })).toHaveAttribute('href', '/he/forgot-password');
    expect(screen.getByRole('link', { name: 'יצירת חשבון' })).toHaveAttribute('href', '/he/sign-up?callbackURL=%2Fapp');
    expect(screen.getByRole('link', { name: 'השוואת מסלולים' })).toHaveAttribute('href', '/he/pricing');
    expect(screen.getByRole('group', { name: 'בחירת שפה' })).toBeInTheDocument();
  });
});
