# Pi Agent Web — UI Improvement Suggestions

> 检查日期: 2025-07-17
> 验收日期: 2025-07-17

---

## 高优先级

### 1. 空状态引导优化 ✅
- **实现**: `EmptyQuickStart` 组件 — 5 个快速入门卡片（Explore codebase / Find a bug / Plan a change / Explain a file / Review changes），点击填入输入框
- **额外**: 底部 `ShortcutHint` 展示核心快捷键 `/ @ Esc ⇧Enter`
- **评价**: 实现质量高，卡片有 staggered animation + hover 微动效，移动端列自适应
- **状态**: ✅ 已验收

### 2. 移动端输入体验 ⚠️
- **实现**: `ChatWindow` 引入了 `useVisualViewport` 获取 `keyboardHeight`，空状态 hero 加注释说明键盘抖动问题。拖拽 SVG 从固定尺寸改为 `min(78vmin, ...)` 自适应。
- **问题**: `ChatInput` 仍然使用 `translateY(-keyboardHeight)` 方案，键盘弹起时输入框依然可能抖动。移动端没有做 `position: sticky` 重构。
- **评价**: 部分改进，核心的 `translateY` 抖动未根本解决
- **状态**: ⚠️ 不满意 — `translateY` 方案未替换

### 3. 侧边栏 Session 列表性能 ✅
- **实现**: 
  - `resolveAncestor` 加了 `ancestorCache`（Map 缓存父链查找结果），从 O(n²) 降到近 O(n)
  - `buildSessionTree` 用 `useMemo` 包裹避免无关渲染时重建
  - 添加了 `sessions` / `favorites` 两个 tab 面板分流
- **评价**: 算法优化到位，虽然没有虚拟滚动，但 O(n²)→O(n) 的改进对于 100+ sessions 场景足够
- **状态**: ✅ 已验收

---

## 中优先级

### 4. 深色模式色彩微调 ✅
- **实现**:
  - `--text`: `#e8e8e8` → `#ededed`
  - `--text-muted`: `#9ca3af` → `#a8b0bd`
  - `--text-dim`: `#6b7280` → `#8b93a1`
  - `--accent`: `#60a5fa` → `#7eb6ff`
  - `--accent-hover`: `#93c5fd` → `#a3c8ff`
  - `--bg-panel`: `#242424` → `#232323`
  - `--bg-hover`: `#2e2e2e` → `#2c2c2c`
  - `--tool-bg`: `#1f2937` → `#202836`
  - `--bg-subtle`: `rgba(255,255,255,0.04)` → `rgba(255,255,255,0.05)`
  - 亮色模式 `--text-dim` 也调为 `#8a93a0`
- **评价**: 全面微调，对比度明显改善
- **状态**: ✅ 已验收

### 5. 代码块 Copy 按钮反馈 ✅
- **实现**:
  - copy 成功后按钮文字变为 checkmark + "copied"，带 `is-copied` 样式
  - 绿色脉冲动画 `code-copy-pulse`（scale + box-shadow 扩散）
  - 未复制状态也加了 copy icon
  - `aria-live="polite"` + `aria-label` 支持无障碍
- **评价**: 视觉反馈到位，动画克制不花哨
- **状态**: ✅ 已验收

### 6. ChatInput 工具栏按钮分组 ⚠️
- **实现**: Thinking level 和 Tool preset 下拉项改为双行布局（标题 + 描述），`align-items: flex-start`，描述 `white-space: normal`
- **问题**: 
  - 移动端没有 "…" more menu 收容低频按钮
  - Compact/Abort 按钮仍无明显色彩变化（仅文字从 "Compress" 变 "Abort"）
- **评价**: Desktop 端改善明显，移动端溢出问题未解决
- **状态**: ⚠️ 不满意 — 移动端按钮溢出和 compact abort 视觉强度不足

### 7. 消息列表滚动锚定 ✅
- **实现**: 底部浮动按钮 "↓" ，当用户向上滚动超过 80px 时出现，点击滚回底部。有 `scroll-fab-enter` / `scroll-fab-exit` 动画。流式输出时自动隐藏。使用 `requestAnimationFrame` throttle。
- **评价**: 标准实现，覆盖了核心场景
- **状态**: ✅ 已验收

### 8. Tool Call 展开动画 ✅
- **实现**: 
  - `grid-template-rows: 0fr` ↔ `1fr` + `opacity` transition
  - 新增 `.tool-call-body` / `.tool-call-body-inner` CSS 类
  - `transition: grid-template-rows 0.22s cubic-bezier(0.32, 0.72, 0.18, 1), opacity 0.18s ease`
  - `aria-hidden` 控制
- **评价**: 使用 grid-rows 技巧而非 max-height hack，动画流畅自然
- **状态**: ✅ 已验收

---

## 低优先级 / 微调

### 9. Sidebar 底部工具栏 Tooltip ✅
- **实现**: `.pi-tooltip` CSS 类 — `::after` 伪元素 + `data-tooltip` 属性，0.18s ease 过渡 + 0.05s 延迟，带 `box-shadow`。已应用到 Upload、Refresh 按钮和 Theme toggle。
- **评价**: 纯 CSS 实现，简洁高效
- **状态**: ✅ 已验收

