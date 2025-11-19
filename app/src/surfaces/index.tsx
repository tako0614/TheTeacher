import { A, useNavigate, useSearchParams } from "@solidjs/router";
import {
  For,
  Show,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  onMount,
  type Component,
} from "solid-js";
import {
  type GeneratedContentType,
  type IngestJob,
  type GeneratedContent,
  type MaterialIngestRequest,
  type MaterialLibraryConfig,
  type MaterialType,
  type Preset,
} from "@theteacher/shared";

import {
  materialIngestPresets,
  resolveLibraryConfig,
} from "../lib/materials";

import {
  type SemanticMatch,
  type ToolCallLog,
  type ToolName,
  invokeTool,
  proxyChat,
  semanticSearch,
} from "../lib/ai";
import {
  createContent,
  createLearning,
  createMaterial,
  generateFromMaterial,
  ingestMaterial,
  createSession,
  fetchContents,
  fetchLearnings,
  fetchLearning,
  fetchMaterials,
  fetchPresets,
  fetchSessions,
  fetchSnapshot,
  createPreset,
  updatePreset,
  deletePreset as deletePresetApi,
  replaceSnapshot,
  type SnapshotPayload,
} from "../lib/api-client";
import { buildBackupSnapshot, downloadSnapshot, parseSnapshotFile } from "../lib/backup";
import { selectPresetOptions, useSettings } from "../lib/settings-store";
import { processMaterialFile } from "../lib/file-processing";

const subjects = [
  { id: "all", label: "すべて" },
  { id: "math", label: "数学" },
  { id: "english", label: "英語" },
  { id: "science", label: "理科" },
  { id: "programming", label: "プログラミング" },
];

const subjectLabel = (value?: string | null) =>
  subjects.find((item) => item.id === value)?.label ?? value ?? "未設定";

const formatDateTime = (value?: string | null) => {
  if (!value) return "記録なし";
  const date = new Date(value);
  const yyyy = date.getFullYear();
  const mm = `${date.getMonth() + 1}`.padStart(2, "0");
  const dd = `${date.getDate()}`.padStart(2, "0");
  const hh = `${date.getHours()}`.padStart(2, "0");
  const min = `${date.getMinutes()}`.padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
};

const progressPercent = (value?: number | null) =>
  Math.round((value ?? 0) * 100);

const generatedTypeLabels: Record<GeneratedContentType, string> = {
  qa: "一問一答",
  practice: "練習問題",
  summary: "要約",
  podcast_script: "ポッドキャスト",
  other: "その他",
};

const detailTabs = [
  { id: "qa", label: generatedTypeLabels.qa },
  { id: "practice", label: generatedTypeLabels.practice },
  { id: "summary", label: generatedTypeLabels.summary },
  { id: "podcast_script", label: generatedTypeLabels.podcast_script },
];

