export function getNormalisedString(value: string) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}

const TITLE_CASE_MINOR_WORDS = new Set([
  'a',
  'an',
  'and',
  'as',
  'at',
  'but',
  'by',
  'for',
  'from',
  'in',
  'nor',
  'of',
  'on',
  'or',
  'per',
  'so',
  'the',
  'to',
  'up',
  'via',
]);

/**
 * Convert a space-separated string to title case, keeping minor words
 * (articles, conjunctions, short prepositions) lowercase unless they
 * appear at the start or end.
 *
 * Examples:
 *   'line of credit'    -> 'Line of Credit'
 *   'the rise and fall' -> 'The Rise and Fall'
 */
export function toTitleCase(value: string): string {
  const words = value.split(' ');

  return words
    .map((word, index) => {
      const lower = word.toLocaleLowerCase();
      const isEdgeWord = index === 0 || index === words.length - 1;

      if (!isEdgeWord && TITLE_CASE_MINOR_WORDS.has(lower)) {
        return lower;
      }

      return lower.charAt(0).toLocaleUpperCase() + lower.slice(1);
    })
    .join(' ');
}

/**
 * Normalize an arbitrary identifier string into readable title case.
 * Splits camelCase, snake_case, and kebab-case boundaries into words,
 * then applies title-case rules with minor-word handling.
 *
 * Examples:
 *   'creditCard'   -> 'Credit Card'
 *   'lineOfCredit' -> 'Line of Credit'
 *   'other_asset'  -> 'Other Asset'
 *   'CHECKING'     -> 'Checking'
 */
export function normalizeToTitleCase(value?: string | null): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const normalized = trimmed
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return toTitleCase(normalized);
}
