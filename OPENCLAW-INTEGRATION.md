# OpenClaw 集成规范

> 本文档是 pi-tools (fork of `agegr/pi-web`) 中所有 OpenClaw 自定义功能的开发守则。  
> 目的：**让 OpenClaw 功能可被 upstream 大版本升级无痛保留**，不再每次都手工捞 5 块代码。

---

## 0. 为什么需要这份文档

`pi-tools` 是 `agegr/pi-web` 的 fork。OpenClaw 在它上面叠加了：

- 收藏会话（favorites）
- 通知系统（notify：dispatch / config UI）
- 定时任务（scheduled-tasks：cron / interval UI）
- Token 配额追踪（MinimaxTokenPlanBar）
- Node-pty 诊断（diag API）
- 终端命令 runner
- AppShell 自定义集成

2026-07-28 一次 upstream 0.7.16 → 0.8.2 升级暴露了一个核心问题：

- 这些功能以前散落在 `components/AppShell.tsx` 里（按钮 / state / modal 渲染）
- `AppShell.tsx` 又是 upstream **每个版本重写得最频繁的文件**
- `merge --theirs` 一次就丢掉 5 个 import + 2 个 state + 2 个按钮 + 2 个 modal + 1 个 bar
- 手工捞一次要 30+ 分钟

**守则目标**：把 OpenClaw 的"接缝面"压到**一行 import** + **一个文件**。

---

## 1. 核心原则

### 1.1 单一接缝面（Single Boundary）

> `AppShell.tsx` 中只允许出现一行 OpenClaw 相关代码：
>
> ```tsx
> import { OpenClawIntegration } from "./openclaw-integration";
> // ...
> <OpenClawIntegration />
> ```

- ❌ 不要在 AppShell 里 import OpenClaw 的具体 component
- ❌ 不要在 AppShell 里写 OpenClaw 的 state / hook / 按钮 / modal
- ❌ 不要把 OpenClaw 组件挂进 AppShell 的 JSX 树里（除了 `<OpenClawIntegration />`）

### 1.2 自包含特性（Self-contained Feature）

每个 OpenClaw 功能 = **一个 component + 一个 API 路由族**，对外只暴露 component prop 接口：

```
components/openclaw/
  ├─ notify-config.tsx           ← NotifyConfig 模态
  ├─ scheduled-tasks-config.tsx  ← ScheduledTasksConfig 模态
  └─ minimax-token-plan-bar.tsx  ← 配额条

app/api/openclaw/
  ├─ notify/route.ts             ← POST/GET 通知配置
  ├─ scheduled-tasks/route.ts    ← CRUD 定时任务
  └─ token-plan/[provider]/route.ts
```

特性之间**不互相依赖**。每个 component 自己管自己的：

- 自己的 state（`useState` 在 component 内部）
- 自己的数据获取（`fetch /api/openclaw/...`）
- 自己的 modal / drawer / toast

### 1.3 不接触 upstream 内部（No Upstream Internals）

- ❌ 不要修改 `components/AppShell.tsx`、`components/SessionSidebar.tsx`、`components/ChatInput.tsx` 等 upstream 核心文件来加 OpenClaw 逻辑
- ❌ 不要 monkey-patch upstream 的 hook / state / event
- ✅ 如果需要影响 upstream 行为，通过 props 回调 / event 暴露接口

### 1.4 公私分明（Public / Private Split）

`components/openclaw-integration.tsx` 是**唯一**对 AppShell 可见的 OpenClaw 文件。其它 OpenClaw 文件只能被 `openclaw-integration.tsx` 或同目录的 OpenClaw 文件引用。

```
AppShell  ─→  openclaw-integration  ─→  openclaw/*  (特性组件)
                         │
                         └─→ openclaw-internal/*  (内部 helpers，不允许 AppShell 直接引用)
```

---

## 2. 目录结构

```
components/
├─ AppShell.tsx                      ← upstream 文件，OpenClaw 这里只允许 1 行 import + 1 行 JSX
├─ openclaw-integration.tsx          ← 【唯一】OpenClaw 对外接缝
├─ openclaw/                         ← 特性组件，每个特性一个文件
│   ├─ notify-config.tsx
│   ├─ scheduled-tasks-config.tsx
│   ├─ minimax-token-plan-bar.tsx
│   └─ ...
└─ openclaw-internal/                ← 内部 helpers，特性组件之间共享
    ├─ api-client.ts                 ← fetch 封装
    ├─ storage.ts                    ← localStorage 封装
    └─ ...

app/api/openclaw/                    ← OpenClaw API 路由族，路径前缀统一
├─ notify/route.ts
├─ scheduled-tasks/route.ts
└─ token-plan/[provider]/route.ts

hooks/
├─ openclaw/                         ← OpenClaw 专属 hooks
│   ├─ use-notify-dispatch.ts        ← 上游 event → /api/openclaw/notify/dispatch
│   └─ ...
└─ (其它 upstream hooks)
```

