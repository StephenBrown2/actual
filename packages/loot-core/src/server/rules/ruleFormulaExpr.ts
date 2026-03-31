// @ts-strict-ignore
import { evaluateFormulaExpressionToIsoDate } from '../../shared/formulaExpressionDate';
import type { TransactionForRules } from '../transactions/transaction-rules';

/**
 * Evaluate a sub-expression (e.g. `date`, `"2026-01-15"`, `EDATE(DATEVALUE(date),-1)`)
 * to an ISO YYYY-MM-DD string, using the same named expressions as rule formulas.
 */
export function evaluateRuleExpressionToIsoDate(
  expressionRaw: string,
  transaction: Partial<TransactionForRules>,
): string | null {
  return evaluateFormulaExpressionToIsoDate(expressionRaw, {
    ...(transaction as Record<string, unknown>),
    account_name: transaction._account_name || '',
    category_name: transaction._category_name || '',
  });
}
