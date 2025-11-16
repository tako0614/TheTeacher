# Prisma Guide
We manage relational data with Prisma per `data-model.md`. Schema and migrations are centralized and shared between the Tauri client (SQLite) and the API (Cloudflare Workers + D1).

## Layout and prerequisites
- Schema: `packages/shared/prisma/schema.prisma`
- Migrations: `packages/shared/prisma/migrations/`
- Dev SQLite DB: `packages/shared/prisma/dev.db` (gitignored)
- Create a root `.env.local` with `DATABASE_URL="file:./packages/shared/prisma/dev.db"` (do not commit). Ensure Prisma CLI sees `DATABASE_URL` when running commands.
- Pin Prisma versions at the workspace root (use `-w` when adding).

## Dependencies
1. Prisma CLI (dev dependency): `pnpm add -D prisma -w`
2. Add `@prisma/client` in every runtime package that executes queries. Examples:  
   - API (Workers/D1): `pnpm add @prisma/client @prisma/adapter-d1 --filter @theteacher/api`
   - Other runtimes: add `@prisma/client` and ensure `DATABASE_URL` is available where it runs.

## Schema changes and migrations (SQLite dev flow)
1. Update `packages/shared/prisma/schema.prisma` in sync with `data-model.md`.
2. Format: `pnpm run db:format`
3. Create migration and update dev.db:  
   - Bash: `DATABASE_URL="file:./packages/shared/prisma/dev.db" pnpm run db:migrate -- --name <change-name>`  
   - PowerShell: `$env:DATABASE_URL="file:./packages/shared/prisma/dev.db"; pnpm run db:migrate -- --name <change-name>`  
   This updates `dev.db` and adds to `migrations/`. Commit with `schema.prisma`.
4. Generate client (in packages that need it):  
   - Bash: `DATABASE_URL="file:./packages/shared/prisma/dev.db" pnpm run db:generate`  
   - PowerShell: `$env:DATABASE_URL="file:./packages/shared/prisma/dev.db"; pnpm run db:generate`

## Applying existing migrations
- With `DATABASE_URL` set, run `pnpm run db:migrate` to apply pending migrations to dev.db.

## Production application (SQLite/PostgreSQL, etc.)
- In CI/deploy, use `pnpm run db:deploy` to apply existing migrations.
- For tests, point `DATABASE_URL` to another DB (e.g., `file:./packages/shared/prisma/test.db`) and run the same commands.

## Using Cloudflare D1 (planned)
D1 cannot run `prisma migrate dev` directly; generate SQL and apply with Wrangler.
1. First migration from empty:  
   `pnpm dlx prisma migrate diff --from-empty --to-schema-datamodel packages/shared/prisma/schema.prisma --script > services/api/prisma/migrations/0001_init.sql`
2. Subsequent diffs:  
   `pnpm dlx prisma migrate diff --from-migrations packages/shared/prisma/migrations --to-schema-datamodel packages/shared/prisma/schema.prisma --script > services/api/prisma/migrations/<timestamp>_<name>.sql`
3. Apply to local D1: `pnpm wrangler d1 migrations apply <DB_NAME> --local`
4. Apply to production: `pnpm wrangler d1 migrations apply <DB_NAME>`
5. Worker connection example:
   ```ts
   import { PrismaClient } from '@prisma/client';
   import { PrismaD1 } from '@prisma/adapter-d1';

   export default {
     fetch(request: Request, env: { DB: D1Database }) {
       const adapter = new PrismaD1(env.DB);
       const prisma = new PrismaClient({ adapter });
       // ...handler...
     },
   };
   ```

## Operating guidelines
- Keep migrations small; review/commit with `schema.prisma`.
- Document backup/migration steps for breaking changes in the PR.
- Keep secrets/connection strings in `.env*` and out of commits (gitignored).
