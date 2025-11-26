import type { D1Database } from "@cloudflare/workers-types";
import type {
  ExtractedSummary,
  IngestJob,
  IngestSource,
  IngestStep,
  Material,
  MaterialIngestRequest,
  MaterialLibraryEntry,
} from "@theteacher/shared";
import type * as PdfJs from "pdfjs-dist/legacy/build/pdf.mjs";

import { fetchIngestJob, fetchLibraryAsset, fetchLibraryEntryById, saveIngestJob } from "../core/library";
import { getPrismaClient, nowIso } from "../core/prisma";
import type { AppBindings } from "../core/types";
import { applyMaterialMetadataPatch, fetchMaterial } from "./data";
import {
  attachEmbeddingsToChunks,
  chunkMaterialText,
  type MaterialChunkRecord,
} from "./embeddings";
import { transcribeWithOpenAi, visionOcrWithOpenAi, type DataUrlPayload } from "./openai";
import { countTokens, summarizeText } from "./utils";

export interface LibraryAssetPayload {
  bytes: Uint8Array;
  mimeType: string;
  size: number;
  fileName?: string;
}

export const buildLibraryAssetPayload = (
  payload?: MaterialIngestRequest["payload"],
): LibraryAssetPayload | null => {
  if (!payload) return null;
  if (payload.dataUrl) {
    const decoded = decodeDataUrl(payload.dataUrl);
    return {
      bytes: decoded.bytes,
      mimeType: decoded.mimeType,
      size: decoded.size,
      fileName: payload.fileName,
    };
  }
  if (payload.text) {
    const encoder = new TextEncoder();
    const encoded = encoder.encode(payload.text);
    return {
      bytes: encoded,
      mimeType: payload.mimeType ?? "text/plain; charset=utf-8",
      size: encoded.byteLength,
      fileName: payload.fileName,
    };
  }
  return null;
};

export const ingestStepTemplates: Record<
  IngestSource["kind"] | "fallback",
  IngestJob["steps"]
> = {
  pdf: [
    { id: "download", label: "クラウド保存", kind: "download", status: "pending" },
    { id: "ocr", label: "ページOCR", kind: "ocr", status: "pending" },
    { id: "chunk", label: "チャンク生成", kind: "chunking", status: "pending" },
    { id: "embed", label: "埋め込み", kind: "embedding", status: "pending" },
  ],
  image: [
    { id: "download", label: "クラウド保存", kind: "download", status: "pending" },
    { id: "ocr", label: "OCR", kind: "ocr", status: "pending" },
    { id: "chunk", label: "チャンク生成", kind: "chunking", status: "pending" },
    { id: "embed", label: "埋め込み", kind: "embedding", status: "pending" },
  ],
  audio: [
    { id: "download", label: "クラウド保存", kind: "download", status: "pending" },
    { id: "transcription", label: "文字起こし", kind: "transcription", status: "pending" },
    { id: "chunk", label: "チャンク生成", kind: "chunking", status: "pending" },
    { id: "embed", label: "埋め込み", kind: "embedding", status: "pending" },
  ],
  video: [
    { id: "download", label: "クラウド保存", kind: "download", status: "pending" },
    { id: "transcription", label: "音声/字幕抽出", kind: "transcription", status: "pending" },
    { id: "chunk", label: "チャンク生成", kind: "chunking", status: "pending" },
    { id: "embed", label: "埋め込み", kind: "embedding", status: "pending" },
  ],
  url: [
    { id: "download", label: "スクレイピング", kind: "download", status: "pending" },
    { id: "meta", label: "本文抽出", kind: "metadata", status: "pending" },
    { id: "chunk", label: "チャンク生成", kind: "chunking", status: "pending" },
    { id: "embed", label: "埋め込み", kind: "embedding", status: "pending" },
  ],
  text: [
    { id: "chunk", label: "チャンク生成", kind: "chunking", status: "pending" },
    { id: "embed", label: "埋め込み", kind: "embedding", status: "pending" },
  ],
  fallback: [{ id: "chunk", label: "チャンク生成", kind: "chunking", status: "pending" }],
};

