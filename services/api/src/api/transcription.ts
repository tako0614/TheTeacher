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
  const preferred = options?.preferredEngine?.trim();
  const preferOffline = options?.preferOffline ?? false;

  if (preferOffline) {
    throw new Error("Offline transcription is not available in this environment");
  }

  const shouldUseOpenAi =
    (!preferred || preferred === "openai_whisper" || preferred === "whisper_rs") &&
    !!env?.OPENAI_API_KEY;

  if (shouldUseOpenAi) {
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

  if (preferred) {
    throw new Error(`No suitable transcription engine available: ${preferred}`);
  }
  throw new Error("No suitable transcription engine available");
};
