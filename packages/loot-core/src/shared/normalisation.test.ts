import { normalizeToTitleCase, toTitleCase } from './normalisation';

describe('toTitleCase', () => {
  it('capitalises each word', () => {
    expect(toTitleCase('hello world')).toBe('Hello World');
    expect(toTitleCase('hello  world')).toBe('Hello World');
  });

  it('keeps minor words lowercase in the middle', () => {
    expect(toTitleCase('line of credit')).toBe('Line of Credit');
    expect(toTitleCase('the rise and fall')).toBe('The Rise and Fall');
    expect(toTitleCase('off to the races')).toBe('Off to the Races');
  });

  it('capitalises minor words at the start and end', () => {
    expect(toTitleCase('the quick brown fox')).toBe('The Quick Brown Fox');
    expect(toTitleCase('a quick brown fox')).toBe('A Quick Brown Fox');
    expect(toTitleCase('ending on a')).toBe('Ending on A');
  });
});

describe('normalizeToTitleCase', () => {
  it('returns null for empty input', () => {
    expect(normalizeToTitleCase()).toBeNull();
    expect(normalizeToTitleCase('')).toBeNull();
    expect(normalizeToTitleCase('   ')).toBeNull();
  });

  it('normalizes camelCase and separators to title case', () => {
    expect(normalizeToTitleCase('creditCard')).toBe('Credit Card');
    expect(normalizeToTitleCase('line_of_credit')).toBe('Line of Credit');
    expect(normalizeToTitleCase('line-of-credit')).toBe('Line of Credit');
  });

  it('keeps minor words lowercase in the middle', () => {
    expect(normalizeToTitleCase('line of credit')).toBe('Line of Credit');
    expect(normalizeToTitleCase('the rise and fall')).toBe('The Rise and Fall');
    expect(normalizeToTitleCase('off to the races')).toBe('Off to the Races');
  });
});
