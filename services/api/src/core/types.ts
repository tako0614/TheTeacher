import type { D1Database, KVNamespace, R2Bucket } from "@cloudflare/workers-types";

export interface AppBindings {
  DB: D1Database;
  MATERIALS_BUCKET?: R2Bucket;
  MATERIALS_KV?: KVNamespace;
  GOOGLE_CLIENT_ID?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_PRICE_ID?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PRICE_CURRENCY?: string;
  STRIPE_PRICE_AMOUNT?: string | number;
  CREDITS_PER_PACK?: string | number;
  OPENAI_API_KEY?: string;
  OPENAI_API_BASE_URL?: string;
  OPENAI_MODEL?: string;
  OPENAI_EMBED_MODEL?: string;
  OPENAI_EMBEDDING_MODEL?: string;
  OPENAI_TRANSCRIPTION_MODEL?: string;
  OPENAI_VISION_MODEL?: string;
  OPENAI_TTS_MODEL?: string;
}

export interface AppEnv {
  Bindings: AppBindings;
}
