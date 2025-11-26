import type { Prisma } from "@prisma/client/edge";
import type {
  GeneratedContent,
  Learning,
  Material,
  PracticeGradingRequest,
  PracticeGradingResponse,
} from "@theteacher/shared";
import { schemas } from "@theteacher/shared";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { GeneratedContentRow, MaterialRow, PracticeSessionRow, PresetRow } from "./db";
import {
  app,
  attachEmbeddingsToChunks,
  authSessionResponseSchema,
  bootstrapSessionRequestSchema,
  buildFallbackFeedback,
  buildGenerationJob,
  buildIngestJob,
  buildLibraryAssetPayload,
  buildLibraryEntryRecord,
  buildLearningTagsFromPrompt,
  buildLearningTitleFromPrompt,
  buildProxyActionsPayload,
  buildProxyFallbackMessage,
  callOpenAiProxyChat,
  chunkMaterialText,
  cloneIngestJob,
  createSession,
  createUser,
  DEFAULT_USER_DISPLAY_NAME,
  deleteLibraryAssetsForMaterial,
  deleteSemanticNodesByRef,
  determineGenerationTypes,
  embedRequestSchema,
  ensureMaterialTables,
  ensureUserTables,
  enqueueIngestJobProcessing,
  executeToolCall,
  extractMaterialFromSource,
  fetchIngestJob,
  fetchLearning,
  fetchLibraryAsset,
  fetchLibraryEntryById,
  fetchMaterial,
  fetchPreset,
  fetchUserByEmail,
  generateContentsFromMaterial,
  generateEmbeddings,
  generateFromMaterialRequestSchema,
  getPrismaClient,
  gradeWithOpenAi,
  ingestJobListQuerySchema,
  ingestMaterialRequestSchema,
  insertLearning,
  isUuid,
  issueSessionRequestSchema,
  learningListQuerySchema,
  libraryEntryListQuerySchema,
  listIngestJobs,
  listLearnings,
  listLibraryEntries,
  mapGeneratedContent,
  mapMaterial,
  mapPracticeSession,
  mapPreset,
  materialIngestResultSchema,
  nowIso,
  prepareJobForProcessing,
  presetListQuerySchema,
  PREPROCESS_STEP_KINDS,
  practiceGradingRequestSchema,
  proxyRequestSchema,
  requireAuth,
  resolveMaterialForGeneration,
  resolvePresetContext,
  sanitizeFileNameForHeader,
  saveGeneratedContent,
  saveIngestJob,
  saveLibraryAsset,
  saveLibraryEntry,
  searchSemantic,
  semanticSearchRequestSchema,
  serializeMatchesForClient,
  shouldCreateLearningFromPrompt,
  summarizeText,
  toEmbedding,
  toolCallSchema,
  ToolCallError,
  updateLearningProgress,
  updateLearningSchema,
  updateMaterialSchema,
  updatePresetSchema,
  updateUserProfile,
  updateUserProfileRequestSchema,
  upsertGeneratedSchema,
  upsertLearningSchema,
  upsertMaterialSchema,
  upsertPresetSchema,
  upsertSessionSchema,
  detectSubjectFromPrompt,
  indexLearningSemanticNode,
  indexMaterialSemanticNode,
  indexPracticeQuestionSemanticNode,
} from "./api-core";
import type { ProxyResponseContext, SemanticMatch } from "./api-core";

app.get("/health", (c) => {
  return c.json({ status: "ok" });
});

app.post("/api/auth/anonymous", async (c) => {
  const db = c.env.DB;
  if (!db) return c.json({ error: "db_not_configured" }, 503);
  const body = await c.req.json().catch(() => ({}));
  const parsed = bootstrapSessionRequestSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return c.json({ error: "invalid_request", issues: parsed.error.format() }, 400);
  }
  const input = parsed.data;
  await ensureUserTables(db);
  const existing = input.email ? await fetchUserByEmail(db, input.email) : null;
  const user =
    existing ??
    (await createUser(db, {
      email: input.email,
      displayName: input.displayName ?? input.email ?? DEFAULT_USER_DISPLAY_NAME,
    }));
  const { session, token } = await createSession(db, user.id, input.deviceName);
  return c.json(authSessionResponseSchema.parse({ user, session, token }), 201);
});

app.get("/api/auth/session", async (c) => {
  const auth = requireAuth(c);
  return c.json({ user: auth.user, session: auth.session ?? null });
});

app.put("/api/auth/profile", async (c) => {
  const db = c.env.DB;
  if (!db) return c.json({ error: "db_not_configured" }, 503);
  const auth = requireAuth(c);
  const body = await c.req.json().catch(() => ({}));
  const parsed = updateUserProfileRequestSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return c.json({ error: "invalid_request", issues: parsed.error.format() }, 400);
  }
  const input = parsed.data;
  if (!input.email && !input.displayName) {
    return c.json({ error: "invalid_request", message: "email or displayName is required" }, 400);
  }
  try {
    const user = await updateUserProfile(db, auth.user.id, input);
    return c.json({ user });
  } catch (error) {
    if (error instanceof ToolCallError) {
      const status = error.status as ContentfulStatusCode;
      return c.json({ error: error.code, message: error.message }, status);
    }
    throw error;
  }
});

