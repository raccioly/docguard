import { TEMPLATES } from './templates.mjs';
import { DEFAULT_LANGUAGE } from '../config/defaults.mjs';

export function overdueEmail(account, invoice) {
  const templates = TEMPLATES[account.language] ?? TEMPLATES[DEFAULT_LANGUAGE];
  return templates.overdue.replace('{id}', invoice.id);
}
