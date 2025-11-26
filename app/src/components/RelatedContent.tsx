import { For, Show, createEffect, createResource, createSignal, type Component } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { semanticSearch, type SemanticMatch } from "../lib/ai";

interface RelatedContentProps {
  query: string;
  learningId?: string;
  onContentClick?: (id: string, type: "learning" | "material" | "generated_content") => void;
}

const RelatedContent: Component<RelatedContentProps> = (props) => {
  const navigate = useNavigate();
  const [isVisible, setIsVisible] = createSignal(true);

  const [related, { refetch }] = createResource(
    () => props.query.trim(),
    async (q) => {
      if (!q) return [];
      // Search for related content using the query
      return await semanticSearch(q, 6);
    }
  );

  const learningMatches = () => 
    related()?.filter(m => m.refType === "learning" && m.refId !== props.learningId) ?? [];
    
  const contentMatches = () => 
    related()?.filter(m => m.refType !== "learning") ?? [];

  const handleLearningClick = (id: string | undefined) => {
    if (!id) return;
    if (props.onContentClick) {
      props.onContentClick(id, "learning");
    } else {
      navigate(`/learning-detail?id=${id}`);
    }
  };

  // Helper to truncate text
  const truncate = (text: string, length: number) => 
    text.length > length ? text.substring(0, length) + "..." : text;

  const scorePercent = (score: number) => Math.round(score * 100);

  return (
    <div class="rounded-xl border border-slate-200 bg-white shadow-sm transition-all duration-300">
      <div 
        class="flex items-center justify-between cursor-pointer bg-slate-50 p-3 rounded-t-xl border-b border-slate-100"
        onClick={() => setIsVisible(!isVisible())}
      >
        <div class="flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4 text-indigo-600">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" />
          </svg>
          <p class="text-xs font-bold uppercase text-indigo-900">関連する学習・コンテンツ</p>
        </div>
        <button class="text-slate-400 hover:text-slate-600">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class={`w-4 h-4 transition-transform ${isVisible() ? 'rotate-180' : ''}`}>
            <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
          </svg>
        </button>
      </div>

      <Show when={isVisible()}>
        <div class="p-3 space-y-4">
          <Show when={related.loading}>
            <div class="flex justify-center py-4">
              <div class="animate-spin h-4 w-4 border-2 border-indigo-500 border-t-transparent rounded-full"></div>
            </div>
          </Show>

          <Show when={related.error}>
            <div class="flex flex-col items-center gap-2 py-3">
              <p class="text-xs text-rose-600 text-center">
                関連コンテンツの読み込みに失敗しました
              </p>
              <button
                onClick={() => refetch()}
                class="text-xs px-3 py-1 rounded-md bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors"
              >
                再試行
              </button>
            </div>
          </Show>

          <Show when={!related.loading && !related.error && related()?.length === 0}>
            <p class="text-xs text-slate-500 text-center py-2">関連するコンテンツは見つかりませんでした。</p>
          </Show>

          <Show when={!related.loading && learningMatches().length > 0}>
            <div>
              <p class="text-[10px] font-bold text-slate-400 mb-2 uppercase tracking-wider">関連する学習セット</p>
              <div class="space-y-2">
                <For each={learningMatches()}>
                  {(match) => (
                    <div 
                      class="group cursor-pointer rounded-lg border border-slate-100 bg-slate-50 p-2 hover:border-indigo-200 hover:bg-indigo-50 transition-colors"
                      onClick={() => handleLearningClick(match.refId)}
                    >
                      <div class="flex justify-between items-start">
                        <h4 class="text-xs font-semibold text-slate-800 group-hover:text-indigo-700 line-clamp-1">
                          {truncate(match.excerpt, 40)}
                        </h4>
                        <span class="text-[10px] font-mono text-slate-400 bg-white px-1.5 py-0.5 rounded border border-slate-100">
                          {scorePercent(match.score)}%
                        </span>
                      </div>
                      <p class="text-[10px] text-slate-500 mt-1 line-clamp-2">
                        {match.label}
                      </p>
                    </div>
                  )}
                </For>
              </div>
            </div>
          </Show>

          <Show when={!related.loading && contentMatches().length > 0}>
            <div>
              <p class="text-[10px] font-bold text-slate-400 mb-2 uppercase tracking-wider">関連コンテンツ (教材/生成物)</p>
              <div class="space-y-2">
                <For each={contentMatches()}>
                  {(match) => (
                    <div class="rounded-lg border border-slate-100 bg-white p-2">
                      <div class="flex justify-between items-start mb-1">
                        <span class={`text-[10px] px-1.5 py-0.5 rounded font-medium border ${
                          match.refType === 'material' 
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-100' 
                            : 'bg-amber-50 text-amber-700 border-amber-100'
                        }`}>
                          {match.refType === 'material' ? '教材' : '生成'}
                        </span>
                        <span class="text-[10px] font-mono text-slate-400">
                          {scorePercent(match.score)}%
                        </span>
                      </div>
                      <p class="text-xs text-slate-700 line-clamp-2 mb-1 font-medium">
                        {truncate(match.excerpt, 60)}
                      </p>
                      <p class="text-[10px] text-slate-400">
                        {match.label}
                      </p>
                    </div>
                  )}
                </For>
              </div>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
};

export default RelatedContent;