**禁止**：
- ❌ 在 `app/api/` 下直接建 `app/api/notify/`（OpenClaw 跟 upstream 路径容易撞，应统一前缀 `openclaw/`）
- ❌ 在 `components/` 根目录建 OpenClaw 组件（应放进 `openclaw/`）
- ❌ 在 `hooks/` 根目录建 OpenClaw hooks（应放进 `openclaw/`）

---

## 3. 添加新功能 Checklist

新增 OpenClaw 功能前，按顺序做完这些：

- [ ] **命名**：用 kebab-case 文件名，特性前缀清晰（如 `notify-config.tsx` / `minimax-token-plan-bar.tsx`）
- [ ] **API 路由**：放在 `app/api/openclaw/<feature>/`，handler 自己管 auth / validation
- [ ] **Component**：放在 `components/openclaw/<feature>.tsx`，接收 props 不依赖任何 upstream 内部状态
- [ ] **Hook**（如需要）：放在 `hooks/openclaw/use-<feature>.ts`，命名 `use-` 前缀
- [ ] **注册到 OpenClawIntegration**：在 `openclaw-integration.tsx` 里 import + 渲染新 component（仅这一处）
- [ ] **不进 AppShell**：grep `AppShell.tsx` 应该找不到新特性名（除了 `<OpenClawIntegration />`）
- [ ] **测试**：本地 build + 双机部署后手测一次（按钮出现 / 模态打开 / API 通）
- [ ] **文档**：本文档 §5 加一行（新功能 + commit hash）

---

## 4. AppShell 集成约定

### 4.1 唯一允许的写法

```tsx
// components/AppShell.tsx
import { OpenClawIntegration } from "./openclaw-integration";

// ...其它 AppShell 代码...

return (
  // ...
  <>
    {/* 其它上游组件 */}
    <OpenClawIntegration />
  </>
);
```

### 4.2 OpenClawIntegration 内部应该长什么样（参考实现）

```tsx
// components/openclaw-integration.tsx
"use client";

import { useState } from "react";
import { NotifyConfig } from "./openclaw/notify-config";
import { ScheduledTasksConfig } from "./openclaw/scheduled-tasks-config";
import { MinimaxTokenPlanBar } from "./openclaw/minimax-token-plan-bar";
import { useNotifyDispatch } from "@/hooks/openclaw/use-notify-dispatch";

export function OpenClawIntegration() {
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [tasksOpen, setTasksOpen] = useState(false);

  // 上游 notify event 派发到后端（OpenClaw 全局唯一 hook）
  useNotifyDispatch();

  return (
    <>
      {/* toolbar 按钮组：通过 portal 或 inline 注入到 AppShell 的 toolbar */}
      <OpenClawToolbarButtons
        onNotify={() => setNotifyOpen(true)}
        onTasks={() => setTasksOpen(true)}
      />

      {/* 配额条：挂到 chat input 上方 */}
      <MinimaxTokenPlanBar enabled={currentProvider === "minimax-cn"} />

      {/* modal 渲染 */}
      {notifyOpen && <NotifyConfig onClose={() => setNotifyOpen(false)} />}
      {tasksOpen && <ScheduledTasksConfig onClose={() => setTasksOpen(false)} />}
    </>
  );
}
```

**关键**：所有 OpenClaw state / hooks / 按钮 / modal 都集中在 OpenClawIntegration 内部，AppShell 一行不知道这些细节。

### 4.3 工具栏按钮的位点（约束）

OpenClawIntegration 不能往 AppShell 的 toolbar 里直接加按钮（因为 AppShell 不知道 OpenClaw）。

两种解法：

**方案 A：Portal（推荐）**  
OpenClawIntegration 用 `createPortal` 把按钮渲染到 AppShell 的 toolbar DOM 节点（通过 `document.querySelector('[data-app-toolbar]')` 或 context API）。

**方案 B：位置约定**  
AppShell 在 toolbar 里预留一个 `<div id="openclaw-toolbar-slot" />`，OpenClawIntegration 在这个 slot 里渲染按钮。AppShell 不知道里面是什么。

**当前实现**：方案 B 更简单，等真正冲突再升级到方案 A。

---

## 5. OpenClaw 功能清单

| 特性 | Component | API 路由 | 引入 commit | 状态 |
|------|-----------|----------|-------------|------|
| 收藏会话 | `SessionSidebar.tsx` 内嵌 | `/api/sessions/favorites` | `f461c60` | ✅ |
| 收藏 UI 渲染（金 ⭐）| `SessionSidebar.tsx` 内嵌 | — | `c515490` | ✅ |
| 通知系统 | `NotifyConfig.tsx` | `/api/notify` `/dispatch` `/test` | pre-merge | ⚠️ inline |
| 定时任务 | `ScheduledTasksConfig.tsx` | `/api/scheduled-tasks` | pre-merge | ⚠️ inline |
| Token 配额 | `MinimaxTokenPlanBar.tsx` | `/api/token-plan/[provider]` | pre-merge | ⚠️ inline |
| Node-pty 诊断 | — | `/api/diag/node-pty` | pre-merge | ✅ |
| 终端命令 runner | — | `/api/terminal/command` | pre-merge | ✅ |

