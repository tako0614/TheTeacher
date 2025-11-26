import type { MaterialType } from "@theteacher/shared";
import OCRAD from "ocrad.js";
import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker?url";
import { logger } from "./logger";

const { GlobalWorkerOptions, getDocument } = pdfjsLib as typeof import("pdfjs-dist");

if (GlobalWorkerOptions) {
  GlobalWorkerOptions.workerSrc = pdfjsWorker;
}

const MAX_DATA_URL_BYTES = 512_000;
const MAX_AUDIO_VIDEO_BYTES = 25 * 1024 * 1024;
const MAX_PDF_PAGES = 8;

export type ProcessedMaterial = {
  text?: string;
  dataUrl?: string;
  fileName: string;
  bytes: number;
  mimeType?: string;
};

const summarize = (text: string, limit = 2000) =>
  text.replace(/\s+/g, " ").trim().slice(0, limit);

const readFileAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

const extractPdfText = async (file: File) => {
  const buffer = await file.arrayBuffer();
  const pdf = await getDocument({ data: buffer }).promise;
  const totalPages = Math.min(pdf.numPages, MAX_PDF_PAGES);
  let text = "";

  for (let pageNumber = 1; pageNumber <= totalPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ")
      .trim();
    if (pageText) {
      text += `${pageText}\n\n`;
    }
  }

  return text.trim();
};

const extractImageText = async (file: File) => {
  if (typeof createImageBitmap === "undefined") {
    throw new Error("createImageBitmap is not available in this environment");
  }

  const imageBitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = imageBitmap.width;
  canvas.height = imageBitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("failed to initialize canvas");
  ctx.drawImage(imageBitmap, 0, 0);
  return OCRAD(canvas).trim();
};

export const processMaterialFile = async (
  file: File,
  type: MaterialType,
): Promise<ProcessedMaterial> => {
  if (type === "text") {
    const text = await file.text();
    return {
      text: summarize(text),
      fileName: file.name,
      bytes: file.size,
      mimeType: file.type || "text/plain",
    };
  }

  if (type === "pdf") {
    const text = await extractPdfText(file);
    const payload: ProcessedMaterial = {
      text: summarize(text || `[pdf] ${file.name}`),
      fileName: file.name,
      bytes: file.size,
      mimeType: file.type || "application/pdf",
    };
    if (file.size <= MAX_DATA_URL_BYTES) {
      try {
        payload.dataUrl = await readFileAsDataUrl(file);
      } catch (error) {
        logger.warn("Failed to capture PDF data URL", "FileProcessing", error);
      }
    }
    return payload;
  }

  if (type === "image") {
    let text = "";
    try {
      text = await extractImageText(file);
    } catch (error) {
      logger.warn("OCR failed", "FileProcessing", error);
    }

    const payload: ProcessedMaterial = {
      text: text || `[image] ${file.name}`,
      fileName: file.name,
      bytes: file.size,
      mimeType: file.type || "image/*",
    };

    if (file.size <= MAX_DATA_URL_BYTES) {
      try {
        payload.dataUrl = await readFileAsDataUrl(file);
      } catch (error) {
        logger.warn("Failed to capture image data URL", "FileProcessing", error);
      }
    }

    return payload;
  }

  if (type === "audio" || type === "video") {
    if (file.size > MAX_AUDIO_VIDEO_BYTES) {
      throw new Error(
        `ファイルサイズが大きすぎます (${(file.size / 1024 / 1024).toFixed(1)} MB)。${(
          MAX_AUDIO_VIDEO_BYTES / 1024 / 1024
        ).toFixed(0)}MB 以内にしてください。`,
      );
    }

    const payload: ProcessedMaterial = {
      fileName: file.name,
      bytes: file.size,
      mimeType: file.type || `${type}/*`,
    };

    try {
      payload.dataUrl = await readFileAsDataUrl(file);
    } catch (error) {
      logger.warn("Failed to encode media as data URL", "FileProcessing", error);
      throw new Error("音声/動画を読み込めませんでした。もう一度お試しください。");
    }

    return payload;
  }

  return {
    text: `[${type}] ${file.name}`,
    fileName: file.name,
    bytes: file.size,
    mimeType: file.type || "application/octet-stream",
  };
};
