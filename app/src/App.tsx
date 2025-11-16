import { For, type Component } from "solid-js";

const sections = [
  {
    title: "学習一覧",
    body: "「学習」単位で教材と進捗を管理し、必要な画面へ遷移するトップレベルのリスト。",
  },
  {
    title: "学習詳細",
    body: "教材にひもづく生成コンテンツ（Q&A / 練習問題 / 要約 / ポッドキャスト）をタブで表示。",
  },
  {
    title: "演習モード",
    body: "問題文と回答エリアを左右に配置し、手書き/テキスト入力を切り替えてAIと対話。",
  },
  {
    title: "汎用AIチャット",
    body: "Tool Call を通じて教材検索や新規学習の自動作成を行うチャット画面。",
  },
  {
    title: "プリセット・設定",
    body: "教科別プリセットやAI設定、バックアップを管理する設定ページ。",
  },
];

const App: Component = () => {
  return (
    <main class="min-h-screen bg-slate-50 px-6 py-10">
      <div class="mx-auto max-w-5xl space-y-8 rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <header class="space-y-2">
          <p class="text-sm font-semibold text-indigo-600">TheTeacher</p>
          <div class="space-y-1">
            <h1 class="text-2xl font-bold text-slate-900">
              AI-firstな学習体験をつくるTauri + SolidJSベースのアプリ
            </h1>
            <p class="text-slate-600">
              PLAN.mdで定義したサーフェスに沿って、各画面の殻とUIコンポーネントをここから拡張していきます。
            </p>
          </div>
        </header>

        <section class="grid gap-4 md:grid-cols-2">
          <For each={sections}>
            {(section) => (
              <article class="space-y-2 rounded-xl border border-slate-200 bg-slate-50/80 p-4 shadow-sm">
                <h2 class="text-lg font-semibold text-slate-900">{section.title}</h2>
                <p class="text-sm text-slate-700">{section.body}</p>
              </article>
            )}
          </For>
        </section>

        <footer class="flex flex-col gap-2 text-sm text-slate-600 md:flex-row md:items-center md:justify-between">
          <div>
            開発の次ステップ:
            <span class="ml-1 font-semibold text-slate-900">
              学習リスト → 詳細タブ → 演習画面 → 汎用チャット
            </span>
          </div>
          <div class="text-slate-500">
            Tailwind + SolidJS + Tauri scaffolding ready.
          </div>
        </footer>
      </div>
    </main>
  );
};

export default App;
