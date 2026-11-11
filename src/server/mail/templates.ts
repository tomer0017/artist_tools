import 'server-only';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/lib/locale';
import type { MailTemplate } from '@/server/db/collections';

// ─── Account emails ───────────────────────────────────────────────────────────
// Plain, short messages about the person's own account, in their language
// (English or Hebrew; Hebrew is laid out right to left). Each one says why it
// was sent and what to do if they did not ask for it. No tracking pixels, no
// link rewriting, no marketing.

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
const firstName = (name: string | null | undefined) => (name ?? '').trim().split(/\s+/)[0]?.slice(0, 40) ?? '';

const STRINGS = {
  en: {
    hello: (name: string) => (name ? `Hi ${name},` : 'Hi,'),
    sign: '— Studio Companion',
    buttonFallback: 'If the button does not work, copy this link into your browser:',
    notYou: 'If you did not ask for this, you can ignore this email: nothing changes until the link is used.',
    verify: {
      subject: 'Confirm your email address',
      body: ['Please confirm that this is your email address to finish creating your Studio Companion account. The link works for 24 hours.'],
      action: 'Confirm my email',
      footer: 'If you did not create an account, ignore this email and no account will be activated.',
    },
    reset: {
      subject: 'Reset your password',
      body: ['Someone (hopefully you) asked to reset the password for your Studio Companion account. The link works for 30 minutes and only once.', 'Resetting your password signs you out on every device.'],
      action: 'Choose a new password',
    },
    existing: {
      subject: 'You already have a Studio Companion account',
      how: { both: 'with your password or with Google', google: 'with Google', password: 'with your password' },
      body: (how: string) => `Someone tried to create a new Studio Companion account with this email address, but you already have one. You sign in ${how}.`,
      withPassword: 'Forgot your password? You can reset it from the sign-in page.',
      withoutPassword: 'To add a password, sign in with Google and add one on your account page.',
      action: 'Sign in',
      footer: 'If this was not you, no action is needed: no new account was created and your account is unchanged.',
    },
    changed: {
      subject: 'Your password was changed',
      body: ['The password for your Studio Companion account was just changed, and every device was signed out.'],
      action: 'Sign in',
      footer: 'If you did not do this, reset your password now from the sign-in page and contact support.',
    },
    added: {
      subject: 'A password was added to your account',
      body: ['You can now sign in to Studio Companion with your email address and password, as well as with Google.'],
      footer: 'If you did not do this, sign in with Google, remove the password on your account page and contact support.',
    },
    google: {
      subject: 'Google sign-in was connected to your account',
      body: ['You can now sign in to Studio Companion with Google, as well as with your password.'],
      footer: 'If you did not do this, sign in, disconnect Google on your account page and change your password.',
    },
    deleted: {
      subject: 'Your Studio Companion account was deleted',
      body: [
        'Your account and the personal data stored with it have been deleted, as you asked. Images you worked on never left your devices.',
        'Backups that still contain your account expire within 14 days.',
      ],
      footer: 'If you did not ask for this, contact support right away.',
    },
  },
  he: {
    hello: (name: string) => (name ? `שלום ${name},` : 'שלום,'),
    sign: '— Studio Companion',
    buttonFallback: 'אם הכפתור לא עובד, אפשר להעתיק את הקישור הזה לדפדפן:',
    notYou: 'אם הבקשה לא הגיעה מכם, אפשר להתעלם מההודעה: שום דבר לא משתנה בלי שימוש בקישור.',
    verify: {
      subject: 'אישור כתובת האימייל',
      body: ['כדי לסיים ליצור את החשבון ב-Studio Companion, צריך לאשר שזו כתובת האימייל שלכם. הקישור בתוקף ל-24 שעות.'],
      action: 'אישור כתובת האימייל',
      footer: 'אם לא יצרתם חשבון, אפשר להתעלם מההודעה, ושום חשבון לא יופעל.',
    },
    reset: {
      subject: 'איפוס הסיסמה',
      body: ['התקבלה בקשה לאפס את הסיסמה של החשבון ב-Studio Companion. הקישור עובד פעם אחת, למשך 30 דקות.', 'איפוס הסיסמה מנתק את החשבון מכל המכשירים.'],
      action: 'בחירת סיסמה חדשה',
    },
    existing: {
      subject: 'כבר יש לכם חשבון ב-Studio Companion',
      how: { both: 'בסיסמה או עם Google', google: 'עם Google', password: 'בסיסמה' },
      body: (how: string) => `מישהו ניסה ליצור חשבון חדש ב-Studio Companion עם כתובת האימייל הזאת, אבל כבר יש לכם חשבון. הכניסה אליו היא ${how}.`,
      withPassword: 'שכחתם את הסיסמה? אפשר לאפס אותה בדף הכניסה.',
      withoutPassword: 'כדי להוסיף סיסמה, יש להיכנס עם Google ולהוסיף אותה בדף החשבון.',
      action: 'כניסה',
      footer: 'אם זה לא הייתם אתם, אין צורך לעשות דבר: לא נוצר חשבון חדש והחשבון שלכם לא השתנה.',
    },
    changed: {
      subject: 'הסיסמה הוחלפה',
      body: ['הסיסמה של החשבון ב-Studio Companion הוחלפה עכשיו, והחשבון נותק מכל המכשירים.'],
      action: 'כניסה',
      footer: 'אם לא עשיתם את זה, כדאי לאפס את הסיסמה עכשיו מדף הכניסה ולפנות לתמיכה.',
    },
    added: {
      subject: 'נוספה סיסמה לחשבון',
      body: ['מעכשיו אפשר להיכנס ל-Studio Companion עם כתובת האימייל והסיסמה, וגם עם Google.'],
      footer: 'אם לא עשיתם את זה, יש להיכנס עם Google, להסיר את הסיסמה בדף החשבון ולפנות לתמיכה.',
    },
    google: {
      subject: 'כניסה עם Google חוברה לחשבון',
      body: ['מעכשיו אפשר להיכנס ל-Studio Companion עם Google, וגם עם הסיסמה.'],
      footer: 'אם לא עשיתם את זה, יש להיכנס, לנתק את Google בדף החשבון ולהחליף את הסיסמה.',
    },
    deleted: {
      subject: 'החשבון ב-Studio Companion נמחק',
      body: ['החשבון והמידע האישי שנשמר איתו נמחקו, לבקשתכם. התמונות שעבדתם עליהן מעולם לא יצאו מהמכשירים שלכם.', 'גיבויים שעדיין מכילים את החשבון נמחקים תוך 14 יום.'],
      footer: 'אם לא ביקשתם את זה, כדאי לפנות לתמיכה מיד.',
    },
  },
} as const;

