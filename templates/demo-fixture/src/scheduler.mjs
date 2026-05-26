// Scheduler service — cron-style triggers.
import { enqueue } from './queue.mjs';

// Retry failed charges hourly
setInterval(async () => {
  const failed = await db.query('SELECT id FROM charges WHERE status = $1', ['failed']);
  for (const row of failed.rows) await enqueue({ type: 'process_charge', charge_id: row.id });
}, 60 * 60 * 1000);
