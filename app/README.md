# Tauri app (SolidJS + Tailwind)

SolidJS + Tailwind + Tauri client for the AI-first study experience described in `PLAN.md`. Tauri is used as a thin desktop wrapper; the main runtime is the regular Vite (Solid) app so you can dev/run it just like a web front-end.

## Safety & media handling
- 画像はLLMに直接渡してOCR/文字起こし・要約を行う方針です（LLMのVision/Audio機能を活用）。
音声とかはそれ用のモデルを使うことになると思います。

## Milestones
- Bootstrap Vite + Tauri scaffold with strict TypeScript config and Tailwind.
- Build learning surfaces: list, detail (tabs for Q&A / practice / summary / podcast), practice screen, presets/settings.
- Wire AI calls through shared client once backend/proxy is in place.
- Persist Learning, Material, GeneratedContent, PracticeSession via backend APIs (no local DB).

## Dev tasks (next)
1. Initialize Vite (Solid) + Tauri project here and align scripts with root `package.json`.
2. Add base layout shell and navigation for the screens listed above.
3. Define shared UI primitives (button, card, tabs) to keep Tailwind usage consistent.
4. Integrate shared schema/types from `packages/shared` as they evolve.