type Strings = (typeof STRINGS)['en'];

function render(
  locale: Locale,
  template: MailTemplate,
  subject: string,
  name: string | null | undefined,
  paragraphs: readonly string[],
  action: { label: string; url: string } | null,
  footer: string,
): RenderedMail {
  const s: Strings = STRINGS[locale] as unknown as Strings;
  const dir = locale === 'he' ? 'rtl' : 'ltr';
  const hello = s.hello(firstName(name));
  const text = [hello, '', ...paragraphs.flatMap((p) => [p, '']), ...(action ? [`${action.label}: ${action.url}`, ''] : []), footer, '', s.sign].join('\n');
  const button = action
    ? `<p style="margin:24px 0"><a href="${escapeHtml(action.url)}" style="display:inline-block;background:#b45309;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:10px">${escapeHtml(action.label)}</a></p>
<p style="font-size:13px;color:#57534e">${escapeHtml(s.buttonFallback)}<br><span dir="ltr" style="word-break:break-all">${escapeHtml(action.url)}</span></p>`
    : '';
  const html = `<!doctype html><html lang="${locale}" dir="${dir}"><body style="margin:0;background:#f5f5f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#1c1917">
<div dir="${dir}" style="max-width:520px;margin:0 auto;padding:24px 16px;text-align:${dir === 'rtl' ? 'right' : 'left'}">
<div style="background:#ffffff;border-radius:16px;padding:24px">
<p style="font-size:15px;font-weight:700;margin:0 0 16px">Studio Companion</p>
<p style="font-size:15px;line-height:1.5">${escapeHtml(hello)}</p>
${paragraphs.map((p) => `<p style="font-size:15px;line-height:1.5">${escapeHtml(p)}</p>`).join('\n')}
${button}
<p style="font-size:13px;line-height:1.5;color:#57534e;margin-top:24px">${escapeHtml(footer)}</p>
</div></div></body></html>`;
  return { template, subject, text, html, links: action ? [action] : [] };
}

/** The account emails in `locale` (English for anything unknown). */
export function mailTemplates(locale: unknown) {
  const l: Locale = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const s: Strings = STRINGS[l] as unknown as Strings;
  return {
    verifyEmail: (name: string | null, url: string) => render(l, 'verify_email', s.verify.subject, name, s.verify.body, { label: s.verify.action, url }, s.verify.footer),
    resetPassword: (name: string | null, url: string) => render(l, 'reset_password', s.reset.subject, name, s.reset.body, { label: s.reset.action, url }, s.notYou),
    /** Someone tried to create an account with an address that already has one. */
    existingAccount: (name: string | null, methods: { password: boolean; google: boolean }, urls: { signIn: string; reset: string }) => {
      const how = methods.password && methods.google ? s.existing.how.both : methods.google ? s.existing.how.google : s.existing.how.password;
      return render(
        l,
        'existing_account',
        s.existing.subject,
        name,
        [s.existing.body(how), methods.password ? s.existing.withPassword : s.existing.withoutPassword],
        { label: s.existing.action, url: urls.signIn },
        s.existing.footer,
      );
    },
    passwordChanged: (name: string | null, signInUrl: string) => render(l, 'password_changed', s.changed.subject, name, s.changed.body, { label: s.changed.action, url: signInUrl }, s.changed.footer),
    passwordAdded: (name: string | null) => render(l, 'password_added', s.added.subject, name, s.added.body, null, s.added.footer),
    googleConnected: (name: string | null) => render(l, 'google_connected', s.google.subject, name, s.google.body, null, s.google.footer),
    accountDeleted: (name: string | null) => render(l, 'account_deleted', s.deleted.subject, name, s.deleted.body, null, s.deleted.footer),
  };
}
