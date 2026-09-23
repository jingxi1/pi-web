# 对 upstream 原始代码的改动记录

> 目的：每次对 pi-web（相对 upstream 基线 v0.8.11）的改动，先回上游源码确认根因，再决定是否改；
> 本文记录「改了什么、为什么、是否发散于 upstream」。
> 配套完整 diff：`docs/records/upstream-diffs-2026-08-29.diff`

- 状态基准：Code/pi-web HEAD `2748836`（docs: preserve local md files on top of upstream v0.8.11）
- 线上实例（10.10.10.196:30141）跑在 `/Users/jingxi/build/pi-web`，launchd 服务 `com.jingxi.pi-web`，`next start` 生产模式，SDK `@earendil-works/pi-coding-agent@0.84.3`。

---

## 当前改动（2026-08-29）

### ① `lib/session-reader.ts` — `resolveSessionPath()` 增加免 git 的路径缓存预热（DIVERGENCE）

**改了什么**：新增 `warmSessionPaths()`（纯文件系统扫描 sessions 目录，按 `文件名_suffix + header id` 填充 `__piSessionPathCache`/`__piPathToSessionIdCache`，不 spawn git），并插入 `resolveSessionPath()` 的兜底链（在原有 `listAllSessions()` 之前）。

**upstream 原始行为**（`git show HEAD:lib/session-reader.ts` 的 `resolveSessionPath`）：
```
cache miss → findSessionPathById()  (快速, filename+header, 权威)
           → 否则 listAllSessions()   (→ attachSessionProjectInfo() → resolveProject() 对每个唯一 cwd spawn git)
```
- `listAllSessions()` → `loadAllSessions()` → `SessionManager.listAll()` + `attachSessionProjectInfo()`，后者对 **68 个 session 的每个唯一 cwd 逐一 `resolveProject()`（spawn git 子进程）**。
- 事件路由 `app/api/agent/[id]/events/route.ts` 在返回 SSE 前 `await resolveSessionPath(id)`；若落入 git 路径且慢/卡，前端固定 `EVENT_STREAM_READY_TIMEOUT_MS = 60_000` 先到 → 报 “Timed out starting the agent session. Please try again.”

**实测复现**：冷缓存下重开大旧 session，多次 **404**（resolveSessionPath 返回 null）或 **>30s 卡顿**；先调 `/api/sessions` 热缓存后即秒回。根因在 `listAllSessions()` 的 git 项目解析，属 pi-web 自身实现（非 SDK）。

**发散性**：是 pi-web 侧改动，不动 SDK。低风险（只提前做了 cacheSessionPath，最终仍会走原有 listAllSessions 兜底）。
**诚实说明**：那次 404 的确切竞态（冷缓存下 listAllSessions 未及时填充路径缓存）未 100% 锁死，本改动是防御性修正，非根治其神秘竞态。

### ② `hooks/useAgentSession.ts` — `connectEventsWithRetry()` 前端有限重试（DIVERGENCE, UX 兜底）

**改了什么**：新增 `connectEventsWithRetry()`，对 `ensureEventsConnected()` 的 `ready_timeout` / “Failed to connect” / “Session not found” 做最多 3 次、指数退避重试，再上抛；`sendMessage` 两处改用之。

**upstream 原始行为**：`sendMessage` 里 `await ensureEventsConnected(sid)` 一次失败即进 catch → 删乐观消息 + `restoreSubmission`。

**发散性**：纯前端行为，不改请求/协议语义，只在首败时多重试几次（SSE 层本就会在后台自愈）。

### ⚠️ 关于「模型不回复 / 文本消失」——我**未做任何代码修改**（upstream 设计，非回归）

**upstream 根因**（SDK `@earendil-works/pi-coding-agent@0.84.3` + `@earendil-works/pi-ai@0.84.3`）：
- `pi-ai/dist/api/openai-completions.js`（DGX provider 用的 `openai-completions`）只在该行生效：`...(options?.timeoutMs !== undefined ? { timeout: options.timeoutMs } : {})` —— **默认没有请求超时**。
- turn 运行循环调用 `modelRuntime.stream()` 时，`prepared.options` 只带 `signal`（供手动 abort），**不传默认 `timeoutMs`** → 模型端（DGX 盒子）偶发把一个请求卡住不返回时，fetch 无限等待 → run 永不 settle → `AgentSession.isStreaming` / pi-web `isPromptRunning` 永久 `true` → session 变“忙”。
- UI 再发提示词 → 服务端返回 HTTP 500 `prompt_rejected: Agent is already processing` → 前端 `sendMessage` catch 视为明确拒绝 → **删掉乐观消息** = “文本消失”。
- **TUI `pi` 同样无默认超时 → 同样会卡**。这不是 pi-web 回归，是 upstream 的设计 + 模型服务端问题。

