---
category: Bugfixes
authors: [StephenBrown2]
---

Complete the decimal-precision pass across the remaining UI: mobile transaction entry and lists, the close-account and edit-field modals, transaction import, the category autocomplete amount hints, and the account balance graph now all format and parse amounts using the budget currency's decimal precision instead of always assuming two decimal places. Currency is resolved from the budget's `defaultCurrencyCode`; per-account currency will be wired in a later multi-currency PR. No change for budgets using the default (2-decimal) currency.
