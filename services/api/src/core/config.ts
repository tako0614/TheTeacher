/**
 * Centralized configuration for the API service.
 * All magic numbers and configurable values should be defined here.
 */

import type { AppBindings } from "./types";

// --- AI & LLM Configuration ---

export const AI_CONFIG = {
  /** Default max tokens for OpenAI completions */
  DEFAULT_MAX_TOKENS: 1100,
  /** Max tokens for material generation */
  MATERIAL_GENERATE_MAX_TOKENS: 1300,
  /** Max tokens for generation tasks */
  GENERATION_MAX_TOKENS: 1100,
  /** Default temperature for completions */
  DEFAULT_TEMPERATURE: 0.7,
} as const;

// --- File Processing Configuration ---

export const FILE_CONFIG = {
  /** Maximum number of PDF pages to process */
  MAX_PDF_PAGES: 8,
  /** Maximum number of pages to scan for PDF preview */
  MAX_PDF_PREVIEW_PAGES: 10,
  /** Maximum size for media files in bytes (25MB) */
  MAX_MEDIA_BYTES: 25 * 1024 * 1024,
  /** Maximum size for text content in bytes (6MB) */
  MAX_TEXT_BYTES: 6 * 1024 * 1024,
  /** Maximum characters for extracted text */
  MAX_EXTRACTED_TEXT_CHARS: 16_000,
  /** Maximum characters for HTML summary */
  MAX_HTML_SUMMARY_CHARS: 24_000,
} as const;

// --- Semantic Search Configuration ---

export const SEMANTIC_CONFIG = {
  /** Maximum number of semantic nodes to store per user */
  SEMANTIC_NODE_LIMIT: 600,
  /** Minimum score threshold for semantic matches */
  MIN_SCORE_THRESHOLD: 0.35,
  /** Default number of top results to return */
  DEFAULT_TOP_K: 5,
  /** Maximum top K for searches */
  MAX_TOP_K: 20,
} as const;

// --- Text Processing Configuration ---

export const TEXT_CONFIG = {
  /** Default chunk size for text splitting */
  DEFAULT_CHUNK_SIZE: 500,
  /** Maximum characters for preview snippets */
  MAX_PREVIEW_CHARS: 500,
  /** Maximum characters for summary display */
  MAX_SUMMARY_CHARS: 200,
} as const;

// --- Rate Limiting Configuration ---

export const RATE_LIMIT_CONFIG = {
  /** AI generation endpoint limits */
  AI_GENERATION: { maxRequests: 20, windowSeconds: 60 },
  /** AI embedding endpoint limits */
  AI_EMBED: { maxRequests: 30, windowSeconds: 60 },
  /** AI chat endpoint limits */
  AI_CHAT: { maxRequests: 30, windowSeconds: 60 },
  /** Semantic search limits */
  SEARCH: { maxRequests: 60, windowSeconds: 60 },
  /** General API endpoint limits */
  GENERAL: { maxRequests: 120, windowSeconds: 60 },
} as const;

// --- Database Configuration ---

export const DB_CONFIG = {
  /** Default query limit */
  DEFAULT_LIMIT: 50,
  /** Maximum query limit */
  MAX_LIMIT: 100,
  /** Default page size for pagination */
  DEFAULT_PAGE_SIZE: 20,
} as const;

// --- Cache Configuration ---

export const CACHE_CONFIG = {
  /** Cache TTL for static assets in seconds */
  STATIC_ASSET_TTL: 31536000, // 1 year
  /** Cache TTL for user data in seconds */
  USER_DATA_TTL: 60,
  /** Cache TTL for embeddings in seconds */
  EMBEDDING_CACHE_TTL: 300, // 5 minutes
} as const;

/**
 * Get configuration value with optional environment override.
 * Environment variable names are auto-generated from the config path.
 */
export const getConfig = <T extends number | string>(
  defaultValue: T,
  envKey?: string,
  env?: AppBindings,
): T => {
  if (!envKey || !env) return defaultValue;

  const envValue = (env as Record<string, unknown>)[envKey];
  if (envValue === undefined || envValue === null) return defaultValue;

  if (typeof defaultValue === "number") {
    const parsed = Number(envValue);
    return (Number.isFinite(parsed) ? parsed : defaultValue) as T;
  }

  return String(envValue) as T;
};
