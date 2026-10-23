# Parallel background messaging — review before deployment

This extends the existing PWA and separate background Worker. It does not replace the AI Worker or its Gemini/personality prompt. Nothing here has been deployed.

## What inspection found

- `index.html`: real AI calls to `parallel-ai.chloerayn.workers.dev`, password unlock, Berkeley schedule, photos, sounds, local conversation/archive and notebook. Delays previously used browser timers, so closing the app stopped execution.
- `background/`: draft D1 message queue and minute cron, short delays and calls to the existing AI Worker. Its binding was a placeholder for **parallel-messages**, not the requested **parallel-memory**. No frontend connection or push.
- `database/schema.sql`: a second schema containing `conversations`, `messages`, `memories`; it differs from `background/schema.sql`.
- `sw.js`: static asset caching only. There were no package scripts or tests.

## Current status and verification boundary

Live Cloudflare verification succeeded on **2026-10-23**. The verified account is `3dcd41885bb83fea67e40a9d656153e8`; `parallel-memory` is `33145491-fdb9-4471-8d18-884443a0bec2`. Its existing tables match `database/schema.sql` (the optional indexes are absent). Read-only counts: 1 conversation, 36 messages, 0 notebook memory rows. No `bg_*` tables or legacy `chat_messages`/`outgoing_jobs` tables exist. These counts can change through normal app use.

The only deployed Worker is `parallel-ai`, with `DB` bound to that same database and secret bindings `GEMINI_API_KEY` and `PARALLEL_PASSWORD`. Its original `GURA_PERSONALITY` prompt remains intact. No secret values were retrieved. There is no deployed `parallel-background` Worker or background cron yet.

The live AI contract requires Origin `https://kitrayn-cyber.github.io`, Bearer password, at most 12,000 raw JSON characters, up to 12 `{role,text}` turns and a final user turn; it returns `{reply}`. The adapter now supplies that Origin and removes oldest context when needed while keeping the latest text intact. Photos are retained in D1/UI but not sent as unsupported image data: the current AI Worker has no image analysis implementation. Its existing memory lookup and exchange logging use the legacy `kit-main` conversation; those behaviors remain unchanged. Live authentication/Gemini generation are untested because secret values cannot be read and a real generation would write production messages.

**Production remains unchanged.** The verified UUID is now in configuration, but migration, secret creation, Worker deployment, cron enablement and frontend publication still require approval. See [DEPLOYMENT.md](DEPLOYMENT.md) for the concrete rollout and remaining steps.

`migrations/0001_background.sql` creates namespaced `bg_*` tables only. Existing conversation/message/memory tables and old prototype queue tables are not altered. Do not apply the old `background/schema.sql` as this release's migration. Existing server memories are read from `memories(note,updated_at)` when that table exists; verify those columns before rollout. Existing server conversations are left intact, not automatically imported into a new conversation. Local current/previous history is uploaded when background mode is connected. A job is created only for a newly sent message or the local outstanding reply, not every historic message.

## Simple manual steps

1. **Review the verified target.** In Cloudflare, open Workers & Pages → D1 → `parallel-memory`. The UUID and live schema have already been verified; use the read-only SQL below to recheck immediately before rollout. Inspect `parallel-ai` bindings/source in the dashboard; confirm that its API accepts `{messages:[{role,text}],photo}` and returns `{reply}`, and that the established Gurathin prompt and Gemini key remain there. These were verified during preparation. Do not put the Gemini key in Parallel's HTML.
2. **Review the changes and approve production work.** The verified database UUID is already set in `wrangler.toml`. Confirm `DB` targets `parallel-memory`, `AI` targets `parallel-ai`, and `ALLOWED_ORIGINS` matches your PWA origin. Preserve any other deployed bindings/secrets. Export a backup before applying the additive migration. This is the approval boundary: steps 3–5 change production and have NOT been run.
3. **Install and set up server secrets.** From `background`, run `pnpm install --frozen-lockfile`. Use `pnpm exec wrangler secret put APP_PASSWORD` with the same password used to unlock the existing app, and `pnpm exec wrangler secret put AI_WORKER_PASSWORD` with the existing AI Worker's password. Values go into the private interactive prompts, never source code or chat. Generate stable push keys with `node scripts/generate-vapid.js mailto:YOUR_EMAIL`; keep the generated `.vapid-keys.local` private. Upload it with `pnpm exec wrangler secret bulk .vapid-keys.local`. This file contains only VAPID secrets; Gemini stays in the AI Worker. Do not regenerate VAPID keys on each deployment.
4. **Apply and deploy only after approval and backup.** Run `pnpm exec wrangler d1 migrations apply parallel-memory --remote`, then `pnpm exec wrangler deploy`. Confirm the minute cron trigger and `DB`/`AI` bindings in the dashboard. Retain all existing secrets on `parallel-ai`. Publish the reviewed frontend files, including the new `background-client.js` and updated `sw.js`, through your normal GitHub Pages flow.
5. **Connect your installed PWA.** Open Parallel from its Home Screen icon, unlock, go to Settings → Background messages, enter the deployed background Worker HTTPS address and tap **Connect background service**. Keep it open until sync completes. This copies your current and previous local chats to your private backend; local history remains. Then tap **Enable notifications** and allow the iPhone prompt. iOS 16.4+ and a Home Screen installation are required. If permission was denied, allow Parallel in iPhone Settings → Notifications.
6. **Verify on your iPhone.** Send a message; wait for **Saved on server · Reply scheduled**, then close Parallel completely. Check that the cron stores a reply and that a notification arrives. Reopen/unlock: the reply should appear once. Also test notifications disabled and airplane mode. If a send says **Not yet saved on server**, it is only local and will retry when the app is online/open. A closed app cannot upload a message that never reached the server.