const LearningListSurface: Component = () => {
  const navigate = useNavigate();
  const [query, setQuery] = createSignal("");
  const [subject, setSubject] = createSignal("all");
  const [newTitle, setNewTitle] = createSignal("");
  const [newSubject, setNewSubject] = createSignal("");
  const [newTags, setNewTags] = createSignal("");

  const [learnings, { refetch }] = createResource(
    () => ({
      q: query().trim() || undefined,
      subject: subject() === "all" ? undefined : subject(),
    }),
    (params) => fetchLearnings({ ...params, limit: 100 }),
  );

  const cards = createMemo(() => learnings() ?? []);

  const createLearningCard = async () => {
    const title = newTitle().trim();
    if (!title) return;
    const learning = await createLearning({
      title,
      subject: newSubject().trim() || undefined,
      tags: newTags()
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
    });
    refetch();
    setNewTitle("");
    setNewSubject("");
    setNewTags("");
    navigate(`/learning-detail?id=${learning.id}`);
  };

  const openDetail = (id: string) => navigate(`/learning-detail?id=${id}`);

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
            PLAN.mdのセクション3に合わせて、フィルタ・検索と詳細導線を先に整えました。バックエンドAPIに保存されたLearningをそのまま一覧化しています。
          </p>
        </div>
        <div class="flex gap-2">
          <button class="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">
            インポート
          </button>
          <button
            class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500"
            onClick={createLearningCard}
          >
            + 学習を作成
          </button>
        </div>
      </header>

      <div class="grid gap-3 md:grid-cols-[2fr_1fr]">
        <div class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div class="flex flex-wrap gap-2">
              <For each={subjects}>
                {(item) => (
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
                )}
              </For>
            </div>
            <input
              value={query()}
              onInput={(e) => setQuery(e.currentTarget.value)}
              class="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100 md:w-64"
              placeholder="タイトル・タグ検索"
            />
          </div>

          <Show
            when={cards().length > 0}
            fallback={
              <div class="mt-4 rounded-lg border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                条件に合致する学習がありません。タイトルやタグを変えて再検索してください。
              </div>
            }
          >
            <div class="mt-4 grid gap-3 md:grid-cols-2">
              <For each={cards()}>
                {(learning) => (
                  <article class="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                    <div class="flex items-start justify-between gap-2">
                      <div>
                        <p class="text-xs font-semibold uppercase text-slate-500">
                          {subjectLabel(learning.subject)}
                        </p>
                        <h2 class="text-lg font-bold text-slate-900">
                          {learning.title}
                        </h2>
                        <div class="mt-1 flex flex-wrap gap-2 text-xs">
                          <For each={learning.tags ?? []}>
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
                          {formatDateTime(learning.lastStudiedAt ?? learning.updatedAt)}
                        </p>
                      </div>
                    </div>

                    <div class="space-y-2">
                      <div class="flex items-center justify-between text-xs font-semibold text-slate-700">
                        <span>進捗（演習平均）</span>
                        <span>{progressPercent(learning.progress)}%</span>
                      </div>
                      <div class="h-2 rounded-full bg-white">
                        <div
                          class="h-2 rounded-full bg-indigo-500 transition-all"
                          style={{ width: `${progressPercent(learning.progress)}%` }}
                        />
                      </div>
                    </div>

                    <div class="flex flex-wrap items-center gap-3 text-xs text-slate-600">
                      <div class="flex items-center gap-1 rounded-md bg-white px-2 py-1 shadow-sm">
                        <span class="font-semibold text-indigo-700">生成</span>
                        <span>{learning.generatedCount}</span>
                      </div>
                      <div class="flex items-center gap-1 rounded-md bg-white px-2 py-1 shadow-sm">
                        <span class="font-semibold text-emerald-700">
                          演習
                        </span>
                        <span>{learning.sessionCount}</span>
                      </div>
                      <div class="flex items-center gap-1 rounded-md bg-white px-2 py-1 shadow-sm">
                        <span class="font-semibold text-slate-700">教材</span>
                        <span>{learning.materialsCount}</span>
                      </div>
                    </div>

                    <div class="flex flex-wrap gap-2">
                      <button
                        class="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-white"
                        onClick={() => openDetail(learning.id)}
                      >
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
          </Show>
        </div>

        <aside class="space-y-3">
          <div class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p class="text-xs font-semibold uppercase text-slate-500">
              新規学習
            </p>
            <div class="mt-2 space-y-2 text-sm text-slate-700">
              <input
                value={newTitle()}
                onInput={(e) => setNewTitle(e.currentTarget.value)}
                class="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                placeholder="タイトル（必須）"
              />
              <input
                value={newSubject()}
                onInput={(e) => setNewSubject(e.currentTarget.value)}
                class="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                placeholder="教科（math, english など）"
              />
              <input
                value={newTags()}
                onInput={(e) => setNewTags(e.currentTarget.value)}
                class="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                placeholder="タグ（カンマ区切り）"
              />
              <button
                class="w-full rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500"
                onClick={createLearningCard}
              >
                追加して詳細へ進む
              </button>
            </div>
          </div>
          <div class="rounded-xl border border-indigo-100 bg-indigo-50 p-4 shadow-sm text-sm text-indigo-900">
            教科タグで絞り込み＆全文検索を最初に用意しました。カードから詳細・演習・生成へすぐ遷移できるMVPの導線です。
          </div>
        </aside>
      </div>
    </section>
  );
};

const LearningDetailSurface: Component = () => {
  const navigate = useNavigate();
  const settings = useSettings();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = createSignal<GeneratedContentType>(
    detailTabs[0].id as GeneratedContentType,
  );
  const [ingestPresetId, setIngestPresetId] = createSignal(
    materialIngestPresets[0].id,
  );
  const [generationPresetId, setGenerationPresetId] = createSignal(
    settings.state.presets[0]?.id ?? "",
  );
  const [selectedMaterialId, setSelectedMaterialId] = createSignal<string>();
  const [libraryConfig, setLibraryConfig] =
    createSignal<MaterialLibraryConfig>();
  const [ingestQueue, setIngestQueue] = createSignal<IngestJob[]>([]);
  const [materialType, setMaterialType] =
    createSignal<MaterialType>("text");
  const [materialText, setMaterialText] = createSignal("");
  const [materialFileName, setMaterialFileName] = createSignal("");
  const [materialBytes, setMaterialBytes] = createSignal<number | undefined>();
  const [materialPayload, setMaterialPayload] =
    createSignal<MaterialIngestRequest["payload"]>();
  const [saveMessage, setSaveMessage] = createSignal<string | null>(null);
  const [isIngesting, setIsIngesting] = createSignal(false);
  const [isGenerating, setIsGenerating] = createSignal(false);

  const [learningList] = createResource(() => true, () =>
    fetchLearnings({ limit: 50 }),
  );
  const [learning] = createResource(
    () => searchParams.id ?? learningList()?.[0]?.id,
    (id) => {
      const targetId = Array.isArray(id) ? id[0] : id;
      return targetId ? fetchLearning(targetId) : undefined;
    },
  );
  const [materials, { refetch: refetchMaterials }] = createResource(
    () => learning()?.id,
    (id) => (id ? fetchMaterials(id).then((res) => res.items) : []),
  );
  const [generatedContents, { refetch: refetchContents }] = createResource(
    () => learning()?.id,
    (id) => (id ? fetchContents(id).then((res) => res.items) : []),
  );
  const [practiceSessions] = createResource(
    () => learning()?.id,
    (id) => (id ? fetchSessions(id).then((res) => res.items) : []),
  );

  const formatBytes = (value?: number) =>
    value ? `${Math.round(value / 1024)} KB` : "サイズ不明";

  const generatedByType = createMemo(
    () =>
      (generatedContents() ?? []).reduce(
        (acc, item) => {
          const key = item.type ?? "other";
          acc[key] = [...(acc[key] ?? []), item];
          return acc;
        },
        {} as Record<GeneratedContentType, GeneratedContent[]>,
      ),
  );
  const presetOptions = createMemo(() =>
    selectPresetOptions(settings.state.presets),
  );

  createEffect(() => {
    if (!generationPresetId() && presetOptions().length) {
      setGenerationPresetId(presetOptions()[0].value);
    }
  });

  createEffect(() => {
    const list = learningList();
    if (!searchParams.id && list?.length) {
      setSearchParams({ id: list[0].id });
    }
  });

  createEffect(() => {
    const current = learning();
    if (current && searchParams.id !== current.id) {
      setSearchParams({ id: current.id });
    }
  });

  onMount(async () => {
    setLibraryConfig(await resolveLibraryConfig());
  });

  createEffect(() => {
    const preset = materialIngestPresets.find(
      (item) => item.id === ingestPresetId(),
    );
    if (preset) {
      setMaterialType(preset.request.source.kind as MaterialType);
    }
  });

  createEffect(() => {
    // 別の種別に切り替えたら選択済みファイルのメタ情報を破棄する
    materialType();
    setMaterialPayload(undefined);
    setMaterialFileName("");
    setMaterialBytes(undefined);
  });

  createEffect(() => {
    const list = materials();
    if (!list?.length) return;
    if (!selectedMaterialId() || !list.some((m) => m.id === selectedMaterialId())) {
      setSelectedMaterialId(list[0].id);
    }
  });

  createEffect(() => {
    const subject = learning()?.subject;
    if (!subject) return;
    const matched = settings.state.presets.find(
      (preset) => preset.subject === subject,
    );
    if (matched) {
      setGenerationPresetId(matched.id);
    }
  });

  const previewContent = (content: Record<string, unknown>) => {
    if (typeof content.title === "string") return content.title;
    if (typeof content.preview === "string") return content.preview;
    return JSON.stringify(content).slice(0, 80);
  };

  const materialSource = () => {
    if (materialType() === "text") return "テキスト入力";
    if (materialFileName()) return materialFileName();
    return "ファイル未選択";
  };

  const handleAddMaterial = async () => {
    const target = learning();
    const config = libraryConfig();
    if (!target || !config) return;

    const textContent = materialText().trim();
    let payload: MaterialIngestRequest["payload"] | undefined;

    if (materialType() === "text") {
      if (!textContent) {
        setSaveMessage("テキスト教材を入力してください。");
        return;
      }
      payload = {
        text: textContent,
        fileName: materialFileName().trim() || `${target.title}.txt`,
        bytes: textContent.length,
        mimeType: "text/plain",
      };
    } else {
      payload = materialPayload();
    }

    const urlValue = materialFileName().trim() || materialSource();
    const source: MaterialIngestRequest["source"] =
      materialType() === "text"
        ? { kind: "text", text: textContent || materialSource() }
        : materialType() === "url"
          ? {
              kind: "url",
              url: urlValue.startsWith("http") ? urlValue : "https://example.com",
            }
          : {
              kind: materialType() as Exclude<MaterialType, "text" | "url">,
              path: materialFileName() || materialSource(),
            };

    if (!payload && materialType() !== "url") {
      setSaveMessage("ファイルの処理が完了していません。再度選択してください。");
      return;
    }

    setIsIngesting(true);
    try {
      const result = await ingestMaterial({
        learningId: target.id,
        source,
        preferOffline: true,
        payload,
      });
      setIngestQueue((prev) => [result.job, ...prev]);
      setSelectedMaterialId(result.material.id);
      if (result.material.rawContent) {
        setMaterialText(result.material.rawContent.slice(0, 4000));
      } else {
        setMaterialText("");
      }
      setMaterialFileName("");
      setMaterialBytes(undefined);
      setMaterialPayload(undefined);
      await refetchMaterials();
      setSaveMessage(
        `教材(${result.material.type})を保存し、抽出テキストを反映しました。`,
      );
    } catch (error) {
      setSaveMessage(
        error instanceof Error
          ? `教材の追加に失敗しました: ${error.message}`
          : "教材の追加に失敗しました。",
      );
    } finally {
      setIsIngesting(false);
    }
  };

  const handleFileInput = async (fileList: FileList | null) => {
    const file = fileList?.item(0);
    if (!file) {
      setMaterialFileName("");
      setMaterialBytes(undefined);
      setMaterialPayload(undefined);
      return;
    }
    setMaterialFileName(file.name);
    setMaterialBytes(file.size);
    try {
      const processed = await processMaterialFile(file, materialType());
      setMaterialPayload({
        text: processed.text,
        dataUrl: processed.dataUrl,
        fileName: processed.fileName,
        bytes: processed.bytes,
        mimeType: processed.mimeType,
      });
      if (processed.text) {
        setMaterialText(processed.text.slice(0, 4000));
      } else {
        setMaterialText("");
      }
      if (processed.text) {
        setSaveMessage(
          `${materialType().toUpperCase()} から ${processed.text.length} 文字を抽出しました。`,
        );
      }
    } catch (error) {
      console.error(error);
      setMaterialPayload(undefined);
      setMaterialText("");
      setSaveMessage("ファイル処理に失敗しました。テキストを手入力してください。");
    }
  };

  const addGeneratedDraft = async () => {
    const target = learning();
    if (!target) return;
    const preset = settings.state.presets.find(
      (item) => item.id === generationPresetId(),
    );
    const materialId = selectedMaterialId();

    setIsGenerating(true);
    try {
      const result = await generateFromMaterial({
        learningId: target.id,
        materialId,
        types: [tab()],
        presetId: preset?.id,
        presetTitle: preset?.title,
        presetSystemPrompt: preset?.systemPrompt,
        presetUserTemplate: preset?.userInstructionTemplate,
      });
      await refetchContents();
      setSaveMessage(
        `${generatedTypeLabels[tab()]} を ${result.items.length} 件生成しました。`,
      );
      const generatedMaterialId = result.material?.id ?? materialId;
      if (generatedMaterialId) {
        setSelectedMaterialId(generatedMaterialId);
      }
    } catch (error) {
      setSaveMessage(
        error instanceof Error
          ? `生成に失敗しました: ${error.message}`
          : "生成に失敗しました。",
      );
    } finally {
      setIsGenerating(false);
    }
  };

  /* Early return removed */

  const stats = createMemo(() => {
    const sessions = practiceSessions() ?? [];
    const generated = generatedContents() ?? [];
    const generatedCounts = generated.reduce(
      (acc, item) => {
        const key = item.type ?? "other";
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      },
      {} as Record<GeneratedContentType, number>,
    );
    const lastStudied =
      sessions[0]?.createdAt ?? generated[0]?.createdAt ?? learning()?.updatedAt;
    return {
      generatedCounts,
      lastStudied,
      progress: learning()?.progress ?? 0,
    };
  });
  const selectedTabContents = createMemo(() => generatedByType()[tab()] ?? []);

  return (
    <Show
      when={learning()}
      fallback={
        <section class="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p class="text-sm text-slate-700">
            学習がまだありません。まず「学習一覧」でカードを追加してください。
          </p>
          <button
            class="w-fit rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            onClick={() => navigate("/")}
          >
            学習一覧に戻る
          </button>
        </section>
      }
    >
      <section class="space-y-6">
      <header class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p class="text-xs font-semibold uppercase tracking-wide text-indigo-600">
            学習詳細
          </p>
          <h1 class="text-2xl font-bold text-slate-900">
            {learning()!.title}
          </h1>
          <p class="text-sm text-slate-600">
            教材に紐づく生成コンテンツをタブで切り替えます。バックエンドAPIから読み込んだデータを生成・演習の起点にしています。
          </p>
          <div class="mt-2 flex flex-wrap gap-2 text-xs text-slate-600">
            <span class="rounded-full bg-slate-100 px-2 py-1">
              {subjectLabel(learning()?.subject)}
            </span>
            <For each={learning()?.tags ?? []}>
              {(tag) => (
                <span class="rounded-full bg-slate-100 px-2 py-1">{tag}</span>
              )}
            </For>
            <span>最終更新: {formatDateTime(learning()?.updatedAt)}</span>
          </div>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <div class="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700">
            進捗 {progressPercent(stats().progress)}%
          </div>
          <A
            href="/"
            class="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            一覧に戻る
          </A>
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
                      tab() === (item.id as GeneratedContentType)
                        ? "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200"
                        : "text-slate-700 hover:bg-slate-50"
                    }`}
                    onClick={() => setTab(item.id as GeneratedContentType)}
                  >
                    {item.label}
                  </button>
                )}
              </For>
            </div>
            <div class="flex flex-wrap items-center gap-2 text-xs">
              <select
                value={selectedMaterialId() ?? ""}
                onChange={(e) => setSelectedMaterialId(e.currentTarget.value)}
                class="rounded-lg border border-slate-200 px-2 py-2 text-xs text-slate-800"
              >
                <Show
                  when={(materials() ?? []).length > 0}
                  fallback={<option value="">教材未登録</option>}
                >
                  <For each={materials() ?? []}>
                    {(mat) => (
                      <option value={mat.id}>
                        {(mat.metadata?.name as string) ??
                          mat.sourcePath ??
                          `${mat.type.toUpperCase()}教材`}
                      </option>
                    )}
                  </For>
                </Show>
              </select>
              <select
                value={generationPresetId()}
                onChange={(e) => setGenerationPresetId(e.currentTarget.value)}
                class="rounded-lg border border-slate-200 px-2 py-2 text-xs text-slate-800"
              >
                <For each={presetOptions()}>
                  {(preset) => (
                    <option value={preset.value}>{preset.label}</option>
                  )}
                </For>
              </select>
              <button
                class="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-70"
                onClick={addGeneratedDraft}
                disabled={isGenerating() || (materials() ?? []).length === 0}
              >
                {isGenerating()
                  ? "生成中..."
                  : `${generatedTypeLabels[tab()]}生成`}
              </button>
            </div>
          </div>

          <div class="mt-4 space-y-3">
            <Show
              when={selectedTabContents().length > 0}
              fallback={
                <div class="rounded-lg border border-dashed border-slate-200 bg-stone-50 px-4 py-6 text-sm text-slate-700">
                  まだ生成されたコンテンツがありません。教材の追加後に生成してください。
                </div>
              }
            >
              <For each={selectedTabContents()}>
                {(item) => (
                  <article class="rounded-lg border border-slate-200 bg-slate-50/70 px-4 py-3">
                    <div class="flex items-start justify-between gap-2">
                      <div>
                        <p class="text-xs uppercase text-slate-500">
                          {generatedTypeLabels[item.type ?? "other"]}
                        </p>
                        <h3 class="text-sm font-semibold text-slate-900">
                          {previewContent(
                            item.content as Record<string, unknown>,
                          )}
                        </h3>
                        <p class="mt-1 text-sm text-slate-700">
                          {typeof (item.content as Record<string, unknown>)
                            .preview === "string"
                            ? ((item.content as Record<string, unknown>)
                                .preview as string)
                            : "要約・問題などの本文は生成API接続後に差し替え予定"}
                        </p>
                      </div>
                      <div class="text-right">
                        <p class="text-xs text-slate-500">
                          {formatDateTime(item.createdAt)}
                        </p>
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
              教材ファイル
            </p>
            <div class="mt-2 space-y-2 text-sm text-slate-700">
              <Show
                when={(materials() ?? []).length > 0}
                fallback={
                  <div class="rounded-md border border-dashed border-slate-200 bg-slate-50 px-3 py-2">
                    この学習に紐づく教材がまだありません。
                  </div>
                }
              >
                <For each={materials() ?? []}>
                  {(material) => (
                    <div class="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                      <div class="flex items-center justify-between">
                        <span class="font-semibold text-slate-800">
                          {material.sourcePath ?? material.type}
                        </span>
                        <span class="text-xs text-slate-500">
                          {formatBytes(
                            (material.metadata as { bytes?: number })?.bytes,
                          )}
                        </span>
                      </div>
                      <p class="text-xs uppercase text-slate-500">
                        {material.type}
                      </p>
                      <p class="text-sm text-slate-700">
                        {material.rawContent?.slice(0, 120) ||
                          "抽出テキストはAI呼び出しで更新します。"}
                      </p>
                    </div>
                  )}
                </For>
              </Show>
            </div>
          </div>

          <div class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p class="text-xs font-semibold uppercase text-slate-500">
              生成履歴
            </p>
            <ul class="mt-2 space-y-2 text-sm text-slate-700">
              <For each={(generatedContents() ?? []).filter((item) => item.learningId === learning()!.id)}>
                {(item) => (
                  <li class="rounded-md bg-slate-50 px-3 py-2">
                    {formatDateTime(item.createdAt)} {generatedTypeLabels[item.type ?? "other"]}
                  </li>
                )}
              </For>
              <Show when={(generatedContents() ?? []).filter((item) => item.learningId === learning()!.id).length === 0}>
                <li class="rounded-md bg-slate-50 px-3 py-2 text-slate-600">
                  まだ生成履歴がありません。
                </li>
              </Show>
            </ul>
          </div>

          <div class="rounded-xl border border-indigo-100 bg-indigo-50 p-4 shadow-sm text-sm text-indigo-900">
            タブ切り替え・教材・生成履歴を一箇所にまとめ、演習フローへ移りやすいMVP版の詳細画面です。
          </div>
        </aside>
      </div>

      <div class="grid gap-4 md:grid-cols-[2fr_1fr]">
        <div class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p class="text-xs font-semibold uppercase text-slate-500">
            教材入力（テキスト/ファイル）
          </p>
          <div class="mt-2 grid gap-3 md:grid-cols-2">
            <div class="space-y-2">
              <label class="text-xs font-semibold text-slate-600">
                種別
              </label>
              <select
                value={materialType()}
                onChange={(e) =>
                  setMaterialType(e.currentTarget.value as MaterialType)
                }
                class="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
              >
                <For each={["text", "pdf", "image", "audio", "video", "url"] as MaterialType[]}>
                  {(type) => (
                    <option value={type}>{type}</option>
                  )}
                </For>
              </select>
              <input
                type="file"
                class="w-full text-sm"
                onChange={(e) => void handleFileInput(e.currentTarget.files)}
              />
              <input
                value={materialFileName()}
                onInput={(e) => setMaterialFileName(e.currentTarget.value)}
                class="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                placeholder="ファイル名 / URL / パス"
              />
            </div>
            <div class="space-y-2">
              <label class="text-xs font-semibold text-slate-600">
                テキスト入力
              </label>
              <textarea
                value={materialText()}
                onInput={(e) => setMaterialText(e.currentTarget.value)}
                class="h-32 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                placeholder="教材の本文を貼り付け（テキスト種別時に保存）"
              />
              <div class="text-xs text-slate-500">
                {materialType() === "text"
                  ? "テキストはAPI経由で即保存します。非テキストはパスのみを記録します。"
                  : "PDF/画像/音声はパス・ファイル名を記録し、OCR/文字起こしは後段のAIで処理します。"}
              </div>
            </div>
          </div>
          <div class="mt-3 flex flex-wrap items-center justify-between gap-3">
            <div class="text-xs text-slate-600">
              追加先: {learning()?.title} / {materialSource()}・
              {materialBytes() ? formatBytes(materialBytes()) : "サイズ未計測"}
            </div>
            <button
              class="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-70"
              onClick={handleAddMaterial}
              disabled={isIngesting()}
            >
              {isIngesting() ? "保存中..." : "教材を保存"}
            </button>
          </div>
          <Show when={saveMessage()}>
            <div class="mt-2 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              {saveMessage()}
            </div>
          </Show>
        </div>

        <div class="space-y-3">
          <div class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p class="text-xs font-semibold uppercase text-slate-500">
              インデックス投入キュー
            </p>
            <div class="mt-2 space-y-2 text-sm text-slate-700">
              <Show
                when={ingestQueue().length > 0}
                fallback={
                  <div class="rounded-md border border-dashed border-slate-200 bg-slate-50 px-3 py-2">
                    追加した教材をここで管理します。バックエンドへの保存と抽出が完了するとステップが更新されます。
                  </div>
                }
              >
                <For each={ingestQueue()}>
                  {(job) => (
                    <div class="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                      <div class="flex items-center justify-between">
                        <span class="font-semibold text-slate-800">
                          {job.source.kind === "text"
                            ? "テキスト"
                            : job.source.kind.toUpperCase()}
                        </span>
                        <span class="text-xs text-slate-500">
                          {job.status}
                        </span>
                      </div>
                      <p class="text-xs text-slate-500">
                        {job.source.kind === "url"
                          ? job.source.url
                          : job.source.kind === "text"
                            ? (job.source.text?.slice(0, 40) ?? "テキスト")
                            : job.source.path}
                      </p>
                      <div class="mt-1 flex flex-wrap gap-1">
                        <For each={job.steps}>
                          {(step) => (
                            <span
                              class={`rounded-full px-2 py-1 text-[10px] font-semibold uppercase ${
                                step.status === "succeeded"
                                  ? "bg-emerald-50 text-emerald-700"
                                  : step.status === "running"
                                    ? "bg-indigo-50 text-indigo-700"
                                    : "bg-slate-100 text-slate-600"
                              }`}
                            >
                              {step.label}
                            </span>
                          )}
                        </For>
                      </div>
                    </div>
                  )}
                </For>
              </Show>
            </div>
          </div>

          <div class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p class="text-xs font-semibold uppercase text-slate-500">
              プリセット / 生成パラメータ
            </p>
            <div class="mt-2 space-y-2 text-sm text-slate-700">
              <select
                value={ingestPresetId()}
                onChange={(e) => setIngestPresetId(e.currentTarget.value)}
                class="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
              >
                <For each={materialIngestPresets}>
                  {(preset) => (
                    <option value={preset.id}>{preset.label}</option>
                  )}
                </For>
              </select>
              <p class="text-xs text-slate-500">
                選択したプリセットは生成APIへ送信され、system prompt / user template として利用されます。
              </p>
            </div>
          </div>

          <div class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p class="text-xs font-semibold uppercase text-slate-500">
              直近の演習
            </p>
            <div class="mt-2 space-y-2 text-sm text-slate-700">
              <Show
                when={(practiceSessions()?.length ?? 0) > 0}
                fallback={
                  <p class="text-slate-600">演習履歴がまだありません。</p>
                }
              >
                <For each={practiceSessions()}>
                  {(session) => (
                    <div class="rounded-md bg-slate-50 px-3 py-2">
                      <div class="flex items-center justify-between">
                        <span class="font-semibold text-slate-800">
                          {(session.questionRef?.title as string) ?? "演習"}
                        </span>
                        <span class="text-xs text-slate-500">
                          {formatDateTime(session.createdAt)}
                        </span>
                      </div>
                      <p class="text-sm text-slate-700">
                        {session.answerText}
                      </p>
                      <p class="text-xs text-slate-500">
                        {session.isCorrect
                          ? "正解"
                          : session.isCorrect === false
                            ? "不正解"
                            : "採点待ち"}
                        ・score: {session.score ?? "-"}
                      </p>
                    </div>
                  )}
                </For>
              </Show>
            </div>
          </div>
        </div>
      </div>
    </section>
    </Show>
  );
};


const PracticeSurface: Component = () => {
  interface Question {
    id: string;
    generatedContentId: string;
    title: string;
    prompt: string;
    expected?: string;
    hint?: string;
  }

  const [mode, setMode] = createSignal<"handwriting" | "text">("text");
  const [selectedLearningId, setSelectedLearningId] = createSignal<string>();
  const [questionIndex, setQuestionIndex] = createSignal(0);
  const [answer, setAnswer] = createSignal("");
  const [grading, setGrading] = createSignal<{ score: number; isCorrect: boolean; comment: string } | null>(
    null,
  );
  const [isSubmitting, setIsSubmitting] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const [learnings] = createResource(() => true, () => fetchLearnings({ limit: 50 }));
  createEffect(() => {
    const list = learnings();
    if (list?.length && !selectedLearningId()) {
      setSelectedLearningId(list[0].id);
    }
  });

  const [generatedContents, { refetch: refetchContents }] = createResource(
    () => selectedLearningId(),
    (id) => (id ? fetchContents(id).then((res) => res.items) : []),
  );
  const [sessions, { refetch: refetchSessions }] = createResource(
    () => selectedLearningId(),
    (id) => (id ? fetchSessions(id).then((res) => res.items) : []),
  );

  const questions = createMemo<Question[]>(() => {
    const contents = generatedContents() ?? [];
    const extracted: Question[] = [];
    for (const content of contents) {
      const payload = content.content as Record<string, unknown>;
      if (content.type === "practice" && Array.isArray(payload.items)) {
        for (const item of payload.items as Record<string, string>[]) {
          extracted.push({
            id: crypto.randomUUID(),
            generatedContentId: content.id,
            title: payload.title ? String(payload.title) : "練習問題",
            prompt: item.prompt ?? item.question ?? "問題文が取得できませんでした。",
            expected: item.expectedAnswer ?? item.answer,
            hint: item.hint,
          });
        }
      } else if (content.type === "qa" && Array.isArray(payload.pairs)) {
        for (const pair of payload.pairs as Record<string, string>[]) {
          extracted.push({
            id: crypto.randomUUID(),
            generatedContentId: content.id,
            title: payload.title ? String(payload.title) : "一問一答",
            prompt: pair.question ?? "質問が取得できませんでした。",
            expected: pair.answer,
            hint: pair.rationale,
          });
        }
      }
    }
    return extracted;
  });

  const currentQuestion = createMemo(() => questions()[questionIndex()] ?? null);

  const computeScore = (expected: string, input: string) => {
    if (!expected) return 0;
    const normalize = (text: string) =>
      text
        .toLowerCase()
        .replace(/[^\p{Letter}\p{Number}\s]/gu, " ")
        .split(/\s+/)
        .filter(Boolean);
    const expectedTokens = normalize(expected);
    const answerTokens = normalize(input);
    if (expectedTokens.length === 0 || answerTokens.length === 0) return 0;
    const overlap = answerTokens.filter((token) => expectedTokens.includes(token)).length;
    return Math.min(1, overlap / expectedTokens.length);
  };

  const moveQuestion = (delta: number) => {
    const total = questions().length;
    if (total === 0) return;
    setQuestionIndex((index) => {
      const next = index + delta;
      if (next < 0) return 0;
      if (next >= total) return total - 1;
      return next;
    });
    setAnswer("");
    setGrading(null);
  };

  const handleSubmit = async () => {
    setError(null);
    const question = currentQuestion();
    const learningId = selectedLearningId();
    if (!question || !learningId) return;
    const trimmed = answer().trim();
    if (!trimmed) return;

    const score = computeScore(question.expected ?? "", trimmed);
    const isCorrect = score >= 0.6;
    const comment =
      question.expected && score < 0.3
        ? "キーワードがほとんど一致していません。ヒントを参考に解き直してください。"
        : score >= 0.6
          ? "概ね正解です。"
          : "一部不足があります。もう一度確認しましょう。";

    setIsSubmitting(true);
    try {
      await createSession({
        learningId,
        generatedContentId: question.generatedContentId,
        questionRef: {
          title: question.title,
          prompt: question.prompt,
          expected: question.expected,
        },
        answerText: trimmed,
        isCorrect,
        feedback: { comment, hint: question.hint },
        score,
      });
      setGrading({ score, isCorrect, comment });
      setAnswer("");
      await Promise.all([refetchSessions(), refetchContents()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "採点に失敗しました。");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section class="space-y-6">
      <header class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p class="text-xs font-semibold uppercase tracking-wide text-indigo-600">
            演習
          </p>
          <h1 class="text-2xl font-bold text-slate-900">手書き入力とテキスト入力を切り替える演習モード</h1>
          <p class="text-sm text-slate-600">
            バックエンドに保存された生成コンテンツ（練習問題・一問一答）を直接出題し、採点結果を PracticeSession として保存します。
          </p>
        </div>
        <div class="flex flex-wrap gap-2">
          <select
            value={selectedLearningId() ?? ""}
            onChange={(event) => {
              setSelectedLearningId(event.currentTarget.value);
              setQuestionIndex(0);
              setGrading(null);
            }}
            class="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-800"
          >
            <Show when={(learnings() ?? []).length > 0} fallback={<option value="">学習未選択</option>}>
              <For each={learnings() ?? []}>
                {(learning) => <option value={learning.id}>{learning.title}</option>}
              </For>
            </Show>
          </select>
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

      <Show
        when={questions().length > 0}
        fallback={
          <div class="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-700">
            練習用の生成コンテンツがまだありません。学習詳細で練習問題または一問一答を生成してから、ここで解答してください。
          </div>
        }
      >
        <div class="grid gap-4 md:grid-cols-[1.2fr_1fr]">
          <div class="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div class="flex items-center justify-between">
              <div>
                <p class="text-xs uppercase text-slate-500">
                  問題 {questionIndex() + 1} / {questions().length}
                </p>
                <h2 class="text-lg font-semibold text-slate-900">
                  {currentQuestion()?.prompt ?? "問題が読み込めませんでした"}
                </h2>
                <p class="text-sm text-slate-600">
                  ヒント: {currentQuestion()?.hint ?? "生成コンテンツから抽出した問題です。"}
                </p>
              </div>
              <div class="flex gap-2">
                <button
                  class="rounded-md border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={() => moveQuestion(-1)}
                  disabled={questionIndex() === 0}
                >
                  前の問題
                </button>
                <button
                  class="rounded-md border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={() => moveQuestion(1)}
                  disabled={questionIndex() >= questions().length - 1}
                >
                  次の問題
                </button>
              </div>
            </div>

            <div class="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-600">
              <p class="font-semibold text-slate-800">関連情報</p>
              <p class="mt-2">
                練習問題の元になった生成コンテンツ ID: {currentQuestion()?.generatedContentId}
                。解答のみ入力して送信してください。
              </p>
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
                    ? "紙に解いた結果を入力してください。"
                    : "回答を直接入力してください。キーワードを簡潔に含めてください。"
                }
                value={answer()}
                onInput={(e) => setAnswer(e.currentTarget.value)}
              />
              <div class="flex gap-2 text-xs text-slate-600">
                <button
                  class="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-70"
                  onClick={handleSubmit}
                  disabled={isSubmitting() || !answer().trim()}
                >
                  {isSubmitting() ? "採点中..." : "採点して送信"}
                </button>
                <button
                  class="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                  onClick={() => setAnswer("")}
                >
                  クリア
                </button>
              </div>
              <Show when={error()}>
                {(err) => <p class="text-xs text-rose-600">{err()}</p>}
              </Show>
            </div>

            <div class="space-y-2">
              <p class="text-xs font-semibold uppercase text-slate-500">
                フィードバック
              </p>
              <div class="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800">
                <Show
                  when={grading()}
                  fallback={<p>採点するとここにスコアとコメントが表示されます。</p>}
                >
                  {(result) => (
                    <>
                      <p>
                        正答判定: {result().isCorrect ? "正解" : "部分正解"} / score{" "}
                        {(result().score * 100).toFixed(0)}%
                      </p>
                      <p class="text-xs text-slate-600">{result().comment}</p>
                    </>
                  )}
                </Show>
              </div>
            </div>

            <div class="space-y-2">
              <p class="text-xs font-semibold uppercase text-slate-500">
                演習履歴
              </p>
              <div class="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                <For each={sessions() ?? []}>
                  {(session) => (
                    <div class="rounded-md bg-white p-2 text-slate-800">
                      <p class="text-xs font-semibold uppercase text-slate-500">
                        {(session.questionRef?.title as string) ?? "演習"}
                      </p>
                      <p class="mt-1 text-sm">{(session.questionRef?.prompt as string)}</p>
                      <p class="text-xs text-slate-500">
                        あなた: {session.answerText} / score {session.score ? (session.score * 100).toFixed(0) : "-"}%
                      </p>
                    </div>
                  )}
                </For>
                <Show when={(sessions() ?? []).length === 0}>
                  <p class="text-xs text-slate-500">まだ演習ログがありません。</p>
                </Show>
              </div>
            </div>
          </div>
        </div>
      </Show>
    </section>
  );
};

const ChatSurface: Component = () => {
  interface ChatMessage { role: "user" | "assistant"; content: string }
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

  const [toolSearchQuery, setToolSearchQuery] = createSignal("");
  const [toolNewLearningTitle, setToolNewLearningTitle] = createSignal("");
  const [toolNewLearningSubject, setToolNewLearningSubject] = createSignal("");
  const [isToolRunning, setIsToolRunning] = createSignal(false);

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

  const runToolCall = async (tool: ToolName, params: Record<string, unknown>) => {
    setError(null);
    setIsToolRunning(true);
    try {
      const payload = await invokeTool(tool, params);
      setToolCalls((prev) => [
        ...prev,
        {
          tool: payload.tool,
          detail: JSON.stringify(params),
          result:
            typeof payload.result === "string"
              ? payload.result
              : JSON.stringify(payload.result).slice(0, 160),
        },
      ]);
      if (payload.tool === "search_learnings") {
        const items = (payload.result as { items?: { title: string; subject?: string }[] })
          ?.items;
        if (items?.length) {
          appendMessage(
            "assistant",
            `検索結果: ${items
              .map((item) => `${item.title}${item.subject ? ` (${item.subject})` : ""}`)
              .join(", ")}`,
          );
        }
      }
      if (payload.tool === "create_learning_from_chat") {
        const learning = (payload.result as { learning?: { title: string } }).learning;
        if (learning) {
          appendMessage("assistant", `学習カードを作成しました: ${learning.title}`);
        }
      }
    } catch (err) {
      console.error(err);
      setError("Tool Callに失敗しました。もう一度お試しください。");
    } finally {
      setIsToolRunning(false);
    }
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

          <div class="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800">
            <p class="text-xs font-semibold uppercase text-slate-500">Tool Call Playground</p>
            <label class="flex flex-col gap-1">
              <span class="text-xs font-semibold text-slate-600">学習検索クエリ</span>
              <input
                class="rounded-md border border-slate-200 px-2 py-1"
                placeholder="例: 二次関数"
                value={toolSearchQuery()}
                onInput={(event) => setToolSearchQuery(event.currentTarget.value)}
              />
            </label>
            <button
              class="w-full rounded-md bg-indigo-600 px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
              onClick={() =>
                runToolCall("search_learnings", {
                  q: toolSearchQuery().trim(),
                  limit: 5,
                })
              }
              disabled={isToolRunning() || !toolSearchQuery().trim()}
            >
              学習カードを検索
            </button>
            <div class="h-px w-full bg-slate-200" />
            <label class="flex flex-col gap-1">
              <span class="text-xs font-semibold text-slate-600">新しい学習タイトル</span>
              <input
                class="rounded-md border border-slate-200 px-2 py-1"
                placeholder="例: 英単語ターゲット"
                value={toolNewLearningTitle()}
                onInput={(event) => setToolNewLearningTitle(event.currentTarget.value)}
              />
            </label>
            <label class="flex flex-col gap-1">
              <span class="text-xs font-semibold text-slate-600">科目 (任意)</span>
              <input
                class="rounded-md border border-slate-200 px-2 py-1"
                placeholder="math / english など"
                value={toolNewLearningSubject()}
                onInput={(event) => setToolNewLearningSubject(event.currentTarget.value)}
              />
            </label>
            <button
              class="w-full rounded-md bg-emerald-600 px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
              onClick={() =>
                runToolCall("create_learning_from_chat", {
                  title: toolNewLearningTitle().trim(),
                  subject: toolNewLearningSubject().trim() || undefined,
                })
              }
              disabled={isToolRunning() || !toolNewLearningTitle().trim()}
            >
              学習カードを作成
            </button>
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

const NewLearningSurface: Component = () => {
  const [sourceLearningId, setSourceLearningId] = createSignal<string>();
  const [selectedMaterialIds, setSelectedMaterialIds] = createSignal<string[]>([]);
  const [selectedContentIds, setSelectedContentIds] = createSignal<string[]>([]);
  const [title, setTitle] = createSignal("");
  const [tags, setTags] = createSignal("");
  const [status, setStatus] = createSignal<string | null>(null);
  const [isCreating, setIsCreating] = createSignal(false);
  const summarizeForDisplay = (value: unknown) =>
    (typeof value === "string" ? value : JSON.stringify(value ?? {}))
      .replace(/\s+/g, " ")
      .slice(0, 80);

  const [learnings] = createResource(() => true, () => fetchLearnings({ limit: 50 }));
  createEffect(() => {
    const list = learnings();
    if (list?.length && !sourceLearningId()) {
      setSourceLearningId(list[0].id);
    }
  });

  const [materials] = createResource(
    () => sourceLearningId(),
    (id) => (id ? fetchMaterials(id).then((res) => res.items) : []),
  );
  const [generatedContents] = createResource(
    () => sourceLearningId(),
    (id) => (id ? fetchContents(id).then((res) => res.items) : []),
  );

  const toggleSelection = (ids: string[], setIds: (value: string[]) => void, id: string) => {
    if (ids.includes(id)) {
      setIds(ids.filter((item) => item !== id));
    } else {
      setIds([...ids, id]);
    }
  };

  const handleCreate = async () => {
    const source = learnings()?.find((learning) => learning.id === sourceLearningId());
    if (!source) {
      setStatus("抽出元の学習を選択してください。");
      return;
    }
    const normalizedTitle = title().trim() || `${source.title}_派生`;
    const normalizedTags = tags()
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);

    setIsCreating(true);
    setStatus(null);
    try {
      const newLearning = await createLearning({
        title: normalizedTitle,
        subject: source.subject,
        tags: normalizedTags.length > 0 ? normalizedTags : source.tags,
      });

      const materialList =
        materials()
          ?.filter((mat) => selectedMaterialIds().includes(mat.id))
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          .map(({ id: _id, learningId: _learning, createdAt: _c, updatedAt: _u, ...rest }) => rest) ?? [];
      const contentList =
        generatedContents()
          ?.filter((content) => selectedContentIds().includes(content.id))
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          .map(({ id: _id, learningId: _learning, createdAt: _c, ...rest }) => rest) ?? [];

      await Promise.all(
        materialList.map((mat) =>
          createMaterial({
            ...mat,
            learningId: newLearning.id,
          }),
        ),
      );
      await Promise.all(
        contentList.map((content) =>
          createContent({
            ...content,
            learningId: newLearning.id,
          }),
        ),
      );

      setStatus(
        `「${normalizedTitle}」を作成しました（教材 ${materialList.length} 件 / 生成コンテンツ ${contentList.length} 件をコピー）。`,
      );
      setSelectedMaterialIds([]);
      setSelectedContentIds([]);
    } catch (error) {
      setStatus(
        error instanceof Error ? `作成に失敗しました: ${error.message}` : "作成に失敗しました。",
      );
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <section class="space-y-6">
      <header class="space-y-2">
        <p class="text-xs font-semibold uppercase tracking-wide text-indigo-600">
          過去教材から新しい学習作成
        </p>
        <h1 class="text-2xl font-bold text-slate-900">
          既存の教材・生成物を選んで新しいLearningとして保存
        </h1>
        <p class="text-sm text-slate-600">
          抽出元のLearningを選び、コピーしたい教材と生成コンテンツにチェックを入れて新規Learningを作成します。
        </p>
      </header>

      <div class="grid gap-4 md:grid-cols-[0.9fr_1fr_1fr]">
        <div class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p class="text-xs font-semibold uppercase text-slate-500">
            ① 抽出元を選択
          </p>
          <div class="mt-2 space-y-2 text-sm text-slate-800">
            <For each={learnings() ?? []}>
              {(learning) => (
                <label class="flex items-center gap-2">
                  <input
                    type="radio"
                    name="learning"
                    checked={learning.id === sourceLearningId()}
                    onChange={() => setSourceLearningId(learning.id)}
                  />
                  <div>
                    <p class="font-semibold text-slate-900">{learning.title}</p>
                    <p class="text-xs text-slate-600">
                      {subjectLabel(learning.subject)} / {learning.tags?.join(", ")}
                    </p>
                  </div>
                </label>
              )}
            </For>
            <Show when={!learnings() || learnings()?.length === 0}>
              <p class="text-xs text-slate-500">抽出元となるLearningがありません。</p>
            </Show>
          </div>
        </div>

        <div class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p class="text-xs font-semibold uppercase text-slate-500">
            ② コピーする教材と生成物
          </p>
          <div class="mt-2 space-y-2 text-sm text-slate-800">
            <p class="text-xs font-semibold text-slate-600">教材</p>
            <For each={materials() ?? []}>
              {(material) => (
                <label class="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={selectedMaterialIds().includes(material.id)}
                    onChange={() =>
                      toggleSelection(selectedMaterialIds(), setSelectedMaterialIds, material.id)
                    }
                  />
                  <span>
                    {material.sourcePath ?? material.type.toUpperCase()}
                    <span class="block text-xs text-slate-600">
                      {material.rawContent ? summarizeForDisplay(material.rawContent) : material.type}
                    </span>
                  </span>
                </label>
              )}
            </For>
            <Show when={(materials() ?? []).length === 0}>
              <p class="text-xs text-slate-500">教材がありません。</p>
            </Show>
            <p class="pt-2 text-xs font-semibold text-slate-600">生成コンテンツ</p>
            <For each={generatedContents() ?? []}>
              {(content) => (
                <label class="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={selectedContentIds().includes(content.id)}
                    onChange={() =>
                      toggleSelection(selectedContentIds(), setSelectedContentIds, content.id)
                    }
                  />
                  <span>
                    {generatedTypeLabels[content.type] ?? content.type}
                    <span class="block text-xs text-slate-600">
                      {summarizeForDisplay(content.content)}
                    </span>
                  </span>
                </label>
              )}
            </For>
            <Show when={(generatedContents() ?? []).length === 0}>
              <p class="text-xs text-slate-500">生成コンテンツがありません。</p>
            </Show>
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
                value={title()}
                onInput={(e) => setTitle(e.currentTarget.value)}
                placeholder="例: 〇〇の復習セット"
              />
            </label>
            <label class="flex flex-col gap-1">
              <span class="text-xs font-semibold text-slate-600">タグ (カンマ区切り)</span>
              <input
                class="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800"
                value={tags()}
                onInput={(e) => setTags(e.currentTarget.value)}
                placeholder="二次関数, 復習, 小テスト"
              />
            </label>
            <div class="rounded-lg bg-slate-50 px-3 py-2">
              <p class="text-xs font-semibold uppercase text-slate-500">
                コピー対象の概要
              </p>
              <ul class="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-700">
                <li>教材 {selectedMaterialIds().length} 件</li>
                <li>生成コンテンツ {selectedContentIds().length} 件</li>
              </ul>
            </div>
          </div>
          <div class="mt-3 flex gap-2">
            <button
              class="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-70"
              onClick={handleCreate}
              disabled={isCreating() || !sourceLearningId()}
            >
              {isCreating() ? "作成中..." : "学習を作成"}
            </button>
          </div>
          <Show when={status()}>
            {(text) => (
              <p class="mt-2 text-xs text-slate-700">
                {text()}
              </p>
            )}
          </Show>
        </div>
      </div>
    </section>
  );
};

const AppSettingsSurface: Component = () => {
  const settings = useSettings();

  const [editingPresetId, setEditingPresetId] = createSignal<string | undefined>();
  const [presetSubject, setPresetSubject] = createSignal("math");
  const [presetTitle, setPresetTitle] = createSignal("");
  const [presetSystemPrompt, setPresetSystemPrompt] = createSignal("");
  const [presetUserTemplate, setPresetUserTemplate] = createSignal("");
  const [backupMessage, setBackupMessage] = createSignal<string | null>(null);
  const [backupError, setBackupError] = createSignal<string | null>(null);
  const [isExporting, setIsExporting] = createSignal(false);
  const [isImporting, setIsImporting] = createSignal(false);
  const [isSyncingPresets, setIsSyncingPresets] = createSignal(false);
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

  const syncPresetsFromApi = async () => {
    setBackupError(null);
    setIsSyncingPresets(true);
    try {
      const presets = await fetchPresets({ limit: 50 });
      if (presets.length) {
        settings.replacePresets(presets);
        setBackupMessage(`バックエンドのプリセット ${presets.length} 件を読み込みました。`);
      }
    } catch (error) {
      setBackupError(
        error instanceof Error
          ? error.message
          : "プリセットの取得に失敗しました。",
      );
    } finally {
      setIsSyncingPresets(false);
    }
  };

  onMount(() => {
    resetPresetDraft();
    void syncPresetsFromApi();
  });

  const savePreset = async () => {
    setBackupError(null);
    const title = presetTitle().trim();
    if (!title || !presetSystemPrompt().trim() || !presetUserTemplate().trim()) {
      setBackupError("プリセット名とプロンプトは必須です。");
      return;
    }
    setIsSyncingPresets(true);
    const saved = settings.upsertPreset({
      id: editingPresetId(),
      subject: presetSubject().trim() || "general",
      title,
      systemPrompt: presetSystemPrompt().trim(),
      userInstructionTemplate: presetUserTemplate().trim(),
    });
    try {
      if (editingPresetId()) {
        await updatePreset(saved.id, {
          subject: saved.subject,
          title: saved.title,
          systemPrompt: saved.systemPrompt,
          userInstructionTemplate: saved.userInstructionTemplate,
          createdAt: saved.createdAt,
          updatedAt: saved.updatedAt,
        });
      } else {
        await createPreset(saved);
      }
      setBackupMessage(`プリセットを保存しました: ${saved.title}`);
      resetPresetDraft();
    } catch (error) {
      setBackupError(
        error instanceof Error
          ? error.message
          : "プリセットの保存に失敗しました。",
      );
    } finally {
      setIsSyncingPresets(false);
    }
  };

  const editPreset = (preset: Preset) => {
    setEditingPresetId(preset.id);
    setPresetSubject(preset.subject);
    setPresetTitle(preset.title);
    setPresetSystemPrompt(preset.systemPrompt);
    setPresetUserTemplate(preset.userInstructionTemplate);
  };

  const duplicatePreset = async (id: string) => {
    const duplicated = settings.duplicatePreset(id);
    if (!duplicated) return;
    setIsSyncingPresets(true);
    try {
      await createPreset(duplicated);
      setBackupMessage(`プリセットを複製しました: ${duplicated.title}`);
    } catch (error) {
      setBackupError(
        error instanceof Error
          ? error.message
          : "プリセットの複製に失敗しました。",
      );
    } finally {
      setIsSyncingPresets(false);
    }
  };

  const deletePreset = async (id: string) => {
    setIsSyncingPresets(true);
    try {
      await deletePresetApi(id);
      settings.deletePreset(id);
      setBackupMessage("プリセットを削除しました");
      if (editingPresetId() === id) {
        resetPresetDraft();
      }
    } catch (error) {
      setBackupError(
        error instanceof Error
          ? error.message
          : "プリセットの削除に失敗しました。",
      );
    } finally {
      setIsSyncingPresets(false);
    }
  };

  const handleExport = async () => {
    setIsExporting(true);
    setBackupError(null);
    try {
      const snapshotDb = await fetchSnapshot();
      const snapshot = buildBackupSnapshot(
        snapshotDb,
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
    setIsImporting(true);
    try {
      const snapshot = await parseSnapshotFile(file);
      await replaceSnapshot(snapshot.db as SnapshotPayload);
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
      setIsImporting(false);
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
                class="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={triggerImport}
                disabled={isImporting()}
              >
                {isImporting() ? "インポート中..." : "インポート"}
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
              <p class="text-xs text-emerald-700">{backupMessage()}</p>
            </Show>
            <Show when={backupError()}>
              <p class="text-xs text-rose-700">{backupError()}</p>
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
          <div class="flex items-center gap-2">
            <button
              class="rounded-md border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              onClick={() => void syncPresetsFromApi()}
              disabled={isSyncingPresets()}
            >
              {isSyncingPresets() ? "同期中..." : "バックエンドと同期"}
            </button>
            <button
              class="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-100 disabled:opacity-60"
              onClick={savePreset}
              disabled={isSyncingPresets()}
            >
              + プリセットを追加
            </button>
          </div>
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
                <button
                  class="rounded-md border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50"
                  onClick={() => deletePreset(editingPresetId()!)}
                >
                  削除
                </button>
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
                          disabled={isSyncingPresets()}
                        >
                          編集
                        </button>
                        <button
                          class="rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                          onClick={() => duplicatePreset(preset.id)}
                          disabled={isSyncingPresets()}
                        >
                          複製
                        </button>
                        <button
                          class="rounded-md border border-rose-200 px-2 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50"
                          onClick={() => deletePreset(preset.id)}
                          disabled={isSyncingPresets()}
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

export interface Surface {
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
