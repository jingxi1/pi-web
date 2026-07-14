// Mirrors the NON_RETRYABLE patterns from
// @earendil-works/pi-ai/dist/utils/retry.js. Quota errors are intentionally
// not retried by the SDK because they need hours of waiting, not seconds —
// so we own the resume scheduling for them.
const QUOTA_ERROR_PATTERNS: RegExp[] = [
  /quota exceeded/i,
  /insufficient[_\s-]?quota/i,
  /usage limit/i,
  /monthly usage limit/i,
  /available balance/i,
  /out of budget/i,
  /\bbilling\b/i,
];

export function isQuotaError(message: string | undefined | null): boolean {
  if (!message) return false;
  return QUOTA_ERROR_PATTERNS.some((re) => re.test(message));
}