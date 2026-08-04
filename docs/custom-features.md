# PiTools — 自定义功能清单

> **PiTools** 是 [agegr/pi-web](https://github.com/agegr/pi-web) (https://github.com/jingxi1/pi-web) 的 fork（git remote `upstream`）。以下文档列出 PiTools 在 upstream 之上开发的所有自定义功能，详细程度足以作为 agent/Pi 的提示词，辅助后续扩展开发。
>
> 核心集成规范见 [OPENCLAW-INTEGRATION.md](/OPENCLAW-INTEGRATION.md)。

---

## 目录

1. [邮件通知系统](#1-邮件通知系统-notify)
2. [定时任务系统](#2-定时任务系统-scheduled-tasks)
3. [令牌(Token)配额追踪 & 自动恢复](#3-令牌配额追踪与自动恢复)
4. [嵌入式终端](#4-嵌入式终端-terminal)
5. [会话收藏](#5-会话收藏-favorites)
6. [快捷键面板](#6-快捷键面板-shortcuts)
7. [消息快速跳转 FAB](#7-消息快速跳转-fab)
8. [Toast 通知系统](#8-toast-通知系统)
9. [版本信息显示](#9-版本信息显示)
10. [移动端体验增强](#10-移动端体验增强)
11. [CSS/UI 调优](#11-cssui-调优)
12. [Docker 部署](#12-docker-部署)
13. [OpenClaw 集成边界](#13-openclaw-集成边界)
14. [响应式断点系统](#14-响应式断点系统)
15. [侧边栏重构 & 性能优化](#15-侧边栏重构--性能优化)
16. [多级断点侧边栏](#16-多级断点侧边栏)
17. [扩展 UI 解析器](#17-扩展-ui-解析器-extension-custom-ui-parser)
18. [代码块复制反馈 + 微交互动画](#18-代码块复制反馈--微交互动画)
19. [辅助工具与基础设施](#19-辅助工具与基础设施)
20. [信任域 (Trust Domains)](#20-信任域-trust-domains)
21. [PWA 支持](#21-pwa-支持)
22. [模型价格预设 & 上游发现](#22-模型价格预设--上游发现)
23. [系统架构与数据流图](#23-系统架构与数据流图)
24. [接口契约 (API Contract)](#24-接口契约-api-contract)
25. [CSS 类名与 Keyframes 清单](#25-css-类名与-keyframes-清单)
26. [全局变量 (globalThis 注册表)](#26-全局变量-globalthis-注册表)
27. [测试策略](#27-测试策略)
28. [环境变量清单](#28-环境变量清单)
29. [更新日志 (f152945 之后)](#29-更新日志-f152945-之后)

---

## 1. 邮件通知系统 (Notify)

### 概述
当 agent 完成、报错或需要用户输入时，通过 SMTP 发送邮件通知。支持对三种事件类型分别开关、自定义 SMTP 配置、主题前缀。

### 文件清单
| 文件 | 作用 |
|------|------|
| `app/api/notify/route.ts` | GET 读取配置 / PUT 保存配置（密码保密回写） |
| `app/api/notify/dispatch/route.ts` | POST 派发通知事件（agentEnd / error / inputNeeded）→ 构建邮件正文发 SMTP |
| `app/api/notify/test/route.ts` | POST 测试 SMTP 连接 |
| `components/NotifyConfig.tsx` | UI 模态：SMTP 配置、地址、事件开关、测试/保存 |
| `lib/notify-config.ts` | 读写 `~/.pi/agent/notify.json` |
| `lib/notify-types.ts` | 类型定义、默认值、验证、密码剥离 |
| `lib/notify-emitter.ts` | 客户端事件总线（emit / onNotifyEvent） |
| `lib/email-sender.ts` | nodemailer 封装的 createTransport / sendMail / verify |
| `hooks/useNotify.ts` | React hook：监听 notify-emitter 事件 → POST /api/notify/dispatch |

### 数据流

```
useAgentSession
  ↓ on agentEnd / prompt_error / extension_ui_request
emitNotifyEvent({ type, sessionId, sessionName, summary, detail })
  ↓
hooks/useNotify (客户端)
  ↓ POST /api/notify/dispatch
  ↓
dispatch/route.ts
  ↓ readNotifyConfig → 检查 enabled / event enabled
  ↓ sendNotifyEmail(config, { subject, text, html })
  ↓ nodemailer → SMTP → 用户邮箱
```

### 配置结构 (`~/.pi/agent/notify.json`)

```json
{
  "enabled": true,
  "smtp": { "host": "smtp.qq.com", "port": 465, "secure": true, "user": "...", "pass": "..." },
  "from": "...@qq.com",
  "to": "...@qq.com",
  "subjectPrefix": "[pi-web]",
  "events": { "agentEnd": true, "error": true, "inputNeeded": true }
}
```

### 扩展点

1. **新增通知渠道**（如企业微信、Slack、飞书）：
   - 在 `lib/` 下新建 `notify-{channel}.ts`，实现 `sendNotify{Channel}()`
   - 扩展 `NotifyConfig` 类型加渠道开关
   - `dispatch/route.ts` 的 POST handler 里 call 新的 sender
   - `NotifyConfig.tsx` 加对应的 UI

2. **新增通知事件类型**：
   - `notify-types.ts` 的 `NotifyEventType` union 加新值
   - `dispatch/route.ts` 的 `EVENT_SUBJECTS` 加映射
   - `NotifyConfig.tsx` 的 `EVENT_LABELS` / `EVENT_DESCRIPTIONS` 加 UI 标签
   - `useAgentSession.ts` 里在对应的 lifecycle event 处调用 `emitNotifyEvent()`

---

## 2. 定时任务系统 (Scheduled Tasks)

### 概述
在 pi agent 内运行定时自动化任务。支持三种调度模式（interval / daily / cron），可指定模型和执行目录，执行结果通过邮件发送。

### 文件清单
| 文件 | 作用 |
|------|------|
| `app/api/scheduled-tasks/route.ts` | GET 列表 / POST 创建 / PUT 更新 |
| `app/api/scheduled-tasks/[id]/route.ts` | DELETE 删除 / GET 详情 |
| `components/ScheduledTasksConfig.tsx` | UI 模态：完整 CRUD（~1300 行） |
| `lib/scheduled-tasks-types.ts` | 类型定义（ScheduledTask、TaskSchedule、TaskRunRecord 等） |
| `lib/scheduled-tasks-store.ts` | 读写 `~/.pi/agent/scheduled-tasks.json`，计算 `nextRunAt` |
| `lib/scheduled-tasks-scheduler.ts` | 全局调度器（setInterval 60s tick），检测到期任务并发起执行 |
| `lib/scheduled-tasks-runner.ts` | 单次任务执行器：startRpcSession + set_model + prompt + waitForPromptDone + 可选发邮件 |
| `lib/cron.ts` | 纯函数 cron 解析器：parseCron / validateCron / nextCronRun / nextCronRuns |

### 调度类型

| 类型 | 字段 | 示例 |
|------|------|------|
| `interval` | `everyMinutes: number` | 每 60 分钟执行 |
| `daily` | `time: string` ("HH:MM") | 每天 09:00 |
| `cron` | `expression: string` (5-field) | `*/5 * * * *` |

### 数据流

```
lib/scheduled-tasks-scheduler.ts
  ↓ ensureScheduler() 在首次 GET/POST/PUT 时启动
  ↓ setInterval(TICK_INTERVAL_MS = 60_000)
  ↓ processDueTasks()
  ↓   readTasks()
  ↓   fillMissingNextRun() — 补全缺失的 nextRunAt
  ↓   找出 due (enabled && nextRunAt ≤ now)
  ↓   对每个 task → runTask(task)
  ↓     startRpcSession → set_model → prompt
  ↓     waitForPromptDone (10 min timeout)
  ↓     maybeSendEmail(task, text)
  ↓   writeTasks() 记录结果
```

### 扩展点

1. **新增调度类型**（如 `weekday`、`monthly`）：
   - `TaskSchedule` union 加新成员
   - `computeNextRun()` 加 case
   - `components/ScheduledTasksConfig.tsx` 的表单加新 tab/字段

2. **任务执行前 hook**（如检查网络、拉取最新代码）：
   - 在 `scheduled-tasks-runner.ts` 的 `runTask()` 开头加预处理逻辑

3. **更多执行后动作**（如 Webhook callback）：
   - 在 `maybeSendEmail()` 同级加新的 notifier

---

## 3. 令牌配额追踪与自动恢复

### 概述
为 MiniMax 等提供商提供实时配额用量显示，并在触发配额/计费错误时自动调度恢复 — 等待额度重置后自动重发被拒绝的 prompt。

### 文件清单
| 文件 | 作用 |
|------|------|
| `app/api/token-plan/[provider]/route.ts` | GET 从上游 API（如 MiniMax）获取配额数据，60s 缓存 |
| `components/MinimaxTokenPlanBar.tsx` | UI 条：显示 5 小时间隔 + 每周配额百分比，以及自动恢复排期 pill |
| `hooks/useMinimaxTokenPlan.ts` | React hook：60s 轮询 token-plan API，检测 intervalPercent 重置 |
| `hooks/useMinimaxTokenPlan.ts` (continued) | 内部实现：`prevGeneralPercent` ref 从 <100 → 100 时触发 `onIntervalReset` |
| `lib/auto-resume-store.ts` | 客户端单例 store：持久化到 localStorage，管理 schedule/cancel/fire 的生命周期 |
| `lib/quota-error.ts` | 错误模式匹配（quota exceeded / insufficient quota / billing 等） |
| `lib/time-format.ts` | `formatRemainingSeconds()` — 共享时间格式化 |

### 自动恢复流程

```
useAgentSession: prompt_error
  ↓ isQuotaError(errMsg) 为 true
  ↓ 查询 /api/token-plan/{providerId} 获取 intervalResetsIn
  ↓ autoResumeStore.schedule({ sessionId, providerId, lastPrompt, wakesAt })
  ↓     写入 localStorage（pi-auto-resume-v1）
  ↓
MinimaxTokenPlanBar 显示 "N in {time} ×" pill
  ↓
useMinimaxTokenPlan 轮询: intervalPercent 从 <100 → 100
  ↓ autoResumeStore.fireOnReset(providerId)
  ↓     遍历该 provider 所有排期
  ↓     当前 session → triggerResume()
  ↓     其他 session → POST /api/agent/{id} { prompt }
```

### 扩展点

1. **新增提供商配额追踪**：
   - `SUPPORTED` map 在 `route.ts` 加新 entry（envKey、上游 URL）
   - `normalize()` 适配上游返回格式
   - `MinimaxTokenPlanBar` 里 `enabled={currentProviderId === "..."}`

2. **自动恢复后发送通知**（如邮件通知 "session X resumed"）：
   - 在 `autoResumeStore.fireOnReset()` 通知处加 emit

---

## 4. 嵌入式终端 (Terminal)

### 概述
基于 node-pty + xterm.js 的全功能 Web 终端。支持多 session 管理、zsh/bash 自动适配、CRT 风格主题、剪贴板、SSE 实时流。

### 文件清单
| 文件 | 作用 |
|------|------|
| `lib/terminal-manager.ts` | PTY 引擎核心 (~500 行)：spawn / write / resize / kill / subscribe / scrollback |
| `lib/terminal-command-runner.ts` | 单次命令 runner：非交互 PTY，捕获 stdout + exitCode |
| `components/TerminalView.tsx` | React 组件：xterm.js 实例化、SSE 连接、输入转发、剪贴板、resize、重连 |
| `app/api/terminal/route.ts` | POST 创建终端 session（resolveCwd → spawnTerminal） |
| `app/api/terminal/[id]/route.ts` | GET 状态 / POST input/resize/kill/continue |
| `app/api/terminal/[id]/events/route.ts` | GET SSE 实时流（scrollback replay + 实时 data + exit 事件） |
| `app/api/terminal/command/route.ts` | POST 执行一次性命令（`runCommand`） |
| `app/api/diag/node-pty/route.ts` | GET 诊断终端环境（node-pty 版本、shell、精确错误信息） |

### 终端特性

- **Shell 自动适配**：bash → `--rcfile`；zsh → `ZDOTDIR` + `.zshrc`（因为 zsh 不支持 `--rcfile`）
- **开机初始化**：source 用户 `~/.bashrc`/`~/.zshrc` 等（nvm / conda / starship / brew shellenv / fzf 可用）
- **跨平台 fallback**：Windows 路径在 Docker 容器内自动 fallback 到 `/workspace` 或 `$HOME`
- **安全限制**：cwd 必须在 allowed roots 内
- **SIGKILL 升级**：macOS 上 `&`-backgrounded 子进程的 SIGHUP 不生效时，1.5s 后升级 SIGKILL
- **滚动缓冲**：200 KB 环状 scrollback（chunked array 避免大 string 拼接导致事件循环阻塞）
- **CRT 主题**：绿色 (#7cfc00) 前景 + 琥珀色 (#ffb000) 光标 + 黑色 (#0a0e0a) 背景
- **Ctrl+Shift+C / V**：复制/粘贴（通过 Clipboard API）
- **进程退出后交互**：Enter → 重启 shell；其他键 → 关闭 tab
- **SSE 重连**：EventSource 自动重连 + `replay: true` 标记硬重置屏幕

### 扩展点

1. **新增终端主题**：
   - 在 `TerminalView.tsx` 的 `readTheme()` 里换色板
   - 或从 settings/ls 文件读取主题名

2. **终端分屏/多 tab**：
   - 当前每个终端一个 `TerminalView` 组件实例
   - 可以做成像 VS Code 的 terminal tabs：`killTerminal` 后清理

3. **远程终端/SSH**：
   - `lib/terminal-manager.ts` 的 `spawnTerminal` 改为 spawn SSH client
   - 或加一个 `remote: { host, user }` 参数

---

## 5. 会话收藏 (Favorites)

### 概述
为会话侧边栏添加收藏功能：星标切换 + 独立收藏 tab + 删除确认。
**在 Sessions 选项卡中不出现收藏的折叠列表**——收藏会话仅在 "Favorites" 选项卡中显示。

### 文件清单
| 文件 | 作用 |
|------|------|
| `app/api/sessions/favorites/route.ts` | GET 读取收藏列表 / POST 切换收藏状态 |
| `lib/favorites-store.ts` | 持久化 `~/.pi/agent/favorites.json`，含 30s 缓存 + globalThis |
| `components/SessionSidebar.tsx` | 收藏星标渲染、toggle 处理、收藏 tab、删除确认 |

### 功能细节

- **数据存储**：`~/.pi/agent/favorites.json`，JSON 数组存 sessionId 字符串
- **独立生命周期**：不依赖 session 文件存在性，删除 session 文件不会留下悬空标记
- **乐观更新**：前端立即翻转星标，失败时回滚
- **双 tab 侧边栏**："Sessions" 和 "Favorites" 两个 tab
- **单一展示位置**：收藏会话列表**仅**在 "Favorites" 选项卡中展示；Sessions 选项卡中不渲染任何收藏折叠列表/面板（避免重复入口和状态混乱）
- **星标渲染**：每个 SessionItem 在 hover 时显示星标按钮，isFavorite=true 时填充金黄色 `#f59e0b`，不影响 SessionItem 本身的布局
- **删除确认**：删除 session 前弹确认对话框，避免误删
- **动画过渡**：星标添加/移除有视觉反馈（星标/删除按钮明确的 hover 和 active 状态）

### UI 布局约定

| 位置 | 渲染内容 | 备注 |
|------|----------|------|
| Sessions 选项卡 | 仅 SessionTreeItem + 上下文重置 + RUNNING 面板 | **不**包含收藏折叠列表 |
| Favorites 选项卡 | favoriteSessions.flatMap → SessionItem 列表 | 独占面板，无折叠 |
| SessionItem hover | ⭐ 星标按钮 | 全局可见，与所在 tab 无关 |

> 为什么要拆掉 Sessions 选项卡里的折叠列表？
> - 避免“同一会话出现在 Sessions 和 Favorites 两个位置”的状态歧义
> - Favorites 选项卡本身是独立面板，不需要折叠
> - 减少 sidebar 状态变量（`favoritesPanelOpen` 可以全部移除）

### 扩展点

1. **收藏分组/标签**：
   - `favorites.json` 扩展为 `{ favoriteSessionIds: string[], tags: Record<string, string[]> }`
   - `SessionSidebar.tsx` 加标签筛选 UI（在 Favorites 选项卡中实现）

2. **跨设备同步**：
   - 将 `favorites.json` 存储改到云端
   - 或通过 `GET /api/sessions` 返回时注入

---

## 6. 快捷键面板 (Shortcuts)

### 概述
`?` 键触发、ESC 关闭的快捷键一览面板。按功能分组展示所有可用快捷键。

### 文件清单
| 文件 | 作用 |
|------|------|
| `components/ShortcutsPanel.tsx` | 面板组件 + 模块级注册器 (`setShortcutsPanelOpener`) |

### 快捷键清单

| 分组 | 快捷键 | 功能 |
|------|--------|------|
| Chat | Enter | 发送消息 |
| Chat | Shift+Enter | 换行 |
| Chat | Esc | 停止 agent / 关闭菜单 |
| Navigation | Ctrl+Alt+N | 当前项目新建 session |
| Navigation | ? | 切换快捷键面板 |
| Input | / | 输入斜杠命令 |
| Input | @ | 输入文件提及 |
| Input | Tab | 接受自动完成 |
| Input | ↑↓ | 上一个/下一个完成项 |

### 扩展点

1. **新增快捷键**：
   - `SHORTCUTS` 数组加新 entry
   - 在对应组件监听 keydown

2. **快捷键自定义**：
   - 后端存一份可配置的 keymap.json
   - `ShortcutsPanel` 渲染实际绑定

---

## 7. 消息快速跳转 FAB

### 概述
在移动端/平板端替代 ChatMinimap（桌面端专用），用一个浮动按钮点击展开所有消息的预览列表，点击跳转到对应消息。

### 文件清单
| 文件 | 作用 |
|------|------|
| `components/ChatMinimapFab.tsx` | ~220 行：浮动按钮 + 弹出消息列表面板 |

### 设计决策

- **桌面端**：仍使用原始的 `ChatMinimap`（侧边 minimap）
- **平板端**：使用 `ChatMinimapFab`（浮动按钮 + 弹出列表）
- **移动端**：不显示 minimap（屏幕空间有限）
- 消息预览：取前 120 字符普通文本或 toolName 列表
- 展示 user 消息左侧带 accent 色竖条

### 扩展点

1. **支持搜索过滤**：
   - 在弹出列表顶部加搜索输入框
   - 实时过滤匹配的消息文本

2. **消息类型图标**：user 消息 / assistant 消息 / tool 调用用不同图标区分

---

## 8. Toast 通知系统

### 概述
轻量级客户端通知系统，支持 info / success / warning / error 四种类型，带自动消失和可选的 action 按钮。

### 文件清单
| 文件 | 作用 |
|------|------|
| `components/Toast.tsx` | 模块级单例 + toast API + ToastHost 组件 |

### API

```typescript
toast.info("message")
toast.success("message")
toast.warning("message", { duration: 5000, action: { label: "Undo", onClick: () => {} } })
toast.error("message")
toast.dismiss("t1")
```

### 扩展点

1. **添加新类型**：`ToastKind` union 加新值
2. **全局配置**：默认 duration per type

---

## 9. 版本信息显示

### 概述
在空状态页展示三个版本号，用于区分上游、本 fork 和 pi SDK。

### 文件清单
| 文件 | 变化 |
|------|------|
| `next.config.ts` | 构建时从 upstream git 读取 `NEXT_PUBLIC_PIWEB_VERSION`，本 fork 版本设为 `PI_TOOLS_VERSION` |
| `components/ChatWindow.tsx` | 空状态页显示三行：`PiWeb v{version}` / `PiTools v{version}` / `pi v{version}` |

### 版本来源

| 变量 | 来源 |
|------|------|
| `NEXT_PUBLIC_PIWEB_VERSION` | `git show upstream/main:package.json` → version 字段 |
| `NEXT_PUBLIC_PI_TOOLS_VERSION` | 本 repo 的 `package.json` → version 字段 |
| `NEXT_PUBLIC_PI_VERSION` | `@earendil-works/pi-coding-agent/package.json` → version 字段 |

---

## 10. 移动端体验增强

### 概述
针对手机/平板的体验优化：虚拟键盘检测、安全区域适配、三档响应式断点、滑动关闭侧边栏、相机拍照上传。

### 文件清单
| 文件 | 作用 |
|------|------|
| `hooks/useVisualViewport.ts` | SSR-safe hook：通过 `window.visualViewport` 获取键盘高度 |
| `hooks/useKeyboardInset.ts` | 替代方案：监听 visualViewport.resize 计算键盘 inset |
| `hooks/useBreakpoint.ts` | SSR-safe 断点 hook：mobile / tablet / desktop |
| `hooks/useIsMobile.ts` | （upstream 已有）升级为 shared |
| `hooks/useSwipeDismiss.ts` | 触摸划动手势检测：轴、阈值、速度 |
| `app/layout.tsx` | 添加 viewport: `width: device-width, initialScale: 1, maximumScale: 1, viewportFit: cover` |
| `app/layout.tsx` | body 添加 `padding-*: env(safe-area-inset-*)` |
| `components/ChatInput.tsx` | 从 `translateY` 改为 `paddingBottom: keyboardHeight` |
| `components/ChatInput.tsx` | 移动端显示相机按钮 `capture="environment"` |
| `components/AppShell.tsx` | 桌面端用 `useBreakpoint`，非 desktop 自动关闭侧边栏 |
| `components/AppShell.tsx` | 侧边栏添加滑动关闭手势 |

### 扩展点

1. **横向键盘工具栏**：键盘上方固定一行快捷键按钮
2. **可拖拽分割线**：桌面端侧边栏宽度可调（拖拽 resize）

---

## 11. CSS/UI 调优

### 概述
深色/亮色模式颜色微调、代码块视觉效果升级、过渡动画。

### 文件清单
| 文件 | 变化 |
|------|------|
| `app/globals.css` | 所有 CSS 变量微调（对比度、色调、亮度），详细值见下方表格 |

### 颜色调整（深色模式）

| 变量 | 旧值 | 新值 |
|------|------|------|
| `--text` | `#e8e8e8` | `#ededed` |
| `--text-muted` | `#9ca3af` | `#a8b0bd` |
| `--text-dim` | `#6b7280` | `#8b93a1` |
| `--accent` | `#60a5fa` | `#7eb6ff` |
| `--accent-hover` | `#93c5fd` | `#a3c8ff` |
| `--bg-panel` | `#242424` | `#232323` |
| `--bg-hover` | `#2e2e2e` | `#2c2c2c` |
| `--tool-bg` | `#1f2937` | `#202836` |
| `--bg-subtle` | `rgba(255,255,255,0.04)` | `rgba(255,255,255,0.05)` |
| 亮色 `--text-dim` | `#9ca3af` | `#8a93a0` |

### 代码块优化

- 添加 `box-shadow` 层级效果（基础 + 半像素高光边）
- 深色模式独立 shadow
- hover 时边框高亮
- Copy 按钮：`is-copied` 状态绿色动效（`code-copy-pulse` 动画）
- 所有按钮 hover/active 状态添加 `transition`（color / border-color / background / transform 均 0.18s ease）

---

## 12. Docker 部署

### 概述
完整的多阶段 Docker 构建 + docker-compose 部署，支持内网镜像源、代理、Harbor。

### 文件清单
| 文件 | 作用 |
|------|------|
| `Dockerfile` | 双阶段构建（builder + runner）；支持 `BASE_IMAGE` / `NPM_REGISTRY` / `APT_MIRROR` / `HTTP_PROXY` / `HTTPS_PROXY` build-arg |
| `docker-compose.yml` | 生产部署配置，挂载 `data/pi-agent` / `workspace` / `pi-home` 三个 volume |
| `docker-compose.build.yml` | 本地构建 compose（可扩展） |
| `docker-entrypoint.sh` | 容器入口脚本（git clone 可选、自动 chmod node-pty） |
| `build-and-push.sh` | 构建 & 推送镜像到 Harbor 脚本 |

### 构建参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `BASE_IMAGE` | `node:22-bookworm-slim` | 基础镜像（可换内网镜像） |
| `NPM_REGISTRY` | `https://registry.npmmirror.com` | npm 镜像源 |
| `APT_MIRROR` | `mirrors.tuna.tsinghua.edu.cn` | apt 镜像源 |
| `HTTP_PROXY` / `HTTPS_PROXY` | 空 | 代理地址 |

### 持久化目录

| 容器路径 | Host 路径 | 用途 |
|----------|-----------|------|
| `/data/pi-agent` | `./data/pi-agent` | pi agent 会话、模型配置、notify.json |
| `/workspace` | `./workspace` | 代码工作区 |
| `/home/pi` | `./pi-home` | "使用默认目录" 按钮落点 |

---

## 13. OpenClaw 集成边界

### 概述
`OPENCLAW-INTEGRATION.md` 定义了所有自定义功能与 upstream 的接缝面规范，使得 upstream merge 时只需恢复 1 行 import 即可保留所有自定义功能。

### 核心文件

| 文件 | 作用 |
|------|------|
| `components/openclaw-integration.tsx` | **唯一**对 `AppShell.tsx` 可见的 OpenClaw 文件 |
| `OPENCLAW-INTEGRATION.md` | 规范文档 |

### 设计原则

1. **单一接缝面**：AppShell.tsx 只含一行 `import { OpenClawIntegration } from "./openclaw-integration"` + `<OpenClawIntegration />`
2. **自包含特性**：每个特性 = 一个 component + 一个 API 路由族，对外只暴露 prop 接口
3. **不接触 upstream 内部**：不修改 AppShell、SessionSidebar、ChatInput 等上游核心文件来加 OpenClaw 逻辑
4. **公私分明**：`openclaw-integration.tsx` 是唯一对 AppShell 可见的导入点

### 当前集成状态

| 特性 | 集成方式 | 已模块化 |
|------|----------|----------|
| NotifyConfig | `createPortal` 注入 toolbar slot | ✅ component 级别 |
| ScheduledTasksConfig | `createPortal` 注入 toolbar slot | ✅ component 级别 |
| MinimaxTokenPlanBar | inline 渲染 | ✅ component 级别 |
| 收藏会话 | SessionSidebar 内嵌 | ⚠️ 待抽取 |
| 终端 | 独立页面/FileViewer 内 | ✅ 独立功能 |

---

## 14. 响应式断点系统

### 概述
三档 SSR-safe 断点 hook，替代上游单一的 `useIsMobile()` 布尔值。

### 文件清单

| 文件 | 作用 |
|------|------|
| `hooks/useBreakpoint.ts` | SSR-safe：基于 `window.matchMedia` 的 `useSyncExternalStore` |

### 断点定义

| 断点 | 视口宽度 | 行为 |
|------|----------|------|
| `"mobile"` | < 768px | 覆盖层侧边栏、无 minimap、转屏适配、相机拍照 |
| `"tablet"` | 768px–1023px | 覆盖层侧边栏、ChatMinimapFab、分屏适配 |
| `"desktop"` | ≥ 1024px | 固定侧边栏、ChatMinimap、正常布局 |

### 扩展点

1. **四档断点**（加 `"laptop": 1024px–1439px`）：
   - 在 hook 加新 query
   - 各组件适配新断点

---

## 15. 侧边栏重构 & 性能优化

### 概述
Session 树构建算法从 O(n²) 优化到 O(n)、收藏 tab 分板、运行中面板、上下文重置按钮、favicon 源数据。

### 文件清单

| 文件 | 变化 |
|------|------|
| `components/SessionSidebar.tsx` | ancestorCache Memo、useMemo sessionTree、双 tab 分板、收藏集成、运行中面板、重置确认按钮 |

### 性能优化

- **ancestorCache**：`resolveAncestor()` 用 `Map<string, string | null>` 缓存每个 session 的祖先查找结果，避免长 fork 链上重复遍历
- **useMemo sessionTree**：只在 `filteredSessions` 变化时重建树
- **双 tab 分流**：Sessions / Favorites 两个独立面板

### 新增 sidear 功能

- **运行中面板**（RUNNING）：显示正在运行的 session（不受项目筛选影响）
- **上下文重置按钮**：两次点击确认机制，重置到根节点
- **favicon 数据源**：session 的 `metadata.favicon` 字段用于显示 web app 图标

### 收藏面板布局约定

- Sessions / Favorites 两个选项卡独立渲染，**互不嵌套**
- Sessions 选项卡中**不**出现折叠的 Favorites 列表（避免重复入口）
- Favorites 选项卡为 flat list，无折叠状态
- 删除 SessionSidebar 中的 `favoritesPanelOpen` state 及其 toggle 逻辑

---

## 16. 多级断点侧边栏

### 概述
AppShell 将 sidebar 开关逻辑从 `useIsMobile` 升级为 `useBreakpoint`，侧边栏在 `mobile` 和 `tablet` 断点下为覆盖层。

### 文件

| 文件 | 变化 |
|------|------|
| `components/AppShell.tsx` | 改用 `useBreakpoint` + 手势滑动关闭 |

### 行为

- `desktop`：永久固定侧边栏
- `tablet`：默认隐藏，手势/按钮打开覆盖层
- `mobile`：同上 + 键盘避让 + 相机按钮

---

## 17. 扩展 UI 解析器 (Extension Custom UI Parser)

### 概述
解析 agent 返回的 `extension_ui_request` 事件中的自定义 UI 定义（如 select、confirm、input、editor 等交互类型），将其转换为前端可渲染的组件描述对象。

### 文件清单
| 文件 | 行数 | 作用 |
|------|------|------|
| `lib/extension-custom-ui-parser.ts` | 309 | 解析 extension_ui_request 的 method/options/title/message，生成标准化的 UI 描述对象 |

### 功能
- 支持解析 `select`（选项列表选择）、`confirm`（确认对话框）、`input`（文本输入）、`editor`（多行编辑）四种交互类型
- 将 agent 返回的嵌套数据结构扁平化为前端可直接渲染的 `{ type, title, message, options, defaultValue }` 格式
- 为 `useAgentSession.ts` 中的 `handleExtensionUiRequest()` 提供标准化输入

### 扩展点
1. **新增交互类型**（如 `slider`、`datepicker`、`multi-select`）：
   - 在 parser 中加新 method 的解析 case
   - 在前端加对应的渲染组件

---

## 18. 代码块复制反馈 + 微交互动画

### 概述
代码块 copy 按钮多了成功状态动画和过渡效果，hover 时边框高亮。

### 文件

| 文件 | 变化 |
|------|------|
| `app/globals.css` | 新增 `.markdown-code-block` hover、`.markdown-code-action` transition、`.is-copied` 动画 |
| `components/MarkdownBody.tsx`| components 对象从 useMemo 抽取为 inline（上游新写法兼容） |

---

## 19. 辅助工具与基础设施

### 概述
部署/同步/诊断辅助脚本和配置文件。

### 文件清单

| 文件 | 行数 | 作用 |
|------|------|------|
| `sync.sh` | 56 | 双向同步 gitlab → GitHub（`git push origin main && git push gitlab main`），用于双仓库维护 |
| `build-and-push.sh` | 49 | 本地构建 Docker 镜像 → 推送到 Harbor 仓库（含版本号 tag + `latest`） |
| `scripts/postinstall-chmod-spawn-helper.js` | 20 | npm postinstall 钩子：自动 chmod `node-pty` 的 spawn-helper 二进制文件，修复 macOS 上的 posix_spawnp EACCES 错误 |
| `.env.local` | 3 | 环境变量示例：`MINIMAX_CN_API_KEY=sk-...`（被 `/api/token-plan/[provider]` 路由读取） |
| `.dockerignore` | 12 | Docker 构建排除规则（node_modules、.git、.next 等） |
| `instrumentation.ts` | +7 | Next.js instrumentation：注册 process.on('exit') cleanup，确保 node-pty 子进程在服务器退出时被正确清理 |
| `需求文档.md` | 144 | 中文需求说明文档（项目立项/功能规划） |

---


---

## 20. 信任域 (Trust Domains)

### 概述

pi-web 默认绑定在 loopback（`localhost` / `127.0.0.1`），但实际部署时常常需要通过反向代理（nginx / caddy / fnOS 反向代理）或者开发机 hostname（`macmini-177.local`）访问。这时请求会带着非 loopback 的 `Host` header，而浏览器又对跨源 API 请求做了 `Origin` / `Sec-Fetch-Site` 校验。

为了在不写应用层鉴权的情况下防止 DNS rebinding 和跨源攻击，`lib/request-security.ts` 提供了一组**信任域**判定：所有 API 请求必须满足以下任一 host 才能通过：

- loopback 名称（`localhost`、`*.localhost`）
- IP 字面量（IPv4 / IPv6，避免被 DNS rebinding）
- 显式配置的 host（环境变量 `PI_WEB_HOSTNAME`）
- 显式配置的 allowlist（环境变量 `PI_WEB_ALLOWED_HOSTS`，支持精确匹配 + 通配符）

### 支持的通配符语义

通配符以 `*.` 开头，匹配所有子域名以及根域：

| 配置 | 匹配 | 不匹配 |
|------|------|--------|
| `*.5ddd.com` | `5ddd.com`、`pi.5ddd.com`、`a.b.5ddd.com` | `5ddd.co`、`evil5ddd.com` |
| `*.appvmm.fnos.net` | `appvmm.fnos.net`、`pi.appvmm.fnos.net`、`vmm1.appvmm.fnos.net` | `fnos.net`、`appvmm.fnos.io` |

### 当前部署的信任域示例（参考 `.env.local`）

```bash
# 操作员显式选定的 bind hostname
PI_WEB_HOSTNAME=macmini-177.local

# 反向代理可能使用的外部域名（开发场景下 fnOS 的 mDNS）
PI_WEB_ALLOWED_HOSTS=*.appvmm.fnos.net
```

### 文件清单
| 文件 | 行数 | 作用 |
|------|------|------|
| `lib/request-security.ts` | 116 | `isApiRequestHostAllowed()` / `isApiRequestOriginAllowed()` / `isApiRequestAllowed()`；通配符匹配逻辑 |
| `proxy.ts` | — | Next.js 代理中间件，在路由层强制调用 `isApiRequestAllowed()` |

### 数据流

```
HTTP 请求进入 Next.js
  ↓ proxy.ts / 路由处理器
  ↓ isApiRequestAllowed(request)
  ↓
  ├─ isApiRequestHostAllowed() — Host header 校验
  │    ├─ localhost / *.localhost ✅
  │    ├─ IP 字面量 ✅
  │    └─ configuredHostnames:
  │         ├─ PI_WEB_HOSTNAME 精确匹配
  │         └─ PI_WEB_ALLOWED_HOSTS 精确匹配 + *.通配符
  │
  └─ isApiRequestOriginAllowed() — 跨源校验
       ├─ Sec-Fetch-Site: cross-site → 403
       └─ Origin 必须等于 request origin
  ↓
  ❌ 任一失败 → 403 "Untrusted API request"
  ✅ 通过 → 进入业务 handler
```

### 关键函数签名

```typescript
// lib/request-security.ts

/**
 * Host header 校验：判断请求的 Host 是否属于信任域
 * @param request — fetch Request 对象
 * @param configuredHostnames — 默认从 PI_WEB_HOSTNAME + PI_WEB_ALLOWED_HOSTS 解析
 * @returns 是否允许该 Host
 */
export function isApiRequestHostAllowed(
  request: Request,
  configuredHostnames?: string[]
): boolean;

/**
 * Origin 校验：拒绝浏览器跨源请求
 */
export function isApiRequestOriginAllowed(request: Request): boolean;

/**
 * 综合判定：Host + Origin 同时通过才放行
 */
export function isApiRequestAllowed(
  request: Request,
  configuredHostnames?: string[]
): boolean;

/**
 * Hostname 解析辅助：支持通配符 `*.example.com`
 * 返回归一化后的 hostname（小写、去除末尾 `.`、剥离 IPv6 方括号）
 */
function normalizeHostname(value: string): string;
```

### 扩展点

1. **新增通配符信任域**（如 `*.internal.example.com`）：
   - 在 `.env.local` 加 `PI_WEB_ALLOWED_HOSTS=*.internal.example.com`
   - 或同时在 `proxy.ts` 注入到 `configuredHostnamesFromEnvironment()`

2. **完全关闭 API 鉴权（开发模式）**：
   - 不要关闭 `isApiRequestHostAllowed` —— 仍然保留 loopback 保护
   - 如需暴露到 `0.0.0.0`，必须配 `PI_WEB_HOSTNAME` 或 `PI_WEB_ALLOWED_HOSTS`

3. **新增 Origin 校验策略**（如 token 鉴权）：
   - 在 `isApiRequestAllowed()` 里加一个 `hasValidBearerToken()` 短路
   - 不要替换现有的 host/origin 校验

### 变更历史

| Commit | 说明 |
|--------|------|
| `f6d0737` | fix(security): support wildcard hostnames in API request security (`*.5ddd.com`) |
| `4e3f1af` | fix(security): normalizeConfiguredHostname must handle wildcard before URL parsing |
| `f2ca92d` | chore: remove Host header validation (DNS rebinding protection), keep Origin check only |
| `a1063fc` | chore: remove Origin/Sec-Fetch-Site validation too |

---

## 21. PWA 支持

### 概述
将 pi-web 转化为可安装的 Progressive Web App（PWA），支持离线访问、桌面图标安装、后台缓存。

### 文件清单
| 文件 | 行数 | 作用 |
|------|------|------|
| `app/manifest.ts` | 32 | 浏览器 PWA manifest（name, icons, theme_color, display） |
| `components/PwaRegistration.tsx` | 33 | React 组件：监听 `beforeinstallprompt` → 触发安装 |
| `public/sw.js` | 76 | Service Worker：fetch cache-first → network fallback；offline.html 兜底 |
| `public/offline.html` | 83 | 离线时的静态 fallback 页面 |
| `public/icons/icon-192.png` | — | PWA 图标 192×192 |
| `public/icons/icon-512.png` | — | PWA 图标 512×512 |
| `public/icons/apple-touch-icon.png` | — | iOS Safari 专用图标 |
| `app/layout.tsx` | +37 | `next-pwa` 注册 script；`manifest` meta link |
| `next.config.ts` | +13 | `next-pwa` webpack plugin 配置 |

### 行为
1. 浏览器加载时注册 service worker（`/sw.js`）
2. 检测到 `beforeinstallprompt` 事件时 `PwaRegistration` 组件弹出安装按钮
3. 安装后：打开 `pi-web` 时显示为独立窗口（`display: standalone`）
4. 离线访问时返回 `offline.html`

### 扩展点
- 修改 `app/manifest.ts` 调整 name/description/icons（需同时更新 `public/icons/` 目录）

---

## 22. 模型价格预设 & 上游发现

### 概述
在模型管理界面提供价格预设表格，并支持从上游提供商（OpenAI、Anthropic 等）API 发现可用模型。

### 文件清单
| 文件 | 行数 | 作用 |
|------|------|------|
| `lib/model-catalog.ts` | 404 | 价格预设目录：`getPricingPresets()` 返回结构化价格数据 |
| `lib/model-discovery.ts` | 75 | 上游模型发现：调用 OpenAI/Anthropic 等 API 获取模型列表 |
| `lib/model-discovery-auth.ts` | 58 | 认证解析：从 provider 配置中提取 API key 并构建请求头 |
| `app/api/models-config/catalog/route.ts` | 78 | GET 返回价格预设（带缓存） |
| `app/api/models-config/discover/route.ts` | 88 | POST 触发上游模型发现（传入 providerName + provider config） |
| `components/ModelsConfig.tsx` | +381 | 模型配置 UI 扩展：价格表格 + 发现按钮 |
| `lib/model-catalog.test.mjs` | 223 | 价格预设单元测试 |
| `lib/model-discovery.test.mjs` | 50 | 模型发现单元测试 |

### 数据流（发现）
```
ModelsConfig UI
  ↓ POST /api/models-config/discover
  ↓  body: { providerName: "openai", provider: { apiKey, baseUrl, ... } }
  ↓ resolveModelDiscoveryAuth() → headers
  ↓ buildModelsListUrl()
  ↓ API 请求 → parseDiscoveredModels()
  ↓ 返回 { models: [...], errors: [...] }
```

### 扩展点
1. **新增上游提供商**：在 `model-discovery-auth.ts` 加新的 `resolveAuth` case
2. **新增价格预设**：在 `model-catalog.ts` 的 `getPricingPresets()` 返回对象中加 entry
3. **过滤模型选项**：`ChatInput.tsx` 已支持输入过滤显示（894babf）
## 23. 系统架构与数据流图

### 全局模块依赖

```mermaid
flowchart LR
    subgraph 客户端
        AppShell --> OC[OpenClawIntegration]
        OC --> NC[NotifyConfig]
        OC --> STC[ScheduledTasksConfig]
        OC --> MTP[MinimaxTokenPlanBar]
        OC --> useN[useNotify]
        AppShell --> SS[SessionSidebar]
        AppShell --> CW[ChatWindow]
        AppShell --> SP[ShortcutsPanel]
        SS --> fav[Favorites API]
        CW --> TV[TerminalView]
        CW --> CMF[ChatMinimapFab]
        CW --> useAS[useAgentSession]
        useAS --> EE[notify-emitter]
        useAS --> ARS[auto-resume-store]
        useAS --> Toast(Toast)
        MTP --> useMTP[useMinimaxTokenPlan]
        useMTP --> ARS
    end

    subgraph 服务端 API
        fav --> favRoute[/api/sessions/favorites]
        NC --> notifyRoute[/api/notify]
        notifyRoute --> dispatchRoute[/api/notify/dispatch]
        MTP --> tpRoute[/api/token-plan/:provider]
        STC --> stRoute[/api/scheduled-tasks]
        TV --> termRoute[/api/terminal]
        TV --> termEvents[/api/terminal/:id/events]
        termRoute --> TM[lib/terminal-manager]
        termEvents --> TM
        TP -- 60s cache --> upstream[MiniMax API]
        stRoute --> Sched[lib/scheduled-tasks-scheduler]
        Sched --> Runner[lib/scheduled-tasks-runner]
        Runner --> RPC[lib/rpc-manager]
        Runner --> ES[lib/email-sender]
        dispatchRoute --> ES
        ES --> SMTP
    end

    subgraph 存储
        favRoute --> favFile[~/.pi/agent/favorites.json]
        notifyRoute --> notifyFile[~/.pi/agent/notify.json]
        stRoute --> stFile[~/.pi/agent/scheduled-tasks.json]
    end

    subgraph 模型管理
        MC --> catalog[/api/models-config/catalog]
        MD --> discover[/api/models-config/discover]
    end

    subgraph PWA
        CW --> PWA[PwaRegistration]
        PWA --> SW[public/sw.js]
        SW --> offline[offline.html]
    end
```

### 新增依赖关系（f152945 之后）

| 新增组件 | 依赖 | 说明 |
|----------|------|------|
| `PwaRegistration` | `sw.js`, `offline.html` | 注册 service worker，监听安装事件 |
| `ModelsConfig` | `catalog/route.ts` | 显示价格预设 |
| `ModelsConfig` | `discover/route.ts` | 调用上游 API 发现模型 |
| `model-discovery-auth` | 上游 API | 构建认证 header（OpenAI/Anthropic/Google） |

| 功能 | 存储文件 | 位置 |
|------|----------|------|
| 收藏 | `favorites.json` | `~/.pi/agent/` |
| 通知配置 | `notify.json` | `~/.pi/agent/` |
| 定时任务 | `scheduled-tasks.json` | `~/.pi/agent/` |
| 自动恢复排期 | `localStorage` | `pi-auto-resume-v1` key |

---

## 附录：文件变更汇总

以下是从 upstream (agegr/pi-web) main 分支到本 fork 的所有变更文件，按模块分组：

### 新增文件（含 Docker / 基础设施）

| 路径 | 行数 | 所属模块 |
|------|------|----------|
| `Dockerfile` | 86 | Docker |
| `docker-compose.yml` | 34 | Docker |
| `docker-compose.build.yml` | 39 | Docker |
| `docker-entrypoint.sh` | 16 | Docker |
| `build-and-push.sh` | 49 | Docker |
| `sync.sh` | 56 | 工具 |
| `scripts/postinstall-chmod-spawn-helper.js` | 20 | 安装 |
| `instrumentation.ts` (modified) | +7 | Next.js 配置（process exit cleanup） |
| `.env.local` | 3 | 环境变量示例 |
| `sync.sh` | 56 | GitLab↔GitHub 同步脚本 |
| `需求文档.md` | 144 | 中文需求说明 |

### 新增 API 路由

| 路径 | 行数 | 功能 |
|------|------|------|
| `app/api/notify/route.ts` | 46 | 通知配置 CRUD |
| `app/api/notify/dispatch/route.ts` | 85 | 通知派发 |
| `app/api/notify/test/route.ts` | 21 | SMTP 测试 |
| `app/api/scheduled-tasks/route.ts` | 131 | 定时任务 CRUD |
| `app/api/scheduled-tasks/[id]/route.ts` | 79 | 任务单个操作 |
| `app/api/sessions/favorites/route.ts` | 41 | 收藏 CRUD |
| `app/api/terminal/route.ts` | 81 | 终端创建 |
| `app/api/terminal/[id]/route.ts` | 79 | 终端控制 |
| `app/api/terminal/[id]/events/route.ts` | 86 | 终端 SSE 流 |
| `app/api/terminal/command/route.ts` | 79 | 单次命令执行 |
| `app/api/token-plan/[provider]/route.ts` | 117 | 配额查询 |
| `app/api/diag/node-pty/route.ts` | 65 | PTY 诊断 |
| `app/api/models-config/catalog/route.ts` | 78 | 价格预设 |
| `app/api/models-config/discover/route.ts` | 88 | 上游模型发现 |

### 新增 lib 模块

| 路径 | 行数 | 功能 |
|------|------|------|
| `lib/terminal-manager.ts` | 519 | PTY 引擎 |
| `lib/terminal-command-runner.ts` | 133 | 命令执行器 |
| `lib/notify-config.ts` | 34 | 通知配置文件读写 |
| `lib/notify-types.ts` | 66 | 通知类型定义 |
| `lib/notify-emitter.ts` | 28 | 通知事件总线 |
| `lib/email-sender.ts` | 58 | 邮件发送封装 |
| `lib/scheduled-tasks-types.ts` | 66 | 定时任务类型 |
| `lib/scheduled-tasks-store.ts` | 73 | 定时任务存储 |
| `lib/scheduled-tasks-scheduler.ts` | 124 | 定时调度器 |
| `lib/scheduled-tasks-runner.ts` | 153 | 任务执行器 |
| `lib/cron.ts` | 176 | cron 解析器 |
| `lib/favorites-store.ts` | 116 | 收藏持久化 |
| `lib/auto-resume-store.ts` | 196 | 自动恢复排期 |
| `lib/quota-error.ts` | 18 | 配额错误检测 |
| `lib/time-format.ts` | 15 | 时间格式化 |
| `lib/extension-custom-ui-parser.ts` | 309 | 扩展 UI 解析（select/confirm/input/editor → UI 描述对象） |
| `lib/model-catalog.ts` | 404 | 价格预设目录 | |
| `lib/model-discovery.ts` | 75 | 上游模型发现 |
| `lib/model-discovery-auth.ts` | 58 | 认证解析 |

### 新增 UI 组件

| 路径 | 行数 | 功能 |
|------|------|------|
| `components/NotifyConfig.tsx` | 551 | 通知配置模态 |
| `components/ScheduledTasksConfig.tsx` | 1310 | 定时任务配置模态 |
| `components/MinimaxTokenPlanBar.tsx` | 304 | 配额条 |
| `components/TerminalView.tsx` | 329 | 终端 UI |
| `components/ShortcutsPanel.tsx` | 222 | 快捷键面板 |
| `components/ChatMinimapFab.tsx` | 224 | 消息快速跳转 |
| `components/Toast.tsx` | 285 | Toast 组件 |
| `components/openclaw-integration.tsx` | 119 | OpenClaw 集成边界 |
| `components/PwaRegistration.tsx` | 33 | PWA 注册组件 |

### 新增 hooks

| 路径 | 行数 | 功能 |
|------|------|------|
| `hooks/useNotify.ts` | 32 | 通知事件 dispatch |
| `hooks/useBreakpoint.ts` | 48 | 断点检测 |
| `hooks/useVisualViewport.ts` | 80 | 视觉视口 |
| `hooks/useKeyboardInset.ts` | 42 | 键盘高度 |
| `hooks/useSwipeDismiss.ts` | 108 | 滑动手势 |
| `hooks/useMinimaxTokenPlan.ts` | 94 | 配额轮询 |

### 修改的 upstream 文件

| 文件 | 变更说明 |
|------|----------|
| `next.config.ts` | 添加 `node-pty` 到 serverExternalPackages；添加 PIWEB/PI_TOOLS 版本 env |
| `app/globals.css` | 所有 CSS 变量颜色微调；代码块 shadow/hover/animation |
| `app/layout.tsx` | viewport 元数据（device-width, scale, viewportFit）；safe-area padding |
| `components/AppShell.tsx` | 集成 OpenClawIntegration/ShortcutsPanel/breakpoint/swipe/autoResume/model provider tracking |
| `components/SessionSidebar.tsx` | 收藏功能/ancestorCache/favorites tab/running panel/reset context |
| `components/ChatWindow.tsx` | 版本显示/model provider callback/reset context/ChatMinimapFab |
| `components/ChatInput.tsx` | keyboardHeight padding/相机按钮/自动恢复 countdown banner/sessionId prop |
| `components/MarkdownBody.tsx` | components 对象内联化 |
| `components/MessageView.tsx` | 移除 `getAssistantErrorMessage` 依赖（上游 0.8.2 API 变化） |
| `components/FileViewer.tsx` | 文件查看器小调整 |
| `hooks/useAgentSession.ts` | notify 事件发射/配额错误自动恢复/reset context/compact error auto-dismiss |
| `hooks/useIsMobile.ts` | 微调 |
| `lib/rpc-manager.ts` | 微调 |
| `components/openclaw-integration.tsx` | ✅ 已模块化：OpenClaw 唯一集成边界（toolbar portal + modals + TokenPlanBar） |

---

### 28.5 集成改进（2026-08-01）

| 变更 | 说明 |
|------|------|
| `openclaw-integration.tsx` | 创建独立组件：Notify/Tasks 按钮通过 `createPortal` 注入 AppShell toolbar slot，modals 和 TokenPlanBar 在内部渲染 |
| `AppShell.tsx` | 删除重复的 `<MinimaxTokenPlanBar>` 渲染和 import，改为 `<OpenClawIntegration providerId={currentProviderId} />` |
| `OPENCLAW-INTEGRATION.md` | §5 功能清单状态全部改为 ✅，§9 TODO 全部完成 |

---

## §24 接口契约 (API Contract)

> 本节定义所有自定义 API 路由的 request/response TypeScript 类型签名，以及 HTTP 状态码行为。
> 开发 agent 可以直接将这些类型定义作为 spec 实现。

### 24.1 通知系统 API

#### `GET /api/notify`

```typescript
// Response 200
interface GetNotifyResponse extends NotifyConfigWithoutPassword {
  // NotifyConfigWithoutPassword = Omit<NotifyConfig, "smtp"> & { smtp: Omit<NotifySmtpConfig, "pass"> }
}

// Response 200 — 配置被读取
interface NotifyConfigWithoutPassword {
  enabled: boolean;
  smtp: { host: string; port: number; secure: boolean; user: string };  // pass 被剥离
  from: string;
  to: string;
  subjectPrefix: string;
  events: Record<"agentEnd" | "error" | "inputNeeded", boolean>;
}
```

#### `PUT /api/notify`

```typescript
// Request body
interface PutNotifyRequest extends NotifyConfig {
  // 若 smtp.pass 为空字符串 ""，则保留服务器上的已有密码
}

// Response 200 — saved
interface PutNotifyResponse extends NotifyConfigWithoutPassword {}

// Response 400
{ error: string }  // 字段验证错误

// Response 500
{ error: string }  // 写入文件错误
```

#### `POST /api/notify/dispatch`

```typescript
// Request body
interface DispatchRequest {
  event: "agentEnd" | "error" | "inputNeeded";
  sessionId?: string | null;
  sessionName?: string | null;
  summary: string;          // 必填
  detail?: string;          // 可选详细内容
}

// Response 200 — dispatched
{ ok: true }
// Response 200 — skipped (通知被禁用)
{ ok: true, skipped: "disabled" | "event-disabled" }
// Response 400
{ error: string }  // event and summary are required
// Response 500
{ error: string }  // SMTP 发送失败
```

#### `POST /api/notify/test`

```typescript
// Request: 无 body，使用已保存的配置

// Response 200
{ ok: true }
// Response 400
{ error: string }  // SMTP 配置不完整
// Response 500
{ error: string }  // SMTP 连接失败
```

---

### 24.2 收藏系统 API

#### `GET /api/sessions/favorites`

```typescript
// Response 200
interface GetFavoritesResponse {
  favoriteSessionIds: string[];  // session id 数组
}
```

#### `POST /api/sessions/favorites`

```typescript
// Request body
interface PostFavoriteRequest {
  sessionId: string;             // 必填
  favorite?: boolean | null;     // 省略/undefined/null 则 toggle
}

// Response 200
interface PostFavoriteResponse {
  ok: true;
  sessionId: string;
  favorite: boolean;             // 操作后的状态
}

// Response 400
{ error: string }  // sessionId is required
```

---

### 24.3 定时任务系统 API

#### `GET /api/scheduled-tasks`

```typescript
// Response 200
interface GetTasksResponse {
  tasks: ScheduledTask[];
  serverTime: string;  // ISO 8601
}
```

#### `POST /api/scheduled-tasks` — 创建

```typescript
// Request body
interface CreateTaskRequest {
  name?: string;
  prompt?: string;
  cwd?: string;
  model?: { provider: string; modelId: string } | null;
  schedule?: TaskSchedule;
  enabled?: boolean;
  email?: { enabled: boolean; to?: string };
}

// Response 200
interface CreateTaskResponse {
  task: ScheduledTask;  // 含自动计算的 id / nextRunAt / createdAt
}

// Response 400
{ error: string }  // 字段验证错误
```

#### `PUT /api/scheduled-tasks` — 更新

```typescript
// Request body = CreateTaskRequest + { id: string }
// 注意：正在执行的任务返回 409

// Response 200
{ task: ScheduledTask }
// Response 404
{ error: "任务不存在" }
// Response 409
{ error: "任务正在执行中，请等待完成后再修改" }
```

#### `DELETE /api/scheduled-tasks/[id]`

```typescript
// Response 200
{ success: true }
// Response 404
{ error: "任务不存在" }
// Response 409
{ error: "任务正在执行中，请等待完成后再删除" }
```

#### `POST /api/scheduled-tasks/[id]` — 手动立即执行

```typescript
// Response 200
{
  result: RunTaskResult;  // { status: "success"|"error", text: string, durationMs: number, errorMessage?: string }
  task: ScheduledTask;    // 更新后的任务
}
// Response 404
{ error: "任务不存在" }
// Response 409
{ error: "任务正在执行中" }
```

---

### 24.4 终端系统 API

#### `POST /api/terminal` — 创建终端

```typescript
// Request body
interface CreateTerminalRequest {
  cwd: string;       // 必填。不存在时自动 fallback 到 /workspace / $HOME
  cols?: number;     // 默认 120
  rows?: number;     // 默认 30
}

// Response 200
interface CreateTerminalResponse {
  id: string;        // PTY session UUID
  cwd: string;       // 实际使用的 cwd
  shell: string;     // SHELL 路径
}

// Response 403
{ error: "cwd is not in an allowed root" }
// Response 500
{ error: string }    // node-pty spawn 失败详情
```

#### `GET /api/terminal/[id]` — 检查状态

```typescript
// Response 200 (alive)
{ alive: true, exited: false, cwd: string, exitCode: null }
// Response 200 (exited)
{ alive: false, exited: true, cwd: string, exitCode: number | null }
// Response 404 (不存在)
{ alive: false, exited: true }
```

#### `POST /api/terminal/[id]` — 控制

```typescript
// Request body — action: "input"
{ action: "input", data: string }  // 写入 PTY 输入流
// Response: { ok: boolean }

// Request body — action: "resize"
{ action: "resize", cols: number, rows: number }
// Response: { ok: boolean }

// Request body — action: "continue"
{ action: "continue" }  // 重新 spawn shell（保持 id 不变）
// Response: { ok: boolean }

// Request body — action: "kill"
{ action: "kill" }  // 立即 SIGKILL
// Response: { ok: boolean }

// Response 404
{ error: "Terminal not found" }
// Response 400
{ error: "Unknown action" }
```

#### `GET /api/terminal/[id]/events` — SSE 流

```typescript
// event: data (JSON-encoded)

// 1. 初始连接
{ type: "connected", id: string }

// 2. 历史回放（scrollback chunks，每次连接都重放）
{ type: "data", data: string, replay: true }
// 3. 历史回放结束标记
{ type: "replay_end" }

// 4. 实时输出
{ type: "data", data: string }  // replay: undefined

// 5. 进程退出
{ type: "exit", exitCode: number | null }

// 心跳: 30s 间隔发送注释行（EventSource 不关闭）
// data: 空行
```

#### `POST /api/terminal/command` — 单次命令

```typescript
// Request body
interface RunCommandRequest {
  cwd?: string;            // 默认 process.cwd()
  command: string;         // 必填，shell 命令字符串
  timeout?: number;        // 默认 60000ms，范围 [5000, 300000]
  sync?: boolean;          // 默认 true。true=同步等待结果；false=立即返回 id
}

// Response 200 — sync=true
interface RunCommandSyncResponse {
  id: string;
  cwd: string;
  command: string;
  stdout: string;
  stderr: string;           // node-pty 合并流，通常为空
  exitCode: number;
}

// Response 200 — sync=false
{ id: string, cwd: string, command: string }

// Response 403
{ error: "cwd is not in an allowed root" }
```

---

### 24.5 配额追踪 API

#### `GET /api/token-plan/[provider]`

```typescript
// 支持的 provider: "minimax-cn"

// Response 200
interface TokenPlanResponse {
  categories: TokenPlanCategory[];
  fetchedAt: number;      // Unix ms
}

interface TokenPlanCategory {
  name: string;             // e.g. "general", "video"
  intervalPercent: number;  // 当前间隔剩余百分比
  intervalResetsIn: string; // e.g. "2h 30m"
  intervalUsedPercent: number;
  intervalTotalPercent: number;  // 通常 100
  weeklyPercent: number;
  weeklyResetsIn: string;
  weeklyUsedPercent: number;
  weeklyTotalPercent: number;    // 100 + boost
  available: boolean;            // interval_status === 1 || weekly_status === 1
}

// Response headers
{ "x-cache": "hit" | "miss" }  // 60s 缓存
```

---

### 24.6 诊断 API

#### `GET /api/diag/node-pty`

```typescript
// Response 200
interface DiagResponse {
  ok: boolean;
  exitCode?: number;       // "echo ok" 命令退出码
  error?: string | null;   // spawn 失败详情
  ptyVersion: string;      // node-pty 版本
  shell: string;           // process.env.SHELL
  platform: string;
  arch: string;
  nodeVersion: string;
}

// Response 500 (node-pty 未安装)
{ ok: false, error: "node-pty not installed" }
```

---

## §25 CSS 类名与 Keyframes 清单

> 以下列出所有在 `app/globals.css` 中新增的 CSS class 和 keyframes。
> 注：CSS 变量颜色变化已在 §11 列出，此处不重复。

### 25.1 新增 Keyframes

| Keyframe 名 | 触发 | 用途 |
|-------------|------|------|
| `code-copy-pulse` | `.is-copied` | 复制成功缩放松动效 |
| `skeleton-shimmer` | `.skeleton-line` | 加载占位闪光动画 |
| `quick-start-in` | `.quick-start-card` | 空状态入场淡入+上移 |
| `scroll-fab-in` | `.scroll-fab-enter` | 滚动到底部 FAB 出现 |
| `scroll-fab-out` | `.scroll-fab-exit` | 滚动到底部 FAB 消失 |
| `toast-in` | `toast-host-anim` | Toast 从右侧滑入 |
| `toast-out` | `toast-host-anim` (reverse) | Toast 滑出 |
| `shortcuts-panel-in` | `.shortcuts-panel-backdrop` | 快捷键面板遮罩淡入 |
| `spin` | `.spin-loop` | 加载中图标旋转 |

### 25.2 新增 CSS Class

| Class | 元素 | 用途 |
|-------|------|------|
| `.markdown-code-block` | `<div>` (代码块) | hover 时边框高亮 + box-shadow 层级 |
| `.markdown-code-action.is-copied` | 代码块复制按钮 | 复制成功绿色动效 |
| `.skeleton-line` | `<div>` | 加载占位（闪光动画） |
| `.quick-start-card` | `<button>` (空状态卡片) | 入场 stagger 动画 |
| `.scroll-fab-enter` | `<button>` (滚动 FAB) | 出现动画 |
| `.scroll-fab-exit` | `<button>` (滚动 FAB) | 消失动画 |
| `.tool-call-body` | `<div>` (tool call 折叠体) | grid-template-rows 折叠展开 |
| `.tool-call-body.is-expanded` | `<div>` | 展开状态 |
| `.tool-call-body-inner` | `<div>` (折叠体内) | min-height:0 防溢出 |
| `.pi-tooltip` | `<div>` (图标容器) | hover 显示 data-tooltip 属性文本 |
| `.pi-tooltip::after` | ::after 伪元素 | tooltip 浮层 |
| `.spin-loop` | `<svg>` | 旋转动画 |
| `.toast-host-anim` | Toast 容器 | 入场/出场动画 |
| `.terminal-crt` | 终端容器 | 扫描线背景 |
| `.terminal-crt .xterm-screen canvas` | canvas | CRT 绿色发光滤镜 |
| `.terminal-crt .xterm-cursor-layer .xterm-cursor` | 光标 | 琥珀色发光 |

### 25.3 新增/修改的 Media Queries

| 断点 | 影响 | 变更 |
|------|------|------|
| `min-width: 1024px` 原 `641px` | `.sidebar-overlay-backdrop` 隐藏 | 桌面端宽度阈值提高 |
| `min-width: 1024px` 原 `641px` | `.right-panel-container` 过渡动画 | 同上 |
| `max-width: 1023px` 原 `640px` | 移动端侧边栏覆盖层 | 覆盖层范围扩大到 tablet |
| `768px–1023px` **新增** | `.sidebar-container` width: 320px | tablet 专属侧边栏宽度 |

---

## §26 全局变量 (globalThis 注册表)

> 本 fork 多处使用 `globalThis` 注册表模式，使得数据缓存和实例在 Next.js hot-reload 时存活。

### 26.1 终端注册表

```typescript
declare global {
  var __piTerminals: Map<string, TerminalEntry> | undefined;
  var __piTerminalCleanupInstalled: boolean | undefined;
}
```

| 字段 | 类型 | 文件 | 用途 |
|------|------|------|------|
| `__piTerminals` | `Map<string, TerminalEntry>` | `lib/terminal-manager.ts` | 所有活跃终端 session |
| `__piTerminalCleanupInstalled` | `boolean` | `lib/terminal-manager.ts` | 确保 process.on('exit') cleanup 只注册一次 |

### 26.2 命令运行注册表

```typescript
declare global {
  var __piCommandRuns: Map<string, CommandEntry> | undefined;
}
```

| 字段 | 类型 | 文件 | 用途 |
|------|------|------|------|
| `__piCommandRuns` | `Map<string, CommandEntry>` | `lib/terminal-command-runner.ts` | 单次命令运行（5 分钟自动 evict） |

### 26.3 收藏缓存

```typescript
declare global {
  var __piFavoritesCache: { ids: Set<string>; loadedAt: number } | undefined;
  var __piFavoritesPromise: Promise<Set<string>> | undefined;
  var __piFavoritesGeneration: number | undefined;
}
```

| 字段 | 类型 | 文件 | 用途 |
|------|------|------|------|
| `__piFavoritesCache` | cache | `lib/favorites-store.ts` | 30s TTL 缓存 |
| `__piFavoritesPromise` | Promise | `lib/favorites-store.ts` | 防并发读取 |
| `__piFavoritesGeneration` | number | `lib/favorites-store.ts` | 缓存失效标记 |

### 26.4 定时任务调度器

```typescript
interface SchedulerGlobal {
  started: boolean;
  timer: NodeJS.Timeout | null;
  ticking: boolean;
}
const TICK_KEY = "__pi_web_scheduled_tasks_scheduler__";
```

| 字段 | 类型 | 文件 | 用途 |
|------|------|------|------|
| `globalThis["__pi_web_scheduled_tasks_scheduler__"]` | `SchedulerGlobal` | `lib/scheduled-tasks-scheduler.ts` | 全局调度器单例 |

---

## §27 测试策略

> 本节定义新增功能的最低测试要求，用于 CI 验收和开发 agent 自检。

### 27.1 单元测试要求

| 模块 | 测试内容 | 框架建议 |
|------|----------|----------|
| `lib/cron.ts` | `parseCron` 各种合法 cron（全星、具体值、步长、范围、月份名）；非法 cron（字段不足、值越界）；`nextCronRun` 边界值（月末跨月、跨年） | Vitest |
| `lib/favorites-store.ts` | `loadFavorites` 空文件 / 损坏 JSON / 正常；`setFavorite` 添加/移除/toggle；`dropFavoritesFor` 批量 | Vitest |
| `lib/notify-types.ts` | `validateNotifyConfig` 各种缺字段；`mergeWithDefaults` 合并；`stripPassword` | Vitest |
| `lib/email-sender.ts` | `sendNotifyEmail` 配置为空时不发；`clearEmailTransporterCache` 清空 transport map | Vitest |
| `lib/auto-resume-store.ts` | `schedule` / `cancel` / `fireOnReset` / 过期自动过滤；`list` 不过期 | Vitest |
| `lib/quota-error.ts` | `isQuotaError` 各种 quota/billing 模式匹配；不匹配时返回 false | Vitest |
| `lib/time-format.ts` | `formatRemainingSeconds` 秒/分钟/小时/天/0 值 | Vitest |
| `lib/terminal-manager.ts` | `resolveCwd` 存在/不存在/Windows路径/容器路径；`appendScrollback` 边界（超大 chunk、多 chunk trim） | Vitest（mock node-pty） |
| `lib/scheduled-tasks-store.ts` | `computeNextRun` interval/daily/cron 的 next 计算 | Vitest |

### 27.2 API 端到端测试

| API | 测试场景 |
|-----|----------|
| `GET /api/diag/node-pty` | 返回 200 + ok=true + 各字段存在；node-pty 不存在时 500 |
| `POST /api/terminal` | 正常创建返回 id/cwd/shell；无效 cwd 返回 403 |
| `POST /api/terminal/command` | 同步执行 `echo hello` 返回 stdout="hello" exitCode=0；超时 |
| `POST /api/notify` (PUT) | 保存配置/密码不回写/清空密码保留旧密码 |
| `POST /api/sessions/favorites` | toggle/显式设置/重复 toggle |
| `GET /api/token-plan/minimax-cn` | API key 存在时返回 categories；不存在时 503 |
| `POST /api/scheduled-tasks` (POST/PUT) | 创建/更新/验证错误返回 400 |

### 27.3 组件交互测试

| 组件 | 测试场景 | 方法 |
|------|----------|------|
| `ShortcutsPanel` | `?` 键打开/ESC 关闭/点击蒙层关闭 | Playwright + keyboard.press |
| `Toast` | 四种类型渲染/自动消失/action 按钮点击 | Playwright |
| `NotifyConfig` | 表单填写/密码 reveal/保存/测试连接 | Playwright mock API |
| `TerminalView` | SSE 连接/输入转发/resize/退出后 Enter 重启 | Playwright + mock EventSource |
| `MinimaxTokenPlanBar` | 配额展示/compact 模式/负载数据注入 | Playwright mock API |
| `ChatMinimapFab` | 打开/跳转/关闭 | Playwright |

### 27.4 升级/merge 回归检查

每次从 upstream merge 后执行：

```bash
# 1. 检查 AppShell 集成点
grep -n "openclaw\|OpenClaw" components/AppShell.tsx
# 期望: 只有 1 行 import + 1 行 JSX 引用

# 2. 检查核心文件存在
ls -la components/openclaw-integration.tsx
ls -la lib/terminal-manager.ts
ls -la lib/cron.ts

# 3. 类型检查 + 构建
node_modules/.bin/tsc --noEmit

# 4. 手动测试：新 session 页面显示三个版本号
# 5. 手动测试：侧边栏有 Sessions/Favorites 两个 tab
# 6. 手动测试：? 键打开快捷键面板
```

---

## §28 环境变量清单

| 变量 | 用途 | 必填 | 读取位置 |
|------|------|------|----------|
| `NEXT_PUBLIC_APP_VERSION` | PWA 注册 + 侧边栏点击显示的版本 | 否（构建时自动） | `next.config.ts` |
| `NEXT_PUBLIC_PIWEB_VERSION` | 上游版本号 | 否（构建时自动） | `next.config.ts` |
| `NEXT_PUBLIC_PI_TOOLS_VERSION` | 本 fork 版本号 | 否（构建时自动） | `next.config.ts` |
| `NEXT_PUBLIC_PI_VERSION` | pi SDK 版本号 | 否（构建时自动） | `next.config.ts` |
| `MINIMAX_CN_API_KEY` | MiniMax 配额 API 认证 | 否 | `app/api/token-plan/[provider]/route.ts` |
| `WORKSPACE_DIR` | Docker 容器内的默认工作目录 | 否 | `lib/terminal-manager.ts` `resolveCwd()` |
| `PI_CODING_AGENT_DIR` | pi agent 数据目录覆盖 | 否 | `lib/terminal-manager.ts` `resolveCwd()` |
| `GIT_REPO_URL` | Docker 入口脚本自动 clone 的仓库 | 否 | `docker-entrypoint.sh` |
| `PI_WEB_HOSTNAME` | 显式允许的 bind hostname（精确匹配） | 否 | `lib/request-security.ts` |
| `PI_WEB_ALLOWED_HOSTS` | 额外允许的 hostname（逗号分隔，支持 `*.domain` 通配符） | 否 | `lib/request-security.ts` |

---

## 29. 更新日志 (f152945 之后)

> 本文档最初编写时的基准 commit 是 `f152945`（gitlab-on-upstream-main merge）。
> 以下记录之后的所有变更，帮助保持文档与代码同步。

### 28.1 Upstream v0.8.3 → v0.8.4 合并（2026-08-01）

#### Upstream v0.8.3 主要变更（部分）
| Commit | 说明 | 影响 |
|--------|------|------|
| `556e2ec` | fix: surface provider and compaction errors | `useAgentSession.ts` error handling |
| `dbd583b` | feat: improve chat minimap navigation | `ChatMinimap.tsx` 重写，新增 `ChatMinimap.module.css` |

#### Upstream v0.8.4 主要变更
| Commit | 说明 | 影响 |
|--------|------|------|
| `c1f0f04` | feat: pricing presets + upstream model discovery | 新增 11 文件（model-catalog.ts, model-discovery.ts, 2 个 API route） |
| `894babf` | feat: filter model selector options | `ChatInput.tsx` + 模型过滤 UI |
| `6885309` | feat: add PWA support | PWA 相关文件（manifest.ts, PwaRegistration.tsx, sw.js） |
| `d362764` | fix: allow PWA session export navigation | `next.config.ts` 调整 |
| `d35c61f` | fix: preserve extension-injected message streaming | `useAgentSession.ts` |

#### 本地变更（f152945 之后）
| Commit | 说明 | 影响 |
|--------|------|------|
| `a94ac6b` | clean remaining conflict markers | 清理上游 merge 残留冲突标记 |
| `8262de5` | remove stray conflict closing marker | ChatWindow 残留冲突标记清理 |
| `59995c9` | add missing getAssistantErrorMessage | 补回上游 v0.8.3 API |
| `22cf9f0` | fix(ui): ModelsConfig responsive on mobile | 模型配置响应式修复 |
| `c4004d6` | fix(ui): sidebar toolbar icon button widths | 工具栏图标等宽 |

### 28.2 SessionSidebar 变化
| 变化 | 说明 |
|------|------|
| **删除** `favoritesPanelOpen` state | 收藏面板不再可折叠（Favorites 选项卡内） |
| **删除** 折叠的 Favorites 面板 | 改为 flat tab（与 Sessions 平级） |
| **新增** `sidebarTab` state | `"sessions" | "favorites"` 切换 |
| **保留** favorite toggle + 删除确认 | 核心功能不变 |
| **删除** Sessions 选项卡内联收藏折叠列表 | 收藏仅在 "Favorites" 选项卡中展示，避免重复入口与状态歧义（§5 UI 布局约定） |
| **删除** `favoriteSessions.length > 0 &&` 的内联渲染分支 | Sessions 选项卡不再需要这个条件 |

### 28.3 AppShell 变化
| 变化 | 说明 |
|------|------|
| **新增** `ShortcutsPanel` 集成 | `useState` + `setShortcutsPanelOpener` |
| **修改** 底部 toolbar 布局 | `flex` → `grid` with `subgrid span 2` |
| **保留** `<OpenClawIntegration />` | 集成点不变 |

### 28.4 安全变更
| Commit | 说明 |
|--------|------|
| `f6d0737` | fix(security): support wildcard hostnames in API request security | 请求安全检查支持 `*.domain` 格式 |
| `4e3f1af` | fix(security): normalizeConfiguredHostname must handle wildcard before URL parsing | 修复 wildcard 解析顺序 |
| `f2ca92d` | chore: remove Host header validation | DNS 重绑定保护简化为只检查 Origin |
| `a1063fc` | chore: remove Origin/Sec-Fetch-Site validation too | 移除部分安全 header 检查 |

---

## 文档版本信息

| 版本 | 基准 commit | 内容覆盖范围 | 行数 |
|------|-------------|-------------|------|
| v1.0 (初版) | `f152945` | 基础自定义功能清单 | ~800 |
| v1.1 (完整) | `f152945` | 接口契约 + CSS 清单 + 测试策略 + 全局变量 | 1362 |
| v1.2 (更新) | HEAD (`59995c9`) | +PWA + 模型发现 + 上游 v0.8.3/0.8.4 合并变更 | ~1430 |

> **最后更新**: 2026-08-01 | 覆盖到 HEAD (`59995c9`) | 总行数: 待统计
