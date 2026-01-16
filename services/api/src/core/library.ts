import type { Prisma } from "@prisma/client/edge";
import type { D1Database } from "@cloudflare/workers-types";
import type { IngestJob, MaterialLibraryEntry } from "@theteacher/shared";

import {
  mapIngestJob,
  mapLibraryEntry,
  type IngestJobRow,
  type LibraryEntryRow,
} from "../db";
import { DEFAULT_USER_ID } from "./auth";
import { ensureMaterialTables, getPrismaClient } from "./prisma";
import type { AppBindings } from "./types";

const sanitizeStorageFileName = (value?: string, fallback = "asset.bin") => {
  if (!value) return fallback;
  const normalized = value.replace(/[^\w.-]+/g, "_").replace(/^_+/, "");
  return normalized.length ? normalized.slice(0, 120) : fallback;
};

export const buildLibraryAssetStorageKey = (entryId: string, fileName?: string) =>
  `materials/${entryId}/${sanitizeStorageFileName(fileName ?? `${entryId}.bin`)}`;

export const libraryAssetIndexKey = (entryId: string) => `library-asset:${entryId}`;

const fetchLegacyLibraryAsset = async (db: D1Database | undefined, entryId: string) => {
  if (!db) return null;
  await ensureMaterialTables(db);
  const prisma = getPrismaClient(db);
  const asset = await prisma.materialLibraryAsset.findUnique({ where: { entryId } });
  if (!asset?.data) return null;
  const rawData = asset.data as ArrayBuffer | Uint8Array;
  const bytes = rawData instanceof ArrayBuffer ? new Uint8Array(rawData) : new Uint8Array(rawData);
  const data =
    bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
      ? bytes.buffer
      : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return {
    entryId: asset.entryId,
    key: `legacy/${asset.entryId}`,
    mimeType: asset.mimeType,
    size: asset.size,
    data,
  };
};

const putLibraryAssetIndex = async (
  env: AppBindings,
  entryId: string,
  record: { key: string; size: number; mimeType: string; fileName?: string },
) => {
  if (!env.MATERIALS_KV) return;
  await env.MATERIALS_KV.put(libraryAssetIndexKey(entryId), JSON.stringify(record), {
    metadata: { entryId },
  });
};

export const saveLibraryAsset = async (
  env: AppBindings,
  entryId: string,
  asset: { bytes: Uint8Array; mimeType: string; size: number; fileName?: string },
): Promise<{ key: string; publicPath: string }> => {
  if (!env.MATERIALS_BUCKET) {
    throw new Error("MATERIALS_BUCKET binding is required to store materials in R2");
  }
  const key = buildLibraryAssetStorageKey(entryId, asset.fileName);
  await env.MATERIALS_BUCKET.put(key, asset.bytes.buffer, {
    httpMetadata: { contentType: asset.mimeType },
    customMetadata: { entryId },
  });
  await putLibraryAssetIndex(env, entryId, {
    key,
    size: asset.size,
    mimeType: asset.mimeType,
    fileName: asset.fileName,
  });
  return { key, publicPath: `/api/materials/library/${entryId}/content` };
};

export const fetchLibraryAsset = async (env: AppBindings, entry: MaterialLibraryEntry) => {
  if (!env.MATERIALS_BUCKET) {
    return fetchLegacyLibraryAsset(env.DB, entry.id);
  }
  const kvRecord = ((await env.MATERIALS_KV?.get(libraryAssetIndexKey(entry.id), "json").catch(() => null)) ||
    null) as { key?: string; mimeType?: string; size?: number } | null;
  const key = kvRecord?.key ?? entry.storedPath ?? entry.libraryPath;
  if (!key) return null;
  const object = await env.MATERIALS_BUCKET.get(key);
  if (!object) return fetchLegacyLibraryAsset(env.DB, entry.id);
  const data = await object.arrayBuffer();
  return {
    entryId: entry.id,
    key,
    mimeType: object.httpMetadata?.contentType ?? kvRecord?.mimeType ?? "application/octet-stream",
    size: kvRecord?.size ?? data.byteLength,
    data,
  };
};

export const sanitizeFileNameForHeader = (value: string, fallback = "material") => {
  const normalized = value.replace(/[^\w.\- ]+/g, "_").trim();
  if (normalized.length > 0) return normalized.slice(0, 120);
  return fallback;
};

export const deleteLibraryAssetsForMaterial = async (env: AppBindings, materialId: string) => {
  const bucket = env.MATERIALS_BUCKET;
  await ensureMaterialTables(env.DB);
  const prisma = getPrismaClient(env.DB);
  const entries = await prisma.materialLibraryEntry.findMany({
    where: { materialId },
    select: { id: true, storedPath: true },
  });
  await Promise.all(
    entries.map(async (entry) => {
      const kvKey = ((await env.MATERIALS_KV?.get(libraryAssetIndexKey(entry.id), "json").catch(() => null)) ||
        null) as { key?: string } | null;
      const key = kvKey?.key ?? entry.storedPath ?? undefined;
      if (bucket && key) {
        await bucket.delete(key).catch(() => undefined);
      }
      await env.MATERIALS_KV?.delete(libraryAssetIndexKey(entry.id)).catch(() => undefined);
    }),
  );
  if (entries.length > 0) {
    await prisma.materialLibraryAsset.deleteMany({
      where: { entryId: { in: entries.map((entry) => entry.id) } },
    });
  }
};

