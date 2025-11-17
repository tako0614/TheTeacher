import {
  For,
  Show,
  createMemo,
  createSignal,
  onMount,
  type Component,
} from "solid-js";
import {
  type IngestJob,
  type MaterialIngestRequest,
  type MaterialLibraryConfig,
  type Preset,
} from "@theteacher/shared";

import {
  bootstrapJobFromRequest,
  materialIngestPresets,
  resolveLibraryConfig,
  sampleLibraryEntries,
} from "../lib/materials";

import {
  type SemanticMatch,
  type ToolCallLog,
  proxyChat,
  semanticSearch,
} from "../lib/ai";
import { buildBackupSnapshot, downloadSnapshot, parseSnapshotFile } from "../lib/backup";
import { useSettings } from "../lib/settings-store";
import { useLocalDb } from "../local-db";

type LearningCard = {
  id: string;
  title: string;
  subject: string;
  tags: string[];
  progress: number;
  lastStudied: string;
  generated: { qa: number; practice: number; summary: number };
};

const learningCards: LearningCard[] = [
  {
    id: "l1",
    title: "高校数学I_二次関数_第1回",
    subject: "math",
    tags: ["二次関数", "基礎"],
    progress: 0.42,
    lastStudied: "2024-11-02 21:00",
    generated: { qa: 6, practice: 2, summary: 1 },
  },
  {
    id: "l2",
    title: "英語長文_時制の一致",
    subject: "english",
    tags: ["読解", "文法"],
    progress: 0.68,
    lastStudied: "2024-11-01 10:15",
    generated: { qa: 10, practice: 4, summary: 2 },
  },
  {
    id: "l3",
    title: "物理_電磁気_公式暗記リスト",
    subject: "science",
    tags: ["暗記", "電磁気"],
    progress: 0.2,
    lastStudied: "2024-10-30 07:30",
    generated: { qa: 3, practice: 0, summary: 0 },
  },
];

const subjects = [
  { id: "all", label: "すべて" },
  { id: "math", label: "数学" },
  { id: "english", label: "英語" },
  { id: "science", label: "理科" },
  { id: "programming", label: "プログラミング" },
];

