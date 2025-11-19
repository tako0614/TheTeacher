import type { D1Database, KVNamespace, R2Bucket } from "@cloudflare/workers-types";

export interface AppBindings {
  DB: D1Database;
  MATERIALS_BUCKET?: R2Bucket;
  MATERIALS_KV?: KVNamespace;
  OPENAI_API_KEY?: string;
  OPENAI_API_BASE_URL?: string;
  OPENAI_MODEL?: string;
  OPENAI_EMBED_MODEL?: string;
  OPENAI_EMBEDDING_MODEL?: string;
  OPENAI_TRANSCRIPTION_MODEL?: string;
  OPENAI_VISION_MODEL?: string;
}

export interface AppEnv {
  Bindings: AppBindings;
}
