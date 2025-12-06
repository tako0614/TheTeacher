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
  GenerateFromMaterialRequest,
  GenerationResult,
  MaterialIngestRequest,
  MaterialIngestResult,
  IngestJob,
} from "@theteacher/shared";

import { persistSessionToken } from "./auth";
import { requestJson } from "./http";
import { mockApi } from "./mock-api";
import { logger } from "./logger";
import type {
  LearningSummary,
  SnapshotPayload,
  AuthSessionState,
  BillingPricing,
} from "./types";
import { recordMockFallback, shouldPreferMock } from "./mock-mode";

const withMockFallback = async <T>(
  label: string,
  primary: () => Promise<T>,
  fallback: () => Promise<T>,
): Promise<T> => {
  if (shouldPreferMock()) {
    recordMockFallback(label, undefined, "prefer_mock");
    return fallback();
  }

  try {
    return await primary();
  } catch (error) {
    logger.warn(`${label} failed, using mock data`, "ApiClient", error);
    recordMockFallback(label, error);
    return fallback();
  }
};

export const fetchAuthSession = async (): Promise<AuthSessionState> =>
  withMockFallback(
    "fetchAuthSession",
    () => requestJson<AuthSessionState>({ path: "/api/auth/session" }),
    () => mockApi.fetchAuthSession(),
  );

export const loginWithGoogle = async (idToken: string, deviceName?: string) =>
  withMockFallback(
    "loginWithGoogle",
    () =>
      requestJson<AuthSessionResponse>({
        path: "/api/auth/google",
        method: "POST",
        body: { idToken, deviceName },
      }),
    () => mockApi.issueSession(),
  );

export const fetchBillingPricing = async (): Promise<BillingPricing> =>
  withMockFallback(
    "fetchBillingPricing",
    async () => {
      const { pricing } = await requestJson<{ pricing: BillingPricing }>({
        path: "/api/billing/pricing",
      });
      return pricing;
    },
    () => mockApi.fetchBillingPricing(),
  );

export const fetchBillingBalance = async (): Promise<{ credits: number }> =>
  withMockFallback(
    "fetchBillingBalance",
    () => requestJson<{ credits: number }>({ path: "/api/billing/balance" }),
    () => mockApi.fetchBillingBalance(),
  );

export const createBillingCheckout = async (input: {
  quantity?: number;
  successUrl: string;
  cancelUrl: string;
}) =>
  withMockFallback(
    "createBillingCheckout",
    () =>
      requestJson<{ url?: string; sessionId?: string }>({
        path: "/api/billing/checkout",
        method: "POST",
        body: {
          quantity: input.quantity ?? 1,
          successUrl: input.successUrl,
          cancelUrl: input.cancelUrl,
        },
      }),
    () => mockApi.createBillingCheckout(input),
  );

export const issueSession = async (deviceName?: string): Promise<AuthSessionResponse> => {
  const response = await withMockFallback(
    "issueSession",
    () =>
      requestJson<AuthSessionResponse>({
        path: "/api/auth/sessions",
        method: "POST",
        body: { deviceName },
      }),
    () => mockApi.issueSession(),
  );
  persistSessionToken(response.token);
  return response;
};

export const updateUserProfile = async (input: UpdateUserProfileRequest) =>
  withMockFallback(
    "updateUserProfile",
    () =>
      requestJson<{ user: User }>({
        path: "/api/auth/profile",
        method: "PUT",
        body: input,
      }),
    () => mockApi.updateUserProfile(input),
  );

export const fetchLearnings = async (params: {
  q?: string;
  subject?: string;
  tag?: string;
  limit?: number;
}) => {
  return withMockFallback(
    "fetchLearnings",
    async () => {
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
    },
    () => mockApi.fetchLearnings(params),
  );
};

export const fetchLearning = async (id: string) =>
  withMockFallback(
    "fetchLearning",
    () => requestJson<LearningSummary | null>({ path: `/api/learnings/${id}` }),
    () => mockApi.fetchLearning(id),
  );

