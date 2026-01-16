import type { AppBindings } from "../core/types";
import { buildLibraryAssetStorageKey, libraryAssetIndexKey } from "../core/library";

type UploadSessionRecord = {
  sessionId: string;
  userId: string;
  entryId: string;
  key: string;
  r2UploadId: string;
  fileName?: string;
  mimeType: string;
  declaredSize?: number;
  createdAt: string;
  parts: Array<{ partNumber: number; etag: string; size: number }>;
};

const uploadSessionKey = (sessionId: string) => `upload-session:${sessionId}`;

const requireUploadStorage = (env: AppBindings) => {
  if (!env.MATERIALS_BUCKET) {
    throw new Error("MATERIALS_BUCKET is required for chunk uploads");
  }
  if (!env.MATERIALS_KV) {
    throw new Error("MATERIALS_KV is required for chunk uploads");
  }
};

const getMultipartUpload = (env: AppBindings, key: string, uploadId: string) => {
  const bucket = env.MATERIALS_BUCKET as unknown as {
    resumeMultipartUpload: (
      key: string,
      uploadId: string,
    ) => Promise<{
      uploadPart: (partNumber: number, value: ArrayBuffer | Uint8Array) => Promise<{ etag: string }>;
      complete: (parts: Array<{ partNumber: number; etag: string }>) => Promise<unknown>;
      abort: () => Promise<unknown>;
    }>;
    createMultipartUpload: (
      key: string,
      options?: {
        httpMetadata?: { contentType?: string };
        customMetadata?: Record<string, string>;
      },
    ) => Promise<{ uploadId: string }>;
  };
  return bucket.resumeMultipartUpload(key, uploadId);
};

export const createLibraryUploadSession = async (env: AppBindings, input: {
  userId: string;
  fileName?: string;
  mimeType?: string;
  size?: number;
}) => {
  requireUploadStorage(env);
  const sessionId = crypto.randomUUID();
  const entryId = crypto.randomUUID();
  const mimeType = input.mimeType?.trim() || "application/octet-stream";
  const fileName = input.fileName?.trim() || `${entryId}.bin`;
  const key = buildLibraryAssetStorageKey(entryId, fileName);

  const bucket = env.MATERIALS_BUCKET as unknown as {
    createMultipartUpload: (
      key: string,
      options?: {
        httpMetadata?: { contentType?: string };
        customMetadata?: Record<string, string>;
      },
    ) => Promise<{ uploadId: string }>;
  };
  const upload = await bucket.createMultipartUpload(key, {
    httpMetadata: { contentType: mimeType },
    customMetadata: { entryId },
  });

  const record: UploadSessionRecord = {
    sessionId,
    userId: input.userId,
    entryId,
    key,
    r2UploadId: upload.uploadId,
    fileName,
    mimeType,
    declaredSize: typeof input.size === "number" ? input.size : undefined,
    createdAt: new Date().toISOString(),
    parts: [],
  };

  await env.MATERIALS_KV!.put(uploadSessionKey(sessionId), JSON.stringify(record), {
    expirationTtl: 60 * 60,
    metadata: { userId: input.userId, entryId },
  });

  return {
    sessionId,
    entryId,
    chunkSize: 5 * 1024 * 1024,
  };
};

const loadSession = async (env: AppBindings, sessionId: string, userId: string) => {
  requireUploadStorage(env);
  const record = (await env.MATERIALS_KV!.get(uploadSessionKey(sessionId), "json").catch(() => null)) as
    | UploadSessionRecord
    | null;
  if (!record) throw new Error("upload session not found");
  if (record.userId !== userId) throw new Error("upload session forbidden");
  return record;
};

const persistSession = async (env: AppBindings, record: UploadSessionRecord) => {
  requireUploadStorage(env);
  await env.MATERIALS_KV!.put(uploadSessionKey(record.sessionId), JSON.stringify(record), {
    expirationTtl: 60 * 60,
    metadata: { userId: record.userId, entryId: record.entryId },
  });
};

export const uploadLibraryPart = async (
  env: AppBindings,
  sessionId: string,
  userId: string,
  partNumber: number,
  bytes: Uint8Array,
) => {
  const record = await loadSession(env, sessionId, userId);
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10_000) {
    throw new Error("invalid part number");
  }
  if (bytes.byteLength === 0) throw new Error("empty part payload");

  const upload = await getMultipartUpload(env, record.key, record.r2UploadId);
  const result = await upload.uploadPart(partNumber, bytes);
  const etag = result.etag;
  record.parts = record.parts.filter((part) => part.partNumber !== partNumber);
  record.parts.push({ partNumber, etag, size: bytes.byteLength });
  record.parts.sort((a, b) => a.partNumber - b.partNumber);
  await persistSession(env, record);
  return { etag, entryId: record.entryId };
};

export const completeLibraryUploadSession = async (env: AppBindings, sessionId: string, userId: string) => {
  const record = await loadSession(env, sessionId, userId);
  if (record.parts.length === 0) throw new Error("no parts uploaded");
  const upload = await getMultipartUpload(env, record.key, record.r2UploadId);
  await upload.complete(record.parts.map((part) => ({ partNumber: part.partNumber, etag: part.etag })));

  const size = record.parts.reduce((sum, part) => sum + part.size, 0);
  await env.MATERIALS_KV!.put(
    libraryAssetIndexKey(record.entryId),
    JSON.stringify({ key: record.key, size, mimeType: record.mimeType, fileName: record.fileName }),
    { metadata: { entryId: record.entryId } },
  );

  await env.MATERIALS_KV!.delete(uploadSessionKey(record.sessionId)).catch(() => undefined);

  return {
    entryId: record.entryId,
    key: record.key,
    size,
    mimeType: record.mimeType,
    fileName: record.fileName,
    publicPath: `/api/materials/library/${record.entryId}/content`,
  };
};

export const abortLibraryUploadSession = async (env: AppBindings, sessionId: string, userId: string) => {
  const record = await loadSession(env, sessionId, userId);
  const upload = await getMultipartUpload(env, record.key, record.r2UploadId);
  await upload.abort().catch(() => undefined);
  await env.MATERIALS_KV!.delete(uploadSessionKey(record.sessionId)).catch(() => undefined);
  return { ok: true };
};