export const saveLibraryEntry = async (
  db: D1Database,
  entry: MaterialLibraryEntry,
  userId: string = DEFAULT_USER_ID,
): Promise<MaterialLibraryEntry> => {
  await ensureMaterialTables(db);
  const prisma = getPrismaClient(db);
  const saved = await prisma.materialLibraryEntry.upsert({
    where: { id: entry.id },
    create: {
      id: entry.id,
      userId: entry.userId ?? userId,
      displayName: entry.displayName,
      storedPath: entry.storedPath,
      assetPath: entry.assetPath ?? null,
      libraryPath: entry.libraryPath ?? null,
      type: entry.type,
      bytes: entry.bytes ?? null,
      learningId: entry.learningId ?? null,
      materialId: entry.materialId ?? null,
      originalSource: entry.originalSource as unknown as Prisma.JsonValue,
      notes: entry.notes ?? null,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    },
    update: {
      userId: entry.userId ?? userId,
      displayName: entry.displayName,
      storedPath: entry.storedPath,
      assetPath: entry.assetPath ?? null,
      libraryPath: entry.libraryPath ?? null,
      type: entry.type,
      bytes: entry.bytes ?? null,
      learningId: entry.learningId ?? null,
      materialId: entry.materialId ?? null,
      originalSource: entry.originalSource as unknown as Prisma.JsonValue,
      notes: entry.notes ?? null,
      updatedAt: entry.updatedAt,
    },
  });
  return mapLibraryEntry(saved as unknown as LibraryEntryRow);
};

export const fetchLibraryEntryById = async (
  db?: D1Database,
  id?: string,
  userId: string = DEFAULT_USER_ID,
) => {
  if (!db || !id) return null;
  await ensureMaterialTables(db);
  const prisma = getPrismaClient(db);
  const row = await prisma.materialLibraryEntry.findFirst({
    where: { id, OR: [{ userId: null }, { userId }] },
  });
  return row ? mapLibraryEntry(row as unknown as LibraryEntryRow) : null;
};

export const listLibraryEntries = async (
  db?: D1Database,
  learningId?: string,
  limit = 50,
  userId: string = DEFAULT_USER_ID,
) => {
  if (!db) return [];
  await ensureMaterialTables(db);
  const prisma = getPrismaClient(db);
  const rows = await prisma.materialLibraryEntry.findMany({
    where: {
      ...(learningId ? { learningId } : {}),
      OR: [{ userId: null }, { userId }],
    },
    orderBy: { updatedAt: "desc" },
    take: limit,
  });
  return rows.map((row) => mapLibraryEntry(row as unknown as LibraryEntryRow));
};

export const saveIngestJob = async (
  db: D1Database,
  job: IngestJob,
  userId: string = DEFAULT_USER_ID,
): Promise<IngestJob> => {
  await ensureMaterialTables(db);
  const prisma = getPrismaClient(db);
  const row = await prisma.materialIngestJob.upsert({
    where: { id: job.id },
    create: {
      id: job.id,
      userId,
      learningId: job.learningId ?? null,
      source: job.source as unknown as Prisma.JsonValue,
      status: job.status,
      steps: job.steps as unknown as Prisma.JsonValue,
      requestedAt: job.requestedAt,
      updatedAt: job.updatedAt,
      preferredOcrEngine: job.preferredOcrEngine ?? null,
      preferredTranscriptionEngine: job.preferredTranscriptionEngine ?? null,
      notes: job.notes ?? null,
      outputMaterialId: job.outputMaterialId ?? null,
      libraryPath: job.libraryPath ?? null,
    },
    update: {
      userId,
      learningId: job.learningId ?? null,
      source: job.source as unknown as Prisma.JsonValue,
      status: job.status,
      steps: job.steps as unknown as Prisma.JsonValue,
      updatedAt: job.updatedAt,
      preferredOcrEngine: job.preferredOcrEngine ?? null,
      preferredTranscriptionEngine: job.preferredTranscriptionEngine ?? null,
      notes: job.notes ?? null,
      outputMaterialId: job.outputMaterialId ?? null,
      libraryPath: job.libraryPath ?? null,
    },
  });
  return mapIngestJob(row as unknown as IngestJobRow);
};

export const fetchIngestJob = async (
  db: D1Database,
  id: string,
  userId: string = DEFAULT_USER_ID,
): Promise<IngestJob | null> => {
  await ensureMaterialTables(db);
  const prisma = getPrismaClient(db);
  const row = await prisma.materialIngestJob.findFirst({
    where: { id, OR: [{ userId: null }, { userId }] },
  });
  return row ? mapIngestJob(row as unknown as IngestJobRow) : null;
};

export const listIngestJobs = async (
  db?: D1Database,
  learningId?: string,
  limit = 50,
  userId: string = DEFAULT_USER_ID,
) => {
  if (!db) return [];
  await ensureMaterialTables(db);
  const prisma = getPrismaClient(db);
  const rows = await prisma.materialIngestJob.findMany({
    where: {
      ...(learningId ? { learningId } : {}),
      OR: [{ userId: null }, { userId }],
    },
    orderBy: { updatedAt: "desc" },
    take: limit,
  });
  return rows.map((row) => mapIngestJob(row as unknown as IngestJobRow));
};