app.post("/api/auth/sessions", async (c) => {
  const db = c.env.DB;
  if (!db) return c.json({ error: "db_not_configured" }, 503);
  const auth = requireAuth(c);
  const body = await c.req.json().catch(() => ({}));
  const parsed = issueSessionRequestSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return c.json({ error: "invalid_request", issues: parsed.error.format() }, 400);
  }
  const { session, token } = await createSession(db, auth.user.id, parsed.data.deviceName);
  return c.json(authSessionResponseSchema.parse({ user: auth.user, session, token }), 201);
});

app.get("/api/learnings", async (c) => {
  const { user } = requireAuth(c);
  const query = Object.fromEntries(new URL(c.req.url).searchParams);
  const parsed = learningListQuerySchema.safeParse(query);
  if (!parsed.success) {
    return c.json({ error: "invalid_query", issues: parsed.error.format() }, 400);
  }

  const items = await listLearnings(c.env.DB, parsed.data, user.id);
  return c.json({ items, count: items.length });
});

app.get("/api/learnings/:id", async (c) => {
  const id = c.req.param("id");
  const { user } = requireAuth(c);
  const learning = await fetchLearning(c.env.DB, id, user.id);
  if (!learning) return c.json({ error: "not_found" }, 404);
  return c.json(learning);
});

app.post("/api/learnings", async (c) => {
  const { user } = requireAuth(c);
  const body = await c.req.json().catch(() => null);
  const parsed = upsertLearningSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_request", issues: parsed.error.format() }, 400);
  }

  const learning = await insertLearning(c.env.DB, parsed.data, user.id, c.env);
  return c.json(learning, 201);
});

app.put("/api/learnings/:id", async (c) => {
  const id = c.req.param("id");
  const { user } = requireAuth(c);
  const body = await c.req.json().catch(() => null);
  const parsed = updateLearningSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_request", issues: parsed.error.format() }, 400);
  }

  const exists = await fetchLearning(c.env.DB, id, user.id);
  if (!exists) return c.json({ error: "not_found" }, 404);

  const data = parsed.data;
  const updatedAt = data.updatedAt ?? nowIso();
  const prisma = getPrismaClient(c.env.DB);
  await prisma.learning.update({
    where: { id },
    data: {
      title: data.title ?? undefined,
      subject: data.subject ?? undefined,
      tags: (data.tags as unknown as Prisma.JsonValue) ?? undefined,
      progress: data.progress ?? undefined,
      updatedAt,
    },
  });

  const learning = await fetchLearning(c.env.DB, id, user.id);
  if (learning) {
    await indexLearningSemanticNode(c.env.DB, c.env, learning);
  }
  return c.json(learning);
});

app.delete("/api/learnings/:id", async (c) => {
  const id = c.req.param("id");
  const { user } = requireAuth(c);
  const prisma = getPrismaClient(c.env.DB);
  const materialRows = await prisma.material.findMany({
    where: { learningId: id, userId: user.id },
    select: { id: true },
  });
  const generatedRows = await prisma.generatedContent.findMany({
    where: { learningId: id, userId: user.id },
    select: { id: true },
  });
  const practiceRows = await prisma.practiceSession.findMany({
    where: { learningId: id, userId: user.id },
    select: { id: true },
  });
  await prisma.practiceSession.deleteMany({ where: { learningId: id, userId: user.id } });
  await prisma.learning.deleteMany({ where: { id, userId: user.id } });
  const materialIds = materialRows.map((row) => row.id);
  const generatedIds = generatedRows.map((row) => row.id);
  const practiceIds = practiceRows.map((row) => row.id);
  await deleteSemanticNodesByRef(c.env.DB, "learning", [id], user.id);
  await deleteSemanticNodesByRef(c.env.DB, "material", materialIds, user.id);
  await deleteSemanticNodesByRef(c.env.DB, "generated_content", generatedIds, user.id);
  await deleteSemanticNodesByRef(c.env.DB, "question", practiceIds, user.id);
  return c.json({ ok: true });
});

app.get("/api/learnings/:id/materials", async (c) => {
  const id = c.req.param("id");
  const { user } = requireAuth(c);
  const prisma = getPrismaClient(c.env.DB);
  const rows = await prisma.material.findMany({
    where: { learningId: id, userId: user.id },
    orderBy: { createdAt: "desc" },
  });
  const items = rows.map((row) => mapMaterial(row as unknown as MaterialRow));
  return c.json({ items });
});

