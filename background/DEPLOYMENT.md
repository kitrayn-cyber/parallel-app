# Verified deployment plan — awaiting production approval

Prepared 2026-10-23 (Asia/Taipei). All Cloudflare actions so far were GET requests or read-only SELECT queries. Production has not been changed.

## Verified targets

| Item | Verified value |
| --- | --- |
| Account | `3dcd41885bb83fea67e40a9d656153e8` |
| Existing D1 | `parallel-memory` |
| D1 UUID | `33145491-fdb9-4471-8d18-884443a0bec2` |
| Existing tables | `conversations`, `messages`, `memories`; no conflicting `bg_*` tables |
| Read-only row counts | 1 conversation, 36 messages, 0 memories at inspection |
| Existing Worker | `parallel-ai`, compatibility date `2026-10-20` |
| Existing DB binding | `parallel-ai.DB` → the verified D1 UUID |
| Existing secret names | `GEMINI_API_KEY`, `PARALLEL_PASSWORD` (values unreadable) |
| New Worker | `parallel-background` — not deployed yet |
| New service binding | `parallel-background.AI` → existing `parallel-ai` default entrypoint |
| PWA / allowed Origin | `https://kitrayn-cyber.github.io/parallel-app/` / `https://kitrayn-cyber.github.io` |
| Inspected AI version ETag | `51df33d2fa401643591998a36079b2ee23771931e6b4a5c35f71a50bde2f5494` |

The D1 metadata list reported `num_tables: 0`, but direct `sqlite_master` queries proved the three application tables exist. Schema inspection, not the metadata counter, is the basis for verification. Queries reported `changed_db: false`, `rows_written: 0`.

## Compatibility fixes included

The deployed AI Worker requires the exact Origin header and limits raw JSON to 12,000 characters. The new adapter supplies that Origin and trims oldest history until the payload fits, retaining the latest message and the continuity turn where possible. Its response contract `{reply}` and original character prompt were verified from source. A private local test ran that exact source with fake credentials/local D1/mocked Gemini and accepted the prepared request.

The existing Worker has no photo analysis path. Photos remain saved and displayed in Parallel; generation sends text plus an explicit note that the image cannot be viewed. Adding Gemini vision would be a separate change to the existing AI Worker; this deployment does not modify it.

The existing AI Worker also reads/writes legacy `kit-main` history during generation. Background replies are committed idempotently to `bg_messages`, but retrying an upstream request after a crash can still repeat the legacy Worker's exchange log or provider cost. Existing history is not deleted or migrated automatically.

## Production actions proposed for approval

1. Recheck schema/version metadata and capture a D1 backup/recovery bookmark immediately before rollout. Preserve the existing `parallel-ai` version and bindings.
2. Apply only `background/migrations/0001_background.sql` to `parallel-memory`. It adds six namespaced tables and two indexes; it does not alter/delete existing tables or messages. Wrangler also records migration tracking metadata. Do not apply either historical schema file as a replacement database.
3. Create/configure `parallel-background` with the reviewed build, `DB`/`AI` bindings and the variables in `wrangler.toml`. Add these secrets privately:
   - `APP_PASSWORD`: same app password as the existing `PARALLEL_PASSWORD`.
   - `AI_WORKER_PASSWORD`: the existing `PARALLEL_PASSWORD`, entered separately for server calls.
   - `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`: prepared in the ignored, owner-only `.vapid-keys.local` file. Never commit or print that file.
4. Deploy and enable the minute cron. No existing chats should be imported or messages sent until authenticated status and configuration are checked. Do not call the existing Gemini endpoint for a test without approval: it creates real history rows.
5. Publish the reviewed frontend only after the backend is configured, by merging PR #1 through the normal GitHub Pages flow. Merging/publishing is a separate production action included only if approved.
6. From the installed PWA, connect the new Worker. Wait for history upload; send one approved test message, wait for **Saved on server · Reply scheduled**, then close the app. Confirm one stored reply and iPhone notification. Open/unlock it and verify the reply appears once. Berkeley schedule windows still apply.

No need to download or upload source files: the changes and verified configuration are in PR #1. The only unavoidable private input is the existing app password, because Cloudflare never returns secret values. Enter it through Cloudflare's secret form or Wrangler's interactive secret prompt, never in chat.

## After approval: operator commands

Run from `background/` with an authenticated Wrangler session. These commands are documented for review and have NOT been run against production.

```sh
pnpm install --frozen-lockfile
pnpm run check
pnpm test
pnpm run build
pnpm run test:runtime

# Before changes, create a private backup using the D1 dashboard or secure export.
# Recheck DB UUID and schema, then apply only the additive migration:
pnpm exec wrangler d1 migrations apply parallel-memory --remote

# For a new Worker, Wrangler may ask permission to create its script when adding secrets.
pnpm exec wrangler secret put APP_PASSWORD
pnpm exec wrangler secret put AI_WORKER_PASSWORD
pnpm exec wrangler secret bulk .vapid-keys.local
pnpm exec wrangler deploy
```

VAPID keys were generated privately during preparation and have not been uploaded. Keep those same keys across deployments. The repository includes a generator for future installations; do not run it again over the existing prepared key file. If this local workspace is unavailable to the deployment operator, generate new keys privately before any subscriptions exist.

## Rollback / acceptance limits

Keep `parallel-ai` unchanged. If the new service fails, stop its cron first, retain its D1 tables and pending jobs, and restore the previous frontend without clearing local storage. Avoid generating foreground replies for messages that still have server jobs. Preserve `parallel-memory` throughout rollback.

Checks completed locally: syntax checks, dry-run bundle, generated binding declarations, automated tests against SQLite and real local D1/Miniflare, and compatibility execution using the actual deployed AI source. Remaining live checks require the existing password and production approval: authenticated status, real Gemini generation, actual notification delivery on the installed iPhone PWA, and background operation after closing it.
