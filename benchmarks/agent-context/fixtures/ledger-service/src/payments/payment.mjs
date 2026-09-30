export function createPayment({ id, accountId, amount, currency = 'USD' }) {
  return { id, accountId, amount, currency };
}
