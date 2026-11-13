import { timingSafeEqual } from 'node:crypto';

/**
 * Vercel calls scheduled jobs with `Authorization: Bearer <CRON_SECRET>` when the
 * project has CRON_SECRET set. Nothing else in the request can be trusted, so jobs
 * run only with that secret.
 */
export function isScheduledRun(req, secret = process.env.CRON_SECRET) {
  if (typeof secret !== 'string' || secret.length < 16) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(String(req.headers?.authorization || ''));
  return received.length === expected.length && timingSafeEqual(received, expected);
}
