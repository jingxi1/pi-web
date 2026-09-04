/**
 * Detect whether an agent error message indicates a provider quota / billing
 * limit, which the auto-resume system can wait out and then replay.
 */

const PATTERNS = [
  /quota\s+exceeded/i,
  /insufficient\s+quota/i,
  /quota\s+limit/i,
  /no\s+quota/i,
  /billing/i,
  /daily\s+limit/i,
  /rate\s+limit/i,
  /429/i,
  /resource\s+exhausted/i,
  /free\s*tier\s+exhausted/i,
];

/** Returns true when the message hints at a recoverable quota/billing error. */
export function isQuotaError(message: string): boolean {
  if (!message) return false;
  return PATTERNS.some((p) => p.test(message));
}
