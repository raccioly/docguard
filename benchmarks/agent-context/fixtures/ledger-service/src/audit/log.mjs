import { redact } from './redact.mjs';
import { EVENTS } from './events.mjs';

export function createAuditLog() {
  const entries = [];
  return {
    record(event, detail) {
      if (!Object.values(EVENTS).includes(event)) throw new Error(`unknown audit event ${event}`);
      entries.push({ event, detail: redact(detail) });
    },
    entries() { return entries.map(e => ({ ...e })); },
  };
}