export const PREPROCESS_STEP_KINDS = new Set<IngestStep["kind"]>([
  "download",
  "ocr",
  "transcription",
  "metadata",
]);

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

const createDeferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

interface IngestQueueItem {
  db: D1Database;
  jobId: string;
  materialId: string;
  learningId?: string;
  text?: string | null;
  env?: AppBindings;
}

const ingestQueue: (IngestQueueItem & { deferred: Deferred<void> })[] = [];
let ingestQueueRunning = false;

const persistChunkMetadata = async (
  db: D1Database,
  materialId: string,
  jobId: string,
  chunks: MaterialChunkRecord[],
) => {
  const totalTokens = chunks.reduce((sum, chunk) => sum + chunk.tokens, 0);
  const chunkSummaries = chunks.map(({ embedding, ...rest }) => {
    void embedding;
    return rest;
  });
  const now = nowIso();
  await applyMaterialMetadataPatch(db, materialId, (metadata = {}) => ({
    ...metadata,
    chunking: {
      jobId,
      chunkCount: chunks.length,
      totalTokens,
      updatedAt: now,
    },
    chunks: chunkSummaries,
    lastChunkedAt: now,
  }));
};

const persistEmbeddingMetadata = async (
  db: D1Database,
  materialId: string,
  jobId: string,
  chunks: MaterialChunkRecord[],
  meta: { dimension: number; provider: string; model?: string },
) => {
  const now = nowIso();
  await applyMaterialMetadataPatch(db, materialId, (metadata = {}) => ({
    ...metadata,
    chunkEmbeddings: chunks.map((chunk) => ({
      id: chunk.id,
      order: chunk.order,
      embedding: chunk.embedding,
    })),
    embedding: {
      jobId,
      dimension: meta.dimension,
      chunkCount: chunks.length,
      provider: meta.provider,
      model: meta.model,
      updatedAt: now,
    },
    embeddingReadyAt: now,
  }));
};

export const enqueueIngestJobProcessing = (item: IngestQueueItem) => {
  const deferred = createDeferred<void>();
  ingestQueue.push({ ...item, deferred });
  drainIngestQueue();
  return deferred.promise;
};

const drainIngestQueue = () => {
  if (ingestQueueRunning) return;
  const next = ingestQueue.shift();
  if (!next) return;
  ingestQueueRunning = true;
  processIngestQueueItem(next)
    .then(() => next.deferred.resolve())
    .catch((error) => {
      console.error("ingest pipeline crashed", error);
      next.deferred.reject(error);
    })
    .finally(() => {
      ingestQueueRunning = false;
      drainIngestQueue();
    });
};

