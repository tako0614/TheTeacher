import {
  type AppSettings,
  type BackupSettings,
  type Preset,
  appSettingsSchema,
  backupSettingsSchema,
  presetSchema,
} from "@theteacher/shared";
import {
  createContext,
  createEffect,
  useContext,
  type ParentComponent,
} from "solid-js";
import { createStore, produce } from "solid-js/store";

const STORAGE_KEY = "theteacher/settings/v1";

export type SettingsState = {
  settings: AppSettings;
  presets: Preset[];
};

type UpsertPresetInput = Omit<
  Preset,
  "id" | "createdAt" | "updatedAt"
> & { id?: string };

const defaultSettings: AppSettings = {
  ai: {
    model: "gpt-4o-mini",
    temperature: 0.3,
  },
  backup: {
    strategy: "manual",
  },
};

const defaultPresets: Preset[] = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    subject: "math",
    title: "math_detail",
    systemPrompt:
      "高校数学の問題を論理的に分解し、要点と手順を短く提示してください。",
    userInstructionTemplate:
      "次の教材を元に演習問題を生成してください: {{material}}",
    createdAt: "2024-11-02T10:00:00.000Z",
    updatedAt: "2024-11-02T10:00:00.000Z",
  },
  {
    id: "00000000-0000-4000-8000-000000000002",
    subject: "english",
    title: "english_reading",
    systemPrompt:
      "英文読解の背景と語彙を解説しつつ、丁寧な口調で問いかけてください。",
    userInstructionTemplate:
      "この英文の要約と確認問題を作ってください: {{material}}",
    createdAt: "2024-11-02T10:05:00.000Z",
    updatedAt: "2024-11-02T10:05:00.000Z",
  },
  {
    id: "00000000-0000-4000-8000-000000000003",
    subject: "science",
    title: "science_brief",
    systemPrompt:
      "理科系トピックを簡潔にまとめ、実験例や公式を添えてください。",
    userInstructionTemplate:
      "教材の重要語を抽出し、クイズ形式にしてください。素材: {{material}}",
    createdAt: "2024-11-02T10:10:00.000Z",
    updatedAt: "2024-11-02T10:10:00.000Z",
  },
];

const fallbackState: SettingsState = {
  settings: defaultSettings,
  presets: defaultPresets,
};

const getStorage = () =>
  typeof localStorage === "undefined" ? null : localStorage;

const parsePersisted = (raw: string | null): SettingsState => {
  if (!raw) return fallbackState;
  try {
    const parsed = JSON.parse(raw) as SettingsState;
    const settings = appSettingsSchema.parse(parsed.settings);
    const presets = (parsed.presets ?? defaultPresets).map((preset) =>
      presetSchema.parse(preset),
    );
    return { settings, presets };
  } catch (error) {
    console.warn("Failed to parse settings store; falling back to defaults", error);
    return fallbackState;
  }
};

const loadState = (): SettingsState => {
  const storage = getStorage();
  return parsePersisted(storage?.getItem(STORAGE_KEY) ?? null);
};

const persistState = (state: SettingsState) => {
  const storage = getStorage();
  if (!storage) return;
  storage.setItem(STORAGE_KEY, JSON.stringify(state));
};

const nowIso = () => new Date().toISOString();

export const createSettingsStore = () => {
  const [state, setState] = createStore<SettingsState>(loadState());

  createEffect(() => {
    persistState(state);
  });

  const mutate = (updater: (draft: SettingsState) => void) =>
    setState(produce(updater));

  const updateAiSettings = (input: Partial<AppSettings["ai"]>) => {
    mutate((draft) => {
      draft.settings.ai = {
        ...draft.settings.ai,
        ...input,
      };
    });
  };

  const updateBackupSettings = (input: Partial<BackupSettings>) =>
    mutate((draft) => {
      draft.settings.backup = {
        ...draft.settings.backup,
        ...input,
      };
    });

  const upsertPreset = (input: UpsertPresetInput): Preset => {
    const existingId = input.id;
    const now = nowIso();
    const preset: Preset = {
      id: existingId ?? crypto.randomUUID(),
      createdAt: existingId
        ? state.presets.find((item) => item.id === existingId)?.createdAt ??
          now
        : now,
      updatedAt: now,
      subject: input.subject,
      title: input.title,
      systemPrompt: input.systemPrompt,
      userInstructionTemplate: input.userInstructionTemplate,
    };

    mutate((draft) => {
      const idx = draft.presets.findIndex((item) => item.id === preset.id);
      if (idx >= 0) {
        draft.presets[idx] = preset;
      } else {
        draft.presets.unshift(preset);
      }
    });
    return preset;
  };

  const duplicatePreset = (id: string) => {
    const base = state.presets.find((preset) => preset.id === id);
    if (!base) return;
    return upsertPreset({
      ...base,
      id: undefined,
      title: `${base.title}_copy`,
    });
  };

  const deletePreset = (id: string) =>
    mutate((draft) => {
      draft.presets = draft.presets.filter((preset) => preset.id !== id);
    });

  const markBackupTaken = (takenAt: string = nowIso()) =>
    updateBackupSettings({ lastBackupAt: takenAt });

  const replaceState = (next: SettingsState) => setState(next);

  const validateState = () => {
    const validatedSettings = appSettingsSchema.parse(state.settings);
    const validatedPresets = state.presets.map((preset) =>
      presetSchema.parse(preset),
    );
    return { settings: validatedSettings, presets: validatedPresets };
  };

  return {
    state,
    updateAiSettings,
    updateBackupSettings,
    upsertPreset,
    duplicatePreset,
    deletePreset,
    markBackupTaken,
    replaceState,
    validateState,
  };
};

const SettingsContext = createContext<ReturnType<typeof createSettingsStore>>();

export const SettingsProvider: ParentComponent = (props) => {
  const store = createSettingsStore();
  return (
    <SettingsContext.Provider value={store}>
      {props.children}
    </SettingsContext.Provider>
  );
};

export const useSettings = () => {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used within SettingsProvider");
  return ctx;
};

export const selectPresetOptions = (presets: Preset[]) =>
  presets.map((preset) => ({
    label: `${preset.subject} / ${preset.title}`,
    value: preset.id,
  }));
