# AI Agents & LLM Pipelines Playbook

Load when Phase 1 identifies LLM SDK calls, tool/function calling, agent loops, streaming responses, MCP servers, or multi-agent orchestrators.

---

## 1. Non-Idempotent Tool-Call Retries (`llm_tool_duplicate_execution`)
- **Signature:** Agent loop retries a timed-out or malformed LLM turn/tool execution (`send_email`, `create_invoice`, `post_comment`, `git_push`, `charge_card`) without tracking tool-call idempotency keys across turns.
- **What Breaks:** Transport retry or model recovery executes irreversible external side effects twice.

## 2. Unbounded Agent Retry / Self-Healing Loops (`unbounded_agent_loop`)
- **Signature:** `while (!done)` loop calling an LLM until tests pass or JSON parses cleanly, with no `maxTurns`, `maxTokensBudget`, `maxWallClockMs`, or identical-error circuit breaker.
- **What Breaks:** Deterministic compile/auth failure burns entire API budget in minutes.

## 3. Streaming Partial-JSON & Truncation Corruption (`stream_truncation_corruption`)
- **Signature:** Appending streamed chunks and passing to `JSON.parse()` or writing partial output directly into durable DB/files without checking `finish_reason === "stop"` / `stop_reason === "end_turn"` vs. `"length"` / network disconnect.

## 4. Parallel Subagent Workspace & Git Write Races (`subagent_write_race`)
- **Signature:** Multiple subagents launched in parallel sharing the same working directory, mutating the same file, lockfile, or `.git/index` simultaneously without git worktrees, file locks, or disjoint path ownership.

## 5. Orphan Child Processes & MCP `stdio` Pipe Deadlocks (`mcp_stdio_deadlock`)
- **Signature:** Spawning MCP servers or agent CLIs (`claude`, `codex`, `python`, `docker`) via `stdio` without draining `stderr` (filling the OS 64KB pipe buffer and hanging forever), or failing to kill the process group (`SIGTERM` → `SIGKILL`) on timeout/parent exit.
