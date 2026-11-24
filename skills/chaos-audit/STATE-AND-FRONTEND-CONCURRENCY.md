# State & Frontend Concurrency Playbook

Load when Phase 1 identifies React, Next.js, Vue, Svelte, Solid, vanilla browser JS/TS, or mobile UI state management.

---

## 1. Out-of-Order Async Fetch Overwrites (`stale_async_race`)
- **Signature:** Search input, filter tab, or `useEffect` triggers `fetch(...)` and calls `setState(result)` without cancelling prior requests via `AbortController` or checking a monotonic `requestId` ref.
- **What Breaks:** User types `"ab"`, slow response for `"a"` resolves after fast response for `"ab"`, silently overwriting the UI with stale data.

## 2. Double-Submit & Missing In-Flight Lock (`double_submit`)
- **Signature:** Form submit / checkout button triggers async `POST` without immediately disabling submission (synchronously via `isSubmittingRef`, not just async React state batching) or attaching a per-action idempotency key.

## 3. Optimistic UI Rollback Corruption (`optimistic_rollback_race`)
- **Signature:** Two rapid mutations capture `const previous = state` before awaiting; mutation #1 fails after mutation #2 starts and rolls state back to stale `previous`, wiping out mutation #2.

## 4. Listener & Timer Leaks on Re-Render / Reconnect (`listener_leak`)
- **Signature:** `window.addEventListener`, WebSocket `on("message")`, or `setInterval` registered in effects or reconnect callbacks without returning a cleanup teardown or deduplicating listeners.
- **What Breaks:** Every reconnect multiplies handlers (`N` duplicate events fired per message) and leaks memory.

## 5. Multi-Tab Shared Storage Races (`cross_tab_storage_race`)
- **Signature:** Reading, mutating, and writing `localStorage`, IndexedDB, or auth refresh tokens across concurrent browser tabs without `BroadcastChannel` / `navigator.locks` coordination (causing simultaneous refresh token rotation failures).
