import type { AppBindings } from "../core/types";
import { visionOcrWithOpenAi } from "./openai";
import { encodeDataUrlFromBytes } from "./utils";

export interface OcrResult {
  text: string;
  engine: string;
  model?: string;
  confidence?: number;
}

export const performOcr = async (
  env: AppBindings | undefined,
  bytes: Uint8Array,
  mimeType: string,
): Promise<OcrResult> => {
  if (!env?.OPENAI_API_KEY) {
    throw new Error("OCR requires OPENAI_API_KEY configuration.");
  }

  // OpenAI Vision
  const dataUrl = encodeDataUrlFromBytes(bytes, mimeType);
  const { text, model } = await visionOcrWithOpenAi(env, dataUrl);
  
  return {
    text,
    engine: "openai_vision",
    model,
  };
};