app.post("/api/materials/ingest", async (c) => {
  const { user } = requireAuth(c);
  const body = await c.req.json().catch(() => null);
  const parsed = ingestMaterialRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_request", issues: parsed.error.format() }, 400);
  }

  const request = parsed.data;
  const learning = await fetchLearning(c.env.DB, request.learningId, user.id);
  if (!learning) return c.json({ error: "learning_not_found" }, 404);
  const prisma = getPrismaClient(c.env.DB);

  const requiresBinaryPayload = Boolean(request.payload?.dataUrl);
  const needsOcr = request.source.kind === "image" || request.source.kind === "pdf";
  const needsTranscription = request.source.kind === "audio" || request.source.kind === "video";
  const shouldDeferExtraction = requiresBinaryPayload && (needsOcr || needsTranscription);

  let extractedResult:
    | Awaited<ReturnType<typeof extractMaterialFromSource>>
    | undefined;
  if (!shouldDeferExtraction) {
    try {
      extractedResult = await extractMaterialFromSource(
        request.source,
        request.preferOffline ?? false,
        request.payload,
        c.env,
      );
    } catch (error) {
      console.error("material ingest failed", error);
      return c.json(
        {
          error: "material_ingest_failed",
          message: error instanceof Error ? error.message : "素材の解析に失敗しました。",
        },
        500,
      );
    }
    if (!extractedResult) {
      return c.json(
        { error: "material_ingest_failed", message: "素材の解析に失敗しました。" },
        500,
      );
    }
  }
  const rawContent = extractedResult?.rawContent ?? null;
  const extracted = extractedResult?.extracted;
  const ingestMetadata = extractedResult?.metadata;
  const id = crypto.randomUUID();
  const libraryEntryId = crypto.randomUUID();
  const createdAt = nowIso();
  const updatedAt = createdAt;
  const type = request.source.kind as Material["type"];
  const assetPayload = buildLibraryAssetPayload(request.payload);
  let assetUpload: Awaited<ReturnType<typeof saveLibraryAsset>> | null = null;
  if (assetPayload) {
    try {
      assetUpload = await saveLibraryAsset(c.env.DB, libraryEntryId, assetPayload);
    } catch (error) {
      console.error("material asset upload failed", error);
      return c.json(
        {
          error: "asset_upload_failed",
          message: error instanceof Error ? error.message : "教材ファイルの保存に失敗しました。",
        },
        500,
      );
    }
  }
  const assetPath = assetUpload?.publicPath;
  const sourcePath =
    request.source.kind === "url"
      ? request.source.url
      : request.source.kind === "text"
        ? summarizeText(request.source.text, 120)
        : request.source.path;
  const materialMetadata = {
    ingestSource: request.source,
    preferOffline: request.preferOffline ?? false,
    extracted,
    origin: ingestMetadata?.sourceLabel,
    libraryEntryId,
    payloadFileName: request.payload?.fileName,
    payloadBytes: request.payload?.bytes ?? assetPayload?.size,
    payloadMimeType: request.payload?.mimeType ?? assetPayload?.mimeType,
    payloadEncoding: request.payload?.dataUrl
      ? "binary"
      : request.payload?.text
        ? "text"
        : undefined,
    storageKey: assetUpload?.key,
    previewUrl: assetPath,
    libraryAssetId: assetPayload ? libraryEntryId : undefined,
  };

  await prisma.material.upsert({
    where: { id },
    create: {
      id,
      userId: user.id,
      learningId: request.learningId,
      type,
      sourcePath: sourcePath ?? null,
      rawContent: rawContent ?? null,
      metadata: materialMetadata as unknown as Prisma.JsonValue,
      createdAt,
      updatedAt,
    },
    update: {
      type,
      sourcePath: sourcePath ?? null,
      rawContent: rawContent ?? null,
      metadata: materialMetadata as unknown as Prisma.JsonValue,
      updatedAt,
    },
  });

  const material =
    (await fetchMaterial(c.env.DB, id, user.id)) ??
    ({
      id,
      userId: user.id,
      learningId: request.learningId,
      type,
      sourcePath: sourcePath ?? undefined,
      rawContent: rawContent ?? undefined,
      metadata: materialMetadata,
      createdAt,
      updatedAt,
    } as Material);

  const libraryEntry = await saveLibraryEntry(
    c.env.DB,
    buildLibraryEntryRecord(material, request, {
      entryId: libraryEntryId,
      notes: ingestMetadata?.sourceLabel,
      assetPath,
      storageKey: assetUpload?.key,
      bytesOverride: assetPayload?.size,
    }),
    user.id,
  );
  const jobDraft = prepareJobForProcessing(
    buildIngestJob(
      request,
      "processing",
      material.id,
      libraryEntry.libraryPath ?? libraryEntry.storedPath,
    ),
  );
  const job = await saveIngestJob(c.env.DB, { ...jobDraft, outputMaterialId: material.id }, user.id);
  const hasPipelineWork = job.steps.some(
    (step) => step.status === "running" || step.status === "pending",
  );
  if (hasPipelineWork) {
    const promise = enqueueIngestJobProcessing({
      db: c.env.DB,
      jobId: job.id,
      materialId: material.id,
      learningId: material.learningId,
      text: rawContent,
      env: c.env,
    });
    c.executionCtx?.waitUntil(promise);
  }
  await indexMaterialSemanticNode(c.env.DB, c.env, material, learning.subject ?? undefined);

  return c.json(materialIngestResultSchema.parse({ material, job, extracted }), 201);
});

