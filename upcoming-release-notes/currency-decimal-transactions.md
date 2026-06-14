---
category: Bugfixes
authors: [StephenBrown2]
---

Make the transaction table and amount search decimal-aware. Amounts entered and displayed in the register, the running balance, split-amount errors, and the search bar now use the budget currency's decimal precision instead of always assuming two decimal places. Currency is resolved from the budget's `defaultCurrencyCode`; per-account currency will be wired in a later multi-currency PR. No change for budgets using the default (2-decimal) currency.
