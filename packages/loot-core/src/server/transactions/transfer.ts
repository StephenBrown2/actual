// @ts-strict-ignore
import * as db from '../db';

import { runRules } from './transaction-rules';

/**
 * Check if a transaction has a foreign exchange rate set
 */
function hasForeignExchangeRate(transaction): boolean {
  return (
    transaction.fx_rate != null &&
    transaction.fx_rate !== 0 &&
    transaction.fx_rate !== 1
  );
}

async function getPayee(acct) {
  return db.first<db.DbPayee>('SELECT * FROM payees WHERE transfer_acct = ?', [
    acct,
  ]);
}

async function getTransferredAccount(transaction) {
  if (transaction.payee) {
    const result = await db.first<Pick<db.DbViewPayee, 'transfer_acct'>>(
      'SELECT transfer_acct FROM v_payees WHERE id = ?',
      [transaction.payee],
    );

    return result?.transfer_acct || null;
  }
  return null;
}

async function clearCategory(transaction, transferAcct) {
  const { offbudget: fromOffBudget } = await db.first<
    Pick<db.DbAccount, 'offbudget'>
  >('SELECT offbudget FROM accounts WHERE id = ?', [transaction.account]);
  const { offbudget: toOffBudget } = await db.first<
    Pick<db.DbAccount, 'offbudget'>
  >('SELECT offbudget FROM accounts WHERE id = ?', [transferAcct]);

  // If the transfer is between two on budget or two off budget accounts,
  // we should clear the category, because the category is not relevant
  if (fromOffBudget === toOffBudget) {
    await db.updateTransaction({ id: transaction.id, category: null });
    if (transaction.transfer_id) {
      await db.updateTransaction({
        id: transaction.transfer_id,
        category: null,
      });
    }
    return true;
  }
  return false;
}

export async function addTransfer(transaction, transferredAccount) {
  if (transaction.is_parent) {
    // For split transactions, we should create transfers using child transactions.
    // This is to ensure that the amounts received by the transferred account
    // reflects the amounts in the child transactions and not the parent transaction
    // amount which is the total amount.
    return null;
  }

  const { id: fromPayee } = await db.first<Pick<db.DbPayee, 'id'>>(
    'SELECT id FROM payees WHERE transfer_acct = ?',
    [transaction.account],
  );

  // Check if this is an FX transfer
  const isFxTransfer = hasForeignExchangeRate(transaction);

  const transferTransaction = {
    account: transferredAccount,
    // For FX transfers, calculate the transfer amount using the exchange rate
    // For regular transfers, use the inverse amount
    amount: isFxTransfer
      ? -Math.round(transaction.amount * transaction.fx_rate)
      : -transaction.amount,
    payee: fromPayee,
    date: transaction.date,
    transfer_id: transaction.id,
    notes: transaction.notes || null,
    schedule: transaction.schedule,
    cleared: false,
    // If there's an FX rate, calculate the inverse rate for the other side
    ...(isFxTransfer ? { fx_rate: 1 / transaction.fx_rate } : {}),
  };
  const { notes, cleared } = await runRules(transferTransaction);
  const id = await db.insertTransaction({
    ...transferTransaction,
    notes,
    cleared,
  });

  await db.updateTransaction({ id: transaction.id, transfer_id: id });
  const categoryCleared = await clearCategory(transaction, transferredAccount);

  return {
    id: transaction.id,
    transfer_id: id,
    ...(categoryCleared ? { category: null } : {}),
  };
}

export async function removeTransfer(transaction) {
  const transferTrans = await db.getTransaction(transaction.transfer_id);

  // Perform operations on the transfer transaction only
  // if it is found. For example: when users delete both
  // (in & out) transfer transactions at the same time -
  // transfer transaction will not be found.
  if (transferTrans) {
    if (transferTrans.is_child) {
      // If it's a child transaction, we don't delete it because that
      // would invalidate the whole split transaction. Instead of turn
      // it into a normal transaction
      await db.updateTransaction({
        id: transaction.transfer_id,
        transfer_id: null,
        payee: null,
      });
    } else {
      await db.deleteTransaction({ id: transaction.transfer_id });
    }
  }
  await db.updateTransaction({ id: transaction.id, transfer_id: null });
  return { id: transaction.id, transfer_id: null };
}

export async function updateTransfer(transaction, transferredAccount) {
  const payee = await getPayee(transaction.account);
  const transferTrans = await db.getTransaction(transaction.transfer_id);

  // Check if this is an FX transfer (has an fx_rate that's not 0 or 1)
  const isFxTransfer =
    hasForeignExchangeRate(transaction) ||
    (transferTrans && hasForeignExchangeRate(transferTrans));

  const updateData = {
    id: transaction.transfer_id,
    account: transferredAccount,
    // Make sure to update the payee on the other side in case the
    // user moved this transaction into another account
    payee: payee.id,
    date: transaction.date,
    notes: transaction.notes,
    schedule: transaction.schedule,
    // For FX transfers, calculate the transfer amount using the exchange rate
    // Only update amount if this side has the fx_rate
    ...(hasForeignExchangeRate(transaction)
      ? {
          amount: -Math.round(transaction.amount * transaction.fx_rate),
          fx_rate: 1 / transaction.fx_rate, // Set inverse rate on the transfer
        }
      : isFxTransfer
        ? {} // Don't update amount/rate if only the other side has the fx_rate
        : { amount: -transaction.amount }), // Regular transfer
  };

  await db.updateTransaction(updateData);

  const categoryCleared = await clearCategory(transaction, transferredAccount);
  if (categoryCleared) {
    return { id: transaction.id, category: null };
  }
}

export async function onInsert(transaction) {
  const transferredAccount = await getTransferredAccount(transaction);

  if (transferredAccount) {
    return addTransfer(transaction, transferredAccount);
  }
}

export async function onDelete(transaction) {
  if (transaction.transfer_id) {
    await removeTransfer(transaction);
  }
}

export async function onUpdate(transaction) {
  const transferredAccount = await getTransferredAccount(transaction);

  if (transaction.is_parent) {
    return removeTransfer(transaction);
  }

  if (transferredAccount && !transaction.transfer_id) {
    return addTransfer(transaction, transferredAccount);
  }

  if (!transferredAccount && transaction.transfer_id) {
    return removeTransfer(transaction);
  }

  if (transferredAccount && transaction.transfer_id) {
    return updateTransfer(transaction, transferredAccount);
  }
}
