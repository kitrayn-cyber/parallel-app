# Parallel background service (not yet deployed)

This is a **separate Cloudflare Worker**, so the existing Parallel app and AI Worker remain unchanged. It queues messages in Cloudflare D1 and checks for eligible replies every minute, even when the phone is closed. It uses the existing AI Worker to generate responses and stores them for later retrieval.

## Setup
1. Install Wrangler and sign in to Cloudflare: `npx wrangler login`.
2. From this directory create a D1 database: `npx wrangler d1 create parallel-messages`. Copy the returned ID into `wrangler.toml`.
3. Apply the schema: `npx wrangler d1 execute parallel-messages --remote --file=./schema.sql`.
4. Add secrets (NEVER commit values): `npx wrangler secret put APP_PASSWORD`, `npx wrangler secret put AI_WORKER_URL`, `npx wrangler secret put AI_WORKER_PASSWORD`.
5. Deploy from this directory: `npx wrangler deploy`. Cron scheduling must also be enabled in the Cloudflare account.

## API
Authenticated with `Authorization: Bearer <APP_PASSWORD>`.
- `POST /api/messages` with `{"text":"hello"}` queues a user message.
- `GET /api/messages?after=0` retrieves saved messages; track highest ID.
- `GET /api/status` returns service status.

## Important limits / next tasks
- **Not connected to the PWA yet**. To use it, migrate messaging to these endpoints, reconcile device-local conversation history and store credentials securely.
- **No Web Push yet**. Replies persist while the phone is closed, but iPhone notifications require VAPID push subscriptions, permission, and a send implementation.
- This is a **single-user prototype**, using one shared password. Production needs stronger auth, rate limits, correct CORS allowlist, duplicate/idempotency protection, retry/dead-letter policy, migration, and robust database transactions.
- Cloudflare cron executes roughly once per minute. Schedules are Berkeley-local and daylight-saving aware. AI expenses and Cloudflare plan limits may apply.
- Never store passwords or private messages in the public GitHub repo.
