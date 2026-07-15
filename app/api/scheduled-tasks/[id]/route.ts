import { NextResponse } from "next/server";
import { readTasks, writeTasks } from "@/lib/scheduled-tasks-store";
import { ensureScheduler } from "@/lib/scheduled-tasks-scheduler";
import { runTask, isTaskRunning } from "@/lib/scheduled-tasks-runner";
import {
  HISTORY_LIMIT,
  RESULT_PREVIEW_CHARS,
  type ScheduledTask,
  type TaskRunRecord,
} from "@/lib/scheduled-tasks-types";
import { computeNextRun } from "@/lib/scheduled-tasks-store";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function DELETE(_req: Request, ctx: RouteContext) {
  try {
    const { id } = await ctx.params;
    const tasks = await readTasks();
    const target = tasks.find((t) => t.id === id);
    if (!target) return NextResponse.json({ error: "任务不存在" }, { status: 404 });
    if (isTaskRunning(id)) {
      return NextResponse.json({ error: "任务正在执行中，请等待完成后再删除" }, { status: 409 });
    }
    const next = tasks.filter((t) => t.id !== id);
    await writeTasks(next);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(_req: Request, ctx: RouteContext) {
  try {
    const { id } = await ctx.params;
    ensureScheduler();
    const tasks = await readTasks();
    const target = tasks.find((t) => t.id === id);
    if (!target) return NextResponse.json({ error: "任务不存在" }, { status: 404 });
    if (isTaskRunning(id)) {
      return NextResponse.json({ error: "任务正在执行中" }, { status: 409 });
    }
    const result = await runTask(target);
    const at = new Date().toISOString();
    const record: TaskRunRecord = result.status === "success"
      ? {
          at,
          status: "success",
          summary: result.text.length > 200 ? `${result.text.slice(0, 200)}…` : (result.text || "(无输出)"),
        }
      : { at, status: "error", summary: result.errorMessage ?? "未知错误" };

    const truncatedResult = result.text.length > RESULT_PREVIEW_CHARS
      ? `${result.text.slice(0, RESULT_PREVIEW_CHARS)}…`
      : result.text;

    const all = await readTasks();
    const next = all.map((t) => {
      if (t.id !== id) return t;
      const updated: ScheduledTask = {
        ...t,
        lastRunAt: at,
        lastStatus: result.status,
        lastResult: result.status === "success" ? truncatedResult : (result.errorMessage ?? ""),
        history: [record, ...(t.history ?? [])].slice(0, HISTORY_LIMIT),
        nextRunAt: t.enabled ? computeNextRun(t.schedule, new Date(at)) : null,
        updatedAt: at,
      };
      return updated;
    });
    await writeTasks(next);
    return NextResponse.json({ result, task: next.find((t) => t.id === id) });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
