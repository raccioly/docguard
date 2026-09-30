# Architecture

A small ledger service: accounts, invoices, payments, tax, audit, notifications and reports.
`src/index.mjs` wires the modules together. Money is a JavaScript number in major units
(dollars, yen); every module that produces an amount rounds it through the currency helpers.

| Area | Directory |
|---|---|
| Accounts and balances | `src/accounts/` |
| Invoices, totals and fees | `src/invoices/` |
| Payments, refunds and cards | `src/payments/` |
| Currencies | `src/currency/` |
| Tax | `src/tax/` |
| Audit trail | `src/audit/` |
| Notifications | `src/notifications/` |
| Reports | `src/reports/` |
| Shared helpers | `src/util/`, `src/config/` |
