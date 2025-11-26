import {
  type IngestJob,
  type IngestSource,
  type MaterialIngestRequest,
  type MaterialLibraryConfig,
  type MaterialLibraryEntry,
} from "@theteacher/shared";

export const materialIngestPresets: Array<{
  id: string;
  label: string;
  description: string;
  request: MaterialIngestRequest;
}> = [
  {
    id: "pdf",
    label: "PDF / スライド",
    description: "ページ分割→OCR(Vision API)→チャンクと埋め込み",
    request: {
      source: { kind: "pdf", path: "" },
      preferOffline: false,
      ocrEngine: "openai_vision",
    },
  },
  {
    id: "image",
    label: "画像 / スキャン",
    description: "単一画像をOCR(Vision API)しテキスト化",
    request: {
      source: { kind: "image", path: "" },
      preferOffline: false,
      ocrEngine: "openai_vision",
    },
  },
  {
    id: "audio",
    label: "音声 / ポッドキャスト",
    description: "Whisper(API)で文字起こし→チャンク",
    request: {
      source: { kind: "audio", path: "" },
      preferOffline: false,
      transcriptionEngine: "whisper_rs",
    },
  },
  {
    id: "video",
    label: "動画",
    description: "音声抽出+字幕→Whisper(API)→チャンク",
    request: {
      source: { kind: "video", path: "" },
      preferOffline: false,
      transcriptionEngine: "whisper_rs",
    },
  },
  {
    id: "url",
    label: "URL / 記事",
    description: "本文抽出→整形→チャンク",
    request: {
      source: { kind: "url", url: "" },
      preferOffline: false,
    },
  },
];

const stepTemplates: Record<
  IngestSource["kind"] | "fallback",
  IngestJob["steps"]
> = {
  text: [
     { id: "chunk", label: "チャンク生成", kind: "chunking", status: "pending" },
     { id: "embed", label: "埋め込み", kind: "embedding", status: "pending" },
     { id: "meta", label: "メタデータ", kind: "metadata", status: "pending" },
  ],
  pdf: [
    {
      id: "download",
      label: "クラウド保存",
      kind: "download",
      status: "pending",
    },
    { id: "ocr", label: "ページOCR", kind: "ocr", status: "pending" },
    { id: "chunk", label: "チャンク生成", kind: "chunking", status: "pending" },
    { id: "embed", label: "埋め込み", kind: "embedding", status: "pending" },
    { id: "meta", label: "メタデータ", kind: "metadata", status: "pending" },
  ],
  image: [
    {
      id: "download",
      label: "クラウド保存",
      kind: "download",
      status: "pending",
    },
    { id: "ocr", label: "OCR", kind: "ocr", status: "pending" },
    { id: "chunk", label: "チャンク生成", kind: "chunking", status: "pending" },
    { id: "embed", label: "埋め込み", kind: "embedding", status: "pending" },
  ],
  audio: [
    {
      id: "download",
      label: "クラウド保存",
      kind: "download",
      status: "pending",
    },
    {
      id: "transcription",
      label: "文字起こし",
      kind: "transcription",
      status: "pending",
    },
    { id: "chunk", label: "チャンク生成", kind: "chunking", status: "pending" },
    { id: "embed", label: "埋め込み", kind: "embedding", status: "pending" },
  ],
  video: [
    {
      id: "download",
      label: "クラウド保存",
      kind: "download",
      status: "pending",
    },
    {
      id: "transcription",
      label: "音声/字幕抽出",
      kind: "transcription",
      status: "pending",
    },
    { id: "chunk", label: "チャンク生成", kind: "chunking", status: "pending" },
    { id: "embed", label: "埋め込み", kind: "embedding", status: "pending" },
  ],
  url: [
    {
      id: "download",
      label: "スクレイピング",
      kind: "download",
      status: "pending",
    },
    { id: "meta", label: "本文抽出", kind: "metadata", status: "pending" },
    { id: "chunk", label: "チャンク生成", kind: "chunking", status: "pending" },
    { id: "embed", label: "埋め込み", kind: "embedding", status: "pending" },
  ],
  fallback: [
    {
      id: "download",
      label: "クラウド保存",
      kind: "download",
      status: "pending",
    },
    { id: "chunk", label: "チャンク生成", kind: "chunking", status: "pending" },
  ],
};

export const resolveLibraryConfig = async (): Promise<MaterialLibraryConfig> => {
  return {
    rootDir: "/api/materials/library",
    tempDir: "/api/materials/library/tmp",
    indexFile: "/api/materials/library/material-index.json",
  };
};

export const bootstrapJobFromRequest = (
  request: MaterialIngestRequest,
  library: MaterialLibraryConfig,
  status: IngestJob["status"] = "queued",
): IngestJob => {
  const now = new Date().toISOString();
  const steps =
    stepTemplates[request.source.kind] ?? stepTemplates.fallback;

  return {
    id: crypto.randomUUID(),
    status,
    source: request.source,
    requestedAt: now,
    updatedAt: now,
    preferredOcrEngine: request.ocrEngine,
    preferredTranscriptionEngine: request.transcriptionEngine,
    steps,
    libraryPath: library.rootDir,
    notes: status === "queued" ? "ingest_queue" : undefined,
  };
};

export const sampleLibraryEntries: MaterialLibraryEntry[] = [
  {
    id: "00000000-0000-0000-0000-000000000001",
    displayName: "二次関数_講義スライド.pdf",
    storedPath: "materials/math/quadratic.pdf",
    assetPath: "/sample/materials/math/quadratic.pdf",
    libraryPath: "materials/math/quadratic.pdf",
    learningId: "11111111-1111-1111-1111-111111111111",
    materialId: "22222222-2222-2222-2222-222222222221",
    type: "pdf",
    bytes: 2_485_000,
    createdAt: "2024-10-30T12:00:00.000Z",
    updatedAt: "2024-10-30T12:30:00.000Z",
  },
  {
    id: "00000000-0000-0000-0000-000000000002",
    displayName: "板書_スクショ.png",
    storedPath: "materials/math/board.png",
    assetPath: "/sample/materials/math/board.png",
    libraryPath: "materials/math/board.png",
    learningId: "11111111-1111-1111-1111-111111111111",
    materialId: "22222222-2222-2222-2222-222222222222",
    type: "image",
    bytes: 430_000,
    createdAt: "2024-11-01T03:00:00.000Z",
    updatedAt: "2024-11-01T03:05:00.000Z",
  },
  {
    id: "00000000-0000-0000-0000-000000000003",
    displayName: "Podcast_試作.wav",
    storedPath: "materials/audio/podcast.wav",
    assetPath: "/sample/materials/audio/podcast.wav",
    libraryPath: "materials/audio/podcast.wav",
    learningId: "11111111-1111-1111-1111-111111111111",
    materialId: "22222222-2222-2222-2222-222222222223",
    type: "audio",
    bytes: 9_200_000,
    createdAt: "2024-11-02T04:10:00.000Z",
    updatedAt: "2024-11-02T04:12:00.000Z",
  },
];
