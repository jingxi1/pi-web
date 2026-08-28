# TODO: Remaining Upstream Sync Work

Status as of v0.8.6 → v0.8.8-beta.1 sync (see `26bcf98` and `40914a4`).

The cherry-pick-driven merge completed 18 commits and reached a clean
`tsc --noEmit` baseline. The following upstream commits were **deferred**
because they touch `hooks/useAgentSession.ts` and the upstream rewrite of
that file (`1904` lines) is incompatible with pi-tools' notify/quota/
auto-resume customizations without a dedicated port.

## Skipped (Tier 3 — require hand-port)

These are upstream's structural rewrites of `hooks/useAgentSession.ts`.
They introduce new state machines (`streamReducer`,
`AgentEventConnection`, `INITIAL_STREAMING_STATE`,
`notifyPromptStage`) and are best merged in a future dedicated pass.

| Upstream commit | Subject |
| --------------- | ------- |
| `6ac87ec` | fix: preserve rejected prompt submissions |
| `d251bb3` | fix: prevent prompt anchor update loops |
| `e4fded0` | fix: make agent SSE connection resilient |
| `3095198` | fix: stabilize streaming scroll follow |
| `5d6342a` | fix: skip syntax highlighting during streaming |
| `9ebe18a` | fix: oversized message guard |
| `81767f4` | fix: make model switching responsive |
| `05db5b2` | Implement Pi 0.84 streaming deltas and cross-tab SSE reconnect |
| `dc460d1` | chore: sync Bun lockfile with Pi 0.84 |
| `5158faf` | test: cover model and session recovery flows |
| `243016e` | fix: allow image attachment during stream |

## Partially applied

These commits were cherry-picked at a more conservative scope so the
hooks file did not lose its full handler set:

- `3a37c04` (随屏滚动): added the constant; deferred the in-handler
  follow-scroll branch (no `promptAnchorActive` state).
- `d60c547` / `eb4a965` (read-only preset): added `getPreferredToolPreset`
  hydration; full UI selector wired in upstream.
- `360667c` / `bfa59a3` (estimated active time): added `totalActiveMs`
  plumbing to `SessionData` + `sessionStats` memo; UI rendering
  components in `SessionInfoPanel` not yet ported.

## Strategy notes

When reattempting these commits, do **not** use `git cherry-pick` against
the upstream SHA verbatim — it leaves the file in a corrupted state.
Recommended:

1. Open the upstream commit's diff (`git show <sha>`).
2. Apply only the additions explicitly into the current
   `hooks/useAgentSession.ts` — never replace the entire file.
3. If upstream removed an identifier we still depend on (e.g.
   `lastPromptRef`, `emitNotifyEvent`), re-add it after the upstream
   diff is applied.
4. Always run `node node_modules/typescript/bin/tsc --noEmit
   --incremental false` after each commit before continuing.

## Auto-trust all projects (2026-08-14)

日常用每个新项目都点"信任"很烦。开启 auto-trust 模式后，所有项目在首次访问时即被视为 trusted，对话框和顶部 banner 都不显示。

**改动**：`lib/project-trust.ts` — 新增 `isAutoTrustAll()`（读 `process.env.PI_WEB_AUTO_TRUST_ALL`，默认 true）。`getProjectTrustStatus` / `trustProject` / `projectTrustReloadOptions` 一律在 autoTrustAll 分支短路返回 `trusted: true`，对底层 `ProjectTrustStore` 不写不读。

**配置**：
- `.env.local` 新增 `PI_WEB_AUTO_TRUST_ALL=true`（显式声明，便于以后切回）
- 切回严格模式：`PI_WEB_AUTO_TRUST_ALL=false` — 行为完全跟之前一样

**影响**：
- UI：`components/AppShell.tsx` 里 banner (1010) 和 dialog render (1724) 的条件 `projectTrust?.requiresTrust && !projectTrust.trusted` 永为 false → 不展示
- API：`GET /api/project-trust` 永远返回 `{requiresTrust: true, trusted: true}`；`POST` 仍可用，但等价的"信任"通过 env 已经达成
- SDK plumbing：完全保留（`projectTrustReloadOptions` 仍然返回 `resolveProjectTrust`），往后一行 env 即可切回严格模式
- 风险：单用户 dev 部署（pi-web on 0.0.0.0:30141）意味着任何能访问 30141 的人 push 仓库带 `.pi/extensions/*.js` 就会被执行。**仅当部署隔离环境使用**。如果后续要把 pi-web 暴露到公网或多用户，先切回 `PI_WEB_AUTO_TRUST_ALL=false`
