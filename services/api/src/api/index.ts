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

export {
  LibraryAssetPayload,
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
  encodeDataUrlFromBytes,
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

export {
  searchSemantic,
  serializeMatchesForClient,
  deleteSemanticNodesByRef,
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

export { summarizeText, joinChatContent } from "./utils";

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
  ingestJobListQuerySchema,
  ingestMaterialRequestSchema,
  learningListQuerySchema,
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
  authSessionResponseSchema,
  bootstrapSessionRequestSchema,
  issueSessionRequestSchema,
  updateUserProfileRequestSchema,
  schemas,
  richContentDocumentSchema,
} from "@theteacher/shared";
export type { AppBindings, AppEnv, AuthContext } from "../core/types";
