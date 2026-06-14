import type { TransactionEntity } from '@actual-app/core/types/models';

import { deserializeTransaction, serializeTransaction } from './utils';

function makeTransaction(
  overrides: Partial<TransactionEntity> = {},
): TransactionEntity {
  return {
    id: 't1',
    account: 'a1',
    date: '2024-01-01',
    amount: 0,
    ...overrides,
  } as TransactionEntity;
}

describe('serializeTransaction with currency', () => {
  test('USD (2dp): -1234 serializes to 12.34 debit', () => {
    const t = serializeTransaction(
      makeTransaction({ amount: -1234 }),
      false,
      'USD',
    );
    expect(t.debit).toBe('12.34');
    expect(t.credit).toBe('');
  });

  test('JPY (0dp): -1234 serializes to 1,234 debit (no decimals)', () => {
    const t = serializeTransaction(
      makeTransaction({ amount: -1234 }),
      false,
      'JPY',
    );
    expect(t.debit).toBe('1,234');
    expect(t.credit).toBe('');
  });

  test("'' (None) preserves legacy 2dp formatting", () => {
    const t = serializeTransaction(
      makeTransaction({ amount: 1234 }),
      false,
      '',
    );
    expect(t.credit).toBe('12.34');
    expect(t.debit).toBe('');
  });

  test('no currency argument preserves legacy behavior', () => {
    const t = serializeTransaction(makeTransaction({ amount: 1234 }));
    expect(t.credit).toBe('12.34');
  });
});

describe('deserializeTransaction with currency', () => {
  const original = makeTransaction();

  test('USD (2dp): debit 12.34 deserializes to -1234', () => {
    const { amount } = deserializeTransaction(
      serializeTransaction(makeTransaction({ amount: -1234 }), false, 'USD'),
      original,
      'USD',
    );
    expect(amount).toBe(-1234);
  });

  test('JPY (0dp): debit 1234 deserializes to -1234 (not -123400)', () => {
    const { amount } = deserializeTransaction(
      {
        ...serializeTransaction(makeTransaction(), false, 'JPY'),
        debit: '1234',
        credit: '',
      },
      original,
      'JPY',
    );
    expect(amount).toBe(-1234);
  });

  test("'' (None) matches USD 2dp behavior", () => {
    const { amount } = deserializeTransaction(
      {
        ...serializeTransaction(makeTransaction(), false, ''),
        debit: '12.34',
        credit: '',
      },
      original,
      '',
    );
    expect(amount).toBe(-1234);
  });
});

describe('serialize/deserialize round-trip', () => {
  test.each([
    ['USD', -1234],
    ['USD', 5678],
    ['JPY', -1234],
    ['JPY', 5678],
    ['', -1234],
  ] as const)('%s amount %d round-trips', (currency, amount) => {
    const serialized = serializeTransaction(
      makeTransaction({ amount }),
      false,
      currency,
    );
    const { amount: result } = deserializeTransaction(
      serialized,
      makeTransaction({ amount }),
      currency,
    );
    expect(result).toBe(amount);
  });
});
