import 'server-only';

// ─── Password policy ──────────────────────────────────────────────────────────
// Length and guessability, not composition rules (NIST SP 800-63B): at least
// 12 characters, at most 128, and not something an attacker tries first — a
// well-known password, a keyboard run or repeated pattern, or the person's own
// name, address or this product's name. Checked on the server for sign-up,
// reset, change and set; the browser only shows the length rule.

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export type PasswordProblem = 'too_short' | 'too_long' | 'too_common' | 'too_predictable' | 'personal';

export const PASSWORD_MESSAGES: Record<PasswordProblem, string> = {
  too_short: `Use at least ${PASSWORD_MIN_LENGTH} characters.`,
  too_long: `Use at most ${PASSWORD_MAX_LENGTH} characters.`,
  too_common: 'That password is too common. Try a short sentence or a few unrelated words.',
  too_predictable: 'Avoid repeated characters, sequences and keyboard patterns.',
  personal: 'Do not use your name, your email address or "Studio Companion" in your password.',
};

// Words that, with digits or symbols around them, make up most leaked
// passwords of this length. Compared after undoing common substitutions.
const COMMON_WORDS = new Set([
  'password', 'passw0rd', 'qwerty', 'letmein', 'welcome', 'iloveyou', 'admin', 'administrator', 'dragon', 'monkey',
  'football', 'baseball', 'basketball', 'soccer', 'sunshine', 'princess', 'master', 'shadow', 'superman', 'batman',
  'trustno', 'starwars', 'whatever', 'freedom', 'hello', 'charlie', 'michael', 'jessica', 'jordan', 'hunter',
  'killer', 'pokemon', 'secret', 'login', 'access', 'flower', 'computer', 'internet', 'samsung', 'google',
  'apple', 'iphone', 'summer', 'winter', 'spring', 'autumn', 'love', 'lovely', 'angel', 'baby', 'babygirl',
  'israel', 'shalom', 'artist', 'painting', 'painter', 'drawing', 'picasso', 'canvas', 'changeme', 'default',
  'test', 'testing', 'guest', 'user', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm', 'abc', 'abcdef',
]);

// Keyboard rows and runs people type as "random"; also checked backwards.
const SEQUENCES = ['abcdefghijklmnopqrstuvwxyz', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm', '1234567890', '0987654321', '1q2w3e4r5t6y7u8i9o0p', 'qazwsxedcrfvtgbyhnujmikolp'];

const LEET: Record<string, string> = { '@': 'a', '4': 'a', '8': 'b', '3': 'e', '6': 'g', '1': 'i', '!': 'i', '0': 'o', '5': 's', $: 's', '7': 't', '2': 'z' };

const onlyLetters = (text: string) => text.toLowerCase().replace(/[^a-z\u0590-\u05ff]/g, '');
/** "p@ssw0rd2024!" → "password": substitutions inside the word undone, the digits and symbols around it dropped. */
const undoSubstitutions = (text: string) =>
  [...text.toLowerCase().replace(/^[^a-z\u0590-\u05ff@$]+|[^a-z\u0590-\u05ff]+$/g, '')].map((ch) => LEET[ch] ?? ch).join('');

/** The shortest unit `text` is a repetition of ("abcabcabc" → "abc"); `text` itself if none. */
function repeatedUnit(text: string): string {
  for (let size = 1; size <= Math.floor(text.length / 2); size++) {
    if (text.length % size === 0 && text.slice(0, size).repeat(text.length / size) === text) return text.slice(0, size);
  }
  return text;
}

/** Length of the longest stretch of `text` that also appears in `run`. */
function longestSharedRun(text: string, run: string): number {
  let best = 0;
  const previous = new Array<number>(run.length + 1).fill(0);
  for (let i = 1; i <= text.length; i++) {
    let diagonal = 0;
    for (let j = 1; j <= run.length; j++) {
      const above = previous[j];
      previous[j] = text[i - 1] === run[j - 1] ? diagonal + 1 : 0;
      best = Math.max(best, previous[j]);
      diagonal = above;
    }
  }
  return best;
}

/** True when much of `text` follows a keyboard row or the alphabet, either way. */
const isMostlySequence = (lower: string) =>
  SEQUENCES.some((seq) => {
    const needed = Math.max(6, Math.ceil(lower.length * 0.6));
    return longestSharedRun(lower, seq) >= needed || longestSharedRun(lower, [...seq].reverse().join('')) >= needed;
  });

/** A common word, repeated or with at most three letters added; digits and symbols are ignored. */
function isCommon(lettersOnly: string): boolean {
  if (lettersOnly.length === 0) return false;
  if (COMMON_WORDS.has(repeatedUnit(lettersOnly))) return true;
  for (const word of COMMON_WORDS) {
    if (word.length >= 5 && lettersOnly.includes(word) && lettersOnly.length - word.length <= 3) return true;
  }
  return false;
}

/** Whether a password is acceptable, and if not, the first problem found. */
export function checkPassword(password: string, context: { email?: string | null; name?: string | null } = {}): PasswordProblem | null {
  const length = [...password].length;
  if (length < PASSWORD_MIN_LENGTH) return 'too_short';
  if (length > PASSWORD_MAX_LENGTH) return 'too_long';

  const lower = password.toLowerCase();
  if (new Set(lower).size < 5 || repeatedUnit(lower) !== lower || isMostlySequence(lower)) return 'too_predictable';

  // "Password1234!" and "P@ssw0rd2024" alike.
  const plain = onlyLetters(password);
  const substituted = onlyLetters(undoSubstitutions(password));
  if (isCommon(plain) || isCommon(substituted)) return 'too_common';

  const personal = ['studiocompanion'];
  const local = onlyLetters(context.email?.split('@')[0] ?? '');
  if (local.length >= 4) personal.push(local);
  for (const part of (context.name ?? '').split(/\s+/)) {
    const clean = onlyLetters(part);
    if (clean.length >= 4) personal.push(clean);
  }
  if (personal.some((word) => plain.includes(word) || substituted.includes(word))) return 'personal';

  return null;
}
