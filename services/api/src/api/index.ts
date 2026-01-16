export { app } from "./app";

export {
  mapLearning,
  mapMaterial,
  mapGeneratedContent,
  mapPracticeSession,
  mapPreset,
  calculateLearningProgress,
  updateLearningProgress,
  fetchMaterial,
  fetchLatestMaterialForLearning,
  applyMaterialMetadataPatch,
  fetchLearning,
  listLearnings,
  listMaterials,
  insertLearning,
  fetchPreset,
} from "./data";

export {
  chunkMaterialText,
  attachEmbeddingsToChunks,
  generateEmbeddings,
  toEmbedding,
  cosineSimilarity,
} from "./embeddings";
export type { MaterialChunkRecord } from "./embeddings";

export type { LibraryAssetPayload } from "./ingest";
export {
  buildLibraryAssetPayload,
  ingestStepTemplates,
  PREPROCESS_STEP_KINDS,
  enqueueIngestJobProcessing,
  extractMaterialFromSource,
  buildIngestJob,
  cloneIngestJob,
  prepareJobForProcessing,
  persistMaterialRawContent,
  buildLibraryEntryRecord,
  decodeDataUrl,
  fetchRemoteBinary,
} from "./ingest";

export {
  saveGeneratedContent,
  createAdhocMaterialFromText,
  resolveMaterialForGeneration,
  generateContentsFromMaterial,
  resolvePresetContext,
  buildGenerationJob,
  buildFallbackFeedback,
  gradeWithOpenAi,
} from "./generation";

export { buildFallbackMaterialGeneration, generateMaterialWithOpenAi } from "./material-ai";

export { buildFallbackChatProxyResponse, chatProxyWithOpenAi } from "./chat-proxy";

export {
  searchSemantic,
  serializeMatchesForClient,
  deleteSemanticNodesByRef,
  syncSemanticIndexToVectorize,
  indexLearningSemanticNode,
  indexMaterialSemanticNode,
  indexGeneratedContentSemanticNode,
  indexPracticeQuestionSemanticNode,
  detectSubjectFromPrompt,
  shouldCreateLearningFromPrompt,
  buildLearningTitleFromPrompt,
  buildLearningTagsFromPrompt,
  determineGenerationTypes,
  fallbackLearnings,
  isUuid,
  subjectLabelMap,
  describeRelatedBrief,
} from "./semantic";
export type { SemanticMatch } from "./semantic";

export {
  buildProxyActionsPayload,
  buildProxyFallbackMessage,
  callOpenAiProxyChat,
  executeToolCall,
} from "./proxy";
export type { ProxyResponseContext } from "./proxy";

export { DEFAULT_GENERATION_TEMPERATURE, callOpenAiForGeneration, resolveOpenAiBaseUrl } from "./openai";
export { callOpenAiChatCompletion } from "./openai";

export { summarizeText, joinChatContent, encodeDataUrlFromBytes } from "./utils";
export { createLibraryUploadSession, uploadLibraryPart, completeLibraryUploadSession, abortLibraryUploadSession } from "./uploads";

export {
  createSession,
  createUser,
  ensureDefaultUser,
  fetchUserByEmail,
  generateSessionToken,
  hashToken,
  requireAuth,
  resolveAuthContext,
  updateUserProfile,
  DEFAULT_USER_DISPLAY_NAME,
  DEFAULT_USER_ID,
} from "../core/auth";
export { ensureMaterialTables, ensurePrismaSchema, ensureUserTables, getPrismaClient, nowIso } from "../core/prisma";
export {
  deleteLibraryAssetsForMaterial,
  buildLibraryAssetStorageKey,
  libraryAssetIndexKey,
  fetchIngestJob,
  fetchLibraryAsset,
  fetchLibraryEntryById,
  listIngestJobs,
  listLibraryEntries,
  saveIngestJob,
  saveLibraryAsset,
  saveLibraryEntry,
  sanitizeFileNameForHeader,
} from "../core/library";
export { ToolCallError } from "../core/errors";
export {
  embedRequestSchema,
  contentSearchRequestSchema,
  ingestJobListQuerySchema,
  ingestMaterialRequestSchema,
  learningListQuerySchema,
  materialListQuerySchema,
  libraryEntryListQuerySchema,
  presetListQuerySchema,
  proxyRequestSchema,
  semanticSearchRequestSchema,
  toolCallSchema,
  updateLearningSchema,
  updateMaterialSchema,
  updatePresetSchema,
  upsertGeneratedSchema,
  upsertLearningSchema,
  upsertMaterialSchema,
  upsertPresetSchema,
  upsertSessionSchema,
} from "../core/schemas";
export {
  generateFromMaterialRequestSchema,
  materialIngestResultSchema,
  practiceFeedbackSchema,
  practiceGradingRequestSchema,
  materialGenerateRequestSchema,
  materialGenerateResponseSchema,
  openAiChatProxyRequestSchema,
  openAiChatProxyResponseSchema,
  authSessionResponseSchema,
  bootstrapSessionRequestSchema,
  issueSessionRequestSchema,
  updateUserProfileRequestSchema,
  schemas,
  richContentDocumentSchema,
} from "@theteacher/shared";
export type { AppBindings, AppEnv } from "../core/types";
export type { AuthContext } from "../core/auth";
