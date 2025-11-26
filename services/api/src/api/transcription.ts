import type { AppBindings } from "../core/types";
import { transcribeWithOpenAi, type DataUrlPayload } from "./openai";

export interface TranscriptionResult {
  text: string;
  engine: string;
  model?: string;
  segments?: { start: number; end: number; text: string }[];
  subtitleSrt?: string;
  subtitles?: { format: "srt"; value: string };
}

export const performTranscription = async (
  env: AppBindings | undefined,
  payload: DataUrlPayload,
  options?: {
    fileName?: string;
    includeSegments?: boolean;
    preferredEngine?: string;
    preferOffline?: boolean;
  },
): Promise<TranscriptionResult> => {
  // Current offline placeholder handling logic should be moved here or kept in ingest?
  // Ingest was handling "offline" by summarizing a placeholder string.
  // Real offline transcription (Whisper locally) is hard in Worker.
  // We will stick to OpenAI for now, but add the structure for others.
  
  const useOpenAi = !!env?.OPENAI_API_KEY && !options?.preferOffline;

  if (useOpenAi) {
    try {
      const result = await transcribeWithOpenAi(env, payload, {
        fileName: options?.fileName,
        includeSegments: options?.includeSegments,
      });
      return {
        text: result.text,
        engine: "openai_whisper",
        model: result.model,
        segments: result.segments,
        subtitleSrt: result.subtitleSrt,
        subtitles: result.subtitleSrt ? { format: "srt", value: result.subtitleSrt } : undefined,
      };
    } catch (error) {
      console.error("OpenAI Transcription failed", error);
      throw error;
    }
  }

  // Fallback or Offline
  // Since we don't have a real local whisper, we throw or return a placeholder if the caller expects it.
  // However, the caller (ingest.ts) logic for offline was "summarize a placeholder".
  // We can throw here and let ingest handle the fallback, OR return a special "offline" result.
  // To keep this function pure "transcription", if we can't transcribe, we should throw.
  // But if options.preferOffline is true, maybe we return a dummy?
  
  throw new Error("No suitable transcription engine available (Offline mode not fully supported for actual transcription yet)");
};
