# Tauri app (SolidJS + Tailwind)

SolidJS + Tailwind + Tauri client for the AI-first study experience described in `PLAN.md`.

## Milestones
- Bootstrap Vite + Tauri scaffold with strict TypeScript config and Tailwind.
- Build learning surfaces: list, detail (tabs for Q&A / practice / summary / podcast), practice screen, presets/settings.
- Wire AI calls through shared client once backend/proxy is in place.
- Persist Learning, Material, GeneratedContent, PracticeSession locally (SQLite/IndexedDB).

## Dev tasks (next)
1. Initialize Vite (Solid) + Tauri project here and align scripts with root `package.json`.
2. Add base layout shell and navigation for the screens listed above.
3. Define shared UI primitives (button, card, tabs) to keep Tailwind usage consistent.
4. Integrate shared schema/types from `packages/shared` as they evolve.
