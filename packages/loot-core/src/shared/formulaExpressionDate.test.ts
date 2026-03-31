import { describe, expect, it } from 'vitest';

import { evaluateFormulaExpressionToIsoDate } from './formulaExpressionDate';

/** Serial for `date` built from ISO via DD/MM string (HyperFormula accepts `DATEVALUE` on this form). */
const dateSerialFromIso =
  'DATEVALUE(MID(date,9,2)&"/"&MID(date,6,2)&"/"&MID(date,1,4))';

/** Parse rule variable `date` (ISO `YYYY-MM-DD`) without DATEVALUE on the raw ISO string. */
const dateFromIso = [
  'DATE(',
  'VALUE(MID(date,1,4)),',
  'VALUE(MID(date,6,2)),',
  'VALUE(MID(date,9,2)))',
].join('');

describe('evaluateFormulaExpressionToIsoDate', () => {
  it('parses a quoted ISO date literal', () => {
    expect(
      evaluateFormulaExpressionToIsoDate(
        '"2026-03-15"',
        {},
        {
          today: '2026-01-01',
        },
      ),
    ).toBe('2026-03-15');
  });

  it('parses a quoted DD/MM/YYYY literal (HyperFormula default date string form)', () => {
    expect(
      evaluateFormulaExpressionToIsoDate(
        '"21/02/2024"',
        {},
        {
          today: '2026-01-01',
        },
      ),
    ).toBe('2024-02-21');
    expect(
      evaluateFormulaExpressionToIsoDate(
        '"1/2/2024"',
        {},
        {
          today: '2026-01-01',
        },
      ),
    ).toBe('2024-02-01');
  });

  it('evaluates TEXT(DATE(…), "dd/mm/yyyy") to ISO', () => {
    expect(
      evaluateFormulaExpressionToIsoDate(
        'TEXT(DATE(2025, 6, 21), "dd/mm/yyyy")',
        {},
        { today: '2026-01-01' },
      ),
    ).toBe('2025-06-21');
  });

  it('returns null for invalid DD/MM/YYYY calendar date', () => {
    expect(
      evaluateFormulaExpressionToIsoDate(
        '"31/02/2024"',
        {},
        {
          today: '2026-01-01',
        },
      ),
    ).toBeNull();
  });

  it('returns the date named expression as ISO when it matches', () => {
    expect(
      evaluateFormulaExpressionToIsoDate(
        'date',
        { date: '2024-10-20' },
        {
          today: '2026-01-01',
        },
      ),
    ).toBe('2024-10-20');
  });

  it('evaluates TEXT(DATE(…)) to ISO without serial rounding issues', () => {
    expect(
      evaluateFormulaExpressionToIsoDate(
        'TEXT(DATE(2025, 6, 21), "yyyy-mm-dd")',
        {},
        { today: '2026-01-01' },
      ),
    ).toBe('2025-06-21');
  });

  /**
   * Statement-style cutoff: 21st day of the calendar month before the transaction month.
   */
  it('evaluates 21st of previous calendar month from transaction ISO date', () => {
    const expr = [
      'TEXT(DATE(',
      'YEAR(EDATE(',
      dateFromIso,
      ', -1)),',
      'MONTH(EDATE(',
      dateFromIso,
      ', -1)),',
      '21), "yyyy-mm-dd")',
    ].join('');

    expect(
      evaluateFormulaExpressionToIsoDate(
        expr,
        { date: '2024-03-10' },
        {
          today: '2026-01-01',
        },
      ),
    ).toBe('2024-02-21');

    expect(
      evaluateFormulaExpressionToIsoDate(
        expr,
        { date: '2024-01-05' },
        {
          today: '2026-01-01',
        },
      ),
    ).toBe('2023-12-21');
  });

  it('evaluates 21st of previous month using DATEVALUE on DD/MM string and TEXT dd/mm/yyyy', () => {
    const expr = [
      'TEXT(DATE(',
      'YEAR(EDATE(',
      dateSerialFromIso,
      ', -1)),',
      'MONTH(EDATE(',
      dateSerialFromIso,
      ', -1)),',
      '21), "dd/mm/yyyy")',
    ].join('');

    expect(
      evaluateFormulaExpressionToIsoDate(
        expr,
        { date: '2024-03-10' },
        {
          today: '2026-01-01',
        },
      ),
    ).toBe('2024-02-21');

    expect(
      evaluateFormulaExpressionToIsoDate(
        expr,
        { date: '2024-01-05' },
        {
          today: '2026-01-01',
        },
      ),
    ).toBe('2023-12-21');
  });

  it('returns null for empty or invalid expression', () => {
    expect(
      evaluateFormulaExpressionToIsoDate('', { date: '2024-01-01' }),
    ).toBeNull();
    expect(
      evaluateFormulaExpressionToIsoDate('NOTADATE', { date: '2024-01-01' }),
    ).toBeNull();
  });
});