app.post("/api/materials", async (c) => {
  const { user } = requireAuth(c);
  const body = await c.req.json().catch(() => null);
  const parsed = upsertMaterialSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_request", issues: parsed.error.format() }, 400);
  }

  const data = parsed.data;
  const id = data.id ?? crypto.randomUUID();
  const createdAt = data.createdAt ?? nowIso();
  const updatedAt = data.updatedAt ?? createdAt;
  const prisma = getPrismaClient(c.env.DB);

  const row = await prisma.material.upsert({
    where: { id },
    create: {
      id,
      userId: user.id,
      learningId: data.learningId,
      type: data.type,
      sourcePath: data.sourcePath ?? null,
      rawContent: data.rawContent ?? null,
      metadata: (data.metadata as unknown as Prisma.JsonValue) ?? null,
      createdAt,
      updatedAt,
    },
    update: {
      type: data.type,
      sourcePath: data.sourcePath ?? null,
      rawContent: data.rawContent ?? null,
      metadata: (data.metadata as unknown as Prisma.JsonValue) ?? null,
      updatedAt,
    },
  });
  const material = mapMaterial(row as unknown as MaterialRow);
  if (material) {
    const learning = await fetchLearning(c.env.DB, material.learningId, user.id);
    await indexMaterialSemanticNode(c.env.DB, c.env, material, learning?.subject ?? undefined);
  }
  return c.json(material, 201);
});

app.get("/api/ingest-jobs", async (c) => {
  const { user } = requireAuth(c);
  const query = Object.fromEntries(new URL(c.req.url).searchParams);
  const parsed = ingestJobListQuerySchema.safeParse(query);
  if (!parsed.success) {
    return c.json({ error: "invalid_query", issues: parsed.error.format() }, 400);
  }
  const items = await listIngestJobs(c.env.DB, parsed.data.learningId, parsed.data.limit, user.id);
  return c.json({ items, count: items.length });
});

app.post("/api/ingest-jobs/:id/retry", async (c) => {
  const id = c.req.param("id");
  const { user } = requireAuth(c);
  const job = await fetchIngestJob(c.env.DB, id, user.id);
  if (!job) {
    return c.json({ error: "not_found" }, 404);
  }
  if (!job.outputMaterialId) {
    return c.json({ error: "material_missing" }, 400);
  }
  const material = await fetchMaterial(c.env.DB, job.outputMaterialId, user.id);
  if (!material) {
    return c.json({ error: "material_not_found" }, 404);
  }
  if (!material.rawContent) {
    return c.json({ error: "material_missing_raw_content" }, 400);
  }
  let resetJob = cloneIngestJob(job);
  const now = nowIso();
  resetJob.steps = resetJob.steps.map((step) => {
    if (PREPROCESS_STEP_KINDS.has(step.kind) || step.kind === "chunking" || step.kind === "embedding") {
      return {
        ...step,
        status: "pending",
        startedAt: undefined,
        finishedAt: undefined,
        error: undefined,
      };
    }
    if (step.status === "succeeded") return step;
    return {
      ...step,
      status: "pending",
      startedAt: undefined,
      finishedAt: undefined,
      error: undefined,
    };
  });
  resetJob.status = "processing";
  resetJob.requestedAt = now;
  resetJob = prepareJobForProcessing(resetJob);
  const saved = await saveIngestJob(c.env.DB, resetJob, user.id);
  const hasWork = saved.steps.some((step) => step.status === "running" || step.status === "pending");
  if (hasWork) {
    const promise = enqueueIngestJobProcessing({
      db: c.env.DB,
      env: c.env,
      jobId: saved.id,
      materialId: material.id,
      learningId: material.learningId,
      text: material.rawContent,
    });
    c.executionCtx?.waitUntil(promise);
  }
  return c.json(saved);
});

app.get("/api/materials/library", async (c) => {
  const { user } = requireAuth(c);
  const query = Object.fromEntries(new URL(c.req.url).searchParams);
  const parsed = libraryEntryListQuerySchema.safeParse(query);
  if (!parsed.success) {
    return c.json({ error: "invalid_query", issues: parsed.error.format() }, 400);
  }
  const items = await listLibraryEntries(c.env.DB, parsed.data.learningId, parsed.data.limit, user.id);
  return c.json({ items, count: items.length });
});

