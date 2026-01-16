import type { MaterialIngestRequest } from "@theteacher/shared";

import { requestJson, requestRaw } from "./http";
import { logger } from "./logger";

export type LibraryUploadResult = {
  payload: Pick<NonNullable<MaterialIngestRequest["payload"]>, "libraryEntryId" | "fileName" | "bytes" | "mimeType">;
};

export const uploadFileToLibrary = async (
  file: File,
  options?: { onProgress?: (progress: { uploadedBytes: number; totalBytes: number }) => void },
): Promise<LibraryUploadResult> => {
  const session = await requestJson<{ sessionId: string; entryId: string; chunkSize?: number }>({
    path: "/api/materials/library/uploads",
    method: "POST",
    body: {
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      size: file.size,
    },
  });

  const chunkSize = session.chunkSize && session.chunkSize > 0 ? session.chunkSize : 5 * 1024 * 1024;
  const totalParts = Math.max(1, Math.ceil(file.size / chunkSize));
  let uploadedBytes = 0;

  try {
    for (let idx = 0; idx < totalParts; idx += 1) {
      const start = idx * chunkSize;
      const end = Math.min(file.size, start + chunkSize);
      const buffer = await file.slice(start, end).arrayBuffer();
      const res = await requestRaw({
        path: `/api/materials/library/uploads/${session.sessionId}/parts/${idx + 1}`,
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream" },
        body: new Uint8Array(buffer),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        throw new Error(`upload part failed (${res.status}): ${text}`);
      }

      uploadedBytes += end - start;
      options?.onProgress?.({ uploadedBytes, totalBytes: file.size });
    }

    const completed = await requestJson<{ entryId: string }>({
      path: `/api/materials/library/uploads/${session.sessionId}/complete`,
      method: "POST",
      body: {},
    });

    return {
      payload: {
        libraryEntryId: completed.entryId,
        fileName: file.name,
        bytes: file.size,
        mimeType: file.type || "application/octet-stream",
      },
    };
  } catch (error) {
    logger.warn("Chunk upload failed, aborting session", "LibraryUpload", error);
    await requestJson({
      path: `/api/materials/library/uploads/${session.sessionId}`,
      method: "DELETE",
      body: {},
    }).catch(() => undefined);
    throw error;
  }
};

