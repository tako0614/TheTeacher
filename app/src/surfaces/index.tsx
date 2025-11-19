import { A, useNavigate, useSearchParams } from "@solidjs/router";
import {
  For,
  Match,
  Show,
  Switch,
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
  type Material,
  type MaterialIngestRequest,
  type MaterialLibraryConfig,
  type MaterialLibraryEntry,
  type MaterialType,
  type PracticeFeedback,
  type PracticeMode,
  type SimilarQuestion,
  type Preset,
} from "@theteacher/shared";

import {
  materialIngestPresets,
  resolveLibraryConfig,
} from "../lib/materials";
import RichContentRenderer from "../components/rich-content/RichContentRenderer";
import { getRichContentPreview } from "../lib/rich-content";

import {
  type GeneratedSummary,
  type ProxyActions,
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
  deleteMaterial,
  generateFromMaterial,
  ingestMaterial,
  createSession,
  fetchContents,
  fetchLearnings,
  fetchLearning,
  fetchMaterialLibrary,
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
import { useNewLearningDraft } from "../lib/new-learning-draft-store";
import { processMaterialFile } from "../lib/file-processing";
import { gradePracticeAnswer } from "../lib/practice";

const subjects = [
  { id: "all", label: "すべて" },
  { id: "math", label: "数学" },
  { id: "english", label: "英語" },
  { id: "science", label: "理科" },
  { id: "programming", label: "プログラミング" },
];

const subjectLabel = (value?: string | null) =>
  subjects.find((item) => item.id === value)?.label ?? value ?? "未設定";

const extractRefId = (match: { id: string; refId?: string }) => {
  if (match.refId && typeof match.refId === "string") return match.refId;
  const parts = match.id.split(":");
  return parts.length > 1 ? parts.slice(1).join(":") : match.id;
};

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
  other: "リッチノート",
};