**已做（无代码改动）**：
- 对卡死的 `01a047ba`（58.6 万字符上下文 + `thinkingLevel: high` 深度思考，105 条 assistant 含 11 条缺 reasoning，而模型 compat 有 `requiresReasoningContentOnAssistantMessages: true`）执行 `abort` 解卡；解卡后同会话再发提示词 **36.6s 正常完整回复**（agent_end + prompt_done）。
- 模型本身健康：DGX 最小 completion 0.7s、340KB 输入 20s、真实历史 258KB 28s。

**若要在 pi-web 层面解决「无限卡死」，属于对 upstream 的主动发散，需明确决策**（候选）：
1. pi-web 加“无进度看门狗”：run 开始后 N 秒（如 240s）无任何 token/工具输出则自动 `abort`，让 session 恢复、UI 保留消息并提示。（默认 240s 不误杀合法长 prefill 1–2 分钟。）
2. 前端收到 `prompt_rejected`（agent 忙）时不再静默删消息，改为保留 + 提示“可点停止”。
3. 缓解：降 `settings.json` 的 `defaultThinkingLevel`（high→medium）；对超大 session 做 compact。

> 以上 1/2 我**尚未实现**，等你确认是否接受这些 divergence。

---

## SDK 升级 0.84.3 → 0.84.4（2026-08-29，follow upstream，非发散）

- `build/pi-web/package.json`：`@earendil-works/pi-{agent-core,ai,coding-agent,tui}` 0.84.3 → 0.84.4；`npm ci --include=optional --include=dev` 重装 + `next build --webpack` + 重启加载。线上已跑 0.84.4（实例 PID 85194，新建+SSE+prompt+模型回复全通）。
- ⚠️ **0.84.4 并未修复「流式 body 无读超时」**：逐一 diff 0.84.3→0.84.4 的 `pi-ai/dist/api/openai-completions.js`，`timeout` 仍只在请求初始阶段（第 210 行 requestOptions），body 读取循环 `for await`（第 369 行）仍无 timeout / abort。SDK 核心 `http-dispatcher`/`settings-manager` 无超时相关改动。
  - 即：升级到 0.84.4 后，DGX 模型端中途停流时，pi 仍可能无限挂起（TUI `pi` 也一样）。看门狗等 pi-web 侧发散方案的决定仍开放。
- 操作坑记录（供后续）：build/pi-web 的 node_modules 与 package-lock 原本脱节，直接 `npm install` 会 prune 掉 `@tailwindcss/postcss` 等（默认被当作 optional/dev 跳过），重建报 `Cannot find module '@tailwindcss/postcss'` 及连锁 `@/lib/*` 误报。需用 `npm ci --include=optional --include=dev` 或显式 `npm install @tailwindcss/postcss tailwindcss`。

### ③ `lib/rpc-manager.ts` — 模型停流看门狗（DIVERGENCE, 针对“无限挂起”根因）

- **根因（upstream 缺口，0.84.4 也未修）**：`pi-ai` 的 openai-completions 只在请求初始阶段设 `timeout`，流式 body 读取循环 `for await` 无 timeout/abort → 模型端中途停流则 `fetch` 无限等待 → run 永不 settle → session 永久 `isStreaming`，后续 prompt 全被 `prompt_rejected` 拒，前端删乐观消息="文本消失"。TUI `pi` 同样有。
- **改什么**：`AgentSessionWrapper` 增加看门狗——订阅到任何内层事件都视为“前进”刷新时间戳；当 `pendingPromptCount>0 || isStreaming` 且(非 bash、非 compaction)且连续 **300s 无事件**，判定模型卡死，自动 `abort()` 把 run 解开，session 恢复，前端通过 `prompt_done` 收尾，并弹“模型长时间无响应，已自动停止”。
  - 阈值对齐 upstream `httpIdleTimeoutMs` 默认 300s；检查周期 15s。
  - 已在 build/pi-web 部署（实例 PID 85984，SDK 0.84.4 + ①②③），正常 prompt 安全通过（无误触发）。

## 已部署状态
- build/pi-web（线上）当前：SDK 0.84.4 + 上面 ①② 两个文件改动，`next build --webpack` + 重启加载。
- SDK 升级是 follow upstream（0.84.4 为 npm 最新），非发散；①②③ 是相对 upstream 的发散（③针对 upstream 无流式读超时的缺口）。