**未模块化**（标 ⚠️ 的）目前还散落在 `AppShell.tsx` 里。下次升级前必须按 §3 / §4 改完。

---

## 6. 跨 upstream merge 流程

upstream 大版本升级时（每几个月一次），按 TOOLS.md runbook 的 Phase 4 流程走，但**核心差异**：

### 旧流程（v0.7.16 → v0.8.2 实测）
1. merge --theirs 后 AppShell.tsx 丢了 5 块 OpenClaw 代码
2. 手工从 git history 找回来
3. 重复劳动 30+ 分钟

### 新流程（假设 OpenClaw 已模块化）
1. merge upstream，**AppShell.tsx 只丢 1 行** `<OpenClawIntegration />`
2. 这 1 行加回去（git diff 上一次版本就能找到）
3. 如果 OpenClawIntegration 内部某个上游 component API 变了，逐个修
4. 完成。预计 < 5 分钟

### 自检清单（每次 merge 后）

```bash
# 1. AppShell.tsx 里 OpenClaw 内容应该只剩 1 行
grep -n "openclaw\|OpenClaw" components/AppShell.tsx
# 期望: 只看到 import + JSX 调用，**不应该有** notify / tasks / token / NotifyConfig 等关键字

# 2. OpenClawIntegration 还在吗？
ls components/openclaw-integration.tsx

# 3. build + 测试
npm run build
# 浏览器手测: toolbar 出现 Notify / Tasks 按钮，模态打开正常
```

---

## 7. 代码示例

### ✅ 正确写法：openclaw-integration.tsx 内独立 state

```tsx
// components/openclaw-integration.tsx
export function OpenClawIntegration() {
  const [notifyOpen, setNotifyOpen] = useState(false);
  return (
    <>
      <OpenClawToolbarButton label="Notify" onClick={() => setNotifyOpen(true)} />
      {notifyOpen && <NotifyConfig onClose={() => setNotifyOpen(false)} />}
    </>
  );
}
```

### ❌ 错误写法 1：在 AppShell 里 inline

```tsx
// components/AppShell.tsx
import { NotifyConfig } from "./NotifyConfig";

export function AppShell() {
  const [notifyOpen, setNotifyOpen] = useState(false);  // ← 错!
  // ...
  return (
    <>
      <button onClick={() => setNotifyOpen(true)}>Notify</button>  // ← 错!
      {notifyOpen && <NotifyConfig onClose={() => setNotifyOpen(false)} />}  // ← 错!
    </>
  );
}
```

→ 下次 upstream 改 AppShell.tsx → 这些 inline 代码会被 merge --theirs 丢掉。

### ❌ 错误写法 2：跨目录引用

```tsx
// components/openclaw-integration.tsx
import { ProjectTrustDialog } from "@/components/ProjectTrustDialog";
// ProjectTrustDialog 是 upstream component，不该被 OpenClaw 内部 import
```

→ upstream 改 ProjectTrustDialog 的 props 时，OpenClaw 会跟着炸。

### ❌ 错误写法 3：跨 OpenClaw 组件直接依赖

```tsx
// components/openclaw/notify-config.tsx
import { useScheduledTasks } from "@/hooks/openclaw/use-scheduled-tasks";
// notify 不该 import scheduled-tasks 的 hook
```

→ 任何模块删了，notify 跟着炸。OpenClaw 特性之间用 `openclaw-internal/api-client` 这种共享层。

---

## 8. PR Review Checklist

review 一个涉及 OpenClaw 的 PR 时：

- [ ] **AppShell.tsx 没被改**：除非是加 `<OpenClawIntegration />` 那一行
- [ ] **新文件都在 `components/openclaw/` 或 `app/api/openclaw/`**：grep 一下确认没散落到根目录
- [ ] **component 用 props 接收 callback，不用 context 抓上游状态**：除非用 `OpenClawIntegration` 提供的 context
- [ ] **API handler 不依赖上游 session 结构**：自己读 query / body
- [ ] **build 过 + 浏览器手测通过**：CI 至少跑 `npm run build` + type check
- [ ] **§5 表格更新**：新功能 / 新 commit 加一行

---

## 9. 已知限制 / 待办

- [ ] OpenClaw 特性仍然 inline 在 AppShell.tsx 里（commit f34273e），**还没**按本文档模块化。下次 merge 之前必须做完。
- [ ] OpenClawIntegration 还没创建文件 —— 需要从 f34273e 提交里把那 36 行抽出来
- [ ] AppShell 的 toolbar slot（方案 B）还没创建 —— 需要在 toolbar 里加个 `<div id="openclaw-toolbar-slot" />`
- [ ] TokenPlanBar 硬编码 `enabled={true}` —— 需要 ChatWindow 暴露 provider callback

---

## 10. 变更记录

| 日期 | 变更 | 原因 |
|------|------|------|
| 2026-07-29 | 创建本文档 | v0.7→0.8 升级痛点驱动 |
| _待_ | 模块化改造（OpenClawIntegration 抽文件） | 见 §9 TODO |