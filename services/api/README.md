# API service (Hono + Cloudflare Workers)

Edge worker that proxies AI calls and hosts embedding/search endpoints referenced in `PLAN.md`.

## Milestones
- Scaffold Hono worker with Wrangler dev harness and strict TypeScript.
- Add endpoints for AI proxying, generation logs, and (later) embeddings/vector search.
- Provide shared client bindings for the Tauri app via `packages/shared`.

## Dev tasks (next)
1. Initialize Wrangler project with Hono entrypoint and staging config.
2. Define simple `/health` and placeholder `/ai/proxy` routes.
3. Add schema validations using shared types once `packages/shared` exports them.
