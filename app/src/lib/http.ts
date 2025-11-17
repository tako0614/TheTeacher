const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL?.replace(/\/+$/, "") ?? "http://127.0.0.1:8787";

const isTauri = () =>
  typeof (globalThis as { __TAURI_IPC__?: unknown }).__TAURI_IPC__ !== "undefined" ||
  typeof (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !==
    "undefined";

export type RequestConfig = {
  path: string;
  method?: "GET" | "POST" | "PUT" | "DELETE";
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
};

const buildUrl = (path: string, query?: RequestConfig["query"]) => {
  const url = new URL(path, API_BASE_URL);
  Object.entries(query ?? {}).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    url.searchParams.set(key, String(value));
  });
  return url.toString();
};

export const requestJson = async <T>(config: RequestConfig): Promise<T> => {
  const url = buildUrl(config.path, config.query);
  const method = config.method ?? "GET";
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(config.headers ?? {}),
  };
  const body = config.body ? JSON.stringify(config.body) : undefined;

  if (isTauri()) {
    const { fetch, ResponseType } = await import("@tauri-apps/plugin-http");
    const response = await fetch(url, {
      method,
      headers,
      body,
      responseType: ResponseType.JSON,
    });
    if (response.status >= 400) {
      throw new Error(
        `API error ${response.status}: ${
          typeof response.data === "string" ? response.data : JSON.stringify(response.data)
        }`,
      );
    }
    return (response.data as T | null) ?? (null as T);
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

export const http = {
  baseUrl: API_BASE_URL,
  requestJson,
};
