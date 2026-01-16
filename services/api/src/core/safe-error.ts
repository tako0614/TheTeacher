/**
 * Safe error response utilities.
 * Prevents leaking internal implementation details in error messages.
 */

/** Error codes with safe client-facing messages */
const ERROR_MESSAGES: Record<string, string> = {
  // Auth errors
  unauthorized: "認証が必要です",
  invalid_token: "無効なトークンです",
  session_expired: "セッションが期限切れです",

  // Validation errors
  invalid_request: "リクエストが無効です",
  validation_failed: "入力内容を確認してください",

  // Resource errors
  not_found: "リソースが見つかりません",
  learning_not_found: "学習コンテンツが見つかりません",
  material_not_found: "教材が見つかりません",
  content_not_found: "コンテンツが見つかりません",

  // Operation errors
  db_not_configured: "サービスが一時的に利用できません",
  rate_limit_exceeded: "リクエスト制限を超えました。しばらく待ってから再試行してください",

  // AI/Processing errors
  generation_failed: "生成処理に失敗しました",
  embedding_failed: "処理に失敗しました",
  openai_error: "AI処理に失敗しました",
  tool_failed: "処理中にエラーが発生しました",
  proxy_failed: "処理に失敗しました",

  // File errors
  file_too_large: "ファイルが大きすぎます",
  invalid_file_type: "サポートされていないファイル形式です",
  upload_failed: "アップロードに失敗しました",

  // Generic
  internal_error: "内部エラーが発生しました",
  unknown_error: "エラーが発生しました",
};

/**
 * Get a safe client-facing error message.
 * @param errorCode The error code
 * @param fallback Optional fallback message
 */
export const getSafeErrorMessage = (errorCode: string, fallback?: string): string => {
  return ERROR_MESSAGES[errorCode] ?? fallback ?? ERROR_MESSAGES.unknown_error;
};

/**
 * Create a safe error response object.
 * Logs the full error server-side but returns a safe message to the client.
 * @param errorCode The error code to return
 * @param internalError The actual error (for logging)
 * @param context Additional context for logging
 */
export const createSafeErrorResponse = (
  errorCode: string,
  internalError?: unknown,
  context?: string,
): { error: string; message: string } => {
  // Log the full error server-side
  if (internalError) {
    const errorDetail = internalError instanceof Error ? internalError.message : String(internalError);
    console.error(`[${context ?? errorCode}] ${errorDetail}`, internalError);
  }

  return {
    error: errorCode,
    message: getSafeErrorMessage(errorCode),
  };
};

/**
 * Check if an error message is safe to expose to clients.
 * Only Japanese messages or known safe codes are allowed.
 */
export const isSafeErrorMessage = (message: string): boolean => {
  // Allow Japanese messages (user-facing)
  if (/^[\u3000-\u9FFF\uFF00-\uFFEF\s。、！？・（）「」0-9a-zA-Z]+$/.test(message)) {
    return true;
  }

  // Block messages that look like internal errors
  const unsafePatterns = [
    /api[_-]?key/i,
    /token/i,
    /secret/i,
    /password/i,
    /credential/i,
    /stack\s*trace/i,
    /at\s+\w+\s*\(/i,  // Stack trace lines
    /\/\w+\/\w+\.ts/i, // File paths
    /error:\s*\d+/i,   // Error codes with numbers
  ];

  return !unsafePatterns.some(pattern => pattern.test(message));
};

/**
 * Sanitize an error message for client response.
 * Returns the message if safe, otherwise returns a generic message.
 */
export const sanitizeErrorMessage = (message: string, errorCode?: string): string => {
  if (isSafeErrorMessage(message)) {
    return message;
  }
  return getSafeErrorMessage(errorCode ?? "unknown_error");
};