app.get("/api/materials/library/:id/content", async (c) => {
  const id = c.req.param("id");
  const { user } = requireAuth(c);
  const entry = await fetchLibraryEntryById(c.env.DB, id, user.id);
  if (!entry) {
    return c.json({ error: "not_found" }, 404);
  }
  try {
    const asset = await fetchLibraryAsset(c.env, entry);
    if (!asset) {
      return c.json({ error: "asset_not_found" }, 404);
    }
    const headers = new Headers({
      "Content-Type": asset.mimeType,
      "Cache-Control": "no-store",
      "Content-Length": String(asset.size),
      "Content-Disposition": `inline; filename="${sanitizeFileNameForHeader(entry.displayName)}"`,
    });
    return new Response(asset.data, { headers });
  } catch (error) {
    return c.json(
      {
        error: "asset_fetch_failed",
        message: error instanceof Error ? error.message : "教材ファイルを取得できませんでした。",
      },
      500,
    );
  }
});

app.put("/api/materials/:id", async (c) => {
  const id = c.req.param("id");
  const { user } = requireAuth(c);
  const body = await c.req.json().catch(() => null);
  const parsed = updateMaterialSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_request", issues: parsed.error.format() }, 400);
  }

  const exists = await fetchMaterial(c.env.DB, id, user.id);
  if (!exists) return c.json({ error: "not_found" }, 404);

  const data = parsed.data;
  const updatedAt = data.updatedAt ?? nowIso();

  const prisma = getPrismaClient(c.env.DB);
  await prisma.material.update({
    where: { id },
    data: {
      type: data.type ?? undefined,
      sourcePath: data.sourcePath ?? undefined,
      rawContent: data.rawContent ?? undefined,
      metadata: (data.metadata as unknown as Prisma.JsonValue) ?? undefined,
      updatedAt,
    },
  });

  const material = await fetchMaterial(c.env.DB, id, user.id);
  if (material) {
    const learning = await fetchLearning(c.env.DB, material.learningId, user.id);
    await indexMaterialSemanticNode(c.env.DB, c.env, material, learning?.subject ?? undefined);
  }
  return c.json(material);
});

app.delete("/api/materials/:id", async (c) => {
  const id = c.req.param("id");
  const { user } = requireAuth(c);
  const material = await fetchMaterial(c.env.DB, id, user.id);
  if (!material) {
    return c.json({ error: "not_found" }, 404);
  }
  const prisma = getPrismaClient(c.env.DB);
  const generatedRows = await prisma.generatedContent.findMany({
    where: { materialId: id, userId: user.id },
    select: { id: true },
  });
  await prisma.generatedContent.deleteMany({ where: { materialId: id, userId: user.id } });
  await prisma.material.deleteMany({ where: { id, userId: user.id } });
  await ensureMaterialTables(c.env.DB);
  await deleteLibraryAssetsForMaterial(c.env, id);
  await prisma.materialLibraryEntry.deleteMany({
    where: { materialId: id, OR: [{ userId: null }, { userId: user.id }] },
  });
  const generatedIds = generatedRows.map((row) => row.id).filter(Boolean);
  await deleteSemanticNodesByRef(c.env.DB, "material", [id], user.id);
  await deleteSemanticNodesByRef(c.env.DB, "generated_content", generatedIds, user.id);
  return c.json({ ok: true });
});

app.get("/api/learnings/:id/contents", async (c) => {
  const id = c.req.param("id");
  const { user } = requireAuth(c);
  const prisma = getPrismaClient(c.env.DB);
  const rows = await prisma.generatedContent.findMany({
    where: { learningId: id, userId: user.id },
    orderBy: { createdAt: "desc" },
  });
  const items = rows.map((row) => mapGeneratedContent(row as unknown as GeneratedContentRow));
  return c.json({ items });
});

app.post("/api/contents", async (c) => {
  const { user } = requireAuth(c);
  const body = await c.req.json().catch(() => null);
  const parsed = upsertGeneratedSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_request", issues: parsed.error.format() }, 400);
  }

  const data: Omit<GeneratedContent, "id" | "createdAt"> & Partial<Pick<GeneratedContent, "id" | "createdAt">> = parsed.data;
  const saved = await saveGeneratedContent(c.env.DB, { ...data, userId: user.id }, user.id, c.env);
  return c.json(saved, 201);
});