export const createLearning = async (
  input: Pick<Learning, "title"> &
    Partial<Pick<Learning, "subject" | "tags" | "progress" | "id" | "createdAt" | "updatedAt">>,
) =>
  withMockFallback(
    "createLearning",
    () => requestJson<LearningSummary>({ path: "/api/learnings", method: "POST", body: input }),
    () => mockApi.createLearning(input),
  );

export const updateLearning = async (id: string, input: Partial<Learning>) =>
  withMockFallback(
    "updateLearning",
    () =>
      requestJson<LearningSummary>({
        path: `/api/learnings/${id}`,
        method: "PUT",
        body: input,
      }),
    () => mockApi.updateLearning(id, input),
  );

export const deleteLearning = async (id: string) =>
  withMockFallback(
    "deleteLearning",
    () => requestJson<{ ok: boolean }>({ path: `/api/learnings/${id}`, method: "DELETE" }),
    () => mockApi.deleteLearning(id),
  );

export const fetchMaterial = async (id: string) =>
  withMockFallback(
    "fetchMaterial",
    () => requestJson<Material | null>({ path: `/api/materials/${id}` }),
    () => mockApi.fetchMaterial(id),
  );

export const fetchMaterials = async (learningId: string) =>
  withMockFallback(
    "fetchMaterials",
    () => requestJson<{ items: Material[] }>({ path: `/api/learnings/${learningId}/materials` }),
    async () => ({ items: await mockApi.fetchMaterials(learningId) }),
  );

export const fetchMaterialLibrary = async (params?: {
  learningId?: string;
  limit?: number;
}) => {
  return withMockFallback(
    "fetchMaterialLibrary",
    async () => {
      const { items } = await requestJson<{ items: MaterialLibraryEntry[] }>({
        path: "/api/materials/library",
        query: { learningId: params?.learningId, limit: params?.limit },
      });
      return items;
    },
    () => mockApi.fetchMaterialLibrary(params),
  );
};

export const fetchIngestJobs = async (params?: { learningId?: string; limit?: number }) =>
  withMockFallback(
    "fetchIngestJobs",
    async () => {
      const result = await requestJson<{ items: IngestJob[]; count: number }>({
        path: "/api/ingest-jobs",
        query: { learningId: params?.learningId, limit: params?.limit },
      });
      return result;
    },
    () => mockApi.fetchIngestJobs(params),
  );

export const ingestMaterial = async (
  input: MaterialIngestRequest & { learningId: string },
) =>
  withMockFallback(
    "ingestMaterial",
    () =>
      requestJson<MaterialIngestResult>({
        path: "/api/materials/ingest",
        method: "POST",
        body: input,
      }),
    () => mockApi.ingestMaterial(input),
  );

export const createMaterial = async (
  input: Omit<Material, "id" | "createdAt" | "updatedAt"> &
    Partial<Pick<Material, "id" | "createdAt" | "updatedAt">>,
) =>
  withMockFallback(
    "createMaterial",
    () => requestJson<Material>({ path: "/api/materials", method: "POST", body: input }),
    () => mockApi.createMaterial(input),
  );

export const updateMaterial = async (
  id: string,
  input: Partial<Omit<Material, "id" | "learningId">>,
) =>
  withMockFallback(
    "updateMaterial",
    () =>
      requestJson<Material>({
        path: `/api/materials/${id}`,
        method: "PUT",
        body: input,
      }),
    () => mockApi.updateMaterial(id, input),
  );

export const deleteMaterial = async (id: string) =>
  withMockFallback(
    "deleteMaterial",
    () => requestJson<{ ok: boolean }>({ path: `/api/materials/${id}`, method: "DELETE" }),
    () => mockApi.deleteMaterial(id),
  );

export const fetchContents = async (learningId: string) =>
  withMockFallback(
    "fetchContents",
    () =>
      requestJson<{ items: GeneratedContent[] }>({
        path: `/api/learnings/${learningId}/contents`,
      }),
    async () => ({ items: await mockApi.fetchContents(learningId) }),
  );

export const generateFromMaterial = async (input: GenerateFromMaterialRequest) =>
  withMockFallback(
    "generateFromMaterial",
    () =>
      requestJson<GenerationResult>({
        path: "/api/generate/from-material",
        method: "POST",
        body: input,
      }),
    () => mockApi.generateFromMaterial(input),
  );