### 10. Session 重命名入口 ✅
- **实现**: 原有功能（hover 显示铅笔图标 inline rename + `/name` 命令）
- **评价**: 功能已有，无需额外改动
- **状态**: ✅ 已有

### 11. 拖拽上传视觉增强 ✅
- **实现**:
  - 波纹圆从固定 `720px` → `min(78vmin, 720px)` 响应式缩放
  - SVG 图标从固定 `280px` → `220px` + `max(60vmin)` 自适应
  - 新增 "Release to add image" 文字 badge（蓝底圆角 pill）
- **评价**: 响应式改进 + 文字引导，体验完整
- **状态**: ✅ 已验收

### 12. 空会话 "Send a message to begin" 占位 ✅
- **实现**: 同 #1 的 `EmptyQuickStart` 卡片，覆盖了快速入门引导需求
- **评价**: 5 个场景卡片覆盖常见需求
- **状态**: ✅ 已验收

### 13. Fork 确认/撤销 ❌
- **实现**: 无
- **评价**: 未处理，Fork 仍然一键执行无撤销
- **状态**: ❌ 未实现

### 14. 快捷键面板 ✅
- **实现**: `ShortcutHint` 组件在空状态页展示 `/ @ Esc ⇧Enter` 核心快捷键，使用 `<kbd>` 样式
- **评价**: 虽然只列了 4 个，但覆盖了最高频操作。缺少 `Ctrl+/` 弹出全量面板
- **状态**: ⚠️ 基本满意 — 核心快捷键已展示，全量面板可作为后续增强

### 15. 主题切换按钮位置 ✅
- **实现**: 
  - 从 `AppShell` 顶部栏移除 sun/moon toggle
  - 移到 `SessionSidebar` 底部工具栏，右侧对齐
  - 带 `.pi-tooltip` tooltip
- **评价**: 顶部栏清爽了很多
- **状态**: ✅ 已验收

### 16. Loading 状态骨架屏 ✅
- **实现**: 
  - `skeleton-shimmer` CSS 动画（`linear-gradient` + `background-position` 移动）
  - 加载时显示 8 条不同宽度的骨架线模拟消息列表
  - 替换了原来的 "Loading session..." 纯文字
- **评价**: 骨架屏简洁优雅，shimmer 动画流畅
- **状态**: ✅ 已验收

### 17. 深色模式下的代码高亮主题 ✅
- **实现**: 代码块在深色模式下加 `box-shadow: 0 1px 0 rgba(0,0,0,0.4), 0 0 0 0.5px rgba(255,255,255,0.04)` + hover 边框变化。亮色模式也加了一层 `0.5px` 内阴影增加层次。
- **评价**: 不换主题的情况下，box-shadow 方案让代码块边界更清晰，是合理的权衡
- **状态**: ✅ 已验收

### 18. Minimap 滚动同步精度 ❌
- **实现**: 无
- **评价**: 未处理，流式输出时 minimap 指示器抖动问题仍存在
- **状态**: ❌ 未实现

### 19. 通知 Shelf 自动消失 ❌
- **实现**: 无
- **评价**: 未处理，非错误通知仍然常驻不消失
- **状态**: ❌ 未实现

### 20. Diff 视图行号对齐 ❌
- **实现**: 无
- **评价**: 未处理，左右两栏仍独立滚动
- **状态**: ❌ 未实现

---

## 验收汇总

| 状态 | 数量 | 条目 |
|------|------|------|
| ✅ 已验收 | 13 | #1, #3, #4, #5, #7, #8, #9, #10, #11, #12, #15, #16, #17 |
| ⚠️ 不满意 | 3 | #2 (移动端 translateY), #6 (移动端按钮溢出), #14 (缺全量快捷键面板) |
| ❌ 未实现 | 4 | #13 (Fork 确认), #18 (Minimap 同步), #19 (通知自动消失), #20 (Diff 同步滚动) |

### 不满意详情

#### #2 移动端输入体验
- **现状**: `ChatInput` 仍用 `translateY(-keyboardHeight)` 抬起输入框
- **问题**: iOS Safari 上 `visualViewport` 变化时 transition lag 导致输入框上下跳动
- **建议**: 改为 `position: sticky; bottom: max(0px, env(safe-area-inset-bottom))` 方案，让浏览器原生处理键盘避让

#### #6 ChatInput 工具栏按钮分组
- **现状**: 移动端所有按钮平铺，wave 处未做 "…" more menu
- **问题**: 窄屏（< 400px）按钮换行/溢出，Compact 按钮 abort 状态仅文字变化不够醒目
- **建议**: 
  - 移动端将 Sound、Compact 收入 "…" 弹出菜单
  - Abort 状态按钮加红色 pulsating border 或用红色背景

#### #14 快捷键面板
- **现状**: 只在空状态展示了 4 个快捷键
- **缺失**: 缺少 `Ctrl+/` 或 `?` 触发的全量快捷键面板（含 Ctrl+Alt+N 等高级快捷键）
- **建议**: 添加可弹出的快捷键 reference 面板