const processIngestQueueItem = async (item: IngestQueueItem & { deferred: Deferred<void> }) => {
  let job = await fetchIngestJob(item.db, item.jobId);
  if (!job) return;
  let material = await fetchMaterial(item.db, item.materialId);
  if (!material) {
    job = setJobStatus(job, "failed");
    await saveIngestJob(item.db, job);
    return;
  }

  const metadata = (material.metadata ?? {}) as Record<string, unknown>;
  const libraryEntryId =
    typeof metadata.libraryEntryId === "string" ? metadata.libraryEntryId : undefined;
  const payloadEncoding =
    typeof metadata.payloadEncoding === "string" ? metadata.payloadEncoding : undefined;
  const preferOffline = (job.notes ?? "").includes("prefer_offline");

  let entry: MaterialLibraryEntry | null = null;
  let asset:
    | {
        bytes: Uint8Array;
        mimeType: string;
        fileName?: string;
      }
    | null = null;
  let cachedChunks: MaterialChunkRecord[] | undefined;
  let ocrDetails: Record<string, unknown> | undefined;
  let transcriptionDetails:
    | (Record<string, unknown> & { subtitleSrt?: string; subtitles?: { format: "srt"; value: string } })
    | undefined;
  const state = {
    text: (item.text ?? material.rawContent ?? "").trim() || undefined,
  };

  const loadAsset = async () => {
    if (asset) return;
    if (!libraryEntryId) return;
    entry = entry ?? (await fetchLibraryEntryById(item.db, libraryEntryId));
    const stored = await fetchLibraryAsset(item.db, libraryEntryId);
    if (!stored?.data) return;
    const bytes = new Uint8Array(stored.data);
    asset = {
      bytes,
      mimeType: stored.mimeType,
      fileName: entry?.displayName ?? (metadata.payloadFileName as string | undefined),
    };
    const treatAsText =
      payloadEncoding === "text" || stored.mimeType.startsWith("text/");
    if (!state.text && treatAsText) {
      try {
        state.text = new TextDecoder().decode(bytes).trim();
      } catch {
        state.text = undefined;
      }
    }
  };

  const failJob = async (stepId: string | undefined, message: string) => {
    if (stepId) {
      job = setJobStepStatus(job, stepId, "failed", message);
    }
    job = setJobStatus(job, "failed");
    await saveIngestJob(item.db, job);
  };

  const ensureTextAvailable = () => {
    if (!state.text) {
      throw new Error("material_missing_raw_content");
    }
  };

  const stepHandlers: Record<IngestStep["kind"], () => Promise<void>> = {
    download: async () => {
      if (state.text) return;
      await loadAsset();
      if (!asset && !state.text) {
        throw new Error("library_asset_missing");
      }
    },
    ocr: async () => {
      if (state.text) return;
      await loadAsset();
      if (!asset) {
        throw new Error("ocr_asset_missing");
      }
      if (asset.mimeType.includes("pdf") || job.source.kind === "pdf") {
        const text = await extractTextFromPdfBytes(asset.bytes);
        if (text && text.trim().length > 0) {
          state.text = text;
          ocrDetails = {
            engine: job.preferredOcrEngine ?? "pdfjs",
          };
          return;
        }
        if (preferOffline) {
          throw new Error("ocr_pdf_empty");
        }
        const dataUrl = encodeDataUrlFromBytes(asset.bytes, asset.mimeType);
        const { text: visionText, model } = await visionOcrWithOpenAi(item.env, dataUrl);
        if (!visionText) {
          throw new Error("ocr_pdf_empty");
        }
        state.text = visionText;
        ocrDetails = {
          engine: job.preferredOcrEngine ?? "openai_vision",
          model,
        };
        return;
      }
      if (preferOffline) {
        state.text = summarizeText(
          `[image_offline_ocr] ${asset.fileName ?? job.source.path ?? "image"}`,
        );
        ocrDetails = {
          engine: job.preferredOcrEngine ?? "native_tesseract",
        };
        return;
      }
      const dataUrl = encodeDataUrlFromBytes(asset.bytes, asset.mimeType);
      const { text, model } = await visionOcrWithOpenAi(item.env, dataUrl);
      if (!text) {
        throw new Error("ocr_result_empty");
      }
      state.text = text;
      ocrDetails = {
        engine: job.preferredOcrEngine ?? "openai_vision",
        model,
      };
    },
    transcription: async () => {
      if (state.text) return;
      await loadAsset();
      if (!asset) {
        throw new Error("transcription_asset_missing");
      }
      const transcriptionEngine = preferOffline
        ? job.preferredTranscriptionEngine ?? "whisper_rs"
        : "openai_whisper";
      if (preferOffline) {
        state.text = summarizeText(
          `[transcription_pending_offline] ${asset.fileName ?? job.source.path ?? "audio"}`,
        );
        transcriptionDetails = {
          engine: transcriptionEngine,
        };
        return;
      }
      const payload = {
        mimeType: asset.mimeType,
        bytes: asset.bytes,
        size: asset.bytes.byteLength,
      };
      const includeSegments = job.source.kind === "video";
      const { text, model, subtitleSrt } = await transcribeWithOpenAi(item.env, payload, {
        fileName: asset.fileName,
        includeSegments,
      });
      if (!text) {
        throw new Error("transcription_empty");
      }
      state.text = text;
      transcriptionDetails = {
        engine: transcriptionEngine,
        model,
        subtitleSrt,
        subtitles: subtitleSrt ? { format: "srt", value: subtitleSrt } : undefined,
      };
    },
    metadata: async () => {
      ensureTextAvailable();
      material = await persistMaterialRawContent(
        item.db,
        material,
        state.text!,
        detectExtractedFormat(job.source.kind),
        {
          ocr: ocrDetails,
          transcription: transcriptionDetails,
        },
        transcriptionDetails?.subtitles ? { subtitles: transcriptionDetails.subtitles } : undefined,
      );
    },
    chunking: async () => {
      ensureTextAvailable();
      const generated = chunkMaterialText(state.text!);
      if (!generated.length) {
        throw new Error("chunk_generation_empty");
      }
      cachedChunks = generated;
      await persistChunkMetadata(item.db, item.materialId, job.id, generated);
    },
    embedding: async () => {
      const preparedChunks = cachedChunks ?? chunkMaterialText(state.text ?? "");
      if (!preparedChunks.length) {
        throw new Error("embedding_missing_chunks");
      }
      const prepared = await attachEmbeddingsToChunks(preparedChunks, item.env);
      await persistEmbeddingMetadata(item.db, item.materialId, job.id, prepared.chunks, {
        dimension: prepared.dimension,
        provider: prepared.provider,
        model: prepared.model,
      });
    },
  };

  for (const step of job.steps) {
    if (step.status === "succeeded") continue;
    if (step.status === "failed") return;
    const handler = stepHandlers[step.kind];
    if (!handler) continue;

    if (step.status === "pending") {
      job = setJobStepStatus(job, step.id, "running");
      job = await saveIngestJob(item.db, job);
    }

    try {
      await handler();
      job = await saveIngestJob(item.db, setJobStepStatus(job, step.id, "succeeded"));
    } catch (error) {
      const message = error instanceof Error ? error.message : "pipeline_step_failed";
      await failJob(step.id, message);
      return;
    }
  }

  if (job.steps.every((step) => step.status === "succeeded")) {
    job = setJobStatus(job, "completed");
    await saveIngestJob(item.db, job);
  }
};

