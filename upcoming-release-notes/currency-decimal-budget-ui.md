---
category: Bugfixes
authors: [StephenBrown2]
---

Make budget cell inputs decimal-aware. The "cover from another category" amount and the envelope/tracking budget amount inputs now parse and display using the budget currency's decimal precision instead of always assuming two decimal places. Currency is resolved from the budget's `defaultCurrencyCode`. No change for budgets using the default (2-decimal) currency.
