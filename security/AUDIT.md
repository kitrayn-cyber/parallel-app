# Parallel security audit — 2026-10-23

Review-only. No production writes, migrations, deployments, key rotations, data deletion or changes to notification subscriptions were performed. This assessment covers the app at commit `37df440b79fb627186baffac15d4ace8c5e5bef0`, reachable Git history, and read-only Cloudflare source/config/schema inspection. The accompanying changes are a proposal, not a deployed fix.

## Ranked findings

| ID | Severity | Evidence and impact | Proposed treatment / remaining work |
|---|---|---|---|
| S1 | High | `index.html` originally reads/writes `parallel-remembered-login-v1` as the plaintext reusable password and sends it as Bearer on every request (audited lines 193–238, 356–360). Script execution on the shared origin, browser extensions or access to browser storage can recover a credential accepted by both Workers. No expiry or device revocation. | PR replaces browser password persistence with random, hashed-at-rest, expiring/revocable owner sessions. Password is sent only to the fixed login endpoint. See limitations below. |
| S2 | High | Existing `parallel-ai` authenticates a static password before reading `request.text()`, then calls Gemini. No server-side login throttling or spend cap exists there; the frontend's 100/day counter is editable and bypassable. The original source is deployed outside this repo. Spoofing the Origin header is possible for non-browser clients. | New authenticated `/api/chat` proxy enforces shared background/foreground daily quota and ingress limits. **The original endpoint is still a bypass until a separately approved service-only cutover or equivalent controls are applied to it.** No changes to that Worker are included or performed. |
| S3 | High, conditional on deceptive configuration | `background-client.js` accepts any HTTPS address and sends the reusable password to its `/api/status`. A deceptive address entered by the owner, or tampered browser settings, can capture it. This is credential exfiltration, not a server-side SSRF exploit. | Pin authenticated requests to the verified Worker origin; do not trust a persisted arbitrary destination. New session login and foreground requests are also pinned. |
| S4 | Medium | Both Workers use a shared owner credential. D1 tables have conversation IDs but no user ownership; the AI Worker reads/writes `kit-main` regardless of client conversation. Any holder of the shared credential has owner-level access. UUIDs and CORS are not authorization. | Preserve the existing single-owner model explicitly. Sessions all represent the same owner. Do not share passwords/sessions or describe this as multi-user isolation. A future multi-user change requires additive ownership mapping and explicit claiming of old conversations, memories and subscriptions; never guess their owners or discard old rows. |
| S5 | Medium | Local chats/archive/notebook are readable in browser storage and rendered behind a visual lock overlay. D1 stores application-readable message/memory text; the AI service receives it. There is no application-level/end-to-end encryption. Other apps under the same `kitrayn-cyber.github.io` origin share browser storage access. | Preserve current storage and origin. Add script CSP and pin connections as defense in depth, but do not claim the lock encrypts data. Stronger local encryption or origin isolation needs a reviewed, reversible data migration and recovery design. |
| S6 | Medium | Background requests have a per-body cap but no ingress/write limit, allowing a stolen owner credential to flood D1. Legacy AI uses an unbounded body read. Background's daily generation budget does not limit HTTP writes or legacy foreground calls. | Add persistent per-IP login and shared-owner request/write limits, bounded login/proxy bodies, and quota sharing. Legacy body/rate limits remain separate rollout work. Application limits still incur D1 work and do not replace network-level abuse controls. |
| S7 | Medium | Browser policy lacks a CSP; Worker invocation logs retain full query strings (including conversation IDs), as confirmed in settings. Existing `textContent` rendering avoids an obvious stored-XSS sink for message/notebook text; no exploit was demonstrated. | Proposed hash-based inline-script CSP, pinned `connect-src`, no objects/base/form destinations, no-referrer policy, API `nosniff`, and query-string redaction for the new Worker config. Strong `frame-ancestors` needs an HTTP header; GitHub Pages cannot set it through a meta tag. Existing AI logging config remains unchanged. |
| S8 | Low / residual risk | Push subscriptions are bearer-like delivery capabilities stored with encryption material in D1. Generic encrypted notifications avoid message text on lock screens, but reveal that Parallel/Gura sent an alert. Shared owner credentials may add/remove devices; no per-user device ownership exists. | Keep the existing VAPID key pair, subscription rows, push outbox and permissions. Preserve endpoint allowlisting, redirect rejection, encryption and generic text. Session expiry/logout does not unsubscribe devices or stop scheduled replies. A stolen owner session can still manage devices until revoked/expired. |

Severity describes impact and exposure; no evidence of an actual compromise was found. The absence of a detected exploit is not a guarantee of safety.

## API keys and GitHub history

A local pattern scan examined 47 reachable commits and 71 unique text blobs across the fetched refs. It checked Google API-key patterns, GitHub-token patterns, private-key headers and literal password assignments. Only clearly named local test fixtures matched. No matching live Gemini/API/private key or hardcoded app password was found. A scan is not proof that deleted/unreachable history, forks, artifacts, account logs or differently formatted secrets are clean. GitHub account/organization security settings were not exhaustively audited.

