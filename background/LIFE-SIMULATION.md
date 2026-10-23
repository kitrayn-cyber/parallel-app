# Dynamic Life Simulation — design and review

Gura lives fictionally in Berkeley, America/Los_Angeles. One shared weekly schedule is generated server-side on first need and persisted in D1. The generator takes a random seed and Berkeley week, never the user's timezone, online presence or availability. Concurrent first requests converge on the database's winning row. Stored weeks survive sessions, devices and code updates.

The bounded generator reserves sleep first (22:30–23:30 bedtime and 07:30–08:30 wake-up, at least eight wall-clock hours; seven actual hours on spring DST). It includes breakfast, lunch, breaks, commuting, laboratory work, research, meetings, dinner and quiet evenings. Each week chooses different late and early workdays, preserves weekends off, sometimes gives Monday off, and sometimes inserts an experiment disruption. Every block is contiguous. Dinner/rest remains protected after late work. The generator provides restrained activities rather than inventing new character traits or biography.

The existing randomized 30-second–3-hour reply delay remains. Scheduling moves the resulting time to the next available block; sleep/work can extend the total wait beyond three hours. Cron rechecks the stored activity before generation, including old pending jobs; unavailable jobs receive a small randomized delay before the next opening. Existing due times are not bulk rewritten. Available means a reply is possible, not promised. The current activity is passed as continuity context to the established character model; its underlying personality prompt is unchanged.

GET /api/world returns only title, availability, fictional flag and Berkeley location. It requires the security PR's existing authentication and rate limits. It never returns blocks, seed, next transition or future plans. World polls while unlocked and shows an unavailable status when its cached response expires. The browser never creates a schedule. Network loss does not replace it with invented local activity.

## Security coordination

Stack this feature on security PR #2, branch codex/security-session-hardening, commit e0d9774cce81fa2a59a403c051998f58dc4e5e98. Retain pinned origins, sessions, request limits, shared AI quota, job leases/fencing, IDs and push handling. Migration 0003_life.sql creates only life_weeks; 0002_security.sql remains reserved for security. CSP was regenerated after changing inline JavaScript.

No production change is authorized. After review, integrate security first, retarget/rebase this feature onto main, review both together, then seek explicit deployment approval. Back up D1 and apply additive migrations before deploying the matching Worker/frontend. Keep the life table when rolling back code; do not delete user data. Weeks are retained for continuity; no administrative future-schedule endpoint is added.

## Validation

- 300 generated weeks across spring/fall DST: positive durations, full contiguous coverage, deterministic seeded generation, sleep minimums, lab/meeting/rest activities.
- 16 background/security tests (including two life integration checks): message idempotency, jobs, leases, push, AI payload, sessions, rate limits, credential migration and data preservation.
- Compiled Worker with local Miniflare/D1: persistence, authenticated World endpoint, no future fields, stable responses and existing job preservation.
- Wrangler dry-run build and mocked Chrome regression: login/reopen/logout, current World display, CSP, foreground proxy and background history sync. No deploy or production migration.

This is a bounded procedural simulation. Unexpected events are generated with the week and kept stable; it does not use real Berkeley laboratory calendars, live weather, or external events. Existing local-only conversation storage remains local-only; the shared life schedule is server-side.
