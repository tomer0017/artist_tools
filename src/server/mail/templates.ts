import 'server-only';
import type { MailTemplate } from '@/server/db/collections';

// ─── Account emails ───────────────────────────────────────────────────────────
// Plain, short messages about the person's own account. Each one says why it
// was sent and what to do if they did not ask for it. No tracking pixels, no
// link rewriting, no marketing. English until Phase 3 adds translations.

export interface RenderedMail {
  template: MailTemplate;
  subject: string;
  text: string;
  html: string;
  links: { label: string; url: string }[];
}

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

/** First name only, so a long or odd display name never dominates the message. */
const greeting = (name: string | null | undefined) => {
  const first = (name ?? '').trim().split(/\s+/)[0]?.slice(0, 40);
  return first ? `Hi ${first},` : 'Hi,';
};

function render(
  template: MailTemplate,
  subject: string,
  name: string | null | undefined,
  paragraphs: string[],
  action: { label: string; url: string } | null,
  footer: string,
): RenderedMail {
  const hello = greeting(name);
  const text = [hello, '', ...paragraphs.flatMap((p) => [p, '']), ...(action ? [`${action.label}: ${action.url}`, ''] : []), footer, '', '— Studio Companion'].join('\n');
  const button = action
    ? `<p style="margin:24px 0"><a href="${escapeHtml(action.url)}" style="display:inline-block;background:#b45309;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:10px">${escapeHtml(action.label)}</a></p>
<p style="font-size:13px;color:#57534e">If the button does not work, copy this link into your browser:<br><span style="word-break:break-all">${escapeHtml(action.url)}</span></p>`
    : '';
  const html = `<!doctype html><html><body style="margin:0;background:#f5f5f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#1c1917">
<div style="max-width:520px;margin:0 auto;padding:24px 16px">
<div style="background:#ffffff;border-radius:16px;padding:24px">
<p style="font-size:15px;font-weight:700;margin:0 0 16px">Studio Companion</p>
<p style="font-size:15px;line-height:1.5">${escapeHtml(hello)}</p>
${paragraphs.map((p) => `<p style="font-size:15px;line-height:1.5">${escapeHtml(p)}</p>`).join('\n')}
${button}
<p style="font-size:13px;line-height:1.5;color:#57534e;margin-top:24px">${escapeHtml(footer)}</p>
</div></div></body></html>`;
  return { template, subject, text, html, links: action ? [action] : [] };
}

const NOT_YOU = 'If you did not ask for this, you can ignore this email: nothing changes until the link is used.';

export const mailTemplates = {
  verifyEmail: (name: string | null, url: string) =>
    render(
      'verify_email',
      'Confirm your email address',
      name,
      ['Please confirm that this is your email address to finish creating your Studio Companion account. The link works for 24 hours.'],
      { label: 'Confirm my email', url },
      'If you did not create an account, ignore this email and no account will be activated.',
    ),

  resetPassword: (name: string | null, url: string) =>
    render(
      'reset_password',
      'Reset your password',
      name,
      ['Someone (hopefully you) asked to reset the password for your Studio Companion account. The link works for 30 minutes and only once.', 'Resetting your password signs you out on every device.'],
      { label: 'Choose a new password', url },
      NOT_YOU,
    ),

  /** Someone tried to create an account with an address that already has one. */
  existingAccount: (name: string | null, methods: { password: boolean; google: boolean }, urls: { signIn: string; reset: string }) => {
    const how = methods.password && methods.google ? 'with your password or with Google' : methods.google ? 'with Google' : 'with your password';
    return render(
      'existing_account',
      'You already have a Studio Companion account',
      name,
      [
        `Someone tried to create a new Studio Companion account with this email address, but you already have one. You sign in ${how}.`,
        methods.password ? 'Forgot your password? You can reset it from the sign-in page.' : 'To add a password, sign in with Google and add one on your account page.',
      ],
      { label: 'Sign in', url: urls.signIn },
      'If this was not you, no action is needed: no new account was created and your account is unchanged.',
    );
  },

  passwordChanged: (name: string | null, signInUrl: string) =>
    render(
      'password_changed',
      'Your password was changed',
      name,
      ['The password for your Studio Companion account was just changed, and every device was signed out.'],
      { label: 'Sign in', url: signInUrl },
      'If you did not do this, reset your password now from the sign-in page and contact support.',
    ),

  passwordAdded: (name: string | null) =>
    render(
      'password_added',
      'A password was added to your account',
      name,
      ['You can now sign in to Studio Companion with your email address and password, as well as with Google.'],
      null,
      'If you did not do this, sign in with Google, remove the password on your account page and contact support.',
    ),

  googleConnected: (name: string | null) =>
    render(
      'google_connected',
      'Google sign-in was connected to your account',
      name,
      ['You can now sign in to Studio Companion with Google, as well as with your password.'],
      null,
      'If you did not do this, sign in, disconnect Google on your account page and change your password.',
    ),

  accountDeleted: (name: string | null) =>
    render(
      'account_deleted',
      'Your Studio Companion account was deleted',
      name,
      [
        'Your account and the personal data stored with it have been deleted, as you asked. Images you worked on never left your devices.',
        'Backups that still contain your account expire within 14 days.',
      ],
      null,
      'If you did not ask for this, contact support right away.',
    ),
};
