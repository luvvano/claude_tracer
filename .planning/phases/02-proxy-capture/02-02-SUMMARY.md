# Summary: Plan 02-02 — Show & Diff CLI Commands

## Status: Complete

## What Was Built
- `src/cli.ts`: added `show [session_id]` and `diff <session_id> <call_index>` commands
- `show` (no args): lists all sessions with date, call count, token total
- `show <id>`: full call timeline with per-call diff summaries, [RESET] flag, totals
- `diff <id> <n>`: detailed prompt diff for a specific call

## Key Files Modified
- `src/cli.ts`

## Verification
- Build exits 0
- Smoke test: all 3 commands work against test_cli_smoke session
- Error handling verified

## Deviations
None

## Commits
- 12115da feat(02-02): add show and diff CLI commands
- a99f128 feat(02-02): smoke test passed