Cloudflare reports Gemini and app credentials as secret bindings. VAPID public key is intentionally public to subscribers; it is not an API credential. D1 UUID/account IDs/Worker URLs are identifiers, not database access tokens. Cloudflare REST access still requires account authorization; the D1 database is not publicly readable merely because its ID is known. Parameterized SQL was used for application inputs; no direct SQL-injection path was identified.

No keys were printed, copied into this report, rotated, or rewritten. Private operator backups and key files are excluded from the repo. Keep Cloudflare/GitHub access least-privileged and protect those local backup files separately.

## Proposed session design and candid limits

- 256-bit random opaque tokens, prefixed `ps_`; D1 stores only a SHA-256 token hash, creation/absolute-expiry timestamps and revocation time. Passwords and raw IPs are not stored in the session/rate tables.
- Unremembered sessions live only in page memory, expire after 12 hours, and disappear from the browser on a full close/reload. Remembered sessions last at most 14 days, are validated server-side on reopening, and can be revoked through Forget this device.
- The legacy plaintext Remember me key is removed without reading or transmitting its contents. Existing users sign in once after rollout. Chat, archive, notebook, conversation IDs, queued jobs and subscriptions are not cleared.
- Password goes only to pinned `/api/session`; foreground AI uses session-authenticated `/api/chat`; background APIs use the same session. Upstream Gemini credentials remain entirely server-side. Background jobs use the existing server-to-server secret and do not depend on a live browser session.
- Bounded cron maintenance removes only expired records from the two new authentication tables after a one-day grace period. It never purges application data or live sessions.
- Login: 10 attempts per IP per fixed 15-minute window; authenticated owner: 240 requests/minute, including 120 writes/minute; foreground AI: 10/minute and the existing shared 100 attempts/UTC-day budget. Fixed windows can permit boundary bursts; distributed attacks need an edge/global control. Long history uploads pause/retry without deleting local data. Limits count all owner's devices together.
- **Remembered tokens are still JavaScript-readable** on this GitHub Pages deployment. This reduces reuse of the master password and adds expiry/revocation, but does not make browser storage safe against XSS or malicious extensions. CSP is defense in depth, not a substitute for HttpOnly. Same-origin sibling GitHub Pages projects remain a trust boundary.
- The stronger target is a same-site first-party gateway with `Secure; HttpOnly; SameSite` session cookies, origin/CSRF validation, session revocation and a defined idle timeout. Safari's third-party cookie restrictions mean merely setting a workers.dev cookie from a github.io app is not a reliable replacement. Moving the frontend origin can strand its local data, so a custom-domain/gateway rollout requires a separate approved transfer/recovery plan; it is not silently done by this PR.
- Server sessions do not create separate user accounts. A compromised owner session still reads/modifies owner data within its lifetime. There is no automatic revocation of other sessions when the password changes; add an explicit all-device revocation operation during any future incident response.

## Preservation and review gates

`0002_security.sql` only creates `security_sessions`, `security_rate_limits` and expiry indexes. It does not alter, update or delete existing application tables. No primary IDs, Gemini personality, schedule rules, queue states, VAPID keys, push subscriptions, PWA scope/start URL or browser message/memory keys are changed. Existing legacy history mixing remains documented rather than changing character continuity silently. Logout updates only an authentication record and credential storage; it does not disable push.

The legacy background password fallback remains enabled by default for a backend-first transition. This is deliberate compatibility, not a security claim. After approved deployment and device updates, explicitly set `ENABLE_LEGACY_PASSWORD_AUTH=false`. The public AI Worker separately needs protection; turning this fallback off does not protect that other endpoint.

**Do not merge this PR into the Pages publishing branch now.** It changes the frontend to require new session endpoints which do not exist in production yet. No deployment workflow is added.

After separate approval:

1. Back up D1 and record bindings/version IDs, queue counts and subscription counts. Keep VAPID keys unchanged.
2. Rehearse the additive migration against a restored backup and compare every pre-existing row. Apply it, then deploy the backend while keeping legacy background authentication temporarily available.
3. Test login/expiry/revocation, foreground AI, real persisted scheduled replies, history upload/reopen, quota errors and iPhone push. Use isolated test conversations and retain all original data.
4. Publish the frontend only after those checks pass. Reopen the existing installed PWA; do not remove it or clear website data. Expect one password entry because the old saved password is deliberately removed.
5. Verify existing devices and chat/notebook continuity, then disable background legacy password auth and separately harden the original AI Worker without breaking the service binding. This last step is essential to close S2.
6. Observe errors and pending jobs. Roll back code/config if needed while retaining both the additive tables and all application data. An old frontend may recreate the legacy password storage; rollback is not a permanent security fix.

## Sources

- [OWASP session management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- [Cloudflare Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/)

Validation results and remaining device/browser checks are in `VALIDATION.md`.
