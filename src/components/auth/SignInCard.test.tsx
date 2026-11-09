import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import SignInCard from './SignInCard';

describe('SignInCard', () => {
  it('offers Google sign-in when the server has it configured', () => {
    render(<SignInCard callbackPath="/app" available error={null} />);
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeEnabled();
    expect(screen.queryByText(/not set up on this server/)).toBeNull();
  });

  it('says plainly when sign-in is not set up yet, instead of failing at Google', () => {
    render(<SignInCard callbackPath="/app" available={false} error={null} />);
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeDisabled();
    expect(screen.getByText('Sign-in is not set up on this server yet. Please check back soon.')).toBeInTheDocument();
  });

  it('shows a sign-in error as an alert', () => {
    render(<SignInCard callbackPath="/app" available error="Sign-in did not complete. Please try again." />);
    expect(screen.getByRole('alert')).toHaveTextContent('Sign-in did not complete');
  });
});
