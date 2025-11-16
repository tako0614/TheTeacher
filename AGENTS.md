# Repository Guidelines

## Project Structure & Module Organization
This repo tracks the AI-first study Tauri app scoped in `PLAN.md`. Keep new code grouped by surfaces: `app` for the SolidJS + Tauri client, `services/api` for Hono Cloudflare Workers, and `packages/shared` for cross-cutting schema and utilities. Co-locate feature code (component, styles, hooks, tests) under a single folder, and keep test data/fixtures beside the code that uses them.

## Build, Test, and Development Commands
Use `pnpm` for installs and scripts to keep lockfiles consistent. Typical scripts to add and rely on:
- `pnpm install`: install dependencies.
- `pnpm tauri dev`: run the Tauri app with hot reload.
- `pnpm run dev:api`: start the Hono worker locally (via Wrangler/Miniflare).
- `pnpm run build`: create release bundles for app + worker.
- `pnpm run lint`: run ESLint/Prettier formatting checks.
- `pnpm run test` / `pnpm run test -- --coverage`: run unit/integration suites and collect coverage.
Adjust names if scaffolding differs, but prefer these conventions across packages.

## Coding Style & Naming Conventions
Write strict TypeScript. Components and context providers use `PascalCase`; hooks use `useX` camelCase; utility modules are kebab-case filenames. Default to 2-space indentation and rely on Prettier for formatting and ESLint for static checks. Prefer named exports for shared modules; keep functions small and pure. Use Tailwind utility classes, but extract repeated patterns into components before they grow noisy.

## Testing Guidelines
Favor Vitest + Testing Library for UI logic and Hono handlers. Name tests `*.test.tsx` or `*.test.ts` beside the source. Mock network and file I/O; avoid hitting real APIs or spilling user data. Gate merges on green `pnpm run test` and maintain coverage at or above 80% for new/changed code. Add snapshot or end-to-end coverage only for user-critical flows (auth, lesson creation, export).

## Commit & Pull Request Guidelines
Use Conventional Commits (`feat`, `fix`, `chore`, `docs`, `refactor`, `test`) with short, imperative subjects. For PRs, include: a concise summary, linked issue or plan section, screenshots for UI changes, manual test notes (`pnpm run lint`, `pnpm run test`), and call out risks or follow-ups.

## Security & Configuration Tips
Keep API keys (LLM providers, Cloudflare, storage) in untracked `.env.local` files and reference them through the runtime config layer. Do not log secrets. For Tauri, disable auto-open of external URLs and validate file imports. For Workers, pin dependencies and avoid storing PII unless encrypted.
