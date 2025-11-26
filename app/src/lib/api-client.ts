import type {
  AuthSessionResponse,
  GeneratedContent,
  Learning,
  Material,
  MaterialLibraryEntry,
  PracticeSession,
  Preset,
  UpdateUserProfileRequest,
  User,
  UserSession,
  type GenerateFromMaterialRequest,
  type GenerationResult,
  type MaterialIngestRequest,
  type MaterialIngestResult,
} from "@theteacher/shared";

import { persistSessionToken } from "./auth";
import { requestJson } from "./http";

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

export type AuthSessionState = {
  user: User;
  session: UserSession | null;
};

export const fetchAuthSession = async (): Promise<AuthSessionState> =>
  requestJson<AuthSessionState>({ path: "/api/auth/session" });

export const issueSession = async (deviceName?: string): Promise<AuthSessionResponse> => {
  const response = await requestJson<AuthSessionResponse>({
    path: "/api/auth/sessions",
    method: "POST",
    body: { deviceName },
  });
  persistSessionToken(response.token);
  return response;
};

export const updateUserProfile = async (input: UpdateUserProfileRequest) =>
  requestJson<{ user: User }>({
    path: "/api/auth/profile",
    method: "PUT",
    body: input,
  });

export const fetchLearnings = async (params: {
  q?: string;
  subject?: string;
  tag?: string;
  limit?: number;
}) => {
  const { items } = await requestJson<{ items: LearningSummary[] }>({
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
  requestJson<LearningSummary | null>({ path: `/api/learnings/${id}` });

export const createLearning = async (
  input: Pick<Learning, "title"> &
    Partial<Pick<Learning, "subject" | "tags" | "progress" | "id" | "createdAt" | "updatedAt">>,
) => requestJson<LearningSummary>({ path: "/api/learnings", method: "POST", body: input });

export const updateLearning = async (id: string, input: Partial<Learning>) =>
  requestJson<LearningSummary>({
    path: `/api/learnings/${id}`,
    method: "PUT",
    body: input,
  });

export const deleteLearning = async (id: string) =>
  requestJson<{ ok: boolean }>({ path: `/api/learnings/${id}`, method: "DELETE" });

export const fetchMaterials = async (learningId: string) =>
  requestJson<{ items: Material[] }>({ path: `/api/learnings/${learningId}/materials` });

export const fetchMaterialLibrary = async (params?: {
  learningId?: string;
  limit?: number;
}) => {
  const { items } = await requestJson<{ items: MaterialLibraryEntry[] }>({
    path: "/api/materials/library",
    query: { learningId: params?.learningId, limit: params?.limit },
  });
  return items;
};

export const ingestMaterial = async (
  input: MaterialIngestRequest & { learningId: string },
) =>
  requestJson<MaterialIngestResult>({
    path: "/api/materials/ingest",
    method: "POST",
    body: input,
  });

export const createMaterial = async (
  input: Omit<Material, "id" | "createdAt" | "updatedAt"> &
    Partial<Pick<Material, "id" | "createdAt" | "updatedAt">>,
) => requestJson<Material>({ path: "/api/materials", method: "POST", body: input });

export const updateMaterial = async (
  id: string,
  input: Partial<Omit<Material, "id" | "learningId">>,
) =>
  requestJson<Material>({
    path: `/api/materials/${id}`,
    method: "PUT",
    body: input,
  });

export const deleteMaterial = async (id: string) =>
  requestJson<{ ok: boolean }>({ path: `/api/materials/${id}`, method: "DELETE" });

export const fetchContents = async (learningId: string) =>
  requestJson<{ items: GeneratedContent[] }>({
    path: `/api/learnings/${learningId}/contents`,
  });

export const generateFromMaterial = async (input: GenerateFromMaterialRequest) =>
  requestJson<GenerationResult>({
    path: "/api/generate/from-material",
    method: "POST",
    body: input,
  });

export const createContent = async (
  input: Omit<GeneratedContent, "id" | "createdAt"> &
    Partial<Pick<GeneratedContent, "id" | "createdAt">>,
) => requestJson<GeneratedContent>({ path: "/api/contents", method: "POST", body: input });

export const requestTtsGeneration = async (generatedContentId: string) =>
  requestJson<{ status: string }>({
    path: "/api/tts/generate",
    method: "POST",
    body: { generatedContentId },
  });

export const fetchSessions = async (learningId: string) =>
  requestJson<{ items: PracticeSession[] }>({
    path: `/api/learnings/${learningId}/sessions`,
  });

export const createSession = async (
  input: Omit<PracticeSession, "id" | "createdAt"> &
    Partial<Pick<PracticeSession, "id" | "createdAt">>,
) => requestJson<PracticeSession>({ path: "/api/sessions", method: "POST", body: input });

export const fetchPresets = async (params?: { subject?: string; limit?: number }) => {
  const { items } = await requestJson<{ items: Preset[] }>({
    path: "/api/presets",
    query: { subject: params?.subject, limit: params?.limit },
  });
  return items;
};

export const createPreset = async (
  input: Omit<Preset, "id" | "createdAt" | "updatedAt"> &
    Partial<Pick<Preset, "id" | "createdAt" | "updatedAt">>,
) => requestJson<Preset>({ path: "/api/presets", method: "POST", body: input });

export const updatePreset = async (id: string, input: Partial<Preset>) =>
  requestJson<Preset>({ path: `/api/presets/${id}`, method: "PUT", body: input });

export const deletePreset = async (id: string) =>
  requestJson<{ ok: boolean }>({ path: `/api/presets/${id}`, method: "DELETE" });

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
