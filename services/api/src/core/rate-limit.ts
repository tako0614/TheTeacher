/**
 * Simple in-memory rate limiter for Cloudflare Workers.
 * Uses a sliding window algorithm with Map-based storage.
 * Note: In a multi-instance deployment, consider using KV or Durable Objects.
 */

interface RateLimitConfig {
  /** Maximum number of requests allowed in the window */
  maxRequests: number;
  /** Window size in seconds */
  windowSeconds: number;
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

// In-memory store for rate limiting
// This works well for single-instance Workers; for multi-region, use KV
const rateLimitStore = new Map<string, RateLimitEntry>();

// Clean up expired entries periodically
const cleanupExpired = () => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore) {
    if (entry.resetAt < now) {
      rateLimitStore.delete(key);
    }
  }
};

// Run cleanup every 60 seconds
let cleanupInterval: ReturnType<typeof setInterval> | null = null;
const ensureCleanup = () => {
  if (!cleanupInterval) {
    cleanupInterval = setInterval(cleanupExpired, 60_000);
  }
};

/**
 * Check if a request should be rate limited.
 * @param key Unique identifier for the rate limit (e.g., "ai:userId")
 * @param config Rate limit configuration
 * @returns Object with allowed status and remaining requests
 */
export const checkRateLimit = (
  key: string,
  config: RateLimitConfig,
): { allowed: boolean; remaining: number; resetAt: number } => {
  ensureCleanup();

  const now = Date.now();
  const windowMs = config.windowSeconds * 1000;

  const entry = rateLimitStore.get(key);

  // No existing entry or expired entry
  if (!entry || entry.resetAt < now) {
    const resetAt = now + windowMs;
    rateLimitStore.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: config.maxRequests - 1, resetAt };
  }

  // Within window
  if (entry.count >= config.maxRequests) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  // Increment counter
  entry.count += 1;
  return {
    allowed: true,
    remaining: config.maxRequests - entry.count,
    resetAt: entry.resetAt
  };
};

/**
 * Rate limit configurations for different endpoint types
 */
export const RATE_LIMITS = {
  /** AI generation endpoints - more expensive */
  aiGeneration: { maxRequests: 20, windowSeconds: 60 },
  /** AI embedding endpoints */
  aiEmbed: { maxRequests: 30, windowSeconds: 60 },
  /** AI chat endpoints */
  aiChat: { maxRequests: 30, windowSeconds: 60 },
  /** Semantic search */
  search: { maxRequests: 60, windowSeconds: 60 },
  /** General API endpoints */
  general: { maxRequests: 120, windowSeconds: 60 },
} as const;

/**
 * Create a rate limit key from user ID and endpoint type
 */
export const createRateLimitKey = (userId: string, endpointType: keyof typeof RATE_LIMITS): string => {
  return `${endpointType}:${userId}`;
};
