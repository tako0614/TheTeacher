import { ensureSessionToken, readSessionToken } from "./auth";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL?.replace(/\/+$/, "") ?? "http://127.0.0.1:8787";

const isTauri = () =>
  typeof (globalThis as { __TAURI_IPC__?: unknown }).__TAURI_IPC__ !== "undefined" ||
  typeof (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !==
    "undefined";

// ユーザーフレンドリーなエラーメッセージへの変換
const friendlyErrorMessages: Record<number, string> = {
  400: "リクエストの形式が正しくありません",
  401: "認証が必要です。再ログインしてください",
  403: "この操作を行う権限がありません",
  404: "リソースが見つかりませんでした",
  408: "リクエストがタイムアウトしました",
  429: "リクエストが多すぎます。しばらく待ってから再試行してください",
  500: "サーバーエラーが発生しました",
  502: "サーバーに接続できませんでした",
  503: "サービスが一時的に利用できません",
  504: "サーバーからの応答がタイムアウトしました",
};

export const formatApiError = (error: unknown): string => {
  if (!(error instanceof Error)) return "予期しないエラーが発生しました";
  
  const message = error.message;
  
  // ネットワークエラー
  if (message.includes("fetch") || message.includes("network") || message.includes("Failed to fetch")) {
    return "ネットワーク接続を確認してください";
  }
  
  // APIエラー（ステータスコード含む）
  const statusMatch = message.match(/API error (\d{3})/);
  if (statusMatch) {
    const status = parseInt(statusMatch[1], 10);
    const friendly = friendlyErrorMessages[status];
    if (friendly) return friendly;
    if (status >= 500) return "サーバーエラーが発生しました";
    if (status >= 400) return "リクエストに問題があります";
  }
  
  // 認証エラー
  if (message.includes("認証") || message.includes("auth") || message.includes("token")) {
    return "認証エラーが発生しました。再ログインしてください";
  }
  
  // その他：元のメッセージを短縮して返す
  return message.length > 100 ? `${message.slice(0, 100)}...` : message;
};

export interface RequestConfig {
  path: string;
  method?: "GET" | "POST" | "PUT" | "DELETE";
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
  skipAuth?: boolean;
}

const buildUrl = (path: string, query?: RequestConfig["query"]) => {
  const url = new URL(path, API_BASE_URL);
  Object.entries(query ?? {}).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    url.searchParams.set(key, String(value));
  });
  return url.toString();
};

export interface RawRequestConfig {
  path: string;
  method?: "GET" | "POST" | "PUT" | "DELETE";
  query?: Record<string, string | number | undefined>;
  body?: BodyInit | Uint8Array | ArrayBuffer | null;
  headers?: Record<string, string>;
  skipAuth?: boolean;
}

export const requestJson = async <T>(config: RequestConfig): Promise<T> => {
  let token = readSessionToken();
  if (!token && !config.skipAuth) {
    try {
      token = await ensureSessionToken();
    } catch (error) {
      throw new Error(
        `認証トークンの取得に失敗しました: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  const url = buildUrl(config.path, config.query);
  const method = config.method ?? "GET";
  const shouldAttachAuth = !config.skipAuth && Boolean(token);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(config.headers ?? {}),
    ...(shouldAttachAuth && token ? { Authorization: `Bearer ${token}` } : {}),
  };
  const body = config.body ? JSON.stringify(config.body) : undefined;

  if (isTauri()) {
    const { fetch } = await import("@tauri-apps/plugin-http");
    const response = await fetch(url, {
      method,
      headers,
      body,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => response.statusText);
      throw new Error(`API error ${response.status}: ${text}`);
    }
    return (await response.json()) as T;
  }

  const res = await fetch(url, {
    method,
    headers,
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return (await res.json()) as T;
};

export const requestRaw = async (config: RawRequestConfig): Promise<Response> => {
  let token = readSessionToken();
  if (!token && !config.skipAuth) {
    token = await ensureSessionToken();
  }

  const url = buildUrl(config.path, config.query);
  const method = config.method ?? "GET";
  const shouldAttachAuth = !config.skipAuth && Boolean(token);
  const headers: Record<string, string> = {
    ...(config.headers ?? {}),
    ...(shouldAttachAuth && token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const body =
    config.body instanceof ArrayBuffer ? new Uint8Array(config.body) : (config.body as BodyInit | null | undefined);

  if (isTauri()) {
    const { fetch } = await import("@tauri-apps/plugin-http");
    // plugin-http supports Uint8Array for binary payloads.
    return (await fetch(url, {
      method,
      headers,
      body: body as unknown as Uint8Array | string | null | undefined,
    })) as unknown as Response;
  }

  return fetch(url, {
    method,
    headers,
    body: body as BodyInit | null | undefined,
  });
};

export const http = {
  baseUrl: API_BASE_URL,
  requestJson,
  requestRaw,
};
