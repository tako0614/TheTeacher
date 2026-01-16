# API service (Hono + Cloudflare Workers)

Edge worker that proxies AI calls, handles ingestion/embeddings, and serves study data for the Solid/Tauri client.

## Local scripts
- `pnpm dev` — `wrangler dev src/index.ts`
- `pnpm build` — bundle to `dist/`
- `pnpm test` — Vitest (single-thread) for worker endpoints and ingest helpers
- `pnpm typecheck` — `tsc --noEmit`

## Implemented routes (high level)
- `/health` — readiness
- `/api/auth/*` — anonymous bootstrap, profile update, session issue/rotate
- `/api/learnings|materials|contents|sessions|presets` — CRUD with D1 + semantic indexing
- `/api/materials/ingest` — ingest request → chunk/embed pipeline with R2/KV hooks
- `/ai/proxy` — chat proxy + tool calls (`search_learnings`, `create_learning_from_chat`, `generate_questions`, `save_content`)
- `/ai/material/generate` — generate QA / practice / summary from material text (optionally with images via GPT-4o-mini Vision)
- `/ai/chat` — generic OpenAI chat proxy (supports vision inputs)
- `/ai/embed`, `/search/semantic`, `/search/content`, `/api/semantic/reindex`, `/ai/practice/grade`, `/ai/tools`, `/api/tts/generate`

## Bindings
- `DB` (D1): primary metadata store (Prisma D1 adapter, migrations auto-applied)
- `MATERIALS_BUCKET` (R2): binary assets
- `MATERIALS_KV`: optional index/cache for material assets
- `VECTORIZE`: (optional) semantic search index (Cloudflare Vectorize)
- `VECTORIZE_INDEX_DIMENSIONS`: expected embedding dimensions (default `1536` for `text-embedding-3-small`)
- `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_CURRENCY`, `STRIPE_PRICE_AMOUNT`, `CREDITS_PER_PACK`: credit billing settings
- `MIN_PRICE_PER_CREDIT`: minimum unit price per credit (JPY); credits minted per pack are capped so the unit price doesn't drop below this floor
- `GOOGLE_CLIENT_ID`: for verifying Google ID tokens when signing in
- `OPENAI_*` envs: model configuration for embeddings/vision/tts/proxy chat

## Vectorize setup (optional)
1. Create an index (dimensions must match your embedding model):
   - `wrangler vectorize create theteacher-semantic --dimensions 1536 --metric cosine`
2. Set the OpenAI key (required for Vectorize-backed search):
   - `wrangler secret put OPENAI_API_KEY`
3. Backfill existing content into Vectorize (per user):
   - `POST /api/semantic/reindex` (requires auth; uses the current session user)