app.post("/api/generate/from-material", async (c) => {
  const { user } = requireAuth(c);
  const body = await c.req.json().catch(() => null);
  const parsed = generateFromMaterialRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_request", issues: parsed.error.format() }, 400);
  }

  const request = parsed.data;
  const learning = await fetchLearning(c.env.DB, request.learningId, user.id);
  if (!learning) return c.json({ error: "learning_not_found" }, 404);

  try {
    const { material } = await resolveMaterialForGeneration(
      c.env.DB,
      c.env,
      request,
      learning,
      user.id,
    );
    const preset = await resolvePresetContext(c.env.DB, request, user.id);
    const { drafts, meta } = await generateContentsFromMaterial(
      c.env,
      request,
      learning,
      material,
      preset,
    );
    const items: GeneratedContent[] = [];
    for (const draft of drafts) {
      items.push(await saveGeneratedContent(c.env.DB, { ...draft, userId: user.id }, user.id, c.env));
    }
    const job = buildGenerationJob(request.types, preset, {
      modelName: meta.modelName,
      tokens: meta.tokens,
    });
    return c.json({ material, job, items });
  } catch (error) {
    if (error instanceof ToolCallError) {
      return c.json(
        { error: error.code, message: error.message },
        error.status as ContentfulStatusCode,
      );
    }
    console.error("material_generation_failed", error);
    return c.json(
      {
        error: "generation_failed",
        message: error instanceof Error ? error.message : "unknown error",
      },
      500,
    );
  }
});

app.get("/api/learnings/:id/sessions", async (c) => {
  const id = c.req.param("id");
  const { user } = requireAuth(c);
  const prisma = getPrismaClient(c.env.DB);
  const rows = await prisma.practiceSession.findMany({
    where: { learningId: id, userId: user.id },
    orderBy: { createdAt: "desc" },
  });
  const items = rows.map((row) => mapPracticeSession(row as unknown as PracticeSessionRow));
  return c.json({ items });
});

app.post("/api/sessions", async (c) => {
  const { user } = requireAuth(c);
  const body = await c.req.json().catch(() => null);
  const parsed = upsertSessionSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_request", issues: parsed.error.format() }, 400);
  }

  const data = parsed.data;
  const id = data.id ?? crypto.randomUUID();
  const createdAt = data.createdAt ?? nowIso();

  const prisma = getPrismaClient(c.env.DB);
  await prisma.practiceSession.upsert({
    where: { id },
    create: {
      id,
      userId: user.id,
      learningId: data.learningId,
      generatedContentId: data.generatedContentId ?? null,
      questionRef: (data.questionRef as unknown as Prisma.JsonValue) ?? null,
      answerText: data.answerText,
      isCorrect: data.isCorrect ?? null,
      feedback: (data.feedback as unknown as Prisma.JsonValue) ?? null,
      score: data.score ?? null,
      createdAt,
    },
    update: {
      generatedContentId: data.generatedContentId ?? null,
      questionRef: (data.questionRef as unknown as Prisma.JsonValue) ?? null,
      answerText: data.answerText,
      isCorrect: data.isCorrect ?? null,
      feedback: (data.feedback as unknown as Prisma.JsonValue) ?? null,
      score: data.score ?? null,
    },
  });

  await updateLearningProgress(c.env.DB, data.learningId, user.id);

  const row = await prisma.practiceSession.findUnique({ where: { id } });
  const session = row ? mapPracticeSession(row as unknown as PracticeSessionRow) : null;
  if (session) {
    const learning = await fetchLearning(c.env.DB, session.learningId, user.id);
    await indexPracticeQuestionSemanticNode(
      c.env.DB,
      c.env,
      session,
      learning?.subject ?? undefined,
    );
  }
  return c.json(session, 201);
});

app.get("/api/presets", async (c) => {
  const { user } = requireAuth(c);
  const query = Object.fromEntries(new URL(c.req.url).searchParams);
  const parsed = presetListQuerySchema.safeParse(query);
  if (!parsed.success) {
    return c.json({ error: "invalid_query", issues: parsed.error.format() }, 400);
  }

  const prisma = getPrismaClient(c.env.DB);
  const rows = await prisma.preset.findMany({
    where: {
      userId: user.id,
      ...(parsed.data.subject ? { subject: parsed.data.subject } : {}),
    },
    orderBy: { updatedAt: "desc" },
    take: parsed.data.limit,
  });
  const items = rows.map((row) => mapPreset(row as unknown as PresetRow));
  return c.json({ items, count: items.length });
});

app.get("/api/presets/:id", async (c) => {
  const { user } = requireAuth(c);
  const preset = await fetchPreset(c.env.DB, c.req.param("id"), user.id);
  if (!preset) return c.json({ error: "not_found" }, 404);
  return c.json(preset);
});

app.post("/api/presets", async (c) => {
  const { user } = requireAuth(c);
  const body = await c.req.json().catch(() => null);
  const parsed = upsertPresetSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_request", issues: parsed.error.format() }, 400);
  }

  const data = parsed.data;
  const id = data.id ?? crypto.randomUUID();
  const createdAt = data.createdAt ?? nowIso();
  const updatedAt = data.updatedAt ?? createdAt;

  const prisma = getPrismaClient(c.env.DB);
  await prisma.preset.upsert({
    where: { id },
    create: {
      id,
      userId: user.id,
      subject: data.subject,
      title: data.title,
      systemPrompt: data.systemPrompt,
      userInstructionTemplate: data.userInstructionTemplate,
      createdAt,
      updatedAt,
    },
    update: {
      subject: data.subject,
      title: data.title,
      systemPrompt: data.systemPrompt,
      userInstructionTemplate: data.userInstructionTemplate,
      updatedAt,
    },
  });

  const preset = await fetchPreset(c.env.DB, id, user.id);
  return c.json(preset, 201);
});

