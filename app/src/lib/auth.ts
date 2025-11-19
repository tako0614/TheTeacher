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

export type BootstrapSessionResponse = {
  token: string;
  user: {
    id: string;
    displayName?: string;
    email?: string;
  };
};

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL?.replace(/\/+$/, "") ?? "http://127.0.0.1:8787";

export const bootstrapAnonymousSession = async (): Promise<BootstrapSessionResponse> => {
  const res = await fetch(`${API_BASE_URL}/api/auth/anonymous`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      deviceName: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 80) : "desktop",
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Failed to bootstrap session: ${text}`);
  }
  const json = (await res.json()) as BootstrapSessionResponse;
  persistSessionToken(json.token);
  return json;
};

export const ensureSessionToken = async () => {
  const existing = readSessionToken();
  if (existing) return existing;
  const { token } = await bootstrapAnonymousSession();
  return token;
};
