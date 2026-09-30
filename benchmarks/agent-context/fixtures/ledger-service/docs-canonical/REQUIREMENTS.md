# Requirements

Spec ID: `acme.ledger`

| ID | Requirement |
|---|---|
| FR-001 | An account's balance is the sum of its posted entries; pending entries are excluded. |
| FR-002 | Account identifiers are `ACC-` followed by eight uppercase hexadecimal characters. |
| FR-003 | An invoice total is the sum of its line items plus tax, each rounded as FR-004 requires. |
| FR-004 | Monetary amounts are rounded to the currency's minor units with round-half-to-even (banker's rounding). JPY has no minor unit, KWD has three, every other supported currency has two. |
| FR-005 | Tax is computed per line item from the item's tax category; exempt items carry no tax. |
| FR-006 | An invoice is `paid` when its outstanding amount is zero, `overdue` after its due date, and `open` otherwise; a `disputed` invoice keeps that status until it is resolved. |
| FR-007 | A late fee of 1.5% of the outstanding amount applies only when an invoice is more than 10 calendar days past its due date, and never to an invoice whose status is `disputed`. |
| FR-008 | A payment is allocated to the oldest open invoice first. |
| FR-009 | A refund never exceeds the amount paid on the invoice it refunds. |
| FR-010 | Notification e-mails use the account's preferred language, falling back to English. |
| FR-011 | Audit log entries never contain a full card number: any run of 13 to 19 digits, with single spaces or dashes allowed between digit groups, is replaced by `**** **** **** ` followed by its last four digits. |
| FR-012 | The aging report groups outstanding invoices into 0-30, 31-60, 61-90 and 90+ days past due. |
