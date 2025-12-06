import type { AuthSessionResponse } from "@theteacher/shared";

const STORAGE_KEY = "theteacher/session-token";

let cachedToken: string | null = null;

const getStorage = () => (typeof localStorage === "undefined" ? null : localStorage);

export const readSessionToken = () =>
  cachedToken ??
  getStorage()?.getItem(STORAGE_KEY) ??
  (import.meta.env.VITE_API_TOKEN as string | undefined) ??
  null;

export const persistSessionToken = (token: string) => {
  cachedToken = token;
  const storage = getStorage();
  storage?.setItem(STORAGE_KEY, token);
  return token;
};

export const clearSessionToken = () => {
  cachedToken = null;
  getStorage()?.removeItem(STORAGE_KEY);
};

const buildDeviceName = (deviceName?: string) => {
  if (deviceName?.trim()) return deviceName.trim();
  return typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 80) : "desktop";
};

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL?.replace(/\/+$/, "") ?? "http://127.0.0.1:8787";

export const ensureSessionToken = async () => {
  const existing = readSessionToken();
  if (existing) return existing;
  const apiToken = import.meta.env.VITE_API_TOKEN as string | undefined;
  if (apiToken) return apiToken;
  throw new Error("Googleログインが必要です");
};

export const bootstrapAnonymousSession = async (deviceName?: string) => {
  const res = await fetch(`${API_BASE_URL}/api/auth/anonymous`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deviceName: buildDeviceName(deviceName) }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Failed to bootstrap anonymous session: ${text}`);
  }
  const json = (await res.json()) as AuthSessionResponse;
  persistSessionToken(json.token);
  return json;
};

export const exchangeGoogleIdToken = async (idToken: string, deviceName?: string) => {
  const res = await fetch(`${API_BASE_URL}/api/auth/google`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken, deviceName: buildDeviceName(deviceName) }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Googleログインに失敗しました: ${text}`);
  }
  const json = (await res.json()) as AuthSessionResponse;
  persistSessionToken(json.token);
  return json;
};
