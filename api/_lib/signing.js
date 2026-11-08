// Request signing between this app and the website repository's publication job (same scheme as the website's scripts/lib/publish-job.mjs).
// HMAC-SHA256 over "<timestamp>.<body>", where the body of a GET is the string "GET:<path and query>". Five minute window.
import { createHmac, timingSafeEqual } from 'node:crypto';

export const sign = (secret, timestamp, body) => createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
export const signedHeaders = (secret, body, now = Date.now()) => ({ 'x-listings-timestamp': String(now), 'x-listings-signature': sign(secret, String(now), body) });
export function verifySignature(secret, timestamp, body, signature, now = Date.now(), maxSkewMs = 5 * 60 * 1000) {
  if (!secret || String(secret).length < 32 || !/^\d{10,16}$/.test(String(timestamp)) || Math.abs(now - Number(timestamp)) > maxSkewMs) return false;
  const a = Buffer.from(sign(secret, String(timestamp), body)); const b = Buffer.from(String(signature ?? ''));
  return a.length === b.length && timingSafeEqual(a, b);
}
