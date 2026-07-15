export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "edge") return;
  const { ensureScheduler } = await import("./lib/scheduled-tasks-scheduler");
  ensureScheduler();
}
