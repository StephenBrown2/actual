import { describe, expect, it } from 'vitest';

import {
  decodeBalanceOfQuotedLiteral,
  findBalanceOfTwoArgCalls,
  findBalanceOnCalls,
} from '../../shared/balanceOfFormulaParse';
import type * as db from '../db';

import {
  extractBalanceOfLiterals,
  resolveAccountIdForBalanceOf,
  substituteBalanceOfLiterals,
} from './balanceOfFormula';

describe('balanceOfFormula', () => {
  it('extractBalanceOfLiterals returns distinct decoded literals', () => {
    expect(
      extractBalanceOfLiterals(
        '=BALANCE_OF("Checking") + BALANCE_OF("Checking")',
      ),
    ).toEqual(['Checking']);
    expect(extractBalanceOfLiterals('=balance_of("Savings")')).toEqual([
      'Savings',
    ]);
  });

  it('extractBalanceOfLiterals ignores two-arg BALANCE_OF', () => {
    expect(
      extractBalanceOfLiterals(
        '=BALANCE_OF("Checking", "2026-01-01") + BALANCE_OF("Other")',
      ),
    ).toEqual(['Other']);
  });

  it('findBalanceOfTwoArgCalls parses account and date expression', () => {
    expect(
      findBalanceOfTwoArgCalls('=BALANCE_OF("Checking", "2026-01-15") + 1'),
    ).toEqual([
      {
        start: 1,
        end: 37,
        accountInner: 'Checking',
        dateExpr: '"2026-01-15"',
      },
    ]);
    expect(
      findBalanceOfTwoArgCalls('=BALANCE_OF("id-here", DATE(2026,1,15))'),
    ).toMatchObject([
      {
        accountInner: 'id-here',
        dateExpr: 'DATE(2026,1,15)',
      },
    ]);
  });

  it('findBalanceOnCalls parses date expression', () => {
    expect(findBalanceOnCalls('=BALANCE_ON(date) + 2')).toEqual([
      {
        start: 1,
        end: 17,
        dateExpr: 'date',
      },
    ]);
  });

  it('decodeBalanceOfQuotedLiteral unescapes quotes and backslashes', () => {
    expect(decodeBalanceOfQuotedLiteral(String.raw`\"x\"`)).toBe('"x"');
  });

  it('substituteBalanceOfLiterals replaces calls with cent literals', () => {
    const map = new Map([
      ['Checking', 42],
      ['id-1', 99],
    ]);
    expect(substituteBalanceOfLiterals('=BALANCE_OF("Checking")+1', map)).toBe(
      '=42+1',
    );
    expect(substituteBalanceOfLiterals('=BALANCE_OF("Missing")', map)).toBe(
      '=0',
    );
  });

  it('resolveAccountIdForBalanceOf prefers map key then name', () => {
    const id = 'acc-1';
    const a1: db.DbAccount = {
      id,
      name: 'Dup',
      offbudget: 0,
    } as db.DbAccount;
    const a2: db.DbAccount = {
      id: 'acc-2',
      name: 'Other',
      offbudget: 0,
    } as db.DbAccount;
    const map = new Map<string, db.DbAccount>([
      [id, a1],
      ['acc-2', a2],
    ]);
    expect(resolveAccountIdForBalanceOf(id, map)).toBe(id);
    expect(resolveAccountIdForBalanceOf('Other', map)).toBe('acc-2');
    expect(resolveAccountIdForBalanceOf('Nope', map)).toBe(null);
  });
});