const LearningListSurface: Component = () => {
  const [query, setQuery] = createSignal("");
  const [subject, setSubject] = createSignal("all");

  const filtered = createMemo(() =>
    learningCards.filter((card) => {
      const matchesSubject = subject() === "all" || card.subject === subject();
      const matchesQuery =
        card.title.includes(query()) ||
        card.tags.some((tag) => tag.includes(query()));
      return matchesSubject && (query().length === 0 || matchesQuery);
    }),
  );

  return (
    <section class="space-y-6">
      <header class="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <p class="text-xs font-semibold uppercase tracking-wide text-indigo-600">
            学習一覧
          </p>
          <h1 class="text-2xl font-bold text-slate-900">
            学習カードで進捗と生成物をざっと眺める
          </h1>
          <p class="text-sm text-slate-600">
            フィルタと検索で対象を絞り込みつつ、演習や詳細へすぐに飛べるようにします。
          </p>
        </div>
        <div class="flex gap-2">
          <button class="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">
            インポート
          </button>
          <button class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500">
            + 学習を作成
          </button>
        </div>
      </header>

      <div class="grid gap-3 md:grid-cols-[2fr_1fr]">
        <div class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div class="flex flex-wrap gap-2">
              {subjects.map((item) => (
                <button
                  type="button"
                  class={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                    subject() === item.id
                      ? "border-indigo-200 bg-indigo-50 text-indigo-800"
                      : "border-slate-200 text-slate-700 hover:bg-slate-50"
                  }`}
                  onClick={() => setSubject(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <input
              value={query()}
              onInput={(e) => setQuery(e.currentTarget.value)}
              class="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100 md:w-64"
              placeholder="タイトル・タグ検索"
            />
          </div>

          <div class="mt-4 grid gap-3 md:grid-cols-2">
            <For each={filtered()}>
              {(card) => (
                <article class="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                  <div class="flex items-start justify-between gap-2">
                    <div>
                      <p class="text-xs font-semibold uppercase text-slate-500">
                        {card.subject}
                      </p>
                      <h2 class="text-lg font-bold text-slate-900">
                        {card.title}
                      </h2>
                      <div class="mt-1 flex flex-wrap gap-2 text-xs">
                        <For each={card.tags}>
                          {(tag) => (
                            <span class="rounded-full bg-white px-2 py-1 text-slate-600 shadow-sm">
                              {tag}
                            </span>
                          )}
                        </For>
                      </div>
                    </div>
                    <div class="text-right">
                      <p class="text-xs text-slate-500">最終学習</p>
                      <p class="text-sm font-semibold text-slate-800">
                        {card.lastStudied}
                      </p>
                    </div>
                  </div>

                  <div class="space-y-2">
                    <div class="flex items-center justify-between text-xs font-semibold text-slate-700">
                      <span>進捗</span>
                      <span>{Math.round(card.progress * 100)}%</span>
                    </div>
                    <div class="h-2 rounded-full bg-white">
                      <div
                        class="h-2 rounded-full bg-indigo-500 transition-all"
                        style={{ width: `${card.progress * 100}%` }}
                      />
                    </div>
                  </div>

                  <div class="flex items-center gap-3 text-xs text-slate-600">
                    <div class="flex items-center gap-1 rounded-md bg-white px-2 py-1 shadow-sm">
                      <span class="font-semibold text-indigo-700">Q&A</span>
                      <span>{card.generated.qa}</span>
                    </div>
                    <div class="flex items-center gap-1 rounded-md bg-white px-2 py-1 shadow-sm">
                      <span class="font-semibold text-emerald-700">
                        練習
                      </span>
                      <span>{card.generated.practice}</span>
                    </div>
                    <div class="flex items-center gap-1 rounded-md bg-white px-2 py-1 shadow-sm">
                      <span class="font-semibold text-amber-700">
                        要約
                      </span>
                      <span>{card.generated.summary}</span>
                    </div>
                  </div>

                  <div class="flex flex-wrap gap-2">
                    <button class="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-white">
                      詳細を開く
                    </button>
                    <button class="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-100">
                      演習に進む
                    </button>
                    <button class="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-white">
                      生成履歴
                    </button>
                  </div>
                </article>
              )}
            </For>
          </div>
        </div>

        <aside class="space-y-3">
          <div class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p class="text-xs font-semibold uppercase text-slate-500">次の提案</p>
            <ul class="mt-2 space-y-2 text-sm text-slate-700">
              <li>・未着手の「電磁気」カードにQ&Aを追加生成</li>
              <li>・英語長文の演習モードを再開</li>
              <li>・数学Iのポッドキャストスクリプトを作成</li>
            </ul>
          </div>
          <div class="rounded-xl border border-indigo-100 bg-indigo-50 p-4 shadow-sm text-sm text-indigo-900">
            教科タグで絞りながら、新規学習やチャット画面にすぐに遷移できる導線を用意しています。
          </div>
        </aside>
      </div>
    </section>
  );
};

const detailTabs = [
  { id: "qa", label: "一問一答" },
  { id: "practice", label: "練習問題" },
  { id: "summary", label: "要約" },
  { id: "podcast", label: "ポッドキャスト" },
];

const generatedSamples = {
  qa: [
    {
      id: "qa1",
      title: "平方完成の確認",
      createdAt: "2024-11-02 21:10",
      preview: "二次関数 f(x)=x^2+4x+5 の頂点を求めよ。",
    },
    {
      id: "qa2",
      title: "図形と範囲の理解",
      createdAt: "2024-11-02 21:20",
      preview: "グラフの軸と最小値を説明してください。",
    },
  ],
  practice: [
    {
      id: "pr1",
      title: "基本計算セット",
      createdAt: "2024-10-31 09:05",
      preview: "軸と頂点、判別式の扱いを含む3問セット。",
    },
  ],
  summary: [
    {
      id: "sm1",
      title: "要約 v2",
      createdAt: "2024-10-30 18:20",
      preview: "二次関数の基本形とグラフ変形のポイントを短く整理。",
    },
  ],
  podcast: [],
};

const LearningDetailSurface: Component = () => {
  const [tab, setTab] = createSignal(detailTabs[0].id);
  const [selectedPreset, setSelectedPreset] = createSignal(
    materialIngestPresets[0].id,
  );
  const [libraryConfig, setLibraryConfig] =
    createSignal<MaterialLibraryConfig>();
  const [ingestQueue, setIngestQueue] = createSignal<IngestJob[]>([]);

  const seedJob = (
    request: MaterialIngestRequest,
    config: MaterialLibraryConfig,
    runningIndex = 1,
  ) => {
    const job = bootstrapJobFromRequest(request, config, "processing");
    job.steps = job.steps.map((step, index) =>
      index < runningIndex
        ? { ...step, status: "succeeded" }
        : index === runningIndex
          ? { ...step, status: "running" }
          : step,
    );
    return job;
  };

  const enqueuePreset = () => {
    const config = libraryConfig();
    const preset = materialIngestPresets.find(
      (item) => item.id === selectedPreset(),
    );
    if (!config || !preset) return;

    const request: MaterialIngestRequest = {
      ...preset.request,
      source:
        preset.request.source.kind === "url"
          ? {
              ...preset.request.source,
              url:
                preset.request.source.url ||
                "https://example.com/article-to-import",
            }
          : {
              ...preset.request.source,
              path:
                preset.request.source.kind === "image"
                  ? "スクリーンショット.png"
                  : "選択したファイル",
            },
    };

    const job = bootstrapJobFromRequest(request, config, "queued");
    setIngestQueue([job, ...ingestQueue()]);
  };

  const sourceLabel = (job: IngestJob) =>
    job.source.kind === "url" ? job.source.url : job.source.path;

  const formatBytes = (value?: number) =>
    value ? `${Math.round(value / 1000)} KB` : "サイズ不明";

  onMount(async () => {
    const config = await resolveLibraryConfig();
    setLibraryConfig(config);

    const pdfPreset = materialIngestPresets.find((preset) => preset.id === "pdf");
    const audioPreset = materialIngestPresets.find(
      (preset) => preset.id === "audio",
    );

    if (pdfPreset && audioPreset) {
      const pdfJob = seedJob(
        {
          ...pdfPreset.request,
          source: { kind: "pdf", path: "math/二次関数_講義.pdf" },
        },
        config,
        2,
      );
      const audioJob = seedJob(
        {
          ...audioPreset.request,
          source: { kind: "audio", path: "audio/podcast.wav" },
        },
        config,
        1,
      );
      setIngestQueue([pdfJob, audioJob]);
    }
  });

  const renderEmpty = () => (
    <div class="rounded-lg border border-dashed border-slate-200 bg-stone-50 px-4 py-6 text-sm text-slate-700">
      まだ生成されたコンテンツがありません。教材から生成を実行してください。
    </div>
  );

  return (
    <section class="space-y-6">
      <header class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p class="text-xs font-semibold uppercase tracking-wide text-indigo-600">
            学習詳細
          </p>
          <h1 class="text-2xl font-bold text-slate-900">
            高校数学I_二次関数_第1回
          </h1>
          <p class="text-sm text-slate-600">
            教材に紐づく生成コンテンツをタブで切り替えます。演習への導線と生成履歴を右ペインにまとめました。
          </p>
          <div class="mt-2 flex gap-2 text-xs text-slate-600">
            <span class="rounded-full bg-slate-100 px-2 py-1">数学</span>
            <span class="rounded-full bg-slate-100 px-2 py-1">二次関数</span>
            <span>最終更新: 2024-11-02</span>
          </div>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <button class="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50">
            教材を追加
          </button>
          <button class="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50">
            設定を開く
          </button>
          <button class="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-500">
            演習を開始
          </button>
        </div>
      </header>

      <div class="grid gap-4 md:grid-cols-[2fr_1fr]">
        <div class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="flex flex-wrap gap-2">
              <For each={detailTabs}>
                {(item) => (
                  <button
                    class={`rounded-lg px-3 py-2 text-xs font-semibold transition ${
                      tab() === item.id
                        ? "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200"
                        : "text-slate-700 hover:bg-slate-50"
                    }`}
                    onClick={() => setTab(item.id)}
                  >
                    {item.label}
                  </button>
                )}
              </For>
            </div>
            <button class="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-100">
              + 生成
            </button>
          </div>

          <div class="mt-4 space-y-3">
            <Show when={generatedSamples[tab() as keyof typeof generatedSamples].length} fallback={renderEmpty()}>
              <For each={generatedSamples[tab() as keyof typeof generatedSamples]}>
                {(item) => (
                  <article class="rounded-lg border border-slate-200 bg-slate-50/70 px-4 py-3">
                    <div class="flex items-start justify-between gap-2">
                      <div>
                        <p class="text-xs uppercase text-slate-500">
                          {tab() === "qa"
                            ? "Q&A"
                            : tab() === "practice"
                              ? "練習問題"
                              : tab() === "summary"
                                ? "要約"
                                : "ポッドキャスト"}
                        </p>
                        <h3 class="text-sm font-semibold text-slate-900">
                          {item.title}
                        </h3>
                        <p class="mt-1 text-sm text-slate-700">{item.preview}</p>
                      </div>
                      <div class="text-right">
                        <p class="text-xs text-slate-500">{item.createdAt}</p>
                        <div class="mt-2 flex gap-2">
                          <button class="rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-white">
                            詳細
                          </button>
                          <button class="rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-white">
                            再生成
                          </button>
                        </div>
                      </div>
                    </div>
                  </article>
                )}
              </For>
            </Show>
          </div>
        </div>

        <aside class="space-y-3">
          <div class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p class="text-xs font-semibold uppercase text-slate-500">
              生成履歴
            </p>
            <ul class="mt-2 space-y-2 text-sm text-slate-700">
              <li>2024-11-02 21:20 練習問題セットを更新</li>
              <li>2024-11-02 21:10 Q&A 2件生成</li>
              <li>2024-10-30 18:20 要約 v2 を作成</li>
            </ul>
          </div>
          <div class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p class="text-xs font-semibold uppercase text-slate-500">
              関連学習
            </p>
            <div class="mt-2 space-y-2 text-sm text-slate-700">
              <div class="rounded-lg bg-slate-50 px-3 py-2">
                数学II_指数関数_基礎
              </div>
              <div class="rounded-lg bg-slate-50 px-3 py-2">
                物理_運動方程式_演習セット
              </div>
            </div>
          </div>
          <div class="rounded-xl border border-indigo-100 bg-indigo-50 p-4 shadow-sm text-sm text-indigo-900">
            タブ切り替えと生成履歴をまとめ、演習フローへ移動しやすい構成を用意しています。
          </div>
        </aside>
      </div>

      <div class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <p class="text-xs font-semibold uppercase tracking-wide text-indigo-600">
              教材取り込み & ファイルライブラリ
            </p>
            <h2 class="text-lg font-bold text-slate-900">
              PDF/画像/OCR/音声/URL/動画のパイプライン設計を接続
            </h2>
            <p class="text-sm text-slate-600">
              オフライン優先のTesseract（OCR）と Whisper-rs（文字起こし）を前提に、Tauriコマンドにつなぐキューと保存先を用意しています。
            </p>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <select
              class="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
              value={selectedPreset()}
              onChange={(event) => setSelectedPreset(event.currentTarget.value)}
            >
              <For each={materialIngestPresets}>
                {(preset) => <option value={preset.id}>{preset.label}</option>}
              </For>
            </select>
            <button
              class="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-500"
              onClick={enqueuePreset}
            >
              キューに追加
            </button>
          </div>
        </div>

        <div class="mt-4 grid gap-4 md:grid-cols-2">
          <div class="space-y-3 rounded-lg border border-slate-200 bg-slate-50/70 p-3">
            <div class="flex items-center justify-between">
              <p class="text-xs font-semibold uppercase text-slate-500">
                取り込みキュー（スタブ）
              </p>
              <span class="rounded-full bg-white px-2 py-1 text-xs font-semibold text-slate-700">
                {ingestQueue().length} 件
              </span>
            </div>
            <Show
              when={ingestQueue().length}
              fallback={
                <p class="text-sm text-slate-600">
                  まだキューはありません。上のプルダウンから種別を選びキューに追加します。
                </p>
              }
            >
              <div class="space-y-2">
                <For each={ingestQueue()}>
                  {(job) => (
                    <div class="rounded-lg border border-slate-200 bg-white p-3">
                      <div class="flex items-start justify-between gap-2">
                        <div>
                          <p class="text-xs font-semibold uppercase text-slate-500">
                            {job.source.kind}
                          </p>
                          <p class="text-sm font-semibold text-slate-900">
                            {sourceLabel(job)}
                          </p>
                          <p class="text-xs text-slate-500">
                            OCR: {job.preferredOcrEngine || "未指定"} / STT:{" "}
                            {job.preferredTranscriptionEngine || "未指定"}
                          </p>
                        </div>
                        <span
                          class={`rounded-full px-2 py-1 text-xs font-semibold ${
                            job.status === "completed"
                              ? "bg-emerald-100 text-emerald-700"
                              : job.status === "processing"
                                ? "bg-indigo-100 text-indigo-700"
                                : "bg-amber-100 text-amber-700"
                          }`}
                        >
                          {job.status}
                        </span>
                      </div>
                      <div class="mt-2 space-y-1">
                        <For each={job.steps}>
                          {(step) => (
                            <div class="flex items-center justify-between rounded-md bg-slate-50 px-2 py-1 text-xs">
                              <span class="font-semibold text-slate-700">
                                {step.label}
                              </span>
                              <span
                                class={`rounded-full px-2 py-0.5 ${
                                  step.status === "succeeded"
                                    ? "bg-emerald-100 text-emerald-700"
                                    : step.status === "running"
                                      ? "bg-indigo-100 text-indigo-700"
                                      : step.status === "failed"
                                        ? "bg-rose-100 text-rose-700"
                                        : "bg-slate-100 text-slate-600"
                                }`}
                              >
                                {step.status}
                              </span>
                            </div>
                          )}
                        </For>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </Show>
            <p class="text-xs text-slate-500">
              Tauri側では `materials::ingest` コマンドでステップを更新予定。`native_tesseract` / `whisper_rs` をデフォルトに、必要なら `cloudflare_workers_ai` に切替できるようにフィールドを持たせています。
            </p>
          </div>

          <div class="space-y-3 rounded-lg border border-slate-200 bg-slate-50/50 p-3">
            <div class="flex items-center justify-between">
              <div>
                <p class="text-xs font-semibold uppercase text-slate-500">
                  保存先とインデックス
                </p>
                <p class="text-sm text-slate-700">
                  AppData（BaseDirectory.AppData）配下に TheTeacher/materials を確保。
                </p>
              </div>
              <span class="rounded-full bg-white px-2 py-1 text-xs font-semibold text-slate-700">
                {libraryConfig()?.rootDir || "AppData/TheTeacher/materials"}
              </span>
            </div>
            <div class="space-y-1 rounded-md bg-white p-3 text-xs text-slate-700 shadow-sm">
              <div class="flex items-center justify-between">
                <span>ルート</span>
                <span class="font-semibold">
                  {libraryConfig()?.rootDir || "AppData/TheTeacher/materials"}
                </span>
              </div>
              <div class="flex items-center justify-between">
                <span>一時保存</span>
                <span class="font-semibold">
                  {libraryConfig()?.tempDir || "AppData/TheTeacher/materials/tmp"}
                </span>
              </div>
              <div class="flex items-center justify-between">
                <span>インデックス</span>
                <span class="font-semibold">
                  {libraryConfig()?.indexFile ||
                    "AppData/TheTeacher/materials/material-index.json"}
                </span>
              </div>
            </div>
            <div>
              <p class="text-xs font-semibold uppercase text-slate-500">
                ライブラリサンプル（JSONインデックス）
              </p>
              <div class="mt-2 space-y-2">
                <For each={sampleLibraryEntries}>
                  {(entry) => (
                    <div class="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
                      <div>
                        <p class="font-semibold">{entry.displayName}</p>
                        <p class="text-xs text-slate-500">
                          {entry.storedPath} ・ {entry.type}
                        </p>
                      </div>
                      <span class="text-xs text-slate-600">
                        {formatBytes(entry.bytes)}
                      </span>
                    </div>
                  )}
                </For>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

const PracticeSurface: Component = () => {
  const [mode, setMode] = createSignal<"handwriting" | "text">("text");
  const chatLog = [
    {
      role: "assistant",
      content:
        "進捗を確認しました。今回は頂点の求め方を確認しましょう。まずこの問題を解いてください。",
    },
    {
      role: "user",
      content: "完成平方したので頂点は (-2, 1) になりました。",
    },
    {
      role: "assistant",
      content:
        "正解です。軸は x = -2、最小値は 1 です。次はグラフの開き方を説明してください。",
    },
  ];

  return (
    <section class="space-y-6">
      <header class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p class="text-xs font-semibold uppercase tracking-wide text-indigo-600">
            演習
          </p>
          <h1 class="text-2xl font-bold text-slate-900">手書き入力とテキスト入力を切り替える演習モード</h1>
          <p class="text-sm text-slate-600">
            左に問題、右に回答とAIフィードバックログを並べています。モードトグルで入力方法を切り替えられます。
          </p>
        </div>
        <div class="flex flex-wrap gap-2">
          <button
            class={`rounded-lg px-3 py-2 text-xs font-semibold transition ${
              mode() === "handwriting"
                ? "bg-slate-900 text-white"
                : "border border-slate-200 text-slate-700 hover:bg-slate-50"
            }`}
            onClick={() => setMode("handwriting")}
          >
            手書き想定
          </button>
          <button
            class={`rounded-lg px-3 py-2 text-xs font-semibold transition ${
              mode() === "text"
                ? "bg-indigo-600 text-white"
                : "border border-slate-200 text-slate-700 hover:bg-slate-50"
            }`}
            onClick={() => setMode("text")}
          >
            テキスト入力
          </button>
        </div>
      </header>

      <div class="grid gap-4 md:grid-cols-[1.2fr_1fr]">
        <div class="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div class="flex items-center justify-between">
            <div>
              <p class="text-xs uppercase text-slate-500">問題 2 / 5</p>
              <h2 class="text-lg font-semibold text-slate-900">
                二次関数 f(x)=x^2+4x+5 の頂点と最小値を求めよ
              </h2>
              <p class="text-sm text-slate-600">
                ヒント: 平方完成を用いて軸と頂点を読み取ってください。
              </p>
            </div>
            <div class="flex gap-2">
              <button class="rounded-md border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                前の問題
              </button>
              <button class="rounded-md border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                次の問題
              </button>
            </div>
          </div>

          <div class="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-600">
            <p class="font-semibold text-slate-800">図・数式プレビュー</p>
            <p class="mt-2">
              数式や図形がここにレンダリングされます。手書きモードの場合は紙の解答を参照しながら「解答のみ」を送信します。
            </p>
          </div>

          <div>
            <p class="text-xs font-semibold uppercase text-slate-500">
              関連資料
            </p>
            <div class="mt-2 flex flex-wrap gap-2 text-xs">
              <span class="rounded-full bg-slate-100 px-2 py-1">動画: 平方完成</span>
              <span class="rounded-full bg-slate-100 px-2 py-1">
                ノート: 公式まとめ
              </span>
            </div>
          </div>
        </div>

        <div class="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div class="space-y-2">
            <p class="text-xs font-semibold uppercase text-slate-500">
              回答
            </p>
            <textarea
              class="h-28 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
              placeholder={
                mode() === "handwriting"
                  ? "紙に解いた結果を入力してください。例: 頂点 (-2,1)、最小値 1。"
                  : "回答を直接入力してください。例: 平方完成すると (x+2)^2 +1 なので軸 x=-2, 頂点(-2,1)。"
              }
            />
            <div class="flex gap-2 text-xs text-slate-600">
              <button class="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-500">
                採点して送信
              </button>
              <button class="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50">
                類題を生成
              </button>
            </div>
          </div>

          <div class="space-y-2">
            <p class="text-xs font-semibold uppercase text-slate-500">
              フィードバック
            </p>
            <div class="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800">
              正答率 80% / 部分点あり。平方完成の途中式も残すと減点を防げます。
            </div>
          </div>

          <div class="space-y-2">
            <p class="text-xs font-semibold uppercase text-slate-500">
              AIとの対話ログ
            </p>
            <div class="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
              <For each={chatLog}>
                {(msg) => (
                  <div
                    class={`rounded-md p-2 ${
                      msg.role === "assistant"
                        ? "bg-white text-slate-800"
                        : "bg-indigo-50 text-indigo-900"
                    }`}
                  >
                    <span class="text-xs font-semibold uppercase">
                      {msg.role === "assistant" ? "AI" : "You"}
                    </span>
                    <p class="mt-1">{msg.content}</p>
                  </div>
                )}
              </For>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

const ChatSurface: Component = () => {
  type ChatMessage = { role: "user" | "assistant"; content: string };
  const [messages, setMessages] = createSignal<ChatMessage[]>([
    {
      role: "assistant",
      content: "復習したい教材やテーマを教えてください。意味検索も同時に走らせます。",
    },
  ]);
  const [toolCalls, setToolCalls] = createSignal<ToolCallLog[]>([
    {
      tool: "session_boot",
      detail: "チャットを初期化しました (semantic search enabled)",
    },
  ]);
  const [semanticHits, setSemanticHits] = createSignal<SemanticMatch[]>([]);
  const [preset, setPreset] = createSignal("math_default");
  const [tone, setTone] = createSignal("丁寧");
  const [draft, setDraft] = createSignal("");
  const [isSending, setIsSending] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const appendMessage = (role: ChatMessage["role"], content: string) =>
    setMessages((prev) => [...prev, { role, content }]);

  const runSemanticSearch = async (query: string) => {
    const results = await semanticSearch(query, 4);
    setSemanticHits(results);
    setToolCalls((prev) => [
      ...prev,
      {
        tool: "semantic_search",
        detail: `query="${query.slice(0, 24)}" topK=${results.length}`,
        result: results[0] ? results[0].label : "結果なし",
      },
    ]);
  };

  const handleSend = async () => {
    const prompt = draft().trim();
    if (!prompt || isSending()) return;

    setError(null);
    appendMessage("user", prompt);
    setIsSending(true);
    try {
      const reply = await proxyChat(prompt, {
        preset: preset(),
        topK: 4,
        tone: tone(),
      });
      if (reply.toolCalls.length > 0) {
        setToolCalls((prev) => [...prev, ...reply.toolCalls]);
      }
      if (reply.related.length > 0) {
        setSemanticHits(reply.related);
      }
      appendMessage("assistant", reply.reply);
    } catch (err) {
      console.error(err);
      setError("Tool Call連携に失敗しました。もう一度お試しください。");
    } finally {
      setDraft("");
      setIsSending(false);
      void runSemanticSearch(prompt);
    }
  };

  return (
    <section class="space-y-6">
      <header class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p class="text-xs font-semibold uppercase tracking-wide text-indigo-600">
            汎用AIチャット
          </p>
          <h1 class="text-2xl font-bold text-slate-900">
            Tool Callと意味検索を実際に叩くチャット
          </h1>
          <p class="text-sm text-slate-600">
            教材がなくてもチャットから学習生成を依頼できます。Tool Call とベクトル検索をバックエンドに送り、関連コンテンツ候補を表示します。
          </p>
        </div>
        <div class="flex flex-wrap gap-2">
          <button
            class="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            onClick={() => appendMessage("assistant", "最近の学習から新規カードを提案します。")}
          >
            新しい学習を提案
          </button>
          <button
            class="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            onClick={() => setToolCalls([])}
          >
            Tool Callをクリア
          </button>
        </div>
      </header>

      <div class="grid gap-4 md:grid-cols-[0.9fr_1.1fr]">
        <aside class="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p class="text-xs font-semibold uppercase text-slate-500">
            Tool Call ログ
          </p>
          <div class="space-y-2 text-sm text-slate-800">
            <For each={toolCalls()}>
              {(call) => (
                <div class="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <p class="text-xs uppercase text-indigo-700">{call.tool}</p>
                  <p class="text-slate-700">{call.detail}</p>
                  <Show when={call.result}>
                    {(result) => (
                      <p class="text-xs text-slate-500">→ {result()}</p>
                    )}
                  </Show>
                </div>
              )}
            </For>
            <Show when={toolCalls().length === 0}>
              <p class="text-sm text-slate-500">Tool Callの履歴はまだありません。</p>
            </Show>
          </div>

          <div class="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
            <p class="text-xs font-semibold uppercase text-emerald-700">
              意味検索結果
            </p>
            <Show when={semanticHits().length > 0} fallback={<p class="text-sm text-emerald-800">クエリに関連するコンテンツをここに表示します。</p>}>
              <ul class="space-y-2 text-sm text-emerald-900">
                <For each={semanticHits()}>
                  {(hit) => (
                    <li class="rounded-md border border-emerald-200 bg-white/70 px-3 py-2">
                      <div class="flex items-center justify-between gap-2">
                        <span class="font-semibold">{hit.label}</span>
                        <span class="text-xs text-emerald-700">
                          score {hit.score.toFixed(2)}
                        </span>
                      </div>
                      <p class="text-xs text-slate-600">{hit.excerpt}</p>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </div>
        </aside>

        <div class="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div class="space-y-2">
            <p class="text-xs font-semibold uppercase text-slate-500">
              チャットログ
            </p>
            <div class="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
              <For each={messages()}>
                {(msg) => (
                  <div
                    class={`rounded-md p-2 ${
                      msg.role === "assistant"
                        ? "bg-white text-slate-800"
                        : "bg-indigo-50 text-indigo-900"
                    }`}
                  >
                    <span class="text-xs font-semibold uppercase">
                      {msg.role === "assistant" ? "AI" : "You"}
                    </span>
                    <p class="mt-1">{msg.content}</p>
                  </div>
                )}
              </For>
            </div>
          </div>

          <div class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div class="flex items-center gap-2">
              <label class="text-xs font-semibold text-slate-700">
                教科プリセット
              </label>
              <select
                value={preset()}
                onChange={(event) => setPreset(event.currentTarget.value)}
                class="rounded-lg border border-slate-200 px-2 py-1 text-sm text-slate-800"
              >
                <option value="math_default">math_default</option>
                <option value="english_reading">english_reading</option>
                <option value="programming_cpp">programming_cpp</option>
              </select>
            </div>
            <div class="flex items-center gap-2">
              <label class="text-xs font-semibold text-slate-700">
                トーン
              </label>
              <select
                value={tone()}
                onChange={(event) => setTone(event.currentTarget.value)}
                class="rounded-lg border border-slate-200 px-2 py-1 text-sm text-slate-800"
              >
                <option value="丁寧">丁寧</option>
                <option value="カジュアル">カジュアル</option>
                <option value="厳しめ">厳しめ</option>
              </select>
            </div>
          </div>

          <div class="space-y-2">
            <div class="flex gap-2">
              <input
                value={draft()}
                onInput={(event) => setDraft(event.currentTarget.value)}
                class="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                placeholder="質問や生成依頼を入力..."
              />
              <button
                class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-70"
                onClick={handleSend}
                disabled={isSending() || !draft().trim()}
              >
                {isSending() ? "送信中..." : "送信"}
              </button>
              <button
                class="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-70"
                onClick={() => void runSemanticSearch(draft())}
                disabled={isSending() || !draft().trim()}
              >
                意味検索のみ
              </button>
            </div>
            <Show when={error()}>
              {(err) => (
                <p class="text-xs text-rose-600">
                  {err()}
                </p>
              )}
            </Show>
          </div>
        </div>
      </div>
    </section>
  );
};

const files = [
  {
    id: "f1",
    name: "math_quadratic.pdf",
    type: "pdf",
    size: "2.1MB",
    notes: "12ページ、式が多い教材",
  },
  {
    id: "f2",
    name: "graph.png",
    type: "image",
    size: "420KB",
    notes: "グラフの例題付き",
  },
  {
    id: "f3",
    name: "lecture_audio.m4a",
    type: "audio",
    size: "6.3MB",
    notes: "10分の講義録音（文字起こし済み）",
  },
];

const MaterialSettingsSurface: Component = () => (
  <section class="space-y-6">
    <header class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <div>
        <p class="text-xs font-semibold uppercase tracking-wide text-indigo-600">
          教材設定
        </p>
        <h1 class="text-2xl font-bold text-slate-900">
          教材ファイルと生成設定をまとめて調整
        </h1>
        <p class="text-sm text-slate-600">
          左側でファイルを管理し、右側で生成パラメータやプリセットを変更します。
        </p>
      </div>
      <div class="flex flex-wrap gap-2">
        <button class="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
          ファイルを追加
        </button>
        <button class="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-500">
          再解析を実行
        </button>
      </div>
    </header>

    <div class="grid gap-4 md:grid-cols-[1fr_1.1fr]">
      <div class="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <p class="text-xs font-semibold uppercase text-slate-500">教材ファイル</p>
        <div class="space-y-2">
          <For each={files}>
            {(file) => (
              <div class="flex items-start justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <div>
                  <p class="text-sm font-semibold text-slate-900">{file.name}</p>
                  <p class="text-xs text-slate-600">
                    種別: {file.type} / サイズ: {file.size}
                  </p>
                  <p class="text-xs text-slate-600">メモ: {file.notes}</p>
                </div>
                <div class="flex gap-2">
                  <button class="rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-white">
                    プレビュー
                  </button>
                  <button class="rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-white">
                    置き換え
                  </button>
                </div>
              </div>
            )}
          </For>
        </div>
      </div>

      <div class="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div class="grid gap-3 md:grid-cols-2">
          <div class="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <p class="text-xs font-semibold uppercase text-slate-500">
              生成対象
            </p>
            <div class="mt-2 flex flex-col gap-2 text-sm text-slate-800">
              <label class="flex items-center gap-2">
                <input type="checkbox" checked />
                一問一答
              </label>
              <label class="flex items-center gap-2">
                <input type="checkbox" checked />
                練習問題
              </label>
              <label class="flex items-center gap-2">
                <input type="checkbox" />
                ポッドキャスト
              </label>
            </div>
          </div>

          <div class="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <p class="text-xs font-semibold uppercase text-slate-500">
              難易度と出題数
            </p>
            <div class="mt-2 space-y-2 text-sm text-slate-800">
              <label class="flex items-center justify-between">
                <span>難易度</span>
                <select class="rounded-md border border-slate-200 px-2 py-1 text-sm text-slate-800">
                  <option>基礎</option>
                  <option>標準</option>
                  <option>発展</option>
                </select>
              </label>
              <label class="flex items-center justify-between">
                <span>出題数</span>
                <input
                  type="number"
                  min="1"
                  max="10"
                  value="5"
                  class="w-20 rounded-md border border-slate-200 px-2 py-1 text-sm text-slate-800"
                  aria-label="出題数"
                />
              </label>
            </div>
          </div>
        </div>

        <div class="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <p class="text-xs font-semibold uppercase text-slate-500">
            AIプリセット
          </p>
          <div class="mt-2 flex flex-col gap-2 text-sm text-slate-800">
            <label class="flex items-center justify-between">
              <span>教科プリセット</span>
              <select class="rounded-md border border-slate-200 px-2 py-1 text-sm text-slate-800">
                <option>math_detail</option>
                <option>english_translation</option>
              </select>
            </label>
            <label class="flex items-center justify-between">
              <span>温度</span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value="0.3"
                class="w-36"
                aria-label="temperature"
              />
            </label>
          </div>
        </div>

        <div class="flex flex-wrap gap-2">
          <button class="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
            下書き保存
          </button>
          <button class="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-500">
            生成を開始
          </button>
        </div>
      </div>
    </div>
  </section>
);

const NewLearningSurface: Component = () => (
  <section class="space-y-6">
    <header class="space-y-2">
      <p class="text-xs font-semibold uppercase tracking-wide text-indigo-600">
        過去教材から新しい学習作成
      </p>
      <h1 class="text-2xl font-bold text-slate-900">
        過去の教材抽出結果を取捨選択し、新規学習を組み立てる
      </h1>
      <p class="text-sm text-slate-600">
        左のステップで教材を選び、中央で抽出結果を確認し、右でプレビューとメタデータを編集します。
      </p>
    </header>

    <div class="grid gap-4 md:grid-cols-[0.9fr_1fr_1fr]">
      <div class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <p class="text-xs font-semibold uppercase text-slate-500">
          ① 抽出元を選択
        </p>
        <div class="mt-2 space-y-2 text-sm text-slate-800">
          <label class="flex items-center gap-2">
            <input type="radio" name="learning" checked />
            高校数学I_二次関数_第1回
          </label>
          <label class="flex items-center gap-2">
            <input type="radio" name="learning" />
            英語長文_時制の一致
          </label>
          <label class="flex items-center gap-2">
            <input type="radio" name="learning" />
            物理_電磁気_公式暗記リスト
          </label>
        </div>
      </div>

      <div class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <p class="text-xs font-semibold uppercase text-slate-500">
          ② 抽出結果の確認
        </p>
        <div class="mt-2 space-y-2 text-sm text-slate-800">
          <label class="flex items-start gap-2">
            <input type="checkbox" checked />
            <span>
              頂点と軸の求め方まとめ（短答3問提案）
              <span class="block text-xs text-slate-600">
                生成コンテンツ: Q&A + 練習問題
              </span>
            </span>
          </label>
          <label class="flex items-start gap-2">
            <input type="checkbox" checked />
            <span>
              グラフ形状の説明スクリプト
              <span class="block text-xs text-slate-600">
                生成コンテンツ: ポッドキャスト用台本
              </span>
            </span>
          </label>
          <label class="flex items-start gap-2">
            <input type="checkbox" />
            <span>
              判別式と解の個数に関する問題セット
              <span class="block text-xs text-slate-600">
                生成コンテンツ: 練習問題
              </span>
            </span>
          </label>
        </div>
        <div class="mt-3 flex gap-2">
          <button class="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
            再生成
          </button>
          <button class="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
            抽出ログ
          </button>
        </div>
      </div>

      <div class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <p class="text-xs font-semibold uppercase text-slate-500">
          ③ 新規学習のプレビュー
        </p>
        <div class="mt-2 space-y-2 text-sm text-slate-800">
          <label class="flex flex-col gap-1">
            <span class="text-xs font-semibold text-slate-600">タイトル</span>
            <input
              class="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800"
              value="高校数学I_二次関数_復習セット"
            />
          </label>
          <label class="flex flex-col gap-1">
            <span class="text-xs font-semibold text-slate-600">タグ</span>
            <input
              class="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800"
              value="二次関数, 基礎, 復習"
            />
          </label>
          <div class="rounded-lg bg-slate-50 px-3 py-2">
            <p class="text-xs font-semibold uppercase text-slate-500">
              生成されるコンテンツ
            </p>
            <ul class="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-700">
              <li>Q&A 3問</li>
              <li>練習問題 5問</li>
              <li>ポッドキャスト台本（約3分）</li>
            </ul>
          </div>
        </div>
        <div class="mt-3 flex gap-2">
          <button class="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
            下書き保存
          </button>
          <button class="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-500">
            学習を作成
          </button>
        </div>
      </div>
    </div>
  </section>
);

const AppSettingsSurface: Component = () => {
  const settings = useSettings();
  const { db, replaceState: replaceDb } = useLocalDb();

  const [editingPresetId, setEditingPresetId] = createSignal<string | undefined>();
  const [presetSubject, setPresetSubject] = createSignal("math");
  const [presetTitle, setPresetTitle] = createSignal("");
  const [presetSystemPrompt, setPresetSystemPrompt] = createSignal("");
  const [presetUserTemplate, setPresetUserTemplate] = createSignal("");
  const [backupMessage, setBackupMessage] = createSignal<string | null>(null);
  const [backupError, setBackupError] = createSignal<string | null>(null);
  const [isExporting, setIsExporting] = createSignal(false);
  let importInputRef: HTMLInputElement | undefined;

  const resetPresetDraft = () => {
    const fallback = settings.state.presets[0];
    setEditingPresetId(undefined);
    setPresetSubject(fallback?.subject ?? "math");
    setPresetTitle("");
    setPresetSystemPrompt(
      fallback?.systemPrompt ?? "学習のねらいと出力形式をここに書きます。",
    );
    setPresetUserTemplate(
      fallback?.userInstructionTemplate ??
        "教材テキスト: {{material}}\n出力: Q&Aと要約を作ってください。",
    );
  };

  onMount(() => resetPresetDraft());

  const savePreset = () => {
    setBackupError(null);
    const title = presetTitle().trim();
    if (!title || !presetSystemPrompt().trim() || !presetUserTemplate().trim()) {
      setBackupError("プリセット名とプロンプトは必須です。");
      return;
    }
    const saved = settings.upsertPreset({
      id: editingPresetId(),
      subject: presetSubject().trim() || "general",
      title,
      systemPrompt: presetSystemPrompt().trim(),
      userInstructionTemplate: presetUserTemplate().trim(),
    });
    setBackupMessage(`プリセットを保存しました: ${saved.title}`);
    resetPresetDraft();
  };

  const editPreset = (preset: Preset) => {
    setEditingPresetId(preset.id);
    setPresetSubject(preset.subject);
    setPresetTitle(preset.title);
    setPresetSystemPrompt(preset.systemPrompt);
    setPresetUserTemplate(preset.userInstructionTemplate);
  };

  const duplicatePreset = (id: string) => {
    const duplicated = settings.duplicatePreset(id);
    if (duplicated) {
      setBackupMessage(`プリセットを複製しました: ${duplicated.title}`);
    }
  };

  const deletePreset = (id: string) => {
    settings.deletePreset(id);
    setBackupMessage("プリセットを削除しました");
    if (editingPresetId() === id) {
      resetPresetDraft();
    }
  };

  const handleExport = async () => {
    setIsExporting(true);
    setBackupError(null);
    try {
      const snapshot = buildBackupSnapshot(
        db,
        settings.state.settings,
        settings.state.presets,
      );
      await downloadSnapshot(snapshot);
      settings.markBackupTaken(snapshot.takenAt);
      setBackupMessage("バックアップを書き出しました");
    } catch (error) {
      setBackupError(
        error instanceof Error
          ? error.message
          : "バックアップのエクスポートに失敗しました",
      );
    } finally {
      setIsExporting(false);
    }
  };

  const handleImportSelection = async (event: Event) => {
    const target = event.currentTarget as HTMLInputElement;
    const file = target.files?.[0];
    if (!file) return;
    setBackupError(null);
    try {
      const snapshot = await parseSnapshotFile(file);
      replaceDb(snapshot.db);
      settings.replaceState({
        settings: snapshot.settings,
        presets: snapshot.presets,
      });
      settings.markBackupTaken(snapshot.takenAt);
      setBackupMessage(`バックアップを適用しました: ${file.name}`);
    } catch (error) {
      setBackupError(
        error instanceof Error
          ? error.message
          : "バックアップの読み込みに失敗しました",
      );
    } finally {
      target.value = "";
    }
  };

  const triggerImport = () => importInputRef?.click();

  return (
    <section class="space-y-6">
      <header class="space-y-2">
        <p class="text-xs font-semibold uppercase tracking-wide text-indigo-600">
          設定
        </p>
        <h1 class="text-2xl font-bold text-slate-900">
          教科別プリセットとAI設定、バックアップを管理
        </h1>
        <p class="text-sm text-slate-600">
          モデル設定とプリセットのテーブル、バックアップ/エクスポートの状態を1画面にまとめています。
        </p>
      </header>

      <div class="grid gap-4 md:grid-cols-[1.1fr_0.9fr]">
        <div class="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p class="text-xs font-semibold uppercase text-slate-500">
            AI設定
          </p>
          <div class="mt-2 grid gap-3 md:grid-cols-2">
            <label class="flex flex-col gap-1 text-sm">
              <span class="text-xs font-semibold text-slate-600">モデル</span>
              <select
                class="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800"
                value={settings.state.settings.ai.model}
                onInput={(event) =>
                  settings.updateAiSettings({
                    model: event.currentTarget.value,
                  })
                }
              >
                <option value="gpt-4o-mini">gpt-4o-mini</option>
                <option value="gpt-4.1-preview">gpt-4.1-preview</option>
                <option value="claude-3.5-sonnet">claude-3.5-sonnet</option>
              </select>
            </label>
            <label class="flex flex-col gap-1 text-sm">
              <span class="text-xs font-semibold text-slate-600">
                温度 (創造性)
              </span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={settings.state.settings.ai.temperature}
                class="w-full"
                aria-label="temperature slider"
                onInput={(event) =>
                  settings.updateAiSettings({
                    temperature: Number(event.currentTarget.value),
                  })
                }
              />
            </label>
            <label class="flex flex-col gap-1 text-sm md:col-span-2">
              <span class="text-xs font-semibold text-slate-600">APIキー</span>
              <input
                class="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800"
                placeholder="sk-..."
                value={settings.state.settings.ai.apiKey ?? ""}
                onInput={(event) =>
                  settings.updateAiSettings({
                    apiKey: event.currentTarget.value,
                  })
                }
              />
            </label>
          </div>
        </div>

        <div class="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p class="text-xs font-semibold uppercase text-slate-500">
            バックアップ
          </p>
          <div class="space-y-2 text-sm text-slate-800">
            <div class="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
              <span>最終バックアップ</span>
              <span class="font-semibold">
                {settings.state.settings.backup.lastBackupAt ?? "未実行"}
              </span>
            </div>
            <label class="flex flex-col gap-1">
              <span class="text-xs font-semibold text-slate-600">保存先</span>
              <input
                class="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800"
                placeholder="例: Downloads/TheTeacher/backups"
                value={settings.state.settings.backup.targetDirectory ?? ""}
                onInput={(event) =>
                  settings.updateBackupSettings({
                    targetDirectory: event.currentTarget.value,
                  })
                }
              />
            </label>
            <div class="flex gap-2">
              <button
                class="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={handleExport}
                disabled={isExporting()}
              >
                {isExporting() ? "エクスポート中..." : "エクスポート"}
              </button>
              <button
                class="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                onClick={triggerImport}
              >
                インポート
              </button>
              <input
                ref={importInputRef}
                type="file"
                accept="application/json"
                class="hidden"
                onChange={handleImportSelection}
              />
            </div>
            <Show when={backupMessage()}>
              {(message) => (
                <p class="text-xs text-emerald-700">{message}</p>
              )}
            </Show>
            <Show when={backupError()}>
              {(message) => (
                <p class="text-xs text-rose-700">{message}</p>
              )}
            </Show>
          </div>
        </div>
      </div>

      <div class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-xs font-semibold uppercase text-slate-500">
              教科プリセット
            </p>
            <p class="text-sm text-slate-600">
              一覧・複製・削除をここで管理します。教科タグでフィルタできます。
            </p>
          </div>
          <button
            class="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-100"
            onClick={savePreset}
          >
            + プリセットを追加
          </button>
        </div>

        <div class="mt-3 grid gap-3 rounded-lg bg-slate-50 p-3 text-sm">
          <div class="grid gap-2 md:grid-cols-2">
            <label class="flex flex-col gap-1">
              <span class="text-xs font-semibold text-slate-600">教科</span>
              <select
                class="rounded-md border border-slate-200 px-2 py-1"
                value={presetSubject()}
                onInput={(event) => setPresetSubject(event.currentTarget.value)}
              >
                <option value="math">math</option>
                <option value="english">english</option>
                <option value="science">science</option>
                <option value="programming">programming</option>
              </select>
            </label>
            <label class="flex flex-col gap-1">
              <span class="text-xs font-semibold text-slate-600">
                プリセット名
              </span>
              <input
                class="rounded-md border border-slate-200 px-2 py-1"
                value={presetTitle()}
                onInput={(event) => setPresetTitle(event.currentTarget.value)}
                placeholder="math_detail など"
              />
            </label>
          </div>
          <label class="flex flex-col gap-1">
            <span class="text-xs font-semibold text-slate-600">
              システムプロンプト
            </span>
            <textarea
              class="min-h-[80px] rounded-md border border-slate-200 px-2 py-1"
              value={presetSystemPrompt()}
              onInput={(event) => setPresetSystemPrompt(event.currentTarget.value)}
            />
          </label>
          <label class="flex flex-col gap-1">
            <span class="text-xs font-semibold text-slate-600">
              ユーザーテンプレート
            </span>
            <textarea
              class="min-h-[80px] rounded-md border border-slate-200 px-2 py-1"
              value={presetUserTemplate()}
              onInput={(event) => setPresetUserTemplate(event.currentTarget.value)}
            />
          </label>
          <div class="flex gap-2">
            <button
              class="rounded-md bg-indigo-600 px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-500"
              onClick={savePreset}
            >
              {editingPresetId() ? "プリセットを更新" : "プリセットを追加"}
            </button>
            <button
              class="rounded-md border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              onClick={resetPresetDraft}
            >
              編集をクリア
            </button>
            <Show when={editingPresetId()}>
              {(id) => (
                <button
                  class="rounded-md border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50"
                  onClick={() => deletePreset(id)}
                >
                  削除
                </button>
              )}
            </Show>
          </div>
        </div>

        <div class="mt-3 overflow-hidden rounded-lg border border-slate-200">
          <table class="min-w-full divide-y divide-slate-200 text-sm">
            <thead class="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th class="px-3 py-2">教科</th>
                <th class="px-3 py-2">プリセット名</th>
                <th class="px-3 py-2">プロンプト要約</th>
                <th class="px-3 py-2 text-right">操作</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-200 bg-white text-slate-800">
              <For each={settings.state.presets}>
                {(preset) => (
                  <tr>
                    <td class="px-3 py-2 font-semibold uppercase text-slate-700">
                      {preset.subject}
                    </td>
                    <td class="px-3 py-2">{preset.title}</td>
                    <td class="px-3 py-2">
                      {preset.systemPrompt.slice(0, 32)}
                      {preset.systemPrompt.length > 32 ? "..." : ""}
                    </td>
                    <td class="px-3 py-2">
                      <div class="flex justify-end gap-2">
                        <button
                          class="rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                          onClick={() => editPreset(preset)}
                        >
                          編集
                        </button>
                        <button
                          class="rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                          onClick={() => duplicatePreset(preset.id)}
                        >
                          複製
                        </button>
                        <button
                          class="rounded-md border border-rose-200 px-2 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50"
                          onClick={() => deletePreset(preset.id)}
                        >
                          削除
                        </button>
                      </div>
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
};

export type Surface = {
  path: string;
  name: string;
  description: string;
  component: Component;
};

export const surfaces: Surface[] = [
  {
    path: "/",
    name: "学習一覧",
    description:
      "学習カードの進捗と生成物を確認し、フィルタや検索から詳細・演習に進む画面。",
    component: LearningListSurface,
  },
  {
    path: "/learning-detail",
    name: "学習詳細",
    description:
      "教材に紐づく生成コンテンツ（Q&A/練習/要約/ポッドキャスト）をタブ切替で管理。",
    component: LearningDetailSurface,
  },
  {
    path: "/practice",
    name: "演習",
    description:
      "問題を左、回答とAIフィードバックを右に置き、手書き/テキスト入力を切り替える演習モード。",
    component: PracticeSurface,
  },
  {
    path: "/chat",
    name: "汎用AIチャット",
    description:
      "チャットログとTool Callログを並べ、教材なしでも学習生成を依頼できる画面。",
    component: ChatSurface,
  },
  {
    path: "/material-settings",
    name: "教材設定",
    description:
      "教材ファイル管理と生成設定・プリセットをまとめて操作する設定画面。",
    component: MaterialSettingsSurface,
  },
  {
    path: "/new-learning",
    name: "過去教材から新しい学習作成",
    description:
      "過去教材から抽出した内容を取捨選択し、新規学習ユニットを組み立てるフロー。",
    component: NewLearningSurface,
  },
  {
    path: "/app-settings",
    name: "設定",
    description:
      "AI設定・プリセット・バックアップを集約した全体設定画面。",
    component: AppSettingsSurface,
  },
];
