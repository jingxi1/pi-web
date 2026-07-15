import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { readTasks, writeTasks, computeNextRun, validateCron } from "@/lib/scheduled-tasks-store";
import { ensureScheduler } from "@/lib/scheduled-tasks-scheduler";
import { isTaskRunning } from "@/lib/scheduled-tasks-runner";
import type { ScheduledTask, TaskSchedule } from "@/lib/scheduled-tasks-types";

export const dynamic = "force-dynamic";

interface IncomingTask {
  id?: string;
  name?: string;
  prompt?: string;
  cwd?: string;
  model?: { provider: string; modelId: string } | null;
  schedule?: TaskSchedule;
  enabled?: boolean;
  email?: { enabled: boolean; to?: string };
}

function validateSchedule(s: TaskSchedule | undefined): string | null {
  if (!s) return "缺少调度配置";
  if (s.type === "interval") {
    if (typeof s.everyMinutes !== "number" || s.everyMinutes < 1) return "interval.everyMinutes 必须 ≥ 1 分钟";
    return null;
  }
  if (s.type === "daily") {
    if (typeof s.time !== "string" || !/^\d{1,2}:\d{2}$/.test(s.time)) return "daily.time 格式必须为 HH:MM";
    return null;
  }
  if (s.type === "cron") {
    if (typeof s.expression !== "string" || !s.expression.trim()) return "cron.expression 不能为空";
    const v = validateCron(s.expression);
    if (!v.ok) return `cron 表达式无效: ${v.error}`;
    return null;
  }
  return "调度类型必须为 interval / daily / cron";
}

function validateTask(t: IncomingTask): string | null {
  if (!t.name?.trim()) return "名称不能为空";
  if (!t.prompt?.trim()) return "提示词不能为空";
  if (!t.cwd?.trim()) return "cwd 不能为空";
  return validateSchedule(t.schedule);
}

function withComputedFields(t: ScheduledTask): ScheduledTask {
  const now = new Date().toISOString();
  return {
    ...t,
    nextRunAt: t.enabled ? computeNextRun(t.schedule) : null,
    updatedAt: now,
  };
}

export async function GET() {
  try {
    ensureScheduler();
    const tasks = await readTasks();
    return NextResponse.json({ tasks, serverTime: new Date().toISOString() });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    ensureScheduler();
    const body = await req.json() as IncomingTask;
    const err = validateTask(body);
    if (err) return NextResponse.json({ error: err }, { status: 400 });

    const now = new Date().toISOString();
    const task: ScheduledTask = withComputedFields({
      id: randomUUID(),
      name: body.name!.trim(),
      prompt: body.prompt!,
      cwd: body.cwd!.trim(),
      model: body.model ?? null,
      schedule: body.schedule!,
      enabled: body.enabled !== false,
      email: { enabled: body.email?.enabled === true, to: body.email?.to?.trim() || undefined },
      lastRunAt: null,
      lastStatus: null,
      lastResult: null,
      nextRunAt: null,
      history: [],
      createdAt: now,
      updatedAt: now,
    });
    const tasks = await readTasks();
    tasks.push(task);
    await writeTasks(tasks);
    return NextResponse.json({ task });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    ensureScheduler();
    const body = await req.json() as IncomingTask & { id: string };
    if (!body.id) return NextResponse.json({ error: "id 必填" }, { status: 400 });
    const err = validateTask(body);
    if (err) return NextResponse.json({ error: err }, { status: 400 });

    const tasks = await readTasks();
    const idx = tasks.findIndex((t) => t.id === body.id);
    if (idx === -1) return NextResponse.json({ error: "任务不存在" }, { status: 404 });
    const prev = tasks[idx];
    if (isTaskRunning(prev.id)) {
      return NextResponse.json({ error: "任务正在执行中，请等待完成后再修改" }, { status: 409 });
    }
    const next: ScheduledTask = withComputedFields({
      ...prev,
      name: body.name!.trim(),
      prompt: body.prompt!,
      cwd: body.cwd!.trim(),
      model: body.model ?? null,
      schedule: body.schedule!,
      enabled: body.enabled !== false,
      email: { enabled: body.email?.enabled === true, to: body.email?.to?.trim() || undefined },
    });
    tasks[idx] = next;
    await writeTasks(tasks);
    return NextResponse.json({ task: next });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
