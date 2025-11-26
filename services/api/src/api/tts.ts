import { createPrismaClient } from "../core/prisma";
import type { AppBindings } from "../core/types";
import type { RichContentDocument, RichListBlock } from "@theteacher/shared";
import { generateSpeechWithOpenAi } from "./openai";

interface TtsJob {
  generatedContentId: string;
  userId: string;
  env: AppBindings;
  db: D1Database;
}

const ttsQueue: TtsJob[] = [];
let isProcessingTts = false;

export const enqueueTtsJob = (job: TtsJob, executionCtx: ExecutionContext) => {
  ttsQueue.push(job);
  if (!isProcessingTts) {
    executionCtx.waitUntil(drainTtsQueue());
  }
};

const drainTtsQueue = async () => {
  if (isProcessingTts) return;
  isProcessingTts = true;

  while (ttsQueue.length > 0) {
    const job = ttsQueue.shift();
    if (!job) break;
    try {
      await processTtsJob(job);
    } catch (error) {
      console.error("TTS Job failed", error);
    }
  }
  isProcessingTts = false;
};

const processTtsJob = async ({ generatedContentId, userId, env, db }: TtsJob) => {
  const prisma = createPrismaClient(db);
  
  const content = await prisma.generatedContent.findUnique({
    where: { id: generatedContentId },
  });

  if (!content || content.userId !== userId) return;
  
  const payload = content.content as unknown as RichContentDocument;
  
  // Only process podcast scripts
  // We might want to support other types later, but for now:
  if (content.type !== "podcast_script") return;

  const listBlock = payload.blocks.find((b) => b.type === "list") as RichListBlock | undefined;
  if (!listBlock) return;

  let updated = false;
  const newItems = [];

  for (const item of listBlock.items) {
    // Skip if it's a string, has no body (text to speak), or already has audio
    if (typeof item === "string" || !item.body || item.audioUrl) {
      newItems.push(item);
      continue;
    }

    // Determine voice based on simple heuristics
    // Host -> Onyx (Male), Guest -> Nova (Female)
    const title = item.title?.toLowerCase() || "";
    const voice = (title.includes("host") || title.includes("ホスト") || title.includes("sensei") || title.includes("先生")) 
      ? "onyx" 
      : "nova";

    try {
      const { buffer } = await generateSpeechWithOpenAi(env, item.body, voice);
      const key = `tts/${generatedContentId}/${crypto.randomUUID()}.mp3`;
      
      await env.MATERIALS_BUCKET.put(key, buffer, {
         httpMetadata: { contentType: "audio/mpeg" },
      });
      
      const audioUrl = `/api/files/${encodeURIComponent(key)}`;
      newItems.push({ ...item, audioUrl });
      updated = true;
    } catch (e) {
      console.error("TTS generation failed for segment", e);
      newItems.push(item);
    }
  }

  if (updated) {
    const newBlocks = payload.blocks.map(b => b === listBlock ? { ...listBlock, items: newItems } : b);
    await prisma.generatedContent.update({
      where: { id: generatedContentId },
      data: {
        content: { ...payload, blocks: newBlocks } as any,
      },
    });
  }
};
