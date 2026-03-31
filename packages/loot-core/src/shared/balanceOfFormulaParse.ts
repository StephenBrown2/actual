/** Decode escape sequences inside a double-quoted formula string literal. */
export function decodeBalanceOfQuotedLiteral(inner: string): string {
  return inner.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

function skipWhitespace(s: string, i: number): number {
  let p = i;
  while (p < s.length && /\s/.test(s[p])) {
    p++;
  }
  return p;
}

function readDoubleQuotedString(
  s: string,
  i: number,
): { end: number; inner: string } | null {
  if (s[i] !== '"') {
    return null;
  }
  let inner = '';
  let p = i + 1;
  while (p < s.length) {
    if (s[p] === '\\') {
      inner += s[p + 1] ?? '';
      p += 2;
      continue;
    }
    if (s[p] === '"') {
      return { end: p + 1, inner };
    }
    inner += s[p];
    p++;
  }
  return null;
}

/**
 * Parse expression starting at `start` until a closing `)` at depth 0 (outside strings).
 */
export function parseExpressionUntilMatchingCloseParen(
  formula: string,
  start: number,
): { end: number; text: string } | null {
  let depth = 0;
  let i = start;
  while (i < formula.length) {
    const c = formula[i];
    if (c === '"') {
      i++;
      while (i < formula.length) {
        if (formula[i] === '\\') {
          i += 2;
        } else if (formula[i] === '"') {
          i++;
          break;
        } else {
          i++;
        }
      }
      continue;
    }
    if (c === '(') {
      depth++;
      i++;
      continue;
    }
    if (c === ')') {
      if (depth === 0) {
        return { end: i + 1, text: formula.slice(start, i).trim() };
      }
      depth--;
      i++;
      continue;
    }
    i++;
  }
  return null;
}

export type BalanceOfTwoArgMatch = {
  start: number;
  end: number;
  accountInner: string;
  dateExpr: string;
};

export type BalanceOnMatch = {
  start: number;
  end: number;
  dateExpr: string;
};

/**
 * Find `BALANCE_OF("…", dateExpr)` two-argument calls (case-insensitive).
 */
export function findBalanceOfTwoArgCalls(
  formula: string,
): BalanceOfTwoArgMatch[] {
  const out: BalanceOfTwoArgMatch[] = [];
  const upper = formula.toUpperCase();
  let searchFrom = 0;
  const token = 'BALANCE_OF';
  while (searchFrom < formula.length) {
    const idx = upper.indexOf(token, searchFrom);
    if (idx === -1) {
      break;
    }
    let p = idx + token.length;
    p = skipWhitespace(formula, p);
    if (formula[p] !== '(') {
      searchFrom = idx + 1;
      continue;
    }
    p++;
    p = skipWhitespace(formula, p);
    const quoted = readDoubleQuotedString(formula, p);
    if (!quoted) {
      searchFrom = idx + 1;
      continue;
    }
    p = quoted.end;
    p = skipWhitespace(formula, p);
    if (formula[p] !== ',') {
      searchFrom = idx + 1;
      continue;
    }
    p++;
    p = skipWhitespace(formula, p);
    const expr = parseExpressionUntilMatchingCloseParen(formula, p);
    if (!expr) {
      searchFrom = idx + 1;
      continue;
    }
    out.push({
      start: idx,
      end: expr.end,
      accountInner: quoted.inner,
      dateExpr: expr.text,
    });
    searchFrom = expr.end;
  }
  return out;
}

/**
 * Find `BALANCE_ON(dateExpr)` calls (case-insensitive). Rules-only surface.
 */
export function findBalanceOnCalls(formula: string): BalanceOnMatch[] {
  const out: BalanceOnMatch[] = [];
  const upper = formula.toUpperCase();
  let searchFrom = 0;
  const token = 'BALANCE_ON';
  while (searchFrom < formula.length) {
    const idx = upper.indexOf(token, searchFrom);
    if (idx === -1) {
      break;
    }
    let p = idx + token.length;
    p = skipWhitespace(formula, p);
    if (formula[p] !== '(') {
      searchFrom = idx + 1;
      continue;
    }
    p++;
    p = skipWhitespace(formula, p);
    const expr = parseExpressionUntilMatchingCloseParen(formula, p);
    if (!expr) {
      searchFrom = idx + 1;
      continue;
    }
    out.push({
      start: idx,
      end: expr.end,
      dateExpr: expr.text,
    });
    searchFrom = expr.end;
  }
  return out;
}
