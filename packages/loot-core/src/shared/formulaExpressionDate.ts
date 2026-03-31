// @ts-strict-ignore
import { addDays, format } from 'date-fns';
import { HyperFormula } from 'hyperformula';
import enUS from 'hyperformula/i18n/languages/enUS';

import { currentDay } from './months';

try {
  HyperFormula.registerLanguage('enUS', enUS);
} catch {
  // May already be registered (e.g. action.ts in the same process)
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** HyperFormula default human-readable dates: DD/MM/YYYY (day and month may be 1 or 2 digits). */
const DD_MM_YYYY = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

/**
 * Parse a trimmed string to ISO `YYYY-MM-DD`.
 * Accepts ISO dates and DD/MM/YYYY (Gregorian), matching HyperFormula’s default date string form.
 */
function parseStringToIsoDate(trimmed: string): string | null {
  if (ISO_DATE.test(trimmed)) {
    return trimmed;
  }
  const m = trimmed.match(DD_MM_YYYY);
  if (!m) {
    return null;
  }
  const day = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  const year = parseInt(m[3], 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  const d = new Date(year, month - 1, day, 12, 0, 0, 0);
  if (
    d.getFullYear() !== year ||
    d.getMonth() !== month - 1 ||
    d.getDate() !== day
  ) {
    return null;
  }
  return format(d, 'yyyy-MM-dd');
}

/** Excel serial 1 = 1900-01-01 (local noon, consistent with shared/months day parsing). */
function serialToYyyyMmDd(serial: number): string {
  const jan1 = new Date(1900, 0, 1, 12, 0, 0, 0);
  const d = addDays(jan1, Math.round(serial) - 1);
  return format(d, 'yyyy-MM-dd');
}

function normalizeCellValueToIsoDate(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string') {
    return parseStringToIsoDate(value.trim());
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return serialToYyyyMmDd(value);
  }
  if (typeof value === 'boolean') {
    return null;
  }
  return null;
}

const SKIP_NAMED_KEYS = new Set([
  '_balanceOfPrefetched',
  '_balanceDatedFormulaSubstitutions',
]);

/**
 * Evaluate a sub-expression to ISO YYYY-MM-DD using HyperFormula named expressions
 * (e.g. `date`, `"2026-01-15"`, `"15/01/2026"`, `EDATE(DATEVALUE(date),-1)`).
 * String results may be ISO `YYYY-MM-DD` or DD/MM/YYYY (HyperFormula’s default date text form).
 */
export function evaluateFormulaExpressionToIsoDate(
  expressionRaw: string,
  namedValues: Record<string, unknown>,
  options?: { today?: string },
): string | null {
  const trimmed = expressionRaw.trim();
  if (!trimmed) {
    return null;
  }

  let hfInstance: ReturnType<typeof HyperFormula.buildEmpty> | null = null;

  try {
    hfInstance = HyperFormula.buildEmpty({
      licenseKey: 'gpl-v3',
      language: 'enUS',
    });

    const sheetName = hfInstance.addSheet('Sheet1');
    const sheetId = hfInstance.getSheetId(sheetName);
    if (sheetId === undefined) {
      return null;
    }

    const merged: Record<string, unknown> = {
      today: options?.today ?? currentDay(),
      account_name: '',
      category_name: '',
      ...namedValues,
    };

    for (const key of Object.keys(merged)) {
      if (SKIP_NAMED_KEYS.has(key)) {
        continue;
      }
      let cellValue: string | number | boolean;
      const v = merged[key];
      if (v === undefined || v === null || typeof v === 'object') {
        cellValue = '';
      } else if (typeof v === 'boolean' || typeof v === 'number') {
        cellValue = v;
      } else {
        cellValue = String(v);
      }
      hfInstance.addNamedExpression(key, cellValue);
    }

    const formulaCell = trimmed.startsWith('=') ? trimmed : `=${trimmed}`;

    hfInstance.setCellContents({ sheet: sheetId, col: 0, row: 0 }, [
      [formulaCell],
    ]);

    const cellValue = hfInstance.getCellValue({
      sheet: sheetId,
      col: 0,
      row: 0,
    });

    if (cellValue && typeof cellValue === 'object' && 'type' in cellValue) {
      return null;
    }

    return normalizeCellValueToIsoDate(cellValue);
  } finally {
    try {
      hfInstance?.destroy();
    } catch {
      // ignore
    }
  }
}