Read-only schema verification (Cloudflare D1 console):

```sql
SELECT name, sql FROM sqlite_master
WHERE type IN ('table','index') ORDER BY name;
PRAGMA table_info(memories);
PRAGMA table_info(messages);
PRAGMA table_info(conversations);
PRAGMA table_info(chat_messages);
PRAGMA table_info(outgoing_jobs);
```

Inspect schemas/bindings without exporting private message contents into logs. Verify no existing `bg_*` table has incompatible columns before running the migration. If the old background service was ever deployed, inspect its pending jobs and history first and plan an explicit one-time transfer before enabling this service; this release deliberately does not silently move or discard legacy jobs.

## Delivery behavior

- Authenticated message POST atomically inserts the message and its job. Stable client IDs make retries idempotent. The cron executes with the PWA closed.
- Berkeley availability matches the existing UI and adjusts for daylight saving: 06:30–08:00, 12:00–13:00 and 19:00–22:30 weekdays; 06:30–22:30 weekends. A random natural delay is 30 seconds–3 hours. **Sleep/lab windows, cron timing, outages, quota and retries can extend total waiting beyond three hours.** A strict three-hour wall-clock guarantee conflicts with preserving overnight unavailability.
- One job per newly sent message. Jobs in a conversation run in order. Subsequent messages are retained even while a prior reply is processing. Each generation includes recent conversation context, the notebook snapshot attached to that message, existing D1 memories if present, and a current Berkeley clock.
- API errors use exponential retries, with five attempts before manual retry. Stale processing leases are reclaimed and fenced; deterministic reply IDs prevent duplicate stored replies. An upstream AI call can be repeated after a crash (and may be billed again), but its reply is committed once.
- A server-wide limit of 100 AI attempts per UTC day replaces reliance on the device-only spending limit in background mode. Exhausted quota defers jobs to the next day.
- Replies commit before push sending. Push uses encrypted `aes128gcm` payloads and VAPID through `@block65/webcrypto-web-push` v2. Notifications contain a generic message, not private conversation text. Push has separate durable retries and removes expired subscriptions. Push is best effort, not a delivery guarantee; replies remain in D1 if a notification fails.
- Tapping a notification opens the PWA within its existing scope and selects the matching current/previous local conversation where available. Unlock may still be needed. This does not provide a full multi-device conversation picker or download all legacy D1 conversations.
- Background mode is opt-in; before connection, existing local AI behavior remains. Developer Mode only affects the old foreground simulator; it does not bypass server schedule windows.
- Existing optional “Remember me” still stores the app password locally because that was existing behavior. No new API key is stored in the browser. The background API retains the existing single-user password model; it is not multi-user authentication.

## Development checks

Node 24 recommended (SQLite tests use `node:sqlite`). From `background`:

```sh
pnpm install --frozen-lockfile
pnpm run check
pnpm test
pnpm run build             # dry-run only; does not deploy
pnpm run test:runtime      # compiled Worker against actual local D1/Miniflare
```

Tests use temporary local databases and mocked AI/push, never production Gemini or D1. The browser UI was checked with an isolated mock fixture: unlock, settings, history import, and sending a scheduled message. Physical iPhone push delivery and successful live Gemini generation remain deployment acceptance checks; the deployed personality prompt was inspected and preserved.

For rollback, keep the previous frontend files and Worker version. Disable the cron before rolling the Worker back to prevent abandoned jobs from continuing. Do not delete database tables or local storage. New `bg_*` data can remain during rollback. Pause background use rather than switching a sent-but-pending conversation to foreground timers, which could create another reply.

References: [D1 transactional batches](https://developers.cloudflare.com/d1/worker-api/d1-database/), [iPhone Home Screen Web Push](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/), [Web Push library](https://github.com/block65/webcrypto-web-push/tree/master/packages/web-push).