const detailTabs = [
  { id: "qa", label: generatedTypeLabels.qa },
  { id: "practice", label: generatedTypeLabels.practice },
  { id: "summary", label: generatedTypeLabels.summary },
  { id: "podcast_script", label: generatedTypeLabels.podcast_script },
  { id: "other", label: generatedTypeLabels.other },
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

  const previewContent = (content: Record<string, unknown>) =>
    getRichContentPreview(content);

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
      const currentType = materialType();
      if (processed.text) {
        setMaterialText(processed.text.slice(0, 4000));
        setSaveMessage(
          `${currentType.toUpperCase()} から ${processed.text.length} 文字を抽出しました。`,
        );
      } else {
        setMaterialText("");
        if (currentType === "audio" || currentType === "video") {
          setSaveMessage(
            `${file.name} をアップロードしました。OpenAIで${currentType === "audio" ? "文字起こし" : "音声抽出/文字起こし"}を実行します。`,
          );
        }
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
  const generatedContentMap = createMemo(() => {
    const map = new Map<string, GeneratedContent>();
    (generatedContents() ?? []).forEach((item) => map.set(item.id, item));
    return map;
  });
  const learningSemanticSeed = createMemo(() => {
    const current = learning();
    if (!current) return "";
    const tagsText = (current.tags ?? []).join(" ");
    const lead = selectedTabContents()[0];
    const preview =
      lead?.content && typeof lead.content === "object"
        ? previewContent(lead.content as Record<string, unknown>)
        : undefined;
    return [current.title, current.subject, tagsText, preview].filter(Boolean).join(" ");
  });
  const [semanticRelated, { refetch: refetchSemanticRelated }] = createResource(
    () => {
      const query = learningSemanticSeed().trim();
      const current = learning();
      if (!current || !query) return undefined;
      return { query, subject: current.subject, learningId: current.id };
    },
    async (params) => {
      if (!params) return { learningHits: [], contentHits: [] };
      const [learningHits, contentHits] = await Promise.all([
        semanticSearch(params.query, 4, {
          refType: "learning",
          subject: params.subject,
        }),
        semanticSearch(params.query, 6, {
          refType: "generated_content",
          subject: params.subject,
        }),
      ]);
      return {
        learningHits: learningHits.filter((hit) => extractRefId(hit) !== params.learningId),
        contentHits,
      };
    },
  );

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
                        <div class="mt-2 text-sm">
                          <RichContentRenderer value={item.content} />
                        </div>
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

          <div class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div class="flex items-center justify-between">
              <p class="text-xs font-semibold uppercase text-slate-500">
                関連候補 (意味検索)
              </p>
              <button
                class="rounded-md border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={() => refetchSemanticRelated()}
                disabled={semanticRelated.loading}
              >
                再検索
              </button>
            </div>
            <div class="mt-2 space-y-3 text-sm text-slate-800">
              <div class="space-y-2">
                <p class="text-[11px] font-semibold uppercase text-slate-600">
                  関連学習
                </p>
                <Show
                  when={(semanticRelated()?.learningHits?.length ?? 0) > 0}
                  fallback={
                    <p class="text-xs text-slate-600">
                      学習タイトル・タグをもとに近いカードを提示します。
                    </p>
                  }
                >
                  <div class="space-y-2">
                    <For each={semanticRelated()?.learningHits ?? []}>
                      {(hit) => {
                        const refId = extractRefId(hit);
                        const subjectText = hit.subject ? subjectLabel(hit.subject) : null;
                        return (
                          <div class="rounded-md bg-slate-50 px-3 py-2">
                            <div class="flex items-center justify-between gap-2">
                              <span class="font-semibold text-slate-900">
                                {hit.label}
                              </span>
                              <span class="text-[11px] text-indigo-700">
                                score {hit.score.toFixed(2)}
                              </span>
                            </div>
                            <p class="text-xs text-slate-600">{hit.excerpt}</p>
                            <div class="mt-1 flex flex-wrap items-center gap-2">
                              <Show when={subjectText}>
                                {(text) => (
                                  <span class="rounded-full bg-indigo-50 px-2 py-1 text-[11px] font-semibold text-indigo-700">
                                    {text()}
                                  </span>
                                )}
                              </Show>
                              <Show when={hit.refType === "learning" && refId}>
                                <button
                                  class="rounded-md border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-white"
                                  onClick={() => navigate(`/learning-detail?id=${refId}`)}
                                >
                                  詳細へ
                                </button>
                              </Show>
                            </div>
                          </div>
                        );
                      }}
                    </For>
                  </div>
                </Show>
              </div>

              <div class="space-y-2">
                <p class="text-[11px] font-semibold uppercase text-slate-600">
                  関連生成物 / 問題
                </p>
                <Show
                  when={(semanticRelated()?.contentHits?.length ?? 0) > 0}
                  fallback={
                    <p class="text-xs text-slate-600">
                      生成コンテンツに近い要約・問題があればここに表示します。
                    </p>
                  }
                >
                  <div class="space-y-2">
                    <For each={(semanticRelated()?.contentHits ?? []).slice(0, 5)}>
                      {(hit) => {
                        const refId = extractRefId(hit);
                        const local = refId ? generatedContentMap().get(refId) : undefined;
                        const subjectText = hit.subject ? subjectLabel(hit.subject) : null;
                        return (
                          <div class="rounded-md bg-slate-50 px-3 py-2">
                            <div class="flex items-center justify-between gap-2">
                              <span class="font-semibold text-slate-900">{hit.label}</span>
                              <span class="text-[11px] text-indigo-700">
                                score {hit.score.toFixed(2)}
                              </span>
                            </div>
                            <p class="text-xs text-slate-600">{hit.excerpt}</p>
                            <div class="mt-1 flex flex-wrap items-center gap-2">
                              <Show when={local}>
                                {(content) => (
                                  <button
                                    class="rounded-md border border-indigo-200 bg-indigo-50 px-2 py-1 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-100"
                                    onClick={() => {
                                      setTab(content().type);
                                      if (content().materialId) {
                                        setSelectedMaterialId(content().materialId);
                                      }
                                    }}
                                  >
                                    この生成物を開く
                                  </button>
                                )}
                              </Show>
                              <Show when={subjectText}>
                                {(text) => (
                                  <span class="rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700">
                                    {text()}
                                  </span>
                                )}
                              </Show>
                            </div>
                          </div>
                        );
                      }}
                    </For>
                  </div>
                </Show>
              </div>
              <Show when={semanticRelated.loading}>
                <p class="text-[11px] text-slate-500">検索中...</p>
              </Show>
            </div>
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

  const navigate = useNavigate();
  const [mode, setMode] = createSignal<PracticeMode>("text");
  const [selectedLearningId, setSelectedLearningId] = createSignal<string>();
  const [questionIndex, setQuestionIndex] = createSignal(0);
  const [answer, setAnswer] = createSignal("");
  const [grading, setGrading] = createSignal<PracticeFeedback | null>(null);
  const [handwritingCapture, setHandwritingCapture] = createSignal<{
    dataUrl?: string;
    fileName: string;
    mimeType?: string;
    extractedText?: string;
  } | null>(null);
  const [isOcring, setIsOcring] = createSignal(false);
  const [isSubmitting, setIsSubmitting] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [conversation, setConversation] = createSignal<{ role: "user" | "assistant"; text: string }[]>([]);
  const [suggestedSimilar, setSuggestedSimilar] = createSignal<SimilarQuestion[]>([]);

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
  const selectedPracticeLearning = createMemo(() =>
    (learnings() ?? []).find((item) => item.id === selectedLearningId()),
  );

  const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

  const readMetadataList = (
    payload: Record<string, unknown>,
    key: string,
    legacyKeys: string[] = [],
  ) => {
    const metadata = payload["metadata"];
    if (isPlainRecord(metadata)) {
      const candidate = metadata[key];
      if (Array.isArray(candidate)) {
        return candidate.filter(isPlainRecord);
      }
    }
    for (const fallbackKey of [key, ...legacyKeys]) {
      const fallback = payload[fallbackKey];
      if (Array.isArray(fallback)) {
        return fallback.filter(isPlainRecord);
      }
    }
    return [];
  };

  const asString = (value: unknown, fallback: string) =>
    (typeof value === "string" && value.trim().length > 0 ? value : fallback);

  const questions = createMemo<Question[]>(() => {
    const contents = generatedContents() ?? [];
    const extracted: Question[] = [];
    for (const content of contents) {
      const payload = content.content as Record<string, unknown>;
      if (content.type === "practice") {
        const items = readMetadataList(payload, "practiceItems", ["items"]);
        for (const item of items) {
          extracted.push({
            id: crypto.randomUUID(),
            generatedContentId: content.id,
            title: asString(payload.title, "練習問題"),
            prompt: asString(
              item.prompt ?? item.question,
              "問題文が取得できませんでした。",
            ),
            expected: typeof item.expectedAnswer === "string" ? item.expectedAnswer : (typeof item.answer === "string" ? item.answer : undefined),
            hint: typeof item.hint === "string" ? item.hint : undefined,
          });
        }
      } else if (content.type === "qa") {
        const pairs = readMetadataList(payload, "qaPairs", ["pairs"]);
        for (const pair of pairs) {
          extracted.push({
            id: crypto.randomUUID(),
            generatedContentId: content.id,
            title: asString(payload.title, "一問一答"),
            prompt: asString(pair.question, "質問が取得できませんでした。"),
            expected: typeof pair.answer === "string" ? pair.answer : undefined,
            hint: typeof pair.rationale === "string" ? pair.rationale : undefined,
          });
        }
      }
    }
    return extracted;
  });

  const currentQuestion = createMemo(() => questions()[questionIndex()] ?? null);
  const practiceSemanticQuery = createMemo(() => {
    const question = currentQuestion();
    if (!question) return "";
    const parts = [question.title, question.prompt, question.hint, question.expected]
      .map((item) => (item ?? "").toString().trim())
      .filter(Boolean);
    return parts.join(" ");
  });
  const [practiceSemantic, { refetch: refetchPracticeSemantic }] = createResource(
    () => {
      const query = practiceSemanticQuery().trim();
      if (!query) return undefined;
      return { query, subject: selectedPracticeLearning()?.subject };
    },
    async (params) => {
      if (!params) return { learningHits: [], contentHits: [] };
      const [learningHits, contentHits] = await Promise.all([
        semanticSearch(params.query, 3, {
          refType: "learning",
          subject: params.subject,
        }),
        semanticSearch(params.query, 6, {
          refType: "generated_content",
          subject: params.subject,
        }),
      ]);
      return { learningHits, contentHits };
    },
  );

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

  const verdictLabel = (verdict?: PracticeFeedback["verdict"]) => {
    if (verdict === "correct") return "正解";
    if (verdict === "partial") return "部分正解";
    if (verdict === "incorrect") return "不正解";
    return "未判定";
  };

  const buildLocalFeedback = (question: Question, input: string): PracticeFeedback => {
    const score = computeScore(question.expected ?? "", input);
    const verdict = score >= 0.75 ? "correct" : score >= 0.45 ? "partial" : "incorrect";
    return {
      score,
      verdict,
      comment:
        verdict === "correct"
          ? "主要なキーワードが揃っています。"
          : verdict === "partial"
            ? "一部不足があります。ヒントを補ってみてください。"
            : "キーワードがほとんど一致していません。もう一度組み立てましょう。",
      reasoning: question.expected ? `想定解: ${question.expected}` : undefined,
      keyPoints: question.hint ? [question.hint] : undefined,
      suggestedSimilar: [
        { prompt: `${question.prompt} を別の例で説明する問題`, hint: question.hint },
        { prompt: `${question.prompt} を一文で要約してください。` },
      ],
      nextAction:
        verdict === "correct"
          ? "類題に取り組んで定着度を確認しましょう。"
          : "不足キーワードを足して再提出してください。",
      usedAi: false,
    };
  };

  const handleHandwritingFile = async (file: File | null) => {
    if (!file) return;
    setIsOcring(true);
    setError(null);
    try {
      const processed = await processMaterialFile(file, "image");
      const capture = processed.dataUrl
        ? {
            dataUrl: processed.dataUrl,
            fileName: file.name,
            mimeType: processed.mimeType,
            extractedText: processed.text,
          }
        : {
            fileName: file.name,
            mimeType: processed.mimeType,
            extractedText: processed.text,
          };
      setHandwritingCapture(capture);
      if (processed.text?.trim()) {
        setAnswer(processed.text.trim());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "画像の取り込みに失敗しました。");
    } finally {
      setIsOcring(false);
    }
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
    setSuggestedSimilar([]);
    setHandwritingCapture(null);
    setConversation([]);
  };

  const handleSubmit = async () => {
    setError(null);
    const question = currentQuestion();
    const learningId = selectedLearningId();
    if (!question || !learningId) return;
    const trimmed = answer().trim();
    if (!trimmed) return;

    setIsSubmitting(true);
    const artifacts =
      mode() === "handwriting" && handwritingCapture()?.dataUrl
        ? [
            {
              kind: "image" as const,
              dataUrl: handwritingCapture()!.dataUrl!,
              name: handwritingCapture()?.fileName,
              mimeType: handwritingCapture()?.mimeType,
            },
          ]
        : undefined;
    const userTurn = { role: "user" as const, text: trimmed };

    const appendAssistantTurn = (feedback: PracticeFeedback) => {
      const parts = [feedback.comment, feedback.reasoning, feedback.nextAction].filter(Boolean);
      setConversation((log) =>
        [...log, userTurn, { role: "assistant", text: parts.join("\n") }].slice(-10),
      );
    };

    try {
      const response = await gradePracticeAnswer({
        question: {
          prompt: question.prompt,
          expected: question.expected,
          hint: question.hint,
          title: question.title,
        },
        answer: trimmed,
        mode: mode(),
        artifacts,
      });

      const feedback = response.feedback ?? buildLocalFeedback(question, trimmed);
      setGrading(feedback);
      setSuggestedSimilar(feedback.suggestedSimilar ?? []);
      appendAssistantTurn(feedback);

      await createSession({
        learningId,
        generatedContentId: question.generatedContentId,
        questionRef: {
          title: question.title,
          prompt: question.prompt,
          expected: question.expected,
        },
        answerText: trimmed,
        isCorrect: feedback.verdict === "correct",
        feedback: {
          ...feedback,
          mode: mode(),
          artifactName: handwritingCapture()?.fileName,
        },
        score: feedback.score,
      });

      setAnswer("");
      await Promise.all([refetchSessions(), refetchContents()]);
    } catch (err) {
      const fallback = buildLocalFeedback(question, trimmed);
      setGrading(fallback);
      setSuggestedSimilar(fallback.suggestedSimilar ?? []);
      appendAssistantTurn(fallback);
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
              <div class="flex items-center justify-between gap-2">
                <p class="font-semibold text-slate-800">関連情報 / セマンティックリンク</p>
                <button
                  class="rounded-md border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={() => refetchPracticeSemantic()}
                  disabled={practiceSemantic.loading || !practiceSemanticQuery().trim()}
                >
                  再検索
                </button>
              </div>
              <p class="mt-2">
                選択中: {selectedPracticeLearning()?.title ?? "学習未選択"} / 生成コンテンツ{" "}
                {currentQuestion()?.generatedContentId ?? "-"}
              </p>
              <div class="mt-3 space-y-3">
                <div class="space-y-1">
                  <p class="text-[11px] font-semibold uppercase text-slate-600">
                    関連学習
                  </p>
                  <Show
                    when={(practiceSemantic()?.learningHits?.length ?? 0) > 0}
                    fallback={<p class="text-xs text-slate-600">問題文をもとに関連学習カードを提示します。</p>}
                  >
                    <div class="space-y-2">
                      <For each={practiceSemantic()?.learningHits ?? []}>
                        {(hit) => {
                          const refId = extractRefId(hit);
                          const subjectText = hit.subject ? subjectLabel(hit.subject) : null;
                          return (
                            <div class="rounded-md bg-white px-3 py-2">
                              <div class="flex items-center justify-between gap-2">
                                <span class="font-semibold text-slate-900">{hit.label}</span>
                                <span class="text-[11px] text-indigo-700">
                                  score {hit.score.toFixed(2)}
                                </span>
                              </div>
                              <p class="text-xs text-slate-600">{hit.excerpt}</p>
                              <div class="mt-1 flex flex-wrap items-center gap-2">
                                <Show when={subjectText}>
                                  {(text) => (
                                    <span class="rounded-full bg-indigo-50 px-2 py-1 text-[11px] font-semibold text-indigo-700">
                                      {text()}
                                    </span>
                                  )}
                                </Show>
                                <Show when={hit.refType === "learning" && refId}>
                                  <div class="flex flex-wrap gap-2">
                                    <button
                                      class="rounded-md border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                                      onClick={() => {
                                        setSelectedLearningId(refId!);
                                        setQuestionIndex(0);
                                        setGrading(null);
                                        setSuggestedSimilar([]);
                                        setAnswer("");
                                      }}
                                    >
                                      この学習で演習
                                    </button>
                                    <button
                                      class="rounded-md border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                                      onClick={() => navigate(`/learning-detail?id=${refId}`)}
                                    >
                                      詳細を開く
                                    </button>
                                  </div>
                                </Show>
                              </div>
                            </div>
                          );
                        }}
                      </For>
                    </div>
                  </Show>
                </div>

                <div class="space-y-1">
                  <p class="text-[11px] font-semibold uppercase text-slate-600">
                    関連問題・生成物
                  </p>
                  <Show
                    when={(practiceSemantic()?.contentHits?.length ?? 0) > 0}
                    fallback={<p class="text-xs text-slate-600">この問題に近い生成物があればここに表示します。</p>}
                  >
                    <div class="space-y-2">
                      <For each={(practiceSemantic()?.contentHits ?? []).slice(0, 5)}>
                        {(hit) => {
                          const refId = extractRefId(hit);
                          const localQuestionIndex = refId
                            ? questions().findIndex((item) => item.generatedContentId === refId)
                            : -1;
                          const subjectText = hit.subject ? subjectLabel(hit.subject) : null;
                          return (
                            <div class="rounded-md bg-white px-3 py-2">
                              <div class="flex items-center justify-between gap-2">
                                <span class="font-semibold text-slate-900">{hit.label}</span>
                                <span class="text-[11px] text-indigo-700">
                                  score {hit.score.toFixed(2)}
                                </span>
                              </div>
                              <p class="text-xs text-slate-600">{hit.excerpt}</p>
                              <div class="mt-1 flex flex-wrap items-center gap-2">
                                <Show when={localQuestionIndex >= 0}>
                                  <button
                                    class="rounded-md border border-indigo-200 bg-indigo-50 px-2 py-1 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-100"
                                    onClick={() => {
                                      setQuestionIndex(localQuestionIndex);
                                      setAnswer("");
                                      setGrading(null);
                                      setSuggestedSimilar([]);
                                    }}
                                  >
                                    この問題にジャンプ
                                  </button>
                                </Show>
                                <Show when={subjectText}>
                                  {(text) => (
                                    <span class="rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700">
                                      {text()}
                                    </span>
                                  )}
                                </Show>
                              </div>
                            </div>
                          );
                        }}
                      </For>
                    </div>
                  </Show>
                </div>
                <Show when={practiceSemantic.loading}>
                  <p class="text-[11px] text-slate-500">検索中...</p>
                </Show>
              </div>
            </div>
          </div>

          <div class="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div class="space-y-2">
              <p class="text-xs font-semibold uppercase text-slate-500">
                回答
              </p>
              <Show when={mode() === "handwriting"}>
                <div class="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <div class="flex items-center justify-between gap-2">
                    <p class="text-xs font-semibold text-slate-700">手書き画像を取り込む (OCR)</p>
                    <Show when={isOcring()}>
                      <span class="text-[11px] text-slate-500">OCR処理中...</span>
                    </Show>
                  </div>
                  <label class="flex cursor-pointer items-center justify-center rounded-md border border-dashed border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-indigo-200 hover:text-indigo-700">
                    <input
                      type="file"
                      accept="image/*"
                      class="sr-only"
                      onChange={(e) => handleHandwritingFile(e.currentTarget.files?.[0] ?? null)}
                    />
                    画像をアップロードしてOCRする
                  </label>
                  <Show when={handwritingCapture()}>
                    {(capture) => (
                      <div class="space-y-1 text-xs text-slate-600">
                        <p class="font-semibold text-slate-800">添付: {capture().fileName}</p>
                        <Show when={capture().dataUrl}>
                          {(img) => (
                            <img
                              src={img()}
                              alt="手書き回答プレビュー"
                              class="h-28 w-full rounded-md object-contain"
                            />
                          )}
                        </Show>
                        <Show when={capture().extractedText}>
                          {(text) => (
                            <p class="text-slate-500">
                              OCR抽出: {text().slice(0, 140)}
                              {text().length > 140 ? "..." : ""}
                            </p>
                          )}
                        </Show>
                      </div>
                    )}
                  </Show>
                </div>
              </Show>
              <textarea
                class="h-28 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                placeholder={
                  mode() === "handwriting"
                    ? "紙に解いた内容を貼り付けるか、OCR結果を確認して編集してください。"
                    : "回答を直接入力してください。キーワードを簡潔に含めてください。"
                }
                value={answer()}
                onInput={(e) => setAnswer(e.currentTarget.value)}
              />
              <div class="flex flex-wrap gap-2 text-xs text-slate-600">
                <button
                  class="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-70"
                  onClick={handleSubmit}
                  disabled={isSubmitting() || !answer().trim()}
                >
                  {isSubmitting() ? "採点中..." : "AI採点して送信"}
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
                    <div class="space-y-2">
                      <div class="flex items-center gap-2 text-sm font-semibold text-slate-900">
                        <span>
                          {verdictLabel(result().verdict)} / score {(result().score * 100).toFixed(0)}%
                        </span>
                        <Show when={result().usedAi}>
                          <span class="rounded bg-indigo-50 px-2 py-1 text-[11px] font-semibold text-indigo-600">
                            AI採点
                          </span>
                        </Show>
                      </div>
                      <p class="text-sm text-slate-800 whitespace-pre-wrap">{result().comment}</p>
                      <Show when={result().reasoning}>
                        {(reason) => <p class="text-xs text-slate-600">理由: {reason()}</p>}
                      </Show>
                      <Show when={(result().keyPoints ?? []).length > 0}>
                        <div class="flex flex-wrap gap-1 text-[11px] text-slate-700">
                          <For each={result().keyPoints ?? []}>
                            {(point) => <span class="rounded-md bg-white px-2 py-1">{point}</span>}
                          </For>
                        </div>
                      </Show>
                      <Show when={result().nextAction}>
                        {(next) => (
                          <p class="text-xs font-semibold text-slate-700">
                            次のステップ: {next()}
                          </p>
                        )}
                      </Show>
                    </div>
                  )}
                </Show>
              </div>
            </div>

            <div class="space-y-2">
              <p class="text-xs font-semibold uppercase text-slate-500">
                AIとの対話ログ
              </p>
              <div class="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800">
                <Show
                  when={conversation().length > 0}
                  fallback={<p class="text-xs text-slate-600">採点するとAIからのコメントが表示されます。</p>}
                >
                  <div class="space-y-2">
                    <For each={conversation()}>
                      {(entry) => (
                        <div
                          class={`rounded-md p-2 ${
                            entry.role === "assistant" ? "bg-indigo-50 text-slate-900" : "bg-white"
                          }`}
                        >
                          <p class="text-[11px] font-semibold uppercase text-slate-500">
                            {entry.role === "assistant" ? "AI" : "あなた"}
                          </p>
                          <p class="whitespace-pre-wrap text-sm text-slate-800">{entry.text}</p>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
            </div>

            <div class="space-y-2">
              <p class="text-xs font-semibold uppercase text-slate-500">
                類題 / 次の練習
              </p>
              <div class="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800">
                <Show
                  when={suggestedSimilar().length > 0}
                  fallback={<p class="text-xs text-slate-600">AIが提案した類題がここに表示されます。</p>}
                >
                  <div class="space-y-2">
                    <For each={suggestedSimilar()}>
                      {(item) => (
                        <div class="rounded-md bg-white p-2">
                          <p class="text-sm font-semibold text-slate-900">{item.prompt}</p>
                          <p class="text-xs text-slate-600">{item.hint ?? ""}</p>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
            </div>

            <div class="space-y-2">
              <p class="text-xs font-semibold uppercase text-slate-500">
                演習履歴
              </p>
              <div class="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                <For each={sessions() ?? []}>
                  {(session) => {
                    const feedback = session.feedback as PracticeFeedback | undefined;
                    return (
                      <div class="rounded-md bg-white p-2 text-slate-800">
                        <p class="text-xs font-semibold uppercase text-slate-500">
                          {(session.questionRef?.title as string) ?? "演習"}
                        </p>
                        <p class="mt-1 text-sm">{(session.questionRef?.prompt as string)}</p>
                        <p class="text-xs text-slate-500">
                          {verdictLabel(feedback?.verdict)} ・ score{" "}
                          {session.score ? (session.score * 100).toFixed(0) : "-"}%
                        </p>
                        <Show when={feedback?.comment}>
                          {(comment) => <p class="text-xs text-slate-600">{comment()}</p>}
                        </Show>
                      </div>
                    );
                  }}
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
  const [lastProxyActions, setLastProxyActions] = createSignal<ProxyActions | null>(null);
  const [generatedSummaries, setGeneratedSummaries] = createSignal<GeneratedSummary[]>([]);

  const [toolSearchQuery, setToolSearchQuery] = createSignal("");
  const [toolNewLearningTitle, setToolNewLearningTitle] = createSignal("");
  const [toolNewLearningSubject, setToolNewLearningSubject] = createSignal("");
  const [isToolRunning, setIsToolRunning] = createSignal(false);
  const navigate = useNavigate();
  const newLearningDraft = useNewLearningDraft();

  const activeDraft = () => newLearningDraft.state.draft;
  const learningCandidate = () =>
    semanticHits().find((hit) => hit.refType === "learning");
  const materialCandidateCount = () =>
    semanticHits().filter((hit) => hit.refType === "material").length;
  const contentCandidateCount = () =>
    semanticHits().filter((hit) => hit.refType === "generated_content").length;

  const syntheticLearningFromActions = (actions: ProxyActions | null): SemanticMatch | null => {
    if (!actions?.createdLearningId) return null;
    return {
      id: actions.createdLearningId,
      label: actions.createdLearningTitle ?? "AI提案の新規Learning",
      excerpt:
        actions.createdLearningReason ??
        "AIチャットのリクエストから生成した学習カードです。",
      score: 1,
      refType: "learning",
      subject: actions.createdLearningSubject,
    };
  };

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
        const material = (payload.result as { material?: { sourcePath?: string } }).material;
        if (learning) {
          appendMessage("assistant", `学習カードを作成しました: ${learning.title}`);
          if (material) {
            appendMessage(
              "assistant",
              `チャット本文を教材として保存しました (${material.sourcePath ?? "text"})`,
            );
          }
        }
      }
    } catch (err) {
      console.error(err);
      setError("Tool Callに失敗しました。もう一度お試しください。");
    } finally {
      setIsToolRunning(false);
    }
  };

  const handleSendToNewLearning = () => {
    let hits = semanticHits();
    if (hits.length === 0) {
      const synthetic = syntheticLearningFromActions(lastProxyActions());
      if (synthetic) {
        hits = [synthetic];
        setSemanticHits(hits);
      }
    }
    if (hits.length === 0) {
      setError("意味検索結果がないため学習候補を作成できません。");
      return;
    }
    const titleInput = toolNewLearningTitle().trim();
    const subjectInput = toolNewLearningSubject().trim();
    const seeded = newLearningDraft.seedDraftFromMatches(hits, {
      title: titleInput || undefined,
      subject: subjectInput || undefined,
      tags: subjectInput ? [subjectInput] : undefined,
    });
    if (!seeded) {
      setError("Learningに紐づくヒットが見つからず、抽出ドラフトを作成できませんでした。");
      return;
    }
    setError(null);
    navigate("/new-learning");
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
      const actions = reply.actions ?? null;
      setLastProxyActions(actions);
      setGeneratedSummaries(actions?.generatedContentSummaries ?? []);
      if (reply.toolCalls.length > 0) {
        setToolCalls((prev) => [...prev, ...reply.toolCalls]);
      }
      const synthetic = syntheticLearningFromActions(actions);
      const nextHits =
        reply.related.length > 0 ? reply.related : synthetic ? [synthetic] : [];
      setSemanticHits(nextHits);
      appendMessage("assistant", reply.reply);
    } catch (err) {
      console.error(err);
      setError("Tool Call連携に失敗しました。もう一度お試しください。");
      setLastProxyActions(null);
      setGeneratedSummaries([]);
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
          <div class="space-y-2 rounded-lg border border-indigo-200 bg-indigo-50 p-3">
            <p class="text-xs font-semibold uppercase text-indigo-700">
              AI抽出ドラフト
            </p>
            <Show when={activeDraft()}>
              {(draftAccessor) => (
                <div class="space-y-1 rounded-md border border-indigo-200 bg-white/70 px-3 py-2 text-sm text-indigo-900">
                  <p class="font-semibold">{draftAccessor().title}</p>
                  <p class="text-xs text-indigo-700">
                    推薦: 教材 {draftAccessor().recommendedMaterialIds.length} 件 / 生成 {draftAccessor().recommendedContentIds.length} 件
                  </p>
                  <div class="flex flex-wrap gap-2 pt-1">
                    <button
                      class="rounded-md border border-indigo-200 px-2 py-1 text-xs font-semibold text-indigo-700 hover:bg-white"
                      onClick={() => navigate("/new-learning")}
                    >
                      /new-learning を開く
                    </button>
                    <button
                      class="rounded-md border border-transparent px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-white/60"
                      onClick={() => newLearningDraft.clearDraft()}
                    >
                      ドラフトを破棄
                    </button>
                  </div>
                </div>
              )}
            </Show>
            <div class="rounded-md border border-indigo-200 bg-white/70 px-3 py-2 text-sm text-indigo-900">
              <Show
                when={learningCandidate()}
                fallback={
                  <div class="space-y-1 text-xs text-indigo-700">
                    <p>意味検索が完了すると、ここから抽出候補を新しい学習作成フローに送れます。</p>
                    <Show when={lastProxyActions()?.createdLearningId}>
                      <p>
                        AIが「
                        {lastProxyActions()?.createdLearningTitle ?? "新規Learning"}
                        」を作成済みです。下のボタンで /new-learning に引き継げます。
                      </p>
                    </Show>
                  </div>
                }
              >
                {(candidate) => (
                  <>
                    <p class="font-semibold">{candidate().label}</p>
                    <p class="text-xs text-indigo-700">
                      教材 {materialCandidateCount()} 件 / 生成物 {contentCandidateCount()} 件を再利用候補として抽出済みです。
                    </p>
                    <p class="text-xs text-indigo-700">
                      上のタイトル・科目入力値を優先し、「過去教材から新しい学習作成」画面へ送ります。
                    </p>
                    <button
                      class="mt-2 w-full rounded-md bg-indigo-600 px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
                      onClick={handleSendToNewLearning}
                      disabled={!learningCandidate()}
                    >
                      過去教材から新規Learningを組み立てる
                    </button>
                  </>
                )}
              </Show>
            </div>
          </div>
          <div class="space-y-2 rounded-lg border border-violet-200 bg-violet-50 p-3">
            <p class="text-xs font-semibold uppercase text-violet-700">
              最新の生成結果
            </p>
            <Show
              when={generatedSummaries().length > 0}
              fallback={<p class="text-sm text-violet-900">AIが生成した問題や要約のサマリがここに表示されます。</p>}
            >
              <ul class="space-y-2 text-sm text-violet-900">
                <For each={generatedSummaries()}>
                  {(item) => (
                    <li class="rounded-md border border-violet-200 bg-white/70 px-3 py-2">
                      <p class="font-semibold">
                        {generatedTypeLabels[item.type] ?? item.type}
                      </p>
                      <p class="text-xs text-violet-700">{item.title}</p>
                      <Show when={item.learningTitle}>
                        {(title) => (
                          <p class="text-[11px] text-violet-600">
                            ベース: {title()}
                          </p>
                        )}
                      </Show>
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
                onClick={() => {
                  setLastProxyActions(null);
                  setGeneratedSummaries([]);
                  void runSemanticSearch(draft());
                }}
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


const materialTypeLabels: Record<MaterialType, string> = {
  text: "テキスト",
  pdf: "PDF",
  image: "画像",
  audio: "音声",
  video: "動画",
  url: "URL",
};

const materialFilterOptions: { id: "all" | MaterialType; label: string }[] = [
  { id: "all", label: "すべて" },
  { id: "pdf", label: materialTypeLabels.pdf },
  { id: "image", label: materialTypeLabels.image },
  { id: "audio", label: materialTypeLabels.audio },
  { id: "video", label: materialTypeLabels.video },
  { id: "text", label: materialTypeLabels.text },
  { id: "url", label: materialTypeLabels.url },
];

const generationTargetOrder: GeneratedContentType[] = [
  "qa",
  "practice",
  "summary",
  "podcast_script",
  "other",
];

const difficultyOptions = [
  { id: "basic", label: "基礎" },
  { id: "standard", label: "標準" },
  { id: "advanced", label: "発展" },
];

const remoteUrlPattern = /^(?:https?:\/\/|data:|tauri:\/\/|app:\/\/)/i;
const isRemoteUrl = (value?: string) =>
  typeof value === "string" && (remoteUrlPattern.test(value) || value.startsWith("/"));

const accessiblePreviewUrl = (...sources: (string | undefined)[]) =>
  sources.find((value) => isRemoteUrl(value));

const detectMaterialType = (file: File): MaterialType => {
  const name = file.name.toLowerCase();
  if (file.type === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("audio/")) return "audio";
  if (file.type.startsWith("video/")) return "video";
  return "text";
};

const formatFileSize = (value?: number) => {
  if (!value) return "サイズ不明";
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${value} B`;
};

const isTauriRuntime = () =>
  typeof (globalThis as { __TAURI_IPC__?: unknown }).__TAURI_IPC__ !== "undefined" ||
  typeof (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== "undefined";

const joinLocalPath = (base?: string, child?: string) => {
  if (!base || !child) return undefined;
  if (/^(?:[a-zA-Z]:|\\\\|\/)/.test(child)) return child;
  return `${base.replace(/[\\/]+$/, "")}/${child.replace(/^[\\/]+/, "")}`;
};

const resolveLocalEntryPath = (
  entry?: MaterialLibraryEntry,
  config?: MaterialLibraryConfig,
) => {
  if (!entry) return undefined;
  const candidates = [
    entry.libraryPath,
    entry.storedPath,
    joinLocalPath(config?.rootDir, entry.libraryPath),
    joinLocalPath(config?.rootDir, entry.storedPath),
  ];
  return candidates.find((value) => value && !isRemoteUrl(value));
};

const convertLocalPathToUrl = async (path: string) => {
  if (!isTauriRuntime()) return undefined;
  try {
    const { convertFileSrc } = await import("@tauri-apps/api/core");
    return convertFileSrc(path);
  } catch (error) {
    console.warn("Failed to convertFileSrc", error);
    return undefined;
  }
};

const openLocalPath = async (path: string) => {
  if (!isTauriRuntime()) {
    if (typeof window !== "undefined") {
      window.open(path, "_blank", "noopener");
    }
    return;
  }
  const { open } = await import("@tauri-apps/plugin-shell");
  await open(path);
};

const materialDisplayName = (material: Material, entry?: MaterialLibraryEntry) => {
  const metadataName = material.metadata?.name as string | undefined;
  const payloadName = material.metadata?.payloadFileName as string | undefined;
  return (
    entry?.displayName ??
    metadataName ??
    payloadName ??
    material.sourcePath ??
    `${material.type.toUpperCase()}_${material.id.slice(0, 8)}`
  );
};

const summarizeMaterialText = (text?: string, limit = 800) =>
  text ? text.replace(/\s+/g, " ").trim().slice(0, limit) : "抽出テキストがまだありません。";

const MaterialSettingsSurface: Component = () => {
  const settings = useSettings();
  const [selectedLearningId, setSelectedLearningId] = createSignal<string | undefined>();
  const [selectedMaterialId, setSelectedMaterialId] = createSignal<string | undefined>();
  const [fileTypeFilter, setFileTypeFilter] = createSignal<MaterialType | "all">("all");
  const [generationTargets, setGenerationTargets] = createSignal<GeneratedContentType[]>([
    "qa",
    "practice",
  ]);
  const [difficulty, setDifficulty] = createSignal(difficultyOptions[1].id);
  const [questionCount, setQuestionCount] = createSignal(5);
  const [temperature, setTemperature] = createSignal(0.3);
  const [presetId, setPresetId] = createSignal<string>();
  const [toast, setToast] = createSignal<{ tone: "success" | "error" | "info"; message: string } | null>(
    null,
  );
  const [isUploading, setIsUploading] = createSignal(false);
  const [isGenerating, setIsGenerating] = createSignal(false);
  const [libraryConfig, setLibraryConfig] = createSignal<MaterialLibraryConfig>();
  const [localPreviewUrl, setLocalPreviewUrl] = createSignal<string | undefined>();
  const [isLoadingLocalPreview, setIsLoadingLocalPreview] = createSignal(false);
  const [previewError, setPreviewError] = createSignal<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = createSignal<string | null>(null);
  const [pendingOpenId, setPendingOpenId] = createSignal<string | null>(null);
  let fileInputRef: HTMLInputElement | undefined;

  onMount(async () => {
    setLibraryConfig(await resolveLibraryConfig());
  });

  const [learnings] = createResource(() => true, () => fetchLearnings({ limit: 50 }));
  createEffect(() => {
    const list = learnings();
    if (!selectedLearningId() && list?.length) {
      setSelectedLearningId(list[0].id);
    }
  });

  const [materials, { refetch: refetchMaterials }] = createResource(
    () => selectedLearningId(),
    (id) => (id ? fetchMaterials(id).then((res) => res.items) : []),
  );
  const [libraryEntries, { refetch: refetchLibrary }] = createResource(
    () => selectedLearningId(),
    (id) => (id ? fetchMaterialLibrary({ learningId: id, limit: 100 }) : []),
  );

  const libraryEntryMap = createMemo(() => {
    const map = new Map<string, MaterialLibraryEntry>();
    (libraryEntries() ?? []).forEach((entry) => {
      if (entry.materialId) {
        map.set(entry.materialId, entry);
      }
    });
    return map;
  });

  const selectedLearning = createMemo(() =>
    (learnings() ?? []).find((item) => item.id === selectedLearningId()),
  );
  const selectedMaterial = createMemo(() =>
    (materials() ?? []).find((item) => item.id === selectedMaterialId()),
  );
  const selectedLibraryEntry = createMemo(() => {
    const id = selectedMaterialId();
    if (!id) return undefined;
    return libraryEntryMap().get(id);
  });
  const filteredMaterials = createMemo(() => {
    const list = materials() ?? [];
    const filter = fileTypeFilter();
    return filter === "all" ? list : list.filter((item) => item.type === filter);
  });
  const remotePreviewUrl = createMemo(() => {
    const material = selectedMaterial();
    const entry = selectedLibraryEntry();
    const metadataUrl = material?.metadata?.previewUrl as string | undefined;
    const payloadPreview = material?.metadata?.payloadDataUrlPreview as string | undefined;
    return accessiblePreviewUrl(
      metadataUrl,
      payloadPreview,
      entry?.assetPath,
      entry?.storedPath,
      entry?.libraryPath,
      material?.sourcePath,
    );
  });
  const previewUrl = createMemo(() => remotePreviewUrl() ?? localPreviewUrl());
  const selectedMetadataEntries = createMemo(() => {
    const metadata = selectedMaterial()?.metadata ?? {};
    return Object.entries(metadata).slice(0, 6);
  });
  const presetOptions = createMemo(() => selectPresetOptions(settings.state.presets));
  createEffect(() => {
    if (!presetId() && presetOptions().length) {
      setPresetId(presetOptions()[0].value);
    }
  });
  createEffect(() => {
    const list = materials() ?? [];
    if (!list.length) {
      setSelectedMaterialId(undefined);
      return;
    }
    if (!selectedMaterialId() || !list.some((item) => item.id === selectedMaterialId())) {
      setSelectedMaterialId(list[0].id);
    }
  });

  createEffect(() => {
    const remote = remotePreviewUrl();
    if (remote) {
      setLocalPreviewUrl(undefined);
      setPreviewError(null);
      return;
    }
    const entry = selectedLibraryEntry();
    if (!entry) {
      setLocalPreviewUrl(undefined);
      setPreviewError(null);
      return;
    }
    if (!isTauriRuntime()) {
      setPreviewError("ローカルプレビューはTauriアプリでのみ利用できます。");
      setLocalPreviewUrl(undefined);
      return;
    }
    const path = resolveLocalEntryPath(entry, libraryConfig());
    if (!path) {
      setPreviewError("プレビュー可能なローカルパスがありません。");
      setLocalPreviewUrl(undefined);
      return;
    }
    let cancelled = false;
    setIsLoadingLocalPreview(true);
    convertLocalPathToUrl(path)
      .then((url) => {
        if (cancelled) return;
        if (url) {
          setLocalPreviewUrl(url);
          setPreviewError(null);
        } else {
          setLocalPreviewUrl(undefined);
          setPreviewError("ローカルファイルのURL変換に失敗しました。");
        }
      })
      .catch(() => {
        if (cancelled) return;
        setLocalPreviewUrl(undefined);
        setPreviewError("ローカルファイルのURL変換に失敗しました。");
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingLocalPreview(false);
        }
      });
    return () => {
      cancelled = true;
    };
  });

  const toggleTarget = (type: GeneratedContentType) => {
    setGenerationTargets((current) =>
      current.includes(type)
        ? current.filter((value) => value !== type)
        : [...current, type],
    );
  };

  const handleFileUpload = async (event: Event & { currentTarget: HTMLInputElement }) => {
    const input = event.currentTarget;
    const file = input.files?.item(0);
    input.value = "";
    if (!file || !selectedLearningId()) return;
    setIsUploading(true);
    setToast(null);
    try {
      const type = detectMaterialType(file);
      const processed = await processMaterialFile(file, type);
      const payload: MaterialIngestRequest["payload"] = {
        text: processed.text,
        dataUrl: processed.dataUrl,
        fileName: processed.fileName,
        bytes: processed.bytes,
        mimeType: processed.mimeType,
      };
      const source: MaterialIngestRequest["source"] =
        type === "text"
          ? { kind: "text", text: processed.text ?? file.name }
          : { kind: type as Exclude<MaterialType, "text" | "url">, path: processed.fileName };
      const result = await ingestMaterial({
        learningId: selectedLearningId()!,
        source,
        preferOffline: true,
        payload,
      });
      await Promise.all([refetchMaterials(), refetchLibrary()]);
      setSelectedMaterialId(result.material.id);
      setToast({
        tone: "success",
        message: `${materialTypeLabels[result.material.type]} を取り込みました。`,
      });
    } catch (error) {
      console.error(error);
      setToast({
        tone: "error",
        message:
          error instanceof Error
            ? `ファイルの追加に失敗しました: ${error.message}`
            : "ファイルの追加に失敗しました。",
      });
    } finally {
      setIsUploading(false);
    }
  };

  const openRemoteUrl = (url: string | undefined) => {
    if (!url) return;
    if (typeof window !== "undefined") {
      window.open(url, "_blank", "noopener");
    }
  };

  const handleOpenMaterialSource = async (materialId: string) => {
    const material = (materials() ?? []).find((item) => item.id === materialId);
    const entry = libraryEntryMap().get(materialId);
    const remote = accessiblePreviewUrl(
      (material?.metadata?.previewUrl as string | undefined) ?? undefined,
      material?.sourcePath,
      entry?.storedPath,
      entry?.assetPath,
      entry?.libraryPath,
    );
    if (remote) {
      openRemoteUrl(remote);
      return;
    }
    const path = resolveLocalEntryPath(entry, libraryConfig());
    if (!path) {
      setToast({ tone: "error", message: "開くためのローカルパスが見つかりませんでした。" });
      return;
    }
    setPendingOpenId(materialId);
    try {
      await openLocalPath(path);
      setToast({ tone: "info", message: "ローカルファイルを開きました。" });
    } catch (error) {
      setToast({
        tone: "error",
        message:
          error instanceof Error ? `ファイルを開けませんでした: ${error.message}` : "ファイルを開けませんでした。",
      });
    } finally {
      setPendingOpenId(null);
    }
  };

  const handleDeleteMaterial = async (materialId: string) => {
    const material = (materials() ?? []).find((item) => item.id === materialId);
    if (!material) return;
    if (typeof window !== "undefined" && !window.confirm("この教材ファイルを削除しますか？")) {
      return;
    }
    setPendingDeleteId(materialId);
    setToast(null);
    try {
      await deleteMaterial(materialId);
      if (selectedMaterialId() === materialId) {
        setSelectedMaterialId(undefined);
      }
      await Promise.all([refetchMaterials(), refetchLibrary()]);
      setToast({
        tone: "info",
        message: `${materialDisplayName(material, libraryEntryMap().get(materialId))} を削除しました。`,
      });
    } catch (error) {
      setToast({
        tone: "error",
        message:
          error instanceof Error ? `削除に失敗しました: ${error.message}` : "削除に失敗しました。",
      });
    } finally {
      setPendingDeleteId(null);
    }
  };

  const openFilePicker = () => {
    if (!selectedLearningId()) {
      setToast({ tone: "error", message: "学習カードを先に選択してください。" });
      return;
    }
    fileInputRef?.click();
  };

  const handleSaveDraft = () => {
    const material = selectedMaterial();
    if (!material) {
      setToast({ tone: "error", message: "設定を保存する教材を選択してください。" });
      return;
    }
    const difficultyLabel =
      difficultyOptions.find((item) => item.id === difficulty())?.label ?? difficulty();
    setToast({
      tone: "info",
      message: `${materialDisplayName(material, selectedLibraryEntry())} の設定を下書きとして保持しました（難易度: ${difficultyLabel}, ${questionCount()}問, 温度 ${temperature().toFixed(1)}）。`,
    });
  };

  const handleApplySettings = async () => {
    const learningId = selectedLearningId();
    const materialId = selectedMaterialId();
    const targets = generationTargets();
    if (!learningId || !materialId) {
      setToast({ tone: "error", message: "生成する教材ファイルを選んでください。" });
      return;
    }
    if (targets.length === 0) {
      setToast({ tone: "error", message: "生成対象を1つ以上選択してください。" });
      return;
    }
    const preset = settings.state.presets.find((item) => item.id === presetId());
    const difficultyLabel =
      difficultyOptions.find((item) => item.id === difficulty())?.label ?? difficulty();
    const templateParts = [
      preset?.userInstructionTemplate ?? "{{content}}",
      "",
      "# Material Settings",
      `- difficulty: ${difficultyLabel}`,
      `- question_count: ${questionCount()}`,
      `- targets: ${targets.map((id) => generatedTypeLabels[id]).join(", ")}`,
      `- temperature: ${temperature().toFixed(1)}`,
    ].filter(Boolean);

    setIsGenerating(true);
    setToast(null);
    try {
      await generateFromMaterial({
        learningId,
        materialId,
        types: targets,
        presetTitle: preset ? `${preset.title} / ${difficultyLabel}` : `material_settings (${difficultyLabel})`,
        presetSystemPrompt: preset?.systemPrompt,
        presetUserTemplate: templateParts.join("\n"),
      });
      setToast({
        tone: "success",
        message: `${targets.length} 種類の生成リクエストを送信しました。学習詳細のタブで結果を確認できます。`,
      });
    } catch (error) {
      setToast({
        tone: "error",
        message:
          error instanceof Error ? `生成に失敗しました: ${error.message}` : "生成に失敗しました。",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  return (
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
            PLAN.mdの仕様どおり、左でファイルを管理しつつ右で生成パラメータ・プリセットを操作します。
          </p>
          <p class="text-xs text-slate-500">
            選択中: {selectedLearning()?.title ?? "学習カード未選択"}
          </p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <select
            class="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800"
            value={selectedLearningId() ?? ""}
            onChange={(event) => setSelectedLearningId(event.currentTarget.value)}
            disabled={learnings.loading}
          >
            <Show
              when={(learnings() ?? []).length > 0}
              fallback={<option value="">学習カードなし</option>}
            >
              <For each={learnings() ?? []}>
                {(learning) => (
                  <option value={learning.id}>{learning.title}</option>
                )}
              </For>
            </Show>
          </select>
          <button
            class="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={openFilePicker}
            disabled={!selectedLearningId() || isUploading()}
          >
            {isUploading() ? "読み込み中..." : "ファイルを追加"}
          </button>
        </div>
      </header>
      <input
        type="file"
        class="hidden"
        ref={(element) => {
          fileInputRef = element ?? undefined;
        }}
        accept=".pdf,image/*,audio/*,video/*,.txt,.md"
        onChange={handleFileUpload}
      />
      <Show when={toast()}>
        {(info) => (
          <p
            class={`text-xs ${
              info().tone === "error"
                ? "text-rose-600"
                : info().tone === "success"
                  ? "text-emerald-700"
                  : "text-slate-600"
            }`}
          >
            {info().message}
          </p>
        )}
      </Show>

      <div class="grid gap-4 md:grid-cols-[1.1fr_1fr]">
        <div class="space-y-3">
          <div class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <p class="text-xs font-semibold uppercase text-slate-500">
                教材ファイル
              </p>
              <div class="flex flex-wrap gap-2">
                <For each={materialFilterOptions}>
                  {(option) => (
                    <button
                      type="button"
                      class={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                        fileTypeFilter() === option.id
                          ? "border-indigo-200 bg-indigo-50 text-indigo-700"
                          : "border-slate-200 text-slate-700 hover:bg-slate-50"
                      }`}
                      onClick={() => setFileTypeFilter(option.id)}
                    >
                      {option.label}
                    </button>
                  )}
                </For>
              </div>
            </div>
            <Show
              when={!materials.loading}
              fallback={
                <p class="mt-3 text-xs text-slate-500">教材ファイルを読み込み中です...</p>
              }
            >
              <Show
                when={filteredMaterials().length > 0}
                fallback={
                  <p class="mt-3 text-sm text-slate-600">
                    この学習にはまだ教材ファイルがありません。右上の「ファイルを追加」から登録してください。
                  </p>
                }
              >
                <div class="mt-3 space-y-2">
                  <For each={filteredMaterials()}>
                    {(material) => {
                      const entry = libraryEntryMap().get(material.id);
                      const metaBytes = material.metadata?.payloadBytes as number | undefined;
                      const sizeLabel = formatFileSize(entry?.bytes ?? metaBytes);
                      const isDeleting = pendingDeleteId() === material.id;
                      const isOpening = pendingOpenId() === material.id;
                      return (
                        <div
                          class={`rounded-lg border px-3 py-2 text-sm transition ${
                            selectedMaterialId() === material.id
                              ? "border-indigo-300 bg-indigo-50"
                              : "border-slate-200 bg-white"
                          }`}
                        >
                          <button
                            type="button"
                            class="w-full text-left"
                            onClick={() => setSelectedMaterialId(material.id)}
                          >
                            <div class="flex items-start justify-between gap-2">
                              <div>
                                <p class="font-semibold text-slate-900">
                                  {materialDisplayName(material, entry)}
                                </p>
                                <p class="text-xs text-slate-600">
                                  {materialTypeLabels[material.type]} / {sizeLabel}
                                </p>
                                <Show when={entry?.notes}>
                                  {(note) => (
                                    <p class="text-xs text-slate-500">メモ: {note()}</p>
                                  )}
                                </Show>
                              </div>
                              <span class="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold uppercase text-slate-600">
                                {material.type}
                              </span>
                            </div>
                          </button>
                          <div class="mt-2 flex flex-wrap gap-2 text-xs">
                            <button
                              class="rounded-md border border-slate-200 px-2 py-1 font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                              onClick={() => handleOpenMaterialSource(material.id)}
                              disabled={isOpening}
                            >
                              {isOpening ? "開く中..." : "ソースを開く"}
                            </button>
                            <button
                              class="rounded-md border border-rose-200 px-2 py-1 font-semibold text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                              onClick={() => handleDeleteMaterial(material.id)}
                              disabled={isDeleting}
                            >
                              {isDeleting ? "削除中..." : "削除"}
                            </button>
                          </div>
                        </div>
                      );
                    }}
                  </For>
                </div>
              </Show>
            </Show>
          </div>

          <div class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p class="text-xs font-semibold uppercase text-slate-500">
              プレビュー / メタデータ
            </p>
            <Show
              when={selectedMaterial()}
              fallback={<p class="mt-3 text-sm text-slate-600">教材ファイルを選択するとプレビューが表示されます。</p>}
            >
              {(material) => (
                <div class="mt-3 space-y-3 text-sm text-slate-800">
                  <div class="flex items-center justify-between gap-2">
                    <p class="font-semibold text-slate-900">
                      {materialDisplayName(material(), selectedLibraryEntry())}
                    </p>
                    <Show when={previewUrl()}>
                      {(url) => (
                        <A
                          href={url()}
                          target="_blank"
                          rel="noreferrer"
                          class="text-xs font-semibold text-indigo-600 hover:underline"
                        >
                          ソースを開く
                        </A>
                      )}
                    </Show>
                  </div>
                  <Show when={isLoadingLocalPreview()}>
                    <p class="text-xs text-slate-500">ローカルプレビューを読み込んでいます...</p>
                  </Show>
                  <div class="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <Switch fallback={<p class="text-xs text-slate-500">{previewError() ?? "ファイルの直接プレビューは利用できません。抽出テキストを確認してください。"}</p>}>
                      <Match when={material().type === "image" && previewUrl()}>
                        {(url) => (
                          <img
                            src={url()}
                            alt={materialDisplayName(material(), selectedLibraryEntry())}
                            class="max-h-64 w-full rounded object-contain"
                          />
                        )}
                      </Match>
                      <Match when={material().type === "pdf" && previewUrl()}>
                        {(url) => (
                          <iframe
                            src={url()}
                            title="pdf-preview"
                            class="h-64 w-full rounded bg-white"
                          />
                        )}
                      </Match>
                      <Match when={material().type === "audio" && previewUrl()}>
                        {(url) => (
                          <audio controls class="w-full" src={url()}>
                            お使いの環境では音声の再生に対応していません。
                          </audio>
                        )}
                      </Match>
                      <Match when={material().type === "video" && previewUrl()}>
                        {(url) => (
                          <video controls class="h-64 w-full rounded bg-black" src={url()}>
                            お使いの環境では動画の再生に対応していません。
                          </video>
                        )}
                      </Match>
                      <Match when={material().type === "text"}>
                        <p class="text-xs text-slate-600">
                          テキスト教材です。下の抽出結果から内容を確認してください。
                        </p>
                      </Match>
                    </Switch>
                  </div>
                  <div>
                    <p class="text-xs font-semibold uppercase text-slate-500">
                      抽出テキスト
                    </p>
                    <pre class="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-800">
                      {summarizeMaterialText(material().rawContent)}
                    </pre>
                  </div>
                  <Show when={selectedMetadataEntries().length > 0}>
                    <div>
                      <p class="text-xs font-semibold uppercase text-slate-500">
                        メタデータ
                      </p>
                      <dl class="mt-2 space-y-1 text-xs">
                        <For each={selectedMetadataEntries()}>
                          {([key, value]) => (
                            <div class="flex items-center justify-between gap-2">
                              <dt class="font-semibold text-slate-600">{key}</dt>
                              <dd class="text-right text-slate-800">
                                {typeof value === "string" ||
                                typeof value === "number" ||
                                typeof value === "boolean"
                                  ? String(value)
                                  : JSON.stringify(value)}
                              </dd>
                            </div>
                          )}
                        </For>
                      </dl>
                    </div>
                  </Show>
                  <Show when={selectedLibraryEntry()}>
                    {(entry) => (
                      <div>
                        <p class="text-xs font-semibold uppercase text-slate-500">
                          ライブラリ情報
                        </p>
                        <dl class="mt-2 space-y-1 text-xs">
                          <div class="flex items-center justify-between gap-2">
                            <dt class="text-slate-600">保存先</dt>
                            <dd class="text-right">
                              {entry().libraryPath ?? entry().storedPath}
                            </dd>
                          </div>
                          <div class="flex items-center justify-between gap-2">
                            <dt class="text-slate-600">サイズ</dt>
                            <dd class="text-right">{formatFileSize(entry().bytes)}</dd>
                          </div>
                          <Show when={entry().notes}>
                            {(note) => (
                              <div class="flex items-center justify-between gap-2">
                                <dt class="text-slate-600">メモ</dt>
                                <dd class="text-right">{note()}</dd>
                              </div>
                            )}
                          </Show>
                        </dl>
                      </div>
                    )}
                  </Show>
                </div>
              )}
            </Show>
          </div>
        </div>

        <div class="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p class="text-xs font-semibold uppercase text-slate-500">
            生成設定
          </p>
          <div class="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <p class="text-xs font-semibold uppercase text-slate-500">
              生成対象
            </p>
            <div class="mt-2 flex flex-col gap-2 text-sm text-slate-800">
              <For each={generationTargetOrder}>
                {(type) => (
                  <label class="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={generationTargets().includes(type)}
                      onChange={() => toggleTarget(type)}
                    />
                    {generatedTypeLabels[type]}
                  </label>
                )}
              </For>
            </div>
          </div>

          <div class="grid gap-3 md:grid-cols-2">
            <div class="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <p class="text-xs font-semibold uppercase text-slate-500">
                難易度と出題数
              </p>
              <div class="mt-2 space-y-2 text-sm text-slate-800">
                <label class="flex items-center justify-between">
                  <span>難易度</span>
                  <select
                    class="rounded-md border border-slate-200 px-2 py-1 text-sm text-slate-800"
                    value={difficulty()}
                    onChange={(event) => setDifficulty(event.currentTarget.value)}
                  >
                    <For each={difficultyOptions}>
                      {(option) => (
                        <option value={option.id}>{option.label}</option>
                      )}
                    </For>
                  </select>
                </label>
                <label class="flex items-center justify-between">
                  <span>出題数</span>
                  <input
                    type="number"
                    min="1"
                    max="20"
                    value={questionCount()}
                    class="w-20 rounded-md border border-slate-200 px-2 py-1 text-sm text-slate-800"
                    onInput={(event) => {
                      const value = Number(event.currentTarget.value);
                      setQuestionCount(Number.isNaN(value) ? 1 : Math.max(1, Math.min(20, value)));
                    }}
                  />
                </label>
              </div>
            </div>

            <div class="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <p class="text-xs font-semibold uppercase text-slate-500">
                温度
              </p>
              <div class="mt-2 space-y-2 text-sm text-slate-800">
                <label class="flex items-center justify-between">
                  <span>サンプリング温度</span>
                  <span class="text-xs text-slate-600">{temperature().toFixed(1)}</span>
                </label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.1"
                  value={temperature()}
                  class="w-full"
                  onInput={(event) => setTemperature(Number(event.currentTarget.value))}
                />
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
                <select
                  class="rounded-md border border-slate-200 px-2 py-1 text-sm text-slate-800"
                  value={presetId() ?? ""}
                  onChange={(event) => setPresetId(event.currentTarget.value)}
                >
                  <Show
                    when={presetOptions().length > 0}
                    fallback={<option value="">プリセット未登録</option>}
                  >
                    <For each={presetOptions()}>
                      {(option) => (
                        <option value={option.value}>{option.label}</option>
                      )}
                    </For>
                  </Show>
                </select>
              </label>
            </div>
          </div>

          <div class="flex flex-wrap gap-2">
            <button
              class="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              onClick={handleSaveDraft}
            >
              下書き保存
            </button>
            <button
              class="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
              onClick={handleApplySettings}
              disabled={isGenerating() || !selectedMaterialId()}
            >
              {isGenerating() ? "生成中..." : "生成を開始"}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
};

const NewLearningSurface: Component = () => {
  const newLearningDraft = useNewLearningDraft();
  const [pendingQuery, setPendingQuery] = createSignal("");
  const [searchQuery, setSearchQuery] = createSignal("");
  const [subjectFilter, setSubjectFilter] = createSignal("all");
  const [sourceLearningId, setSourceLearningId] = createSignal<string>();
  const [selectedMaterialIds, setSelectedMaterialIds] = createSignal<string[]>([]);
  const [selectedContentIds, setSelectedContentIds] = createSignal<string[]>([]);
  const [title, setTitle] = createSignal("");
  const [tags, setTags] = createSignal("");
  const [status, setStatus] = createSignal<string | null>(null);
  const [isCreating, setIsCreating] = createSignal(false);
  const [hydratedDraftId, setHydratedDraftId] = createSignal<string | null>(null);
  const [selectionDraftId, setSelectionDraftId] = createSignal<string | null>(null);
  const summarizeForDisplay = (value: unknown) =>
    (typeof value === "string" ? value : JSON.stringify(value ?? {}))
      .replace(/\s+/g, " ")
      .slice(0, 80);

  const activeDraft = () => newLearningDraft.state.draft;

  const [learningSearch] = createResource(
    () => ({
      q: searchQuery(),
      subject: subjectFilter(),
    }),
    (params) =>
      fetchLearnings({
        q: params.q.trim() || undefined,
        subject: params.subject === "all" ? undefined : params.subject,
        limit: 80,
      }),
  );

  createEffect(() => {
    const list = learningSearch();
    if (!list?.length) return;
    if (sourceLearningId() && list.some((item) => item.id === sourceLearningId())) return;
    const draft = activeDraft();
    const first = draft && list.some((item) => item.id === draft.sourceLearningId)
      ? draft.sourceLearningId
      : list[0].id;
    setSourceLearningId(first);
  });
  createEffect(() => {
    const draft = activeDraft();
    if (!draft) return;
    if (hydratedDraftId() === draft.createdAt) return;
    setSourceLearningId(draft.sourceLearningId);
    setTitle(draft.title);
    setTags(draft.tags.join(", "));
    if (draft.subject) {
      setSubjectFilter(draft.subject);
    }
    setPendingQuery(draft.title);
    setSearchQuery(draft.title);
    setHydratedDraftId(draft.createdAt);
    setSelectionDraftId(null);
  });

  const selectedLearning = createMemo(() =>
    (learningSearch() ?? []).find((learning) => learning.id === sourceLearningId()),
  );

  const [materials] = createResource(
    () => sourceLearningId(),
    (id) => (id ? fetchMaterials(id).then((res) => res.items) : []),
  );
  const [generatedContents] = createResource(
    () => sourceLearningId(),
    (id) => (id ? fetchContents(id).then((res) => res.items) : []),
  );
  createEffect(() => {
    const draft = activeDraft();
    if (!draft) return;
    if (hydratedDraftId() !== draft.createdAt) return;
    if (selectionDraftId() === draft.createdAt) return;
    const mats = materials();
    const gens = generatedContents();
    if (!mats || !gens) return;
    setSelectedMaterialIds(
      mats.filter((mat) => draft.recommendedMaterialIds.includes(mat.id)).map((mat) => mat.id),
    );
    setSelectedContentIds(
      gens.filter((content) => draft.recommendedContentIds.includes(content.id)).map((content) => content.id),
    );
    setSelectionDraftId(draft.createdAt);
  });

  const recommendedMaterials = createMemo(() => {
    const ids = activeDraft()?.recommendedMaterialIds ?? [];
    return (materials() ?? []).filter((mat) => ids.includes(mat.id));
  });
  const recommendedGenerated = createMemo(() => {
    const ids = activeDraft()?.recommendedContentIds ?? [];
    return (generatedContents() ?? []).filter((content) => ids.includes(content.id));
  });

  const toggleSelection = (ids: string[], setIds: (value: string[]) => void, id: string) => {
    if (ids.includes(id)) {
      setIds(ids.filter((item) => item !== id));
    } else {
      setIds([...ids, id]);
    }
  };

  const handleSearch = () => {
    setSearchQuery(pendingQuery().trim());
  };

  const handleApplyDraftFilters = () => {
    const draft = activeDraft();
    if (!draft) return;
    setPendingQuery(draft.title);
    setSearchQuery(draft.title);
    if (draft.subject) {
      setSubjectFilter(draft.subject);
    }
    setSourceLearningId(draft.sourceLearningId);
    setSelectionDraftId(null);
  };

  const handleApplyRecommended = () => {
    const draft = activeDraft();
    if (!draft) return;
    setSourceLearningId(draft.sourceLearningId);
    setSelectionDraftId(null);
    const mats = materials();
    const gens = generatedContents();
    if (mats) {
      setSelectedMaterialIds(
        mats.filter((mat) => draft.recommendedMaterialIds.includes(mat.id)).map((mat) => mat.id),
      );
    }
    if (gens) {
      setSelectedContentIds(
        gens.filter((content) => draft.recommendedContentIds.includes(content.id)).map((content) => content.id),
      );
    }
  };

  const handleCreate = async () => {
    const source = learningSearch()?.find((learning) => learning.id === sourceLearningId());
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
      newLearningDraft.clearDraft();
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
          検索 → 抽出プレビュー → 取捨選択の3ステップで組み立て
        </h1>
        <p class="text-sm text-slate-600">
          AIチャットからの抽出ドラフトを受け取り、関連する教材・生成物をプレビューした上でコピー対象を選びます。
        </p>
      </header>

      <Show when={activeDraft()}>
        {(draft) => (
          <div class="rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-sm text-indigo-900">
            <p class="text-xs font-semibold uppercase text-indigo-700">
              AI抽出済みのドラフト
            </p>
            <p class="mt-1 text-base font-semibold text-slate-900">{draft().title}</p>
            <p class="text-xs text-indigo-700">
              推薦: 教材 {draft().recommendedMaterialIds.length} 件 / 生成 {draft().recommendedContentIds.length} 件
            </p>
            <p class="mt-2 whitespace-pre-wrap text-xs text-slate-700">
              {draft().reasoning ?? "抽出理由のメモはありません。"}
            </p>
            <div class="mt-3 flex flex-wrap gap-2">
              <button
                class="rounded-md border border-indigo-200 px-3 py-2 text-xs font-semibold text-indigo-700 hover:bg-white"
                onClick={handleApplyDraftFilters}
              >
                検索条件と選択をドラフトに寄せる
              </button>
              <button
                class="rounded-md border border-transparent px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-white/50"
                onClick={() => newLearningDraft.clearDraft()}
              >
                ドラフトをクリア
              </button>
            </div>
          </div>
        )}
      </Show>

      <div class="grid gap-4 xl:grid-cols-[1.15fr_1fr]">
        <div class="space-y-4">
          <div class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p class="text-xs font-semibold uppercase text-slate-500">
              ① 抽出元を検索
            </p>
            <div class="mt-3 space-y-2 text-sm text-slate-800">
              <div class="flex flex-col gap-2 md:flex-row md:items-center md:gap-3">
                <input
                  class="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 md:w-72"
                  placeholder="タイトル・タグ・キーワードで検索"
                  value={pendingQuery()}
                  onInput={(event) => setPendingQuery(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") handleSearch();
                  }}
                />
                <select
                  class="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-800"
                  value={subjectFilter()}
                  onChange={(event) => setSubjectFilter(event.currentTarget.value)}
                >
                  <For each={subjects}>
                    {(item) => (
                      <option value={item.id}>{item.label}</option>
                    )}
                  </For>
                </select>
                <button
                  class="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={handleSearch}
                  disabled={learningSearch.loading}
                >
                  {learningSearch.loading ? "検索中..." : "検索"}
                </button>
              </div>
              <Show when={activeDraft()}>
                {(draft) => (
                  <button
                    class="rounded-md border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-[11px] font-semibold text-indigo-700 transition hover:bg-white"
                    onClick={handleApplyDraftFilters}
                  >
                    AI提案「{draft().title.slice(0, 16)}...」に合わせて絞り込む
                  </button>
                )}
              </Show>
              <div class="h-px w-full bg-slate-200" />
              <div class="space-y-2">
                <For each={learningSearch() ?? []}>
                  {(learning) => {
                    const isDraftSource = activeDraft()?.sourceLearningId === learning.id;
                    return (
                      <label class="flex gap-3 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 transition hover:border-indigo-200">
                        <input
                          type="radio"
                          name="learning"
                          checked={learning.id === sourceLearningId()}
                          onChange={() => setSourceLearningId(learning.id)}
                        />
                        <div class="flex-1 space-y-1">
                          <div class="flex flex-wrap items-center gap-2">
                            <p class="font-semibold text-slate-900">{learning.title}</p>
                            <span class="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                              {subjectLabel(learning.subject)}
                            </span>
                            <span class="text-[11px] text-slate-500">
                              教材 {learning.materialsCount ?? 0} / 生成 {learning.generatedCount ?? 0}
                            </span>
                            <Show when={isDraftSource}>
                              <span class="rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">
                                AI提案の抽出元
                              </span>
                            </Show>
                          </div>
                          <p class="text-xs text-slate-600">
                            {(learning.tags ?? []).join(", ") || "タグ未設定"}
                          </p>
                        </div>
                      </label>
                    );
                  }}
                </For>
                <Show when={!learningSearch() || learningSearch()?.length === 0}>
                  <p class="text-xs text-slate-500">条件に合致するLearningがありません。</p>
                </Show>
              </div>
            </div>
          </div>

          <div class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p class="text-xs font-semibold uppercase text-slate-500">
              ② 抽出プレビュー
            </p>
            <div class="mt-2 space-y-3 text-sm text-slate-800">
              <div class="flex flex-wrap items-center gap-2">
                <p class="font-semibold text-slate-900">
                  選択中: {selectedLearning()?.title ?? "未選択"}
                </p>
                <Show when={selectedLearning()}>
                  {(learning) => (
                    <span class="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-700">
                      教材 {learning().materialsCount ?? 0} / 生成 {learning().generatedCount ?? 0}
                    </span>
                  )}
                </Show>
              </div>

              <div class="rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-2">
                <div class="flex items-center justify-between gap-2">
                  <p class="text-[11px] font-semibold uppercase text-indigo-700">AI 推薦サマリ</p>
                  <button
                    class="rounded-md border border-indigo-200 bg-white px-2 py-1 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-60"
                    onClick={handleApplyRecommended}
                    disabled={!activeDraft()}
                  >
                    推薦を選択に反映
                  </button>
                </div>
                <p class="text-xs text-indigo-800">
                  教材 {recommendedMaterials().length} 件 / 生成 {recommendedGenerated().length} 件を優先候補として抽出しています。
                </p>
                <p class="mt-1 whitespace-pre-wrap text-[11px] text-indigo-700">
                  {activeDraft()?.reasoning ?? "AIからの抽出メモがまだありません。"}
                </p>
              </div>

              <div class="grid gap-3 md:grid-cols-2">
                <div class="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                  <div class="flex items-center justify-between text-[11px] font-semibold text-slate-600">
                    <span>教材プレビュー</span>
                    <span>{materials()?.length ?? 0} 件</span>
                  </div>
                  <div class="mt-2 space-y-2">
                    <For each={(materials() ?? []).slice(0, 4)}>
                      {(material) => {
                        const isRecommended = recommendedMaterials().some((item) => item.id === material.id);
                        return (
                          <div class="rounded-md bg-white px-2 py-1">
                            <div class="flex items-center justify-between gap-2">
                              <span class="text-sm font-semibold text-slate-900">
                                {material.sourcePath ?? material.type.toUpperCase()}
                              </span>
                              <Show when={isRecommended}>
                                <span class="rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">
                                  推薦
                                </span>
                              </Show>
                            </div>
                            <p class="text-[11px] text-slate-600">
                              {material.rawContent ? summarizeForDisplay(material.rawContent) : material.type}
                            </p>
                          </div>
                        );
                      }}
                    </For>
                    <Show when={(materials() ?? []).length === 0}>
                      <p class="text-xs text-slate-500">この学習には教材がありません。</p>
                    </Show>
                  </div>
                </div>
                <div class="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                  <div class="flex items-center justify-between text-[11px] font-semibold text-slate-600">
                    <span>生成コンテンツプレビュー</span>
                    <span>{generatedContents()?.length ?? 0} 件</span>
                  </div>
                  <div class="mt-2 space-y-2">
                    <For each={(generatedContents() ?? []).slice(0, 4)}>
                      {(content) => {
                        const isRecommended = recommendedGenerated().some((item) => item.id === content.id);
                        return (
                          <div class="rounded-md bg-white px-2 py-1">
                            <div class="flex items-center justify-between gap-2">
                              <span class="text-sm font-semibold text-slate-900">
                                {generatedTypeLabels[content.type] ?? content.type}
                              </span>
                              <Show when={isRecommended}>
                                <span class="rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">
                                  推薦
                                </span>
                              </Show>
                            </div>
                            <p class="text-[11px] text-slate-600">
                              {summarizeForDisplay(content.content)}
                            </p>
                          </div>
                        );
                      }}
                    </For>
                    <Show when={(generatedContents() ?? []).length === 0}>
                      <p class="text-xs text-slate-500">生成コンテンツがありません。</p>
                    </Show>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p class="text-xs font-semibold uppercase text-slate-500">
            ③ 取捨選択と新規Learning
          </p>
          <div class="mt-3 space-y-3 text-sm text-slate-800">
            <div class="flex flex-wrap gap-2">
              <button
                class="rounded-md border border-slate-200 px-3 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                onClick={() => {
                  setSelectedMaterialIds(materials()?.map((item) => item.id) ?? []);
                  setSelectedContentIds(generatedContents()?.map((item) => item.id) ?? []);
                }}
              >
                すべて選択
              </button>
              <button
                class="rounded-md border border-slate-200 px-3 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                onClick={() => {
                  setSelectedMaterialIds([]);
                  setSelectedContentIds([]);
                  setSelectionDraftId(null);
                }}
              >
                選択をクリア
              </button>
              <button
                class="rounded-md border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-[11px] font-semibold text-indigo-700 hover:bg-white"
                onClick={handleApplyRecommended}
                disabled={!activeDraft()}
              >
                推薦のみをチェック
              </button>
            </div>

            <div class="grid gap-3 md:grid-cols-2">
              <div class="space-y-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                <p class="text-xs font-semibold text-slate-600">教材</p>
                <For each={materials() ?? []}>
                  {(material) => {
                    const isRecommended = recommendedMaterials().some((item) => item.id === material.id);
                    return (
                      <label class="flex items-start gap-2 rounded-md px-1 py-1 hover:bg-white">
                        <input
                          type="checkbox"
                          checked={selectedMaterialIds().includes(material.id)}
                          onChange={() =>
                            toggleSelection(selectedMaterialIds(), setSelectedMaterialIds, material.id)
                          }
                        />
                        <div class="space-y-1">
                          <div class="flex items-center gap-2">
                            <span class="text-sm font-semibold text-slate-900">
                              {material.sourcePath ?? material.type.toUpperCase()}
                            </span>
                            <Show when={isRecommended}>
                              <span class="rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">
                                推薦
                              </span>
                            </Show>
                          </div>
                          <p class="text-[11px] text-slate-600">
                            {material.rawContent ? summarizeForDisplay(material.rawContent) : material.type}
                          </p>
                        </div>
                      </label>
                    );
                  }}
                </For>
                <Show when={(materials() ?? []).length === 0}>
                  <p class="text-xs text-slate-500">教材がありません。</p>
                </Show>
              </div>

              <div class="space-y-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                <p class="text-xs font-semibold text-slate-600">生成コンテンツ</p>
                <For each={generatedContents() ?? []}>
                  {(content) => {
                    const isRecommended = recommendedGenerated().some((item) => item.id === content.id);
                    return (
                      <label class="flex items-start gap-2 rounded-md px-1 py-1 hover:bg-white">
                        <input
                          type="checkbox"
                          checked={selectedContentIds().includes(content.id)}
                          onChange={() =>
                            toggleSelection(selectedContentIds(), setSelectedContentIds, content.id)
                          }
                        />
                        <div class="space-y-1">
                          <div class="flex items-center gap-2">
                            <span class="text-sm font-semibold text-slate-900">
                              {generatedTypeLabels[content.type] ?? content.type}
                            </span>
                            <Show when={isRecommended}>
                              <span class="rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">
                                推薦
                              </span>
                            </Show>
                          </div>
                          <p class="text-[11px] text-slate-600">
                            {summarizeForDisplay(content.content)}
                          </p>
                        </div>
                      </label>
                    );
                  }}
                </For>
                <Show when={(generatedContents() ?? []).length === 0}>
                  <p class="text-xs text-slate-500">生成コンテンツがありません。</p>
                </Show>
              </div>
            </div>

            <div class="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
              <p class="text-xs font-semibold uppercase text-slate-500">
                新規学習のプレビュー
              </p>
              <div class="mt-2 space-y-2">
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
                <div class="rounded-lg bg-white px-3 py-2">
                  <p class="text-xs font-semibold uppercase text-slate-500">
                    コピー対象の概要
                  </p>
                  <ul class="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-700">
                    <li>教材 {selectedMaterialIds().length} 件</li>
                    <li>生成コンテンツ {selectedContentIds().length} 件</li>
                  </ul>
                </div>
              </div>
            </div>

            <div class="flex gap-2">
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
                <p class="text-xs text-slate-700">
                  {text()}
                </p>
              )}
            </Show>
          </div>
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
