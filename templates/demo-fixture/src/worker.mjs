// Worker service — consumes job queue.
import { connect } from './queue.mjs';

const handlers = {
  process_charge: async (job)   => { /* call Stripe */ },
  process_refund: async (job)   => { /* call Stripe refund API */ },
  settle_refund:  async (job)   => { /* mark refund as settled */ },
};

const queue = await connect(process.env.REDIS_URL);
queue.consume(async (job) => {
  const handler = handlers[job.type];
  if (!handler) throw new Error(`Unknown job: ${job.type}`);
  await handler(job);
});
