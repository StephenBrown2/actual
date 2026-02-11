import type { TransactionEntity } from 'loot-core/types/models';

import {
  deserializeTransaction,
  serializeTransaction,
} from '@desktop-client/components/transactions/table/utils';

function makeTransaction(amount: number): TransactionEntity {
  return {
    id: 'tx-1',
    account: 'acct-1',
    amount,
    date: '2026-02-08',
  };
}

describe('transaction table utils decimal places', () => {
  test.each([
    [0, 1000000, '1,000,000', ''] as const,
    [2, 1000000, '10,000.00', ''] as const,
    [3, 1000000, '1,000.000', ''] as const,
    [3, -1000000, '', '1,000.000'] as const,
    [2, -1000000, '', '10,000.00'] as const,
    [0, -1000000, '', '1,000,000'] as const,
  ])(
    'serializes and deserializes (decimals=%i, amount=%i)',
    (decimals, amount, expectedCredit, expectedDebit) => {
      const original = makeTransaction(amount);

      const serialized = serializeTransaction(original, decimals, false);
      expect(serialized.credit).toBe(expectedCredit);
      expect(serialized.debit).toBe(expectedDebit);

      const deserialized = deserializeTransaction(
        serialized,
        original,
        decimals,
      );
      expect(deserialized.amount).toBe(amount);
    },
  );
});
