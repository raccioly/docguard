// API service — handles HTTP routes.
import { createServer } from 'node:http';

// Routes intentionally include /webhooks (not in API-REFERENCE.md — demo drift)
const ROUTES = {
  'POST /charge':            createCharge,
  'POST /refund':            createRefund,
  'GET /balance/:customer':  getBalance,
  'POST /webhooks':          handleStripeWebhook,   // ← undocumented
};

async function createCharge(req)  { /* ... */ }
async function createRefund(req)  { /* ... */ }
async function getBalance(req)    { /* ... */ }
async function handleStripeWebhook(req) { /* ... */ }

const PORT = process.env.PORT || 3000;
createServer((req, res) => { /* router */ }).listen(PORT);
