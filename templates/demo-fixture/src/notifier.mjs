// Notifier service — emails / Slack alerts on big charges or failures.
// ⚠️ Demo drift: ARCHITECTURE.md only mentions 3 services (API, Worker, Scheduler).
//    This fourth one (Notifier) is in code but missing from the architecture doc.
//    DocGuard's Docs-Diff + Docs-Coverage validators surface this.

import { Stripe } from './lib/stripe.mjs';

export async function notifyLargeCharge(charge) {
  if (charge.amount_cents > 100000) {
    await sendSlack(`💰 Large charge: $${charge.amount_cents / 100}`);
  }
}

export async function notifyFailure(charge, error) {
  await sendEmail({
    to: 'oncall@acme.dev',
    subject: `Charge failed: ${charge.id}`,
    body: error.message,
  });
}

async function sendSlack(text) { /* ... */ }
async function sendEmail(opts) { /* ... */ }
