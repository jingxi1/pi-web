import { NextResponse } from "next/server";
import { readTasks, writeTasks } from "@/lib/scheduled-tasks-store";
import { runTask, isTaskRunning } from "@/lib/scheduled-tasks-runner";
import { computeNextRun } from "@/lib/scheduled-tasks-store";

export const dynamic = "force-dynamic";

/** GET — fetch a single task. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const task = readTasks().find((t) => t.id === id);
  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });
  return NextResponse.json({ task });
}

/** DELETE — remove a task (409 while running). */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (isTaskRunning(id)) {
    return NextResponse.json(
      { error: "Task is running and cannot be deleted" },
      { status: 409 }
    );
  }
  const tasks = readTasks();
  const next = tasks.filter((t) => t.id !== id);
  if (next.length === tasks.length) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }
  writeTasks(next);
  return NextResponse.json({ ok: true });
}

/** POST — manually run a task now (409 if already running). */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const tasks = readTasks();
  const task = tasks.find((t) => t.id === id);
  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });
  if (isTaskRunning(id)) {
    return NextResponse.json(
      { error: "Task is already running" },
      { status: 409 }
    );
  }

  try {
    const record = await runTask(task);
    task.lastRunAt = new Date().toISOString();
    task.lastResult = record;
    task.nextRunAt = task.enabled ? computeNextRun(task.schedule, new Date()).toISOString() : null;
    writeTasks(readTasks());
    return NextResponse.json({ record, task });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
