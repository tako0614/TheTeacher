import type {
  GeneratedContent,
  Learning,
  Material,
  PracticeSession,
} from "@theteacher/shared";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL?.replace(/\/+$/, "") ?? "http://127.0.0.1:8787";

const isTauri = () =>
  typeof (globalThis as { __TAURI_IPC__?: unknown }).__TAURI_IPC__ !== "undefined" ||
  typeof (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !==
    "undefined";

type RequestConfig = {
  path: string;
  method?: "GET" | "POST" | "PUT" | "DELETE";
  query?: Record<string, string | number | undefined>;
  body?: unknown;
};

const buildUrl = (path: string, query?: RequestConfig["query"]) => {
  const url = new URL(path, API_BASE_URL);
  Object.entries(query ?? {}).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    url.searchParams.set(key, String(value));
  });
  return url.toString();
};

const request = async <T>(config: RequestConfig): Promise<T> => {
  const url = buildUrl(config.path, config.query);
  const method = config.method ?? "GET";
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (isTauri()) {
    const { fetch, ResponseType } = await import("@tauri-apps/plugin-http");
    const response = await fetch(url, {
      method,
      headers,
      body: config.body ? JSON.stringify(config.body) : undefined,
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
    body: config.body ? JSON.stringify(config.body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return (await res.json()) as T;
};

export type LearningSummary = Learning & {
  materialsCount: number;
  generatedCount: number;
  sessionCount: number;
  lastStudiedAt?: string;
};

export type SnapshotPayload = {
  learnings: Learning[];
  materials: Material[];
  generatedContents: GeneratedContent[];
  practiceSessions: PracticeSession[];
};

export const fetchLearnings = async (params: {
  q?: string;
  subject?: string;
  tag?: string;
  limit?: number;
}) => {
  const { items } = await request<{ items: LearningSummary[] }>({
    path: "/api/learnings",
    query: {
      q: params.q,
      subject: params.subject,
      tag: params.tag,
      limit: params.limit,
    },
  });
  return items;
};

export const fetchLearning = async (id: string) =>
  request<LearningSummary | null>({ path: `/api/learnings/${id}` });

export const createLearning = async (
  input: Pick<Learning, "title"> &
    Partial<Pick<Learning, "subject" | "tags" | "progress" | "id" | "createdAt" | "updatedAt">>,
) => request<LearningSummary>({ path: "/api/learnings", method: "POST", body: input });

export const updateLearning = async (id: string, input: Partial<Learning>) =>
  request<LearningSummary>({
    path: `/api/learnings/${id}`,
    method: "PUT",
    body: input,
  });

export const deleteLearning = async (id: string) =>
  request<{ ok: boolean }>({ path: `/api/learnings/${id}`, method: "DELETE" });

export const fetchMaterials = async (learningId: string) =>
  request<{ items: Material[] }>({ path: `/api/learnings/${learningId}/materials` });

export const createMaterial = async (
  input: Omit<Material, "id" | "createdAt" | "updatedAt"> &
    Partial<Pick<Material, "id" | "createdAt" | "updatedAt">>,
) => request<Material>({ path: "/api/materials", method: "POST", body: input });

export const fetchContents = async (learningId: string) =>
  request<{ items: GeneratedContent[] }>({
    path: `/api/learnings/${learningId}/contents`,
  });

export const createContent = async (
  input: Omit<GeneratedContent, "id" | "createdAt"> &
    Partial<Pick<GeneratedContent, "id" | "createdAt">>,
) => request<GeneratedContent>({ path: "/api/contents", method: "POST", body: input });

export const fetchSessions = async (learningId: string) =>
  request<{ items: PracticeSession[] }>({
    path: `/api/learnings/${learningId}/sessions`,
  });

export const createSession = async (
  input: Omit<PracticeSession, "id" | "createdAt"> &
    Partial<Pick<PracticeSession, "id" | "createdAt">>,
) => request<PracticeSession>({ path: "/api/sessions", method: "POST", body: input });

export const fetchSnapshot = async (): Promise<SnapshotPayload> => {
  const learnings = (await fetchLearnings({ limit: 100 })).map(
    ({ materialsCount, generatedCount, sessionCount, lastStudiedAt, ...rest }) => rest,
  );
  const materials: Material[] = [];
  const generatedContents: GeneratedContent[] = [];
  const practiceSessions: PracticeSession[] = [];

  for (const learning of learnings) {
    const [materialRes, contentRes, sessionRes] = await Promise.all([
      fetchMaterials(learning.id),
      fetchContents(learning.id),
      fetchSessions(learning.id),
    ]);
    materials.push(...materialRes.items);
    generatedContents.push(...contentRes.items);
    practiceSessions.push(...sessionRes.items);
  }

  return {
    learnings,
    materials,
    generatedContents,
    practiceSessions,
  };
};

export const replaceSnapshot = async (snapshot: SnapshotPayload) => {
  const current = await fetchLearnings({ limit: 100 });
  await Promise.all(current.map((item) => deleteLearning(item.id)));

  for (const learning of snapshot.learnings) {
    await createLearning(learning);
  }
  for (const material of snapshot.materials) {
    await createMaterial(material);
  }
  for (const content of snapshot.generatedContents) {
    await createContent(content);
  }
  for (const session of snapshot.practiceSessions) {
    await createSession(session);
  }
};
