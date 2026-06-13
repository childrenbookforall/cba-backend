require('./loadEnv');
const { sanitizeForEmail } = require('../src/services/email.service');

describe('email.service sanitizeForEmail (#15)', () => {
  test('passes a normal display name through unchanged', () => {
    expect(sanitizeForEmail('Alice Smith')).toBe('Alice Smith');
  });

  test('strips CR/LF so header-injection attempts collapse to one line', () => {
    expect(sanitizeForEmail('Alice\r\nBcc: victim@evil.com')).toBe('Alice Bcc: victim@evil.com');
    expect(sanitizeForEmail('Alice\r\nBcc: victim@evil.com')).not.toMatch(/[\r\n]/);
  });

  test('strips other control characters (tab, NUL, DEL) and collapses whitespace', () => {
    expect(sanitizeForEmail('A\tB\x00\x1FC\x7FD')).toBe('A B C D');
  });

  test('preserves accented / non-Latin characters in names', () => {
    expect(sanitizeForEmail('José Müller')).toBe('José Müller');
  });

  test('trims and length-caps to maxLen', () => {
    expect(sanitizeForEmail('  spaced  ')).toBe('spaced');
    expect(sanitizeForEmail('a'.repeat(150), 100)).toHaveLength(100);
  });

  test('handles null/undefined safely', () => {
    expect(sanitizeForEmail(undefined)).toBe('');
    expect(sanitizeForEmail(null)).toBe('');
  });
});