const stripHtml = (value: string) =>
  value
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const extractHtmlSummary = (html: string) => {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const metaDescriptionMatch =
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ??
    html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);
  const title = titleMatch?.[1]?.trim();
  const description = metaDescriptionMatch?.[1]?.trim();
  const cleaned = stripHtml(html);
  return [title, description, cleaned].filter(Boolean).join("\n").slice(0, 16_000);
};

const fetchRemoteText = async (url: string): Promise<string> => {
  const res = await fetch(url, { method: "GET" });
  if (!res.ok) throw new Error(`failed to fetch ${url}: ${res.status}`);
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const json = await res.json().catch(() => null);
    return typeof json === "string" ? json : JSON.stringify(json ?? {});
  }
  const raw = await res.text();
  if (contentType.includes("html")) return extractHtmlSummary(raw);
  return raw.slice(0, 16_000);
};

const MAX_MEDIA_BYTES = 25 * 1024 * 1024;
const isHttpUrl = (value?: string) => typeof value === "string" && /^https?:\/\//i.test(value);

const decodeBase64 = (value: string) => {
  if (typeof atob === "function") return atob(value);
  const globalBuffer = (globalThis as {
    Buffer?: { from(input: string, encoding: string): { toString(encoding: string): string } };
  }).Buffer;
  if (globalBuffer) {
    return globalBuffer.from(value, "base64").toString("binary");
  }
  throw new Error("base64 decoding is not supported in this environment");
};

