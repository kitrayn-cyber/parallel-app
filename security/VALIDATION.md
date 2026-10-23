# Review-branch validation

Executed locally on 2026-10-23. None of these checks applied a remote migration or deployed code.

- **15 tests passed:** 9 existing background tests, 5 security tests, and 1 compiled Miniflare/D1 runtime test extended to cover session login and revocation. Coverage includes authentication, expiry, hashes rather than raw stored tokens, per-IP throttling under concurrent requests, shared Gemini budget, queued replies after logout, and exact application-row preservation across the additive migration and session revocation. Existing encrypted-push and crash/fencing tests still pass.
- Worker and frontend script syntax checks passed, including extracting the inline HTML script for `node --check`.
- Wrangler `deploy --dry-run --outdir dist` passed with an isolated local configuration home. This command built a local bundle only; it did not deploy.
- A Chrome browser regression passed with all Worker requests mocked: removal of the old password storage key, session login, remembered reopen, foreground proxy reply, rejection of an arbitrary backend URL, background history sync, session revocation, and preservation of existing chat and notebook storage. The CSP permitted required app code without browser errors.
- Git history scan: 47 reachable commits / 71 unique text blobs; credential-pattern matches were local test fixtures only. See audit scope/limitations.

## Reproduce local checks

From `background/`, install the locked dependencies with pnpm, then run:

```sh
pnpm run check
pnpm test
pnpm run build          # This script uses --dry-run; it does not deploy.
pnpm run test:runtime
```

Run `node security/update-csp.mjs` from the repo root after changing the inline app script; commit the regenerated CSP hash. A stale hash will block login/application code. Inline styles remain allowed for compatibility; script eval and arbitrary inline scripts are not allowed.

The optional `security/browser-regression.cjs` requires Playwright plus a local Chromium installation in the developer test environment. Serve this repository at `http://127.0.0.1:8767`, then run that script using Node with Playwright resolvable. Set `CHROME_PATH` if using an existing Chrome executable. Do not point this fixture at the live app: it seeds fake local data and mocks only the test API. It uses only fake credentials and does not make production requests.

Still required before any approved rollout: staging deployment and real session tests, response-header review, Safari/iPhone testing of persistent sessions, existing subscription reuse, actual push delivery after a scheduled reply, an approved legacy AI endpoint cutover, and backup/restore rehearsal against a fresh snapshot. The audit and this PR do not claim those production/device checks were run.
