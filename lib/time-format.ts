/**
 * Shared human-readable remaining-time formatter, e.g. "2h 30m" for quota
 * reset countdowns. Shared by token-plan, auto-resume and scheduled tasks.
 */
export function formatRemainingSeconds(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return "0s";
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  // Minutes are shown below a day; seconds only below an hour.
  if (days === 0 && minutes > 0) parts.push(`${minutes}m`);
  if (days === 0 && hours === 0 && seconds > 0) parts.push(`${seconds}s`);
  return parts.join(" ") || "0s";
}