export const createContent = async (
  input: Omit<GeneratedContent, "id" | "createdAt"> &
    Partial<Pick<GeneratedContent, "id" | "createdAt">>,
) =>
  withMockFallback(
    "createContent",
    () => requestJson<GeneratedContent>({ path: "/api/contents", method: "POST", body: input }),
    () => mockApi.createContent(input),
  );

export const deleteContent = async (id: string) =>
  withMockFallback(
    "deleteContent",
    () => requestJson<{ ok: boolean }>({ path: `/api/contents/${id}`, method: "DELETE" }),
    () => mockApi.deleteContent(id),
  );

export const requestTtsGeneration = async (generatedContentId: string) =>
  withMockFallback(
    "requestTtsGeneration",
    () =>
      requestJson<{ status: string }>({
        path: "/api/tts/generate",
        method: "POST",
        body: { generatedContentId },
      }),
    () => mockApi.requestTtsGeneration(),
  );

export const fetchSessions = async (learningId: string) =>
  withMockFallback(
    "fetchSessions",
    () =>
      requestJson<{ items: PracticeSession[] }>({
        path: `/api/learnings/${learningId}/sessions`,
      }),
    async () => ({ items: await mockApi.fetchSessions(learningId) }),
  );

export const createSession = async (
  input: Omit<PracticeSession, "id" | "createdAt"> &
    Partial<Pick<PracticeSession, "id" | "createdAt">>,
) =>
  withMockFallback(
    "createSession",
    () => requestJson<PracticeSession>({ path: "/api/sessions", method: "POST", body: input }),
    () => mockApi.createSession(input),
  );

export const fetchPresets = async (params?: { subject?: string; limit?: number }) => {
  return withMockFallback(
    "fetchPresets",
    async () => {
      const { items } = await requestJson<{ items: Preset[] }>({
        path: "/api/presets",
        query: { subject: params?.subject, limit: params?.limit },
      });
      return items;
    },
    () => mockApi.fetchPresets(params),
  );
};

export const createPreset = async (
  input: Omit<Preset, "id" | "createdAt" | "updatedAt"> &
    Partial<Pick<Preset, "id" | "createdAt" | "updatedAt">>,
) =>
  withMockFallback(
    "createPreset",
    () => requestJson<Preset>({ path: "/api/presets", method: "POST", body: input }),
    () => mockApi.createPreset(input),
  );

export const updatePreset = async (id: string, input: Partial<Preset>) =>
  withMockFallback(
    "updatePreset",
    () => requestJson<Preset>({ path: `/api/presets/${id}`, method: "PUT", body: input }),
    () => mockApi.updatePreset(id, input),
  );

export const deletePreset = async (id: string) =>
  withMockFallback(
    "deletePreset",
    () => requestJson<{ ok: boolean }>({ path: `/api/presets/${id}`, method: "DELETE" }),
    () => mockApi.deletePreset(id),
  );

export const fetchSnapshot = async (): Promise<SnapshotPayload> => {
  return withMockFallback(
    "fetchSnapshot",
    async () => {
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
    },
    () => mockApi.fetchSnapshot(),
  );
};

export const replaceSnapshot = async (snapshot: SnapshotPayload) => {
  return withMockFallback(
    "replaceSnapshot",
    async () => {
      try {
        const snapshotIds = new Set(snapshot.learnings.map((item) => item.id));

        await Promise.all(snapshot.learnings.map((learning) => createLearning(learning)));

        await Promise.all([
          ...snapshot.materials.map((material) => createMaterial(material)),
          ...snapshot.generatedContents.map((content) => createContent(content)),
          ...snapshot.practiceSessions.map((session) => createSession(session)),
        ]);

        const current = await fetchLearnings({ limit: 200 });
        const staleLearnings = current.filter((item) => !snapshotIds.has(item.id));
        await Promise.all(staleLearnings.map((item) => deleteLearning(item.id)));
      } catch (error) {
        throw new Error(
          `スナップショットの復元に失敗しました: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
      }
    },
    () => mockApi.replaceSnapshot(snapshot),
  );
};