export const decodeDataUrl = (dataUrl: string): DataUrlPayload => {
  const match = dataUrl.match(/^data:(.+?);base64,(.+)$/i);
  if (!match) {
    throw new Error("invalid data url payload");
  }
  const [, mimeType, base64Content] = match;
  const normalized = base64Content.replace(/\s/g, "");
  const binary = decodeBase64(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return {
    mimeType: mimeType || "application/octet-stream",
    bytes,
    size: bytes.byteLength,
  };
};

export const fetchRemoteBinary = async (
  url: string,
  sizeLimit = MAX_MEDIA_BYTES,
): Promise<DataUrlPayload> => {
  const res = await fetch(url, { method: "GET" });
  if (!res.ok) {
    throw new Error(`failed to fetch ${url}: ${res.status}`);
  }
  const declaredSize = res.headers.get("content-length");
  const contentLength = declaredSize ? Number(declaredSize) : undefined;
  if (typeof contentLength === "number" && Number.isFinite(contentLength) && contentLength > sizeLimit) {
    throw new Error(
      `媒体ファイルが大きすぎます (${(contentLength / 1024 / 1024).toFixed(1)} MB)。${(
        sizeLimit / 1024 / 1024
      ).toFixed(0)}MB 以内にしてください。`,
    );
  }
  const arrayBuffer = await res.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  if (bytes.byteLength > sizeLimit) {
    throw new Error(
      `媒体ファイルが大きすぎます (${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB)。${(
        sizeLimit / 1024 / 1024
      ).toFixed(0)}MB 以内にしてください。`,
    );
  }
  const mimeType = res.headers.get("content-type") ?? "application/octet-stream";
  return {
    mimeType,
    bytes,
    size: bytes.byteLength,
  };
};

export const encodeBase64 = (bytes: Uint8Array) => {
  if (typeof btoa === "function") {
    let binary = "";
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return btoa(binary);
  }
  const buffer = (globalThis as {
    Buffer?: { from(input: Uint8Array): { toString(encoding: string): string } };
  }).Buffer;
  if (buffer) {
    return buffer.from(bytes).toString("base64");
  }
  throw new Error("base64 encoding is not supported in this environment");
};

export const encodeDataUrlFromBytes = (bytes: Uint8Array, mimeType: string) =>
  `data:${mimeType || "application/octet-stream"};base64,${encodeBase64(bytes)}`;

type PdfJsLib = typeof PdfJs;
let pdfjsLibPromise: Promise<PdfJsLib> | null = null;

const loadPdfjs = async (): Promise<PdfJsLib> => {
  if (!pdfjsLibPromise) {
    pdfjsLibPromise = import("pdfjs-dist/legacy/build/pdf.mjs").then((mod) => {
      if (mod.GlobalWorkerOptions) {
        mod.GlobalWorkerOptions.workerSrc = undefined;
      }
      return mod as PdfJsLib;
    });
  }
  return pdfjsLibPromise;
};

const extractTextFromPdfBytes = async (bytes: Uint8Array): Promise<string> => {
  const pdfjs = await loadPdfjs();
  const document = await pdfjs.getDocument({ data: bytes }).promise;
  const totalPages = Math.min(document.numPages, 10);
  let text = "";
  for (let pageNumber = 1; pageNumber <= totalPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const items = content.items as ({ str?: string } | string)[];
    const pageText = items
      .map((item) =>
        typeof item === "string" ? item : typeof item?.str === "string" ? item.str : "",
      )
      .join(" ")
      .trim();
    if (pageText) {
      text += `${pageText}\n\n`;
    }
  }
  await document.destroy();
  return text.trim();
};

const detectExtractedFormat = (source: IngestSource["kind"]): ExtractedSummary["format"] => {
  if (source === "audio" || source === "video") return "transcript";
  if (source === "image" || source === "pdf") return "ocr";
  if (source === "url") return "scraped";
  return "plain";
};

export const persistMaterialRawContent = async (
  db: D1Database,
  material: Material,
  text: string,
  format: ExtractedSummary["format"],
  details?: Record<string, unknown>,
  metadataPatch?: Record<string, unknown>,
) => {
  const trimmed = text.trim();
  const updatedAt = nowIso();
  const prisma = getPrismaClient(db);
  await prisma.material.update({
    where: { id: material.id },
    data: { rawContent: trimmed, updatedAt },
  });
  const preview = summarizeText(trimmed);
  const tokens = countTokens(trimmed);
  await applyMaterialMetadataPatch(db, material.id, (metadata = {}) => ({
    ...metadata,
    ...(metadataPatch ?? {}),
    extracted: {
      preview,
      tokens,
      format,
      updatedAt,
      details,
    },
  }));
  return {
    ...material,
    rawContent: trimmed,
    metadata: {
      ...((material.metadata ?? {}) as Record<string, unknown>),
      ...(metadataPatch ?? {}),
      extracted: {
        preview,
        tokens,
        format,
        updatedAt,
        details,
      },
    },
    updatedAt,
  };
};

export const extractMaterialFromSource = async (
  source: IngestSource,
  preferOffline = false,
  payload?: MaterialIngestRequest["payload"],
  env?: AppBindings,
) => {
  const payloadText = payload?.text?.trim();
  if (payloadText) {
    const preview = summarizeText(payloadText);
    return {
      rawContent: payloadText,
      extracted: {
        preview,
        tokens: countTokens(payloadText),
        format:
          source.kind === "image"
            ? ("ocr" as const)
            : source.kind === "audio" || source.kind === "video"
              ? ("transcript" as const)
              : ("plain" as const),
      },
      metadata: {
        sourceLabel: source.kind,
        payloadFileName: payload?.fileName,
        payloadBytes: payload?.bytes,
        payloadMimeType: payload?.mimeType,
        payloadDataUrlPreview: payload?.dataUrl?.slice(0, 120),
      },
    };
  }

  const dataUrl = payload?.dataUrl;
  if (dataUrl && typeof dataUrl === "string") {
    const payloadData = payload!;
    if (source.kind === "audio" || source.kind === "video") {
      if (preferOffline) {
        const placeholder = `[transcription_pending_offline] ${payloadData.fileName ?? source.path ?? "media"}`;
        const preview = summarizeText(placeholder);
        return {
          rawContent: placeholder,
          extracted: {
            preview,
            tokens: preview.split(/\s+/).filter(Boolean).length,
            format: "transcript" as const,
          },
          metadata: {
            sourceLabel: `${source.kind}_offline`,
            payloadFileName: payloadData.fileName,
            payloadBytes: payloadData.bytes,
            payloadMimeType: payloadData.mimeType,
            payloadDataUrlPreview: dataUrl.slice(0, 120),
          },
        };
      }
      const decoded = decodeDataUrl(dataUrl);
      const includeSegments = source.kind === "video";
      const { text, model, subtitleSrt } = await transcribeWithOpenAi(env, decoded, {
        fileName: payloadData.fileName,
        includeSegments,
      });
      const preview = summarizeText(text);
      return {
        rawContent: text,
        extracted: {
          preview,
          tokens: countTokens(text),
          format: "transcript" as const,
        },
        metadata: {
          sourceLabel: `${source.kind}_transcribed`,
          payloadFileName: payloadData.fileName,
          payloadBytes: payloadData.bytes ?? decoded.size,
          payloadMimeType: payloadData.mimeType ?? decoded.mimeType,
          openAiModel: model,
          payloadDataUrlPreview: dataUrl.slice(0, 120),
          subtitles: subtitleSrt ? { format: "srt", value: subtitleSrt } : undefined,
        },
      };
    }

    if (source.kind === "image") {
      if (preferOffline) {
        const placeholder = `[image_offline_ocr] ${payloadData.fileName ?? source.path ?? "image"}`;
        const preview = summarizeText(placeholder);
        return {
          rawContent: placeholder,
          extracted: {
            preview,
            tokens: preview.split(/\s+/).filter(Boolean).length,
            format: "ocr" as const,
          },
          metadata: {
            sourceLabel: "image_ocr_offline",
            payloadFileName: payloadData.fileName,
            payloadBytes: payloadData.bytes,
            payloadMimeType: payloadData.mimeType,
            payloadDataUrlPreview: dataUrl.slice(0, 120),
          },
        };
      }
      const { text, model } = await visionOcrWithOpenAi(env, dataUrl);
      const preview = summarizeText(text);
      return {
        rawContent: text,
        extracted: {
          preview,
          tokens: countTokens(text),
          format: "ocr" as const,
        },
        metadata: {
          sourceLabel: "image_ocr",
          payloadFileName: payloadData.fileName,
          payloadBytes: payloadData.bytes,
          payloadMimeType: payloadData.mimeType,
          openAiModel: model,
          payloadDataUrlPreview: dataUrl.slice(0, 120),
        },
      };
    }
  }

  if (source.kind === "audio" || source.kind === "video") {
    const placeholder = `[transcription_pending${preferOffline ? "_offline" : ""}] ${source.path || "media"}`;
    if (preferOffline) {
      const preview = summarizeText(placeholder);
      return {
        rawContent: placeholder,
        extracted: {
          preview,
          tokens: preview.split(/\s+/).filter(Boolean).length,
          format: "transcript" as const,
        },
        metadata: { sourceLabel: `${source.kind}_offline`, payloadFileName: payload?.fileName },
      };
    }

    if (isHttpUrl(source.path)) {
      const remotePayload = await fetchRemoteBinary(source.path);
      const includeSegments = source.kind === "video";
      const { text, model, subtitleSrt } = await transcribeWithOpenAi(env, remotePayload, {
        fileName: payload?.fileName ?? source.path.split("/").pop(),
        includeSegments,
      });
      const preview = summarizeText(text);
      return {
        rawContent: text,
        extracted: {
          preview,
          tokens: countTokens(text),
          format: "transcript" as const,
        },
        metadata: {
          sourceLabel: `${source.kind}_transcribed_remote`,
          payloadFileName: payload?.fileName ?? source.path,
          payloadBytes: remotePayload.size,
          payloadMimeType: remotePayload.mimeType,
          openAiModel: model,
          subtitles: subtitleSrt ? { format: "srt", value: subtitleSrt } : undefined,
        },
      };
    }

    throw new Error("音声/動画の取り込みにはpayloadまたは有効なURLが必要です。");
  }

  if (source.kind === "text") {
    const rawContent = source.text.trim();
    const preview = summarizeText(rawContent);
    return {
      rawContent,
      extracted: {
        preview,
        tokens: rawContent.split(/\s+/).filter(Boolean).length,
        format: "plain" as const,
      },
      metadata: { sourceLabel: "text" },
    };
  }

  if (source.kind === "url") {
    const previewLabel = `URLから抽出: ${source.url}`;
    if (preferOffline) {
      return {
        rawContent: previewLabel,
        extracted: {
          preview: summarizeText(previewLabel),
          format: "scraped" as const,
        },
        metadata: { sourceLabel: "url_offline" },
      };
    }

    try {
      const fetched = await fetchRemoteText(source.url);
      const cleaned = fetched.trim();
      const preview = summarizeText(cleaned || previewLabel);
      return {
        rawContent: cleaned || previewLabel,
        extracted: {
          preview,
          tokens: cleaned.split(/\s+/).filter(Boolean).length,
          format: "scraped" as const,
        },
        metadata: { sourceLabel: "url" },
      };
    } catch (error) {
      const fallback = `${previewLabel} (取得に失敗しました: ${error instanceof Error ? error.message : "unknown error"})`;
      return {
        rawContent: fallback,
        extracted: {
          preview: summarizeText(fallback),
          format: "scraped" as const,
        },
        metadata: { sourceLabel: "url_error" },
      };
    }
  }

  const isAudio = source.kind === "audio" || source.kind === "video";
  const isOcr = source.kind === "image" || source.kind === "pdf";
  const base =
    source.path.startsWith("http") && !preferOffline
      ? `リモートファイル ${source.path} を取得しました。`
      : `[${source.kind.toUpperCase()}] ${source.path}`;
  const tail = isAudio
    ? " 音声を文字起こししたテキストを保存しています。"
    : isOcr
      ? " OCR経由で抽出したテキストです。"
      : " 教材のテキストを取り込みました。";
  const rawContent = `${base}${tail}`.trim();
  const preview = summarizeText(rawContent);
  return {
    rawContent,
    extracted: {
      preview,
      tokens: countTokens(rawContent),
      format: isAudio ? ("transcript" as const) : isOcr ? ("ocr" as const) : ("plain" as const),
    },
    metadata: { sourceLabel: source.kind, preferOffline },
  };
};

export const buildIngestJob = (
  request: MaterialIngestRequest,
  status: IngestJob["status"] = "completed",
  outputMaterialId?: string,
  libraryPath?: string,
): IngestJob => {
  const now = nowIso();
  const steps = (ingestStepTemplates[request.source.kind] ?? ingestStepTemplates.fallback).map(
    (step, index) => ({
      ...step,
      status: status === "completed" ? "succeeded" : index === 0 ? "running" : step.status,
      startedAt: status === "queued" ? undefined : now,
      finishedAt: status === "completed" ? now : undefined,
    }),
  );

  return {
    id: crypto.randomUUID(),
    learningId: request.learningId,
    source: request.source,
    status,
    requestedAt: now,
    updatedAt: now,
    preferredOcrEngine: request.ocrEngine,
    preferredTranscriptionEngine: request.transcriptionEngine,
    steps,
    notes: request.preferOffline ? "prefer_offline" : undefined,
    outputMaterialId,
    libraryPath: libraryPath ?? "materials",
  };
};

export const cloneIngestJob = (job: IngestJob): IngestJob => ({
  ...job,
  steps: job.steps.map((step) => ({ ...step })),
});

const setJobStepStatus = (
  job: IngestJob,
  stepId: string,
  status: IngestStep["status"],
  error?: string,
) => {
  const now = nowIso();
  const steps = job.steps.map((step) => {
    if (step.id !== stepId) return step;
    return {
      ...step,
      status,
      error,
      startedAt: step.startedAt ?? now,
      finishedAt: status === "succeeded" || status === "failed" ? now : undefined,
    };
  });
  return {
    ...job,
    steps,
    updatedAt: now,
  };
};

const setJobStatus = (job: IngestJob, status: IngestJob["status"]) => ({
  ...job,
  status,
  updatedAt: nowIso(),
});

export const prepareJobForProcessing = (job: IngestJob): IngestJob => {
  const now = nowIso();
  if (job.steps.some((step) => step.status === "running")) {
    return {
      ...job,
      updatedAt: now,
    };
  }
  let firstPendingMarked = false;
  const steps = job.steps.map((step) => {
    if (!firstPendingMarked && step.status === "pending") {
      firstPendingMarked = true;
      return {
        ...step,
        status: "running",
        startedAt: step.startedAt ?? now,
        error: undefined,
      };
    }
    return step;
  });
  const hasWork = steps.some((step) => step.status === "running" || step.status === "pending");
  return {
    ...job,
    steps,
    status: hasWork ? "processing" : "completed",
    updatedAt: now,
  };
};

export const buildLibraryEntryRecord = (
  material: Material,
  request: MaterialIngestRequest,
  options?: {
    entryId?: string;
    notes?: string;
    assetPath?: string;
    storageKey?: string;
    bytesOverride?: number;
  },
): MaterialLibraryEntry => {
  const originalPath =
    request.source.kind === "url"
      ? request.source.url
      : request.source.kind === "text"
        ? `${material.id}.txt`
        : request.source.path ?? material.sourcePath ?? material.id;
  const storedPath = options?.storageKey ?? originalPath;
  const displayName =
    request.payload?.fileName ??
    material.sourcePath ??
    `${material.type.toUpperCase()}_${material.id.slice(0, 8)}`;
  const inferredLibraryPath =
    options?.storageKey ??
    (request.source.kind === "text"
      ? `${material.learningId}/${material.id}.txt`
      : request.source.kind === "url"
        ? request.source.url
        : request.source.path ?? request.payload?.fileName ?? storedPath);

  return {
    id: options?.entryId ?? crypto.randomUUID(),
    userId: material.userId,
    displayName,
    storedPath,
    libraryPath: inferredLibraryPath,
    assetPath: options?.assetPath,
    type: material.type,
    bytes: request.payload?.bytes ?? options?.bytesOverride,
    learningId: material.learningId,
    materialId: material.id,
    originalSource: request.source,
    notes: options?.notes,
    createdAt: material.createdAt,
    updatedAt: material.updatedAt,
  };
};
