import type { TransactionEntity } from '../types/models';

/**
 * Check if a transaction has a foreign exchange rate set
 */
function hasForeignExchangeRate(transaction: TransactionEntity): boolean {
  return (
    transaction.fx_rate != null &&
    transaction.fx_rate !== 0 &&
    transaction.fx_rate !== 1
  );
}

/**
 * Validates if two transactions can be linked as a transfer.
 *
 * For regular transfers: amounts must zero each other out.
 * For FX transfers: if either transaction has an fx_rate, amounts can differ
 * as the rate accounts for the currency conversion (and optional fees if using splits).
 */
export function validForTransfer(
  fromTransaction: TransactionEntity,
  toTransaction: TransactionEntity,
) {
  if (
    // not already a transfer
    [fromTransaction, toTransaction].every(tran => tran.transfer_id == null) &&
    fromTransaction.account !== toTransaction.account // belong to different accounts
  ) {
    // Check if either transaction has an FX rate (indicates foreign exchange)
    const isFxTransfer =
      hasForeignExchangeRate(fromTransaction) ||
      hasForeignExchangeRate(toTransaction);

    if (isFxTransfer) {
      // For FX transfers, allow different amounts since the fx_rate
      // explains the difference (currency conversion and/or fees)
      return true;
    }

    // For regular transfers, amounts must zero each other out
    if (fromTransaction.amount + toTransaction.amount === 0) {
      return true;
    }
  }
  return false;
}
