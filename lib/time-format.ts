// Format a remaining-seconds count as a compact human-readable string.
// Used by both the token-plan API response and the auto-resume countdown
// banner so they stay visually consistent.
export function formatRemainingSeconds(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return "—";
  const totalSec = Math.floor(sec);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  if (days > 0) {
    return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  }
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}