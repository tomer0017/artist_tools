// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { checkPassword } from './password-policy';

describe('password policy', () => {
  it('accepts long passphrases and unusual strings, in any script', () => {
    for (const password of [
      'violet cactus harbor 42',
      'thirteen quiet lanterns',
      'correct horse battery staple',
      'Tq7#mZ2!pL9@xR4',
      'שמש ירוקה על ההר 7',
      'my grandmother paints owls',
    ]) {
      expect(checkPassword(password), password).toBeNull();
    }
  });

  it('asks for 12 to 128 characters, counting emoji and Hebrew letters as one each', () => {
    expect(checkPassword('short one')).toBe('too_short');
    expect(checkPassword('🎨🎨🎨🎨🎨🎨🎨🎨🎨🎨🎨')).toBe('too_short');
    expect(checkPassword('x'.repeat(129))).toBe('too_long');
  });

  it('refuses well-known passwords, with or without digits, symbols and substitutions', () => {
    for (const password of ['Password1234', 'password!!!!', 'P@ssw0rd2024!', '2024password!', 'iloveyou2024', 'qwerty123456!', 'Sunshine12345', 'Football2025!']) {
      expect(checkPassword(password), password).toBe('too_common');
    }
  });

  it('refuses repeats, sequences and keyboard runs', () => {
    for (const password of ['aaaaaaaaaaaaaaaa', 'abcabcabcabc', '123456789012', 'abcdefghijklm', 'qwertyuiop12', 'asdfghjkl;123', '0987654321ab', '121212121212', 'passwordpassword']) {
      expect(checkPassword(password), password).toBe('too_predictable');
    }
  });

  it("refuses the person's own name, address or the product name", () => {
    const context = { email: 'grace.hopper@example.com', name: 'Grace Hopper' };
    expect(checkPassword('gracehopper-rocks!', context)).toBe('personal');
    expect(checkPassword('Hopper and the bugs 1947', context)).toBe('personal');
    expect(checkPassword('my studio companion 2026')).toBe('personal');
    expect(checkPassword('compiler navy admiral 1906', context)).toBeNull();
  });
});
