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