app.put("/api/presets/:id", async (c) => {
  const id = c.req.param("id");
  const { user } = requireAuth(c);
  const body = await c.req.json().catch(() => null);
  const parsed = updatePresetSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "invalid_request", issues: parsed.error.format() }, 400);
  }

  const exists = await fetchPreset(c.env.DB, id, user.id);
  if (!exists) return c.json({ error: "not_found" }, 404);

  const data = parsed.data;
  const updatedAt = data.updatedAt ?? nowIso();
  const prisma = getPrismaClient(c.env.DB);
  await prisma.preset.update({
    where: { id },
    data: {
      subject: data.subject ?? undefined,
      title: data.title ?? undefined,
      systemPrompt: data.systemPrompt ?? undefined,
      userInstructionTemplate: data.userInstructionTemplate ?? undefined,
      updatedAt,
    },
  });

  const preset = await fetchPreset(c.env.DB, id, user.id);
  return c.json(preset);
});

app.delete("/api/presets/:id", async (c) => {
  const id = c.req.param("id");
  const { user } = requireAuth(c);
  const prisma = getPrismaClient(c.env.DB);
  await prisma.preset.deleteMany({ where: { id, userId: user.id } });
  return c.json({ ok: true });
});

app.post("/ai/embed", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = embedRequestSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "invalid_request", issues: parsed.error.format() }, 400);
  }

  const { embeddings, dimension, model, provider } = await generateEmbeddings(
    parsed.data.texts,
    c.env,
  );
  return c.json({
    dimension,
    model,
    provider,
    embeddings,
  });
});

app.post("/search/semantic", async (c) => {
  const { user } = requireAuth(c);
  const body = await c.req.json().catch(() => null);
  const parsed = semanticSearchRequestSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "invalid_request", issues: parsed.error.format() }, 400);
  }

  const { query, topK, refType, subject } = parsed.data;
  const results = await searchSemantic(c.env?.DB, c.env, query, topK, { refType, subject }, user.id);

  return c.json({ query, topK, results });
});

app.post("/ai/tools", async (c) => {
  const { user } = requireAuth(c);
  const body = await c.req.json().catch(() => null);
  const parsed = toolCallSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_request", issues: parsed.error.format() }, 400);
  }

  try {
    const result = await executeToolCall(c.env, parsed.data.tool, parsed.data.params ?? {}, user.id);
    return c.json({ tool: parsed.data.tool, result });
  } catch (error) {
    if (error instanceof ToolCallError) {
      return c.json({ error: error.code, message: error.message }, error.status as ContentfulStatusCode);
    }
    console.error("tool call failed", error);
    return c.json(
      {
        error: "tool_failed",
        message: error instanceof Error ? error.message : "unknown error",
      },
      500,
    );
  }
});

app.post("/ai/practice/grade", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = practiceGradingRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_request", issues: parsed.error.format() }, 400);
  }

  const request: PracticeGradingRequest = {
    ...parsed.data,
    mode: parsed.data.mode ?? "text",
  };

  const fallback = buildFallbackFeedback(request);
  let feedback = fallback;

  try {
    const aiResult = await gradeWithOpenAi(c.env, request);
    if (aiResult) {
      feedback = aiResult;
    }
  } catch (error) {
    console.warn("practice grading failed", error);
    feedback = buildFallbackFeedback(request, {
      reason: error instanceof Error ? error.message : "unknown error",
    });
  }

  const response: PracticeGradingResponse = {
    feedback,
    requestEcho: request,
  };

  return c.json(response);
});

