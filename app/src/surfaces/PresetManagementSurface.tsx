import { For, Show, createEffect, createSignal, onMount, type Component } from "solid-js";
import { type Preset } from "@theteacher/shared";
import {
  fetchPresets,
  createPreset,
  updatePreset,
  deletePreset as deletePresetApi,
} from "../lib/api-client";
import { useSettings } from "../lib/settings-store";

const PresetManagementSurface: Component = () => {
  const settings = useSettings();
  const [editingPresetId, setEditingPresetId] = createSignal<string | undefined>();
  const [presetSubject, setPresetSubject] = createSignal("math");
  const [presetTitle, setPresetTitle] = createSignal("");
  const [presetSystemPrompt, setPresetSystemPrompt] = createSignal("");
  const [presetUserTemplate, setPresetUserTemplate] = createSignal("");
  const [backupMessage, setBackupMessage] = createSignal<string | null>(null);
  const [backupError, setBackupError] = createSignal<string | null>(null);
  const [isSyncingPresets, setIsSyncingPresets] = createSignal(false);

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

  return (
    <section class="space-y-6">
      <header class="space-y-2">
        <p class="text-xs font-semibold uppercase tracking-wide text-indigo-600">
          プリセット管理
        </p>
        <h1 class="text-2xl font-bold text-slate-900">
          教科別プリセットの作成・編集
        </h1>
        <p class="text-sm text-slate-600">
          AI生成に使用するプロンプトテンプレートを管理します。
        </p>
      </header>

      <div class="space-y-2">
        <Show when={backupMessage()}>
            <p class="text-xs text-emerald-700">{backupMessage()}</p>
        </Show>
        <Show when={backupError()}>
            <p class="text-xs text-rose-700">{backupError()}</p>
        </Show>
      </div>

      <div class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-xs font-semibold uppercase text-slate-500">
              プリセットエディタ
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
                <option value="general">general</option>
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

export default PresetManagementSurface;
