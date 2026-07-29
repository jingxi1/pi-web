export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "edge") return;

  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { configureHttpDispatcher } = await import("@/lib/http-dispatcher");
  configureHttpDispatcher();

  const { ensureScheduler } = await import("./lib/scheduled-tasks-scheduler");
  ensureScheduler();
}