app.post("/ai/proxy", async (c) => {
  const { user } = requireAuth(c);
  const body = await c.req.json().catch(() => null);
  const parsed = proxyRequestSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(
      {
        error: "invalid_request",
        issues: parsed.error.format(),
      },
      400,
    );
  }

  const prompt = parsed.data.prompt.trim();
  const topK = parsed.data.topK ?? 3;
  const toolCalls: { tool: string; detail: string; result?: string }[] = [];
  const logTool = (tool: string, detail: string, result?: string) =>
    toolCalls.push({ tool, detail, result });

  const embedProvider = c.env?.OPENAI_API_KEY ? "openai" : "fallback";
  logTool("embed", `texts=1 provider=${embedProvider}`);

  let relatedMatches: SemanticMatch[] = [];
  try {
    relatedMatches = await searchSemantic(c.env?.DB, c.env, prompt, topK, undefined, user.id);
    const topHit = relatedMatches[0];
    logTool(
      "semantic_search",
      `query="${prompt.slice(0, 32)}" topK=${topK}`,
      topHit ? `${topHit.label} (score ${topHit.score.toFixed(2)})` : "no match",
    );
  } catch (error) {
    console.error("semantic search failed", error);
    logTool(
      "semantic_search",
      `query="${prompt.slice(0, 32)}" topK=${topK}`,
      error instanceof Error ? `failed: ${error.message}` : "failed",
    );
  }

  const subjectHint = detectSubjectFromPrompt(prompt);
  const shouldCreate = shouldCreateLearningFromPrompt(prompt, relatedMatches);
  let createdLearning: Learning | null = null;
  if (shouldCreate) {
    if (c.env?.DB) {
      const title = buildLearningTitleFromPrompt(prompt, subjectHint);
      const tags = buildLearningTagsFromPrompt(prompt, subjectHint);
      try {
        const result = await executeToolCall(
          c.env,
          "create_learning_from_chat",
          {
            title,
            subject: subjectHint,
            tags,
            materialText: prompt,
            materialTitle: title,
          },
          user.id,
        );
        const learning = (result as { learning?: Learning }).learning ?? null;
        const materialId = (result as { material?: Material }).material?.id?.slice(0, 8);
        createdLearning = learning;
        if (learning) {
          logTool(
            "create_learning_from_chat",
            `title="${title}" subject=${subjectHint ?? "n/a"}`,
            `id=${learning.id}${materialId ? ` material=${materialId}` : ""}`,
          );
          relatedMatches = [
            {
              id: learning.id,
              refType: "learning",
              refId: learning.id,
              embedding: toEmbedding(`${learning.title} ${prompt}`),
              label: learning.title,
              excerpt: summarizeText(prompt, 160),
              subject: learning.subject ?? subjectHint,
              score: 1,
            },
            ...relatedMatches,
          ];
        }
      } catch (error) {
        const reason =
          error instanceof ToolCallError
            ? `${error.code}: ${error.message}`
            : error instanceof Error
              ? error.message
              : "unknown error";
        logTool("create_learning_from_chat", `title="${prompt.slice(0, 32)}"`, `failed: ${reason}`);
      }
    } else {
      logTool("create_learning_from_chat", "skipped", "database unavailable");
    }
  }

  const serializedMatches = serializeMatchesForClient(relatedMatches);
  const generationTypes = determineGenerationTypes(prompt);
  const targetLearning = serializedMatches.find((match) => match.refType === "learning");

  let generatedItems: GeneratedContent[] = [];
  if (generationTypes.length > 0) {
    if (!c.env?.DB) {
      logTool("generate_questions", "skipped", "database unavailable");
    } else if (!targetLearning || !isUuid(targetLearning.id)) {
      logTool("generate_questions", "skipped", "learning target missing");
    } else {
      try {
        const result = await executeToolCall(
          c.env,
          "generate_questions",
          {
            learningId: targetLearning.id,
            types: generationTypes,
            materialText: prompt,
            materialTitle: targetLearning.label,
          },
          user.id,
        );
        const items = (result as { items?: GeneratedContent[] }).items ?? [];
        generatedItems = Array.isArray(items) ? items : [];
        const seededFromPrompt = Boolean(
          (result as { materialCreatedFromText?: boolean }).materialCreatedFromText,
        );
        const materialId =
          (result as { material?: { id?: string } }).material?.id?.slice(0, 8) ?? undefined;
        const logResult = [
          `${generatedItems.length}件生成`,
          seededFromPrompt ? "promptから教材作成" : undefined,
          materialId ? `material=${materialId}` : undefined,
        ]
          .filter(Boolean)
          .join(" / ");
        logTool(
          "generate_questions",
          `learning=${targetLearning.label} types=${generationTypes.join(",")}`,
          logResult,
        );
      } catch (error) {
        const reason =
          error instanceof ToolCallError
            ? `${error.code}: ${error.message}`
            : error instanceof Error
              ? error.message
              : "unknown error";
        logTool("generate_questions", "auto", `failed: ${reason}`);
      }
    }
  }

  const context: ProxyResponseContext = {
    prompt,
    subject: subjectHint,
    tone: parsed.data.tone,
    related: serializedMatches,
    toolCalls,
    createdLearning,
    shouldCreate,
    generatedItems,
    plannedTypes: generationTypes,
  };

  const reply =
    (await callOpenAiProxyChat(c.env, context)) ?? buildProxyFallbackMessage(context);

  const intent =
    generatedItems.length > 0
      ? ("generate_content" as const)
      : createdLearning
        ? ("create_learning" as const)
        : ("search" as const);

  const actions = buildProxyActionsPayload(prompt, createdLearning, generatedItems, targetLearning);

  return c.json({
    message: reply,
    intent,
    actions,
    request: parsed.data,
    exampleSchema: {
      learning: schemas.learning.keyof().options,
    },
    related: serializedMatches,
    toolCalls,
  });
});

export const __ingestTestHelpers = {
  chunkMaterialText,
  attachEmbeddingsToChunks,
  prepareJobForProcessing,
};

export default app;
