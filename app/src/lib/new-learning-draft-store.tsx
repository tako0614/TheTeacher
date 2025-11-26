import { createContext, createEffect, useContext, type ParentComponent } from "solid-js";
import { createStore, produce } from "solid-js/store";

import type { SemanticMatch } from "./ai";

export type LearningAssemblyDraft = {
  sourceLearningId?: string;
  title: string;
  subject?: string;
  tags: string[];
  reasoning?: string;
  recommendedMaterialIds: string[];
  recommendedContentIds: string[];
  createdAt: string;
};

type DraftState = {
  draft: LearningAssemblyDraft | null;
};

const STORAGE_KEY = "theteacher/new-learning-draft/v1";

const getStorage = () => (typeof localStorage === "undefined" ? null : localStorage);

const loadDraft = (): LearningAssemblyDraft | null => {
  const storage = getStorage();
  const raw = storage?.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as LearningAssemblyDraft;
    if (!parsed.title) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

const persistDraft = (draft: LearningAssemblyDraft | null) => {
  const storage = getStorage();
  if (!storage) return;
  if (!draft) {
    storage.removeItem(STORAGE_KEY);
    return;
  }
  storage.setItem(STORAGE_KEY, JSON.stringify(draft));
};

const defaultState: DraftState = {
  draft: loadDraft(),
};

const nowIso = () => new Date().toISOString();

type DraftSeedOverrides = {
  title?: string;
  subject?: string;
  tags?: string[];
  sourceLearningId?: string;
  reasoning?: string;
};

const summarizeMatches = (matches: SemanticMatch[]) =>
  matches
    .slice(0, 3)
    .map((hit) => `- ${hit.label}: ${hit.excerpt.slice(0, 60)}`)
    .join("\n");

const refIdOf = (hit: SemanticMatch) => hit.refId ?? hit.id;

export const createNewLearningDraftStore = () => {
  const [state, setState] = createStore<DraftState>(defaultState);

  createEffect(() => {
    persistDraft(state.draft);
  });

  const setDraft = (draft: LearningAssemblyDraft | null) =>
    setState(
      produce((current) => {
        current.draft = draft;
      }),
    );

  const clearDraft = () => setDraft(null);

  const seedDraftFromMatches = (matches: SemanticMatch[], overrides?: DraftSeedOverrides) => {
    const preferred = overrides?.sourceLearningId
      ? matches.find(
          (hit) => refIdOf(hit) === overrides.sourceLearningId && hit.refType === "learning",
        )
      : undefined;
    const learningHit = preferred ?? matches.find((hit) => hit.refType === "learning");
    const sourceLearningId = overrides?.sourceLearningId ?? (learningHit ? refIdOf(learningHit) : undefined);

    const subject = overrides?.subject ?? learningHit?.subject;
    const tags =
      overrides?.tags ?? (subject ? [subject] : []);
    const next: LearningAssemblyDraft = {
      sourceLearningId,
      title: overrides?.title ?? (learningHit ? `${learningHit.label}の復習セット案` : "AI提案の新規Learning"),
      subject,
      tags,
      reasoning: overrides?.reasoning ?? summarizeMatches(matches),
      recommendedMaterialIds: matches
        .filter((hit) => hit.refType === "material")
        .map((hit) => refIdOf(hit)),
      recommendedContentIds: matches
        .filter((hit) => hit.refType === "generated_content")
        .map((hit) => refIdOf(hit)),
      createdAt: nowIso(),
    };

    setDraft(next);
    return next;
  };

  return {
    state,
    setDraft,
    clearDraft,
    seedDraftFromMatches,
  };
};

const NewLearningDraftContext = createContext<ReturnType<typeof createNewLearningDraftStore>>();

export const NewLearningDraftProvider: ParentComponent = (props) => {
  const store = createNewLearningDraftStore();
  return (
    <NewLearningDraftContext.Provider value={store}>
      {props.children}
    </NewLearningDraftContext.Provider>
  );
};

export const useNewLearningDraft = () => {
  const ctx = useContext(NewLearningDraftContext);
  if (!ctx) throw new Error("useNewLearningDraft must be used within NewLearningDraftProvider");
  return ctx;
};
