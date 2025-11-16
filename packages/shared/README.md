# Shared package

Cross-cutting schema, types, and utilities consumed by the Tauri app and API service.

## Milestones
- Define domain models for Learning, Material, GeneratedContent, PracticeSession, Preset, SemanticNode.
- Export zod schemas/TypeScript types for validation and data sharing.
- Provide client helpers (API client, formatting utilities) once service endpoints exist.

## Dev tasks (next)
1. Flesh out data model types and codecs based on `docs/data-model.md`.
2. Add build pipeline (tsup/tsc) and lint/test setup shared across packages.
3. Publish local build outputs for consumers in `app` and `services/api`.
