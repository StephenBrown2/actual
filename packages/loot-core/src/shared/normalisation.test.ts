import { describe, expect, it } from 'vitest';

import {
  getNormalisedString,
  normalizeToTitleCase,
  toTitleCase,
} from './normalisation';

describe('getNormalisedString', () => {
  it('lowercases plain ASCII', () => {
    expect(getNormalisedString('Hello World')).toBe('hello world');
  });

  it('strips standard diacritics', () => {
    expect(getNormalisedString('café')).toBe('cafe');
    expect(getNormalisedString('naïve')).toBe('naive');
    expect(getNormalisedString('résumé')).toBe('resume');
  });

  it('matches a word with ą when searching a', () => {
    expect(getNormalisedString('Pączek')).toBe('paczek');
  });

  it('matches a word with ł when searching with l', () => {
    expect(getNormalisedString('Złoty')).toBe('zloty');
    expect(getNormalisedString('Łódź')).toBe('lodz');
  });

  it('maps ß to ss', () => {
    expect(getNormalisedString('Straße')).toBe('strasse');
    expect(getNormalisedString('STRAẞE')).toBe('strasse');
  });

  it('maps ø to o', () => {
    expect(getNormalisedString('Bjørn')).toBe('bjorn');
    expect(getNormalisedString('Øresund')).toBe('oresund');
  });

  it('maps œ to oe', () => {
    expect(getNormalisedString('Œuf')).toBe('oeuf');
    expect(getNormalisedString('œuf')).toBe('oeuf');
  });
});

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
