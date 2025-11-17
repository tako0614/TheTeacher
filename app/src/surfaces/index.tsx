import { For, Show, createMemo, createSignal, type Component } from "solid-js";

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
  const conversations = [
    { role: "user", content: "数学Iの二次関数を復習テストにしてください。" },
    { role: "assistant", content: "3問の小テストを用意しました。始めますか？" },
    { role: "user", content: "頂点の求め方の要約も追加でほしい。" },
  ];
  const toolCalls = [
    { tool: "search_learnings", detail: "subject=math, tag=二次関数" },
    { tool: "generate_questions", detail: "count=3, difficulty=medium" },
    { tool: "save_content", detail: "type=qa, learning=高校数学I" },
  ];

  return (
    <section class="space-y-6">
      <header class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p class="text-xs font-semibold uppercase tracking-wide text-indigo-600">
            汎用AIチャット
          </p>
          <h1 class="text-2xl font-bold text-slate-900">
            チャットとTool Callログを並べた2カラム構成
          </h1>
          <p class="text-sm text-slate-600">
            教材がなくてもチャットから学習生成を依頼できます。左側にTool Callの履歴を残し、開発向けの観察をしやすくしました。
          </p>
        </div>
        <div class="flex flex-wrap gap-2">
          <button class="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
            新しい学習を提案
          </button>
          <button class="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
            プリセット切替
          </button>
        </div>
      </header>

      <div class="grid gap-4 md:grid-cols-[0.9fr_1.1fr]">
        <aside class="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p class="text-xs font-semibold uppercase text-slate-500">
            Tool Call ログ
          </p>
          <div class="space-y-2 text-sm text-slate-800">
            <For each={toolCalls}>
              {(call) => (
                <div class="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <p class="text-xs uppercase text-indigo-700">{call.tool}</p>
                  <p class="text-slate-700">{call.detail}</p>
                </div>
              )}
            </For>
          </div>
          <div class="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            学習を作成 / 追加できる Tool Call をここから確認できます。
          </div>
        </aside>

        <div class="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div class="space-y-2">
            <p class="text-xs font-semibold uppercase text-slate-500">
              チャットログ
            </p>
            <div class="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
              <For each={conversations}>
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
              <select class="rounded-lg border border-slate-200 px-2 py-1 text-sm text-slate-800">
                <option>math_default</option>
                <option>english_reading</option>
                <option>programming_cpp</option>
              </select>
            </div>
            <div class="flex items-center gap-2">
              <label class="text-xs font-semibold text-slate-700">
                トーン
              </label>
              <select class="rounded-lg border border-slate-200 px-2 py-1 text-sm text-slate-800">
                <option>丁寧</option>
                <option>カジュアル</option>
                <option>厳しめ</option>
              </select>
            </div>
          </div>

          <div class="flex gap-2">
            <input
              class="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
              placeholder="質問や生成依頼を入力..."
            />
            <button class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500">
              送信
            </button>
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

const presets = [
  { subject: "math", title: "math_detail", tone: "論理的" },
  { subject: "english", title: "english_reading", tone: "丁寧" },
  { subject: "science", title: "science_brief", tone: "簡潔" },
];

const AppSettingsSurface: Component = () => (
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
            <select class="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800">
              <option>gpt-4o-mini</option>
              <option>gpt-4.1-preview</option>
              <option>claude-3.5-sonnet</option>
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
              value="0.3"
              class="w-full"
              aria-label="temperature slider"
            />
          </label>
          <label class="flex flex-col gap-1 text-sm md:col-span-2">
            <span class="text-xs font-semibold text-slate-600">APIキー</span>
            <input
              class="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800"
              placeholder="sk-..."
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
            <span class="font-semibold">2024-11-02 09:10</span>
          </div>
          <div class="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
            <span>保存先</span>
            <span>ローカル + 外部ストレージ</span>
          </div>
          <div class="flex gap-2">
            <button class="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
              エクスポート
            </button>
            <button class="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
              インポート
            </button>
          </div>
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
        <button class="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-100">
          + プリセットを追加
        </button>
      </div>

      <div class="mt-3 overflow-hidden rounded-lg border border-slate-200">
        <table class="min-w-full divide-y divide-slate-200 text-sm">
          <thead class="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th class="px-3 py-2">教科</th>
              <th class="px-3 py-2">プリセット名</th>
              <th class="px-3 py-2">トーン</th>
              <th class="px-3 py-2 text-right">操作</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-200 bg-white text-slate-800">
            <For each={presets}>
              {(preset) => (
                <tr>
                  <td class="px-3 py-2 font-semibold uppercase text-slate-700">
                    {preset.subject}
                  </td>
                  <td class="px-3 py-2">{preset.title}</td>
                  <td class="px-3 py-2">{preset.tone}</td>
                  <td class="px-3 py-2">
                    <div class="flex justify-end gap-2">
                      <button class="rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                        編集
                      </button>
                      <button class="rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                        複製
                      </button>
                      <button class="rounded-md border border-rose-200 px-2 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50">
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
